/**
 * 运行画布（RunStage）：把「一拍一行的文字快照」升级成**这一拍的图形状态**。
 *
 * 与 `flow-chart.tsx` 并存，不是替换它。两块同源（同一个 `eventIndex`），分工是：
 * - `flow-chart`：一拍一行的文字明细——标题、源码行、detail、逐个 `key = value`；
 * - `RunStage`：一眼看上图的形状——骨架节点按 `kind` 画成不同轮廓、箭头连成路径、
 *   数据格落在当前那一格里、值变过的那一格亮一档、循环绕回来的那条回边真的画出来。
 *
 * **为什么是 `<svg>` 而不是 `<div>`。** 上一版用 DOM 盒子排出来的「画布」，用户的评价是
 * 「你现在的画布效果一直就是个文字而已」——说得对：DOM 排版只能把方块摞成一列，
 * 画不出斜的连线、画不出绕回去的弧，也画不出形状（判定的六边形、输出的平行四边形）。
 * 参考实现 `algorithm-visualization-replica/` 用的就是 SVG，几何照它那一套抄
 * （盒子 + `marker` 箭头 + 下方绕行的回边），尺寸按中文内容放大，见 `engine/stage-layout.ts`。
 *
 * 四条来自实读的约束（每一条都决定了一段写法）：
 *
 * 1. **完整受控，不持有 `stepIndex`、不持有时钟。** 播放/单步/上一步全部由上层
 *    `use-execution.ts` 驱动——那里的 `setTimeout` 链（`STEP_DELAY_MS = 850`）是本项目
 *    唯一的回放节拍，而它恰好与参考实现 `timeline.mjs` 的 `interval = 850` 同值。
 *    参考实现用 `setInterval`，本项目全局禁用，所以**不移植那个 Timeline 类**——
 *    既有的链条已经在跑同一个节拍。本组件再起一个计时器，「暂停」会在下一个 tick 被拽回去。
 *
 * 2. **画布上不重复「重置」。** 控制条只放 `上一步 / 播放 / 下一步` 这一组**回放导航**；
 *    重置留在 `RuntimeTraceControls` 那一份——两者背后是同一个 `execution.handleReset`，
 *    在同一块页面上摆两个叫「重置」的按钮，读屏的名字会撞车。
 *
 * 3. **靠重渲染驱动，不靠动画。** `requestAnimationFrame` 全项目恰好 1 处（在
 *    `code-editor.tsx`）。所以「生长」感来自**属性变化**（没走到的边是虚线、走过的是实线、
 *    刚走的这一步换一档亮色），配 CSS `transition` 呈现过渡——静态截下来也读得懂。
 *
 * 4. **不拿空数据画假节点。** `frame === null` 时整块不画；`canStep` 为假时连控制条都不画——
 *    画一排永远禁用的按钮是「假动作」，与 `RuntimeTrace.tsx` 同一条纪律。
 *
 * 无障碍：`<svg>` 自己就是那份**有序列表**（`role="list"`，每个节点 `<g role="listitem">`），
 * 而不是「画一张图 + 另挂一份隐藏文字」——后者会让读屏用户读到的和屏幕上画的分成两套真相，
 * 改一处忘一处就开始撒谎。装饰性的边与箭头挂 `aria-hidden`，它们的含义已经由节点顺序
 * 与回边注记说清楚了。
 */
import { memo } from 'react'
import { SkipBack, SkipForward } from 'lucide-react'
import type { StageCell, StageFrame } from '../engine/run-stage-model'
import { NODE_W, layoutStage, type LaidEdge, type LaidNode } from '../engine/stage-layout'
import './run-stage.css'

export type RunStageProps = {
  /** 当前帧；null = 还没运行（或这一课没有流程元数据）→ 整块不画。 */
  frame: StageFrame | null
  /** 播放中（上层折 `runStatus === 'running'`）；本组件据此只换标签，不驱动时间。 */
  playing: boolean
  /** 0 起的当前拍下标，用于右上角计数器。 */
  stepIndex: number
  /** 总拍数。 */
  stepTotal: number
  /** 有拍可走（`stepTotal > 0`）；为假时控制条不画。 */
  canStep: boolean
  onPrev: () => void
  onNext: () => void
  /** 上层的播放/暂停切换（实际调 `handleRun`）。 */
  onTogglePlay: () => void
  /**
   * 重置入口。**为了对外签名稳定而保留**，当前不由本组件渲染按钮——
   * 重置在 `RuntimeTraceControls` 那一份上（同一个 `handleReset`）。
   * 将来若画布要自带的「重播」动作，接这里，不要再造第二个 `重置`。
   */
  onReset: () => void
}

/** 计数器：`03 / 07`——定宽两位，切拍时数字不跳位（tabular-nums 在 CSS 里）。 */
const counter = (index: number, total: number) =>
  `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`

/**
 * 一格里最多画几个数据格。盒子是固定高度的，装不下就得取舍：
 * 画三个 + 一句「还有 N 项」，比把第四行压在描边上更诚实。
 * 完整的变量表在 `VariablePanel` 里，画布不承担「列全」这件事。
 */
const CELLS_PER_NODE = 3

/** 文字行的基线，相对盒子上沿。 */
const ROW_TITLE = 26
const ROW_META = 46
const ROW_CELL_TOP = 68
const ROW_CELL_PITCH = 18

/**
 * 一格数据：`名字 = 值`。`changed` / `born` 各换一档颜色，并带一句话说明给读屏——
 * 颜色是唯一的「刚变过」提示时，读屏用户看不到。
 * 类型名放在 `<title>` 里而不是画在格子上：一格只有 156px 宽，
 * `total = 15 int` 三段并排会挤成一团，而类型是次要信息。
 */
const Cell = memo(function Cell({ cell, x, y }: { cell: StageCell; x: number; y: number }) {
  const mark = cell.born ? '这一拍首次出现' : cell.changed ? '这一拍被改写' : ''
  return (
    <text
      className={`rs-cell${cell.born ? ' is-born' : ''}${cell.changed ? ' is-changed' : ''}`}
      x={x}
      y={y}
    >
      <tspan className="rs-cell-name">{cell.name}</tspan>
      <tspan className="rs-cell-eq" aria-hidden="true">
        {' = '}
      </tspan>
      <tspan className="rs-cell-value">{cell.value}</tspan>
      <title>
        {cell.name} 等于 {cell.value}，类型 {cell.type}
        {mark ? `，${mark}` : ''}
      </title>
      {/* 读屏要听到的那句话；视觉上由颜色承担，所以不画在格子里。 */}
      <tspan className="rs-sr">
        {' '}
        {cell.type}
        {mark ? ` ${mark}` : ''}
      </tspan>
    </text>
  )
})

/** 盒子轮廓。形状由 `kind` 决定，是与颜色无关的第二个通道。 */
const Shape = memo(function Shape({ laid }: { laid: LaidNode }) {
  const { shape } = laid
  if (shape.form === 'poly') return <polygon className="rs-node-box" points={shape.points} />
  return (
    <rect
      className="rs-node-box"
      x={shape.x}
      y={shape.y}
      width={shape.width}
      height={shape.height}
      rx={shape.rx}
    />
  )
})

/**
 * 一个骨架节点。`role="listitem"` 让它成为画布这份列表里的一条——
 * 读屏读到的顺序就是程序的顺序，不需要另挂一份隐藏文字。
 */
const Node = memo(function Node({ laid, loopBack }: { laid: LaidNode; loopBack: boolean }) {
  const { node, x, y, textInset } = laid
  const cells = node.cells.slice(0, CELLS_PER_NODE)
  const hidden = node.cells.length - cells.length
  const left = x + textInset

  return (
    <g
      role="listitem"
      data-node-id={node.id}
      className={`rs-node rs-kind-${node.kind} tone-${node.tone} is-${node.state}${loopBack ? ' is-loop-back' : ''}`}
      aria-current={node.state === 'now' ? 'step' : undefined}
    >
      <Shape laid={laid} />

      <text className="rs-node-no" x={left} y={y + ROW_TITLE} aria-hidden="true">
        {node.ordinal !== null ? String(node.ordinal).padStart(2, '0') : '--'}
      </text>
      {/* 序号对读屏隐藏（列表本身就有序），但「--」要留在文字里：
          它是「这一格还没走到」的证据，测试与用户都靠它。 */}
      <text className="rs-node-label" x={left + 30} y={y + ROW_TITLE}>
        {node.label}
      </text>

      {/* 走到过才有源码行；没走到就说「未走到」，不填骨架里的静态行号冒充此刻。 */}
      {node.state === 'todo' ? (
        <text className="rs-node-line-no" x={left} y={y + ROW_META}>
          尚未执行
        </text>
      ) : (
        node.line !== null && (
          <text className="rs-node-line-no" x={left} y={y + ROW_META}>
            L{node.line}
          </text>
        )
      )}
      {/* 重访次数只在真的绕回来过的时候出现，`×1` 是废话。 */}
      {node.visit > 1 && (
        <text className="rs-node-visit" x={left + 40} y={y + ROW_META}>
          第 {node.visit} 次
        </text>
      )}

      {cells.length === 0 ? (
        <text className="rs-cell is-empty" x={left} y={y + ROW_CELL_TOP}>
          尚未落值
        </text>
      ) : (
        cells.map((cell, i) => (
          <Cell key={cell.name} cell={cell} x={left} y={y + ROW_CELL_TOP + i * ROW_CELL_PITCH} />
        ))
      )}
      {hidden > 0 && (
        <text className="rs-cell-more" x={left} y={y + ROW_CELL_TOP + cells.length * ROW_CELL_PITCH}>
          还有 {hidden} 项
        </text>
      )}
    </g>
  )
})

/** 一条边。纯装饰：它的含义由节点顺序与回边注记讲完了，读屏不需要再听一遍几何。 */
const Edge = memo(function Edge({ edge }: { edge: LaidEdge }) {
  return (
    <g className={`rs-edge is-${edge.state}${edge.loop ? ' is-loop' : ''}`} aria-hidden="true">
      <path className="rs-edge-line" d={edge.d} markerEnd={`url(#rs-arrow-${edge.state})`} />
      {edge.label && (
        <text className="rs-edge-label" x={edge.labelX} y={edge.labelY}>
          {edge.label}
        </text>
      )}
    </g>
  )
})

/** 箭头。三态各一个——SVG 的 `marker` 不继承线条颜色，只能一档一个。 */
const ARROW_STATES: Array<LaidEdge['state']> = ['idle', 'done', 'active']

export const RunStage = memo(function RunStage({
  frame,
  playing,
  stepIndex,
  stepTotal,
  canStep,
  onPrev,
  onNext,
  onTogglePlay,
  onReset: _onReset,
}: RunStageProps) {
  if (!frame) return null

  const atStart = stepIndex <= 0
  const atEnd = stepTotal === 0 || stepIndex >= stepTotal - 1
  const layout = layoutStage(frame)

  return (
    <div className="rs-stage">
      <div className="rs-stage-head">
        <span className="rs-stage-caption">{frame.caption}</span>
        <span className="rs-counter" aria-label={`第 ${stepIndex + 1} 拍，共 ${stepTotal} 拍`}>
          {counter(stepIndex, stepTotal)}
        </span>
      </div>

      {/* 回环摘要：只在真的有回边时出现，说的是「绕回来过」这件事实，不是装饰。 */}
      {frame.loopBackFrom !== null && (
        <p className="rs-loop-note" role="status">
          程序在此处绕回：已经回到上面的判定 {frame.loops} 次。
        </p>
      )}

      {/* 网格纸画布。`viewBox` 按内容算（`stage-layout`），`width:100%` 等比缩放。
          `preserveAspectRatio` 显式写出来（默认就是 xMidYMid meet，这里是因为它承重）：
          CSS 给了 `max-height: 34svh`，高度被压到不足等比值时，靠 `meet` 把整张图
          完整居中缩进去，而不是裁掉两头——画布宁可小，不能缺。 */}
      <div className="rs-canvas-wrap">
        <svg
          className="rs-canvas"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          preserveAspectRatio="xMidYMid meet"
          role="list"
          aria-label={`程序状态图，当前第 ${stepIndex + 1} 拍，共 ${stepTotal} 拍`}
        >
          <defs aria-hidden="true">
            {ARROW_STATES.map((state) => (
              <marker
                key={state}
                id={`rs-arrow-${state}`}
                className={`rs-arrow is-${state}`}
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 z" />
              </marker>
            ))}
          </defs>

          {/* 绘制顺序：边 → 节点 → 指针（后画的盖前面的，照参考实现）。 */}
          <g className="rs-edges" aria-hidden="true">
            {layout.edges.map((edge) => (
              <Edge key={edge.id} edge={edge} />
            ))}
          </g>

          {layout.nodes.map((laid) => (
            <Node key={laid.node.id} laid={laid} loopBack={frame.loopBackFrom === laid.index} />
          ))}

          {/* 指针：一根短竖线 + 「此刻」，指着播放头那一格。参考实现的 pointer 那一层。 */}
          {layout.current && (
            <g className="rs-pointer" aria-hidden="true">
              <text className="rs-pointer-label" x={layout.current.x + NODE_W / 2} y={layout.current.y - 22}>
                此刻
              </text>
              <path
                className="rs-pointer-line"
                d={`M ${layout.current.x + NODE_W / 2} ${layout.current.y - 16} L ${layout.current.x + NODE_W / 2} ${layout.current.y - 4}`}
                markerEnd="url(#rs-arrow-active)"
              />
            </g>
          )}
        </svg>
      </div>

      {/* 输出区：落下的每一行。空的时候整块不画——空框不是信息。 */}
      {frame.outputLines.length > 0 && (
        <div className="rs-out">
          <span className="rs-out-title">输出</span>
          <ol className="rs-out-list">
            {frame.outputLines.map((line, i) => (
              <li key={`${i}-${line}`}>{line}</li>
            ))}
          </ol>
        </div>
      )}

      {/* 没有拍就不画控制条：一排永远禁用的按钮是假动作（`RuntimeTrace.tsx` 同一条纪律）。 */}
      {canStep && (
        <div className="rs-bar">
          <button type="button" className="rs-btn" onClick={onPrev} disabled={atStart}>
            <SkipBack size={14} aria-hidden="true" />
            上一步
          </button>
          <button
            type="button"
            className={`rs-btn rs-btn--play${playing ? ' is-playing' : ''}`}
            onClick={onTogglePlay}
            aria-pressed={playing}
          >
            {playing ? '暂停' : '播放'}
          </button>
          <button type="button" className="rs-btn" onClick={onNext} disabled={atEnd}>
            下一步
            <SkipForward size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
})
