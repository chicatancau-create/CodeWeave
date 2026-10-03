// @vitest-environment jsdom
/**
 * #33 · 复测排期口径的接线测试。
 *
 * 这里钉的是「**运行时真的按哪一份节点排期**」：
 * 资料库发布规则（`[0,1,3,7,14,30]`）必须盖掉客户端常量，本单元写了非空数组才算覆盖，
 * 而单元级 `null` / `[]` 都只是「没写」——继承上一级，绝不排成空计划。
 * 发布规则是从 `adaptCatalog()` 那一处镜像进来的（`content/adapter.ts` 的 `publishedReviewOffsets()`），
 * 单元级节点从内容 context 的 `lessons` 里按 refId 查；两者都在本文件里真实构造，不靠 mock 糊过去。
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { useReviewSchedule } from './use-review-schedule'
import { adaptCatalog, adaptFallback, publishedReviewOffsets } from '../content/adapter'
import { ContentProviderHost, type ContentContextValue } from '../content/provider'
import type { ContentSnapshot, SnapshotLesson } from '../content/types'
import type { Lesson } from '../types/lesson'
import { shiftDateKey } from '../utils/date-helpers'

/** 排期标准：总计划 §7.4 与规则投影 `teaching-rules.json` 都是这一份。 */
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

const catalogWith = (lessons: SnapshotLesson[], published: number[] | null): ContentSnapshot => ({
  bundleId: 'bundle-33',
  schemaVersion: 1,
  buildTime: '2026-09-20T00:00:00.000Z',
  // 目录接口只把规则的 status/reason 放进 `rules`，默认节点在**顶层**（server/content/index.mjs:344）
  rules: { status: 'current', reviewOffsetsDays: published ?? undefined },
  stages: [],
  milestones: [],
  masteryLevels: [],
  hintLevels: [],
  reviewOffsetsDays: published ?? [],
  lessons,
  counts: { lessons: lessons.length },
})

function providerWrapper(lessons: Lesson[]) {
  const value = { lessons } as unknown as ContentContextValue
  return ({ children }: { children: ReactNode }) => (
    <ContentProviderHost.Provider value={value}>{children}</ContentProviderHost.Provider>
  )
}

const completedOn = (lessonId: string, todayKey: string) => {
  const now = new Date(`${todayKey}T09:00:00`)
  const { result } = renderHook(() => useReviewSchedule('user-33', now))
  act(() => {
    result.current.markLessonCompleted(lessonId, '自行声明完成（本课无结构化验收点）', 'self-declared')
  })
  return result.current.records[lessonId]!
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  // 模块级镜像会被上一份快照改写：每条用例都从「没有发布规则」重新开始。
  adaptFallback()
})

describe('#33 · 发布规则是运行时的标准', () => {
  it('目录适配后客户端能读到发布规则的默认节点', () => {
    expect(publishedReviewOffsets(), '适配前不该有发布规则').toBeNull()
    adaptCatalog(catalogWith([snapLesson('cw-a', null)], STANDARD))
    expect(publishedReviewOffsets()).toEqual(STANDARD)
  })

  it('同一门课、同一天：有发布规则排当天，没发布规则才排 1 天后（客户端常量不是标准）', () => {
    const adapted = adaptCatalog(catalogWith([snapLesson('cw-a', null)], STANDARD))
    const now = new Date('2026-09-20T09:00:00')
    const withRule = renderHook(() => useReviewSchedule('user-33', now), { wrapper: providerWrapper(adapted.lessons) })
    act(() => {
      withRule.result.current.markLessonCompleted('cw-a', '自行声明完成', 'self-declared')
    })
    expect(withRule.result.current.records['cw-a']!.reviewDueKey).toBe('2026-09-20')

    // 换一份没写默认节点的规则投影（老快照 / 规则待审核）：这才是兜底常量上场的唯一时机
    const noRule = adaptCatalog(catalogWith([snapLesson('cw-a', null)], []))
    const now2 = new Date('2026-09-20T09:00:00')
    const fallback = renderHook(() => useReviewSchedule('user-33-b', now2), { wrapper: providerWrapper(noRule.lessons) })
    act(() => {
      fallback.result.current.markLessonCompleted('cw-a', '自行声明完成', 'self-declared')
    })
    expect(fallback.result.current.records['cw-a']!.reviewDueKey).toBe('2026-09-21')
  })
})

describe('#33 · 三级优先在 hook 里生效', () => {
  const todayKey = '2026-09-20'

  const completeWith = (lessonId: string) => {
    const adapted = adaptCatalog(
      catalogWith(
        [
          snapLesson('cw-inherit', null), // 没写 → 继承发布规则
          snapLesson('cw-override', [1, 3]), // 写了 → 本单元覆盖
          snapLesson('cw-empty', []), // 写了个空表 → 仍算「没写」
        ],
        STANDARD,
      ),
    )
    const now = new Date(`${todayKey}T09:00:00`)
    const { result } = renderHook(() => useReviewSchedule('user-33', now), {
      wrapper: providerWrapper(adapted.lessons),
    })
    act(() => {
      result.current.markLessonCompleted(lessonId, '自行声明完成（本课无结构化验收点）', 'self-declared')
    })
    return { record: result.current.records[lessonId]!, result }
  }

  it('单元没写：按发布规则排到学习当天（当天就是真到期，不是排在明天）', () => {
    const { record, result } = completeWith('cw-inherit')
    expect(record.reviewDueKey).toBe(todayKey)
    expect(record.reviewStep).toBe(0)
    // 当天那一档是要做的功课，所以它出现在今日到期清单里
    expect(result.current.dueReviews.map((item) => item.refId)).toEqual(['cw-inherit'])
  })

  it('单元写了非空数组：本单元覆盖默认，排到自己的第 0 档', () => {
    const { record } = completeWith('cw-override')
    expect(record.reviewDueKey).toBe(shiftDateKey(todayKey, 1))
  })

  it('单元写成 `[]`：不是「不复测」，与没写一样继承发布规则', () => {
    const { record } = completeWith('cw-empty')
    expect(record.reviewDueKey).toBe(todayKey)
  })

  it('通过第 0 档后进入 +1 天档；计划走完 6 档后清空安排', () => {
    const adapted = adaptCatalog(catalogWith([snapLesson('cw-inherit', null)], STANDARD))
    const now = new Date(`${todayKey}T09:00:00`)
    const { result } = renderHook(() => useReviewSchedule('user-33', now), {
      wrapper: providerWrapper(adapted.lessons),
    })
    act(() => {
      result.current.markLessonCompleted('cw-inherit', '自行声明完成', 'self-declared')
    })
    // 六档逐个通过：0 → 1 → 3 → 7 → 14 → 30，第七次通过就没有下一个节点了
    let due = result.current.records['cw-inherit']!.reviewDueKey
    for (const [index, offset] of STANDARD.entries()) {
      expect(due, `第 ${index + 1} 个节点该落在 +${offset} 天`).toBe(shiftDateKey(todayKey, offset))
      act(() => {
        result.current.recordEvidence('cw-inherit', 'review', true, '复测通过')
      })
      due = result.current.records['cw-inherit']!.reviewDueKey ?? undefined
    }
    expect(result.current.records['cw-inherit']!.reviewStep).toBe(STANDARD.length)
    expect(due).toBeUndefined()
    expect(result.current.dueReviews).toHaveLength(0)
  })
})

describe('#33 · 读不到发布规则时才用本机兜底', () => {
  it('没有快照、没有 context：仍排在 1 天后，且不是「没有计划」', () => {
    expect(publishedReviewOffsets()).toBeNull()
    const record = completedOn('python-loop-sum', '2026-09-20')
    expect(record.reviewDueKey).toBe(shiftDateKey('2026-09-20', 1))
  })

  it('`adaptFallback()` 会把镜像清回去，不会留着上一份快照的规则', () => {
    adaptCatalog(catalogWith([snapLesson('cw-a', null)], STANDARD))
    expect(publishedReviewOffsets()).toEqual(STANDARD)
    adaptFallback()
    expect(publishedReviewOffsets()).toBeNull()
  })
})
