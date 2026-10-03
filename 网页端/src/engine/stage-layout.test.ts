/**
 * 布局契约测试（`engine/stage-layout.ts`）。
 *
 * 为什么这些断言值得写：jsdom **不实现 SVG 布局**——`getBBox()` 返回零、
 * `getScreenCTM()` 未实现，所以「盒子有没有重叠」「箭头有没有指到格子上」
 * 在渲染层是测不出来的。把几何提成纯函数之后，这些问题变成了算术，
 * 能在这里被抓住，而不是等到人肉看截图。
 *
 * 盯四件事：格子不重叠、边的起止点真的落在格子边缘、回边接在走过的格子上、
 * 画布高度跟着行数长（而不是写死 470 留一片空白）。
 */
import { describe, expect, it } from 'vitest'
import { NODE_H, NODE_W, layoutStage } from './stage-layout'
import type { StageFrame, StageNode } from './run-stage-model'

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

/** path 的 `d` 里的所有数对，按出现顺序。断言起止点用得上。 */
const points = (d: string): Array<[number, number]> => {
  const out: Array<[number, number]> = []
  const re = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(d)) !== null) out.push([Number(m[1]), Number(m[2])])
  return out
}

describe('stage-layout · 格子排布', () => {
  it('一行之内横向等距，且两格之间留得下箭头', () => {
    const laid = layoutStage(frame({ nodes: [node({ id: 'a' }), node({ id: 'b' }), node({ id: 'c' })] }))
    expect(laid.nodes).toHaveLength(3)
    const [a, b, c] = laid.nodes as [typeof laid.nodes[0], typeof laid.nodes[0], typeof laid.nodes[0]]
    // 同一行：y 相同
    expect(a.y).toBe(b.y)
    expect(b.y).toBe(c.y)
    // 等距
    expect(b.x - a.x).toBe(c.x - b.x)
    // 留白 > 14（参考实现留给箭头的那一段），否则箭头画在格子里
    expect(b.x - (a.x + NODE_W)).toBeGreaterThan(14)
  })

  it('排满一行就换行，不是继续往右溢出画布', () => {
    const nodes = Array.from({ length: 7 }, (_, i) => node({ id: `n${i}` }))
    const laid = layoutStage(frame({ nodes }))
    const first = laid.nodes[0]!
    // 每一格都落在画布内
    for (const laidNode of laid.nodes) {
      expect(laidNode.x + NODE_W, `第 ${laidNode.index} 格出界`).toBeLessThanOrEqual(laid.width)
      expect(laidNode.y + NODE_H, `第 ${laidNode.index} 格出界`).toBeLessThanOrEqual(laid.height)
    }
    // 至少换了一行，且换行后回到行首
    const wrapped = laid.nodes.find((laidNode) => laidNode.y > first.y)
    expect(wrapped).toBeTruthy()
    expect(wrapped!.x).toBe(first.x)
  })

  it('画布尺寸按内容算——少量节点不拿到一块大半空着的画布', () => {
    const two = layoutStage(frame({ nodes: [node({ id: 'a' }), node({ id: 'b' })] }))
    const seven = layoutStage(frame({ nodes: Array.from({ length: 7 }, (_, i) => node({ id: `n${i}` })) }))
    // 行数多了就更高
    expect(seven.height).toBeGreaterThan(two.height)
    // 两格的课比七格的课窄：宽度不写死，否则缩放后字白白变小
    expect(two.width).toBeLessThan(seven.width)
    // 最后一行的格子连底边都装得下
    const last = seven.nodes[seven.nodes.length - 1]!
    expect(last.y + NODE_H).toBeLessThan(seven.height)
  })

  it('格子两两不重叠（同行看 x 区间，跨行看 y 区间）', () => {
    const nodes = Array.from({ length: 9 }, (_, i) => node({ id: `n${i}`, kind: i % 2 === 0 ? 'decision' : 'process' }))
    const laid = layoutStage(frame({ nodes }))
    for (let i = 0; i < laid.nodes.length; i += 1) {
      for (let j = i + 1; j < laid.nodes.length; j += 1) {
        const p = laid.nodes[i]!
        const q = laid.nodes[j]!
        const xApart = p.x + NODE_W <= q.x || q.x + NODE_W <= p.x
        const yApart = p.y + NODE_H <= q.y || q.y + NODE_H <= p.y
        expect(xApart || yApart, `第 ${i} 格与第 ${j} 格重叠了`).toBe(true)
      }
    }
  })

  it('kind 各自一个轮廓：判定是多边形，入口/结束是胶囊，处理是圆角矩形', () => {
    const laid = layoutStage(
      frame({
        nodes: [
          node({ id: 'a', kind: 'start' }),
          node({ id: 'b', kind: 'process' }),
          node({ id: 'c', kind: 'decision' }),
          node({ id: 'd', kind: 'output' }),
          node({ id: 'e', kind: 'end' }),
        ],
      }),
    )
    const forms = laid.nodes.map((laidNode) => laidNode.shape.form)
    expect(forms).toEqual(['rect', 'rect', 'poly', 'poly', 'rect'])
    // 胶囊：圆角半径等于半高；处理块：小圆角。两者不能长一样，否则形状通道白搭
    const start = laid.nodes[0]!.shape
    const process = laid.nodes[1]!.shape
    if (start.form !== 'rect' || process.form !== 'rect') throw new Error('形状类型判定失败')
    expect(start.rx).toBe(NODE_H / 2)
    expect(process.rx).toBeLessThan(start.rx)
  })
})

describe('stage-layout · 边', () => {
  it('N 个格子给出 N-1 条顺序边，起点在左格右边缘、终点在右格左边缘之前', () => {
    const laid = layoutStage(frame({ nodes: [node({ id: 'a' }), node({ id: 'b' }), node({ id: 'c' })] }))
    const seq = laid.edges.filter((e) => !e.loop)
    expect(seq).toHaveLength(2)
    const first = seq[0]!
    const pts = points(first.d)
    const start = pts[0]!
    const end = pts[pts.length - 1]!
    expect(start[0]).toBe(first.from.x + NODE_W)
    // 终点给箭头留了空隙，不顶到格子边上
    expect(end[0]).toBeLessThan(first.to.x)
    expect(first.to.x - end[0]).toBe(14)
  })

  it('边三态：指向此刻那格是 active，两头走过是 done，还没到是 idle', () => {
    const laid = layoutStage(
      frame({
        nodes: [
          node({ id: 'a', state: 'done' }),
          node({ id: 'b', state: 'done' }),
          node({ id: 'c', state: 'now' }),
          node({ id: 'd', state: 'todo' }),
        ],
      }),
    )
    const seq = laid.edges.filter((e) => !e.loop)
    expect(seq.map((e) => e.state)).toEqual(['done', 'active', 'idle'])
  })

  it('跨行的边走折线，不是一条穿过整块画布的斜线', () => {
    const nodes = Array.from({ length: 6 }, (_, i) => node({ id: `n${i}` }))
    const laid = layoutStage(frame({ nodes }))
    const wrap = laid.edges.find((e) => e.from.y !== e.to.y)
    expect(wrap).toBeTruthy()
    const pts = points(wrap!.d)
    // 折线：中间有拐点；直线只有两个点
    expect(pts.length).toBeGreaterThan(2)
    // 每一段都是水平或垂直的（直角折线，不是斜线）
    for (let i = 1; i < pts.length; i += 1) {
      const prev = pts[i - 1]!
      const cur = pts[i]!
      expect(prev[0] === cur[0] || prev[1] === cur[1], `第 ${i} 段是斜的`).toBe(true)
    }
  })
})

describe('stage-layout · 回边', () => {
  it('没有回环就不画回边', () => {
    const laid = layoutStage(frame({ nodes: [node({ id: 'a' }), node({ id: 'b' })], loopBackFrom: null }))
    expect(laid.edges.filter((e) => e.loop)).toHaveLength(0)
  })

  it('回边从最后走到过的那一格绕回目标格，走下方而不是穿过格子', () => {
    const laid = layoutStage(
      frame({
        nodes: [
          node({ id: 'a', state: 'done' }),
          node({ id: 'b', state: 'done' }), // 回边目标（判定）
          node({ id: 'c', state: 'done' }),
          node({ id: 'd', state: 'now' }), // 最后走到的一格
          node({ id: 'e', state: 'todo' }),
        ],
        loopBackFrom: 1,
        loops: 2,
      }),
    )
    const loop = laid.edges.find((e) => e.loop)
    expect(loop).toBeTruthy()
    expect(loop!.from.node.id).toBe('d')
    expect(loop!.to.node.id).toBe('b')
    // 圈数落在标签上：图上要能读出「绕了几圈」
    expect(loop!.label).toBe('第 2 圈')
    // 绕行的最低点在两格底边之下
    const ys = points(loop!.d).map(([, y]) => y)
    expect(Math.max(...ys)).toBeGreaterThan(loop!.from.y + NODE_H)
  })

  it('还没绕过时回边是 idle 且不标圈数（`第 0 圈` 是废话）', () => {
    const laid = layoutStage(
      frame({
        nodes: [node({ id: 'a', state: 'done' }), node({ id: 'b', state: 'now' }), node({ id: 'c', state: 'todo' })],
        loopBackFrom: 1,
        loops: 0,
      }),
    )
    const loop = laid.edges.find((e) => e.loop)!
    expect(loop.state).toBe('idle')
    expect(loop.label).toBeUndefined()
  })

  it('播放头正停在被绕回的那一格上时，回边照画（自绕小环）', () => {
    const laid = layoutStage(
      frame({
        nodes: [node({ id: 'a', state: 'done' }), node({ id: 'b', state: 'now' }), node({ id: 'c', state: 'todo' })],
        loopBackFrom: 1,
        loops: 1,
      }),
    )
    const loop = laid.edges.find((e) => e.loop)!
    expect(loop.from.node.id).toBe('b')
    expect(loop.to.node.id).toBe('b')
    expect(points(loop.d).length).toBeGreaterThan(2)
  })
})

describe('stage-layout · 当前格', () => {
  it('current 指向 state === "now" 那一格；没有就是 null', () => {
    const withNow = layoutStage(
      frame({ nodes: [node({ id: 'a', state: 'done' }), node({ id: 'b', state: 'now' })] }),
    )
    expect(withNow.current?.node.id).toBe('b')

    const noNow = layoutStage(frame({ nodes: [node({ id: 'a', state: 'todo' })] }))
    expect(noNow.current).toBeNull()
  })

  it('空节点也给出可用画布（不是 NaN 尺寸）', () => {
    const laid = layoutStage(frame({ nodes: [] }))
    expect(laid.nodes).toHaveLength(0)
    expect(laid.edges).toHaveLength(0)
    expect(Number.isFinite(laid.height)).toBe(true)
    expect(laid.height).toBeGreaterThan(0)
  })
})
