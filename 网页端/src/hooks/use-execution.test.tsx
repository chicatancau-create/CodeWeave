// @vitest-environment jsdom
/**
 * RUN-01 运行身份、取消与结果归属契约测试。
 *
 * 对应 T.4 RUN-01 的核心缺陷：
 * - `handleRun` / `handleStep` 在 `await executeJavaScript(...)` **之后**才设置 running，
 *   期间没有 runId，用户可再次触发；且重置/切课后旧 Promise 返回时仍会写回结果。
 * - 快捷键只依赖 `enabled`，隐藏工作台仍可能响应 Ctrl+Enter。
 *
 * 本文件用可控的异步运行器构造"迟到的旧结果"，验证结果只在快照仍匹配时被接收。
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionResult, Lesson } from '../types/lesson'
import { EXECUTION_SETTINGS } from '../utils/constants'
import { useExecution } from './use-execution'
import { useReducedMotion } from './use-reduced-motion'

/** 可控运行器：测试决定何时 resolve，用于构造"迟到结果"。 */
const pendingRuns: Array<(value: ExecutionResult) => void> = []

vi.mock('../engine/javascript-sandbox', () => ({
  executeJavaScript: vi.fn(
    () =>
      new Promise<ExecutionResult>((resolve) => {
        pendingRuns.push(resolve)
      }),
  ),
}))

vi.mock('../engine/teaching-runtime', () => ({
  simulateProgram: vi.fn(() => ({ events: [], output: [] }) as ExecutionResult),
}))

const lesson = {
  id: 'lessonA',
  language: 'javascript',
  code: 'console.log(1)',
  title: '测试课程',
} as unknown as Lesson

type Api = ReturnType<typeof useExecution>

function harnessRef() {
  const ref: { current: Api | null } = { current: null }
  const onReady = (api: Api) => {
    ref.current = api
  }
  return { ref, onReady }
}

/**
 * 走 app.tsx 真实的接线：设置与系统偏好先由 `useReducedMotion` 合并，再传给 useExecution。
 * 直接从 props 传布尔会让「系统偏好」那条路径没有任何用例覆盖。
 */
function Harness({
  onReady,
  enabled = true,
  reducedMotion = false,
}: {
  onReady?: (api: Api) => void
  enabled?: boolean
  reducedMotion?: boolean
}) {
  const api = useExecution('console.log(1)', 'javascript', lesson, enabled, useReducedMotion(reducedMotion))
  onReady?.(api)
  return null
}

const result = (output: string[]): ExecutionResult => ({
  events: [{ id: 'ev-1', type: 'output', line: 1, label: '输出', detail: '', variables: [] }],
  output,
})

/** n 条输出事件：步数与末态要数得出来。 */
const multiResult = (n: number): ExecutionResult => ({
  events: Array.from({ length: n }, (_, i) => ({
    id: `ev-${i}`,
    type: 'output' as const,
    line: i + 1,
    label: '输出',
    detail: '',
    variables: [],
  })),
  output: Array.from({ length: n }, (_, i) => String(i + 1)),
})

beforeEach(() => {
  pendingRuns.length = 0
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RUN-01 运行身份与准备态', () => {
  it('进入异步执行前即进入 preparing/running，不留"看起来没反应"的窗口', async () => {
    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)

    // 触发运行：异步运行器尚未返回
    await act(async () => {
      void ref.current!.handleRun()
    })

    // 关键：此时必须已经是非 idle 状态
    expect(ref.current!.runStatus).not.toBe('idle')

    await act(async () => {
      pendingRuns.forEach((resolve) => resolve(result(['1'])))
    })
  })

  it('暴露当前 runId，供调用方判断结果是否属于本次运行', async () => {
    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)

    const before = ref.current!.runId
    await act(async () => {
      void ref.current!.handleRun()
    })
    expect(ref.current!.runId).not.toBe(before)

    await act(async () => {
      pendingRuns.forEach((resolve) => resolve(result(['1'])))
    })
  })
})

describe('RUN-01 迟到结果不得覆盖', () => {
  it('重置后旧运行返回的结果被丢弃', async () => {
    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)

    await act(async () => {
      void ref.current!.handleRun()
    })
    // 重置使旧 runId 失效
    await act(async () => {
      ref.current!.handleReset()
    })

    const stale = pendingRuns[0]!
    await act(async () => {
      stale(result(['旧结果']))
    })

    // 旧结果不得写回
    expect(ref.current!.execution.output).toEqual([])
    expect(ref.current!.runStatus).toBe('idle')
  })

  it('第二次运行的结果不被先返回的旧结果覆盖', async () => {
    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)

    await act(async () => {
      void ref.current!.handleRun()
    })
    const first = pendingRuns[0]!

    // 重置后再次运行
    await act(async () => {
      ref.current!.handleReset()
    })
    await act(async () => {
      void ref.current!.handleRun()
    })
    const second = pendingRuns[1]!

    // 旧结果先返回
    await act(async () => {
      first(result(['旧结果']))
    })
    // 新结果后返回
    await act(async () => {
      second(result(['新结果']))
    })

    expect(ref.current!.execution.output).toEqual(['新结果'])
  })
})

describe('RUN-01 快捷键作用域', () => {
  it('enabled=false（工作台不可见）时 Ctrl+Enter 不触发运行', async () => {
    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} enabled={false} />)

    const event = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })
    await act(async () => {
      window.dispatchEvent(event)
    })

    expect(ref.current!.runStatus).toBe('idle')
    expect(pendingRuns).toHaveLength(0)
  })

  it('enabled=true 时 Ctrl+Enter 触发运行', async () => {
    const { onReady } = harnessRef()
    render(<Harness onReady={onReady} enabled />)

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }))
    })

    expect(pendingRuns.length).toBeGreaterThan(0)
    await act(async () => {
      pendingRuns.forEach((resolve) => resolve(result(['1'])))
    })
  })

  it('运行中按 Ctrl+Enter 不重复发起新运行', async () => {
    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)

    await act(async () => {
      void ref.current!.handleRun()
    })
    const countAfterFirst = pendingRuns.length

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }))
    })

    expect(pendingRuns.length).toBe(countAfterFirst)
    await act(async () => {
      pendingRuns.forEach((resolve) => resolve(result(['1'])))
    })
  })
})

/**
 * §5.3 第 3 条：「原模板 reduced-motion 仅减慢时间，需要适配为**真正停止**持续动画；
 * 尊重系统偏好及现有『减少动效』设置」。播放头是 `setTimeout` 链，CSS 的两道开关管不到它，
 * 所以这里验的是 JS 半边。判据是**「一个中间帧都没出现过」**：结果落地即末态、输出一条不少。
 * 不拿「有没有排 setTimeout」当判据——进入异步执行前那段 `running` 本来就会排一次定时器
 * 并在结果落地时被 cleanup 摘掉（RUN-01 的防呆设计），它不属于逐帧动画。
 */
describe('§5.3 减少动效下的运行播放头', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  /** 只数步长恰为 STEP_DELAY_MS 的定时器：React 与 testing-library 自己也会用 setTimeout。 */
  const timedSpy = () => vi.spyOn(window, 'setTimeout')
  type TimedSpy = ReturnType<typeof timedSpy>
  function countStepTimers(spy: TimedSpy) {
    return spy.mock.calls.filter((call) => call[1] === EXECUTION_SETTINGS.STEP_DELAY_MS).length
  }

  function stubMatchMedia(matches: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  }

  it('未命中减少动效：结果返回后播放头仍从首帧起步，850ms 定时器照排', async () => {
    const timerSpy = timedSpy()
    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)

    await act(async () => {
      void ref.current!.handleRun()
    })
    await act(async () => {
      pendingRuns.forEach((resolve) => resolve(multiResult(3)))
    })

    expect(ref.current!.runStatus).toBe('running')
    expect(ref.current!.eventIndex).toBe(0)
    // 停在首帧：三条输出此刻只该看得见第一条
    expect(ref.current!.visibleOutput).toEqual(['1'])
    expect(countStepTimers(timerSpy)).toBeGreaterThan(0)
  })

  it('命中应用「减少动效」设置：结果落地即末态，一个中间帧都没出现过', async () => {
    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} reducedMotion />)

    await act(async () => {
      void ref.current!.handleRun()
    })
    await act(async () => {
      pendingRuns.forEach((resolve) => resolve(multiResult(3)))
    })

    // 落地这一刻就在末态：逐帧回放的话此刻 eventIndex 只会是 0
    expect(ref.current!.runStatus).toBe('completed')
    expect(ref.current!.eventIndex).toBe(2)
    // 停止的是动画，不是结果
    expect(ref.current!.visibleOutput).toEqual(['1', '2', '3'])
    expect(ref.current!.execution.output).toHaveLength(3)
  })

  it('命中系统偏好（应用设置没开）同样落末态', async () => {
    stubMatchMedia(true)
    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)

    await act(async () => {
      void ref.current!.handleRun()
    })
    await act(async () => {
      pendingRuns.forEach((resolve) => resolve(multiResult(2)))
    })

    expect(ref.current!.runStatus).toBe('completed')
    expect(ref.current!.eventIndex).toBe(1)
    expect(ref.current!.visibleOutput).toEqual(['1', '2'])
  })

  it('减少动效下手动单步仍逐帧推进：0 → 1 → 2 → 末态', async () => {
    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} reducedMotion />)

    await act(async () => {
      void ref.current!.handleRun()
    })
    await act(async () => {
      pendingRuns.forEach((resolve) => resolve(multiResult(3)))
    })
    expect(ref.current!.runStatus).toBe('completed')

    // 末态上按单步 = 重跑并停在首帧（既有语义），随后逐步推进。
    // 这里不能 await handleStep()：它内部 await 的是那个由测试决定何时 resolve 的运行器。
    await act(async () => {
      void ref.current!.handleStep()
    })
    await act(async () => {
      pendingRuns.forEach((resolve) => resolve(multiResult(3)))
    })
    expect(ref.current!.runStatus).toBe('paused')
    expect(ref.current!.eventIndex).toBe(0)

    await act(async () => {
      ref.current!.handleStep()
    })
    expect(ref.current!.eventIndex).toBe(1)
    expect(ref.current!.visibleOutput).toEqual(['1', '2'])
  })

  it('开关在这一跑已经开跑之后才命中：这一跑放完并正常收口，不半途冻在 running', async () => {
    const { ref, onReady } = harnessRef()
    const { rerender } = render(<Harness onReady={onReady} />)

    await act(async () => {
      void ref.current!.handleRun()
    })
    await act(async () => {
      pendingRuns.forEach((resolve) => resolve(multiResult(2)))
    })
    expect(ref.current!.runStatus).toBe('running')
    expect(ref.current!.eventIndex).toBe(0)

    await act(async () => {
      rerender(<Harness onReady={onReady} reducedMotion />)
    })
    // 这一句钉的是本实现那条已知边界：中途翻开关不打断已在推进的这一跑，
    // 从下一次运行起才不再逐帧。反过来（直接不排定时器又不改状态）会留下
    // 「永远 running」的坏状态，所以实现把判定放在结果落地的那一刻。
    await vi.waitFor(() => expect(ref.current!.runStatus).toBe('completed'), { timeout: 4000 })
    expect(ref.current!.visibleOutput).toEqual(['1', '2'])
  })
})

describe('§5.3 画布「上一步」的跳转入口 handleSeek', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** 跑完一次三步运行，停在末态（`paused` 之外的起点由各用例自己造）。 */
  async function runToEnd(ref: { current: Api | null }) {
    await act(async () => {
      void ref.current!.handleRun()
    })
    await act(async () => {
      pendingRuns.forEach((resolve) => resolve(multiResult(3)))
    })
  }

  it('可以往回退：把播放头设成任意一拍，退回后状态是 paused', async () => {
    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)
    await runToEnd(ref)
    expect(ref.current!.eventIndex).toBe(0)

    await act(async () => {
      ref.current!.handleSeek(2)
    })
    expect(ref.current!.eventIndex).toBe(2)
    expect(ref.current!.visibleOutput).toEqual(['1', '2', '3'])
    expect(ref.current!.runStatus).toBe('paused')

    await act(async () => {
      ref.current!.handleSeek(1)
    })
    expect(ref.current!.eventIndex).toBe(1)
    expect(ref.current!.visibleOutput).toEqual(['1', '2'])
    // 倒退不是「重跑」：输出是同一批，没有多出东西。
    expect(ref.current!.execution.output).toHaveLength(3)
  })

  it('越界与负数被夹到合法区间，不会把播放头丢到帧外', async () => {
    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)
    await runToEnd(ref)

    await act(async () => {
      ref.current!.handleSeek(99)
    })
    expect(ref.current!.eventIndex).toBe(2) // 末帧 = events.length - 1

    await act(async () => {
      ref.current!.handleSeek(-5)
    })
    expect(ref.current!.eventIndex).toBe(0)
  })

  it('播放中跳转即接管时钟：跳完不再自动前进（迟到的 tick 不许把播放头拽回去）', async () => {
    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)
    await runToEnd(ref)
    // 从末态重跑，把状态弄回 running（首帧起步）。
    await act(async () => {
      void ref.current!.handleStep()
    })
    await act(async () => {
      pendingRuns.forEach((resolve) => resolve(multiResult(3)))
    })
    expect(ref.current!.runStatus).toBe('paused')

    // 造一个「正在播放」的状态：从首帧起排链。
    await act(async () => {
      void ref.current!.handleRun()
    })
    await act(async () => {
      pendingRuns.forEach((resolve) => resolve(multiResult(3)))
    })
    expect(ref.current!.runStatus).toBe('running')

    // 播放中点「上一步」：跳转生效，且状态被钉成 paused——
    // 否则链上迟到的那一个 tick 会在下一拍把播放头再推回去。
    await act(async () => {
      ref.current!.handleSeek(0)
    })
    expect(ref.current!.runStatus).toBe('paused')

    await new Promise((resolve) => setTimeout(resolve, EXECUTION_SETTINGS.STEP_DELAY_MS + 200))
    expect(ref.current!.eventIndex).toBe(0)
  })

  it('enabled=false（工作台不可见）时跳转不生效', async () => {
    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} enabled={false} />)

    // 先在被禁用的情况下尝试跳转：没有事件，下标无处可去，仍是 0。
    await act(async () => {
      ref.current!.handleSeek(2)
    })
    expect(ref.current!.eventIndex).toBe(0)
    expect(ref.current!.runStatus).not.toBe('paused')
  })
})
