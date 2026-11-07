// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Clock } from './clock'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('独立时钟更新问候并释放计时器', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 7, 11, 59, 40))
  const { unmount } = render(<Clock name="学习者" stageCount={10} stageNote="（S0—S9）" />)
  expect(screen.getByText(/早上好，学习者/)).toBeTruthy()
  act(() => vi.advanceTimersByTime(30_000))
  expect(screen.getByText(/中午好，学习者/)).toBeTruthy()
  expect(screen.getByText(/学习计划共 10 个阶段（S0—S9）/)).toBeTruthy()
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})
