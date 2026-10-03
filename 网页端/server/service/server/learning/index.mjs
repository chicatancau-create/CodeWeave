/**
 * 学习事实服务门面（LINK-08）。
 *
 * 边界（方案 §9、§10.1）：
 * - 正式进度只对资料库拥有者开放；其他账户即使能看到教材也拿不到进度与日志。
 * - 正式进度**绝不混入课程包、目录或检索结果**，只在这一个接口里返回。
 * - LINK-08 只读投影不写任何笔记；LINK-09 的确认式写回是**独立的一次显式操作**：
 *   证据先暂存（pending）→ 预览 → 用户确认提交 → 才写日志/进度/索引。
 *   不预览、不确认，就不会有写入。
 */
import { ContentError, sha256 } from '../content/markdown.mjs'
import { readVaultText, resolveVaultRoot } from '../content/vault-paths.mjs'
import { EVIDENCE_STATE, createEvidenceStore, validateEvidenceInput } from './evidence.mjs'
import { createOwnerStore } from './owner.mjs'
import { PROGRESS_PATH, PROGRESS_STATUS, parseProgress } from './progress.mjs'
import { createWritebackService } from './writeback.mjs'

export { PROGRESS_PATH, PROGRESS_STATUS } from './progress.mjs'
export { EVIDENCE_STATE, HINT_LEVEL_NAMES, RAN_BY, RAN_BY_NAMES } from './evidence.mjs'

/** 本地当天日期（YYYY-MM-DD）：证据默认落在用户所在时区的今天。 */
function localToday(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function createLearningService({ dataRoot, vaultRoot } = {}) {
  const ownerStore = createOwnerStore({ dataRoot })
  const evidenceStore = createEvidenceStore({ dataRoot })
  const writeback = createWritebackService({ dataRoot, vaultRoot, evidenceStore, ownerStore })
  /** 按文件 hash 缓存解析结果：内容没变就不重复解析，变了立即失效。 */
  let cache = null

  function resolveRoot() {
    return resolveVaultRoot(vaultRoot ?? process.env.CODEWEAVE_VAULT_ROOT)
  }

  async function readVaultId() {
    const resolved = resolveRoot()
    if (!resolved.ok) return null
    try {
      const raw = await readVaultText(resolved.root, 'CodeWeave/content-manifest.json')
      return JSON.parse(raw)?.vaultId ?? null
    } catch {
      return null
    }
  }

  /** 读取并解析进度追踪；文件缺失或结构不符都返回可展示的降级结果，不抛错。 */
  async function loadProgress() {
    const resolved = resolveRoot()
    if (!resolved.ok) {
      return { status: PROGRESS_STATUS.MISSING, reason: `资料库根不可用（${resolved.reason}）`, projection: null }
    }
    let text
    try {
      text = await readVaultText(resolved.root, PROGRESS_PATH)
    } catch (error) {
      const code = error instanceof ContentError ? error.code : 'read_failed'
      return { status: PROGRESS_STATUS.MISSING, reason: code === 'source_not_found' ? '进度追踪文件不存在' : `进度追踪不可读（${code}）`, projection: null }
    }
    const hash = sha256(text)
    if (cache?.hash === hash) return { status: cache.projection.status, reason: '', projection: cache.projection }
    const projection = parseProgress(text)
    cache = { hash, projection }
    return { status: projection.status, reason: '', projection }
  }

  /** 绑定 / 可见范围的状态视图（不含任何进度内容）。 */
  async function status(userId) {
    const record = await ownerStore.read()
    const vaultId = await readVaultId()
    const access = ownerStore.contentAccess(record, userId)
    const isOwner = Boolean(userId) && record.ownerUserId === userId
    return {
      bound: Boolean(record.ownerUserId),
      isOwner,
      vaultId,
      /** 绑定记录里的 vaultId 与当前资料库是否一致：不一致说明换了资料库 */
      vaultMatches: record.vaultId === null || record.vaultId === vaultId,
      publicContent: record.publicContent === true,
      contentAccess: { allowed: access.allowed, reason: access.reason },
      progressAccess: isOwner,
      boundAt: record.boundAt,
      recordCorrupt: record.corrupt === true,
      notice: record.corrupt
        ? '绑定记录损坏，已按未绑定处理；未覆盖原文件。'
        : !record.ownerUserId
          ? '资料库拥有者尚未绑定：教材对已登录账户开放，但正式进度不对任何账户开放。'
          : access.reason === 'vault_private'
            ? '资料库为私人：该账户未被授权查看教材与正式进度。'
            : access.reason === 'public_content'
              ? '教材已放开给其他账户（正式进度仍仅拥有者可见）。'
              : '资料库已绑定拥有者。',
    }
  }

  async function bind(userId) {
    const vaultId = await readVaultId()
    const record = await ownerStore.bind(userId, vaultId)
    return { bound: true, isOwner: true, vaultId: record.vaultId, publicContent: record.publicContent }
  }

  async function unbind(userId) {
    const record = await ownerStore.unbind(userId)
    return { bound: false, isOwner: false, vaultId: record.vaultId, publicContent: false }
  }

  async function setVisibility(userId, publicContent) {
    const record = await ownerStore.setVisibility(userId, publicContent)
    return { bound: true, isOwner: true, vaultId: record.vaultId, publicContent: record.publicContent }
  }

  /**
   * 正式进度投影：**仅拥有者**。
   * 返回值同时带上降级状态与被跳过/未适配的块，界面据此显示「结构待适配」。
   */
  async function vaultProgress(userId) {
    const record = await ownerStore.read()
    if (!record.ownerUserId) {
      return { ok: false, code: 'owner_unbound', message: '正式进度未开放：资料库拥有者尚未绑定' }
    }
    if (record.ownerUserId !== userId) {
      return { ok: false, code: 'forbidden', message: '正式进度只对资料库拥有者可见' }
    }
    const loaded = await loadProgress()
    if (!loaded.projection) {
      return { ok: false, code: 'progress_unavailable', message: loaded.reason || '进度追踪不可用' }
    }
    return { ok: true, data: loaded.projection }
  }

  /** 内容接口的准入判定（未绑定=开放；已绑定=仅拥有者或公开教材）。 */
  async function contentAccess(userId) {
    const record = await ownerStore.read()
    return ownerStore.contentAccess(record, userId)
  }

  // -------------------------------------------------------------------------
  // LINK-09：证据暂存 → 预览 → 确认式写回
  // -------------------------------------------------------------------------

  /** 只对拥有者开放的写回操作统一鉴权。 */
  async function requireOwner(userId) {
    const record = await ownerStore.read()
    if (!record.ownerUserId) {
      return { ok: false, code: 'owner_unbound', message: '写回未开放：资料库拥有者尚未绑定' }
    }
    if (record.ownerUserId !== userId) {
      return { ok: false, code: 'forbidden', message: '只有资料库拥有者才能提交学习证据与写回' }
    }
    return { ok: true }
  }

  /** 步骤 1：暂存证据，标 pending。**不触碰资料库**。 */
  async function stageEvidence(userId, input) {
    const checked = validateEvidenceInput(input, { defaultDate: localToday() })
    if (!checked.ok) return { ok: false, code: checked.code, message: checked.message }
    const record = await evidenceStore.stage(userId, checked.value)
    return { ok: true, data: record }
  }

  async function listEvidence(userId) {
    const records = await evidenceStore.list(userId)
    return {
      ok: true,
      data: {
        pending: records.filter((record) => record.state !== EVIDENCE_STATE.SYNCED),
        synced: records.filter((record) => record.state === EVIDENCE_STATE.SYNCED).slice(-20),
      },
    }
  }

  async function removeEvidence(userId, evidenceId) {
    const target = await evidenceStore.get(userId, evidenceId)
    if (!target) return { ok: false, code: 'evidence_not_found', message: '暂存证据不存在' }
    if (target.state === EVIDENCE_STATE.SYNCED) {
      return { ok: false, code: 'already_synced', message: '已同步的证据不能删除；如需撤销请使用回滚' }
    }
    await evidenceStore.remove(userId, evidenceId)
    return { ok: true, data: { removed: true } }
  }

  /** 步骤 2：预览（只读，不修改 Markdown）。 */
  async function previewEvidence(userId, { evidenceIds, masteryUpdates } = {}) {
    const authorized = await requireOwner(userId)
    if (!authorized.ok) return authorized
    try {
      return { ok: true, data: await writeback.preview({ userId, evidenceIds, masteryUpdates }) }
    } catch (error) {
      return { ok: false, code: error?.code ?? 'preview_failed', message: error?.message ?? '预览失败', details: error?.details }
    }
  }

  /** 步骤 3：确认后提交（按日志 → 进度 → 索引顺序写入）。 */
  async function commitEvidence(userId, { operationId, expectedHashes } = {}) {
    const authorized = await requireOwner(userId)
    if (!authorized.ok) return authorized
    try {
      return { ok: true, data: await writeback.commit({ userId, operationId, expectedHashes }) }
    } catch (error) {
      return { ok: false, code: error?.code ?? 'commit_failed', message: error?.message ?? '写回失败', details: error?.details }
    }
  }

  /** 回滚：恢复前再次校验 hash；有第三方新改动则拒绝覆盖。 */
  async function rollbackEvidence(userId, operationId) {
    const authorized = await requireOwner(userId)
    if (!authorized.ok) return authorized
    try {
      return { ok: true, data: await writeback.rollback({ userId, operationId }) }
    } catch (error) {
      return { ok: false, code: error?.code ?? 'rollback_failed', message: error?.message ?? '回滚失败', details: error?.details }
    }
  }

  /** 未授权写回或离线时导出待保存 Markdown（只读应用侧暂存，不读资料库）。 */
  async function exportEvidence(userId, { evidenceIds } = {}) {
    try {
      return { ok: true, data: await writeback.exportMarkdown({ userId, evidenceIds }) }
    } catch (error) {
      return { ok: false, code: error?.code ?? 'export_failed', message: error?.message ?? '导出失败' }
    }
  }

  async function evidenceTransaction(userId, operationId) {
    const authorized = await requireOwner(userId)
    if (!authorized.ok) return authorized
    try {
      return { ok: true, data: await writeback.transactionStatus({ userId, operationId }) }
    } catch (error) {
      return { ok: false, code: error?.code ?? 'transaction_not_found', message: error?.message ?? '事务不存在' }
    }
  }

  /**
   * 事务账本（挂账 #35）：只读列出拥有者的写回事务，供界面在刷新后仍能查明细与回滚。
   * 鉴权与其余写回端点走同一道闸门（门面 + 服务各一次）；读不出记录是「这一次没读到」，
   * 不当成「没有事务」（§11.2）。
   */
  async function evidenceTransactions(userId) {
    const authorized = await requireOwner(userId)
    if (!authorized.ok) return authorized
    try {
      return { ok: true, data: await writeback.listTransactions({ userId }) }
    } catch (error) {
      return {
        ok: false,
        code: error?.code ?? 'transactions_unreadable',
        message: error?.message ?? '写回事务记录读取失败',
        details: error?.details,
      }
    }
  }

  return {
    status,
    bind,
    unbind,
    setVisibility,
    vaultProgress,
    contentAccess,
    loadProgress,
    ownerStore,
    stageEvidence,
    listEvidence,
    removeEvidence,
    previewEvidence,
    commitEvidence,
    rollbackEvidence,
    exportEvidence,
    evidenceTransaction,
    evidenceTransactions,
  }
}