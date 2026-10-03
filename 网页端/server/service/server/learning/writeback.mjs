/**
 * 确认式写回（LINK-09，02 号方案 §7 写回 + 03 号方案 §5 质量和恢复门禁）。
 *
 * 这是本项目**第一次写资料库文件**，因此每一步都按方案执行：
 * 1. 证据先在应用侧暂存并标 pending（见 evidence.mjs）；
 * 2. 预览：返回将写入的日志小节、进度差异、冲突与目标范围，**不修改 Markdown**；
 * 3. 提交：重新读取目标文件比对 expectedHash，其他人改过就报冲突并展示逐字段差异，
 *    **不按 mtime 决胜**；
 * 4. 顺序固定：先写日志 → 再更新进度追踪 → 最后更新总计划日志索引；
 * 5. 幂等：operationId 作为标记写进日志小节，断线重试不重复追加；
 * 6. 多文件不是数据库事务：事务清单 + 备份记录每步，中断后按**实际文件**恢复；
 * 7. 恢复/回滚前再次校验 hash；出现第三方新改动则停止覆盖，转人工合并；
 * 8. 全部成功才标 synced；日志成功而进度失败显示「日志已保存，进度待合并」。
 *
 * 本模块绝不自动声称「已独立掌握」：等级变更需在预览里显式提出，且仅当证据确实是
 * 学习者独立完成、提示等级不高于 L2 时才写入。
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { ContentError, normalizeText, sha256 } from '../content/markdown.mjs'
import { readVaultText, resolveVaultRoot, resolveWritablePath } from '../content/vault-paths.mjs'
import { EVIDENCE_STATE, hasOperationMarker, logPathOf, mergeEvidenceIntoLog, renderExportMarkdown } from './evidence.mjs'
import { PROGRESS_PATH, plainText } from './progress.mjs'

export const PLAN_PATH = '全栈工程师学习计划/全栈竞赛长期冲刺总计划.md'
export const WRITEBACK_SCHEMA_VERSION = 1

export const WRITEBACK_STATE = {
  PREVIEW: 'preview',
  WRITING: 'writing',
  SYNCED: 'synced',
  PARTIAL: 'partial',
  FAILED: 'failed',
  ROLLED_BACK: 'rolled_back',
}

/** 写回服务在出错时抛出带 code 的错误；路由层据此映射 HTTP 状态。 */
export class WritebackError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'WritebackError'
    this.code = code
    this.details = details
  }
}

const OPERATION_ID = /^op-[a-z0-9]{6,20}-[0-9a-f]{6}$/

/**
 * 事务账本一次返回的条数上限。
 *
 * 为什么是 20：
 * - 与门面 `listEvidence()` 里「已同步记录只给最近 20 条」（learning/index.mjs:169）同一口径，
 *   界面并排看两个列表时数量级一致，不会出现一边全量一边截断的错觉；
 * - 本机是单人工具，一次写回固定 3 个目标文件，20 条足够核对最近十几次的逐步事实；
 * - 再早的历史并没有丢：每条事务都能按 operationId 单独读回
 *   （`GET /api/learning/evidence-transaction/:operationId`），账本只是入口不是归档。
 *   因此界面必须写明「还有更早的事务」，不能把这一列当成全部。
 */
export const TRANSACTION_LIST_CAP = 20

/** 提交与展示共用的写入顺序（日志 → 进度追踪 → 总计划日志索引）。 */
const WRITE_ORDER = ['log', 'progress', 'index']

/** 按真实写入顺序排一遍（不改动传入数组）；未知 kind 留在最前，与提交时的排序口径一致。 */
function stepsInWriteOrder(targets) {
  return [...(targets ?? [])].sort((a, b) => WRITE_ORDER.indexOf(a.kind) - WRITE_ORDER.indexOf(b.kind))
}

/** 证据条数：账本只报数量，正文与 evidenceId 都不出网关。 */
function evidenceCountOf(transaction) {
  return Array.isArray(transaction?.evidenceIds) ? transaction.evidenceIds.length : 0
}

/**
 * 事务记录 → 账本一行（浏览器可见视图）。
 *
 * `path` 再过一遍 scrubLocalPaths 属于兜底：日志文件名已剥掉 `\\ / :` 等保留字符
 * （evidence.mjs 的 logFileName），写入路径也只接受库内相对路径（vault-paths.mjs），
 * 合法记录里不可能出现盘符或 POSIX 根目录；真出现了就是数据被改过，那时更不能让它出门。
 * 也正因为这一步对合法路径是恒等变换，界面把 `path` 当作指纹表的键才安全。
 */
function toLedgerRow(transaction) {
  return {
    operationId: transaction.operationId,
    state: transaction.state,
    topic: scrubLocalPaths(transaction.topic ?? ''),
    at: transaction.at ?? null,
    createdAt: transaction.createdAt ?? null,
    syncedAt: transaction.syncedAt ?? null,
    rolledBackAt: transaction.rolledBackAt ?? null,
    message: scrubLocalPaths(transaction.result?.message ?? ''),
    evidenceCount: evidenceCountOf(transaction),
    targets: stepsInWriteOrder(transaction.targets).map((step) => ({
      kind: step.kind,
      path: scrubLocalPaths(step.path ?? ''),
      applied: step.applied === true,
    })),
  }
}


function safeSegment(value) {
  return String(value ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'unknown'
}

/**
 * 面向浏览器与事务日志的错误文本：抹掉**本机绝对路径**（盘符 / UNC / 常见 POSIX 根目录）。
 *
 * 文件系统错误的原文形如 `EPERM: operation not permitted, open 'E:\...\进度追踪.md'`，
 * 直接拼进消息就会把用户的资料库与数据目录位置发到前端。库内相对路径
 * （`全栈工程师学习计划/进度追踪.md`）是有效信息，不在抹除范围内；
 * 备份文件的绝对路径只留在事务记录里供回滚使用，不进响应体。
 */
const LOCAL_PATH_PATTERNS = [
  /[A-Za-z]:[\\/][^\s,;'"）)】]+/g,
  /\\\\[A-Za-z0-9.$_-]+\\[^\s,;'"）)】]*/g,
  /\/(?:Users|home|var|tmp|private|root|opt|usr|etc|srv|mnt)[\\/][^\s,;'"）)】]*/g,
]

export function scrubLocalPaths(text) {
  let value = String(text ?? '')
  for (const pattern of LOCAL_PATH_PATTERNS) value = value.replace(pattern, '（已隐去本机路径）')
  return value
}

function newOperationId() {
  return `op-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 日期字符串（YYYY-MM-DD）可直接按字典序比较。 */
function maxDate(...dates) {
  const valid = dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(String(date ?? '')))
  return valid.length > 0 ? valid.sort().at(-1) : null
}

/** 链接到日志的库内完整路径双链（不用无路径短链接，避免同名歧义）。 */
function logLink(at, topic) {
  const path = logPathOf(at, topic).replace(/\.md$/, '')
  return `[[${path}]]`
}

// ---------------------------------------------------------------------------
// 进度追踪的定向编辑：只改列出的字段，不重排、不清除历史。
// ---------------------------------------------------------------------------

/** 替换顶部说明行里的 `最近学习证据：<旧日期>`。 */
function replaceLatestEvidenceDate(text, oldDate, newDate) {
  const pattern = new RegExp(`(最近学习证据\\s*[：:]\\s*)${escapeRegExp(oldDate)}`)
  if (!pattern.test(text)) return null
  return text.replace(pattern, `$1${newDate}`)
}

/** 替换会话接续表里某一行的第二格。 */
function replaceHandoffRow(text, field, value) {
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim().startsWith('|')) continue
    const cells = line.split('|')
    // 拆分后 cells[0] 与 cells.at(-1) 是行首尾的空壳
    if (cells.length < 4) continue
    if (plainText(cells[1]) !== field) continue
    const next = [...cells]
    next[2] = ` ${value} `
    lines[index] = next.join('|')
    return lines.join('\n')
  }
  return null
}

/** 替换掌握矩阵里某个技能行的等级格。 */
function replaceMasteryLevel(text, skill, level) {
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim().startsWith('|')) continue
    const cells = line.split('|')
    if (cells.length < 5) continue
    if (plainText(cells[1]) !== skill) continue
    const next = [...cells]
    next[2] = ` ${level} `
    lines[index] = next.join('|')
    return lines.join('\n')
  }
  return null
}

/** 读取会话接续表当前值（用于冲突时展示逐字段差异）。 */
function handoffValue(text, field) {
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) continue
    const cells = line.split('|')
    if (cells.length < 4) continue
    if (plainText(cells[1]) === field) return plainText(cells[2])
  }
  return null
}

/** 读取掌握矩阵某技能的当前等级原文。 */
function masteryValue(text, skill) {
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) continue
    const cells = line.split('|')
    if (cells.length < 5) continue
    if (plainText(cells[1]) === skill) return plainText(cells[2])
  }
  return null
}

/** 顶部说明行里的「最近学习证据」日期。 */
function latestEvidenceDate(text) {
  const line = text.split('\n').find((value) => value.includes('最近学习证据'))
  const match = line ? /最近学习证据\s*[：:]\s*(\d{4}-\d{2}-\d{2})/.exec(plainText(line)) : null
  return match?.[1] ?? null
}

/**
 * 总计划 §0 索引的定位：找到 `### YYYY-MM` 标题，新行插在标题下一行（日期倒序 → 最新在前）。
 * 月份不存在时，在 §0 的说明行之后新建一个月份块。
 */
function locateIndexInsertion(text, month) {
  const lines = text.split('\n')
  const headingIndex = lines.findIndex((line) => new RegExp(`^###\\s+${escapeRegExp(month)}\\s*$`).test(line.trim()))
  if (headingIndex !== -1) return { index: headingIndex + 1, lines }
  const noteIndex = lines.findIndex((line) => line.startsWith('> 每日记录统一存放'))
  const sectionIndex = lines.findIndex((line) => line.trim() === '## 0. 学习日志索引')
  const anchor = noteIndex !== -1 ? noteIndex + 1 : sectionIndex !== -1 ? sectionIndex + 1 : -1
  if (anchor === -1) return null
  // 在说明行后插入空行 + 月份标题，再插入索引行
  lines.splice(anchor, 0, '', `### ${month}`)
  return { index: anchor + 2, lines }
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------
/**
 * 一条证据能否支撑掌握等级晋级（DATA-08）。
 * 总计划 §7.1：只有经过练习、输出或测试才能提升等级 —— 所以
 * AI 代跑、仅阅读、没有留下实际输出、或用到 L3/L4 提示的，都不算。
 * 服务端独立判定，不信任界面传来的 independent。
 */
export function promotableEvidence(record) {
  if (!record) return false
  if (record.ranBy !== 'learner') return false
  if (record.independent !== true) return false
  if (['L3', 'L4'].includes(record.hintLevel ?? '')) return false
  return String(record.actual ?? '').trim() !== ''
}

export function createWritebackService({ dataRoot, vaultRoot, evidenceStore, ownerStore }) {
  const txDir = join(dataRoot, 'learning', 'writeback')
  const backupDir = join(txDir, 'backups')

  function resolveRoot() {
    return resolveVaultRoot(vaultRoot ?? process.env.CODEWEAVE_VAULT_ROOT)
  }

  function requireRoot() {
    const resolved = resolveRoot()
    if (!resolved.ok) throw new WritebackError('vault_unavailable', `资料库根不可用：${resolved.reason}`)
    return resolved.root
  }

  async function requireOwner(userId) {
    const record = await ownerStore.read()
    if (!record.ownerUserId) throw new WritebackError('owner_unbound', '正式进度与写回未开放：资料库拥有者尚未绑定')
    if (record.ownerUserId !== userId) throw new WritebackError('forbidden', '只有资料库拥有者才能写回正式记录')
    return record
  }

  function txPathOf(operationId) {
    return join(txDir, `${safeSegment(operationId)}.json`)
  }

  async function readTransaction(operationId) {
    const path = txPathOf(operationId)
    if (!existsSync(path)) return null
    try {
      return JSON.parse(await readFile(path, 'utf8'))
    } catch {
      throw new WritebackError('transaction_corrupt', '写回事务记录损坏，已停止自动写入；请人工核对后处理')
    }
  }

  async function writeTransaction(transaction) {
    await mkdir(txDir, { recursive: true })
    const path = txPathOf(transaction.operationId)
    const temp = `${path}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(transaction, null, 2)}\n`, 'utf8')
    await rename(temp, path)
    return transaction
  }

  /** 先读当前文本与指纹；文件不存在时返回 null 指纹（用于「新建日志」）。 */
  async function readTarget(root, relPath) {
    let text = null
    try {
      text = await readVaultText(root, relPath)
    } catch (error) {
      if (!(error instanceof ContentError) || error.code !== 'source_not_found') throw error
    }
    return { text, hash: text === null ? null : sha256(text) }
  }

  /**
   * 备份目标文件原文。
   * - 用读+写而不是 copyFile：copyFile 会连**只读属性**一起复制到备份，
   *   导致同一操作重试时无法覆盖备份（EPERM），恢复流程会被卡住。
   * - 备份路径由 operationId 决定且已存在时直接复用：同一次操作的原始版本是固定的，
   *   重复复制既无意义又会引入新的失败点。
   */
  async function backupFile(root, relPath, operationId, index) {
    const { abs, existed } = resolveWritablePath(root, relPath)
    if (!existed) return null
    const dir = join(backupDir, safeSegment(operationId))
    await mkdir(dir, { recursive: true })
    const target = join(dir, `${index}-${safeSegment(relPath.split('/').at(-1))}.bak`)
    if (existsSync(target)) return target
    await writeFile(target, await readFile(abs))
    return target
  }

  /** 原子写库内文件：库内临时文件 + rename（同目录，避免跨卷）。失败时清理临时文件。 */
  async function writeVaultFile(root, relPath, text) {
    const { abs } = resolveWritablePath(root, relPath)
    await mkdir(dirname(abs), { recursive: true })
    const temp = `${abs}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`
    await writeFile(temp, normalizeText(text), 'utf8')
    try {
      await rename(temp, abs)
    } catch (error) {
      // 不留半写临时文件在用户笔记目录里。
      await rm(temp, { force: true }).catch(() => {})
      throw error
    }
  }

  async function loadEvidence(userId, evidenceIds) {
    const all = await evidenceStore.list(userId)
    const wanted = new Set(evidenceIds)
    const records = all.filter((record) => wanted.has(record.evidenceId))
    if (records.length !== wanted.size) {
      const missing = [...wanted].filter((id) => !records.some((record) => record.evidenceId === id))
      throw new WritebackError('evidence_not_found', `暂存证据不存在或不属于当前账户：${missing.join('、')}`)
    }
    const synced = records.filter((record) => record.state === EVIDENCE_STATE.SYNCED)
    if (synced.length > 0 && records.length === synced.length) {
      throw new WritebackError('already_synced', '这些证据已同步过；重复提交不会再次追加')
    }
    return records.filter((record) => record.state !== EVIDENCE_STATE.SYNCED)
  }

  /**
   * 计算本次写回的全部目标（不写盘）。
   * @returns {{ targets: object[], evidenceIds: string[], masteryBlocked: object[] }}
   */
  async function buildPlan(root, records, masteryUpdates) {
    // 证据按「日期 + 主题」分组：同一天同一主题合并到同一份日志，不同主题各写各的。
    const groups = new Map()
    for (const record of records) {
      const key = `${record.at}|${record.topic}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(record)
    }

    // 掌握等级只由「学习者本人、独立、未用 L3/L4 对照答案、且留下了实际输出」的证据支撑。
    // 逐条判定并取 every：批次里混进一条 AI 运行或抄答案的证据，整批都不晋级。
    const notPromotable = records.filter((record) => !promotableEvidence(record))
    const promotionCleared = records.length > 0 && notPromotable.length === 0

    const targets = []
    for (const group of groups.values()) {
      const first = group[0]
      const path = logPathOf(first.at, first.topic)
      const current = await readTarget(root, path)
      targets.push({
        path,
        kind: 'log',
        exists: current.hash !== null,
        expectedHash: current.hash,
        before: {
          exists: current.hash !== null,
          length: current.text?.length ?? 0,
          tail: current.text ? current.text.slice(-400) : '',
        },
        // 预览内容：真正追加时会重新读取当前文本再合并，避免展示与实际不一致。
        preview: mergeEvidenceIntoLog({
          existingText: current.text,
          records: group,
          operationId: 'PREVIEW',
        }),
        groupEvidenceIds: group.map((record) => record.evidenceId),
      })
    }

    // 进度追踪：只做列出的定向编辑。
    const progressCurrent = await readTarget(root, PROGRESS_PATH)
    const progressEdits = []
    if (progressCurrent.text !== null) {
      const text = progressCurrent.text
      const at = maxDate(...records.map((record) => record.at))
      const first = records[0]
      const stagePrefix = first.stage ? `${first.stage} ` : ''

      const evidenceDate = latestEvidenceDate(text)
      if (at && evidenceDate && at > evidenceDate) {
        progressEdits.push({ field: '最近学习证据', kind: 'evidence-date', before: evidenceDate, after: at })
      }

      const logField = '最近正式日志'
      const logBefore = handoffValue(text, logField)
      if (logBefore !== null) {
        const after = logLink(first.at, first.topic)
        if (logBefore !== after) progressEdits.push({ field: logField, kind: 'handoff', before: logBefore, after })
      }

      const topicBefore = handoffValue(text, '当前主题')
      if (topicBefore !== null) {
        const after = `${stagePrefix}${first.topic}`
        if (topicBefore !== after) progressEdits.push({ field: '当前主题', kind: 'handoff', before: topicBefore, after })
      }

      const pendingBefore = handoffValue(text, '当前需提交的证据')
      if (pendingBefore !== null) {
        const after = records.flatMap((record) => record.unfinished).length > 0
          ? records.flatMap((record) => record.unfinished).join('；')
          : `${first.at} 已提交证据，待复核`
        if (pendingBefore !== after) progressEdits.push({ field: '当前需提交的证据', kind: 'handoff', before: pendingBefore, after })
      }
    }

    const masteryBlocked = []
    const masteryEdits = []
    for (const update of masteryUpdates ?? []) {
      const skill = String(update?.skill ?? '').trim()
      const level = String(update?.level ?? '').trim()
      if (!skill || !/^\d+\s*级$/.test(level)) {
        masteryBlocked.push({ skill, level, reason: '技能名缺失或等级写法不是 `N 级`' })
        continue
      }
      if (!promotionCleared) {
        const why = notPromotable.length === 0
          ? '本次没有可支撑晋级的证据'
          : `本次证据中有 ${notPromotable.length} 条不是学习者独立产出（AI 运行、仅阅读、未写实际输出，或使用了 L3/L4 对照答案）：${notPromotable.map((record) => record.evidenceId).join('、')}`
        masteryBlocked.push({ skill, level, reason: `${why}，不提升等级` })
        continue
      }
      if (progressCurrent.text === null) {
        masteryBlocked.push({ skill, level, reason: '进度追踪不可读' })
        continue
      }
      const before = masteryValue(progressCurrent.text, skill)
      if (before === null) {
        masteryBlocked.push({ skill, level, reason: '进度追踪里没有这个技能行，需人工新增（不自动猜测归属）' })
        continue
      }
      if (before === level) continue
      masteryEdits.push({ field: skill, kind: 'mastery', before, after: level })
    }

    targets.push({
      path: PROGRESS_PATH,
      kind: 'progress',
      exists: progressCurrent.hash !== null,
      expectedHash: progressCurrent.hash,
      before: { edits: progressEdits, masteryEdits },
      preview: { edits: progressEdits, masteryBlocked },
    })

    // 总计划日志索引。
    const at = maxDate(...records.map((record) => record.at))
    const first = records[0]
    const indexCurrent = await readTarget(root, PLAN_PATH)
    const indexPreview = (() => {
      if (indexCurrent.text === null || !at) return { changed: false, reason: '总计划不可读' }
      const link = logLink(at, first.topic)
      if (indexCurrent.text.includes(link)) return { changed: false, reason: '索引里已存在当天日志链接' }
      const located = locateIndexInsertion(indexCurrent.text, at.slice(0, 7))
      if (!located) return { changed: false, reason: '总计划缺少 §0 学习日志索引小节，需人工补充后再同步' }
      const line = `- ${link} — ${first.stage ? `${first.stage} ` : ''}${first.topic}`
      return { changed: true, line, after: located.lines[located.index] ?? null }
    })()
    targets.push({
      path: PLAN_PATH,
      kind: 'index',
      exists: indexCurrent.hash !== null,
      expectedHash: indexCurrent.hash,
      before: { line: indexPreview?.line ?? null },
      preview: indexPreview,
    })

    return { targets, masteryBlocked, at, topic: first.topic }
  }

  /**
   * 预览：生成 operationId 与事务清单，返回将写入的日志小节、进度差异与冲突。
   * **不修改任何 Markdown，也不改证据状态。**
   */
  async function preview({ userId, evidenceIds, masteryUpdates }) {
    await requireOwner(userId)
    const root = requireRoot()
    if (!Array.isArray(evidenceIds) || evidenceIds.length === 0) {
      throw new WritebackError('no_evidence', '请先选择要写回的暂存证据')
    }
    const records = await loadEvidence(userId, evidenceIds)
    if (records.length === 0) throw new WritebackError('already_synced', '这些证据都已同步，没有可写回的内容')

    const plan = await buildPlan(root, records, masteryUpdates)
    const operationId = newOperationId()
    // 冲突预检：目标文件在预览时读到的指纹就是提交时要比对的基线。
    const conflicts = []
    for (const target of plan.targets) {
      if (target.kind === 'progress' && target.before.edits.length === 0 && target.before.masteryEdits.length === 0) {
        continue
      }
      if (!target.exists && target.kind !== 'log') {
        conflicts.push({ path: target.path, kind: target.kind, reason: 'source_not_found' })
      }
    }

    await writeTransaction({
      schemaVersion: WRITEBACK_SCHEMA_VERSION,
      operationId,
      userId,
      createdAt: new Date().toISOString(),
      state: WRITEBACK_STATE.PREVIEW,
      evidenceIds: records.map((record) => record.evidenceId),
      masteryUpdates: masteryUpdates ?? [],
      at: plan.at,
      topic: plan.topic,
      // 事务只保留步骤执行需要的信息；preview 只用于给用户看，不入事务。
      targets: plan.targets.map((target) => ({
        path: target.path,
        kind: target.kind,
        exists: target.exists,
        expectedHash: target.expectedHash,
        before: target.before,
        groupEvidenceIds: target.groupEvidenceIds ?? null,
        applied: false,
      })),
    })

    return {
      operationId,
      evidenceIds: records.map((record) => record.evidenceId),
      at: plan.at,
      topic: plan.topic,
      targets: plan.targets.map((target) => ({
        path: target.path,
        kind: target.kind,
        exists: target.exists,
        expectedHash: target.expectedHash,
        preview: target.preview,
      })),
      masteryBlocked: plan.masteryBlocked,
      conflicts,
      // 界面据此与原文一致地提示：预览不等于已同步，也不自动声称掌握。
      notices: [
        '预览不会修改任何资料库文件。',
        '写回顺序：学习日志 → 进度追踪 → 总计划日志索引。',
        '只有实际写入并复核后才显示「已同步」；掌握等级不会自动提升。',
      ],
    }
  }

  /**
   * 冲突详情：把预览时的字段值与当前文件的字段值逐项对照，不按 mtime 决胜。
   * 只列出**确实变了**的文件——指纹没变的文件不算冲突，避免把无关文件写进差异表里。
   */
  async function conflictDetails(root, transaction) {
    const files = []
    for (const step of transaction.targets) {
      const current = await readTarget(root, step.path)
      const baseline = step.preHash ?? step.expectedHash ?? null
      const hashChanged = baseline !== current.hash
      const fieldDiffs = []
      if (step.kind === 'log') {
        if (step.before.exists !== (current.hash !== null) || (current.hash !== null && current.text.length !== step.before.length)) {
          fieldDiffs.push({
            field: '日志文件',
            previewed: step.before.exists ? `已存在（${step.before.length} 字符）` : '不存在（将新建）',
            current: current.hash === null ? '不存在' : `已存在（${current.text.length} 字符）`,
          })
        }
      } else if (step.kind === 'progress') {
        const text = current.text ?? ''
        for (const edit of step.before.edits ?? []) {
          const now = edit.kind === 'evidence-date' ? latestEvidenceDate(text) : handoffValue(text, edit.field)
          if (now !== edit.before) fieldDiffs.push({ field: edit.field, previewed: edit.before, current: now ?? '（未找到该字段）' })
        }
        for (const edit of step.before.masteryEdits ?? []) {
          const now = masteryValue(text, edit.field)
          if (now !== edit.before) fieldDiffs.push({ field: `掌握矩阵 · ${edit.field}`, previewed: edit.before, current: now ?? '（未找到该技能行）' })
        }
      } else if (step.kind === 'index') {
        // 索引行的存在与否与文件是否被改是两件事：只有文件确实变了才算冲突。
        const text = current.text ?? ''
        if (hashChanged && step.before.line && !text.includes(step.before.line)) {
          fieldDiffs.push({
            field: '§0 日志索引',
            previewed: step.before.line,
            current: '当前文件中没有该行',
          })
        }
      }
      if (!hashChanged && fieldDiffs.length === 0) continue
      if (fieldDiffs.length === 0) {
        fieldDiffs.push({ field: '文件指纹', previewed: baseline ?? '（先前不存在）', current: current.hash ?? '（当前不存在）' })
      }
      files.push({ path: step.path, kind: step.kind, reason: 'third_party_change', fieldDiffs })
    }
    return { code: 'sync_conflict', files }
  }

  /** 把某一步的最终文本算出来（提交与恢复共用，保证同一 operationId 结果一致）。 */
  async function desiredText(root, step, transaction) {
    const current = await readTarget(root, step.path)
    if (step.kind === 'log') {
      if (current.text && hasOperationMarker(current.text, transaction.operationId)) {
        return { text: current.text, changed: false, current }
      }
      const records = await evidenceStore.list(transaction.userId)
      const group = records.filter((item) => step.groupEvidenceIds.includes(item.evidenceId))
      if (group.length === 0) throw new WritebackError('evidence_not_found', '事务引用的证据已不存在，已停止写入')
      return {
        text: mergeEvidenceIntoLog({ existingText: current.text, records: group, operationId: transaction.operationId }),
        changed: true,
        current,
      }
    }
    if (step.kind === 'progress') {
      if (current.text === null) throw new WritebackError('source_not_found', `目标文件不存在：${step.path}`)
      let text = current.text
      for (const edit of step.before.edits ?? []) {
        const next = edit.kind === 'evidence-date'
          ? replaceLatestEvidenceDate(text, edit.before, edit.after)
          : replaceHandoffRow(text, edit.field, edit.after)
        if (next === null) {
          throw new WritebackError('structure_unsupported', `进度追踪里找不到要更新的字段「${edit.field}」，需人工核对结构`)
        }
        text = next
      }
      for (const edit of step.before.masteryEdits ?? []) {
        const next = replaceMasteryLevel(text, edit.field, edit.after)
        if (next === null) {
          throw new WritebackError('structure_unsupported', `进度追踪里找不到技能行「${edit.field}」，需人工核对结构`)
        }
        text = next
      }
      return { text, changed: text !== current.text, current }
    }
    // index
    if (current.text === null) throw new WritebackError('source_not_found', `目标文件不存在：${step.path}`)
    const line = step.before.line
    if (!line || current.text.includes(line)) return { text: current.text, changed: false, current }
    const at = transaction.at
    const located = locateIndexInsertion(current.text, at.slice(0, 7))
    if (!located) throw new WritebackError('structure_unsupported', '总计划缺少 §0 学习日志索引小节，需人工补充后再同步')
    located.lines.splice(located.index, 0, line)
    return { text: `${located.lines.join('\n')}`, changed: true, current }
  }

  /**
   * 提交：按日志 → 进度 → 索引顺序写入。
   * - 幂等：同一 operationId 已 synced 直接返回成功，不重复追加；
   * - 恢复：事务未完成时按实际文件 hash 判断每一步是否已应用（= postHash）或未应用（= preHash），
   *   两者都不是说明有第三方改动 → 409 冲突，停止覆盖；
   * - 部分成功：日志已写入但后续失败时保留事务与备份，提示「日志已保存，进度待合并」。
   */
  async function commit({ userId, operationId, expectedHashes }) {
    await requireOwner(userId)
    const root = requireRoot()
    if (typeof operationId !== 'string' || !OPERATION_ID.test(operationId)) {
      throw new WritebackError('invalid_operation', 'operationId 格式非法')
    }
    const transaction = await readTransaction(operationId)
    if (!transaction) throw new WritebackError('operation_not_found', '找不到对应的预览事务；请重新预览')
    if (transaction.userId !== userId) throw new WritebackError('forbidden', '该写回事务属于其他账户')
    if (transaction.state === WRITEBACK_STATE.SYNCED) {
      return { synced: true, idempotent: true, operationId, targets: transaction.targets.map((step) => ({ path: step.path, kind: step.kind, applied: true })) }
    }
    if (transaction.state === WRITEBACK_STATE.ROLLED_BACK) {
      throw new WritebackError('operation_rolled_back', '该写回已回滚；请重新预览后再提交')
    }

    // 客户端回传的 expectedHash 必须与预览一致：不一致说明页面基于旧预览，直接拒绝。
    if (expectedHashes && typeof expectedHashes === 'object') {
      for (const step of transaction.targets) {
        if (Object.hasOwn(expectedHashes, step.path) && (expectedHashes[step.path] ?? null) !== step.expectedHash) {
          throw new WritebackError('stale_preview', '页面上的预览已过期，请重新预览后再提交', { path: step.path })
        }
      }
    }

    transaction.state = WRITEBACK_STATE.WRITING
    await writeTransaction(transaction)

    // 写入顺序与账本展示共用同一份事实（stepsInWriteOrder），界面不会看到另一套顺序。
    const steps = stepsInWriteOrder(transaction.targets)

    // -----------------------------------------------------------------------
    // 阶段 A：先读全部目标、算好要写的内容。冲突与结构问题都在**任何写入之前**暴露，
    // 这样「冲突不丢第三方内容」是结构上成立的，而不是靠写一半再回退。
    // -----------------------------------------------------------------------
    const planned = []
    for (const step of steps) {
      const current = await readTarget(root, step.path)
      // 已应用的步骤（断线重试/恢复）直接跳过，不重复追加。
      if (step.applied && step.postHash === current.hash) {
        planned.push({ step, mode: 'applied', current, desired: null })
        continue
      }
      if (step.applied && step.postHash !== current.hash) {
        transaction.state = WRITEBACK_STATE.PARTIAL
        transaction.result = { logSaved: false, message: '已写入的文件被第三方再次修改，已停止；请人工合并' }
        await writeTransaction(transaction)
        throw new WritebackError('sync_conflict', '已写入的文件被第三方再次修改，已停止自动写入', await conflictDetails(root, transaction))
      }
      const baseline = step.preHash ?? step.expectedHash ?? null
      if (current.hash !== baseline) {
        transaction.state = WRITEBACK_STATE.PARTIAL
        transaction.result = { logSaved: false, message: '目标文件已被其他编辑者修改，检测到冲突' }
        await writeTransaction(transaction)
        throw new WritebackError('sync_conflict', '目标文件已被其他编辑者修改，未写入任何内容', await conflictDetails(root, transaction))
      }
      let desired
      try {
        desired = await desiredText(root, step, transaction)
      } catch (error) {
        transaction.state = WRITEBACK_STATE.FAILED
        transaction.result = { logSaved: false, message: scrubLocalPaths(error?.message ?? '写回失败') }
        await writeTransaction(transaction)
        throw error
      }
      planned.push({ step, mode: desired.changed ? 'write' : 'skip', current, desired })
    }

    // -----------------------------------------------------------------------
    // 阶段 B：按「日志 → 进度 → 索引」顺序写入。写前再核对一次指纹，缩小竞态窗口。
    // 若在写入过程中被打断（含第三方并发修改），保留事务与备份，供恢复/回滚。
    // -----------------------------------------------------------------------
    let logSaved = false
    for (const item of planned) {
      const { step } = item
      if (item.mode === 'applied') {
        if (step.kind === 'log') logSaved = true
        continue
      }
      if (item.mode === 'skip') {
        step.applied = true
        step.preHash = item.current.hash
        step.postHash = item.current.hash
        step.appliedAt = new Date().toISOString()
        step.skipped = true
        if (step.kind === 'log') logSaved = true
        await writeTransaction(transaction)
        continue
      }

      const before = await readTarget(root, step.path)
      if (before.hash !== item.current.hash) {
        transaction.state = WRITEBACK_STATE.PARTIAL
        transaction.result = { logSaved, message: '写入前检测到第三方修改，已停止' }
        await writeTransaction(transaction)
        throw new WritebackError('sync_conflict', '写入前检测到第三方修改，已停止', {
          ...(await conflictDetails(root, transaction)),
          logSaved,
          progressPending: logSaved,
        })
      }

      const index = transaction.targets.indexOf(step)
      try {
        step.backupPath = await backupFile(root, step.path, operationId, index)
        await writeVaultFile(root, step.path, item.desired.text)
      } catch (error) {
        transaction.state = logSaved ? WRITEBACK_STATE.PARTIAL : WRITEBACK_STATE.FAILED
        transaction.result = { logSaved, message: scrubLocalPaths(`写入失败：${error?.message ?? error}`) }
        await writeTransaction(transaction)
        throw new WritebackError(
          logSaved ? 'progress_pending' : 'write_failed',
          scrubLocalPaths(
            logSaved
              ? `日志已保存，进度待合并：写入失败（${error?.message ?? error}）`
              : `写入失败，已保留备份：${error?.message ?? error}`,
          ),
          // 不带 backupPath：备份的绝对路径留在事务里，响应体只给库内相对路径。
          { path: step.path, logSaved, progressPending: logSaved },
        )
      }

      step.applied = true
      step.preHash = item.current.hash
      step.postHash = sha256(normalizeText(item.desired.text))
      step.appliedAt = new Date().toISOString()
      if (step.kind === 'log') logSaved = true
      await writeTransaction(transaction)
    }

    // 全部成功：才标 synced，并回写应用侧证据状态。
    transaction.state = WRITEBACK_STATE.SYNCED
    transaction.syncedAt = new Date().toISOString()
    transaction.result = { logSaved: true, message: '日志、进度与索引均已写入并复核' }
    await writeTransaction(transaction)
    await evidenceStore.updateRecords(userId, transaction.evidenceIds, {
      state: EVIDENCE_STATE.SYNCED,
      operationId,
      syncedAt: transaction.syncedAt,
      logPath: transaction.targets.find((step) => step.kind === 'log')?.path ?? null,
    })

    return {
      synced: true,
      idempotent: false,
      operationId,
      at: transaction.at,
      topic: transaction.topic,
      targets: transaction.targets.map((step) => ({ path: step.path, kind: step.kind, applied: step.applied, skipped: step.skipped === true })),
    }
  }

  /**
   * 回滚：用备份恢复，但**恢复前再次校验 hash**。
   * 若目标文件当前内容不是本次写入的结果（有第三方新改动），拒绝覆盖，转人工合并。
   */
  async function rollback({ userId, operationId }) {
    await requireOwner(userId)
    const root = requireRoot()
    const transaction = await readTransaction(operationId)
    if (!transaction) throw new WritebackError('operation_not_found', '找不到对应的写回事务')
    if (transaction.userId !== userId) throw new WritebackError('forbidden', '该写回事务属于其他账户')
    if (transaction.state === WRITEBACK_STATE.ROLLED_BACK) return { rolledBack: true, idempotent: true, targets: [] }

    const blockers = []
    for (const step of transaction.targets) {
      if (!step.applied) continue
      const current = await readTarget(root, step.path)
      if (step.postHash !== current.hash) {
        blockers.push({ path: step.path, kind: step.kind, reason: '第三方新改动', currentHash: current.hash, postHash: step.postHash })
      }
      if (!step.backupPath || !existsSync(step.backupPath)) {
        // 新建的文件没有备份：回滚即删除；同样要确认当前内容仍是本次写入结果。
        if (step.expectedHash !== null) blockers.push({ path: step.path, kind: step.kind, reason: '缺少备份文件' })
      }
    }
    if (blockers.length > 0) {
      throw new WritebackError('rollback_blocked', '检测到第三方新改动或备份缺失，已停止回滚；请人工合并', { blockers })
    }

    const restored = []
    for (const step of [...transaction.targets].reverse()) {
      if (!step.applied) continue
      if (step.expectedHash === null) {
        // 本次新建的文件：回滚 = 移除（用 rename 到备份目录，保留可追溯副本）。
        const { abs } = resolveWritablePath(root, step.path)
        if (existsSync(abs)) {
          const dir = join(backupDir, safeSegment(operationId))
          await mkdir(dir, { recursive: true })
          await rename(abs, join(dir, `removed-${safeSegment(step.path.split('/').at(-1))}`))
        }
        restored.push({ path: step.path, kind: step.kind, action: 'removed' })
        continue
      }
      if (!step.backupPath) continue
      await writeVaultFile(root, step.path, await readFile(step.backupPath, 'utf8'))
      restored.push({ path: step.path, kind: step.kind, action: 'restored' })
    }

    transaction.state = WRITEBACK_STATE.ROLLED_BACK
    transaction.rolledBackAt = new Date().toISOString()
    await writeTransaction(transaction)
    await evidenceStore.updateRecords(userId, transaction.evidenceIds, {
      state: EVIDENCE_STATE.PENDING,
      operationId: null,
      syncedAt: null,
      logPath: null,
    })
    return { rolledBack: true, idempotent: false, operationId, targets: restored }
  }

  /**
   * 导出待保存 Markdown：未授权写回或离线时给用户拿走。
   * 只读应用侧暂存证据，不读也不写资料库。
   */
  async function exportMarkdown({ userId, evidenceIds }) {
    const all = await evidenceStore.list(userId)
    const wanted = new Set(evidenceIds ?? all.map((record) => record.evidenceId))
    const records = all.filter((record) => wanted.has(record.evidenceId))
    if (records.length === 0) throw new WritebackError('no_evidence', '没有可导出的暂存证据')
    const first = records[0]
    return {
      markdown: renderExportMarkdown(records, { logPath: logPathOf(first.at, first.topic) }),
      evidenceIds: records.map((record) => record.evidenceId),
      logPath: logPathOf(first.at, first.topic),
    }
  }

  /**
   * 读取事务（供界面显示「日志已保存，进度待合并」等状态与恢复入口）。
   *
   * 每一步都按**真实写入顺序**给出，并带上「计划 vs 实际」的可核对字段：
   * `appliedAt` 是何时落盘的、`skipped` 是本来无需改动、`backupPresent` 与 `createdNew`
   * 决定回滚能不能还原这一步（有备份=用备份覆盖；本次新建=回滚即移除；
   * 连备份都没有=这一步在写之前就失败了，回滚无从恢复）。
   * `backupPath` 只有服务端回滚时要用，绝不出网关；`expectedHash` 是预览基线，
   * 界面重新载入后仍要带着它重试补齐（挂账⑤：不靠关闭校验把流程走通）。
   */
  async function transactionStatus({ userId, operationId }) {
    const transaction = await readTransaction(operationId)
    if (!transaction) throw new WritebackError('operation_not_found', '找不到对应的写回事务')
    if (transaction.userId !== userId) throw new WritebackError('forbidden', '该写回事务属于其他账户')
    return {
      operationId: transaction.operationId,
      state: transaction.state,
      at: transaction.at ?? null,
      topic: scrubLocalPaths(transaction.topic ?? ''),
      createdAt: transaction.createdAt ?? null,
      syncedAt: transaction.syncedAt ?? null,
      rolledBackAt: transaction.rolledBackAt ?? null,
      logSaved: transaction.result?.logSaved ?? false,
      message: scrubLocalPaths(transaction.result?.message ?? ''),
      evidenceCount: evidenceCountOf(transaction),
      targets: stepsInWriteOrder(transaction.targets).map((step) => ({
        path: scrubLocalPaths(step.path ?? ''),
        kind: step.kind,
        applied: step.applied === true,
        appliedAt: step.appliedAt ?? null,
        skipped: step.skipped === true,
        backupPresent: Boolean(step.backupPath),
        createdNew: (step.expectedHash ?? null) === null,
        expectedHash: step.expectedHash ?? null,
      })),
    }
  }

  /**
   * 事务账本（挂账 #35）：只读列出**当前用户**留在磁盘上的事务，新→旧，最多 TRANSACTION_LIST_CAP 条。
   *
   * 为什么要它：`transactionStatus` 要求先知道 operationId，而 operationId 此前只活在
   * React 状态里——刷新一次界面就再也说不出「刚才那次写回做了什么」。这里以磁盘上的
   * 事务记录为唯一事实来源，界面的部分成功横幅与逐步明细都能在读回后复原。
   *
   * 出网关的字段是筛过的：状态、主题、日期、证据条数、每一步的 kind/库内相对路径/是否已应用，
   * 加上 result.message（同样只回显相对路径，见 scrubLocalPaths 的说明）。
   * 备份绝对路径、文件指纹、证据正文、`before` 里的日志原文片段一律不带。
   * 单条记录读不出来时不整列失败：跳过并在 `unreadable` 里如实计数，界面据此说明。
   */
  async function listTransactions({ userId }) {
    await requireOwner(userId)
    let names
    try {
      names = await readdir(txDir)
    } catch (error) {
      // 一次都没写回过时目录还不存在，那是正常空态；其余读失败不能压成「没有事务」。
      if (error?.code === 'ENOENT') return { transactions: [], total: 0, unreadable: 0, capped: TRANSACTION_LIST_CAP }
      throw new WritebackError('transactions_unreadable', `写回事务记录读取失败：${scrubLocalPaths(error?.message ?? error)}`)
    }
    const files = names.filter((name) => name.endsWith('.json')).sort()
    const rows = []
    let unreadable = 0
    for (const name of files) {
      let transaction
      try {
        transaction = JSON.parse(await readFile(join(txDir, name), 'utf8'))
      } catch {
        unreadable += 1
        continue
      }
      // 事务文件名里的 operationId 已经过 safeSegment，不含账户信息；归属只认记录体。
      if (!transaction || transaction.userId !== userId) continue
      if (typeof transaction.operationId !== 'string' || !OPERATION_ID.test(transaction.operationId)) continue
      rows.push(toLedgerRow(transaction))
    }
    // 新→旧：记录时间相同（同一秒内的两次预览）时按 operationId 兜底，
    // operationId 中段是生成时刻的 base36，字典序即时间序。
    rows.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')) || b.operationId.localeCompare(a.operationId))
    return {
      transactions: rows.slice(0, TRANSACTION_LIST_CAP),
      total: rows.length,
      unreadable,
      capped: TRANSACTION_LIST_CAP,
    }
  }

  return { preview, commit, rollback, exportMarkdown, transactionStatus, listTransactions, readTransaction, txDir }
}