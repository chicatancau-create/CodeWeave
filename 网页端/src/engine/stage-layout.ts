/**
 * 画布布局（stage-layout）：把 `StageFrame` 折成**可以直接画的几何**。
 *
 * 为什么要这一层：`FlowNode` 只有 `{ id, label, kind, tone, line? }`——**没有坐标、
 * 没有 edges**，拓扑只隐含在 `nodes` 数组的顺序里。而画布要画方块、要画箭头，
 * 就必须有 x/y 和「从哪到哪」。两条路可走：给 `src/data/lessons.ts` 里每一课的 flow
 * 字面量补坐标，或者在渲染前算出来。选后者——**数据零改动**，八套课程模板一行不动，
 * 顺序变了布局自己跟着变，不会出现「数据里写的坐标和实际顺序打架」这种两处真相。
 *
 * 纯函数，无 DOM、无 React：布局是可以单测的算术，不该藏在组件里靠截图验。
 *
 * 几何沿用参考实现 `algorithm-visualization-replica/src/renderers/svg-renderer.mjs`
 * 的那一套：节点是固定尺寸的盒子、边从右边缘出发指到下一个盒子左边缘前 14px（留给箭头）、
 * 回边从下方绕，`rx=10` 的圆角。**三处按本项目内容改了尺寸**，各有原因：
 *
 * - 盒子 112×84 → 156×112：参考实现一格只装一个数组元素的值，我们这一格要装
 *   「序号 + 中文标签 / 源码行 + 重访次数 / 最多三个 `name = value`」五行字。
 *   照抄 112×84 会让每一格都溢出，那不是复刻，是把字截掉。
 * - 一行 4 格而不是无限往右排：画布最终要落在工作台右栏里，宽度有限。
 *   排得越宽，`width:100%` 缩下去的比例越狠——12px 的字缩到 7px 就没人读得了。
 *   4 格 + 边距 ≈ 860px，在桌面端右栏（约 900px）几乎 1:1。
 * - 画布尺寸**按内容算，不写死 `1100×470`**：只有三格节点时给一块 1100 宽的画布，
 *   缩放后字更小、右边还空一大片。空画布不是科幻感，是没画完。
 */
import type { StageFrame, StageNode } from './run-stage-model'

/** 盒子宽。见文件头说明：比参考实现的 112 宽，因为一格要装中文标签与数据格。 */
export const NODE_W = 156
/** 盒子高。参考实现 84，这里 112——五行字（序号/标签、源码行/重访、最多三个数据格）。 */
export const NODE_H = 112
/** 盒子之间的水平留白。要大于 14（参考实现留给箭头的那一段）才画得下箭头。 */
const COL_GAP = 48
/** 相邻两格的横向步距。 */
const COL_STEP = NODE_W + COL_GAP
/** 一行最多几格。见文件头：排太宽会被 `width:100%` 缩到看不清。 */
const PER_ROW = 4
/** 换行时的纵向步距：112 的盒子 + 58 留给回边绕行与下一行的指针标签。 */
const ROW_PITCH = 170
/** 左边距。 */
const ORIGIN_X = 28
/** 上边距。要留得下标题行，以及 `now` 那一格上方的指针标签（文字 + 一小段竖线）。 */
const ORIGIN_Y = 72
/** 右边距。 */
const RIGHT_PAD = 28
/** 下边距：回边从盒子下方 28px 处绕，加上箭头、圈数标签与描边，64 够用。 */
const BOTTOM_PAD = 64
/** 箭头落点与目标盒子左边缘的间距（参考实现的 14）。 */
const ARROW_GAP = 14
/** 折角半径（参考实现的 rx=10）。 */
const CORNER_R = 10

/** 盒子外形。`kind` 通过形状表达，不再靠一行「处理 / 判定」的文字复述。 */
export type NodeShape =
  | { form: 'rect'; x: number; y: number; width: number; height: number; rx: number }
  | { form: 'poly'; points: string }

export type LaidNode = {
  node: StageNode
  /** 在 `frame.nodes` 里的下标。回边要靠它对上 `loopBackFrom`。 */
  index: number
  x: number
  y: number
  shape: NodeShape
  /** 文字相对左边缘的缩进。圆头/斜边的形状要多让一点，否则字压在描边上。 */
  textInset: number
}

/**
 * 一条边。三态而不是两态：
 * - `done`——两头都走过了，这条路径是已经发生的事实；
 * - `active`——箭头指向此刻那一格，是「刚刚走的这一步」；
 * - `idle`——还没走到。
 *
 * 只分「亮/不亮」会把「已经走完的路」和「还没走的路」画成同一个样子，
 * 那张图就只剩当前一格有信息了。
 */
export type LaidEdge = {
  id: string
  from: LaidNode
  to: LaidNode
  state: 'done' | 'active' | 'idle'
  /** SVG path 的 `d`。直线段也用 path，省得渲染层分两种元素、CSS 分两套选择器。 */
  d: string
  /** 回边（`loop: true`）在视觉上是「这段程序不是一条直线」的唯一证据。 */
  loop: boolean
  label?: string
  /** 标签落点。 */
  labelX: number
  labelY: number
}

export type StageLayout = {
  width: number
  height: number
  nodes: LaidNode[]
  edges: LaidEdge[]
  /** 此刻那一格（`state === 'now'`），给指针标签用；没有就是 null。 */
  current: LaidNode | null
}

const colOf = (index: number) => index % PER_ROW
const rowOf = (index: number) => Math.floor(index / PER_ROW)

/**
 * 形状：`kind` 各自一个可辨识的轮廓。
 * - `start` / `end`：胶囊（圆头），程序的两端
 * - `process`：圆角矩形
 * - `decision`：六边形（两侧收尖）——不用正菱形，菱形的可用宽度只剩一半，中文标签放不进去
 * - `output`：平行四边形，沿用流程图里「输出」的传统画法
 */
const shapeOf = (kind: StageNode['kind'], x: number, y: number): { shape: NodeShape; textInset: number } => {
  const right = x + NODE_W
  const bottom = y + NODE_H
  const midY = y + NODE_H / 2
  switch (kind) {
    case 'start':
    case 'end':
      return { shape: { form: 'rect', x, y, width: NODE_W, height: NODE_H, rx: NODE_H / 2 }, textInset: 26 }
    case 'decision':
      return {
        shape: {
          form: 'poly',
          points: `${x + 22},${y} ${right - 22},${y} ${right},${midY} ${right - 22},${bottom} ${x + 22},${bottom} ${x},${midY}`,
        },
        textInset: 24,
      }
    case 'output':
      return {
        shape: { form: 'poly', points: `${x + 18},${y} ${right},${y} ${right - 18},${bottom} ${x},${bottom}` },
        textInset: 22,
      }
    case 'process':
    default:
      return { shape: { form: 'rect', x, y, width: NODE_W, height: NODE_H, rx: CORNER_R }, textInset: 14 }
  }
}

const edgeStateOf = (from: StageNode, to: StageNode): LaidEdge['state'] => {
  if (to.state === 'now') return 'active'
  if (from.state !== 'todo' && to.state === 'done') return 'done'
  return 'idle'
}

/** 同一行内的直线段：右边缘 → 下一格左边缘前 `ARROW_GAP`（参考实现的写法）。 */
const straightPath = (from: LaidNode, to: LaidNode) => {
  const y = from.y + NODE_H / 2
  return `M ${from.x + NODE_W} ${y} L ${to.x - ARROW_GAP} ${y}`
}

/** 跨行的折线：出右边缘 → 下沉到两行之间 → 横过去 → 下沉到目标行 → 进左边缘。 */
const wrapPath = (from: LaidNode, to: LaidNode) => {
  const y1 = from.y + NODE_H / 2
  const y2 = to.y + NODE_H / 2
  const midY = (from.y + NODE_H + to.y) / 2
  const outX = from.x + NODE_W + 24
  const inX = to.x - 24
  return [
    `M ${from.x + NODE_W} ${y1}`,
    `L ${outX} ${y1}`,
    `L ${outX} ${midY}`,
    `L ${inX} ${midY}`,
    `L ${inX} ${y2}`,
    `L ${to.x - ARROW_GAP} ${y2}`,
  ].join(' ')
}

/**
 * 回边：从下方绕回去，箭头朝上顶进目标盒子的底边。
 * `from === to` 时（这一拍刚好停在被绕回的那一格上）画一条自绕的小环——
 * 它说的是「这里会重复」，跟跨格的回边是同一件事，不该因为播放头位置就不画。
 */
const loopPath = (from: LaidNode, to: LaidNode) => {
  const self = from.index === to.index
  const startX = self ? from.x + NODE_W - 28 : from.x + NODE_W / 2
  const endX = self ? to.x + 28 : to.x + NODE_W / 2
  const dy = Math.max(from.y, to.y) + NODE_H + 28
  const dir = endX < startX ? -1 : 1
  return [
    `M ${startX} ${from.y + NODE_H}`,
    `L ${startX} ${dy - CORNER_R}`,
    `Q ${startX} ${dy} ${startX + dir * CORNER_R} ${dy}`,
    `L ${endX - dir * CORNER_R} ${dy}`,
    `Q ${endX} ${dy} ${endX} ${dy - CORNER_R}`,
    `L ${endX} ${to.y + NODE_H + ARROW_GAP / 2}`,
  ].join(' ')
}

/**
 * 折一帧的几何。输入是帧模型的产物，输出只有数字和字符串——
 * 渲染层拿到之后不再做任何算术，所以「画错位置」这件事可以在单测里抓住。
 */
export function layoutStage(frame: StageFrame): StageLayout {
  const nodes: LaidNode[] = frame.nodes.map((node, index) => {
    const x = ORIGIN_X + colOf(index) * COL_STEP
    const y = ORIGIN_Y + rowOf(index) * ROW_PITCH
    const { shape, textInset } = shapeOf(node.kind, x, y)
    return { node, index, x, y, shape, textInset }
  })

  const rows = nodes.length === 0 ? 1 : rowOf(nodes.length - 1) + 1
  const cols = Math.min(Math.max(nodes.length, 1), PER_ROW)
  // 尺寸按内容算：三格的课不该拿到一块右半边全空的画布（缩放后字会白白变小）。
  const width = ORIGIN_X + (cols - 1) * COL_STEP + NODE_W + RIGHT_PAD
  const height = ORIGIN_Y + (rows - 1) * ROW_PITCH + NODE_H + BOTTOM_PAD

  const edges: LaidEdge[] = []
  for (let i = 0; i + 1 < nodes.length; i += 1) {
    const from = nodes[i]!
    const to = nodes[i + 1]!
    const sameRow = rowOf(from.index) === rowOf(to.index)
    edges.push({
      id: `${from.node.id}->${to.node.id}`,
      from,
      to,
      state: edgeStateOf(from.node, to.node),
      d: sameRow ? straightPath(from, to) : wrapPath(from, to),
      loop: false,
      labelX: sameRow ? (from.x + NODE_W + to.x) / 2 : (from.x + NODE_W + 24),
      labelY: from.y + NODE_H / 2 - 8,
    })
  }

  // 回边：从「最后走到过的那一格」绕回 `loopBackFrom` 指的那一格。
  // 用最后走到的一格而不是固定的下一格——for 循环的回边是从循环体末尾回到判定，
  // 而循环体有几格要看课程，写死下标会在某些课上把箭头接到没走过的格子上。
  if (frame.loopBackFrom !== null && nodes.length > 0) {
    const target = nodes[frame.loopBackFrom]
    if (target) {
      const lastVisited = nodes.reduce((acc, laid) => (laid.node.state === 'todo' ? acc : laid.index), -1)
      const source = nodes[lastVisited > target.index ? lastVisited : target.index]!
      edges.push({
        id: `loop:${source.node.id}->${target.node.id}`,
        from: source,
        to: target,
        state: frame.loops > 0 ? 'done' : 'idle',
        d: loopPath(source, target),
        loop: true,
        label: frame.loops > 0 ? `第 ${frame.loops} 圈` : undefined,
        labelX: (source.x + target.x) / 2 + NODE_W / 2,
        labelY: Math.max(source.y, target.y) + NODE_H + 44,
      })
    }
  }

  return {
    width,
    height,
    nodes,
    edges,
    current: nodes.find((laid) => laid.node.state === 'now') ?? null,
  }
}
