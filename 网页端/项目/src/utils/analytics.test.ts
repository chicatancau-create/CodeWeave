import { describe, expect, it } from 'vitest'
import { computeWeeklyStats } from './analytics'
import { getLocalDateKey, shiftDateKey, toLocalDateKey } from './date-helpers'
import type { MasteryEvidence, MasteryRecord } from '../data/mastery'
import type { ChallengeRecord } from '../types/lesson'

const record = (refId: string, evidences: { kind: 'lesson' | 'review'; at: string; passed: boolean }[]): MasteryRecord => ({
  refId,
  kind: 'lesson',
  level: 1,
  evidence: evidences.map((e, i) => ({ id: `e-${i}`, refId, note: '', ...e })),
  updatedAt: evidences[0]?.at ?? '',
  reviewStep: 0,
})

/** 允许课程/挑战/复测/Bug 修复四类证据，用于跨类型去重口径测试。 */
const recordOf = (refId: string, kind: MasteryRecord['kind'], evidences: MasteryEvidence[]): MasteryRecord => ({
  refId,
  kind,
  level: 1,
  evidence: evidences,
  updatedAt: evidences[0]?.at ?? '',
  reviewStep: 0,
})

const evidenceOf = (
  refId: string,
  kind: MasteryEvidence['kind'],
  at: string,
  passed: boolean,
): MasteryEvidence => ({ id: `${refId}-${kind}-${at}`, kind, refId, note: '', at, passed })

const challenge = (completedAt: string, status?: ChallengeRecord['status']): ChallengeRecord => ({
  completedAt,
  evidence: '',
  ...(status ? { status } : {}),
})

describe('computeWeeklyStats（F5 学习分析）', () => {
  const todayKey = '2026-09-13'

  it('只统计近 7 天内的证据', () => {
    const stats = computeWeeklyStats({
      masteryRecords: [
        record('a', [
          { kind: 'lesson', at: '2026-09-13T08:00:00.000Z', passed: true },
          { kind: 'lesson', at: '2026-09-01T08:00:00.000Z', passed: true }, // 窗口外
        ]),
      ],
      challengeRecords: {
        // STAT-01：无 status 的历史记录按旧版迁移语义单列为 challengesLegacyPassed，
        // 不再混入 challengesPassed（后者只认 passed / verified）。
        s1: { completedAt: '2026-09-12T08:00:00.000Z', evidence: '' },
        s2: { completedAt: '2026-08-12T08:00:00.000Z', evidence: '' }, // 窗口外
      },
      todayKey,
    })
    expect(stats.lessonsCompleted).toBe(1)
    expect(stats.challengesPassed).toBe(0)
    expect(stats.challengesLegacyPassed).toBe(1)
    expect(stats.periodStartKey).toBe('2026-09-07')
  })

  it('复测完成率 = 通过/(通过+未通过)；无复测为 null', () => {
    const stats = computeWeeklyStats({
      masteryRecords: [
        record('a', [
          { kind: 'review', at: '2026-09-13T08:00:00.000Z', passed: true },
          { kind: 'review', at: '2026-09-13T09:00:00.000Z', passed: true },
          { kind: 'review', at: '2026-09-13T10:00:00.000Z', passed: false },
        ]),
      ],
      challengeRecords: {},
      todayKey,
    })
    expect(stats.reviewsPassed).toBe(2)
    expect(stats.reviewsFailed).toBe(1)
    expect(stats.reviewRate).toBe(67)

    const empty = computeWeeklyStats({ masteryRecords: [], challengeRecords: {}, todayKey })
    expect(empty.reviewRate).toBeNull()
  })
})

/**
 * STAT-01：日期口径与统计口径统一。
 *
 * 旧实现用 `iso.slice(0, 10)` 取日期键，等于把 UTC 日期当作当地日期：
 * - UTC+8 的凌晨（当地已是次日、UTC 仍是前一日）会漏统计；
 * - UTC 负时区的深夜（当地仍是当日、UTC 已是次日）会多统计一天。
 * 正确口径是 `getLocalDateKey(new Date(iso))`，且已经是本地日期键的输入不得二次转换。
 *
 * 断言不写死期望字符串，而是与该时刻的真实本地日期比较——
 * 这样用例在任意时区运行都成立，且确实能捕获 slice 口径的时区漂移。
 */
describe('STAT-01 日期口径：ISO 瞬间按本地时区归日', () => {
  it('toLocalDateKey 把 ISO 瞬间转成本地日期键，而非 UTC 日期', () => {
    const iso = '2026-09-12T18:30:00.000Z'
    const localKey = getLocalDateKey(new Date(iso))
    expect(toLocalDateKey(iso)).toBe(localKey)
  })

  it('toLocalDateKey 对已是本地日期键的输入原样返回（不二次时区转换）', () => {
    expect(toLocalDateKey('2026-09-13')).toBe('2026-09-13')
  })

  it('toLocalDateKey 对空值与非法输入返回 null，不静默算成今天', () => {
    expect(toLocalDateKey(undefined)).toBeNull()
    expect(toLocalDateKey(null)).toBeNull()
    expect(toLocalDateKey('')).toBeNull()
    expect(toLocalDateKey('not-a-date')).toBeNull()
  })

  /**
   * 把某个本地日期键转成“该日当地 00:30”的 ISO 瞬间。
   *
   * 换算依据 `getTimezoneOffset()`：它返回「UTC − 本地」的分钟数（东正时区为负数）。
   * 因此本地 D 日 00:30 对应的 UTC 毫秒 = UTC(D 日 00:00) + 30 分钟 + offset。
   *
   * 这类瞬间正是旧口径出错的场合：本地已是 D 日，UTC 日期却仍是 D−1 日。
   */
  function localHalfPastMidnight(dateKey: string): string {
    const probe = new Date(`${dateKey}T12:00:00.000Z`)
    const offsetMinutes = probe.getTimezoneOffset()
    const [year, month, day] = dateKey.split('-').map(Number)
    const utcMidnightMs = Date.UTC(year!, month! - 1, day!)
    return new Date(utcMidnightMs + 30 * 60_000 + offsetMinutes * 60_000).toISOString()
  }

  it('时区可移植性：跨窗口边界的证据按本地日期归日，不被 UTC 日期挤出窗口', () => {
    const todayKey = getLocalDateKey(new Date())
    const startKey = shiftDateKey(todayKey, -6)
    // 取窗口首日（第 7 天前）的当地 00:30：旧口径会把它的 UTC 日期算成窗口前一天而漏统计。
    const at = localHalfPastMidnight(startKey)

    // 前置断言：确认这个瞬间确实能区分两种口径，否则用例本身无效。
    expect(getLocalDateKey(new Date(at))).toBe(startKey)
    expect(at.slice(0, 10)).not.toBe(startKey)

    const stats = computeWeeklyStats({
      masteryRecords: [recordOf('a', 'lesson', [evidenceOf('a', 'lesson', at, true)])],
      challengeRecords: {},
      todayKey,
    })
    expect(stats.lessonsCompleted).toBe(1)
    expect(stats.lessonPracticeCount).toBe(1)
  })

  it('时区可移植性：挑战记录窗口判断同样按本地日期', () => {
    const todayKey = getLocalDateKey(new Date())
    const startKey = shiftDateKey(todayKey, -6)
    const at = localHalfPastMidnight(startKey)
    expect(getLocalDateKey(new Date(at))).toBe(startKey)
    expect(at.slice(0, 10)).not.toBe(startKey)

    const stats = computeWeeklyStats({
      masteryRecords: [],
      challengeRecords: { c1: challenge(at, 'passed') },
      todayKey,
    })
    expect(stats.challengesPassed).toBe(1)
  })
})

describe('STAT-01 挑战通过口径：仅 passed / verified 计入', () => {
  const todayKey = '2026-09-13'
  const completedAt = '2026-09-12T08:00:00.000Z'

  it('submitted / rejected / none 不计入“挑战通过”', () => {
    const stats = computeWeeklyStats({
      masteryRecords: [],
      challengeRecords: {
        passed: challenge(completedAt, 'passed'),
        verified: challenge(completedAt, 'verified'),
        submitted: challenge(completedAt, 'submitted'),
        rejected: challenge(completedAt, 'rejected'),
        none: challenge(completedAt, 'none'),
      },
      todayKey,
    })
    expect(stats.challengesPassed).toBe(2)
  })

  it('未带 status 的历史记录按旧版迁移语义视为已通过，并单独计数', () => {
    const stats = computeWeeklyStats({
      masteryRecords: [],
      challengeRecords: {
        legacy: challenge(completedAt),
        legacyOutOfWindow: challenge('2026-08-01T08:00:00.000Z'),
      },
      todayKey,
    })
    // 旧版记录不混入 challengesPassed（该口径只认 passed / verified）……
    expect(stats.challengesPassed).toBe(0)
    // ……而是单列为旧版通过，便于界面如实标注来源。
    expect(stats.challengesLegacyPassed).toBe(1)
  })

  it('窗口外的通过记录不计入', () => {
    const stats = computeWeeklyStats({
      masteryRecords: [],
      challengeRecords: { old: challenge('2026-08-12T08:00:00.000Z', 'passed') },
      todayKey,
    })
    expect(stats.challengesPassed).toBe(0)
    expect(stats.challengesLegacyPassed).toBe(0)
  })
})

describe('STAT-01 完成课程去重：按 lessonId 计一次', () => {
  const todayKey = '2026-09-13'

  it('同一 lessonId 的多条通过证据只计 1 个完成单元', () => {
    const stats = computeWeeklyStats({
      masteryRecords: [
        recordOf('a', 'lesson', [
          evidenceOf('a', 'lesson', '2026-09-11T08:00:00.000Z', true),
          evidenceOf('a', 'lesson', '2026-09-12T08:00:00.000Z', true),
          evidenceOf('a', 'lesson', '2026-09-13T08:00:00.000Z', true),
        ]),
      ],
      challengeRecords: {},
      todayKey,
    })
    expect(stats.lessonsCompleted).toBe(1)
    // 重复练习次数单独命名，不与“完成单元数”混用同一口径。
    expect(stats.lessonPracticeCount).toBe(3)
  })

  it('未通过的课程证据不计入完成单元，但计入练习次数', () => {
    const stats = computeWeeklyStats({
      masteryRecords: [recordOf('a', 'lesson', [evidenceOf('a', 'lesson', '2026-09-13T08:00:00.000Z', false)])],
      challengeRecords: {},
      todayKey,
    })
    expect(stats.lessonsCompleted).toBe(0)
    expect(stats.lessonPracticeCount).toBe(1)
  })

  it('多个 lessonId 分别计入', () => {
    const stats = computeWeeklyStats({
      masteryRecords: [
        recordOf('a', 'lesson', [evidenceOf('a', 'lesson', '2026-09-13T08:00:00.000Z', true)]),
        recordOf('b', 'lesson', [evidenceOf('b', 'lesson', '2026-09-13T09:00:00.000Z', true)]),
      ],
      challengeRecords: {},
      todayKey,
    })
    expect(stats.lessonsCompleted).toBe(2)
    expect(stats.lessonPracticeCount).toBe(2)
  })

  it('课程窗口外的证据既不进完成单元也不进练习次数', () => {
    const stats = computeWeeklyStats({
      masteryRecords: [recordOf('a', 'lesson', [evidenceOf('a', 'lesson', '2026-08-01T08:00:00.000Z', true)])],
      challengeRecords: {},
      todayKey,
    })
    expect(stats.lessonsCompleted).toBe(0)
    expect(stats.lessonPracticeCount).toBe(0)
  })

  it('课程口径与挑战口径互不串用：challenge 类证据不计入课程单元', () => {
    const stats = computeWeeklyStats({
      masteryRecords: [
        recordOf('c1', 'challenge', [evidenceOf('c1', 'challenge', '2026-09-13T08:00:00.000Z', true)]),
      ],
      challengeRecords: {},
      todayKey,
    })
    expect(stats.lessonsCompleted).toBe(0)
    expect(stats.lessonPracticeCount).toBe(0)
  })
})

describe('STAT-01 复测口径独立：通过率与到期任务完成率分开', () => {
  const todayKey = '2026-09-13'

  it('复测通过率只由 review 证据决定，与课程完成数无关', () => {
    const stats = computeWeeklyStats({
      masteryRecords: [
        recordOf('a', 'lesson', [evidenceOf('a', 'lesson', '2026-09-13T08:00:00.000Z', true)]),
        recordOf('a', 'review', [
          evidenceOf('a', 'review', '2026-09-13T09:00:00.000Z', true),
          evidenceOf('a', 'review', '2026-09-13T10:00:00.000Z', false),
        ]),
      ],
      challengeRecords: {},
      todayKey,
    })
    expect(stats.lessonsCompleted).toBe(1)
    expect(stats.reviewsPassed).toBe(1)
    expect(stats.reviewsFailed).toBe(1)
    expect(stats.reviewRate).toBe(50)
  })

  it('复测通过率取整到百分位，全通过为 100', () => {
    const stats = computeWeeklyStats({
      masteryRecords: [
        recordOf('a', 'review', [
          evidenceOf('a', 'review', '2026-09-13T09:00:00.000Z', true),
          evidenceOf('a', 'review', '2026-09-13T10:00:00.000Z', true),
        ]),
      ],
      challengeRecords: {},
      todayKey,
    })
    expect(stats.reviewRate).toBe(100)
  })

  it('无复测样本时通过率为 null，且窗口外复测不计入', () => {
    const stats = computeWeeklyStats({
      masteryRecords: [recordOf('a', 'review', [evidenceOf('a', 'review', '2026-08-01T09:00:00.000Z', true)])],
      challengeRecords: {},
      todayKey,
    })
    expect(stats.reviewsPassed).toBe(0)
    expect(stats.reviewsFailed).toBe(0)
    expect(stats.reviewRate).toBeNull()
  })

  it('空样本：所有计数为 0、通过率为 null，周期键仍然正确', () => {
    const stats = computeWeeklyStats({ masteryRecords: [], challengeRecords: {}, todayKey })
    expect(stats.lessonsCompleted).toBe(0)
    expect(stats.lessonPracticeCount).toBe(0)
    expect(stats.challengesPassed).toBe(0)
    expect(stats.challengesLegacyPassed).toBe(0)
    expect(stats.reviewRate).toBeNull()
    expect(stats.periodStartKey).toBe('2026-09-07')
    expect(stats.todayKey).toBe(todayKey)
  })
})
