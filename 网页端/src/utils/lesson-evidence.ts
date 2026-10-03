/**
 * LEARN-01 第 4 条：把一节课的六种学习状态**从已有的掌握度证据里读出来**。
 *
 * 这里没有新存储、也没有第二份真相：`MasteryRecord.evidence` 仍然是唯一的事实来源，
 * 本模块只做「写 note」与「读 note」两件事：
 *
 * 1. 写：`lessonSignalNote()` 产出「已阅读 / 已练习」两条学习信号的 note。
 *    `MasteryEvidence`（data/mastery.ts）只有 kind / refId / note / at / passed / verification
 *    六个字段，kind 四档与 passed 二态都已被别的口径占用，note 是唯一能承载信号的地方，
 *    所以信号一律以 `SIGNAL_PREFIX` 开头，读写两头都走本模块，别处不再自拼这句话。
 * 2. 读：`deriveLessonEvidenceStates()` 把一条记录折成六个布尔状态，界面只显示它，
 *    不再自己看 note 猜。
 *
 * 等级纪律：两条信号都以 `passed: false` 落盘。`applyEvidence` 只在 `passed` 为真时 +1 级，
 * 所以「读过」「跑过」都不推进 0—6 级阶梯，也不被算成完成证据。
 */

import type { MasteryEvidence, MasteryRecord } from '../data/mastery'
import type { Challenge, ExecutionTier, Lesson, RunStatus, TraceEvent } from '../types/lesson'

/** 学习信号种类：已阅读（学习者显式标记）与已练习（本机真实跑完一次）。 */
export type LessonSignalKind = 'read' | 'practice'

/** 信号 note 的固定前缀：写与读共用，改这一处等于换数据格式，故只在这里出现一次。 */
const SIGNAL_PREFIX = '学习信号：'

export const LESSON_SIGNAL_LABEL: Record<LessonSignalKind, string> = {
  read: '已阅读',
  practice: '已练习',
}

/** 信号本身不是完成证明——这句话必须落在记录里，而不只是落在界面上。 */
const SIGNAL_DISCLAIMER: Record<LessonSignalKind, string> = {
  read: '学习者自己标记读过本课正文，不构成完成证明',
  practice: '本机真实运行完成一次后自动记录，只是练习痕迹，不构成完成证明',
}

/** 落盘用的信号 note（界面读它、导出也带着它，不做二次翻译）。 */
export function lessonSignalNote(kind: LessonSignalKind, lessonTitle: string): string {
  return `${SIGNAL_PREFIX}${LESSON_SIGNAL_LABEL[kind]} · 课程「${lessonTitle}」——${SIGNAL_DISCLAIMER[kind]}，不推进掌握等级`
}

/** 这条证据是不是学习信号；是则给出哪一种。完成证据与旧记录一律返回 null。 */
export function lessonSignalOf(evidence: MasteryEvidence): LessonSignalKind | null {
  if (evidence.kind !== 'lesson') return null
  for (const kind of Object.keys(LESSON_SIGNAL_LABEL) as LessonSignalKind[]) {
    if (evidence.note.startsWith(`${SIGNAL_PREFIX}${LESSON_SIGNAL_LABEL[kind]} · `)) return kind
  }
  return null
}

/** 这一课是否已经记过某条信号（「第一次跑成才记」与按钮去重都读它，不重复写同一信号）。 */
export function hasLessonSignal(record: MasteryRecord | undefined, kind: LessonSignalKind): boolean {
  return (record?.evidence ?? []).some((evidence) => lessonSignalOf(evidence) === kind)
}

/**
 * 这一课有没有**完成**证据。
 *
 * 信号也是 lesson 类记录，所以「有记录」不再等价于「已完成」。凡是拿记录存在性当完成用的
 * 读取点都必须改走本函数，否则点一次「标记已阅读」就会把整页判成已完成。
 *
 * 01 号方案 §9「不另写一套学习进度」：这里不再自己扫 `evidence`，而是折成六态后走
 * `holdsCompletion` 那一处出口。改版前本函数只认 `kind==='lesson' && passed`，而学习路径的
 * 阶段折算（learning-path-view.tsx:421）与路径行的百分比（app.tsx 的 pathLessons）各用
 * 各的条件，同一节课会出现「路径说已完成、工作台说未完成」。折成同一个出口之后，
 * 「延迟复测掌握」这一态在三个地方读出来必须一样。
 */
export function hasCompletionEvidence(record: MasteryRecord | undefined): boolean {
  return holdsCompletion(deriveLessonEvidenceStates(record))
}

/**
 * `summarizeExternalEvidence`（utils/external-evidence.ts）逐行输出的四个必填字段标签。
 * 这里只按「行首出现」判定，不重写校验规则：真值仍以校验模块为准，
 * 本函数只回答「这条 note 里是否留过一份结构化外部证据」。
 */
const EXTERNAL_EVIDENCE_LABELS = ['执行环境：', '执行命令：', '结果摘要：', '复现日期：']

export function hasExternalEvidenceInNote(note: string): boolean {
  const lines = note.split('\n')
  return EXTERNAL_EVIDENCE_LABELS.every((label) => lines.some((line) => line.startsWith(label)))
}

/** 一节课的六种状态（LEARN-01 第 4 条要求拆开的口径）。 */
export type LessonEvidenceStates = {
  read: boolean
  practiced: boolean
  submittedEvidence: boolean
  selfDeclaredPassed: boolean
  autoVerifiedPassed: boolean
  reviewMastered: boolean
}

export type LessonStateKey = keyof LessonEvidenceStates

/** 没有任何记录时的六态（界面按「一条都不成立」读，不猜）。 */
export const NO_LESSON_STATES: LessonEvidenceStates = {
  read: false,
  practiced: false,
  submittedEvidence: false,
  selfDeclaredPassed: false,
  autoVerifiedPassed: false,
  reviewMastered: false,
}

/** 六态的展示口径：顺序、名称，以及「这一格到底说了谁判的」的一句实话。 */
export const LESSON_STATE_ITEMS: { key: LessonStateKey; label: string; meaning: string }[] = [
  { key: 'read', label: '已阅读', meaning: '学习者标记读过正文 · 不是完成证明' },
  { key: 'practiced', label: '已练习', meaning: '本机真实跑完过一次 · 不是完成证明' },
  { key: 'submittedEvidence', label: '已提交证据', meaning: '外部环境提交了结构化证据 · 系统未比对' },
  { key: 'selfDeclaredPassed', label: '自评通过', meaning: '学习者自行声明完成 · 系统未比对输出' },
  { key: 'autoVerifiedPassed', label: '自动验证通过', meaning: '该题验收点整行命中' },
  { key: 'reviewMastered', label: '延迟复测掌握', meaning: '至少一次到期复测判为通过' },
]

/**
 * 由一条掌握度记录折出六态（纯函数）。
 * 判定只读 `kind / passed / verification / note` 这四个既有字段，缺省一律按「不知道」读，
 * 与 `CompletionVerification`（data/mastery.ts:18-23）「旧记录不追认成验证过」同口径。
 */
export function deriveLessonEvidenceStates(record: MasteryRecord | undefined): LessonEvidenceStates {
  const evidence = record?.evidence ?? []
  const lessonEvidence = evidence.filter((item) => item.kind === 'lesson')
  const completion = lessonEvidence.filter((item) => item.passed)
  return {
    read: lessonEvidence.some((item) => lessonSignalOf(item) === 'read'),
    practiced: lessonEvidence.some((item) => lessonSignalOf(item) === 'practice'),
    submittedEvidence: lessonEvidence.some((item) => hasExternalEvidenceInNote(item.note)),
    // 缺 `verification` 的旧完成记录读成自评（不追认成机器判过），所以这一格与下一格互斥。
    selfDeclaredPassed: completion.some((item) => item.verification !== 'auto-verified'),
    autoVerifiedPassed: completion.some((item) => item.verification === 'auto-verified'),
    reviewMastered: evidence.some((item) => item.kind === 'review' && item.passed),
  }
}

/** 六态里成立的有哪些（学习路径行只列成立的那几项，避免 70 行清单被六行状态撑爆）。 */
export function heldLessonStates(states: LessonEvidenceStates): { key: LessonStateKey; label: string }[] {
  return LESSON_STATE_ITEMS.filter((item) => states[item.key]).map((item) => ({ key: item.key, label: item.label }))
}

/**
 * 六态里「算完成」的是哪三态：自评通过 / 自动验证通过 / 延迟复测掌握。
 *
 * 单点出口，界面不许自己抄一份：「已阅读」「已练习」「已提交证据」都是痕迹不是掌握
 * （两条信号本就按 `passed: false` 落盘），拿它们凑「这一阶段掌握了」会把状态账做假。
 * 与 `hasCompletionEvidence`（读记录）同判据，只是这里读已折好的六态。
 */
export function holdsCompletion(states: LessonEvidenceStates | undefined): boolean {
  if (!states) return false
  return states.selfDeclaredPassed || states.autoVerifiedPassed || states.reviewMastered
}

/**
 * 「这一课的完成是谁判的」——读侧口径（写侧仍是 `CompletionVerification` 两档，
 * 见 data/mastery.ts:18-23，那条讲的是**证据落盘时**谁做的判定）。
 *
 * 改版前这个问题由 `app.tsx` 的 `lastCompletionVerification()` 自己从后往前扫 evidence 数组
 * 回答，是同一根轴上的第三份实现（01 号方案 §9 禁止的就是这个）。现在只有这一处：
 * 优先报机器真的比对过的（验收点逐行命中），其次报学习者声明的，最后才是复测判出的掌握。
 * 顺序不能反：把「复测掌握」说成「本机验证过」就是谎称验证（02 号方案 §4）。
 */
export type LessonCompletionSource = 'auto-verified' | 'self-declared' | 'review-mastered'

export const LESSON_COMPLETION_SOURCE_LABEL: Record<LessonCompletionSource, string> = {
  'auto-verified': '该题验收点自动比对通过',
  'self-declared': '学习者自行声明，系统未比对输出',
  'review-mastered': '到期复测判为掌握，本课没有留下逐题验收记录',
}

export function completionSourceOf(
  states: LessonEvidenceStates | undefined,
): LessonCompletionSource | null {
  if (!states) return null
  if (states.autoVerifiedPassed) return 'auto-verified'
  if (states.selfDeclaredPassed) return 'self-declared'
  if (states.reviewMastered) return 'review-mastered'
  return null
}

/**
 * 这一次运行算不算「真的跑完了一遍」（与 RUN-01 同一判据：可信执行等级 + 完整轨迹 + 无报错）。
 *
 * 全部条件读执行 hook 已经产出的事实，不看用户自述：
 * - `runStatus === 'completed'`：播放头确实走到了末态；
 * - `events.length > 0`：真的产生过轨迹（空轨迹的 completed 是重置后的残余）；
 * - 没有 error、没有 unsupported：报错或运行器认不出结构的那一跑不配留痕；
 * - 执行等级不是 external：外部环境实验在浏览器里根本没跑，不许记成本机练习。
 */
export function isCompletedPracticeRun(
  /**
   * 显式写可选性，不用 `Pick<ExecutionResult, …>`：`Pick` 在这里把 `error` 当成了必填，
   * 于是调用方（拿着真 `ExecutionResult`）与自己的测试（只给两格的最小样本）都塞不进来。
   * 这三项本来就是「没有就当未知」的可选信号，缺省不等于失败。
   */
  input: {
    runStatus: RunStatus
    events: TraceEvent[]
    error?: { line: number; message: string }
    unsupported?: boolean
    tier?: ExecutionTier
  },
): boolean {
  if (input.runStatus !== 'completed') return false
  if (input.events.length === 0) return false
  if (input.error) return false
  if (input.unsupported) return false
  if (input.tier === 'external') return false
  return true
}

/**
 * 外部课程要把结构化证据对上「本课的验收点」。
 * 课程的验收点散在练习契约的期望输出与证据清单里，这里映射成校验器认识的形状，
 * 不改 `validateExternalEvidence` 的判定口径（它只看有没有提到过，不当通过依据）。
 */
export function lessonAcceptancePoints(lesson: Lesson): Pick<Challenge, 'targetOutput' | 'evidence'> {
  const checklist = lesson.content.evidenceChecklist ?? lesson.acceptance?.evidenceChecklist ?? []
  return {
    targetOutput: lesson.exercise?.expectedOutput ?? [],
    evidence: [...checklist, lesson.content.completion ?? ''].filter((item) => item.trim() !== ''),
  }
}
