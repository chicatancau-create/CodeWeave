// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useLocalDay } from './use-local-day'
import { useCheckin } from './use-checkin'
import { getLocalDateKey } from '../utils/date-helpers'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.useRealTimers()
})

it('同一天计时不改变日期引用，跨午夜重算打卡状态并释放定时器', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 7, 23, 59, 0))
  const { result, unmount } = renderHook(() => {
    const day = useLocalDay()
    return { day, checkin: useCheckin('local-day-test', day) }
  })
  const initial = result.current.day
  act(() => result.current.checkin.handleCheckin())
  expect(result.current.checkin.checkedIn).toBe(true)
  act(() => vi.advanceTimersByTime(30_000))
  expect(result.current.day).toBe(initial)
  act(() => vi.advanceTimersByTime(30_000))
  expect(getLocalDateKey(result.current.day)).toBe('2026-11-08')
  expect(result.current.checkin.checkedIn).toBe(false)
  expect(result.current.checkin.streak).toBe(1)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('后台恢复时按当前本地日期刷新', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 7, 12))
  const { result } = renderHook(useLocalDay)
  vi.setSystemTime(new Date(2026, 10, 9, 12))
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(getLocalDateKey(result.current)).toBe('2026-11-09')
})
