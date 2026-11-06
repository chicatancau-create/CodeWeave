/**
 * LEARN-01 第 4 条：把「已练习」「已阅读」两条学习信号接到真实事件上。
 *
 * - 已练习：执行 hook 报出**完整跑完的轨迹**那一刻自动记一条，不靠学习者自述
 *   （自述的是「完成」，那是另一条口径）。判据见 `isCompletedPracticeRun`。
 * - 已阅读：没有任何东西能诚实地推断出「读过」，所以它是界面上的一个显式动作 `markRead()`。
 *
 * 两条都以 `passed: false` 落盘（`applyEvidence` 只在 passed 时 +1 级），因此既不推进掌握等级，
 * 也不算完成证据；状态由 `utils/lesson-evidence.ts` 从同一批记录里折出来，不开新存储。
 */
import { useCallback, useEffect, useRef } from 'react'
import type { CompletionVerification, MasteryEvidenceKind, MasteryRecord } from '../data/mastery'
import type { ExecutionResult, Lesson, RunStatus } from '../types/lesson'
import { hasLessonSignal, isCompletedPracticeRun, lessonSignalNote } from '../utils/lesson-evidence'

type LessonSignalsParams = {
  /** 当前打开的单元；为 null 表示不在工作台里 */
  lesson: Lesson | null
  runStatus: RunStatus
  execution: ExecutionResult
  records: Record<string, MasteryRecord>
  recordEvidence: (
    refId: string,
    kind: MasteryEvidenceKind,
    passed: boolean,
    note: string,
    verification?: CompletionVerification,
  ) => void
}

export function useLessonSignals({ lesson, runStatus, execution, records, recordEvidence }: LessonSignalsParams) {
  /**
   * 本次挂载内已写过的信号键。
   * 光靠 `records` 判重挡不住：StrictMode 会把 effect 连跑两遍，两遍读到的是同一份旧 records，
   * 于是同一次运行落进两条「已练习」——练习次数是数出来的，多一条就是假数据。
   */
  const writtenRef = useRef(new Set<string>())

  useEffect(() => {
    if (!lesson) return
    if (!isCompletedPracticeRun({ ...execution, runStatus })) return
    const key = `practice:${lesson.id}`
    if (writtenRef.current.has(key)) return
    if (hasLessonSignal(records[lesson.id], 'practice')) return
    writtenRef.current.add(key)
    recordEvidence(lesson.id, 'lesson', false, lessonSignalNote('practice', lesson.title))
  }, [lesson, execution, runStatus, records, recordEvidence])

  /** 显式标记「已阅读」：同一课只记一次，重复点击不再写证据。 */
  const markRead = useCallback(() => {
    if (!lesson) return
    const key = `read:${lesson.id}`
    if (writtenRef.current.has(key)) return
    if (hasLessonSignal(records[lesson.id], 'read')) return
    writtenRef.current.add(key)
    recordEvidence(lesson.id, 'lesson', false, lessonSignalNote('read', lesson.title))
  }, [lesson, records, recordEvidence])

  const readMarked = lesson ? hasLessonSignal(records[lesson.id], 'read') : false

  return { markRead, readMarked }
}
