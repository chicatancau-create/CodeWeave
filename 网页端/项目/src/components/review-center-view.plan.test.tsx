// @vitest-environment jsdom
/**
 * #33 裁定 4 · 复习中心的文案必须说清它按哪一份节点排期。
 *
 * 改版前这一页把「1 / 3 / 7 / 14 / 30 天」写死在文案里，分母取客户端常量的长度，
 * 另附一段「资料库另有 [0,1,3,7,14,30] 一条口径，两侧不一致、界面不折算」的免责说明。
 * 现在只有一份标准：节奏与分母都由 `useReviewPlanResolver()` 解析出的生效计划派生，
 * 所以本文件把三种来源（发布规则 / 单元覆盖 / 兜底）各自会说什么话钉住。
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewCenterView } from './review-center-view'
import { adaptCatalog, adaptFallback } from '../content/adapter'
import { ContentProviderHost, type ContentContextValue } from '../content/provider'
import type { MasteryRecord } from '../data/mastery'
import type { ContentSnapshot, SnapshotLesson } from '../content/types'
import type { Lesson } from '../types/lesson'

const STANDARD = [0, 1, 3, 7, 14, 30]

const snapLesson = (contentId: string, reviewOffsetsDays: number[] | null): SnapshotLesson => ({
  contentId,
  primaryTopicId: `topic-${contentId}`,
  title: contentId,
  subject: 'Java',
  language: 'java',
  objective: '目标',
  lessonKind: 'exercise',
  stageIds: ['S1'],
  prerequisiteRefs: [],
  exerciseIds: [],
  projectTaskRef: null,
  runEnvironment: 'teaching',
  executionPolicy: 'teaching',
  estimatedMinutes: 20,
  reviewOffsetsDays,
  verificationStatus: '外部未复核',
  sourceIds: ['SRC-TEST'],
  status: 'published',
  legacyRefs: [],
  reading: null,
  exerciseCount: 0,
  sourceHash: 'hash',
})

/** 只为了把发布规则推进模块镜像：lessons 用不上，界面读的单元清单由下面的 context 桩给。 */
const publish = (offsets: number[]) => {
  const snapshot: ContentSnapshot = {
    bundleId: 'bundle-33-ui',
    schemaVersion: 1,
    buildTime: '2026-09-20T00:00:00.000Z',
    rules: { status: 'current', reviewOffsetsDays: offsets },
    stages: [],
    milestones: [],
    masteryLevels: [],
    hintLevels: [],
    reviewOffsetsDays: offsets,
    lessons: [snapLesson('cw-inherit', null), snapLesson('cw-override', [1, 3])],
    counts: { lessons: 2 },
  }
  adaptCatalog(snapshot)
}

const record = (overrides: Partial<MasteryRecord> = {}): MasteryRecord => ({
  refId: 'cw-inherit',
  kind: 'lesson',
  level: 2,
  evidence: [],
  updatedAt: '2026-09-20T02:00:00.000Z',
  reviewDueKey: '2026-09-20',
  reviewStep: 0,
  ...overrides,
})

/** 界面只用到 `lessons[].id` 与 `lessons[].content.reviewOffsetsDays` 两个字段。 */
const lessonStub = (id: string, reviewOffsetsDays: number[] | null): Lesson =>
  ({ id, content: { reviewOffsetsDays } }) as unknown as Lesson

function renderView(records: MasteryRecord[], lessons: Lesson[]) {
  const value = { lessons } as unknown as ContentContextValue
  render(
    <ContentProviderHost.Provider value={value}>
      <ReviewCenterView
        groups={{ overdue: [], today: records, upcoming: [], next: null }}
        titles={{ 'cw-inherit': '继承默认的单元', 'cw-override': '自己写节点的单元' }}
        lessonIds={lessons.map((lesson) => lesson.id)}
        todayKey="2026-09-20"
        onReview={vi.fn()}
        onSnooze={vi.fn()}
        onOpenLesson={vi.fn()}
      />
    </ContentProviderHost.Provider>,
  )
}

const planCell = () => document.querySelector('.rv-cell-plan')?.textContent ?? ''
/** 页头那一句「本页按哪一份节奏排期」（与行内的口径句分开断言，免得两条句子互相冒充）。 */
const summaryLine = () => document.querySelector<HTMLElement>('.rv-plan-summary')?.textContent ?? ''

afterEach(() => {
  cleanup()
  adaptFallback()
})

describe('#33 · 复习中心按生效计划写文案', () => {
  it('读到发布规则：标题说 6 个节点与「学习当天」，行内分母是 6，且不出现兜底免责句', () => {
    publish(STANDARD)
    renderView([record()], [lessonStub('cw-inherit', null)])
    const heading = document.querySelector('.rv-plan-summary')?.textContent ?? ''
    expect(heading).toContain('按资料库发布规则：学习当天 + 学完后第 1、3、7、14、30 天各一次')
    expect(heading).toContain('共 6 个节点')
    expect(heading).toContain('未通过的复测会降低掌握等级并重新安排')
    expect(planCell()).toContain('复测节点 1 / 6')
    expect(planCell()).toContain('按资料库发布规则')
    expect(summaryLine()).not.toContain('没有读到资料库发布规则')
    // 分组说明与 caption 用的也是同一份节奏，不再是手写的五档
    expect(document.querySelector('.rv-block-note')?.textContent).toContain('按 当天与 1/3/7/14/30 天计划今天应复测')
  })

  it('本单元真的覆盖了默认：行里点明是覆盖，并把默认节奏一起说出来', () => {
    publish(STANDARD)
    renderView([record({ refId: 'cw-override' })], [lessonStub('cw-override', [1, 3])])
    const note = planCell()
    expect(note).toContain('复测节点 1 / 2')
    expect(note).toContain('按本单元自己写了的覆盖：学完后第 1、3 天各一次，共 2 个节点')
    expect(note).toContain('（默认是当天与 1/3/7/14/30 天，共 6 个节点）')
  })

  it('读不到发布规则：分母回到本机兜底的 5 个节点，并另起一句承认没读到发布规则', () => {
    adaptFallback()
    renderView([record()], [lessonStub('cw-inherit', null)])
    const heading = document.querySelector('.rv-plan-summary')?.textContent ?? ''
    expect(heading).toContain('按本机排期：学完后第 1、3、7、14、30 天各一次')
    expect(heading).toContain('共 5 个节点')
    expect(planCell()).toContain('复测节点 1 / 5')
    expect(summaryLine()).toContain('当前没有读到资料库发布规则')
    expect(summaryLine()).toContain('默认节奏比这里多一档「学习当天」')
  })

  it('节点写在覆盖里也不影响到期分组：今日一组的条数分母仍是记录数', () => {
    publish(STANDARD)
    renderView([record(), record({ refId: 'cw-override', reviewStep: 1 })], [
      lessonStub('cw-inherit', null),
      lessonStub('cw-override', [1, 3]),
    ])
    expect(document.querySelector('.rv-block-note')?.textContent).toContain('2 / 2 项')
    expect(document.querySelector('caption')?.textContent).toBe(
      '今日到期复习清单，共 2 项（按 当天与 1/3/7/14/30 天计划今天应复测）',
    )
  })
})
