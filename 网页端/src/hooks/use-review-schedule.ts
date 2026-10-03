import { useCallback, useMemo } from 'react'
import type { CompletionVerification, MasteryEvidence, MasteryEvidenceKind, MasteryRecord } from '../data/mastery'
import {
  applyEvidence,
  dueReviewRecords,
  effectiveReviewPlan,
  rescheduleReview,
  scheduleFirstReview,
  scheduleNextReview,
  snoozeReview,
  type ReviewPlan,
} from '../data/mastery'
import { publishedReviewOffsets } from '../content/adapter'
import { useOptionalContent, type ContentContextValue } from '../content/provider'
import { getLocalDateKey } from '../utils/date-helpers'
import { scopedKey, STORAGE_KEYS } from '../utils/constants'
import { useLocalStorage } from './use-local-storage'

function validateRecords(value: unknown): Record<string, MasteryRecord> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const next: Record<string, MasteryRecord> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof item === 'object' && item !== null &&
      typeof (item as MasteryRecord).refId === 'string' &&
      Array.isArray((item as MasteryRecord).evidence)
    ) {
      next[key] = item as MasteryRecord
    }
  }
  return next
}

/**
 * 本单元自己写的复测节点（`null` / `[]` = 没写 = 继承发布规则）。
 * 阶段复测（`stage-*`）不是课程单元，找不到 Lesson，按「没写」处理。
 */
function unitReviewOffsets(content: ContentContextValue | null, refId: string): number[] | null {
  const lesson = content?.lessons.find((item) => item.id === refId)
  const offsets = lesson?.content.reviewOffsetsDays
  return Array.isArray(offsets) && offsets.length > 0 ? offsets : null
}

/**
 * 复测排期口径的**唯一入口**（#33）：三级优先见 `effectiveReviewPlan`
 * ——本单元覆盖 → 资料库发布规则 → 本机兜底常量。
 * 调度（本 hook）与复习中心（`components/review-center-view.tsx`）都从这里取同一份计划，
 * 于是界面说不出与实际排期不一致的话。Provider 之外（未连接内容 / 单测）取不到单元与发布规则，
 * 自然落到兜底常量。
 */
export function useReviewPlanResolver(): { planFor: (refId: string) => ReviewPlan; defaultPlan: ReviewPlan } {
  const content = useOptionalContent()
  const published = publishedReviewOffsets()
  const planFor = useCallback(
    (refId: string) => effectiveReviewPlan(unitReviewOffsets(content, refId), published),
    [content, published],
  )
  const defaultPlan = useMemo(() => effectiveReviewPlan(null, published), [published])
  return { planFor, defaultPlan }
}

/**
 * 复习调度：为每个学习条目维护掌握度记录与复测节点计划。
 * 传入 now 用于跨午夜后重新计算“今天”。
 * 排期用哪一份节点由 `useReviewPlanResolver()` 决定（不再固定读客户端常量）。
 */
export function useReviewSchedule(scope: string | undefined, now: Date) {
  const [records, setRecords] = useLocalStorage<Record<string, MasteryRecord>>(
    scopedKey(STORAGE_KEYS.MASTERY, scope),
    {},
    { validate: validateRecords },
  )

  const todayKey = getLocalDateKey(now)
  const { planFor, defaultPlan } = useReviewPlanResolver()

  const recordEvidence = useCallback(
    (refId: string, kind: MasteryEvidenceKind, passed: boolean, note: string, verification?: CompletionVerification) => {
      const evidence: MasteryEvidence = {
        id: `evidence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind,
        refId,
        note,
        at: new Date().toISOString(),
        passed,
        ...(verification ? { verification } : {}),
      }
      const plan = planFor(refId).offsets
      setRecords((current) => {
        const updated = applyEvidence(current[refId], evidence, plan.length)
        if (kind === 'review') {
          if (passed) {
            // 复测通过：安排下一个节点；lastFailReason 保留为历史（新失败会覆盖）
            return { ...current, [refId]: scheduleNextReview(updated, todayKey, plan) }
          }
          // 复测失败：降级、重排，并记录最近失败原因摘要
          const rescheduled = rescheduleReview(updated, todayKey, plan)
          return { ...current, [refId]: { ...rescheduled, lastFailReason: note || '复测未通过' } }
        }
        return { ...current, [refId]: updated }
      })
    },
    [planFor, setRecords, todayKey],
  )

  /** 课程单元完成：记证据并安排首次复测（排在生效计划的第 0 档）。verification 由调用方给（LEARN-01 第 4 条：分开记「谁判的」）。 */
  const markLessonCompleted = useCallback(
    (lessonId: string, note: string, verification: CompletionVerification) => {
      recordEvidence(lessonId, 'lesson', true, note, verification)
      const plan = planFor(lessonId).offsets
      setRecords((current) => {
        const record = current[lessonId]
        if (!record) return current
        return { ...current, [lessonId]: scheduleFirstReview(record, todayKey, plan) }
      })
    },
    [planFor, recordEvidence, setRecords, todayKey],
  )

  /** 稍后提醒：把某条复测顺延到明天。 */
  const snooze = useCallback(
    (refId: string) => {
      setRecords((current) => {
        const record = current[refId]
        if (!record) return current
        return { ...current, [refId]: snoozeReview(record, todayKey) }
      })
    },
    [setRecords, todayKey],
  )

  const dueReviews = dueReviewRecords(records, todayKey)

  return {
    records,
    dueReviews,
    todayKey,
    recordEvidence,
    markLessonCompleted,
    snooze,
    /** 排期口径：`defaultPlan` 是页面级标准，`planFor(refId)` 是某一条实际用的那一份。 */
    defaultPlan,
    planFor,
  }
}
