/**
 * 帧模型契约测试（`engine/run-stage-model.ts`）。
 *
 * 四组断言，每组盯的是这一层最容易悄悄坏掉的一种方式：
 * 1. **幂等**：`stageFrameAt(i)` 不依赖上一帧——否则「上一步」会漂；
 * 2. **回边推导**：回环只能从「同一个 nodeId 第二次出现」推出来，
 *    这里拿真的跑一遍 `for-sum` / `while-loop` 的事件流对账圈数；
 * 3. **按值比较**：内容逐字相同、但数组对象不同的两拍必须算「没变」（按引用比会误报成
 *    改写）；内容不同则必须标 changed；
 * 4. **边界**：没有事件、下标越界、非整数下标一律 null，不返回半帧。
 */
import { describe, it, expect } from 'vitest'
import { stageFrameAt, stageFrames, type StageStep } from './run-stage-model'
import { simulateProgram, TEACHING_TEMPLATES } from './teaching-runtime'
import type { Lesson, TraceEvent } from '../types/lesson'

const mockLesson = (overrides: Partial<Lesson> = {}): Lesson => ({
  id: 'test-lesson',
  language: 'python',
  languageLabel: 'Python',
  label: '01',
  title: 'Test Lesson',
  description: 'A test lesson',
  duration: '5 min',
  level: '入门',
  progress: 0,
  code: '',
  flow: [],
  insight: '',
  fileName: 'test.py',
  runtime: 'Python 3.11',
  content: {
    objective: '',
    prerequisites: [],
    explanation: [],
    examples: [],
    guidedSteps: [],
    exercise: '',
    variant: '',
    projectTask: '',
    mistakes: [],
    runCommand: '',
    completion: '',
    reviewOffsetsDays: [],
  },
  ...overrides,
})

/** 从事件流里折出骨架：与 `learning-workspace-view.tsx` 的 `flowSteps` 同一口径（首现次序）。 */
const stepsOf = (events: TraceEvent[]): StageStep[] => {
  const seen = new Set<string>()
  const out: StageStep[] = []
  for (const event of events) {
    if (!event.nodeId || seen.has(event.nodeId)) continue
    seen.add(event.nodeId)
    out.push({ id: event.nodeId, label: event.label, kind: 'process', tone: 'blue' })
  }
  return out
}

const runForSum = () =>
  simulateProgram('total = 0\nfor i in range(1, 6):\n    total += i\nprint(total)', 'python', mockLesson())

describe('run-stage-model · 幂等', () => {
  it('stageFrameAt(i) 与 stageFrames()[i] 逐帧相同（上一步不会漂）', () => {
    const result = runForSum()
    const steps = stepsOf(result.events)
    expect(result.events.length).toBeGreaterThan(4)

    const all = stageFrames(result.events, steps)
    expect(all).toHaveLength(result.events.length)
    for (let i = 0; i < result.events.length; i++) {
      expect(stageFrameAt(result.events, steps, i)).toEqual(all[i])
    }
  })

  it('倒着取帧与正着取帧结果一致（没有偷偷依赖前一次调用）', () => {
    const result = runForSum()
    const steps = stepsOf(result.events)
    const forward = result.events.map((_, i) => stageFrameAt(result.events, steps, i))
    const backward = []
    for (let i = result.events.length - 1; i >= 0; i--) backward.unshift(stageFrameAt(result.events, steps, i))
    expect(backward).toEqual(forward)
  })
})

describe('run-stage-model · 回边从事件流推导', () => {
  it('for-sum 走到最后：确实绕回来过，且圈数与事件里的重复命中一致', () => {
    const result = runForSum()
    const steps = stepsOf(result.events)
    const last = stageFrameAt(result.events, steps, result.events.length - 1)

    expect(last).not.toBeNull()
    // 骨架里的每一个节点，到末帧为止的访问次数，与事件流里数出来的完全一致。
    const counted = new Map<string, number>()
    for (const event of result.events) {
      if (event.nodeId) counted.set(event.nodeId, (counted.get(event.nodeId) ?? 0) + 1)
    }
    for (const node of last!.nodes) {
      expect(node.visit, node.id).toBe(counted.get(node.id) ?? 0)
    }
    // 重复访问的次数之和 = loops。
    const repeats = [...counted.values()].reduce((sum, n) => sum + Math.max(0, n - 1), 0)
    expect(last!.loops).toBe(repeats)
    expect(last!.loops).toBeGreaterThan(0)
    // 有回环就一定有起弧点，且那一格确实被访问过不止一次。
    expect(last!.loopBackFrom).not.toBeNull()
    expect(last!.nodes[last!.loopBackFrom!]!.visit).toBeGreaterThan(1)
  })

  it('首帧还没绕回来：loops 为 0，回边为 null', () => {
    const result = runForSum()
    const first = stageFrameAt(result.events, stepsOf(result.events), 0)
    expect(first!.loops).toBe(0)
    expect(first!.loopBackFrom).toBeNull()
  })

  it('每个教学模板都能折出帧，且末帧的下标与拍数对得上', () => {
    // 模板清单是这台模拟器自己的事实，不在这里另抄一份：能跑起来的就都折一遍。
    expect(TEACHING_TEMPLATES.length).toBeGreaterThan(4)
    const samples: Record<string, string> = {
      parity: 'n = 4\nif n % 2 == 0:\n    print("even")\nelse:\n    print("odd")',
      'while-loop': 'n = 3\nwhile n > 0:\n    print(n)\n    n -= 1',
      'max-of-two': 'int a = 3;\nint b = 7;\nif (a > b) { print(a); } else { print(b); }',
      'for-sum': 'total = 0\nfor i in range(1, 6):\n    total += i\nprint(total)',
      'age-increment': 'age = 30\nprint(age + 1)',
    }
    let folded = 0
    for (const [id, code] of Object.entries(samples)) {
      const result = simulateProgram(code, 'python', mockLesson())
      if (result.events.length === 0) continue // 没识别成这个模板的样本跳过，不在这一层断言识别率
      const frames = stageFrames(result.events, stepsOf(result.events))
      expect(frames, id).toHaveLength(result.events.length)
      expect(frames.at(-1)!.index, id).toBe(result.events.length - 1)
      expect(frames.at(-1)!.total, id).toBe(result.events.length)
      folded++
    }
    expect(folded).toBeGreaterThanOrEqual(2)
  })
})

describe('run-stage-model · 变量快照按值比较', () => {
  it('两个数组对象、内容逐字相同的两拍算「没变」——比的是值，不是数组引用', () => {
    // 反向守卫：这一层若偷懒按引用比（`prev.variables === next.variables`），或者干脆
    // 每拍一律标 changed，这一条都会红。两拍给的是**两个不同的数组对象**、内容完全一致，
    // 正确结果是 changed=false、born=false。
    const before: TraceEvent['variables'] = [{ name: 'total', value: '3', type: 'int', color: 'blue' }]
    const after: TraceEvent['variables'] = [{ name: 'total', value: '3', type: 'int', color: 'blue' }]
    expect(before === after).toBe(false)

    const events: TraceEvent[] = [
      { id: 'e0', type: 'start', line: 1, label: '开始', detail: '', variables: before, nodeId: 'n1' },
      { id: 'e1', type: 'assign', line: 2, label: '累加', detail: '', variables: after, nodeId: 'n1' },
    ]
    const steps: StageStep[] = [{ id: 'n1', label: '累加', kind: 'process', tone: 'blue' }]
    const cells = stageFrameAt(events, steps, 1)!.nodes[0]!.cells
    expect(cells).toMatchObject([{ name: 'total', value: '3', changed: false, born: false }])
  })

  it('内容不同就标 changed（两份各自独立的快照）', () => {
    const events: TraceEvent[] = [
      {
        id: 'e0',
        type: 'start',
        line: 1,
        label: '开始',
        detail: '',
        variables: [{ name: 'total', value: '0', type: 'int', color: 'blue' }],
        nodeId: 'n1',
      },
      {
        id: 'e1',
        type: 'assign',
        line: 2,
        label: '累加',
        detail: '',
        variables: [{ name: 'total', value: '6', type: 'int', color: 'blue' }],
        nodeId: 'n1',
      },
    ]
    const steps: StageStep[] = [{ id: 'n1', label: '累加', kind: 'process', tone: 'blue' }]
    const cells = stageFrameAt(events, steps, 1)!.nodes[0]!.cells
    expect(cells[0]!.value).toBe('6')
    expect(cells[0]!.changed).toBe(true)
    expect(cells[0]!.born).toBe(false)
  })

  it('第 0 拍的变量算「首次出现」而不是「被改写」', () => {
    const events: TraceEvent[] = [
      {
        id: 'e0',
        type: 'assign',
        line: 1,
        label: '赋值',
        detail: '',
        variables: [{ name: 'a', value: '4', type: 'int', color: 'blue' }],
        nodeId: 'n1',
      },
    ]
    const frame = stageFrameAt(events, [{ id: 'n1', label: '赋值', kind: 'process', tone: 'blue' }], 0)
    expect(frame!.nodes[0]!.cells).toMatchObject([{ name: 'a', value: '4', born: true, changed: false }])
  })

  it('数据格只挂在当前这一拍命中的节点上，其他节点不填旧值', () => {
    const events: TraceEvent[] = [
      {
        id: 'e0',
        type: 'assign',
        line: 1,
        label: '第一拍',
        detail: '',
        variables: [{ name: 'a', value: '1', type: 'int', color: 'blue' }],
        nodeId: 'n1',
      },
      {
        id: 'e1',
        type: 'assign',
        line: 2,
        label: '第二拍',
        detail: '',
        variables: [{ name: 'b', value: '2', type: 'int', color: 'blue' }],
        nodeId: 'n2',
      },
    ]
    const steps: StageStep[] = [
      { id: 'n1', label: '一', kind: 'process', tone: 'blue' },
      { id: 'n2', label: '二', kind: 'process', tone: 'blue' },
    ]
    const frame = stageFrameAt(events, steps, 1)
    expect(frame!.nodes[1]!.state).toBe('now')
    expect(frame!.nodes[1]!.cells).toMatchObject([{ name: 'b', value: '2' }])
    // n1 在第一拍已经走过了（state=done），但它那一拍的 a=1 不该出现在第二拍的画布上。
    expect(frame!.nodes[0]!.state).toBe('done')
    expect(frame!.nodes[0]!.cells).toEqual([])
  })
})

describe('run-stage-model · 边界', () => {
  const events: TraceEvent[] = [
    { id: 'e0', type: 'start', line: 1, label: '开始', detail: '', variables: [], nodeId: 'n1' },
  ]
  const steps: StageStep[] = [{ id: 'n1', label: '开始', kind: 'start', tone: 'purple' }]

  it('没有事件时返回 null，不返回半帧', () => {
    expect(stageFrameAt([], steps, 0)).toBeNull()
    expect(stageFrames([], steps)).toEqual([])
  })

  it('下标越界 / 非整数一律 null', () => {
    expect(stageFrameAt(events, steps, -1)).toBeNull()
    expect(stageFrameAt(events, steps, 1)).toBeNull()
    expect(stageFrameAt(events, steps, 1.5)).toBeNull()
    expect(stageFrameAt(events, steps, Number.NaN)).toBeNull()
  })

  it('没走到的节点：state=todo、ordinal=null、不填数据格', () => {
    const twoSteps: StageStep[] = [...steps, { id: 'n2', label: '结束', kind: 'end', tone: 'green' }]
    const frame = stageFrameAt(events, twoSteps, 0)
    expect(frame!.nodes[1]).toMatchObject({ state: 'todo', ordinal: null, cells: [], visit: 0 })
  })

  it('输出行只累计到当前这一拍为止', () => {
    const out: TraceEvent[] = [
      { id: 'e0', type: 'output', line: 1, label: '第一行', detail: '', variables: [], nodeId: 'n1' },
      { id: 'e1', type: 'output', line: 2, label: '第二行', detail: '', variables: [], nodeId: 'n1' },
    ]
    expect(stageFrameAt(out, steps, 0)!.outputLines).toEqual(['第一行'])
    expect(stageFrameAt(out, steps, 1)!.outputLines).toEqual(['第一行', '第二行'])
  })
})
