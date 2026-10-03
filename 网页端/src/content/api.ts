/**
 * 内容 API 客户端（LINK-05；LINK-09 增加确认式写回）。
 *
 * 约束：
 * - 只调用同源 /api，不接受调用方传入任意路径或资料库根；
 * - 401 表示资料库内容需要登录，界面必须显示明确空态而不是重试风暴；
 * - 失败时保留调用方已有草稿：本模块不触碰任何本地存储；
 * - 对外返回的错误文本一律先抹掉本机绝对路径（`redactAbsolutePaths`）。
 */
import type {
  ContentSnapshot,
  ContentStatusResponse,
  EvidenceInput,
  EvidenceQueue,
  EvidenceExportResult,
  LearningStatus,
  SnapshotExercise,
  SnapshotLesson,
  StagedEvidence,
  VaultProgress,
  WritebackCommitResult,
  WritebackPreview,
} from './types'

/** 失败结果里的 details 是结构化冲突信息（逐字段差异），不是堆栈。 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string; details?: unknown }

// ---------------------------------------------------------------------------
// 写回事务视图（挂账 #35）
// ---------------------------------------------------------------------------
// 为什么这几个类型写在 api.ts 而不是 src/content/types.ts：它们是**响应视图**
// （服务端从事务记录里筛过一遍才出网关的字段），不是记录本体；
// 视图类型跟着取数函数放在一起，读代码时不必两头对照。

/** 事务状态：与服务端 WRITEBACK_STATE 一一对应。 */
export type WritebackTxState = 'preview' | 'writing' | 'partial' | 'synced' | 'failed' | 'rolled_back'

/** 账本一行：足以认出「哪一次写回、走到哪一步」；备份路径与指纹都不在这里。 */
export type WritebackTransactionSummary = {
  operationId: string
  state: WritebackTxState
  topic: string
  /** 学习日期（YYYY-MM-DD）：预览时算出的批次日期。 */
  at: string | null
  createdAt: string | null
  syncedAt: string | null
  rolledBackAt: string | null
  /** 服务端事务结论（例如「日志已保存，进度待合并」），已抹掉本机绝对路径。 */
  message: string
  evidenceCount: number
  targets: { kind: string; path: string; applied: boolean }[]
}

export type WritebackTransactionList = {
  /** 新→旧，最多 `capped` 条。 */
  transactions: WritebackTransactionSummary[]
  /** 该用户在服务端留下的事务总数：大于 transactions.length 就是还有更早的没列出。 */
  total: number
  /** 读不出来的记录数（JSON 损坏等）：如实说明，不冒充「没有事务」。 */
  unreadable: number
  capped: number
}

/** 事务里的一步：计划过什么、实际做了什么、回滚能不能还原。 */
export type WritebackStepDetail = {
  path: string
  kind: string
  applied: boolean
  appliedAt: string | null
  /** 本来就无需改动（内容已一致），与「写成功了」是两件事。 */
  skipped: boolean
  /** 有没有备份可还原；备份的绝对路径本身不出网关。 */
  backupPresent: boolean
  /** 这一步是否新建了文件（回滚时是移除而不是还原）。 */
  createdNew: boolean
  /** 预览基线指纹：界面重新载入后重试补齐仍要带它（挂账⑤）。 */
  expectedHash: string | null
}

export type WritebackTransactionDetail = {
  operationId: string
  state: WritebackTxState
  at: string | null
  topic: string | null
  createdAt: string | null
  syncedAt: string | null
  rolledBackAt: string | null
  logSaved: boolean
  message: string
  evidenceCount: number
  targets: WritebackStepDetail[]
}

/** 回滚回执：`action` 区分「用备份还原」与「移除本次新建」。 */
export type WritebackRollbackResult = {
  rolledBack: boolean
  idempotent: boolean
  operationId?: string
  targets: { path: string; kind: string; action: 'restored' | 'removed' }[]
}

/** 409 `rollback_blocked` 的 details 形状（blockers 里的 path 是库内相对路径）。 */
export type RollbackBlockedDetails = {
  blockers: { path: string; kind: string; reason: string }[]
}

/**
 * 把服务端/网络错误文本里可能出现的**本机绝对路径**隐去。
 * 工程纪律：错误信息与日志不得回显绝对路径；库内相对路径（`全栈工程师学习计划/进度追踪.md`）
 * 是有效信息，必须保留，所以只匹配带盘符、UNC 与常见 POSIX 根目录三种形态。
 */
const ABSOLUTE_PATH_PATTERNS = [
  /[A-Za-z]:[\\/][^\s,;"'）)】]+/g,
  /\\\\[A-Za-z0-9.$_-]+\\[^\s,;"'）)】]*/g,
  /\/(?:Users|home|var|tmp|private|root|opt|usr|etc|srv|mnt)[\\/][^\s,;"'）)】]*/g,
]

export function redactAbsolutePaths(text: string): string {
  return ABSOLUTE_PATH_PATTERNS.reduce(
    (value, pattern) => value.replace(pattern, '（已隐去本机路径）'),
    text,
  )
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, { credentials: 'same-origin', ...init })
    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    if (!response.ok) {
      const record = payload as { error?: unknown; code?: unknown; details?: unknown } | null
      return {
        ok: false,
        status: response.status,
        code: typeof record?.code === 'string' ? record.code : 'http_error',
        message: redactAbsolutePaths(
          typeof record?.error === 'string' ? record.error : `请求失败（${response.status}）`,
        ),
        details: record?.details,
      }
    }
    return { ok: true, data: (payload as { data: T }).data }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      code: 'network_error',
      message: redactAbsolutePaths(
        `无法连接本地内容服务：${error instanceof Error ? error.message : String(error)}`,
      ),
    }
  }
}

export function fetchStatus(): Promise<ApiResult<ContentStatusResponse>> {
  return request<ContentStatusResponse>('/api/content/status')
}

/**
 * 拉取目录并组装为快照。目录接口本身不返回正文；
 * 正文按需通过 fetchLesson 拉取，避免一次把整库带进浏览器。
 */
export async function fetchCatalog(): Promise<ApiResult<ContentSnapshot>> {
  const result = await request<ContentSnapshot>('/api/content/catalog')
  return result
}

export function fetchLesson(
  contentId: string,
): Promise<ApiResult<{ lesson: SnapshotLesson; exercises: SnapshotExercise[]; stages: unknown[] }>> {
  return request(`/api/content/lessons/${encodeURIComponent(contentId)}`)
}

export function fetchExercise(exerciseId: string): Promise<ApiResult<SnapshotExercise>> {
  return request<SnapshotExercise>(`/api/content/exercises/${encodeURIComponent(exerciseId)}`)
}

export function triggerSync(options?: { dryRun?: boolean }): Promise<ApiResult<{ jobId: string; reused: boolean; status: string; dryRun: boolean }>> {
  return request('/api/content/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dryRun: options?.dryRun === true }),
  })
}

export function fetchSyncJob(jobId: string): Promise<ApiResult<Record<string, unknown>>> {
  return request(`/api/content/sync/${encodeURIComponent(jobId)}`)
}

// ---------------------------------------------------------------------------
// LINK-08：学习事实（只读）
// ---------------------------------------------------------------------------

export function fetchLearningStatus(): Promise<ApiResult<LearningStatus>> {
  return request<LearningStatus>('/api/learning/status')
}

/** 显式绑定：必须由用户主动确认，服务端不接受自动猜测。 */
export function bindVaultOwner(): Promise<ApiResult<{ bound: boolean; isOwner: boolean; vaultId: string | null; publicContent: boolean }>> {
  return request('/api/learning/owner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: true }),
  })
}

export function unbindVaultOwner(): Promise<ApiResult<{ bound: boolean }>> {
  return request('/api/learning/owner', { method: 'DELETE' })
}

export function setContentVisibility(publicContent: boolean): Promise<ApiResult<{ publicContent: boolean }>> {
  return request('/api/learning/owner/visibility', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicContent }),
  })
}

/** 正式进度投影：仅资料库拥有者；其他账户会得到 403/409，界面据此显示空态。 */
export function fetchVaultProgress(): Promise<ApiResult<VaultProgress>> {
  return request<VaultProgress>('/api/learning/vault-progress')
}

// ---------------------------------------------------------------------------
// LINK-09：确认式写回（暂存 → 预览 → 确认提交 → 可回滚/导出）
// ---------------------------------------------------------------------------

/**
 * 步骤 1：暂存证据（标 pending）。
 * 这一步只写应用数据，**不改资料库、不改正式进度**。
 */
export function stageEvidence(input: EvidenceInput): Promise<ApiResult<StagedEvidence>> {
  return request<StagedEvidence>('/api/learning/evidence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function fetchEvidenceQueue(): Promise<ApiResult<EvidenceQueue>> {
  return request<EvidenceQueue>('/api/learning/evidence')
}

/**
 * 队列读取的**四态可判定**结果（M3 复核挂账②）。
 *
 * Provider 的 `loadEvidenceQueue()` 把「读取失败」压成 `null`，界面因此无法与
 * 「还在读」区分，只能长期停在「正在读取暂存证据…」。这里保留服务端的错误码与
 * 可读原因，供写回面板区分 加载中 / 读取失败（带原因与重试入口）/ 空 / 有数据。
 * 面板因此自己持有一份队列读数并在暂存/删除/提交后重读；Provider 的
 * `evidenceQueue` 仍是它那一侧的副本（本单不越界改 Provider）。
 */
export type EvidenceQueueLoad =
  | { status: 'ready'; queue: EvidenceQueue }
  | { status: 'failed'; code: string; reason: string }

export async function loadEvidenceQueueState(): Promise<EvidenceQueueLoad> {
  const result = await fetchEvidenceQueue()
  if (result.ok) return { status: 'ready', queue: result.data }
  return { status: 'failed', code: result.code, reason: result.message }
}

export function removeEvidence(evidenceId: string): Promise<ApiResult<{ removed: boolean }>> {
  return request('/api/learning/evidence/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ evidenceId }),
  })
}

/** 步骤 2：预览（只读）。返回将写入的日志小节、进度差异、掌握变更与被阻止项。 */
export function previewWriteback(options: {
  evidenceIds: string[]
  masteryUpdates?: { skill: string; level: string; evidence?: string }[]
}): Promise<ApiResult<WritebackPreview>> {
  return request<WritebackPreview>('/api/learning/evidence-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ evidenceIds: options.evidenceIds, masteryUpdates: options.masteryUpdates ?? [] }),
  })
}

/**
 * 步骤 3：确认后提交。
 * expectedHashes 是预览给出的目标指纹：服务端据此判断页面是否基于旧预览。
 * **重试也必须带同一批真实指纹**（挂账⑤）：传 `{}` 等于让服务端跳过这道校验，
 * 是「用关掉校验来让流程走通」，本模块不接受这种写法。
 */
export function commitWriteback(options: {
  operationId: string
  expectedHashes: Record<string, string | null>
}): Promise<ApiResult<WritebackCommitResult>> {
  return request<WritebackCommitResult>('/api/learning/evidence-commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationId: options.operationId, expectedHashes: options.expectedHashes }),
  })
}

/**
 * 回滚一次确认式写回。
 * 成功回执里 `targets[].action` 区分「用备份还原」与「移除本次新建」；
 * 被 409 `rollback_blocked` 挡住时走 ApiResult 的失败分支，`details.blockers` 带逐条原因。
 */
export function rollbackWriteback(operationId: string): Promise<ApiResult<WritebackRollbackResult>> {
  return request<WritebackRollbackResult>('/api/learning/evidence-rollback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationId }),
  })
}

/**
 * 单个事务的明细（挂账 #35）。
 *
 * 返回的是「计划了什么 / 实际做了什么」的逐步事实：每一步的 kind、库内相对路径、
 * 是否已应用、什么时候落的、是不是本来就无需改动，以及回滚能不能还原这一步。
 * 备份的绝对路径不出网关，只回 `backupPresent` 这个「有没有备份可还原」。
 */
export function fetchWritebackTransaction(operationId: string): Promise<ApiResult<WritebackTransactionDetail>> {
  return request<WritebackTransactionDetail>(`/api/learning/evidence-transaction/${encodeURIComponent(operationId)}`)
}

/**
 * 事务账本（挂账 #35）：当前用户在服务端留下的写回事务，新→旧、条数受限。
 * 界面刷新后「部分成功」横幅与逐步明细靠它复原，不再依赖 React 状态里的 operationId。
 */
export function fetchWritebackTransactions(): Promise<ApiResult<WritebackTransactionList>> {
  return request<WritebackTransactionList>('/api/learning/evidence-transactions')
}

/**
 * 账本读取的四态结果，口径与 `loadEvidenceQueueState()` 一致：
 * 「读不到」必须带原因回到界面，不能被显示成「还没有写回事务」。
 */
export type WritebackLedgerLoad =
  | { status: 'ready'; ledger: WritebackTransactionList }
  | { status: 'failed'; code: string; reason: string }

export async function loadWritebackLedgerState(): Promise<WritebackLedgerLoad> {
  const result = await fetchWritebackTransactions()
  if (result.ok) return { status: 'ready', ledger: result.data }
  return { status: 'failed', code: result.code, reason: result.message }
}

/**
 * 从 409 `rollback_blocked` 的响应里取出阻断项。
 * 拿不到结构化 blockers 就返回 null —— 界面宁可只复述服务端给的那句话，
 * 也不根据 error 文本编一份「哪几步被谁挡住」的清单。
 * 每条文本再过一遍 `redactAbsolutePaths`：这道隐去是本模块的边界，不能因为
 * 「服务端已经抹过一遍」就在客户端省掉（服务端漏抹时这里是最后一道）。
 */
export function readRollbackBlockers(details: unknown): RollbackBlockedDetails['blockers'] | null {
  const list = (details as { blockers?: unknown } | null | undefined)?.blockers
  if (!Array.isArray(list)) return null
  return list.map((item) => {
    const record = (item ?? {}) as Partial<RollbackBlockedDetails['blockers'][number]>
    return {
      path: redactAbsolutePaths(String(record.path ?? '')),
      kind: String(record.kind ?? ''),
      reason: redactAbsolutePaths(String(record.reason ?? '')),
    }
  })
}

/** 未授权写回或离线时导出待保存 Markdown（只读应用侧暂存，不读资料库）。 */
export function exportEvidenceMarkdown(evidenceIds?: string[]): Promise<ApiResult<EvidenceExportResult>> {
  return request<EvidenceExportResult>('/api/learning/evidence-export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ evidenceIds: evidenceIds ?? [] }),
  })
}