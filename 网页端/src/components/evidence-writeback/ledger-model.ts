/**
 * 写回视图的本地模型：只服务「学习证据写回」这一视图的纯函数、常量与视图态类型。
 *
 * 来源：以下代码自 `app/src/components/evidence-writeback-view.tsx` 原样搬来
 * （01 号方案 §4 把写回页拆成 WritebackLedger / TransactionDetail / EvidencePreview / RollbackDialog），
 * 判定口径、文案与注释一字未改；四个子组件与主编排文件共用这一份，不再各写一遍。
 *
 * 边界（防止有人再开第二套实现）：
 * - 日期键不在这里：统一走 `utils/date-helpers` 的 `getLocalDateKey`（留在主编排文件）；
 * - 取数与回滚的服务端口径不在这里：统一走 `content/api`；
 * - 这一层的每个函数都是**读已落盘事实**的折算，不产生新判定，也不改判定。
 */
import {
  AlertTriangle,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  History,
  Info,
  LoaderCircle,
  ShieldAlert,
  SquareDashed,
  Undo2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type {
  RollbackBlockedDetails,
  WritebackStepDetail,
  WritebackTransactionDetail,
  WritebackTransactionSummary,
  WritebackTxState,
} from '../../content/api'
import type { FieldDiff, StagedEvidence, WritebackTarget } from '../../content/types'

export type ProgressPreview = { edits: FieldDiff[]; masteryBlocked: { skill: string; level: string; reason: string }[] }
export type IndexPreview = { changed: boolean; line?: string; reason?: string }

/** 队列读取阶段：只在「手上还没有数据」时才决定界面显示加载态还是失败态。 */
export type QueuePhase = 'loading' | 'ready' | 'failed'

/** 目标指纹：预览给出的路径 → 指纹映射，提交与重试都带它。 */
export type ExpectedHashes = Record<string, string | null>

/** 部分成功（同一事务待补齐）时保留的上下文：operationId + 真实指纹 + 这批指纹是哪一代。 */
export type PartialTransaction = {
  operationId: string
  message: string
  expectedHashes: ExpectedHashes
  /**
   * `preview`：本页这次预览给出的；`record`：界面重新载入后从服务端**该笔事务自己的**
   * 记录里取回的同一批基线。两者都是真实指纹，但来源必须写明——用户该知道自己
   * 是据哪一次核对在补齐（挂账⑤ / #35）。
   */
  source: 'preview' | 'record'
}

/**
 * 上一次回滚的回执（挂账 #35）：形状原先内联在主面板的 useState 上，
 * 拆分后账本 / 明细 / 回滚三处都要按事务读它，故在此具名。字段与判据都不变。
 */
export type RollbackOutcome = {
  operationId: string
  tone: 'done' | 'blocked' | 'failed'
  text: string
  blockers: RollbackBlockedDetails['blockers'] | null
} | null

/**
 * 语义状态登记（§5.1 末段）：一档状态固定绑定「图形 + 文字」两个通道，
 * 颜色只是第三重提示，且一律取 --ds-status-*，不跟随场景点缀色插值。
 * `result` 是给一次性横幅用的中性档：横幅只是服务端回执，真正的落盘状态由
 * 01/02/03 三个队列区的条目标识承担，避免把「已暂存 / 已导出」说成「已同步」。
 * 加载态刻意不给循环动画：读取慢的时候转圈不增加信息，只会把「还没读到」包装成
 * 一定成功的样子；读取失败已经有独立的失败态，不再借加载态外观蒙混。
 */
export type StateTone =
  | 'pending'
  | 'partial'
  | 'synced'
  | 'conflict'
  | 'failed'
  | 'loading'
  | 'empty'
  | 'notice'
  | 'result'
  /** 挂账 #35 新增两档：账本里的「已回滚」与「写入中断」既不是成功也不是失败。 */
  | 'rolledback'
  | 'interrupted'

export const STATE_MARK: Record<StateTone, { Icon: LucideIcon; label: string }> = {
  pending: { Icon: CircleDashed, label: '待处理' },
  partial: { Icon: CircleSlash, label: '部分成功' },
  synced: { Icon: CircleCheck, label: '已同步' },
  conflict: { Icon: ShieldAlert, label: '冲突' },
  failed: { Icon: CircleX, label: '失败' },
  loading: { Icon: LoaderCircle, label: '加载中' },
  empty: { Icon: SquareDashed, label: '空' },
  notice: { Icon: AlertTriangle, label: '受限' },
  result: { Icon: Info, label: '提示' },
  rolledback: { Icon: Undo2, label: '已回滚' },
  interrupted: { Icon: History, label: '写入中断' },
}

export const kindLabel: Record<string, string> = { log: '学习日志', progress: '进度追踪', index: '总计划日志索引' }

/** 目标状态也用双通道：文字（已存在 / 将新建）+ 指纹，不只靠颜色。 */
export const targetState = (target: WritebackTarget) =>
  target.exists ? `已存在 · 指纹 ${target.expectedHash?.slice(0, 8)}` : '不存在（将新建）'

/** 队列条目自身的落盘状态（服务端把 pending 与 partial 都放在待处理列表里）。 */
export const recordTone = (record: StagedEvidence): StateTone =>
  record.state === 'synced' ? 'synced' : record.state === 'partial' ? 'partial' : 'pending'

export const ranByLabel = (record: StagedEvidence) =>
  record.ranBy === 'learner' ? '学习者' : record.ranBy === 'ai_assistant' ? 'AI 助手' : '未说明'

export const evidenceMeta = (record: StagedEvidence) =>
  `${record.at} · ${ranByLabel(record)} · ${record.independent ? '独立' : '非独立'}${record.hintLevel ? ` · ${record.hintLevel}` : ''}`

// ---------------------------------------------------------------------------
// 事务账本（挂账 #35）：把服务端事务记录翻成界面可读的档位与文字
// ---------------------------------------------------------------------------

/** 已落盘的步数（含「无需改动」的跳过步：它同样核对过了，不需要再写一遍）。 */
export const appliedSteps = (item: { targets: { applied: boolean }[] }) => item.targets.filter((step) => step.applied).length

/**
 * 账本一行的状态档。
 *
 * 注意服务端的一个既成事实：提交阶段 A 检测到冲突时，即使**一步都没写**，
 * 事务也会被标成 `partial`（writeback.mjs 里那两处 `state = PARTIAL` 不分 logSaved）。
 * 界面不能因此说成「部分成功」——那会把「什么都没写」讲成「写了一半」，
 * 所以 `partial` 只在确实落盘过至少一步时才用「部分成功」档，否则给「冲突」档。
 */
export function ledgerTone(item: WritebackTransactionSummary): StateTone {
  if (item.state === 'synced') return 'synced'
  if (item.state === 'rolled_back') return 'rolledback'
  if (item.state === 'writing') return 'interrupted'
  if (item.state === 'failed') return 'failed'
  if (item.state === 'partial') return appliedSteps(item) > 0 ? 'partial' : 'conflict'
  return 'pending'
}

/**
 * 「确实只写了一部分、还在等补齐」的事务：02 区只认这种。
 * 一步都没写的 partial 不属于这里（它该看到的是冲突块与重新预览）。
 */
export const isResumable = (item: WritebackTransactionSummary) =>
  (item.state === 'partial' || item.state === 'writing') && appliedSteps(item) > 0

export const ledgerMeta = (item: WritebackTransactionSummary) =>
  `记录于 ${item.createdAt ?? '（服务端未记时间）'} · 学习日期 ${item.at ?? '未定'} · ${item.evidenceCount} 条证据 · 已落盘 ${appliedSteps(item)}/${item.targets.length} 步`

/** 一步「实际做了什么」。不拿计划冒充结果：未写入 / 无需改动 / 已写入是三种不同的事实。 */
export function stepOutcomeText(step: WritebackStepDetail): string {
  if (!step.applied) return '未写入（这一步没有落盘）'
  if (step.skipped) return '无需改动（内容已一致，没有重复写）'
  return '已写入'
}

/**
 * 这一步回滚时会怎么处理，逐字对应服务端 rollback() 的分支。
 * 「没有备份」= 这一步在落盘前就失败了，回滚结构上救不回来，必须说在前面。
 */
export function rollbackPlanText(step: WritebackStepDetail): string {
  if (!step.applied) return '不涉及：没写过，没有要还原的东西'
  if (step.createdNew) return '本次新建的文件，回滚会把它移出资料库'
  if (step.backupPresent) return '用写入前的备份覆盖回来'
  return '无备份可还原：落盘前就失败过，回滚救不回来'
}

/** 回滚有意义的事务状态：写过东西才谈得上还原；预览态与已回滚态都没有可还原的内容。 */
export const ROLLBACKABLE_STATES = ['synced', 'partial', 'writing', 'failed']

/** 回滚入口只在「状态可回滚 + 确实写过至少一步」时出现，不给空事务一个假按钮。 */
export function canRollback(detail: WritebackTransactionDetail) {
  return ROLLBACKABLE_STATES.includes(detail.state) && detail.targets.some((step) => step.applied)
}

/** 事务状态说人话：每句都对应服务端事务记录里的一个 state 值，不合并语义。 */
export const TX_STATE_TEXT: Record<WritebackTxState, string> = {
  preview: '只预览过，没有写入',
  writing: '写入过程中断（部分步骤已落盘）',
  partial: '部分写入，还在等补齐',
  synced: '全部写入并复核完成',
  failed: '写入失败',
  rolled_back: '已回滚',
}
