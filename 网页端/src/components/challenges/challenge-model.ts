import type {
  AchievementObservation,
  Challenge,
  ChallengeRecord,
  LanguageId,
  Lesson,
} from '../../types/lesson'
import { isPassedRecord } from '../../types/lesson'

export type RunnerFilter = 'all' | 'browser' | 'teaching' | 'external'
export type StatusFilter = 'all' | 'not-started' | 'ran' | 'passed' | 'pending'
export type SortMode = 'stage' | 'status' | 'difficulty'

export type ChallengeFilters = {
  /** 主筛选：搜索关键字（匹配标题 / 技术栈 / 说明 / 阶段） */
  q: string
  /** 主筛选：阶段（A—M） */
  stage: string
  track: string
  difficulty: string
  runner: RunnerFilter
  status: StatusFilter
  sort: SortMode
}

/**
 * 派生状态（R4）：passed/pending-verify 来自持久化记录；
 * external-pending / unsupported / ready-to-submit 只在当前会话有效。
 */
export type CardStatus = 'not-started' | 'external-pending' | 'unsupported' | 'ready-to-submit' | 'pending-verify' | 'passed'

export const STATUS_LABEL: Record<CardStatus, string> = {
  'not-started': '未开始',
  'external-pending': '待实验',
  unsupported: '未识别',
  'ready-to-submit': '待验证',
  'pending-verify': '待人工确认',
  passed: '已通过',
}

export const STATUS_RANK: Record<CardStatus, number> = {
  'not-started': 0,
  'external-pending': 1,
  unsupported: 2,
  'ready-to-submit': 3,
  'pending-verify': 4,
  passed: 5,
}

export const DIFFICULTY_ORDER = ['入门', '基础', '进阶']

/**
 * R4 学习状态标注（`AchievementObservation`）：由学员自己标注，**不参与通过判定**，
 * 也不谎称系统已验证。人工确认时顺手带上它，是为了让记录留下「当时学员怎么说」。
 */
export const OBSERVATION_OPTIONS: { value: AchievementObservation; label: string }[] = [
  { value: 'completed', label: '我已完成全部验收点' },
  { value: 'partially-completed', label: '部分完成' },
  { value: 'attempted', label: '只做了尝试' },
]

export const RUNNER_FILTER_OPTIONS: { value: RunnerFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'browser', label: '浏览器沙箱验证' },
  { value: 'teaching', label: '教学运行器' },
  { value: 'external', label: '外部环境实验' },
]

export const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'not-started', label: '未开始' },
  { value: 'ran', label: '已运行未提交' },
  { value: 'pending', label: '待人工确认' },
  { value: 'passed', label: '已通过' },
]

export const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'stage', label: '按 A—M 顺序' },
  { value: 'status', label: '按完成状态' },
  { value: 'difficulty', label: '按难度' },
]

export const DEFAULT_FILTERS: ChallengeFilters = {
  q: '',
  stage: 'all',
  track: 'all',
  difficulty: 'all',
  runner: 'all',
  status: 'all',
  sort: 'stage',
}
const FILTERS_STORAGE_KEY = 'code-canvas.challenge-filters.v2'

/** CHAL-01：列表 / 详情两个视图；视图模式、选中题与页码一起持久化到 sessionStorage。 */
export type ViewMode = 'list' | 'detail'
export type ChallengeViewState = { mode: ViewMode; selectedId: string; page: number }
const VIEW_STORAGE_KEY = 'code-canvas.challenge-view.v2'
export const PAGE_SIZE = 12

export function loadFilters(): ChallengeFilters {
  try {
    const raw = sessionStorage.getItem(FILTERS_STORAGE_KEY)
    if (!raw) return DEFAULT_FILTERS
    const merged = { ...DEFAULT_FILTERS, ...(JSON.parse(raw) as Partial<ChallengeFilters>) }
    if (!RUNNER_FILTER_OPTIONS.some((option) => option.value === merged.runner)) merged.runner = 'all'
    if (!STATUS_FILTER_OPTIONS.some((option) => option.value === merged.status)) merged.status = 'all'
    if (!SORT_OPTIONS.some((option) => option.value === merged.sort)) merged.sort = 'stage'
    if (typeof merged.q !== 'string') merged.q = ''
    return merged
  } catch {
    return DEFAULT_FILTERS
  }
}

export function saveFilters(filters: ChallengeFilters): void {
  try {
    sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters))
  } catch {
    // 隐私模式等写入失败时退化为会话内状态
  }
}

export function loadViewState(challenges: Challenge[]): ChallengeViewState {
  try {
    const raw = sessionStorage.getItem(VIEW_STORAGE_KEY)
    if (!raw) return { mode: 'list', selectedId: '', page: 1 }
    const parsed = JSON.parse(raw) as Partial<ChallengeViewState>
    const selectedId =
      typeof parsed.selectedId === 'string' && challenges.some((challenge) => challenge.id === parsed.selectedId)
        ? parsed.selectedId
        : ''
    return {
      mode: parsed.mode === 'detail' && selectedId ? 'detail' : 'list',
      selectedId,
      page: Number.isInteger(parsed.page) && (parsed.page as number) > 0 ? (parsed.page as number) : 1,
    }
  } catch {
    return { mode: 'list', selectedId: '', page: 1 }
  }
}

export function saveViewState(state: ChallengeViewState): void {
  try {
    sessionStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 隐私模式等写入失败时退化为会话内状态
  }
}

export function cardStatus(
  challenge: Challenge,
  record: ChallengeRecord | undefined,
  sessionStatus: 'ran' | 'unsupported' | undefined,
): CardStatus {
  // STAT-01：与统计口径共用同一判定（含无 status 的旧记录按迁移语义视为通过）。
  if (!record) {
    if (challenge.runner === 'external') return 'external-pending'
    if (sessionStatus === 'unsupported') return 'unsupported'
    if (sessionStatus === 'ran') return 'ready-to-submit'
    return 'not-started'
  }
  if (record.status === 'submitted') return 'pending-verify'
  if (isPassedRecord(record)) return 'passed'
  if (challenge.runner === 'external') return 'external-pending'
  if (sessionStatus === 'unsupported') return 'unsupported'
  if (sessionStatus === 'ran') return 'ready-to-submit'
  return 'not-started'
}

/* §5.2「明确的提交与草稿状态」：两个信息区各自只说一件事。
   —— submitted 区读的是**已写入进度的记录**（passed/verified/submitted），不随编辑器改动；
   —— draft 区读的是**本机未提交的草稿**，只有在这里才可能出现提交动作。
   判定与三分支的先后顺序沿用改版前的条件，未改动任何通过/待确认口径。 */
export function submissionPhase(record: ChallengeRecord | undefined): {
  passedRecord: boolean
  submittedRecord: boolean
  showSubmitAction: boolean
} {
  const passedRecord = Boolean(
    record && (record.status === 'passed' || record.status === 'verified' || !record.status),
  )
  const submittedRecord = Boolean(record && record.status === 'submitted')
  const showSubmitAction = !passedRecord && !submittedRecord
  return { passedRecord, submittedRecord, showSubmitAction }
}

export function shortTitle(title: string): string {
  return title.replace(/^[A-M] 关卡验收：/, '')
}

/* ----------------------------------------------------------------------------
   §5.2「挑战与项目 = 编号列表 + 轻边界信息区 + 明确的提交与草稿状态」
   编号是**渲染进 DOM 的真实文本**（可复制、可读屏、可搜索），不用 `counter()`
   注入 —— 见 前端分工程方案 §8 第 4 条：伪元素文字会插进辅助技术的朗读顺序。
   -------------------------------------------------------------------------- */

/** 两位补零：让 01/02/…/13 在等宽列里对齐（编号承担骨架定位，故必须成列）。 */
export function padOrdinal(value: number): string {
  return String(value).padStart(2, '0')
}

/** 关卡序号：按 `challenges` 的 A—M 原始顺序编号，筛选与排序不改变身份。 */
export function buildSequence(challenges: Challenge[]): Map<string, string> {
  const map = new Map<string, string>()
  challenges.forEach((challenge, index) => map.set(challenge.id, padOrdinal(index + 1)))
  return map
}

/** 本机时间戳（草稿留痕只到分钟，不到秒：秒级跳动能让人误读成「一直在保存」）。 */
export function formatSavedAt(iso: string): string {
  if (!iso) return '时间未记录'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '时间未记录'
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** 代码草稿状态：只描述**本机未提交**的改动，绝不暗示已提交或已通过。 */
export function describeCodeDraft(draft: { code?: string; savedAt: string } | undefined): string {
  if (!draft || draft.code === undefined) return '本机无代码草稿，编辑器当前显示起始代码'
  if (!draft.code.trim()) return '本机代码草稿为空（已清空起始代码），尚未提交'
  return `本机代码草稿已保存（${draft.code.split('\n').length} 行 · ${formatSavedAt(draft.savedAt)}），尚未提交`
}

/** 证据草稿状态：提交前的缺口要写成文字，不能只靠按钮禁用表达。 */
export function describeEvidenceDraft(note: string): string {
  const length = note.trim().length
  if (length === 0) return '证据说明草稿为空 —— 填写后即可提交，当前仅存于本机'
  return `证据说明草稿 ${length} 字，尚未提交`
}

/** 卡片上的执行环境短标签（完整标签见 RUNNER_LABELS） */
export const RUNNER_SHORT: Record<Challenge['runner'], string> = {
  'javascript-sandbox': '浏览器沙箱',
  teaching: '教学运行器',
  external: '外部环境实验',
}

export const RUNNER_LABELS: Record<Challenge['runner'], string> = {
  'javascript-sandbox': '浏览器沙箱真实执行',
  teaching: '教学运行器（子集语法）',
  external: '外部环境实验',
}

export const LANGUAGE_EXTENSIONS: Record<Challenge['language'], string> = {
  python: 'py',
  javascript: 'js',
  c: 'c',
  csharp: 'cs',
  java: 'java',
}

/** CHAL-01：搜索匹配标题 / 轨道 / 说明 / 技术栈 / 阶段，大小写不敏感。 */
export function matchesQuery(challenge: Challenge, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return [challenge.title, challenge.track, challenge.description, challenge.stageId, ...challenge.stack].some(
    (field) => field.toLowerCase().includes(needle),
  )
}

/** DUMMY_LESSON 共享工厂（R4 G.3 第 6 条）：避免手写结构随 Lesson 类型漂移。 */
export function makeRunnerLesson(language: LanguageId, runtime: string, fileName: string): Lesson {
  return {
    id: 'challenge-runner',
    language,
    languageLabel: '挑战运行器',
    label: '00',
    title: '挑战',
    description: '挑战运行器',
    duration: '-',
    level: '-',
    progress: 0,
    code: '',
    flow: [],
    insight: '',
    fileName,
    runtime,
    content: {
      objective: '',
      prerequisites: [],
      explanation: [],
      examples: [],
      guidedSteps: [],
      exercise: '',
      variant: '',
      projectTask: '',
      mistakes: [],
      runCommand: '',
      completion: '',
      reviewOffsetsDays: [],
    },
  }
}
