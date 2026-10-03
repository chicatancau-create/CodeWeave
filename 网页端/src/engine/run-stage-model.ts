/**
 * 代码 → 动画画布的**帧模型**（纯函数，无 DOM、无 React）。
 *
 * 与 `flow-chart.tsx` 的分工：流程图是「一拍一行」的**文字快照**，回答「现在在哪儿、
 * 值是多少」；画布要回答的是**这段程序在图上长什么形状**——数据格什么时候落值、
 * 哪一格刚被改过、循环绕回来了几圈。两者的数据同源（同一个 `eventIndex`），
 * 所以这一层**不重新折一遍 join**：输入直接收上层已经折好的 `FlowStep[]`
 * （`learning-workspace-view.tsx` 的 `flowSteps` memo，按 `nodeId` 把 `lesson.flow`
 * 与 `execution.events` 合到一处），本文件只做「帧」这一层的加法。
 *
 * 三条实现上的硬事实，都是踩过的坑：
 *
 * 1. **回边只能从事件流推导，不能从数据模型拿。** `FlowNode` 只有
 *    `{ id, label, kind, tone, line? }`——**没有坐标、没有 edges**，拓扑只隐含在数组
 *    顺序里。所以「绕回来了」这一事实的判据是：同一个 `nodeId` 在 `events` 里第二次
 *    出现。这个信息已经在事件流里，不需要改 `src/data/lessons.ts` 的任何字面量。
 *
 * 2. **变量快照只能按值比，不能按引用比。** `teaching-runtime.ts` 在推进每一步时
 *    复用同一个 `variables` 数组对象原地改写（`events.push` 进去的是同一个引用），
 *    所以 `prev.variables === next.variables` 恒为真、而内容已经变了。这里逐帧比较时
 *    把每一项摊成 `name|value|type` 字符串再比，比较的是**这一拍读者看到的东西**。
 *
 * 3. **每帧独立重算。** `stageFrameAt(events, steps, i)` 不依赖第 `i-1` 帧的结果，
 *    所以「上一步」是幂等的：从尾跳头、连点两次、来回横跳，都不会漂。`stageFrames`
 *    只是为了测试与将来的导出，逐个 index 调同一支函数。
 */
import type { FlowNodeKind, TraceEvent, VariableValue } from '../types/lesson'

/** 节点色调：与 `FlowNode['tone']` 同一组，画布按它决定边框与数值的颜色档。 */
export type StageTone = 'purple' | 'blue' | 'yellow' | 'coral' | 'green'

/** 画布上的一个数据格（一拍的某一个变量的值）。 */
export type StageCell = {
  name: string
  value: string
  type: string
  /** 与上一拍比，这个变量的值**真的变了**（按值比，不按引用）。 */
  changed: boolean
  /** 这一拍是它第一次出现（上一拍还没有这个名字）。 */
  born: boolean
}

/** 画布上的一个节点（骨架来自 `lesson.flow`，状态来自走到第几拍）。 */
export type StageNode = {
  id: string
  label: string
  kind: FlowNodeKind
  tone: StageTone
  /** 走到过才有号（1 起，取第一次走到的次序）；没走到记 null，画 `--`。 */
  ordinal: number | null
  /** `todo` 未走到 / `now` 当前停留 / `done` 已走过。 */
  state: 'todo' | 'now' | 'done'
  /** 这个节点当前这一拍的源码行（`event.line`），没走到时退回骨架的 `node.line`。 */
  line: number | null
  /**
   * 这个节点当前这一拍的数据格；空数组 = 还没走到（不填假值）。
   *
   * 是**数组**而不是单格：`TraceEvent.variables` 是这一拍**全部变量**的快照
   * （`for-sum` 一路带着 `[i, total]`），不是「这一步写的那一个绑定」——
   * 它上面没有节点名，所以按节点名去查一格是查不到的。整份快照挂在当前命中的节点上，
   * 才是「这一拍程序的状态」的如实呈现。
   */
  cells: StageCell[]
  /** 到这一拍为止，这个节点被走到过几次；>1 即「循环绕回来了」。 */
  visit: number
}

export type StageFrame = {
  /** 当前帧下标（0 起）。 */
  index: number
  /** 总拍数。 */
  total: number
  nodes: StageNode[]
  /**
   * 有回环时，第一处出现「重复访问」的节点在 `nodes` 里的下标（0 起）；没有回环记 null。
   * 画布据此把这条回边画出来——`null` 就是「这段程序是一条直线」。
   */
  loopBackFrom: number | null
  /** 到这一拍为止已经绕回来的圈数（重复访问的总次数）。 */
  loops: number
  /** 这一拍在做什么（`event.label`）。 */
  caption: string
  /** 这一拍命中的源码行。 */
  line: number | null
  /** 到这一拍为止已经落下的输出行。 */
  outputLines: string[]
}

/** 帧模型的输入形状：与 `flow-chart.tsx` 导出的 `FlowStep` 结构兼容（只取需要的那几项）。 */
export type StageStep = {
  id: string
  label: string
  kind: string
  tone: string
  line?: number
  event?: TraceEvent
  ordinal?: number
}

const TONES: readonly StageTone[] = ['purple', 'blue', 'yellow', 'coral', 'green']

/** `FlowStep` 的 `kind` / `tone` 是宽松的 `string`（它由 `lesson.flow` 直接搬来），收敛到画布的联合类型。 */
const asKind = (kind: string): FlowNodeKind => {
  const known: readonly FlowNodeKind[] = ['start', 'process', 'decision', 'output', 'end']
  return (known as readonly string[]).includes(kind) ? (kind as FlowNodeKind) : 'process'
}
const asTone = (tone: string): StageTone => ((TONES as readonly string[]).includes(tone) ? (tone as StageTone) : 'blue')

/** 一个变量在这一拍下的**可比字符串**：值比的是读者看到的东西，不是数组引用。 */
const cellKey = (v: VariableValue) => `${v.name}|${v.value}|${v.type}`

/**
 * 第 `index` 拍的数据格：与第 `index-1` 拍逐项比，标出 changed / born。
 * 第 0 拍没有「上一拍」，所以全部 born（此刻它们确实是第一次出现），changed 一律 false。
 */
function cellsAt(events: TraceEvent[], index: number): StageCell[] {
  const current = events[index]?.variables ?? []
  if (current.length === 0) return []
  const before = index > 0 ? (events[index - 1]?.variables ?? []) : null
  const beforeKeys = before === null ? null : new Set(before.map(cellKey))
  const beforeByName = new Map((before ?? []).map((v) => [v.name, cellKey(v)]))
  return current.map((v) => {
    const key = cellKey(v)
    return {
      name: v.name,
      value: v.value,
      type: v.type,
      born: beforeKeys === null ? true : !beforeKeys.has(key) && !beforeByName.has(v.name),
      changed: beforeByName.has(v.name) && beforeByName.get(v.name) !== key,
    }
  })
}

/**
 * 折出第 `index` 拍的一整帧。`index` 越界（含 `events` 为空）返回 null——
 * 没有拍就没有帧，不拿空数据画假节点。
 */
export function stageFrameAt(events: TraceEvent[], steps: StageStep[], index: number): StageFrame | null {
  if (events.length === 0) return null
  if (!Number.isInteger(index) || index < 0 || index >= events.length) return null

  const cells = cellsAt(events, index)
  const activeNodeId = events[index]?.nodeId

  /**
   * 每个节点到这一拍为止被走到过几次。
   * 只数**到当前拍为止**的事件——这正是「这一拍画布上的样子」的定义。
   */
  const visits = new Map<string, number>()
  const firstOrdinal = new Map<string, number>()
  for (let i = 0; i <= index; i++) {
    const nodeId = events[i]?.nodeId
    if (!nodeId) continue
    visits.set(nodeId, (visits.get(nodeId) ?? 0) + 1)
    if (!firstOrdinal.has(nodeId)) firstOrdinal.set(nodeId, i + 1)
  }

  const nodes: StageNode[] = steps.map((step) => {
    const visit = visits.get(step.id) ?? 0
    const hit = visit > 0
    // 该节点当前这一拍的事件：从当前拍往回找最近一次命中它的那一拍。
    // 用反向扫描而不是 Map 缓存，是因为 `events[index].nodeId` 只有一处是本拍的。
    let event: TraceEvent | undefined
    if (hit) {
      if (activeNodeId === step.id) event = events[index]
      for (let i = index; i >= 0 && !event; i--) {
        if (events[i]?.nodeId === step.id) event = events[i]
      }
    }
    return {
      id: step.id,
      label: step.label,
      kind: asKind(step.kind),
      tone: asTone(step.tone),
      ordinal: firstOrdinal.get(step.id) ?? step.ordinal ?? null,
      state: step.id === activeNodeId ? 'now' : hit ? 'done' : 'todo',
      line: hit ? (event?.line ?? step.line ?? null) : (step.line ?? null),
      // 数据格只挂在**当前这一拍命中的节点**上：其他节点此刻画出来的是它们自己那一拍的
      // 旧快照，摆在「现在」的画布上会说谎。没走到就是空数组，一个假值都不填。
      cells: step.id === activeNodeId ? cells : [],
      visit,
    }
  })

  /**
   * 回边：第一个「被访问过两次以上」的节点。取 `nodes` 里的下标而不是事件下标，
   * 因为画布是按骨架画的，回边要从骨架上的那一格起弧。
   */
  let loopBackFrom: number | null = null
  let loops = 0
  nodes.forEach((node, i) => {
    if (node.visit > 1) {
      loops += node.visit - 1
      if (loopBackFrom === null) loopBackFrom = i
    }
  })

  const outputLines = events
    .slice(0, index + 1)
    .filter((e) => e.type === 'output')
    .map((e) => e.label)

  return {
    index,
    total: events.length,
    nodes,
    loopBackFrom,
    loops,
    caption: events[index]?.label ?? '',
    line: events[index]?.line ?? null,
    outputLines,
  }
}

/**
 * 每一拍折一帧。只服务测试与将来的导出——界面每帧调 `stageFrameAt` 一次即可
 * （避免把整段运行都算一遍，`events` 长的时候那是白算的）。
 */
export function stageFrames(events: TraceEvent[], steps: StageStep[]): StageFrame[] {
  const out: StageFrame[] = []
  for (let i = 0; i < events.length; i++) {
    const frame = stageFrameAt(events, steps, i)
    if (frame) out.push(frame)
  }
  return out
}
