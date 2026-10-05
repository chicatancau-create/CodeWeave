import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExecutionResult, LanguageId, Lesson, RunStatus } from '../types/lesson'
import { simulateProgram } from '../engine/teaching-runtime'
import { executeJavaScript } from '../engine/javascript-sandbox'
import { EXECUTION_SETTINGS } from '../utils/constants'

/**
 * RUN-01：运行身份与结果归属。
 *
 * 此前 `handleRun` 在 `await executeJavaScript(...)` **之后**才设置 running，
 * 期间没有 runId，用户可以重复触发；重置或切课后旧 Promise 返回时仍会写回结果。
 *
 * 现在：
 * - `runId` 在进入异步执行**之前**自增，界面据此判断"是否有运行中的任务"。
 * - 异步运行器返回后先比对 runId，不匹配（已被重置/切课/新运行取代）则整体丢弃。
 * - `runningRef` 提供同步防重入，避免同一 tick 内重复发起。
 */
export function useExecution(
  code: string,
  languageId: LanguageId,
  lesson: Lesson,
  enabled = true,
  /** §5.3 第 3 条：命中系统偏好或应用「减少动效」设置任一，播放头就不逐帧推进。 */
  reducedMotion = false,
) {
  const [runStatus, setRunStatus] = useState<RunStatus>('idle')
  const [execution, setExecution] = useState<ExecutionResult>({ events: [], output: [] })
  const [eventIndex, setEventIndex] = useState(0)
  const [runId, setRunId] = useState(0)
  /** 同步防重入标志：异步 setRunStatus 无法阻挡同一 tick 的第二次触发。 */
  const runningRef = useRef(false)
  /** 当前有效运行号：旧运行的迟到结果据此丢弃。 */
  const runIdRef = useRef(0)

  /** 统一的异步运行入口：先占位再执行，返回结果归属当前 runId 时才写回。 */
  const startRun = useCallback(
    async (nextStatus: RunStatus) => {
      if (!enabled) return
      if (runningRef.current) return
      runningRef.current = true

      const currentRunId = ++runIdRef.current
      setRunId(currentRunId)
      // 进入异步执行前即离开 idle，避免"点了没反应"的空窗。
      setRunStatus('running')

      let next: ExecutionResult
      try {
        next =
          languageId === 'javascript'
            ? await executeJavaScript(code, lesson)
            : simulateProgram(code, languageId, lesson)
      } catch {
        if (currentRunId !== runIdRef.current) return
        runningRef.current = false
        setExecution({ events: [], output: [], error: { line: 0, message: '运行失败，请稍后重试。' } })
        setEventIndex(0)
        setRunStatus('error')
        return
      }

      // 结果归属校验：期间若发生重置/切课/新运行，则整体忽略，不写回任何状态。
      if (currentRunId !== runIdRef.current) return

      runningRef.current = false
      setExecution(next)
      // §5.3 第 3 条「真正停止持续动画，不是放慢」：命中减少动效时不逐帧回放，
      // 播放头随结果一次落到末态（输出一条不少）。停在这里而不是停在 effect 里，
      // 是因为 effect 内同步 setState 会触发级联渲染（本库 eslint 直接拦），
      // 而 effect 里加 `if (reducedMotion) return` 会让中途翻开关的那一跑永远停在 running。
      const lastEvent = Math.max(0, next.events.length - 1)
      // 只对「放一遍」生效：单步（nextStatus='paused'）是用户自己驱动的节奏，不属于持续动画。
      const still = reducedMotion && !next.error && nextStatus === 'running'
      setEventIndex(still ? lastEvent : 0)
      setRunStatus(next.error ? 'error' : still ? 'completed' : nextStatus)
    },
    [code, enabled, languageId, lesson, reducedMotion],
  )

  /**
   * 「继续」两支共用的那一小步：把已经跑出来的结果按「放」或「直接落末态」收口。
   *
   * 为什么不能都写 `setRunStatus('running')`：减少动效那一档下「继续运行」会去排
   * 850ms 的定时器链，而 `startRun` 里那条 `still` 只在**新跑一次**时拦得住
   * （`reducedMotion && nextStatus === 'running'`）——这里没经过 `startRun`，
   * 拦不住。于是同一个开关，第一次点「开始运行」不播、第二次点「继续运行」却开始播，
   * 等于绕过用户自己的设置。所以恢复这一档也要问 `reducedMotion`：
   * 命中就直接落到末态（结果一条不少，只是不逐帧放）。
   *
   * 2026-10-04 之前不存在这条路径：那时 `handleRun` 第一下就是 `running`，
   * 「继续」这一支只在 `handlePlay` 里被走到，而它本来就是放；现在运行条的
   * 「开始运行」停在第一拍，于是「继续运行」成了减少动效档下必过的一道口子。
   */
  const resumeRun = useCallback(() => {
    if (reducedMotion) {
      setEventIndex(Math.max(0, execution.events.length - 1))
      setRunStatus('completed')
      return
    }
    setRunStatus('running')
  }, [execution.events.length, reducedMotion])

  /**
   * 「开始运行 / 继续运行 / 暂停执行」——**运行条**那一个入口（2026-10-04 改）。
   *
   * 用户原话：
   *   ·「点击『开始运行』时，中间就会出现最开始的内容，比方说『进入主函数』」；
   *   ·「点完之后，可以点击『继续运行』。因为我说的是『继续运行』，所以是一步到底的运行。
   *      内容要一步一步地弹出来，而不是已经完全显现出来。」
   *
   * 所以**第一次点击只落到第一拍就停住**（`startRun('paused')`），不是一路播到底：
   * 播到底的话用户第一眼看到的就是末态，「一步一步」这个诉求当场落空。
   * 第二下点的是「继续运行」（此时状态已是 `paused`）才交给 850ms 的定时器链逐拍推进。
   *
   * 与 `handlePlay`（画布那枚「播放」）的分工：那个按钮的名字就叫播放，
   * 它的语义是「放一遍」，所以第一下直接 `startRun('running')`。
   * 两个按钮共用同一支函数的话，必有一个名不副实——这是把它们拆开的全部原因。
   */
  const handleRun = useCallback(async () => {
    if (!enabled) return
    // 已有结果时：继续/暂停切换，不重新执行。
    if (runStatus === 'running') {
      setRunStatus('paused')
      return
    }
    if (runStatus === 'paused' && execution.events.length > 0) {
      resumeRun()
      return
    }
    // idle / completed / error：重新执行，落在第一拍并停住（等「继续运行」）。
    await startRun('paused')
  }, [enabled, execution.events.length, runStatus, startRun, resumeRun])

  /**
   * 画布那枚「播放 / 暂停」：与 `handleRun` 的差别只有一处——**第一次点击直接放到底**
   * （`startRun('running')`）。按钮的字面意思就是「播放」，与运行条的「开始运行」不是
   * 同一件事，所以不共用。
   */
  const handlePlay = useCallback(async () => {
    if (!enabled) return
    if (runStatus === 'running') {
      setRunStatus('paused')
      return
    }
    if (runStatus === 'paused' && execution.events.length > 0) {
      resumeRun()
      return
    }
    await startRun('running')
  }, [enabled, execution.events.length, runStatus, startRun, resumeRun])

  const handleStep = useCallback(async () => {
    if (!enabled) return
    if (execution.events.length === 0 || runStatus === 'completed' || runStatus === 'error') {
      await startRun('paused')
      return
    }

    if (eventIndex >= execution.events.length - 1) {
      setRunStatus('completed')
      return
    }

    setEventIndex((current) => current + 1)
    setRunStatus('paused')
  }, [enabled, eventIndex, execution.events.length, runStatus, startRun])

  /**
   * 把播放头**移到任意一拍**（画布的「上一步」，以及将来可能的跳转/拖动）。
   *
   * 这是 `handleStep` 做不到的事：那里只会 `+1`，或者从头重启，全项目没有任何地方
   * 能把 `eventIndex` 设成一个给定的 N。没有它，「上一步」只能靠「重置再走 N-1 步」，
   * 而那会把已经跑出来的结果丢掉。
   *
   * `runningRef.current = false` 必须写：自动回放的 `setTimeout` 链是按
   * 「`eventIndex` 或 `runStatus` 变化」重排的，迟到的那一个 tick 仍然会在
   * `runStatus` 变回 `running` 时把播放头再往前推一格。清了标志并落到 `paused`，
   * 退回来的那一拍才是终局。
   */
  const handleSeek = useCallback(
    (index: number) => {
      if (!enabled) return
      runningRef.current = false
      setEventIndex(Math.max(0, Math.min(index, Math.max(0, execution.events.length - 1))))
      setRunStatus('paused')
    },
    [enabled, execution.events.length],
  )

  const handleReset = useCallback(() => {
    // 使进行中的运行失效：迟到结果将因 runId 不匹配而被丢弃。
    runIdRef.current += 1
    runningRef.current = false
    setExecution({ events: [], output: [] })
    setEventIndex(0)
    setRunStatus('idle')
  }, [])

  // 代码或课程变化时使旧运行失效，避免"改完代码又被旧结果覆盖"。
  useEffect(() => {
    runIdRef.current += 1
    runningRef.current = false
  }, [code, lesson.id])

  useEffect(() => {
    if (runStatus !== 'running') return

    const timer = window.setTimeout(() => {
      if (eventIndex >= execution.events.length - 1) {
        setRunStatus('completed')
      } else {
        setEventIndex((current) => current + 1)
      }
    }, EXECUTION_SETTINGS.STEP_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [eventIndex, execution.events.length, runStatus])

  useEffect(() => {
    if (!enabled) return
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        handleRun()
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [enabled, handleRun])

  const currentEvent = execution.events[eventIndex]
  const visibleOutputCount = execution.events
    .slice(0, eventIndex + 1)
    .filter((item) => item.type === 'output').length
  const visibleOutput = execution.output.slice(0, visibleOutputCount)
  const variables = currentEvent?.variables ?? []

  return {
    runStatus,
    runId,
    execution,
    eventIndex,
    currentEvent,
    visibleOutput,
    variables,
    handleRun,
    /** 画布那枚「播放」：第一次点击直接放到底（见上面的分工说明）。 */
    handlePlay,
    handleStep,
    /** 画布「上一步」唯一可用的跳转入口：把 `eventIndex` 设成任意拍（见上面的说明）。 */
    handleSeek,
    handleReset,
  }
}
