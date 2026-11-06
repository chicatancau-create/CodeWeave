/**
 * 学习证据暂存（LINK-09，02 号方案 §7 写回 + §4 正式学习事实规则）。
 *
 * 边界：
 * - 证据**先落在应用数据目录**（按账户隔离），标 `pending`；此时**不触碰资料库**，
 *   也不改任何正式进度。「应用本地保存 ≠ 已写回资料库」。
 * - 暂存记录包含方案要求的候选字段：内容/练习/快照 ID、时间、预期与实际结果、
 *   谁运行、是否独立、提示等级、产物引用、未完成项。
 * - 校验只做**能证伪**的判断：AI 运行不能标成「学习者独立完成」；
 *   L3/L4 提示下的作答不构成独立证据。宁可拒绝，不写一条不实的证据。
 * - 本模块不渲染正文、不写资料库；渲染与写回见 writeback.mjs。
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export const EVIDENCE_SCHEMA_VERSION = 1

export const EVIDENCE_STATE = {
  PENDING: 'pending',
  SYNCED: 'synced',
  PARTIAL: 'partial',
}

/** 谁实际运行了这段代码：不是「谁提交的」。 */
export const RAN_BY = {
  LEARNER: 'learner',
  ASSISTANT: 'ai_assistant',
  UNKNOWN: 'unknown',
}

/** 提示等级（与总计划 §7.3 分级提示一致）。 */
export const HINT_LEVELS = ['L1', 'L2', 'L3', 'L4']

export const HINT_LEVEL_NAMES = {
  L1: 'L1 方向提示',
  L2: 'L2 思路提示',
  L3: 'L3 关键步骤',
  L4: 'L4 对照答案',
}

export const RAN_BY_NAMES = {
  [RAN_BY.LEARNER]: '学习者本人',
  [RAN_BY.ASSISTANT]: 'AI 助手',
  [RAN_BY.UNKNOWN]: '未说明',
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAX_TEXT = 4000
const MAX_LIST_ITEM = 300
const MAX_LIST = 20

/** 账户 ID 落成文件名：只保留安全字符，避免路径穿越或非法文件名。 */
function safeSegment(value) {
  return String(value ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'unknown'
}

function str(value, limit = MAX_TEXT) {
  return String(value ?? '').trim().slice(0, limit)
}

function strList(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => str(item, MAX_LIST_ITEM))
    .filter(Boolean)
    .slice(0, MAX_LIST)
}

/**
 * 校验并规范化一条候选证据。
 * @returns {{ ok: true, value: object } | { ok: false, code: string, message: string }}
 */
export function validateEvidenceInput(input, { defaultDate } = {}) {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, code: 'invalid_evidence', message: '证据必须是对象' }
  }
  const at = str(input.at ?? defaultDate, 10)
  if (!DATE_PATTERN.test(at)) {
    return { ok: false, code: 'invalid_evidence', message: '学习日期必须是 YYYY-MM-DD' }
  }
  const topic = str(input.topic, 60).replace(/[\r\n]+/g, ' ')
  if (!topic) return { ok: false, code: 'invalid_evidence', message: '缺少学习主题' }
  const stage = str(input.stage, 16) || null
  const contentId = str(input.contentId, 96) || null
  const exerciseId = str(input.exerciseId, 96) || null
  const bundleId = str(input.bundleId, 96) || null
  const expected = str(input.expected)
  const actual = str(input.actual)
  const ranBy = Object.values(RAN_BY).includes(input.ranBy) ? input.ranBy : RAN_BY.UNKNOWN
  const hintLevel = HINT_LEVELS.includes(input.hintLevel) ? input.hintLevel : null
  const independentRequested = input.independent === true

  // 拒绝在服务端也无法成立的说法：宁可让用户改，不写一条不实的「独立掌握」。
  if (independentRequested && ranBy === RAN_BY.ASSISTANT) {
    return { ok: false, code: 'invalid_evidence', message: 'AI 助手运行的记录不能标记为「学习者独立完成」' }
  }
  if (independentRequested && (hintLevel === 'L3' || hintLevel === 'L4')) {
    return { ok: false, code: 'invalid_evidence', message: `${HINT_LEVEL_NAMES[hintLevel]}下的作答不能标记为「独立完成」` }
  }
  if (independentRequested && ranBy !== RAN_BY.LEARNER) {
    return { ok: false, code: 'invalid_evidence', message: '未说明运行者时不能标记为「学习者独立完成」' }
  }

  const artifacts = strList(input.artifacts)
  if (!expected && !actual && artifacts.length === 0) {
    return { ok: false, code: 'invalid_evidence', message: '证据至少需要预期结果、实际结果或产物引用之一' }
  }

  return {
    ok: true,
    value: {
      at,
      topic,
      stage,
      contentId,
      exerciseId,
      bundleId,
      expected,
      actual,
      ranBy,
      independent: independentRequested,
      hintLevel,
      artifacts,
      unfinished: strList(input.unfinished),
      notes: str(input.notes, 1000),
    },
  }
}

/** 文件名安全化：Obsidian 支持中文文件名，但 Windows 保留字符必须替换。 */
export function logFileName(at, topic) {
  const safeTopic = topic.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim() || '学习记录'
  return `${at}-${safeTopic}.md`
}

export function logDirOf(at) {
  return `全栈工程师学习计划/学习日志/${at.slice(0, 7)}`
}

export function logPathOf(at, topic) {
  return `${logDirOf(at)}/${logFileName(at, topic)}`
}

/** 行内文本进表格单元格：转义竖线并压平换行。 */
function cell(text) {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim()
}

/** 用足够长的围栏包裹可能含反引号的内容，避免提前闭合代码块。 */
function fenced(text) {
  const body = String(text ?? '').replace(/\s+$/, '')
  const longest = (body.match(/`{3,}/g) ?? []).reduce((max, run) => Math.max(max, run.length), 2)
  const fence = '`'.repeat(longest + 1)
  return `${fence}\n${body}\n${fence}`
}

/**
 * 渲染一条证据的日志小节。幂等标记由 mergeEvidenceIntoLog 统一写在整块末尾。
 */
export function renderEvidenceSection(record) {
  const rows = [
    ['学习日期', record.at],
    ['所属阶段', record.stage ?? '未记录'],
    ['内容 ID', record.contentId ?? '未记录'],
    ['练习 ID', record.exerciseId ?? '未记录'],
    ['内容快照', record.bundleId ?? '未记录'],
    ['运行者', RAN_BY_NAMES[record.ranBy] ?? '未说明'],
    ['独立完成', record.independent ? '是（学习者声明）' : '否'],
    ['提示等级', record.hintLevel ? HINT_LEVEL_NAMES[record.hintLevel] : '未使用或未记录'],
    ['证据产物', record.artifacts.length > 0 ? record.artifacts.join('；') : '未记录'],
  ]
  const lines = [
    `## 学习证据 · ${record.topic}`,
    '',
    '| 项目 | 内容 |',
    '|---|---|',
    ...rows.map(([key, value]) => `| ${cell(key)} | ${cell(value)} |`),
    '',
  ]
  if (record.expected) lines.push('**预期结果**', '', fenced(record.expected), '')
  if (record.actual) lines.push('**实际结果**', '', fenced(record.actual), '')
  if (record.unfinished.length > 0) {
    lines.push('**未完成项**', '', ...record.unfinished.map((item) => `- ${item}`), '')
  }
  if (record.notes) lines.push('**备注**', '', record.notes, '')
  return `${lines.join('\n')}\n`
}

/** 新建日志文件时的文件头：说明来源，并声明等级不由本记录自动提升。 */
export function renderLogFileHeader(record) {
  return [
    `# ${record.at} 学习日志 · ${record.topic}`,
    '',
    '> 由 CodeWeave **确认式写回**创建：只追加证据，不覆盖既有笔记。',
    '> 本文件记录的是作答证据；掌握等级由正式流程判定，**不由本记录自动提升**。',
    '',
  ].join('\n')
}

/** 断言日志文本里是否已有该 operationId 的标记（断线重试去重的依据）。 */
export function hasOperationMarker(text, operationId) {
  return String(text ?? '').includes(`cw-evidence:${operationId}`)
}

/**
 * 把一组证据合入日志文本。
 * - 文件不存在 → 建头 + 小节；
 * - 已存在 → 只追加（同日追加保留前文，不重排、不清除历史）；
 * - `<!-- cw-evidence:<operationId> -->` 写在整块末尾：不渲染、可检索、据此去重。
 */
export function mergeEvidenceIntoLog({ existingText, records, operationId }) {
  const list = Array.isArray(records) ? records : [records]
  const body = [list.map((record) => renderEvidenceSection(record)).join('\n---\n\n'), `<!-- cw-evidence:${operationId} -->`].join('\n')
  if (!existingText) {
    return `${renderLogFileHeader(list[0])}\n---\n\n${body}\n`
  }
  const base = existingText.endsWith('\n') ? existingText : `${existingText}\n`
  return `${base}\n---\n\n${body}\n`
}

/** 导出待保存 Markdown：未授权写回或离线时给用户拿走，内容与写回一致。 */
export function renderExportMarkdown(records, { logPath } = {}) {
  const header = [
    '# CodeWeave 待保存学习证据（未写回资料库）',
    '',
    '> 本文件是**导出备份**，不代表已同步。只有实际写入资料库并复核后才算同步完成。',
    logPath ? `> 目标日志路径：\`${logPath}\`` : '',
    '',
  ]
    .filter(Boolean)
    .join('\n')
  const body = records.map((record) => renderEvidenceSection(record)).join('\n---\n\n')
  return `${header}\n${body}`
}

// ---------------------------------------------------------------------------
// 暂存存储：按账户一个文件，整体读、原子写。
// ---------------------------------------------------------------------------
export function createEvidenceStore({ dataRoot }) {
  const root = join(dataRoot, 'learning', 'evidence')

  function filePathOf(userId) {
    return join(root, `${safeSegment(userId)}.json`)
  }

  async function readAll(userId) {
    const filePath = filePathOf(userId)
    if (!existsSync(filePath)) return []
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8'))
      if (!Array.isArray(parsed?.records)) return []
      return parsed.records
    } catch {
      // 损坏的暂存文件不静默当空：由调用方看到 corrupt 标记。
      throw Object.assign(new Error('证据暂存文件损坏'), { code: 'evidence_store_corrupt' })
    }
  }

  async function writeAll(userId, records) {
    await mkdir(root, { recursive: true })
    const filePath = filePathOf(userId)
    const temp = `${filePath}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify({ schemaVersion: EVIDENCE_SCHEMA_VERSION, records }, null, 2)}\n`, 'utf8')
    await rename(temp, filePath)
    return records
  }

  async function stage(userId, value) {
    const records = await readAll(userId)
    const record = {
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      evidenceId: `ev-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
      userId,
      state: EVIDENCE_STATE.PENDING,
      createdAt: new Date().toISOString(),
      operationId: null,
      syncedAt: null,
      logPath: null,
      ...value,
    }
    records.push(record)
    await writeAll(userId, records)
    return record
  }

  async function list(userId) {
    return readAll(userId)
  }

  async function get(userId, evidenceId) {
    return (await readAll(userId)).find((record) => record.evidenceId === evidenceId) ?? null
  }

  async function remove(userId, evidenceId) {
    const records = await readAll(userId)
    const next = records.filter((record) => record.evidenceId !== evidenceId)
    if (next.length === records.length) return { removed: false }
    await writeAll(userId, next)
    return { removed: true }
  }

  /** 更新指定证据的状态（写回成功/部分成功后回写应用侧状态）。 */
  async function updateRecords(userId, evidenceIds, patch) {
    const records = await readAll(userId)
    const target = new Set(evidenceIds)
    const next = records.map((record) => (target.has(record.evidenceId) ? { ...record, ...patch } : record))
    await writeAll(userId, next)
    return next
  }

  return { stage, list, get, remove, updateRecords, filePathOf }
}