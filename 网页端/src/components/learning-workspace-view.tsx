import { useCallback, useMemo, useState } from 'react'
import type { ExecutionResult, Lesson, RunStatus, TraceEvent, VariableValue } from '../types/lesson'
import { LessonSourceDetail } from './content-source-view'
import { lessonDurationLabel } from '../utils/lesson-duration'
import { getLocalDateKey } from '../utils/date-helpers'
import { emptyEvidence, validateExternalEvidence, type ExternalEvidence } from '../utils/external-evidence'
import { lessonAcceptancePoints, type LessonCompletionSource, type LessonEvidenceStates } from '../utils/lesson-evidence'
import { CodeEditorPane } from './learning-workspace/CodeEditorPane'
import { skeletonStageFrame, stageFrameAt } from '../engine/run-stage-model'
import { deriveRuntimeFlow } from '../engine/runtime-flow'
import { EvidenceStateGrid } from './learning-workspace/EvidenceStateGrid'
import { LessonReader } from './learning-workspace/LessonReader'
import { RuntimeTrace, RuntimeTraceControls } from './learning-workspace/RuntimeTrace'
import { WorkspaceHeader } from './learning-workspace/WorkspaceHeader'
import {
  assessCompletion,
  completedLabelOf,
  completionPayloadOf,
  pendingLabelOf,
  visiblePanes,
  type LessonCompletionPayload,
} from './learning-workspace/workspace-model'
/* M3 视觉竖切（01 号方案 §3.2 主工作台）：样式全部限定在 .cw-workspace 之下，
   不改子组件、不写全局裸选择器，避免影响挑战页与项目页。 */
import './learning-workspace-view.css'

/**
 * 对外入口不变：`app/src/app.tsx` 仍以 `import type { LessonCompletionPayload }
 * from './components/learning-workspace-view'` 引它，正文与审计注释在
 * `./learning-workspace/workspace-model.ts`（01 号方案 §4 的拆分本轮只搬运行不搬 API）。
 */
export type { LessonCompletionPayload }

type LearningWorkspaceViewProps = {
  lesson: Lesson
  code: string
  isDirty: boolean
  currentEvent: TraceEvent | undefined
  runStatus: RunStatus
  eventIndex: number
  execution: ExecutionResult
  visibleOutput: string[]
  variables: VariableValue[]
  completed: boolean
  /**
   * LEARN-01 第 4 条：已完成时这一格要说清是**谁判的**。
   * 01 号方案 §9 收口：改版前这里收的是 `CompletionVerification`（只有自动/自评两档），
   * 上层另写了一个 `lastCompletionVerification()` 从 evidence 数组里从后往前扫——那是
   * 「这一课算不算完成、谁判的」的第二份实现。现在读侧只有一个出口
   * `completionSourceOf()`（utils/lesson-evidence.ts），三档：自动验证 / 自行声明 / 延迟复测掌握。
   * 缺省按「不知道」读，不追认成验证过。
   */
  completionSource?: LessonCompletionSource | null
  /**
   * LEARN-01 第 4 条：这一课当前成立的学习状态。
   * 缺省按「什么都没记」读（不猜）；上层从掌握度记录派生后传下来，本组件不自存一份真相。
   */
  evidenceStates?: LessonEvidenceStates | null
  /**
   * #105：资料库课程的「主题原文 + 代码 + 练习契约」是点开之后另一次取数才落地的
   * （`app.tsx` 的 `loadLessonDetail`）。在这一秒里，`lesson.reading` 还没有、`lesson.code`
   * 还是目录占位的空串——于是界面会先说「本单元没有配套代码」，一秒后又把原文和编辑器摆出来。
   * 那句「没有」是**还没读到**，不是**没有**，所以这一秒改说加载中（并且给原文区留出占位高度，
   * 让内容落地时不要把下面的代码区整体推走——terminal109 量到的是视口 24%—78% 的回流）。
   */
  detailPending?: boolean
  /**
   * 01 号方案 §4 的 error 行：主题原文与练习契约**读取失败**时的原因（由上层按当前这一课给）。
   * 与 `detailPending` 是两句话——「还在路上」不说「没有」，「读失败」也不说「这一课没有原文」。
   * 改版前两者都掉进「本单元没有配套代码」那句只在真的没有时才成立的文案里。
   */
  detailError?: string | null
  /** 失败后的重试动作：重放同一次详情取数，不清用户已写的草稿。 */
  onRetryDetail?: () => void
  /** 「标记已阅读」：能诚实拿到「读过」的唯一方式是学习者自己按这一下。 */
  onMarkRead?: () => void
  /** 已标记过就不再给按钮（重复标记只会多出同样一条信号，那是假数据）。 */
  readMarked?: boolean
  onComplete: (payload: LessonCompletionPayload) => void
  onBack: () => void
  onHelp: () => void
  onCodeChange: (code: string) => void
  onRun: () => void
  /**
   * 画布那枚「播放」要的回调（2026-10-04 拆出来）。
   *
   * 它与 `onRun` 不是同一件事：`onRun` 是运行条的「开始运行」——第一次点击**只落到第一拍
   * 就停**（用户原话「点击『开始运行』时，中间就会出现最开始的内容」）；`onPlay` 是画布上
   * 写着「播放」的那一枚——第一次点击**直接放到底**。两者共用一支函数，必有一个名不副实。
   */
  onPlay: () => void
  onStep: () => void
  /** 画布「上一步」：把播放头移到任意一拍（`use-execution.ts` 的 `handleSeek`）。 */
  onSeek: (index: number) => void
  onReset: () => void
  /** SAVE-01 第 4 条：Ctrl/Cmd+S 的真实结果（成功/失败），由 app 层给，落在代码区头部那句话里。 */
  saveFeedback?: string
  /** EDIT-01：编辑器的三件设置（Tab 宽度 / 自动换行 / 行号），由设置弹窗真驱动。 */
  editorTabSize?: number
  editorWordWrap?: boolean
  editorLineNumbers?: boolean
}

/**
 * 学习工作台（01 号方案 §3.2 主工作台 / §4 组件拆分的本页落地）。
 *
 * M4 拆分（本轮）——**只搬运 + 记忆化，不改业务行为、判定口径、DOM 结构、className、文案、
 * `aria-*`、`id`、`role`**。拆分前 660 行一个函数：编辑器改一个字、运行一次、填一格外部证据，
 * 都会把原文（Markdown）、流程图、六态清单连着重渲染一遍。现在的形状是：
 * - `./learning-workspace/WorkspaceHeader`：返回 + 页级 h1 + 等级时长 + 图标动作 + 分区锚点导航；
 * - `./learning-workspace/LessonReader`：主题原文的三种形态（正常 / 详情在路上 / 读取失败）；
 * - `./learning-workspace/CodeEditorPane`：terminal 区头 + 编辑器 + 保存提示 + 代码草稿的四种说法；
 * - `./learning-workspace/RuntimeTrace`：运行控制那一块 + 流程图 + 变量面板 + 控制台；
 * - `./learning-workspace/EvidenceStateGrid`：完成入口那一行与该单元的六态清单（「谁判的」）；
 * - `./learning-workspace/workspace-model`：只服务本页的纯函数与常量（锚点表、完成口径折算、
 *   三档文案），五个子组件共用这一份，不再各写一遍。
 *
 * 留在本文件的三样东西都不是呈现：课程指南开合（`guideOpen`，它决定的是页面末尾那块内容的挂载点）、
 * 错误定位令牌（`reveal`，编辑器与控制台共用）、外部环境证据表单（填的是「这一课」的材料，
 * 换课即作废）。取数、写草稿、运行仍然全部在 `app.tsx`，本组件不碰。
 *
 * 判定与展示的唯一出口没有新增：完成判定读 `utils/lesson-evidence.ts`
 * （`holdsCompletion` / `completionSourceOf` / `LESSON_COMPLETION_SOURCE_LABEL`）、
 * 日期键读 `utils/date-helpers.ts` 的 `getLocalDateKey`、判题读 `engine/challenge-judge.ts`
 * 的 `judgeOutput`、外部证据读 `utils/external-evidence.ts`（01 号方案 §9）。
 */
export function LearningWorkspaceView({
  lesson,
  code,
  isDirty,
  currentEvent,
  runStatus,
  eventIndex,
  execution,
  visibleOutput,
  variables,
  completed,
  completionSource = null,
  evidenceStates = null,
  detailPending = false,
  detailError = null,
  onRetryDetail,
  onMarkRead,
  readMarked = false,
  onComplete,
  onBack,
  onHelp,
  onCodeChange,
  onRun,
  onPlay,
  onStep,
  onSeek,
  onReset,
  saveFeedback = '',
  editorTabSize = 2,
  editorWordWrap = false,
  editorLineNumbers = true,
}: LearningWorkspaceViewProps) {
  const [guideOpen, setGuideOpen] = useState(false)
  const toggleGuide = useCallback(() => setGuideOpen((open) => !open), [])
  /**
   * 代码模式：把本页收成「编辑区在左、运行画布在右」的单屏布局——用户要的是
   * 参考实现 `algorithm-visualization-replica/` 那个形状，只留与写代码直接相关的那几块。
   *
   * 为什么是**一个类名**而不是另一套 DOM。默认布局的四个分区锚点（`#cw-pane-*`）与
   * 导航 href 列表是契约测试逐条钉死的（`learning-workspace-view.m3.test.tsx` L285-305），
   * 换一套 DOM 就要在「两套渲染」之间维护同一份可达性、焦点顺序与锚点表——那正是
   * 「改一处忘一处就开始撒谎」的写法。所以这里只切根节点的类，元素一个不增不减：
   * 默认视图与代码模式共用同一棵树，靠 CSS 决定哪一块此刻可见、摆在哪。
   *
   * 只改**呈现**：不隐藏焦点陷阱、不移除 tabindex，隐藏的那几块用 `display: none`
   * （连同子树一起离开 tab 顺序与读屏顺序），不留「看不见但 Tab 能到」的暗门。
   */
  const [codeMode, setCodeMode] = useState(() => Boolean(lesson.code) || lesson.flow.length > 0)
  const toggleCodeMode = useCallback(() => setCodeMode((on) => !on), [])
  /**
   * 换课就按新课重算默认档（2026-10-04）。
   *
   * 用户的诉求是「**只要点进跟代码有关的内容，就直接占满整个页面**」——也就是说
   * 默认值不该是「关」，而是「这一课有没有代码/画布」。有 → 一进来就是沉浸式全屏；
   * 没有（纯阅读单元）→ 保持普通版式，那时把编辑器铺满整屏反而是空场子。
   *
   * 为什么用**渲染期重置**而不是 `useEffect`：换课时 `lesson.id` 在这一次渲染里就已经
   * 是新的了，用 effect 会先按旧值画一帧（全屏闪一下再收回），而渲染期 setState
   * 由 React 立刻重渲染，那一帧不会出现。本文件对 `evidenceLessonId` 用的是同一写法。
   * 只在**换课**时重置：用户在同一次学习里手动切回普通版式，不该被下一条笔记打断。
   */
  const [codeModeLessonId, setCodeModeLessonId] = useState(lesson.id)
  if (codeModeLessonId !== lesson.id) {
    setCodeModeLessonId(lesson.id)
    setCodeMode(Boolean(lesson.code) || lesson.flow.length > 0)
  }
  /**
   * EDIT-01 第 6 条「错误定位」：控制台只知道行号，光标与滚动住在编辑器里。
   * 每次点击都换一个新 token，编辑器按 token 变化触发——同一行连点两次也要真的滚过去。
   */
  const [reveal, setReveal] = useState<{ line: number; token: number } | undefined>(undefined)
  const locateError = useCallback(
    (line: number) => setReveal((current) => ({ line, token: (current?.token ?? 0) + 1 })),
    [],
  )
  const unit = lesson.content
  const isExternal = unit.runEnvironment === 'external'
  /**
   * LEARN-01 第 5a 条：外部真实环境的课也要交**结构化**证据——与挑战页同一份模型、
   * 同一个校验器（utils/external-evidence.ts），这里只是把它搬到工作台里来填。
   * 表单状态留在本组件：填的是「这一课」的材料，换课即作废（下面用渲染期重置清掉，
   * 与 ChallengesView 的 lastFocusId、app.tsx 的 lastTrackedView 同一写法）。
   */
  const [evidenceLessonId, setEvidenceLessonId] = useState(lesson.id)
  const [externalEvidence, setExternalEvidence] = useState<ExternalEvidence>(() => emptyEvidence(getLocalDateKey()))
  if (evidenceLessonId !== lesson.id) {
    setEvidenceLessonId(lesson.id)
    setExternalEvidence(emptyEvidence(getLocalDateKey()))
  }
  /** 外部证据的逐字段写入：稳定引用，EvidenceStateGrid 因此可以在父层重渲染时原地不动。 */
  const patchExternalEvidence = useCallback(
    (updates: Partial<ExternalEvidence>) => setExternalEvidence((current) => ({ ...current, ...updates })),
    [],
  )
  /** 校验一次算好当事实传下去（仍是 utils/external-evidence.ts 那份口径，本组件不重算规则）。 */
  const externalCheck = useMemo(
    () => (isExternal ? validateExternalEvidence(externalEvidence, lessonAcceptancePoints(lesson)) : null),
    [isExternal, externalEvidence, lesson],
  )
  /** 「能不能标完成、按哪一档标」的折算：整块搬到 workspace-model 的 `assessCompletion()`，算一次。 */
  const {
    hasCode,
    hasFlow,
    canAutoRun,
    autoVerified,
    needsRun,
    needsVerify,
    needsExternalEvidence,
    completeDisabled,
    contractJudge,
  } = useMemo(
    () => assessCompletion({ lesson, runStatus, execution, visibleOutput, isExternal, externalCheck, detailPending }),
    [lesson, runStatus, execution, visibleOutput, isExternal, externalCheck, detailPending],
  )
  /** 四个分区的锚点：只列此刻真实存在的分区，导航不会指向不存在的 id（同一处折算）。 */
  const panes = useMemo(() => visiblePanes(lesson, detailPending, detailError), [lesson, detailPending, detailError])
  /** 完成那句话的三档文案出自 utils/lesson-evidence.ts 的同一张表，界面不自己抄一遍。 */
  const completedLabel = completedLabelOf(completionSource)
  const buttonLabel = pendingLabelOf({
    detailPending,
    needsRun,
    needsVerify,
    contractJudge,
    canAutoRun,
    needsExternalEvidence,
  })
  /**
   * 交上去的 payload 在点这一下的当下现算（外部证据的每一项都进了依赖），
   * 而不是把「怎么拼」下放到按钮那一格里。
   */
  const handleComplete = useCallback(
    () =>
      onComplete(
        completionPayloadOf({ ran: autoVerified, contractJudge, isExternal, externalCheck, externalEvidence }),
      ),
    [onComplete, autoVerified, contractJudge, isExternal, externalCheck, externalEvidence],
  )
  /** 播放头走过的流程节点：以前写在 JSX 里，每次渲染都新建一个数组；现在只在游标真的动过时折一次。 */
  const completedNodeIds = useMemo(
    () => execution.events.slice(0, eventIndex + 1).map((e) => e.nodeId).filter(Boolean) as string[],
    [execution.events, eventIndex],
  )
  /**
   * 流程图骨架 + 每一拍的数据：把 `flow` 的节点与 `events` 按 `nodeId` 合到一处。
   * 一个节点可能被走到多次（循环体），取**最后一次**那一拍——图上「当前」亮的是它，
   * 右侧数据栏给的也必须是同一个快照，否则图和数据说的不是同一件事。
   * `ordinal` 是该节点第一次被走到的次序（1 起），未走到则为 undefined（图上显示 `--`）。
   */
  const flowSteps = useMemo(() => {
    const runtimeFlow = lesson.flow.length > 0
      ? lesson.flow
      : execution.tier === 'worker'
        ? deriveRuntimeFlow(execution.events.filter((event) => event.type === 'line' || event.type === 'output' || event.type === 'condition' || event.type === 'loop'), code).filter((node) => node.id.startsWith('line-'))
        : []
    const lastEventByNode = new Map<string, { event: (typeof execution.events)[number]; ordinal: number }>()
    execution.events.forEach((event, index) => {
      if (!event.nodeId) return
      const seen = lastEventByNode.get(event.nodeId)
      lastEventByNode.set(event.nodeId, { event, ordinal: seen?.ordinal ?? index + 1 })
    })
    return runtimeFlow.map((node) => {
      const hit = lastEventByNode.get(node.id)
      return {
        id: node.id,
        label: node.label,
        kind: node.kind,
        tone: node.tone,
        line: hit?.event.line ?? node.line,
        event: hit?.event,
        ordinal: hit?.ordinal,
      }
    })
  }, [lesson.flow, execution, code])
  const effectiveFlow = lesson.flow.length > 0
    ? lesson.flow
    : execution.tier === 'worker'
      ? deriveRuntimeFlow(execution.events.filter((event) => event.type === 'line' || event.type === 'output' || event.type === 'condition' || event.type === 'loop'), code).filter((node) => node.id.startsWith('line-'))
      : []

  /**
   * 画布这一拍的一帧：`flowSteps`（已经折好的节点骨架 × 每一拍）+ 当前播放下标。
   * 只算当前这一帧，不把整段运行都折一遍——`events` 长的时候那是白算的。
   * 帧模型是纯函数（`engine/run-stage-model.ts`），没有事件时返回 null，整块不画。
   */
  /**
   * 画布这一拍的一帧。取不到帧（还没运行 / 这一段没有事件）时退到**骨架帧**：
   * 把「这段程序有哪几步」按图形画出来，每个节点都是未走到。
   *
   * 为什么不让它退回 null：退回 null 的话整块 `RunStage` 不画，同一位置露出来的是
   * 那条文字拍轨（`.flow-chart`）——用户第一眼看到工作台时看到的又成了文字。
   * 骨架帧让「运行前」也是图形，文字轨自此彻底退场（`skeletonStageFrame` 的注释详述）。
   */
  const stageFrame = useMemo(
    () => stageFrameAt(execution.events, flowSteps, eventIndex) ?? skeletonStageFrame(flowSteps),
    [execution.events, flowSteps, eventIndex],
  )

  return (
    /* `is-code-mode` 只加在根节点上：见上面 `codeMode` 的注释——同一棵 DOM，两套呈现。 */
    <div className={`cw-workspace${codeMode ? ' is-code-mode' : ''}`}>
      <WorkspaceHeader
        label={lesson.label}
        title={lesson.title}
        level={lesson.level}
        durationLabel={lessonDurationLabel(lesson)}
        panes={panes}
        guideOpen={guideOpen}
        onToggleGuide={toggleGuide}
        codeMode={codeMode}
        onToggleCodeMode={toggleCodeMode}
        onBack={onBack}
        onHelp={onHelp}
      />

      <div className="learning-view">
        <section className="workspace" aria-label="阅读与代码区">
          {/* 资料库正文：阅读区保留原文层次；不需要构建即可随资料库更新。 */}
          <LessonReader
            reading={lesson.reading}
            detailPending={detailPending}
            detailError={detailError}
            onRetryDetail={onRetryDetail}
          />
          <CodeEditorPane
            hasCode={hasCode}
            detailPending={detailPending}
            detailError={detailError}
            hasSource={Boolean(lesson.source)}
            fileName={lesson.fileName}
            runtime={lesson.runtime}
            isDirty={isDirty}
            saveFeedback={saveFeedback}
            code={code}
            language={lesson.language}
            languageLabel={lesson.languageLabel}
            activeLine={currentEvent?.line}
            tabSize={editorTabSize}
            wordWrap={editorWordWrap}
            lineNumbers={editorLineNumbers}
            reveal={reveal}
            onCodeChange={onCodeChange}
          />
          <RuntimeTraceControls
            canAutoRun={canAutoRun}
            runStatus={runStatus}
            hasCode={hasCode}
            isExternal={isExternal}
            runtime={lesson.runtime}
            unsupported={Boolean(execution.unsupported)}
            onRun={onRun}
            onStep={onStep}
            onReset={onReset}
          />
          <EvidenceStateGrid
            completed={completed}
            completedLabel={completedLabel}
            buttonLabel={buttonLabel}
            completeDisabled={completeDisabled}
            onComplete={handleComplete}
            lessonId={lesson.id}
            isExternal={isExternal}
            externalEvidence={externalEvidence}
            externalCheck={externalCheck}
            onPatchEvidence={patchExternalEvidence}
            contractJudge={contractJudge}
            detailPending={detailPending}
            canAutoRun={canAutoRun}
            evidenceStates={evidenceStates}
            readMarked={readMarked}
            onMarkRead={onMarkRead}
          />

          <LessonSourceDetail lesson={lesson} />
        </section>

        <RuntimeTrace
          hasFlow={hasFlow || effectiveFlow.length > 0}
          steps={flowSteps}
          stageFrame={stageFrame}
          playing={runStatus === 'running'}
          canStep={execution.events.length > 0}
          stepIndex={eventIndex}
          stepTotal={execution.events.length}
          onPrev={() => onSeek(eventIndex - 1)}
          onNext={onStep}
          onTogglePlay={onPlay}
          onReset={onReset}
          activeNodeId={currentEvent?.nodeId}
          completedNodeIds={completedNodeIds}
          variables={variables}
          eventIndex={eventIndex}
          totalEvents={execution.events.length}
          output={visibleOutput}
          error={execution.error}
          // 没有代码的单元不画定位按钮：定位的目标不存在，画出来就是一个假动作。
          onLocateError={hasCode ? locateError : undefined}
        />
      </div>

      {guideOpen && (
        <section className="lesson-guide" aria-label="课程指南">
          <div className="guide-block">
            <span>目标</span>
            <strong>{unit.objective}</strong>
            <div className="guide-prereq">
              {unit.prerequisites.length > 0 && <small>先备：{unit.prerequisites.join('；')}</small>}
            </div>
          </div>
          <div className="guide-block guide-explain">
            <span>讲解与例子</span>
            <ul>
              {unit.explanation.map((item) => (
                <li key={item}>{item}</li>
              ))}
              {unit.examples.map((example) => (
                <li key={example.good}>
                  ✅ {example.good}
                  {example.bad && <>；❌ {example.bad}</>}（{example.why}）
                </li>
              ))}
            </ul>
          </div>
          <div className="guide-block guide-exercise">
            <span>跟做 / 独立题 / 变式</span>
            <ol>
              {unit.guidedSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p>
              <strong>独立题：</strong>
              {unit.exercise}
            </p>
            <p>
              <strong>变式题：</strong>
              {unit.variant}
            </p>
          </div>
          <div className="guide-block">
            <span>常见错误</span>
            <ul>
              {unit.mistakes.map((mistake) => (
                <li key={mistake}>{mistake}</li>
              ))}
            </ul>
          </div>
          <div className="guide-block">
            <span>验证与证据</span>
            <strong>{unit.runCommand}</strong>
            <p>{unit.completion}</p>
            {lesson.acceptance && lesson.acceptance.testCases.length > 0 && (
              <p>
                <strong>公开用例：</strong>
                {lesson.acceptance.testCases.join('；')}
              </p>
            )}
            {lesson.acceptance && lesson.acceptance.hints.length > 0 && (
              <ul>
                {lesson.acceptance.hints.map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>
            )}
            {unit.acceptanceCriteria && unit.acceptanceCriteria.length > 0 && (
              <p>
                <strong>验收标准：</strong>
                {unit.acceptanceCriteria.join('；')}
              </p>
            )}
            {unit.evidenceChecklist && unit.evidenceChecklist.length > 0 && (
              <p>
                <strong>证据清单：</strong>
                {unit.evidenceChecklist.join('；')}
              </p>
            )}
            <p className="guide-project">
              <strong>项目任务：</strong>
              {unit.projectTask}
            </p>
            {unit.stageId && <small>对应课程阶段 {unit.stageId}</small>}
          </div>
        </section>
      )}

      {lesson.insight && (
        <section className="lesson-insight">
          <div className="insight-icon">💡</div>
          <div>
            <strong>关键理解</strong>
            <p>{lesson.insight}</p>
          </div>
        </section>
      )}
    </div>
  )
}
