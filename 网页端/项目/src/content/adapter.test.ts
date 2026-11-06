/**
 * 内容适配回归测试（LINK-05）。
 *
 * 重点防的是真实浏览器里出现过的一次整页崩溃：
 * 目录摘要不含 `sectionRefs`，适配时用 `lesson.sectionRefs[0]` 直接下标 → TypeError。
 * 这里对「摘要形状」与「详情形状」两种输入都做断言，保证两种响应都能渲染。
 */
import { describe, expect, it } from 'vitest'
import {
  adaptCatalog,
  adaptFallback,
  collectSubjects,
  runCommandLabel,
  snapshotDetailToLesson,
  snapshotSummaryToLesson,
  subjectKeyOf,
  legacyLessonsWithFlag,
} from './adapter'
import type { ContentSnapshot, SnapshotExercise, SnapshotLesson } from './types'

const baseLesson: SnapshotLesson = {
  contentId: 'cw-test-001',
  primaryTopicId: 'topic-0001',
  title: '测试单元',
  subject: 'Java',
  language: 'java',
  objective: '目标',
  lessonKind: 'exercise',
  stageIds: ['S1'],
  prerequisiteRefs: [],
  exerciseIds: ['ex-1'],
  projectTaskRef: null,
  runEnvironment: 'teaching',
  executionPolicy: 'teaching',
  estimatedMinutes: 20,
  reviewOffsetsDays: [0, 1],
  verificationStatus: '外部未复核',
  sourceIds: ['SRC-COURSE-05'],
  status: 'published',
  legacyRefs: ['java-03'],
  reading: null,
  exerciseCount: 1,
  sourceHash: 'hash',
}

/** 目录摘要形状：没有 sectionRefs、没有 reading。 */
const summaryLesson: SnapshotLesson = {
  ...baseLesson,
  sourcePath: '复习大纲/01-测试/测试.md',
  sourceHeadingPath: ['测试', '单元'],
}

const detailLesson: SnapshotLesson = {
  ...baseLesson,
  sectionRefs: [{ path: '复习大纲/01-测试/测试.md', headingPath: ['测试', '单元'] }],
  reading: {
    path: '复习大纲/01-测试/测试.md',
    headingPath: ['测试', '单元'],
    headings: [{ level: 3, title: '核心概念', line: 1 }],
    markdown: '### 核心概念\n\n- 一条概念（来源：fixture）',
    contentHash: 'c1',
    fileHash: 'f1',
    verificationStatus: '外部未复核',
  },
}

const exercise: SnapshotExercise = {
  exerciseId: 'ex-1',
  primaryLessonId: 'cw-test-001',
  supportingTopicIds: ['topic-0001'],
  title: '测试练习',
  prompt: '写出分支',
  inputConvention: '直接改值',
  testCases: ['a=1 => 1'],
  hintLevels: ['L1 方向提示'],
  executionPolicy: 'teaching',
  language: 'java',
  version: 1,
  starterCode: 'int a = 1;',
  starterLanguage: 'java',
  expectedOutput: ['1'],
  evidenceChecklist: ['输出记录'],
  rubric: ['输出正确'],
  source: { path: 'CodeWeave/练习/ex-1.md', sourceHash: 'h' },
}

const snapshot: ContentSnapshot = {
  bundleId: 'bundle-1',
  schemaVersion: 1,
  buildTime: '2026-09-18T00:00:00.000Z',
  rules: { status: 'current' },
  stages: [{ id: 'S1', title: '语言核心', checkpoint: '通过', deliverables: ['项目'], prerequisites: [] }],
  milestones: [],
  masteryLevels: [],
  hintLevels: [],
  reviewOffsetsDays: [],
  lessons: [summaryLesson],
  counts: { lessons: 1 },
}

describe('内容适配', () => {
  it('目录摘要（无 sectionRefs / 无正文）也能适配，不抛下标错误', () => {
    const lesson = snapshotSummaryToLesson(summaryLesson)
    expect(lesson.id).toBe('cw-test-001')
    expect(lesson.source?.path).toBe('复习大纲/01-测试/测试.md')
    expect(lesson.source?.headingPath).toEqual(['测试', '单元'])
    expect(lesson.reading).toBeUndefined()
    expect(lesson.code).toBe('')
    expect(lesson.flow).toEqual([])
    expect(lesson.legacy).toBe(false)
  })

  it('详情形状带出主题原文与练习契约', () => {
    const lesson = snapshotDetailToLesson(detailLesson, [exercise])
    expect(lesson.reading?.markdown).toContain('核心概念')
    expect(lesson.code).toBe('int a = 1;')
    expect(lesson.exercise?.exerciseId).toBe('ex-1')
    expect(lesson.acceptance?.testCases).toEqual(['a=1 => 1'])
    expect(lesson.content.acceptanceCriteria).toEqual(['输出正确'])
  })

  it('快照缺字段不整页崩掉：目录为空也不抛错', () => {
    const broken = { ...snapshot, lessons: undefined, stages: undefined } as unknown as ContentSnapshot
    const adapted = adaptCatalog(broken)
    // 仍然给出旧内置课程，界面可以看到“未迁移记录”
    expect(adapted.lessons.length).toBeGreaterThan(0)
    expect(adapted.lessons.every((lesson) => lesson.legacy === true)).toBe(true)
    expect(adapted.stages).toEqual([])
  })

  it('快照回来后正式内容排在旧内置课程之前，且旧课程带 legacy 标记', () => {
    const adapted = adaptCatalog(snapshot)
    expect(adapted.lessons[0]?.id).toBe('cw-test-001')
    expect(adapted.lessons[0]?.legacy).toBe(false)
    const legacy = adapted.lessons.filter((lesson) => lesson.legacy)
    expect(legacy.length).toBeGreaterThan(0)
    expect(legacy.every((lesson) => lesson.contentId === undefined)).toBe(true)
  })

  it('回退快照只给旧内置课程，且阶段为空（明确未连接）', () => {
    const fallback = adaptFallback()
    expect(fallback.lessons.every((lesson) => lesson.legacy === true)).toBe(true)
    expect(fallback.stages).toEqual([])
    expect(fallback.legacyStages.length).toBeGreaterThan(0)
  })

  it('执行方式文案区分教学模拟、浏览器沙箱与外部环境', () => {
    expect(runCommandLabel({ ...baseLesson, executionPolicy: 'teaching' })).toContain('教学运行器')
    expect(runCommandLabel({ ...baseLesson, executionPolicy: 'worker' })).toContain('沙箱')
    expect(runCommandLabel({ ...baseLesson, executionPolicy: 'external' })).toContain('外部环境')
  })
})

/**
 * LINK-07 修复回归：科目 ≠ 可执行语言。
 *
 * 旧实现把 Vue/HTML/CSS/Webpack 等科目塞进五种 LanguageId，
 * 导致 Vue 单元出现在「JavaScript」筛选下（真实浏览器验收发现）。
 */
describe('内容科目分组（与可执行语言分离）', () => {
  it('Vue / HTML / CSS / Webpack 各自成组，不并入 JavaScript', () => {
    expect(subjectKeyOf('Vue 3')).toBe('vue3')
    expect(subjectKeyOf('HTML')).toBe('html')
    expect(subjectKeyOf('CSS')).toBe('css')
    expect(subjectKeyOf('Webpack 5')).toBe('webpack')
    // DOM 属于 JS，归一到同一科目
    expect(subjectKeyOf('JavaScript DOM')).toBe('javascript')
    expect(subjectKeyOf('C#')).toBe('csharp')
    expect(subjectKeyOf('C')).toBe('c')
  })

  it('资料库条目按 bundle 里的 subject 分组，不按可执行语言分组', () => {
    const vue = snapshotSummaryToLesson({ ...summaryLesson, subject: 'Vue 3', language: 'none' })
    expect(vue.subjectId).toBe('vue3')
    expect(vue.subjectLabel).toBe('Vue 3')
    // 仍标记为不可自动执行，但科目与 JavaScript 无关
    expect(vue.executable).toBe(false)
    expect(vue.language).toBe('javascript')
  })

  it('旧内置课程按 languageLabel 归一，不把 HTML/CSS 混进 JavaScript', () => {
    const legacy = legacyLessonsWithFlag()
    const byId = new Map(legacy.map((lesson) => [lesson.id, lesson.subjectId]))
    expect(byId.get('d1-html-semantics')).toBe('html')
    expect(byId.get('d2-css-box-model')).toBe('css')
    expect(byId.get('e1-vue-composition')).toBe('vue3')
    expect(byId.get('f1-webpack-entry-loader')).toBe('webpack')
    expect(byId.get('l1-linux-ops-basics')).toBe('linux')
    // 真正的 JS 课程仍是 javascript
    expect(byId.get('javascript-03')).toBe('javascript')
    expect(byId.get('d3-dom-events')).toBe('javascript')
  })

  it('科目选项：含资料库内容的科目排最前，且计数正确', () => {
    const adapted = adaptCatalog(snapshot)
    const subjects = collectSubjects(adapted.lessons)
    expect(subjects[0]?.id).toBe('java')
    expect(subjects[0]?.hasVaultContent).toBe(true)
    const total = subjects.reduce((sum, subject) => sum + subject.lessonCount, 0)
    expect(total).toBe(adapted.lessons.length)
    // 每个科目 id 唯一
    expect(new Set(subjects.map((subject) => subject.id)).size).toBe(subjects.length)
  })

  it('回退状态下也能汇总出科目（旧课程不被吞掉）', () => {
    const subjects = collectSubjects(adaptFallback().lessons)
    expect(subjects.length).toBeGreaterThan(5)
    expect(subjects.some((subject) => subject.hasVaultContent)).toBe(false)
  })
})