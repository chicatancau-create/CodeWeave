/**
 * 掌握度与延迟复测（0—6 级）。
 *
 * 规则：
 * - 掌握等级只能由“通过”的证据推进：课程完成、挑战通过、复测通过、Bug 修复各 +1 级（上限 6）。
 * - 复测不通过 -1 级（下限 0），并按**当前生效的复测计划**重新安排同一节点（计划的解析口径见 `effectiveReviewPlan`）。
 * - 所有函数都是纯函数，便于测试。
 */

import { shiftDateKey } from '../utils/date-helpers'

export const MASTERY_LEVEL_NAMES = ['未开始', '了解', '模仿完成', '独立完成', '能教别人', '能优化扩展', '稳定掌握'] as const

export type MasteryLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6

export type MasteryEvidenceKind = 'lesson' | 'challenge' | 'review' | 'bugfix'

/**
 * LEARN-01 第 4 条：完成证据必须说清「谁判的」。
 * `auto-verified` = 该题的结构化验收点逐行命中；`self-declared` = 学习者自己声明，系统没比对过。
 * 缺省（旧记录）一律按 `self-declared` 读，不追认成验证过。
 */
export type CompletionVerification = 'auto-verified' | 'self-declared'

export type MasteryEvidence = {
  id: string
  kind: MasteryEvidenceKind
  /** 关联的单元 / 挑战 id */
  refId: string
  note: string
  /** ISO 时间 */
  at: string
  passed: boolean
  verification?: CompletionVerification
}

export type MasteryRecord = {
  refId: string
  kind: MasteryEvidenceKind
  level: MasteryLevel
  evidence: MasteryEvidence[]
  updatedAt: string
  /** 下一次复测的本地日期键（YYYY-MM-DD），完成全部节点后清除 */
  reviewDueKey?: string
  /** 已通过的复测节点下标（对应**当前生效计划**的节点列表，见 `effectiveReviewPlan`） */
  reviewStep: number
  /** 最近一次复测失败的原因摘要（用户自述；不应写入密码/Token/隐私） */
  lastFailReason?: string
}

/**
 * 延迟复测节点（天）——**本机兜底，不是排期标准**。兜底节点=1、3、7、14、30（共 5 档，不含学习当天）。
 *
 * 排期的标准是资料库规则投影 `reviewOffsetsDays` = `0、1、3、7、14、30`：权威文本是长期冲刺总计划
 * §7.4「默认节点：学习当天、+1 天、+3 天、+7 天、+14 天、+30 天」，机器形态在
 * `knowledge/vault/CodeWeave/rules/teaching-rules.json`，由 `server/content/compiler.mjs:1178` 编译进
 * bundle、`server/content/index.mjs:344` 随目录发布，读取口是 `content/adapter.ts` 的 `publishedReviewOffsets()`。
 * #33 的裁定：**运行时唯一标准 = 那条发布投影**；本常量只在该投影读不到时顶上
 * （内容服务未连接、只有旧内置课程），不得被当成第二套默认口径来改节奏。
 * 下面那行注释里自述了自身取值，`tests/review.plan.discipline.test.mjs` 钉住「注释与取值不许再互相矛盾」。
 */
export const REVIEW_OFFSET_DAYS = [1, 3, 7, 14, 30] as const
export const MAX_MASTERY_LEVEL: MasteryLevel = 6

/** 复测节点的来源（#33 裁定 1/2）：界面与日志都要能说出这一档是从哪一来的。 */
export type ReviewPlanSource = 'unit' | 'published' | 'fallback'

/** 一次排期真正使用的计划：节点列表（天）+ 它的来源。界面按它写文案，不再另抄一份节点。 */
export type ReviewPlan = { offsets: number[]; source: ReviewPlanSource }

/**
 * 归一一份节点列表：非数组、空表、全是非法数字，一律算「没写这个字段」（返回 null）。
 * 关键：返回 null **不等于「不复测」**，而是交给上一级继承——改版前 `adapter.ts` 把单元级
 * `null` 折成 `[]`，于是一门没写该字段的课被排成空计划，这是 #33 要拆掉的第二个口径。
 */
function usableOffsets(list: readonly number[] | null | undefined): number[] | null {
  if (!Array.isArray(list)) return null
  const clean = [...new Set(list.map(Number).filter((n) => Number.isFinite(n) && n >= 0))].sort((a, b) => a - b)
  return clean.length > 0 ? clean : null
}

/**
 * 生效复测计划的**唯一**解析口径（#33），三级优先：
 * 1. `lessonOffsets` 非空 → 本单元显式覆盖默认（source `unit`）；
 * 2. 否则 `publishedDefault` 非空 → 资料库发布规则（source `published`）——运行时的标准；
 * 3. 都没有 → 本机兜底常量 `REVIEW_OFFSET_DAYS`（source `fallback`）。
 *
 * `null`、`undefined` 与 `[]` 都按「没写」处理并继续向上继承；传 `undefined` 时第 2 级默认为 `null`。
 */
export function effectiveReviewPlan(
  lessonOffsets: readonly number[] | null | undefined,
  publishedDefault: readonly number[] | null | undefined = null,
): ReviewPlan {
  const unit = usableOffsets(lessonOffsets)
  if (unit) return { offsets: unit, source: 'unit' }
  const published = usableOffsets(publishedDefault)
  if (published) return { offsets: published, source: 'published' }
  return { offsets: usableOffsets(REVIEW_OFFSET_DAYS) ?? [], source: 'fallback' }
}

/** 生效节点列表（调度只认这一条），口径与 `effectiveReviewPlan` 完全一致。 */
export function effectiveReviewOffsets(
  lessonOffsets: readonly number[] | null | undefined,
  publishedDefault: readonly number[] | null | undefined = null,
): number[] {
  return effectiveReviewPlan(lessonOffsets, publishedDefault).offsets
}

/** 来源的中文名：界面用它标注「这一行按谁的节奏排」。 */
export function reviewPlanSourceName(source: ReviewPlanSource): string {
  if (source === 'unit') return '本单元自己写了的覆盖'
  if (source === 'published') return '资料库发布规则'
  return '本机排期'
}

/** 夹在「按 … 计划」里的节奏串：0 档是「学习当天」，不能写成「第 0 天」。 */
export function reviewPlanCadence(plan: ReviewPlan): string {
  const later = plan.offsets.filter((n) => n > 0).join('/')
  if (plan.offsets.includes(0)) return later ? `当天与 ${later} 天` : '当天'
  return `${later} 天`
}

/** 一行复测的完整口径：来源 + 节点 + 节点数（#33 裁定 4：界面必须说清它按哪一份节点排期）。 */
export function describeReviewPlan(plan: ReviewPlan): string {
  const sameDay = plan.offsets.includes(0) ? '学习当天 + ' : ''
  const later = plan.offsets.filter((n) => n > 0)
  const body = later.length > 0 ? `${sameDay}学完后第 ${later.join('、')} 天各一次` : '只在学习当天回顾一次'
  return `按${reviewPlanSourceName(plan.source)}：${body}，共 ${plan.offsets.length} 个节点`
}

export function masteryLevelName(level: MasteryLevel): string {
  return MASTERY_LEVEL_NAMES[level]
}

/**
 * LEARN-01 第 4/5 条：完成证据落盘的那一行要自己说清「谁判的」。
 * 改版前只有 `完成课程「…」` 一句，自动验证与自行声明在记录里长得一模一样。
 * `cases` 为 null 表示这一课根本没有结构化验收点（或属外部真实环境练习）。
 */
export function lessonCompletionNote(
  lessonTitle: string,
  verification: CompletionVerification,
  cases: { matched: number; total: number } | null,
): string {
  if (verification === 'auto-verified') {
    return `自动验证通过：完成课程「${lessonTitle}」，该题验收点 ${cases?.matched ?? 0}/${cases?.total ?? 0} 整行命中（口径：精确整行、每行只用一次）`
  }
  return `自行声明完成：完成课程「${lessonTitle}」（${cases ? '验收点未全中' : '本课无结构化验收点或属外部真实环境练习'}，系统未比对输出）`
}

/**
 * 由证据推进掌握等级（纯函数）。
 * `planLength` 是**当前生效计划**的节点数（默认取本机兜底常量），用于封顶 `reviewStep`：
 * 封顶必须跟着计划走，否则 6 档计划会在第 5 档就再也推不动、最后一个节点永远排不掉。
 */
export function applyEvidence(
  record: MasteryRecord | undefined,
  evidence: MasteryEvidence,
  planLength: number = REVIEW_OFFSET_DAYS.length,
): MasteryRecord {
  const base: MasteryRecord = record
    ? { ...record, evidence: [...record.evidence, evidence] }
    : { refId: evidence.refId, kind: evidence.kind, level: 0, evidence: [evidence], updatedAt: evidence.at, reviewStep: 0 }

  let level = base.level
  let reviewStep = base.reviewStep
  let reviewDueKey = base.reviewDueKey

  if (evidence.passed) {
    level = Math.min(MAX_MASTERY_LEVEL, level + 1) as MasteryLevel
    if (evidence.kind === 'review') {
      reviewStep = Math.min(planLength, reviewStep + 1)
      // 复测通过后由调用方调用 scheduleNextReview 安排下一个节点；这里先清空，避免过期键残留。
      reviewDueKey = undefined
    }
  } else if (evidence.kind === 'review') {
    level = Math.max(0, level - 1) as MasteryLevel
  }

  return { ...base, level, reviewStep, reviewDueKey, updatedAt: evidence.at }
}

/** 本地日期偏移：委托给唯一的日期工具，避免多份等价实现产生漂移。 */
export function addDaysKey(dateKey: string, days: number): string {
  return shiftDateKey(dateKey, days)
}

/** 取第 step 个复测偏移天数；越界时回退到该计划的最后一个节点。空计划（不该出现）按 0 天处理。 */
function reviewOffset(plan: readonly number[], step: number): number {
  if (plan.length === 0) return 0
  return plan[step] ?? plan[plan.length - 1] ?? 0
}

/**
 * 完成学习后初始化复测计划：排在计划的**第 0 档**上。
 * 标准计划第 0 档是 0（学习当天，§7.4 的第一档），落到当天就是「今天还要回顾一次」；
 * 只有读不到发布规则、走本机兜底时第 0 档才是 1 天后。
 */
export function scheduleFirstReview(
  record: MasteryRecord,
  todayKey: string,
  plan: readonly number[] = REVIEW_OFFSET_DAYS,
): MasteryRecord {
  return { ...record, reviewDueKey: addDaysKey(todayKey, reviewOffset(plan, 0)), reviewStep: 0 }
}

/** 复测通过后安排下一个节点；计划走完就清掉安排，不再谎称还有复测。 */
export function scheduleNextReview(
  record: MasteryRecord,
  todayKey: string,
  plan: readonly number[] = REVIEW_OFFSET_DAYS,
): MasteryRecord {
  const nextStep = record.reviewStep
  if (nextStep >= plan.length) return { ...record, reviewDueKey: undefined }
  return { ...record, reviewDueKey: addDaysKey(todayKey, reviewOffset(plan, nextStep)) }
}

/**
 * 复测失败后重新安排同一节点（节点 0 是「学习当天」，重排仍落在当天：当天的那一档没过就当天再来一次，
 * 要挪到明天请用 `snoozeReview`）。
 */
export function rescheduleReview(
  record: MasteryRecord,
  todayKey: string,
  plan: readonly number[] = REVIEW_OFFSET_DAYS,
): MasteryRecord {
  const step = Math.max(0, record.reviewStep - (record.reviewStep > 0 ? 1 : 0))
  return { ...record, reviewDueKey: addDaysKey(todayKey, reviewOffset(plan, step)), reviewStep: step }
}

/** 稍后提醒落在哪一天：REVIEW-01 要求界面把**实际顺延日期**说出来，所以规则只写一遍。 */
export function snoozeTargetKey(record: Pick<MasteryRecord, 'reviewDueKey'>, todayKey: string): string {
  const base = record.reviewDueKey && record.reviewDueKey > todayKey ? record.reviewDueKey : todayKey
  return addDaysKey(base, 1)
}

/** 稍后提醒：从“今天与计划日期的较晚者”顺延一天——对已排到未来的复测也有可见效果。 */
export function snoozeReview(record: MasteryRecord, todayKey: string): MasteryRecord {
  return { ...record, reviewDueKey: snoozeTargetKey(record, todayKey) }
}

/** 复测分组（F1 复习中心）：逾期 / 今日到期 / 未来 7 天 / 下一次复测。 */
export function groupReviews(
  records: MasteryRecord[],
  todayKey: string,
): {
  overdue: MasteryRecord[]
  today: MasteryRecord[]
  upcoming: MasteryRecord[]
  next: { dateKey: string; record: MasteryRecord } | null
} {
  const pending = records.filter((record) => record.reviewDueKey !== undefined)
  const sorted = [...pending].sort((a, b) => (a.reviewDueKey ?? '').localeCompare(b.reviewDueKey ?? ''))
  const overdue = sorted.filter((record) => (record.reviewDueKey ?? '') < todayKey)
  const today = sorted.filter((record) => record.reviewDueKey === todayKey)
  const upcoming = sorted.filter((record) => {
    const key = record.reviewDueKey ?? ''
    return key > todayKey && key <= addDaysKey(todayKey, 7)
  })
  const nextRecord = sorted.find((record) => (record.reviewDueKey ?? '') > todayKey)
  const next = nextRecord ? { dateKey: nextRecord.reviewDueKey!, record: nextRecord } : null
  return { overdue, today, upcoming, next }
}

/** 找出今天到期（或已过期）的复测记录。 */
export function dueReviewRecords(
  records: Record<string, MasteryRecord>,
  todayKey: string,
): MasteryRecord[] {
  return Object.values(records)
    .filter((record) => record.reviewDueKey !== undefined && record.reviewDueKey <= todayKey)
    .sort((a, b) => (a.reviewDueKey ?? '').localeCompare(b.reviewDueKey ?? ''))
}
