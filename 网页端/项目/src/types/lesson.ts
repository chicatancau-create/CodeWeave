export type LanguageId = 'python' | 'c' | 'csharp' | 'java' | 'javascript'

export type ChallengeRunner = 'javascript-sandbox' | 'teaching' | 'external'

/**
 * 关卡判题口径（CHAL-02 第 1 条）。定义放在类型层是因为 `Challenge` 与 `ChallengeRecord`
 * 都要带它，而执行引擎反过来依赖类型层（不形成环）。
 * - `exact-lines`：默认。验收点必须整行相等，且一行只能被一个验收点用掉。
 * - `legacy-contains`：改版前那句 `line.includes(expected)` 的口径。
 *   **只用于解释已经写进进度里的旧记录**，新的提交不会再走这一条（CHAL-02 第 7 条）。
 */
export type ChallengeJudgeMode = 'exact-lines' | 'legacy-contains'

/**
 * 执行等级（R4 G.3 第 1 条）：类型、UI、运行结果与文档共用同一枚举，禁止隐式提升可信度。
 * - worker：真实浏览器 Worker 沙箱执行
 * - teaching：教学模拟运行器（仅支持子集语法，非真实编译器）
 * - external：真实外部环境实验，本机无法自动验证，必须人工确认
 */
export type ExecutionTier = 'worker' | 'teaching' | 'external'

/** 执行等级的中文名与可信度说明（UI 与结果对象共用） */
export const EXECUTION_TIER_LABEL: Record<ExecutionTier, string> = {
  worker: '真实执行（浏览器 Worker 沙箱）',
  teaching: '教学模拟（子集语法，非真实编译器）',
  external: '外部环境实验（需人工确认）',
}

export function tierOfRunner(runner: ChallengeRunner): ExecutionTier {
  if (runner === 'javascript-sandbox') return 'worker'
  if (runner === 'teaching') return 'teaching'
  return 'external'
}

export type FlowNodeKind = 'start' | 'process' | 'decision' | 'output' | 'end'

export type FlowNode = {
  id: string
  label: string
  kind: FlowNodeKind
  tone: 'purple' | 'blue' | 'yellow' | 'coral' | 'green'
  line?: number
}

/** 单元运行环境：teaching=教学运行器/沙箱可执行；external=真实环境实验（必须提交人工证据） */
export type UnitRunEnvironment = 'teaching' | 'external'

/**
 * 可验收课程单元。字段与长期冲刺计划的十步学习法对齐：
 * 讲解、例子/反例、跟做、独立实现、变式、项目任务、常见错误、运行验证、完成证据、延迟复测。
 */
export type LessonUnit = {
  /** 本单元目标 */
  objective: string
  /** 先备知识（单元 id 或描述） */
  prerequisites: string[]
  /** 讲解要点 */
  explanation: string[]
  /** 例子 / 反例 */
  examples: { good: string; bad?: string; why: string }[]
  /** 跟做步骤 */
  guidedSteps: string[]
  /** 独立实现题 */
  exercise: string
  /** 变式题 */
  variant: string
  /** 持续项目任务 */
  projectTask: string
  /** 常见错误 */
  mistakes: string[]
  /** 运行 / 测试验证方式 */
  runCommand: string
  /** 完成证据（怎样算完成） */
  completion: string
  /**
   * 延迟复测偏移天数（天）。#33 裁定 2：这个字段只区分「写了 / 没写」。
   * - `null` 或 `[]`：**本单元没写**，继承资料库发布规则的默认节点（`effectiveReviewPlan` 的第 2 级），
   *   **绝不表示「本单元不复测」**；
   * - 非空数组：本单元显式覆盖默认，复习中心会点名标注为「本单元自己写了的覆盖」。
   * 改版前 `content/adapter.ts` 把快照里的 `null` 折成 `[]`，读的人无法区分「没写」与「空计划」。
   */
  reviewOffsetsDays: number[] | null
  /** 对应课程阶段（A—M） */
  stageId?: string
  /** 运行环境（缺省 teaching） */
  runEnvironment?: UnitRunEnvironment
  /** 预计时长（分钟） */
  estimatedMinutes?: number
  /** 验收标准（与“目标输出”区分：这是通过条件，不是终端输出） */
  acceptanceCriteria?: string[]
  /** 完成证据清单 */
  evidenceChecklist?: string[]
}

export type Lesson = {
  id: string
  language: LanguageId
  languageLabel: string
  label: string
  title: string
  description: string
  duration: string
  level: string
  progress: number
  code: string
  flow: FlowNode[]
  insight: string
  fileName: string
  runtime: string
  content: LessonUnit
  /**
   * LINK-05：资料库正式内容标识。存在时本课来自内容快照（contentId），
   * 不存在则为旧内置课程（legacy）。
   */
  contentId?: string
  /** 资料库条目：内容科目（与可执行语言分开，如 "Vue 3"） */
  subject?: string
  /**
   * 内容科目分组键（LINK-07 修复）：列表与筛选按**科目**分组，
   * 不再把 HTML/CSS/Vue/Webpack/Linux 硬塞进五种可执行语言。
   */
  subjectId?: string
  /** 科目展示名与简称（用于科目选择器） */
  subjectLabel?: string
  subjectShort?: string
  /** true 表示旧内置课程，未迁移到资料库；不得当作资料库已确认事实 */
  legacy?: boolean
  /** 本页是否可自动执行（外部框架/工具为 false） */
  executable?: boolean
  /** 来源定位与核验状态；旧内置课程没有该字段 */
  source?: LessonSource
  /** 主题原文（资料库正文），供阅读区渲染；不在 TS 里维护第二份教材 */
  reading?: LessonReading
  /** 本课关联的练习契约（题干、starterCode、用例来自资料库） */
  exercise?: LessonExerciseRef
  /** 验收与证据（来自练习契约或资料库编排） */
  acceptance?: { rubric: string[]; evidenceChecklist: string[]; testCases: string[]; hints: string[] }
}

export type LessonSource = {
  path: string
  headingPath: string[]
  verificationStatus: string
  sourceIds: string[]
  contentHash?: string
}

export type LessonReading = {
  markdown: string
  path: string
  headingPath: string[]
  verificationStatus: string
  headings: { level: number; title: string; line: number }[]
}

export type LessonExerciseRef = {
  exerciseId: string
  title: string
  prompt: string
  starterCode: string
  starterLanguage: string
  expectedOutput: string[]
  executionPolicy: ExecutionTier
}

export type ProjectFile = { id: string; name: string; language: LanguageId; code: string; updatedAt: string }
export type ProjectCheckpoint = { id: string; at: string; files: ProjectFile[] }
export type Project = {
  id: string
  name: string
  description: string
  files: ProjectFile[]
  updatedAt: string
  /** 手动保存点（F6）：本地保留最近 10 个，超出按时间淘汰 */
  checkpoints?: ProjectCheckpoint[]
}

export type Challenge = {
  id: string
  stageId: string
  /** 所属学习轨道，如 “Java 后端”“前端工程化” */
  track: string
  title: string
  description: string
  language: LanguageId
  /** 真实技术栈标签，用于展示本关卡的交付环境 */
  stack: string[]
  difficulty: '入门' | '基础' | '进阶'
  /**
   * 运行方式：
   * - javascript-sandbox：浏览器沙箱真实执行
   * - teaching：教学运行器（仅支持子集语法）
   * - external：外部环境实验（真实编译器/数据库/部署），不能由教学模拟器冒充
   */
  runner: ChallengeRunner
  prerequisites: string[]
  starterCode: string
  /** 期望输出 / 验收点 */
  targetOutput: string[]
  /**
   * 判定口径（CHAL-02 第 1 条）。不写就走默认 `exact-lines`：验收点必须**整行相等**，
   * 一行只能被一个验收点用掉。改版前的子串包含会把期望 `1` 判成被输出 `10` 满足。
   */
  judgeMode?: ChallengeJudgeMode
  /** 需要留下的证据清单 */
  evidence: string[]
  hint: string
  explanation: string
}

/** 一条挑战提交记录（持久化在本地，按账户隔离） */
export type ChallengeRecord = {
  completedAt: string
  /** 提交时的输出或证据摘要 */
  evidence: string
  /** 进度状态（R4）：仅 passed/verified 计入“已通过”；submitted 为待人工确认 */
  status?: ChallengeProgressStatus
  /** 用户选择的学习状态（用于未通过时保留轨迹） */
  observation?: AchievementObservation
  /** 执行等级（R4）：产生该记录的运行可信度来源 */
  tier?: ExecutionTier
  /** 判定这条记录所用的口径（CHAL-02）。旧记录没有这个字段，界面如实标注为旧版记录。 */
  judgeMode?: ChallengeJudgeMode
}

/**
 * 进度状态机（R4 G.3 第 3 条）：
 * - none：未提交
 * - submitted：已提交，等待人工确认（外部证据不能自动判定为通过）
 * - verified：已人工确认（本机可复现的外部证据）
 * - passed：本机自动验证通过（沙箱/教学运行器输出与验收点一致）
 * - rejected：确认不通过
 */
export type ChallengeProgressStatus = 'none' | 'submitted' | 'verified' | 'passed' | 'rejected'

/** passed/verified 视为“已完成”，submitted 仅为“已提交待确认” */
export function isPassedStatus(status: ChallengeProgressStatus | undefined): boolean {
  return status === 'passed' || status === 'verified'
}

/**
 * STAT-01：单条挑战记录是否计入“已通过”的唯一判定。
 *
 * 与 `isPassedStatus` 的区别是显式处理历史数据：v1 时代是布尔值，迁移后可能仍有个别
 * 记录缺失 `status`，按既有迁移语义视为已通过。所有统计口径（挑战页、个人中心、
 * 学习分析、通知）都必须复用本函数，禁止各写一套判断。
 */
export function isPassedRecord(record: ChallengeRecord | undefined): boolean {
  if (!record) return false
  return record.status === undefined ? true : isPassedStatus(record.status)
}

/**
 * 学员对自身学习结果的观察标注（R4）。
 * 注意：observation 由学员自己标注，不参与通过判定，也不谎称系统已验证。
 */
export type AchievementObservation = 'completed' | 'partially-completed' | 'attempted'

export type ChallengeSubmission = {
  challengeId: string
  /** 提交状态：外部关卡只能是 submitted/verified，不能自动 passed */
  status: ChallengeProgressStatus
  output: string[]
  evidence: string
  /** 执行等级：产生该提交的运行可信度来源 */
  tier: ExecutionTier
  /** 判定这条提交所用的口径（CHAL-02）；外部关卡不做输出判定，留空 */
  judgeMode?: ChallengeJudgeMode
  /** 学员主观标注（可选，不参与通过判定） */
  observation?: AchievementObservation
}

export type VariableValue = {
  name: string
  value: string
  type: string
  color: 'blue' | 'coral'
}

export type TraceEventType = 'start' | 'line' | 'assign' | 'condition' | 'branch' | 'loop' | 'output' | 'end' | 'error'

export type TraceEvent = {
  id: string
  type: TraceEventType
  line: number
  label: string
  detail: string
  variables: VariableValue[]
  nodeId?: string
}

export type ExecutionResult = {
  events: TraceEvent[]
  output: string[]
  error?: { line: number; message: string }
  /** 本次结果的可信度来源（R4）：不存在则视为未知，禁止按通过处理 */
  tier?: ExecutionTier
  /** 运行器无法识别代码结构时的显式状态（R4 G.3 第 5 条），禁止猜测成功 */
  unsupported?: boolean
}

export type RunStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error'
