/**
 * 内容适配（LINK-05）：把资料库内容快照适配成现有页面使用的 Lesson / CurriculumStage。
 *
 * 为什么用适配而不是重写页面：
 * - 工作台、挑战页、搜索、掌握度都建立在 Lesson 形状上；
 *   先统一**数据入口**（快照），页面结构保持不变，风险限制在数据层。
 * - 旧内置课程（src/data/lessons.ts）在本轮作为“未迁移的旧记录”保留并标注 legacy；
 *   阶段、来源、练习一律以资料库为准，不允许静默退回旧教材当正式内容。
 *
 * 两级数据：
 * - 目录（catalog）只给摘要，用于课程列表、搜索、阶段树；
 * - 详情（lesson detail）才带主题原文与练习契约，进入工作台时按需拉取。
 */
import type { CurriculumStage } from '../data/curriculum'
import { curriculumStages as legacyStages } from '../data/curriculum'
import { lessons as legacyLessons } from '../data/lessons'
import type { LanguageId, Lesson, LessonUnit } from '../types/lesson'
import type { ContentSnapshot, SnapshotExercise, SnapshotLesson } from './types'

const LANGUAGE_IDS: readonly LanguageId[] = ['python', 'javascript', 'csharp', 'java', 'c']

/**
 * 科目归一（LINK-07 修复）。
 *
 * 背景：旧数据只有 `LanguageId` 五种可执行语言，HTML/CSS/Vue/Webpack/Linux 等科目
 * 只能借用某个语言 id（例如把 Vue 单元塞进 javascript），导致科目筛选与列表错乱。
 * 这里为「内容科目」建立独立分组键：能执行的科目与可执行语言一一对应，
 * 框架/工具类科目单独成组。
 */
const SUBJECT_OVERRIDES: Record<string, { id: string; label: string; short: string }> = {
  'JavaScript DOM': { id: 'javascript', label: 'JavaScript', short: 'JS' },
  'Vue 3': { id: 'vue3', label: 'Vue 3', short: 'Vue' },
  'Webpack 5': { id: 'webpack', label: 'Webpack 5', short: 'Wp' },
  CSharp: { id: 'csharp', label: 'C#', short: 'C#' },
  'C#': { id: 'csharp', label: 'C#', short: 'C#' },
  HTML: { id: 'html', label: 'HTML', short: 'H5' },
  CSS: { id: 'css', label: 'CSS', short: 'CSS' },
}

const SUBJECT_COLORS: Record<string, string> = {
  python: 'blue',
  c: 'teal',
  csharp: 'purple',
  java: 'orange',
  javascript: 'yellow',
  html: 'coral',
  css: 'cyan',
  vue3: 'green',
  webpack: 'blue',
  http: 'teal',
  mysql: 'orange',
  spring: 'green',
  springboot: 'purple',
  mybatis: 'coral',
  springcloud: 'yellow',
  linux: 'cyan',
  docker: 'blue',
  nginx: 'green',
  security: 'coral',
  project: 'purple',
}

/** 科目键：非法字符折叠为 `-`，中文科目保留原样（便于阅读）。 */
export function subjectKeyOf(label: string): string {
  const override = SUBJECT_OVERRIDES[label]
  if (override) return override.id
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[#]/g, 'sharp')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'other'
}

export function subjectMetaOf(label: string, fallbackShort: string): { id: string; label: string; short: string; color: string } {
  const override = SUBJECT_OVERRIDES[label]
  const id = subjectKeyOf(label)
  return {
    id,
    label: override?.label ?? label,
    short: override?.short ?? fallbackShort,
    color: SUBJECT_COLORS[id] ?? 'blue',
  }
}

/** 简短标签：取科目名首 2 个字符，中文按字符、英文按大写字母。 */
function shortLabelOf(label: string): string {
  const override = SUBJECT_OVERRIDES[label]
  if (override) return override.short
  const ascii = label.match(/[A-Za-z]/g)
  if (ascii && ascii.length >= 2 && /^[A-Za-z]/.test(label)) return ascii.slice(0, 2).join('').toUpperCase()
  return label.slice(0, 2)
}

export type SubjectOption = {
  id: string
  label: string
  short: string
  color: string
  lessonCount: number
  /** 该科目是否含资料库正式内容 */
  hasVaultContent: boolean
  /** 该科目是否可自动执行（HTML/CSS/Vue/构建工具等为 false） */
  executable: boolean
}

/**
 * 由课程列表汇总科目选项：
 * 含资料库正式内容的科目排在前，其次按课程数，最后按名称稳定排序。
 */
export function collectSubjects(lessons: Lesson[]): SubjectOption[] {
  const map = new Map<string, SubjectOption>()
  for (const lesson of lessons) {
    const id = lesson.subjectId ?? subjectKeyOf(lesson.languageLabel)
    const existing = map.get(id)
    if (existing) {
      existing.lessonCount += 1
      existing.hasVaultContent = existing.hasVaultContent || lesson.contentId !== undefined
      existing.executable = existing.executable || lesson.executable !== false
      continue
    }
    const meta = subjectMetaOf(lesson.languageLabel, shortLabelOf(lesson.languageLabel))
    map.set(id, {
      id,
      label: meta.label,
      short: meta.short,
      color: meta.color,
      lessonCount: 1,
      hasVaultContent: lesson.contentId !== undefined,
      executable: lesson.executable !== false,
    })
  }
  return [...map.values()].sort((a, b) => {
    if (a.hasVaultContent !== b.hasVaultContent) return a.hasVaultContent ? -1 : 1
    if (a.lessonCount !== b.lessonCount) return b.lessonCount - a.lessonCount
    return a.label.localeCompare(b.label, 'zh-Hans-CN')
  })
}

function executableLanguage(language: string): LanguageId | null {
  const value = String(language ?? '').toLowerCase()
  return (LANGUAGE_IDS as readonly string[]).includes(value) ? (value as LanguageId) : null
}

/** 旧内置课程：显式标注 legacy，且不携带资料库来源；科目按旧 languageLabel 归一。 */
export function legacyLessonsWithFlag(): Lesson[] {
  return legacyLessons.map((lesson) => {
    const meta = subjectMetaOf(lesson.languageLabel, shortLabelOf(lesson.languageLabel))
    return {
      ...lesson,
      legacy: true,
      executable: lesson.content.runEnvironment !== 'external',
      subjectId: meta.id,
      subjectLabel: meta.label,
      subjectShort: meta.short,
    }
  })
}

const LEGACY_STAGE_LABELS: Record<string, string> = Object.fromEntries(
  legacyStages.map((stage) => [stage.id, stage.title]),
)

/** 旧阶段标识 → 可读文案（用于说明旧记录为何未计入 S0—S9）。 */
export function legacyStageLabel(stageId: string | undefined): string {
  if (!stageId) return '未标阶段'
  return LEGACY_STAGE_LABELS[stageId] ?? stageId
}

function stageToCurriculum(stage: { id: string; title: string; checkpoint: string; deliverables: string[]; prerequisites: string[] }): CurriculumStage {
  return {
    id: stage.id,
    title: stage.title,
    track: '资料库口径',
    summary: stage.checkpoint,
    topics: [],
    checkpoint: stage.checkpoint,
    deliverables: stage.deliverables,
    prerequisites: stage.prerequisites,
    externalTools: [],
  }
}

export function runCommandLabel(lesson: SnapshotLesson): string {
  if (lesson.executionPolicy === 'external') return '外部环境实验（本机执行，不能由浏览器模拟）'
  if (lesson.executionPolicy === 'worker') return '浏览器 Worker 沙箱（真实执行纯计算）'
  if (lesson.executionPolicy === 'teaching') return '教学运行器（子集语法，非真实编译器）'
  return '未设定执行方式'
}

function levelLabel(lesson: SnapshotLesson): string {
  const stageIds = lesson.stageIds ?? []
  if (lesson.executionPolicy === 'external') return '外部环境'
  if (lesson.lessonKind === 'reading') return '阅读'
  return stageIds[0] ? `阶段 ${stageIds[0]}` : '未标阶段'
}

export type AdaptedContent = {
  lessons: Lesson[]
  /** 新口径阶段（S0—S9）；规则待审核或未连接时为空 */
  stages: CurriculumStage[]
  /** 旧口径阶段（A—M），只用于标注旧记录 */
  legacyStages: CurriculumStage[]
}

/**
 * #33 裁定 1：延迟复测排期的**运行时标准**是资料库发布规则里的默认节点，不是客户端常量。
 * 目录接口把这条规则放在**顶层** `reviewOffsetsDays`（`server/content/index.mjs:344`），
 * 存储的 bundle 放在 `rules.reviewOffsetsDays`（`server/content/compiler.mjs:1178`），两处都读，任一非空即认。
 *
 * 为什么镜像成模块状态而不是走 context：`ContentContextValue` 只透出 `bundleId / counts / lessons / stages`，
 * 不带 `rules`，而 `provider.tsx` 与 `app.tsx` 不在本次改动范围内。于是由**目录适配处**（唯一看到整份快照的地方）
 * 记一次，读取一律走 `publishedReviewOffsets()`——不在界面或调度里再抄第二份节点列表。
 * `adaptFallback()`（没有快照）会把它清成 `null`，此时排期才落到 `REVIEW_OFFSET_DAYS` 那条兜底常量。
 */
let publishedReviewOffsetsDays: number[] | null = null

/** 当前适配到的发布规则默认复测节点（天）；`null` = 没有快照或规则里没写，此时才用本机兜底。 */
export function publishedReviewOffsets(): number[] | null {
  return publishedReviewOffsetsDays
}

/** 快照里的发布值 → 可信的 `number[] | null`（`[]` 与全非法值都算「规则没写」）。 */
function readPublishedOffsets(snapshot: ContentSnapshot | null): number[] | null {
  const raw = snapshot?.reviewOffsetsDays ?? snapshot?.rules?.reviewOffsetsDays ?? null
  if (!Array.isArray(raw)) return null
  const clean = [...new Set(raw.map(Number).filter((n) => Number.isFinite(n) && n >= 0))].sort((a, b) => a - b)
  return clean.length > 0 ? clean : null
}

/**
 * 目录摘要 → Lesson 列表（不含原文正文，可用于列表与搜索）。
 * `detail` 为空时按摘要构造占位 Lesson，进入工作台后再由详情替换。
 */
export function snapshotSummaryToLesson(lesson: SnapshotLesson): Lesson {
  return buildLesson(lesson, null)
}

function buildLesson(lesson: SnapshotLesson, exercise: SnapshotExercise | null): Lesson {
  const language = executableLanguage(lesson.language)
  const executable = language !== null
  const reading = lesson.reading
  const stageIds = lesson.stageIds ?? []
  const unit: LessonUnit = {
    objective: lesson.objective,
    prerequisites: lesson.prerequisiteRefs ?? [],
    // 讲解正文只存在于资料库原文：这里不复制，阅读区直接渲染主题正文。
    explanation: reading ? ['讲解与示例以上方「主题原文」为准；本页不另存一份教材。'] : [],
    examples: [],
    guidedSteps: [],
    exercise: exercise?.prompt ?? '本单元暂无独立练习契约（缺口已登记在同步报告）。',
    variant: '',
    projectTask: lesson.projectTaskRef ?? '本单元暂无项目任务编排。',
    mistakes: [],
    runCommand: runCommandLabel(lesson),
    completion: exercise?.rubric?.length
      ? `验收标准：${exercise.rubric.join('；')}`
      : '本单元为阅读/编排条目，完成与否以证据清单与阶段测试为准，本页不自动判定掌握。',
    // #33 裁定 2：单元级 `null` 是「本单元没写」，透传成 null 让它继承发布规则；
    // 改版前这里的 `?? []` 把「没写」伪装成「空计划」，而调度端读不懂这层差别。
    reviewOffsetsDays: lesson.reviewOffsetsDays ?? null,
    stageId: stageIds[0],
    runEnvironment: lesson.runEnvironment,
    estimatedMinutes: lesson.estimatedMinutes ?? undefined,
    acceptanceCriteria: exercise?.rubric ?? [],
    evidenceChecklist: exercise?.evidenceChecklist ?? [],
  }
  /**
   * 来源定位有两个来源：目录摘要给 sourcePath/sourceHeadingPath，详情响应给 sectionRefs。
   * 两者都可能缺字段，因此逐级回退而不是直接下标访问（曾因此整页崩溃）。
   */
  const sectionRefs = lesson.sectionRefs ?? []
  const headingPath = reading?.headingPath ?? lesson.sourceHeadingPath ?? sectionRefs[0]?.headingPath ?? []
  const sourcePath = reading?.path ?? lesson.sourcePath ?? sectionRefs[0]?.path ?? ''
  const subjectMeta = subjectMetaOf(lesson.subject, shortLabelOf(lesson.subject))
  return {
    id: lesson.contentId,
    contentId: lesson.contentId,
    language: language ?? 'javascript',
    languageLabel: lesson.subject,
    subject: lesson.subject,
    subjectId: subjectMeta.id,
    subjectLabel: subjectMeta.label,
    subjectShort: subjectMeta.short,
    label: stageIds[0] ?? '—',
    title: lesson.title,
    description: lesson.objective,
    duration: lesson.estimatedMinutes ? `${lesson.estimatedMinutes} min` : '未设定',
    level: levelLabel(lesson),
    progress: 0,
    code: exercise?.starterCode ?? '',
    // 资料库条目没有已核验的流程元数据：不显示假流程图。
    flow: [],
    insight: '',
    fileName: exercise ? `${exercise.exerciseId}.${extensionOf(exercise.language)}` : fileNameOf(sourcePath),
    runtime: runCommandLabel(lesson),
    content: unit,
    legacy: false,
    executable,
    source: {
      path: sourcePath,
      headingPath,
      verificationStatus: reading?.verificationStatus ?? lesson.verificationStatus,
      sourceIds: lesson.sourceIds,
      contentHash: reading?.contentHash,
    },
    reading: reading
      ? {
          markdown: reading.markdown,
          path: reading.path,
          headingPath: reading.headingPath,
          verificationStatus: reading.verificationStatus,
          headings: reading.headings,
        }
      : undefined,
    exercise: exercise
      ? {
          exerciseId: exercise.exerciseId,
          title: exercise.title,
          prompt: exercise.prompt,
          starterCode: exercise.starterCode,
          starterLanguage: exercise.starterLanguage,
          expectedOutput: exercise.expectedOutput,
          executionPolicy: exercise.executionPolicy,
        }
      : undefined,
    acceptance: exercise
      ? {
          rubric: exercise.rubric,
          evidenceChecklist: exercise.evidenceChecklist,
          testCases: exercise.testCases,
          hints: exercise.hintLevels,
        }
      : undefined,
  }
}

const EXTENSIONS: Record<string, string> = { java: 'java', javascript: 'js', python: 'py', c: 'c', csharp: 'cs', none: 'txt', text: 'txt' }

function extensionOf(language: string): string {
  return EXTENSIONS[language] ?? 'txt'
}

function fileNameOf(path: string): string {
  const name = path.split('/').pop()
  return name && name.endsWith('.md') ? name : 'note.md'
}

/** 详情响应 → 工作台使用的完整 Lesson（带原文与练习契约）。 */
export function snapshotDetailToLesson(lesson: SnapshotLesson, exercises: SnapshotExercise[]): Lesson {
  const exerciseIds = lesson.exerciseIds ?? []
  const primary = exercises.find((item) => item.exerciseId === exerciseIds[0]) ?? exercises[0] ?? null
  return buildLesson(lesson, primary)
}

/** 目录 + 旧内置课程 → 页面数据。字段做防御性兜底：快照缺字段时不能整页崩掉。 */
export function adaptCatalog(snapshot: ContentSnapshot): AdaptedContent {
  const lessons = Array.isArray(snapshot.lessons) ? snapshot.lessons : []
  const stages = Array.isArray(snapshot.stages) ? snapshot.stages : []
  // 顺手记下发布规则里的默认复测节点（排期标准的唯一读取口，见上面的注释）。
  publishedReviewOffsetsDays = readPublishedOffsets(snapshot)
  return {
    lessons: [...lessons.map(snapshotSummaryToLesson), ...legacyLessonsWithFlag()],
    stages: stages.map(stageToCurriculum),
    legacyStages: legacyStages,
  }
}

/** 无快照（未连接/未登录/无发布内容）时的显式回退：只给旧内置课程，排期也就没有发布规则可读。 */
export function adaptFallback(): AdaptedContent {
  publishedReviewOffsetsDays = null
  return {
    lessons: legacyLessonsWithFlag(),
    stages: [],
    legacyStages: legacyStages,
  }
}