/**
 * F5 学习分析（近 7 天）：全部指标从真实学习证据派生，不足时如实显示。
 *
 * STAT-01 统一口径（个人中心、学习路径、挑战统计、分析、通知共用同一派生规则）：
 * 1. 日期归日一律经 `toLocalDateKey`，禁止 `iso.slice(0, 10)` 把 UTC 日期当本地日期。
 * 2. 挑战“通过”只认 passed / verified；无 status 的历史记录按迁移语义单列为旧版，不混入。
 * 3. 完成课程按 `lessonId` 去重计一次；重复练习次数用独立字段，两个口径不互相冒充。
 * 4. 复测通过率只由 review 证据决定；到期任务完成率需要计划任务分母，暂不在此派生。
 */

import type { MasteryRecord } from '../data/mastery'
import type { ChallengeRecord } from '../types/lesson'
import { isPassedRecord } from '../types/lesson'
import { shiftDateKey, toLocalDateKey } from './date-helpers'

export type WeeklyStats = {
  /** 近 7 天完成的课程单元（按 lessonId 去重，仅计通过证据） */
  lessonsCompleted: number
  /** 近 7 天课程练习次数（同一单元重复练习分别计数，与 lessonsCompleted 是两个口径） */
  lessonPracticeCount: number
  /** 近 7 天通过的挑战（仅 passed / verified） */
  challengesPassed: number
  /**
   * 近 7 天按旧版迁移语义视为通过的挑战（记录缺失 status）。
   * 单独暴露以便界面如实标注来源，不与本机已验证的通过混淆。
   */
  challengesLegacyPassed: number
  /** 近 7 天复测通过 / 未通过次数 */
  reviewsPassed: number
  reviewsFailed: number
  /** 复测完成率 = 通过 /（通过+未通过）；无复测时为 null（显示“样本不足”） */
  reviewRate: number | null
  periodStartKey: string
  todayKey: string
}

/** 日期键是否落在 [startKey, todayKey] 闭区间内；无法归日时按窗口外处理。 */
function inWindow(dateKey: string | null, startKey: string, todayKey: string): boolean {
  if (!dateKey) return false
  return dateKey >= startKey && dateKey <= todayKey
}

export function computeWeeklyStats(input: {
  masteryRecords: MasteryRecord[]
  challengeRecords: Record<string, ChallengeRecord>
  todayKey: string
}): WeeklyStats {
  const { masteryRecords, challengeRecords, todayKey } = input
  const startKey = shiftDateKey(todayKey, -6) // 近 7 天：含今天

  // 完成课程按 lessonId 去重：同一单元多条证据只算一个完成单元。
  const completedLessonIds = new Set<string>()
  let lessonPracticeCount = 0
  let reviewsPassed = 0
  let reviewsFailed = 0

  for (const record of masteryRecords) {
    for (const evidence of record.evidence) {
      if (!inWindow(toLocalDateKey(evidence.at), startKey, todayKey)) continue
      if (evidence.kind === 'lesson') {
        lessonPracticeCount += 1
        if (evidence.passed) completedLessonIds.add(evidence.refId)
        continue
      }
      if (evidence.kind === 'review') {
        if (evidence.passed) reviewsPassed += 1
        else reviewsFailed += 1
      }
    }
  }

  let challengesPassed = 0
  let challengesLegacyPassed = 0
  for (const record of Object.values(challengeRecords)) {
    if (!isPassedRecord(record)) continue
    if (!inWindow(toLocalDateKey(record.completedAt), startKey, todayKey)) continue
    // 迁移语义：旧记录视为已通过，但单列一类，不冒充本机验证通过。
    if (record.status === undefined) challengesLegacyPassed += 1
    else challengesPassed += 1
  }

  const reviewTotal = reviewsPassed + reviewsFailed
  return {
    lessonsCompleted: completedLessonIds.size,
    lessonPracticeCount,
    challengesPassed,
    challengesLegacyPassed,
    reviewsPassed,
    reviewsFailed,
    reviewRate: reviewTotal === 0 ? null : Math.round((reviewsPassed / reviewTotal) * 100),
    periodStartKey: startKey,
    todayKey,
  }
}

/**
 * 挑战累计完成口径（不限定时间窗口）：挑战页、个人中心共用同一派生函数。
 *
 * 旧实现分别是 `Object.values(progress).filter(Boolean).length`（把 submitted/rejected
 * 也算作完成）与 challenges-view 内的第三份过滤条件，三处口径互不一致。
 */
export function countPassedChallenges(challengeRecords: Record<string, ChallengeRecord>): {
  passed: number
  legacy: number
  pendingVerify: number
} {
  let passed = 0
  let legacy = 0
  let pendingVerify = 0
  for (const record of Object.values(challengeRecords)) {
    if (record?.status === 'submitted') {
      pendingVerify += 1
      continue
    }
    if (!isPassedRecord(record)) continue
    if (record.status === undefined) legacy += 1
    else passed += 1
  }
  return { passed, legacy, pendingVerify }
}
