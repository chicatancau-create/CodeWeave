// @vitest-environment jsdom
/**
 * 画布组件契约测试（`components/run-stage.tsx`）。
 *
 * 断言风格与项目现有 jsdom 测试一致：**直接读 DOM 结构与文本，不依赖 jest-dom 匹配器**
 * （那套匹配器本项目没有装，`toBeInTheDocument` 之类在这里不存在）。
 *
 * 这一份盯的是**画布上出现了什么、没出现什么**——不是帧模型算得对不对（那是
 * `engine/run-stage-model.test.ts` 的事），而是这些算出来的东西有没有如实落到 DOM 上：
 *
 * - 没拍就不画控制条（不画一排永远禁用的按钮）；
 * - 首帧 `上一步` 禁用、末帧 `下一步` 禁用，且这判断来自 props 而不是内部状态；
 * - 计数器两位对齐 `03 / 07`；
 * - 当前拍恰有一个 `aria-current="step"`（读屏用户靠它认「现在我在这儿」）；
 * - **没走到的节点不填假值**——「尚未执行」四个字必须在，序号必须是 `--`，
 *   这是 `flow-chart` 那条纪律在画布上的同一份。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunStage, type RunStageProps } from './run-stage'
import type { StageFrame, StageNode } from '../engine/run-stage-model'

afterEach(cleanup)

const node = (over: Partial<StageNode> & { id: string }): StageNode => ({
  label: `节点 ${over.id}`,
  kind: 'process',
  tone: 'blue',
  ordinal: null,
  state: 'todo',
  line: null,
  cells: [],
  visit: 0,
  ...over,
})

const frame = (over: Partial<StageFrame> & { nodes: StageNode[] }): StageFrame => ({
  index: 0,
  total: 1,
  loopBackFrom: null,
  loops: 0,
  caption: '这一拍在做什么',
  line: 1,
  outputLines: [],
  ...over,
})

const props = (over: Partial<RunStageProps> = {}): RunStageProps => ({
  frame: null,
  playing: false,
  stepIndex: 0,
  stepTotal: 0,
  canStep: false,
  onPrev: vi.fn(),
  onNext: vi.fn(),
  onTogglePlay: vi.fn(),
  onReset: vi.fn(),
  ...over,
})

/** 按文本找一条骨架节点（`<li>`）：`getAllByRole('listitem')` 里挑出含该字样的那条。 */
const itemWith = (text: string): HTMLElement => {
  const hit = screen.getAllByRole('listitem').find((li) => li.textContent?.includes(text))
  if (!hit) throw new Error(`没有找到含「${text}」的列表项`)
  return hit
}

describe('run-stage · 空态', () => {
  it('frame 为 null 时整块不画（还没运行过，不拿空骨架画假节点）', () => {
    const { container } = render(<RunStage {...props({ frame: null })} />)
    expect(container.innerHTML).toBe('')
  })

  it('canStep 为假时连控制条都不画，而不是画一排永远禁用的按钮', () => {
    const f = frame({ nodes: [node({ id: 'n1' })], total: 0 })
    render(<RunStage {...props({ frame: f, canStep: false, stepTotal: 0 })} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    // 但骨架本身照画：没有拍 ≠ 没有程序。
    expect(screen.getByRole('list', { name: /程序状态图/ })).toBeTruthy()
  })
})

describe('run-stage · 步进按钮', () => {
  const threeNodes = [
    node({ id: 'n1', label: '开始', kind: 'start', ordinal: 1, state: 'done', line: 1 }),
    node({ id: 'n2', label: '累加', kind: 'process', ordinal: 2, state: 'now', line: 2 }),
    node({ id: 'n3', label: '结束', kind: 'end', ordinal: null, state: 'todo' }),
  ]

  it('首帧：上一步禁用，下一步可用', () => {
    render(<RunStage {...props({ frame: frame({ nodes: threeNodes }), canStep: true, stepIndex: 0, stepTotal: 7 })} />)
    const prev = screen.getByRole('button', { name: /上一步/ }) as HTMLButtonElement
    const next = screen.getByRole('button', { name: /下一步/ }) as HTMLButtonElement
    expect(prev.disabled).toBe(true)
    expect(next.disabled).toBe(false)
  })

  it('末帧：下一步禁用，上一步可用', () => {
    render(<RunStage {...props({ frame: frame({ nodes: threeNodes }), canStep: true, stepIndex: 6, stepTotal: 7 })} />)
    const prev = screen.getByRole('button', { name: /上一步/ }) as HTMLButtonElement
    const next = screen.getByRole('button', { name: /下一步/ }) as HTMLButtonElement
    expect(next.disabled).toBe(true)
    expect(prev.disabled).toBe(false)
  })

  it('三个按钮各带一个回调，点击只触发自己那一个', () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    const onTogglePlay = vi.fn()
    const onReset = vi.fn()
    render(
      <RunStage
        {...props({ frame: frame({ nodes: threeNodes }), canStep: true, stepIndex: 3, stepTotal: 7, onPrev, onNext, onTogglePlay, onReset })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /上一步/ }))
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }))
    fireEvent.click(screen.getByRole('button', { name: /播放/ }))
    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onTogglePlay).toHaveBeenCalledTimes(1)
    // 画布上不摆第二个「重置」：页面上那份归 `RuntimeTraceControls`，
    // 两个同名按钮会让读屏与查询都撞车。
    expect(screen.queryByRole('button', { name: /重置/ })).toBeNull()
    expect(onReset).not.toHaveBeenCalled()
  })

  it('播放中：按钮变「暂停」并带 aria-pressed，组件自己不驱动时间', () => {
    render(<RunStage {...props({ frame: frame({ nodes: threeNodes }), canStep: true, stepIndex: 1, stepTotal: 7, playing: true })} />)
    const play = screen.getByRole('button', { name: /暂停/ })
    expect(play.getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('button', { name: /^播放$/ })).toBeNull()
  })
})

describe('run-stage · 计数器与当前拍', () => {
  it('两位对齐：`03 / 07`，并带完整可读标签', () => {
    const nodes = [node({ id: 'n1', state: 'now', ordinal: 1 })]
    render(<RunStage {...props({ frame: frame({ nodes, index: 2 }), canStep: true, stepIndex: 2, stepTotal: 7 })} />)
    expect(screen.getByText('03 / 07')).toBeTruthy()
    expect(screen.getByLabelText('第 3 拍，共 7 拍')).toBeTruthy()
  })

  it('当前拍恰有一个 aria-current="step"', () => {
    const nodes = [
      node({ id: 'n1', state: 'done', ordinal: 1 }),
      node({ id: 'n2', state: 'now', ordinal: 2 }),
      node({ id: 'n3', state: 'todo' }),
    ]
    const { container } = render(
      <RunStage {...props({ frame: frame({ nodes }), canStep: true, stepIndex: 1, stepTotal: 3 })} />,
    )
    const currents = container.querySelectorAll('[aria-current="step"]')
    expect(currents).toHaveLength(1)
    expect(currents[0]!.textContent).toContain('节点 n2')
  })
})

describe('run-stage · 没走到的节点不填假值', () => {
  it('未走到的节点：`尚未执行` + 序号 `--`，且没有数据格', () => {
    const nodes = [
      node({ id: 'n1', label: '已走过', state: 'done', ordinal: 1, line: 4 }),
      node({ id: 'n2', label: '还没到', state: 'todo', ordinal: null, line: 9 }),
    ]
    render(<RunStage {...props({ frame: frame({ nodes }), canStep: true, stepIndex: 0, stepTotal: 2 })} />)

    const todo = itemWith('还没到')
    expect(todo.textContent).toContain('尚未执行')
    expect(todo.textContent).toContain('--')
    expect(todo.textContent).toContain('尚未落值')
    // 骨架里的静态行号不许冒充此刻的播放头。
    expect(todo.textContent).not.toContain('L9')
  })

  it('数据格只在当前这一拍命中的那一格上出现', () => {
    const nodes = [
      node({ id: 'n1', label: '上一拍', state: 'done', ordinal: 1, line: 1, cells: [] }),
      node({
        id: 'n2',
        label: '这一拍',
        state: 'now',
        ordinal: 2,
        line: 2,
        cells: [{ name: 'total', value: '6', type: 'int', changed: true, born: false }],
      }),
    ]
    render(<RunStage {...props({ frame: frame({ nodes }), canStep: true, stepIndex: 1, stepTotal: 2 })} />)

    const past = itemWith('上一拍')
    const now = itemWith('这一拍')
    expect(past.textContent).toContain('尚未落值')
    expect(now.textContent).toContain('total')
    expect(now.textContent).toContain('6')
    expect(now.textContent).toContain('这一拍被改写')
    // 上一拍的值没被搬到这一拍的画布上
    expect(past.textContent).not.toContain('6')
  })

  it('一拍的全部分量都画出来：`for-sum` 每一步同时带着 i 与 total', () => {
    const nodes = [
      node({
        id: 'n1',
        label: '累加',
        state: 'now',
        ordinal: 1,
        line: 3,
        cells: [
          { name: 'i', value: '3', type: 'int', changed: true, born: false },
          { name: 'total', value: '3', type: 'int', changed: true, born: false },
        ],
      }),
    ]
    const { container } = render(
      <RunStage {...props({ frame: frame({ nodes }), canStep: true, stepIndex: 2, stepTotal: 7 })} />,
    )
    // 两个格都在：这一拍程序的状态是「i 与 total 各自是多少」，不是「只报一个」。
    expect(container.querySelectorAll('.rs-cell')).toHaveLength(2)
    const now = itemWith('累加')
    expect(now.textContent).toContain('i')
    expect(now.textContent).toContain('total')
  })

  it('重访次数只在真的绕回来过时出现（`×1` 是废话）', () => {
    const nodes = [node({ id: 'n1', state: 'now', ordinal: 1, visit: 3, line: 2 })]
    render(<RunStage {...props({ frame: frame({ nodes }), canStep: true, stepIndex: 1, stepTotal: 3 })} />)
    expect(screen.getByText('第 3 次')).toBeTruthy()
  })
})

describe('run-stage · 回边与输出', () => {
  it('没有回环时不画回边注记（直线程序不该出现「绕回」两个字）', () => {
    const nodes = [node({ id: 'n1', state: 'now', visit: 1 })]
    render(<RunStage {...props({ frame: frame({ nodes, loopBackFrom: null, loops: 0 }) })} />)
    expect(screen.queryByText(/绕回/)).toBeNull()
  })

  it('有回环时给出注记，且起弧点在节点下标所指的那一格上', () => {
    const nodes = [
      node({ id: 'n1', label: '初始化', state: 'done', ordinal: 1 }),
      node({ id: 'n2', label: '判定', state: 'now', ordinal: 2, visit: 3 }),
    ]
    const { container } = render(
      <RunStage {...props({ frame: frame({ nodes, loopBackFrom: 1, loops: 2 }), canStep: true, stepIndex: 1, stepTotal: 5 })} />,
    )
    // 唯一的 role="status"：注记本身（画布里没有第二条活区抢播报）
    expect(screen.getByRole('status').textContent).toContain('已经回到上面的判定 2 次')
    const looped = container.querySelectorAll('.rs-node.is-loop-back')
    expect(looped).toHaveLength(1)
    expect(looped[0]!.textContent).toContain('判定')
  })

  it('输出区按拍累计；没有输出时整块不画', () => {
    const nodes = [node({ id: 'n1', state: 'now', ordinal: 1 })]
    const { rerender } = render(<RunStage {...props({ frame: frame({ nodes, outputLines: [] }) })} />)
    expect(screen.queryByText('输出')).toBeNull()

    rerender(<RunStage {...props({ frame: frame({ nodes, outputLines: ['15'] }) })} />)
    expect(screen.getByText('输出')).toBeTruthy()
    expect(screen.getByText('15')).toBeTruthy()
  })
})
