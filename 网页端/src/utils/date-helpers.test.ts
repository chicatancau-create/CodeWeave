// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { buildMonthGrid, countStreak, getLocalDateKey, readCheckinDates, shiftDateKey } from './date-helpers'

describe('date-helpers', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('getLocalDateKey 按本地时区（而非 UTC）返回日期', () => {
    // 2026-09-12 00:30 (UTC+8) 对应 UTC 2026-09-11T16:30Z，本地键应为 2026-09-12。
    const date = new Date('2026-09-11T16:30:00.000Z')
    expect(getLocalDateKey(date)).toBe(date.toLocaleDateString('sv-SE'))
  })

  it('shiftDateKey 支持负数与跨月', () => {
    expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDateKey('2026-10-01', -1)).toBe('2026-09-30')
  })

  it('countStreak 从今天往回数连续打卡', () => {
    const today = getLocalDateKey()
    const dates = [today, shiftDateKey(today, -1), shiftDateKey(today, -2), shiftDateKey(today, -9)]
    expect(countStreak(dates, today)).toBe(3)
  })

  it('countStreak：今天未打卡但昨天打卡，连续性保留', () => {
    const today = getLocalDateKey()
    const dates = [shiftDateKey(today, -1), shiftDateKey(today, -2)]
    expect(countStreak(dates, today)).toBe(2)
  })

  it('countStreak：昨天也断掉则为 0', () => {
    const today = getLocalDateKey()
    expect(countStreak([shiftDateKey(today, -2)], today)).toBe(0)
  })

  it('readCheckinDates 容忍非法 JSON 与非法条目', () => {
    localStorage.setItem('code-canvas.checkin.v1', '{bad json')
    expect(readCheckinDates()).toEqual([])

    localStorage.setItem('code-canvas.checkin.v1', JSON.stringify(['2026-09-01', 'not-a-date', 42, null, '2026-09-02']))
    expect(readCheckinDates()).toEqual(['2026-09-01', '2026-09-02'])

    localStorage.setItem('code-canvas.checkin.v1', JSON.stringify({ not: 'an array' }))
    expect(readCheckinDates()).toEqual([])
  })

  it('buildMonthGrid：周一开头、前置空位、天数正确', () => {
    const grid = buildMonthGrid(2026, 8) // 2026-09
    // 2026-09-01 是周二 → 1 个前置空位
    expect(grid[0]).toBeNull()
    expect(grid[1]).toBe('2026-09-01')
    expect(grid.filter(Boolean)).toHaveLength(30)
  })
})
