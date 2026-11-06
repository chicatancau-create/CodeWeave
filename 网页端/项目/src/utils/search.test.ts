// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { filterTargets, type SearchTarget } from './search'
import { deriveNotifications, mergeTransientEvents, visibleNotifications, type NotificationItem } from './notifications'

const targets: SearchTarget[] = [
  { id: 'python-loop-sum', type: 'lesson', title: '循环是怎么工作的？', subtitle: 'Python' },
  { id: 'stage-b', type: 'challenge', title: 'B 关卡验收：Java 核心编程', subtitle: 'Java 后端' },
  { id: 'project-1', type: 'project', title: '我的 Java 项目', subtitle: '2 个文件' },
]

describe('filterTargets（全局搜索）', () => {
  it('空关键词返回空数组（显示最近访问由调用方处理）', () => {
    expect(filterTargets(targets, '')).toEqual([])
    expect(filterTargets(targets, '   ')).toEqual([])
  })

  it('标题与副标题都能命中，并标记命中位置', () => {
    const byTitle = filterTargets(targets, '循环')
    expect(byTitle).toHaveLength(1)
    expect(byTitle[0]?.matchedIn).toBe('title')

    const bySubtitle = filterTargets(targets, 'Java 后端')
    expect(bySubtitle[0]?.id).toBe('stage-b')
    expect(bySubtitle[0]?.matchedIn).toBe('subtitle')
  })

  it('大小写不敏感，结果上限 8 条', () => {
    const many: SearchTarget[] = Array.from({ length: 12 }, (_, i) => ({
      id: `lesson-${i}`,
      type: 'lesson',
      title: `课程 ${i}`,
      subtitle: 'Python',
    }))
    expect(filterTargets(many, '课程')).toHaveLength(8)
    expect(filterTargets(targets, 'JAVA')[0]?.id).toBe('stage-b')
  })

  /**
   * LINK-07：资料库主题名 ≠ 课程标题，必须能用主题名搜到课程。
   * 真实浏览器验收发现：搜「流程控制」时课程「条件分支：让程序做决定」不可见。
   */
  it('别名（资料库主题名）可命中，并标出匹配到的主题', () => {
    const withAlias: SearchTarget[] = [
      {
        id: 'cw-java-control-flow-001',
        type: 'lesson',
        title: 'S1 · 条件分支：让程序做决定',
        subtitle: 'Java · 资料库',
        aliases: ['Java 核心基础', '流程控制语句', 'Java核心基础'],
      },
    ]
    expect(filterTargets(withAlias, '流程控制')).toHaveLength(1)
    const hit = filterTargets(withAlias, '流程控制')[0]
    expect(hit?.matchedIn).toBe('alias')
    expect(hit?.matchedAlias).toBe('流程控制语句')
    // 别名命中不影响标题/副标题命中的优先级
    expect(filterTargets(withAlias, '条件分支')[0]?.matchedIn).toBe('title')
    expect(filterTargets(withAlias, '资料库')[0]?.matchedIn).toBe('subtitle')
    // 来源文件名（去掉 .md）也能命中
    expect(filterTargets(withAlias, 'Java核心基础')[0]?.matchedIn).toBe('alias')
  })

  it('没有别名的目标不受影响', () => {
    expect(filterTargets(targets, '流程控制')).toHaveLength(0)
  })
})

describe('deriveNotifications（通知派生）', () => {
  const base = {
    titles: { 'lesson-x': '循环单元' },
    challengeTitles: { 'stage-b': 'B 关卡验收：Java 核心编程' },
    todayKey: '2026-09-13',
  }

  it('复测到期、今日挑战通过、打卡里程碑各自生成确定性 id', () => {
    const items = deriveNotifications({
      ...base,
      dueReviews: [{ refId: 'lesson-x', reviewDueKey: '2026-09-13' } as never],
      challengeRecords: { 'stage-b': { completedAt: '2026-09-13T08:00:00.000Z', evidence: '' } },
      streak: 7,
      checkedInToday: true,
    })
    const ids = items.map((item) => item.id)
    expect(ids).toContain('review-due:lesson-x:2026-09-13')
    expect(ids).toContain('challenge-passed:stage-b:2026-09-13')
    expect(ids).toContain('checkin-milestone:7:2026-09-13')
    expect(items.find((item) => item.id === 'review-due:lesson-x:2026-09-13')?.title).toContain('循环单元')
  })

  it('非今日的挑战通过不生成通知；非里程碑天数不生成打卡通知', () => {
    const items = deriveNotifications({
      ...base,
      dueReviews: [],
      challengeRecords: { 'stage-b': { completedAt: '2026-09-10T08:00:00.000Z', evidence: '' } },
      streak: 5,
      checkedInToday: true,
    })
    expect(items).toEqual([])
  })

  it('visibleNotifications 按 readIds 与 clearedDateKey 过滤', () => {
    const items: NotificationItem[] = [
      { id: 'a', kind: 'review-due', title: 'A', dateKey: '2026-09-13' },
      { id: 'b', kind: 'challenge-passed', title: 'B', dateKey: '2026-09-12' },
    ]
    expect(visibleNotifications(items, ['a'], undefined)).toEqual([items[1]])
    expect(visibleNotifications(items, [], '2026-09-12')).toEqual([items[0]])
    expect(visibleNotifications(items, ['a', 'b'], undefined)).toEqual([])
  })
})

describe('mergeTransientEvents（F2 瞬时事件）', () => {
  it('按 id 去重、新事件在前、上限 50 条', () => {
    const stored: NotificationItem[] = Array.from({ length: 50 }, (_, i) => ({
      id: `e-${i}`, kind: 'draft-save-failed' as const, title: `t-${i}`, dateKey: '2026-09-12',
    }))
    const incoming: NotificationItem = { id: 'e-25', kind: 'draft-save-failed', title: 't-25-新', dateKey: '2026-09-13' }
    const merged = mergeTransientEvents(stored, incoming)
    expect(merged).toHaveLength(50)
    expect(merged[0]?.id).toBe('e-25')
    expect(merged.filter((item) => item.id === 'e-25')).toHaveLength(1)
    expect(merged[merged.length - 1]?.id).not.toBe('e-0') // 最旧的被淘汰
  })
})
