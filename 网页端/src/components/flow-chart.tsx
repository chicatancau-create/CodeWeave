/**
 * 执行流程图（step 视图）：横向一拍的轨道，当前那一拍在右侧展开它的数据。
 *
 * 形状（2026-09-30 重做为横向轨道）：从「竖向一列高卡片」改成**横向一条拍轨**——
 * 每一拍是轨道上的一格（编号 + 标签 + 源码行），**只有当前那一拍**把它的变量快照
 * 展开在图下方。改版理由：竖排 6 拍实测 607px 高，光这一块就吃掉 900px 视口的三分之二，
 * 学习者要上下拖动才能看全一屏；而它逐字重复的内容，画布（`RunStage`）在上一格已经画过。
 *
 * 为什么横排这次可以：走上限来自 `lesson.flow`，实测 4—6 拍；轨道自身横向滚动
 * （`overflow-x: auto`），滚出去的是**已经走过的拍**，而「现在在哪」由高亮格 + 自动滚动到
 * 当前格（`scrollIntoView` 不参与——见下）表达。真正必须常驻的「这一步的数据是什么」
 * 仍然在同一屏里，就是当前格的展开面板。
 *
 * 三种节点态（互斥，靠形状 + 文字 + 颜色三通道，不单靠颜色）：
 * - 已走过 `is-done`：编号框实心、连接线实线；
 * - 当前   `is-now`：冷色近档泛光 + 实心竖条 + `aria-current="step"`，且是唯一展开数据的一格；
 * - 未到   `is-todo`：虚线连接、内容压到次级文字档，但仍可读（不 opacity 压暗）。
 *
 * 数据来源不变：`lesson.flow` 给节点骨架，`execution.events` 给每一拍的行号与变量。
 * 没有事件的单元（`hasFlow` 为假）不画假节点。
 *
 * **不受控滚动**：这里不做 `scrollIntoView`——它会带着整个页面跳，而这一块在单屏布局里
 * 是固定高度的内部滚动区，滚动它等于把学习者的上下文挪走。当前格靠高亮表达位置。
 */
import { memo } from 'react'
import type { TraceEvent } from '../types/lesson'
import './flow-chart.css'

/**
 * 一个流程节点 + 它在本次运行里走到的那一拍。
 * `event` 缺席 = 这一拍还没走到（或这段代码没有对应事件）。
 */
export type FlowStep = {
  id: string
  label: string
  kind: string
  tone: string
  line?: number
  event?: TraceEvent
  /** 累计走到这里为止的序号（1 起）；未走到为 undefined。 */
  ordinal?: number
}

type Props = {
  steps: FlowStep[]
  /** 当前停留的节点 id（没有事件时为 undefined，图上不亮任何节点）。 */
  activeNodeId?: string
  /** 播放头走过（含当前）的节点 id。 */
  completedNodeIds: string[]
}

const TONE_LABEL: Record<string, string> = {
  purple: '场景',
  blue: '信息',
  yellow: '注意',
  coral: '危险',
  green: '成功',
}

/** 变量值里的 `color` 只有 blue / coral 两档（types/lesson.ts），映射到语义档而不是场景色。 */
const variableClass = (color: string) => (color === 'coral' ? 'is-coral' : 'is-blue')

export const FlowChart = memo(function FlowChart({ steps, activeNodeId, completedNodeIds }: Props) {
  // 展开哪一拍：当前那一拍有事件就展开它，否则退到最后一拍已走过的——游标停在起点时
  // 至少还能看见刚跑过的数据，不留一个空面板。
  const current =
    steps.find((step) => step.id === activeNodeId) ??
    [...steps].reverse().find((step) => completedNodeIds.includes(step.id))

  return (
    <div className="flow-chart" aria-label="程序执行流程">
      <ol className="flow-track">
        {steps.map((step) => {
          const done = completedNodeIds.includes(step.id)
          const now = step.id === activeNodeId
          const state = now ? 'is-now' : done ? 'is-done' : 'is-todo'
          // 展开态是**布局信息**：这一格要把数据栏摊开，就需要比别格宽一档。
          // 它和 is-now 不总是同一格（游标停在起点时展开的是最后一拍已走过的），所以单独标。
          const expanded = current?.id === step.id
          return (
            <li
              className={`flow-step ${state} ${step.tone}${expanded ? ' is-expanded' : ''}`}
              key={step.id}
              aria-current={now ? 'step' : undefined}
            >
              {/* 连接线：横向主干的一段。已走过的画实线，没到的画虚线——形状通道说「通没通」。 */}
              <span className="flow-rail" aria-hidden="true" />

              <div className="flow-node">
                <div className="flow-node-head">
                  <span className="flow-node-no" aria-hidden="true">
                    {step.ordinal !== undefined ? String(step.ordinal).padStart(2, '0') : '--'}
                  </span>
                  <span className="flow-node-label">{step.label}</span>
                </div>

                {/* 该拍对应的源码行：和编辑器行号同一个数，学习者能对着看。
                    没有行号的拍不画这一行——画「—」等于给一个不存在的行号占位。 */}
                {step.line !== undefined ? (
                  <div className="flow-node-line">
                    <span className="flow-node-line-no">L{step.line}</span>
                    <code>{(step.event?.label ?? step.label).trim()}</code>
                  </div>
                ) : null}

                <span className={`flow-node-kind tone-${step.tone}`}>
                  {TONE_LABEL[step.tone] ?? step.tone}
                </span>

                {/* 数据栏：**每一拍各带一份**（M4 基座契约钉着 per-step 的 `div.flow-data`），
                    但 CSS 只放当前那一拍显示——其余 `display: none`。这样 DOM 里每一拍都
                    自带着「我这一拍的数据是什么」，屏幕上却只有一处展开，不长成六张高卡片。
                    没走到时不填假值，明说「尚未执行」。 */}
                <div className={`flow-data${current?.id === step.id ? ' is-shown' : ''}`}>
                  {step.event ? (
                    step.event.variables.length > 0 ? (
                      <ul className="flow-data-list" aria-label={`第 ${step.ordinal ?? 0} 拍的数据`}>
                        {step.event.variables.map((variable) => (
                          <li key={variable.name} className={variableClass(variable.color)}>
                            <span className="flow-data-name">{variable.name}</span>
                            <span className="flow-data-eq" aria-hidden="true">
                              =
                            </span>
                            <span className="flow-data-value">{variable.value}</span>
                            <span className="flow-data-type">{variable.type}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="flow-data-empty">这一拍没有变量变化。</p>
                    )
                  ) : (
                    <p className="flow-data-empty">尚未执行到这一拍。</p>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
})
