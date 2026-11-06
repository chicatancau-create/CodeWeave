/**
 * 学习工作台的本地模型（01 号方案 §4 拆分后的共用层）：只服务「学习工作台」这一视图的
 * 纯函数与常量，自 `app/src/components/learning-workspace-view.tsx` 原样搬来，
 * 判定口径、文案与注释一字未改；五个子组件与主编排文件共用这一份，不再各写一遍。
 *
 * 边界（01 号方案 §9「不另写一套」——这三件事在别处早有统一出口，这里只调用，不复制）：
 * - 「这一课算不算完成」只在 `utils/lesson-evidence.ts` 判：`holdsCompletion` 与
 *   `completionSourceOf`，本文件只引用同一张 `LESSON_COMPLETION_SOURCE_LABEL` 标签表；
 * - 日期键只在 `utils/date-helpers.ts` 的 `getLocalDateKey`（留在主编排文件）；
 * - 判题只在 `engine/challenge-judge.ts` 的 `judgeOutput`（默认口径 `DEFAULT_JUDGE_MODE`）；
 * - 外部证据的字段清单与校验只在 `utils/external-evidence.ts`。
 */
import type { CompletionVerification } from '../../data/mastery'
import { DEFAULT_JUDGE_MODE, judgeOutput } from '../../engine/challenge-judge'
import type { JudgeOutcome } from '../../engine/challenge-judge'
import type { ExecutionResult, Lesson, RunStatus } from '../../types/lesson'
import type { EvidenceValidation, ExternalEvidence } from '../../utils/external-evidence'
import { LESSON_COMPLETION_SOURCE_LABEL } from '../../utils/lesson-evidence'
import type { LessonCompletionSource } from '../../utils/lesson-evidence'

/**
 * 点「标记完成」时交给上层的事实：谁判的、验收点中了几条。
 * 外部真实环境的课另带一份结构化证据（LEARN-01 第 5a 条），由上层序列化后进证据 note；
 * 本地练习的课没有这一项（判据是该题验收点逐行命中，不需要环境描述）。
 */
export type LessonCompletionPayload = {
  verification: CompletionVerification
  cases: { matched: number; total: number } | null
  externalEvidence?: ExternalEvidence
}

/**
 * 四个分区的锚点（01 号方案 §3.2 主工作台：正文 / 编辑器 / 运行追踪 / 证据状态）。
 * 锚点只在对应分区真实存在时才出现在导航里，避免指向不存在的 id；
 * 窄视口下四区改为纵向堆叠，这组入口就是「可见菜单入口」（§5.2 末段）。
 */
const PANES = [
  { id: 'cw-pane-reading', label: '阅读', available: (lesson: Lesson) => Boolean(lesson.reading) },
  { id: 'cw-pane-code', label: '代码', available: (lesson: Lesson) => lesson.code.trim() !== '' },
  { id: 'cw-pane-variables', label: '变量', available: () => true },
  { id: 'cw-pane-console', label: '控制台', available: () => true },
] as const

export type WorkspacePane = (typeof PANES)[number]

/** 导航只列出此刻真实存在的分区（详情在路上/读失败时「阅读」锚点仍然成立）。 */
export function visiblePanes(lesson: Lesson, detailPending: boolean, detailError: string | null): WorkspacePane[] {
  return PANES.filter(
    (pane) =>
      pane.available(lesson) ||
      (detailPending && pane.id === 'cw-pane-reading') ||
      (detailError !== null && pane.id === 'cw-pane-reading'),
  )
}

/** 验收点命中了几条：按钮那句「x/y 未全中」与交给上层的 `cases` 读同一处，不各数一遍。 */
export function matchedCaseCount(contractJudge: JudgeOutcome | null): number {
  return contractJudge?.cases.filter((item) => item.matched).length ?? 0
}

/** 完成口径的输入：全部是上层已经拿在手里的事实，本函数不取数、不写状态。 */
export type CompletionAssessmentInput = {
  lesson: Lesson
  runStatus: RunStatus
  execution: ExecutionResult
  visibleOutput: string[]
  isExternal: boolean
  externalCheck: EvidenceValidation | null
  detailPending: boolean
}

/**
 * 这一课「能不能标完成、按什么档位标」的折算结果。
 * 01 号方案 §4 的 disabled 行要求把禁用条件说出口，所以档位逐条留着，不只回一个布尔。
 */
export type CompletionAssessment = {
  hasCode: boolean
  hasFlow: boolean
  canAutoRun: boolean
  autoVerified: boolean
  needsRun: boolean
  needsVerify: boolean
  needsExternalEvidence: boolean
  completeDisabled: boolean
  contractJudge: JudgeOutcome | null
}

/** 逐条判定与改版前同一个式子、同一个顺序，只是收在一处并可在 `useMemo` 里复用。 */
export function assessCompletion(input: CompletionAssessmentInput): CompletionAssessment {
  const { lesson, runStatus, execution, visibleOutput, isExternal, externalCheck, detailPending } = input
  const ranSuccessfully = runStatus === 'completed' && !execution.error && !execution.unsupported
  /** 资料库条目：原文与练习契约来自快照；无代码/无流程元数据时不做假动作。 */
  const hasCode = lesson.code.trim() !== ''
  const hasFlow = lesson.flow.length > 0
  const canAutoRun = hasCode && lesson.executable !== false && !isExternal
  /**
   * LEARN-01 第 5 条：本地练习的「完成」必须按**这一题**的验收点判，不是「跑起来没报错」。
   * 资料库快照里 12 道练习都带 `expectedOutput`，改版前没有任何消费者——这条把它接到判题上，
   * 复用 CHAL-02 的 `exact-lines`（整行相等、一行只能被一个验收点用掉），不再另起一套口径。
   * 没有结构化验收点的课（61 门旧内置课全是）照旧可标完成，但记的是「自行声明」，不冒充验证。
   */
  const expectedLines = lesson.exercise?.expectedOutput ?? []
  const hasContract = canAutoRun && expectedLines.length > 0
  const contractJudge = hasContract ? judgeOutput(expectedLines, visibleOutput, DEFAULT_JUDGE_MODE) : null
  const autoVerified = contractJudge?.passed === true
  /** 完成按钮的档位：没跑成 → 不能标；跑了但验收点没全中 → 不能标；外部课证据不齐 → 不能标；没有判据可依 → 可以标，但记为自行声明。 */
  const needsRun = canAutoRun && !ranSuccessfully
  const needsVerify = contractJudge !== null && !autoVerified
  /** 外部环境课：四项结构化证据没填齐就不放开按钮（LEARN-01 第 5a 条，不再接受空证据的完成）。 */
  const needsExternalEvidence = isExternal && externalCheck !== null && !externalCheck.valid
  /**
   * #105 的另一半：详情在路上的那一秒里，本课的练习契约也还没到——此时按「没有契约」
   * 把按钮放开，等于让学习者在**系统还没看过这一题验收点**的时候就把完成记下去。
   * 所以这一段按钮锁住，理由写在下面那句说明里（不是静默禁用）。
   */
  const completeDisabled = needsRun || needsVerify || needsExternalEvidence || detailPending
  return {
    hasCode,
    hasFlow,
    canAutoRun,
    autoVerified,
    needsRun,
    needsVerify,
    needsExternalEvidence,
    completeDisabled,
    contractJudge,
  }
}

/**
 * 完成那句话的三档文案出自 utils/lesson-evidence.ts 的同一张表，界面不自己抄一遍。
 * 「延迟复测掌握」这一档是 §9 收口后新增可见的：复测判过但没留下逐题验收记录的课，
 * 从前在路径上显示已完成、在工作台显示未完成，两边各执一词。
 */
export function completedLabelOf(completionSource: LessonCompletionSource | null): string {
  return completionSource
    ? `本单元已完成（${LESSON_COMPLETION_SOURCE_LABEL[completionSource]}），按复测计划回顾`
    : '本单元已完成，按复测计划回顾'
}

/**
 * 按钮文案要短：原生 `button` 默认 `white-space: nowrap`，长句子会把整页顶出视口
 * （真机在 320 档量到 159px 溢出，元凶就是这句）。逐条差在哪由下面的清单承担，
 * 「为什么这一格没判据」由 `.cw-verify-none` 那句话说明，不塞进按钮名字里。
 */
export function pendingLabelOf(facts: {
  detailPending: boolean
  needsRun: boolean
  needsVerify: boolean
  contractJudge: JudgeOutcome | null
  canAutoRun: boolean
  needsExternalEvidence: boolean
}): string {
  const { detailPending, needsRun, needsVerify, contractJudge, canAutoRun, needsExternalEvidence } = facts
  return detailPending
    ? '详情读取中，暂不可标记'
    : needsRun
    ? '运行成功后可标记完成'
    : needsVerify
      ? `验收点 ${matchedCaseCount(contractJudge)}/${contractJudge?.cases.length ?? 0} 未全中`
      : contractJudge
        ? '标记完成（自动验证）'
        : canAutoRun
          ? '标记完成（自行声明）'
          : needsExternalEvidence
            ? '补齐外部证据后可标记完成'
            : '已完成真实环境练习，标记完成'
}

/** 交上去的事实（与改版前同一个对象形状，只是搬到共用模型里算一次）。 */
export function completionPayloadOf(facts: {
  ran: boolean
  contractJudge: JudgeOutcome | null
  isExternal: boolean
  externalCheck: EvidenceValidation | null
  externalEvidence: ExternalEvidence
}): LessonCompletionPayload {
  const { ran, contractJudge, isExternal, externalCheck, externalEvidence } = facts
  return {
    verification: ran ? 'auto-verified' : 'self-declared',
    cases: contractJudge ? { matched: matchedCaseCount(contractJudge), total: contractJudge.cases.length } : null,
    // 校验通过才带上证据：锁住的时候按钮本就点不动，不该交出半份材料让上层去序列化。
    ...(isExternal && externalCheck?.valid ? { externalEvidence } : {}),
  }
}
