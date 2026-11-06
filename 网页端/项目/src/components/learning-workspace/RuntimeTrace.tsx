/**
 * 运行观察区（01 号方案 §4 目标组件表的 `RuntimeTrace`）：变量面板 + 控制台 + 运行控制那一块。
 *
 * 这一份职责在 DOM 里本来就有**两个挂载点**，而顺序与层级不许动（取证脚本按
 * `.cw-workspace` / `#cw-pane-variables` / `#cw-pane-console` 同步，`section.right-panels` 的
 * `aria-label="运行观察区"` 也是断言目标），所以本文件导出两个记忆化组件：
 * - `RuntimeTraceControls`：左栏代码区之下的运行控制条（`.run-bar`，出自 `runtime-controls.tsx`）；
 *   外部环境课没有运行条时，那里画的是「本单元需要真实环境」那句声明；再下面是
 *   执行等级不可信时的 `.workspace-tier-note`（`role="status"`，未产生通过判定）。
 * - `RuntimeTrace`：右栏整块 `section.right-panels`——执行流程图（只在 `lesson.flow` 有数据时画，
 *   不拿空数组画假节点）、变量面板 `#cw-pane-variables`、控制台 `#cw-pane-console`。
 *
 * **只搬运 + 记忆化**：判定与文案一字未改，`FlowStep[]` 的折法（把 `events` 按 `nodeId`
 * 归到 `flow` 骨架上，逐节点记下它那一拍的事件与 1 起步序号）搬到主编排文件的 `useMemo` 里，
 * 算一次而不是每次渲染都算；`onLocateError`（EDIT-01 第 6 条）要的判断也留在上层，本文件只看有没有。
 */
import { memo } from 'react'
import { ShieldAlert } from 'lucide-react'
import type { ExecutionResult, RunStatus, VariableValue } from '../../types/lesson'
import type { StageFrame } from '../../engine/run-stage-model'
import { ConsolePanel } from '../console-panel'
import { FlowChart, type FlowStep } from '../flow-chart'
import { RunStage } from '../run-stage'
import { RuntimeControls } from '../runtime-controls'
import { VariablePanel } from '../variable-panel'

type RuntimeTraceControlsProps = {
  /** 能不能本机自动运行（`hasCode && lesson.executable !== false && !isExternal`，在上层折算）。 */
  canAutoRun: boolean
  runStatus: RunStatus
  hasCode: boolean
  isExternal: boolean
  /** 外部环境那句声明里的运行器名字（`lesson.runtime`）。 */
  runtime: string
  /** 教学模拟器认不出这段代码结构：只说「未产生通过判定」，不冒充验证（`execution.unsupported`）。 */
  unsupported: boolean
  onRun: () => void
  onStep: () => void
  onReset: () => void
}

export const RuntimeTraceControls = memo(function RuntimeTraceControls({
  canAutoRun,
  runStatus,
  hasCode,
  isExternal,
  runtime,
  unsupported,
  onRun,
  onStep,
  onReset,
}: RuntimeTraceControlsProps) {
  return (
    <>
      {canAutoRun ? (
        <RuntimeControls status={runStatus} onRun={onRun} onStep={onStep} onReset={onReset} />
      ) : (
        hasCode &&
        isExternal && (
          <div className="workspace-external-note">
            外部环境实验：本单元需要真实环境（{runtime}），教学模拟器不能冒充运行结果。
            按课程指南完成后，在下方填写执行环境、执行命令、结果摘要与复现日期，凭这份结构化证据标记完成。
          </div>
        )
      )}
      {canAutoRun && unsupported && (
        <div className="workspace-tier-note" role="status">
          <ShieldAlert size={14} />
          <span>
            执行等级：教学模拟（子集语法，非真实编译器）。本单元代码结构未被识别，
            未产生通过判定——请改用支持的模板，或在真实环境中运行。
          </span>
        </div>
      )}
    </>
  )
})

type RuntimeTraceProps = {
  /** `lesson.flow.length > 0`：没有流程元数据时整块不画（上层折算好的事实）。 */
  hasFlow: boolean
  /**
   * 流程图骨架 + 本次运行的每一拍：由上层把 `lesson.flow` 与 `execution.events`
   * 折成 `FlowStep[]`（每步带自己那一拍的事件与 1 起步序号）后传下来。
   */
  steps: FlowStep[]
  /** 当前事件所在的流程节点（没有事件时为 undefined，图上不亮任何节点）。 */
  activeNodeId?: string
  /** 播放头走过的节点：由上层按 `events.slice(0, eventIndex + 1)` 折好后传下来。 */
  completedNodeIds: string[]
  /**
   * 画布这一拍的一帧：上层用 `engine/run-stage-model.ts` 的 `stageFrameAt()` 折好
   * （输入是它已经折过一次的 `steps`）。没有事件时为 null，整块不画。
   */
  stageFrame: StageFrame | null
  /** 播放中（上层折 `runStatus === 'running'`）——画布只据此换按钮标签，不驱动时间。 */
  playing: boolean
  /** 有拍可走；为假时画布不画控制条（不画一排永远禁用的按钮）。 */
  canStep: boolean
  stepIndex: number
  stepTotal: number
  onPrev: () => void
  onNext: () => void
  onTogglePlay: () => void
  /** 重置：与 `RuntimeTraceControls` 用的是同一个 `execution.handleReset`。 */
  onReset: () => void
  variables: VariableValue[]
  eventIndex: number
  totalEvents: number
  output: string[]
  error?: ExecutionResult['error']
  onLocateError?: (line: number) => void
}

export const RuntimeTrace = memo(function RuntimeTrace({
  hasFlow,
  steps,
  stageFrame,
  playing,
  canStep,
  stepIndex,
  stepTotal,
  onPrev,
  onNext,
  onTogglePlay,
  onReset,
  activeNodeId,
  completedNodeIds,
  variables,
  eventIndex,
  totalEvents,
  output,
  error,
  onLocateError,
}: RuntimeTraceProps) {
  return (
    <section className="right-panels" aria-label="运行观察区">
      {hasFlow && (
        <div className="cw-pane cw-pane--flow">
          <div className="cw-flow-head">
            <span>执行流程</span>
          </div>
          {/* 画布在图上面：先给「这一拍长什么样」，再给一拍一行的文字明细。
              两块同源（同一个 `eventIndex`），一起进退；没有事件时画布整块不画。 */}
          <RunStage
            frame={stageFrame}
            playing={playing}
            stepIndex={stepIndex}
            stepTotal={stepTotal}
            canStep={canStep}
            onPrev={onPrev}
            onNext={onNext}
            onTogglePlay={onTogglePlay}
            onReset={onReset}
          />
          <FlowChart steps={steps} activeNodeId={activeNodeId} completedNodeIds={completedNodeIds} />
        </div>
      )}
      <div className="cw-zone" id="cw-pane-variables">
        <VariablePanel variables={variables} eventIndex={eventIndex} totalEvents={totalEvents} />
      </div>
      <div className="cw-zone" id="cw-pane-console">
        <ConsolePanel
          output={output}
          error={error}
          // 没有代码的单元不画定位按钮：定位的目标不存在，画出来就是一个假动作。
          onLocateError={onLocateError}
        />
      </div>
    </section>
  )
})
