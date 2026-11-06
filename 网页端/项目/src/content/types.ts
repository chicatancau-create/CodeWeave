/**
 * 内容快照的类型（与 server/content/compiler.mjs 产出的 bundle 对齐）。
 *
 * 这些类型只描述**派生内容包**；知识正文的权威位置始终是资料库。
 * 应用侧不得在这里再维护一份教学正文。
 */

/** 内容来源性质：vault=资料库正式内容；legacy-fallback=未连接时的旧内置课程；none=无可用内容。 */
export type ContentSourceKind = 'vault' | 'legacy-fallback' | 'none'

/** 与 server/content/snapshot.mjs 的 STATUS 对齐。 */
export type ContentState =
  | 'unconfigured'
  | 'scanning'
  | 'validating'
  | 'ready'
  | 'invalid'
  | 'unavailable'
  | 'error'

export type SnapshotHeading = { level: number; title: string; line: number }

export type SnapshotReading = {
  path: string
  headingPath: string[]
  headings: SnapshotHeading[]
  markdown: string
  contentHash: string
  fileHash: string
  verificationStatus: string
}

export type SnapshotSectionRef = { path: string; headingPath: string[] }

export type SnapshotLesson = {
  contentId: string
  primaryTopicId: string
  title: string
  /** 内容科目（如 Java、JavaScript、Vue 3），与「可执行语言」分开 */
  subject: string
  /** 可执行语言标识；none 表示本页不自动执行 */
  language: string
  objective: string
  lessonKind: 'reading' | 'example' | 'guided' | 'exercise' | 'project'
  stageIds: string[]
  prerequisiteRefs: string[]
  exerciseIds: string[]
  projectTaskRef: string | null
  runEnvironment: 'teaching' | 'external'
  executionPolicy: 'worker' | 'teaching' | 'external'
  estimatedMinutes: number | null
  reviewOffsetsDays: number[] | null
  verificationStatus: string
  sourceIds: string[]
  status: string
  legacyRefs: string[]
  reading: SnapshotReading | null
  /** 仅详情响应带回；目录摘要不含该字段 */
  sectionRefs?: SnapshotSectionRef[]
  /** 目录摘要提供的来源定位（详情响应里由 reading 提供） */
  sourcePath?: string | null
  sourceHeadingPath?: string[] | null
  exerciseCount: number
  sourceHash: string
}

export type SnapshotExercise = {
  exerciseId: string
  primaryLessonId: string
  supportingTopicIds: string[]
  title: string
  prompt: string
  inputConvention: string
  testCases: string[]
  hintLevels: string[]
  executionPolicy: 'worker' | 'teaching' | 'external'
  language: string
  version: number
  starterCode: string
  starterLanguage: string
  expectedOutput: string[]
  evidenceChecklist: string[]
  rubric: string[]
  source: { path: string; sourceHash: string }
}

export type SnapshotStage = {
  id: string
  title: string
  checkpoint: string
  deliverables: string[]
  prerequisites: string[]
}

export type SnapshotMilestone = { id: string; name: string; stages: string[]; checkpoint: string }
export type SnapshotMasteryLevel = { level: number; meaning: string }
export type SnapshotHintLevel = { id: string; name: string; meaning: string }

export type SnapshotRules = {
  status: 'current' | 'stale' | 'missing'
  reason?: string
  sourceRefs?: { path: string; headingPath: string[] }[]
  stages?: SnapshotStage[]
  milestones?: SnapshotMilestone[]
  masteryLevels?: SnapshotMasteryLevel[]
  masteryRule?: string
  hintLevels?: SnapshotHintLevel[]
  reviewOffsetsDays?: number[]
}

export type ContentSnapshot = {
  bundleId: string
  schemaVersion: number
  buildTime: string
  rules: SnapshotRules
  stages: SnapshotStage[]
  milestones: SnapshotMilestone[]
  masteryLevels: SnapshotMasteryLevel[]
  hintLevels: SnapshotHintLevel[]
  reviewOffsetsDays: number[]
  lessons: SnapshotLesson[]
  counts: Record<string, number> | null
}

export type ContentStatusResponse = {
  state: ContentState
  vaultConfigured: boolean
  vaultReason: string | null
  bundleId: string | null
  buildTime: string | null
  publishedAt: string | null
  counts: Record<string, number> | null
  rulesStatus: string | null
  stale: boolean
  lastError: { code: string; message: string } | null
  lastReport: {
    finishedAt: string
    blockingCount: number
    gaps: Record<string, number> | null
    rules: { status: string; reason: string } | null
  } | null
}

// ---------------------------------------------------------------------------
// LINK-08：学习事实（只读投影）
// ---------------------------------------------------------------------------

/** 拥有者绑定与教材可见范围（不含任何进度内容）。 */
export type LearningStatus = {
  bound: boolean
  isOwner: boolean
  vaultId: string | null
  vaultMatches: boolean
  publicContent: boolean
  contentAccess: { allowed: boolean; reason: string }
  progressAccess: boolean
  boundAt: string | null
  recordCorrupt: boolean
  notice: string
}

/**
 * 掌握等级：**只有 `N 级` 是确定数值**。
 * `无法确认` 与 `0—1 级` 必须保持原样，不作为整数使用（方案 §10.1）。
 */
export type MasteryLevel =
  | { kind: 'numeric'; value: number; label: string }
  | { kind: 'range'; low: number; high: number; label: string }
  | { kind: 'uncertain'; label: string }

export type ProgressSnapshotItem = {
  label: string
  value: string
  valueRaw: string
  evidence: string
}

export type VaultProgress = {
  schemaVersion: number
  status: 'ok' | 'partial' | 'structure_unsupported' | 'missing'
  source: { path: string; fileHash: string; parsedAt: string }
  header: {
    structureUpdatedOn: string | null
    environmentVerifiedOn: string | null
    latestEvidenceOn: string | null
    raw: string
  } | null
  snapshot: {
    items: ProgressSnapshotItem[]
    currentStage: ProgressSnapshotItem | null
    stageProgress: ProgressSnapshotItem | null
    stagePassable: ProgressSnapshotItem | null
    nextStage: ProgressSnapshotItem | null
    deadline: ProgressSnapshotItem | null
    mainBlocker: ProgressSnapshotItem | null
  }
  mastery: {
    rows: { skill: string; level: MasteryLevel; levelRaw: string; status: string | null; evidence: string }[]
    raw: string
    note: string
  }
  nextActions: {
    rows: { order: string; action: string; actionRaw: string; deliverable: string; relation: string; done: boolean }[]
    raw: string
  }
  stages: { rows: { id: string; name: string; status: string; note: string; raw: string }[]; raw: string }
  environment: { rows: { name: string; status: string; version: string; evidence: string }[]; raw: string; conclusion: string }
  handoff: { rows: { field: string; value: string }[]; raw: string }
  unparsed: { key: string; scope: 'section' | 'value'; reason: string; raw: string }[]
  readOnlyNotice: string
}

// ---------------------------------------------------------------------------
// LINK-09：确认式写回
// ---------------------------------------------------------------------------

export type EvidenceRanBy = 'learner' | 'ai_assistant' | 'unknown'
export type EvidenceHintLevel = 'L1' | 'L2' | 'L3' | 'L4' | null
export type EvidenceState = 'pending' | 'synced' | 'partial'

/** 暂存证据（步骤 1，只落应用数据，不改资料库）。 */
export type StagedEvidence = {
  schemaVersion: number
  evidenceId: string
  userId: string
  state: EvidenceState
  createdAt: string
  operationId: string | null
  syncedAt: string | null
  logPath: string | null
  at: string
  topic: string
  stage: string | null
  contentId: string | null
  exerciseId: string | null
  bundleId: string | null
  expected: string
  actual: string
  ranBy: EvidenceRanBy
  independent: boolean
  hintLevel: EvidenceHintLevel
  artifacts: string[]
  unfinished: string[]
  notes: string
}

/** 暂存表单输入（不包含服务端生成的 ID 与状态）。 */
export type EvidenceInput = Omit<
  StagedEvidence,
  'schemaVersion' | 'evidenceId' | 'userId' | 'state' | 'createdAt' | 'operationId' | 'syncedAt' | 'logPath'
>

export type EvidenceQueue = { pending: StagedEvidence[]; synced: StagedEvidence[] }

/** 进度追踪的逐字段差异（预览展示；冲突时对照第三方改动）。 */
export type FieldDiff = { field: string; before?: string; after?: string; previewed?: string; current?: string }

export type WritebackTarget = {
  path: string
  kind: 'log' | 'progress' | 'index'
  exists: boolean
  expectedHash: string | null
  preview: unknown
}

export type WritebackPreview = {
  operationId: string
  evidenceIds: string[]
  at: string
  topic: string
  targets: WritebackTarget[]
  masteryBlocked: { skill: string; level: string; reason: string }[]
  conflicts: { path: string; kind: string; reason: string }[]
  notices: string[]
}

export type WritebackCommitResult = {
  synced: boolean
  idempotent: boolean
  operationId: string
  at?: string
  topic?: string
  targets: { path: string; kind: string; applied: boolean; skipped?: boolean }[]
}

export type EvidenceExportResult = { markdown: string; evidenceIds: string[]; logPath: string }

/** 冲突详情（HTTP 409）：逐字段差异，不按时间戳决胜。 */
export type WritebackConflictDetails = {
  code: string
  files: { path: string; kind: string; reason: string; fieldDiffs: FieldDiff[] }[]
  logSaved?: boolean
  progressPending?: boolean
}