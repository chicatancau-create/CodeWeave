/**
 * 通知中心（N1/F2）：从真实学习数据派生通知，不生成假消息、不接入外部推送。
 *
 * 事件来源（全部可从既有状态推导，id 确定性生成便于去重）：
 * - 复测到期：mastery 的 dueReviews（每条到期记录一条）
 * - 挑战通过：completedAt 在“今天”的挑战记录
 * - 打卡里程碑：连续打卡达到 3/7/14/30/60/100 天且今天是打卡日
 *
 * 已读状态与“清空到某日”由调用方持久化（设备级），本模块只做派生。
 */

import type { ChallengeRecord } from '../types/lesson'
import { isPassedStatus } from '../types/lesson'
import type { MasteryRecord } from '../data/mastery'
import { toLocalDateKey } from './date-helpers'

export type NotificationKind =
  | 'review-due'
  | 'challenge-passed'
  | 'checkin-milestone'
  | 'draft-save-failed'

export type NotificationItem = {
  id: string
  kind: NotificationKind
  title: string
  dateKey: string
}

const MILESTONES = [3, 7, 14, 30, 60, 100]

export function deriveNotifications(input: {
  dueReviews: MasteryRecord[]
  titles: Record<string, string>
  challengeRecords: Record<string, ChallengeRecord>
  challengeTitles: Record<string, string>
  streak: number
  checkedInToday: boolean
  todayKey: string
}): NotificationItem[] {
  const { dueReviews, titles, challengeRecords, challengeTitles, streak, checkedInToday, todayKey } = input
  const items: NotificationItem[] = []

  for (const record of dueReviews) {
    items.push({
      id: `review-due:${record.refId}:${record.reviewDueKey}`,
      kind: 'review-due',
      title: `复测到期：${titles[record.refId] ?? record.refId}`,
      dateKey: record.reviewDueKey ?? todayKey,
    })
  }

  for (const [challengeId, record] of Object.entries(challengeRecords)) {
    // STAT-01：日期归日走本地时区；通过判定与挑战统计共用同一口径
    // （仅 passed / verified；无 status 的旧记录按迁移语义视为通过）。
    const dateKey = toLocalDateKey(record.completedAt)
    if (dateKey !== todayKey) continue
    if (record.status !== undefined && !isPassedStatus(record.status)) continue
    items.push({
      id: `challenge-passed:${challengeId}:${dateKey}`,
      kind: 'challenge-passed',
      title: `挑战通过：${challengeTitles[challengeId] ?? challengeId}`,
      dateKey,
    })
  }

  if (checkedInToday && MILESTONES.includes(streak)) {
    items.push({
      id: `checkin-milestone:${streak}:${todayKey}`,
      kind: 'checkin-milestone',
      title: `打卡里程碑：连续 ${streak} 天`,
      dateKey: todayKey,
    })
  }

  return items
}

/**
 * 瞬时事件存档（F2）：保存失败等“非状态派生”的事件需要持久留存，
 * 与派生通知合并展示；按 id 去重、上限 50 条（超出按时间淘汰）。
 */
export function mergeTransientEvents(
  stored: NotificationItem[],
  incoming: NotificationItem,
): NotificationItem[] {
  const merged = [incoming, ...stored.filter((item) => item.id !== incoming.id)]
  return merged.sort((a, b) => b.dateKey.localeCompare(a.dateKey)).slice(0, 50)
}

/** 已读/清空过滤：readIds 命中的忽略；dateKey ≤ clearedDateKey 的忽略。 */
export function visibleNotifications(
  items: NotificationItem[],
  readIds: string[],
  clearedDateKey: string | undefined,
): NotificationItem[] {
  const read = new Set(readIds)
  return items.filter((item) => {
    if (read.has(item.id)) return false
    if (clearedDateKey && item.dateKey <= clearedDateKey) return false
    return true
  })
}
