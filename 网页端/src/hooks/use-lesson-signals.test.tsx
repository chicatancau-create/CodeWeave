// @vitest-environment jsdom
/**
 * LEARN-01 第 4 条 · 两条学习信号的落盘纪律（hooks/use-lesson-signals）。
 *
 * 这四件事都必须被钉住，否则第 4 条就是空话：
 * 1. 「已练习」只认**真的跑完**的那一次（判据在 utils/lesson-evidence 的 isCompletedPracticeRun），
 *    报错、运行器认不出结构、外部环境与空轨迹都不写；
 * 2. 一次运行只落一条 —— StrictMode 会把 effect 连跑两遍，两遍读到的是同一份旧 records，
 *    少了 writtenRef 这道闸就会写出两条，而练习次数是数出来的，多一条就是假数据；
 * 3. 「已阅读」是学习者显式按的，重复点击不再追加；
 * 4. 两条都以 `passed:false` 交出去（推进等级与否由上层 applyEvidence 判），本 hook 不越权。
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLessonSignals } from './use-lesson-signals'
import type { MasteryRecord } from '../data/mastery'
import type { ExecutionResult, Lesson, RunStatus } from '../types/lesson'
import { lessonSignalNote } from '../utils/lesson-evidence'

const lesson = (overrides: Partial<Lesson> = {}): Lesson =>
  ({ id: 'vault-s0-1', title: '开发环境清点', ...overrides }) as Lesson

const execution = (overrides: Partial<ExecutionResult> = {}): ExecutionResult =>
  ({
    output: ['5'],
    variables: [],
    events: [{ id: 'e1', type: 'start', line: 1, label: '开始', detail: '', variables: [], nodeId: 'start' }],
    error: null,
    unsupported: false,
    tier: 'teaching',
    ...overrides,
  }) as ExecutionResult

type Params = Parameters<typeof useLessonSignals>[0]

const render = (overrides: Partial<Params> = {}) => {
  const recordEvidence = vi.fn()
  const props: Params = {
    lesson: lesson(),
    runStatus: 'completed' as RunStatus,
    execution: execution(),
    records: {},
    recordEvidence,
    ...overrides,
  }
  const view = renderHook((props: Params) => useLessonSignals(props), { initialProps: props })
  return { ...view, props, recordEvidence }
}

/** 记过一次的证据条目（用于第二条「已经记过」的场景）。 */
const signalRecord = (kind: 'read' | 'practice', refId = 'vault-s0-1'): Record<string, MasteryRecord> => ({
  [refId]: {
    refId,
    kind: 'lesson',
    level: 0,
    reviewStep: 0,
    updatedAt: '2026-09-20T00:00:00.000Z',
    evidence: [
      {
        id: 'e-sig',
        kind: 'lesson',
        refId,
        note: lessonSignalNote(kind, '开发环境清点'),
        at: '2026-09-20T00:00:00.000Z',
        passed: false,
      },
    ],
  },
})

afterEach(() => {
  cleanup()
})

describe('已练习：由真实运行落盘，不靠自述', () => {
  it('跑完一次记一条，且 passed 为 false（不推进掌握等级）', () => {
    const { recordEvidence } = render()
    expect(recordEvidence).toHaveBeenCalledTimes(1)
    expect(recordEvidence.mock.calls[0]?.[0]).toBe('vault-s0-1')
    expect(recordEvidence.mock.calls[0]?.[1]).toBe('lesson')
    expect(recordEvidence.mock.calls[0]?.[2], '信号不是完成证据，passed 必须是 false').toBe(false)
    expect(String(recordEvidence.mock.calls[0]?.[3])).toContain('已练习')
  })

  it('effect 真的再跑一遍也只落一条（StrictMode 会把挂载跑两次）', () => {
    const { rerender, props, recordEvidence } = render()
    // 给一个**新的** execution 对象：同引用不会重跑 effect，那样测的是空气不是这道闸。
    rerender({ ...props, execution: execution() })
    rerender({ ...props, execution: execution() })
    expect(recordEvidence).toHaveBeenCalledTimes(1)
  })

  it('记录里已有「已练习」时不再写第二遍', () => {
    const { recordEvidence } = render({ records: signalRecord('practice') })
    expect(recordEvidence).not.toHaveBeenCalled()
  })

  it('判据不过的四种运行都不写：未跑完 / 报错 / 认不出结构 / 外部环境', () => {
    const cases: Array<Partial<Params>> = [
      { runStatus: 'running' as RunStatus },
      { execution: execution({ error: { line: 2, message: 'boom' } }) },
      { execution: execution({ unsupported: true }) },
      { execution: execution({ tier: 'external', events: [] }) },
    ]
    for (const item of cases) {
      const { recordEvidence } = render(item)
      expect(recordEvidence, JSON.stringify(Object.keys(item))).not.toHaveBeenCalled()
    }
  })

  it('不在工作台里（lesson 为空）时什么都不写', () => {
    const { recordEvidence } = render({ lesson: null })
    expect(recordEvidence).not.toHaveBeenCalled()
  })
})

describe('已阅读：唯一诚实的来源是学习者自己按那一下', () => {
  it('没有东西自动记「已阅读」，点了才记一条', () => {
    const { result, recordEvidence } = render()
    expect(result.current.markRead).toBeTypeOf('function')
    expect(recordEvidence.mock.calls.every((call) => !String(call[3]).includes('已阅读'))).toBe(true)

    act(() => result.current.markRead())
    expect(recordEvidence).toHaveBeenCalledTimes(2)
    expect(String(recordEvidence.mock.calls[1]?.[3])).toContain('已阅读')
    expect(recordEvidence.mock.calls[1]?.[2]).toBe(false)
  })

  it('重复点击只记一条：同一次挂载内有 writtenRef，跨挂载看记录', () => {
    const { result, recordEvidence } = render()
    act(() => result.current.markRead())
    act(() => result.current.markRead())
    expect(recordEvidence).toHaveBeenCalledTimes(2)
    expect(recordEvidence.mock.calls.filter((call) => String(call[3]).includes('已阅读')).length).toBe(1)
  })

  it('记录里已有「已阅读」时按钮不再出现（readMarked 为真）', () => {
    const { result } = render({ records: signalRecord('read') })
    expect(result.current.readMarked).toBe(true)
  })

  it('没标记过时 readMarked 为假', () => {
    const { result } = render({ records: {} })
    expect(result.current.readMarked).toBe(false)
  })
})
