import { useCallback } from 'react'
import type { Challenge, ChallengeProgressStatus, ChallengeRecord, ChallengeSubmission } from '../types/lesson'
import { isPassedRecord, isPassedStatus } from '../types/lesson'
import { scopedKey, STORAGE_KEYS } from '../utils/constants'
import { countPassedChallenges } from '../utils/analytics'
import { useLocalStorage } from './use-local-storage'

export type ChallengeProgress = Record<string, ChallengeRecord>

const VALID_STATUS: ChallengeProgressStatus[] = ['none', 'submitted', 'verified', 'passed', 'rejected']

function normalizeStatus(value: unknown): ChallengeProgressStatus | undefined {
  return typeof value === 'string' && (VALID_STATUS as string[]).includes(value)
    ? (value as ChallengeProgressStatus)
    : undefined
}

export function validateProgress(value: unknown): ChallengeProgress | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const next: ChallengeProgress = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    // v1 时代是布尔值，迁移为带时间戳的记录；旧数据视为已通过。
    if (typeof item === 'boolean' && item) {
      next[key] = { completedAt: '迁移自旧版本', evidence: '', status: 'passed' }
      continue
    }
    if (typeof item === 'object' && item !== null && typeof (item as ChallengeRecord).completedAt === 'string') {
      const record = item as ChallengeRecord
      next[key] = { ...record, status: normalizeStatus(record.status) ?? 'passed' }
    }
  }
  return next
}

/**
 * 挑战进度：按账户作用域隔离，键为 challenge.id。
 *
 * R4 状态机：
 * - 本机可验证（沙箱 / 教学运行器）且输出与验收点一致 → `passed`
 * - 外部环境实验 → `submitted`（待人工确认），**不会自动进入已通过**
 * - 其他 → `rejected`
 *
 * 只有 `passed` / `verified` 计入完成数与掌握度；`submitted` 单独展示为待确认。
 */
export function useChallengeProgress(scope: string | undefined) {
  const [progress, setProgress] = useLocalStorage<ChallengeProgress>(
    scopedKey(STORAGE_KEYS.CHALLENGES, scope),
    {},
    { validate: validateProgress },
  )

  const applySubmission = useCallback(
    (submission: ChallengeSubmission) => {
      const status = submission.status
      if (status === 'none') return
      setProgress((current) => {
        const previous = current[submission.challengeId]
        // 已人工确认的记录不被后续提交降级，避免证据被覆盖丢失。
        if (previous?.status === 'verified' && status === 'submitted') return current
        if (isPassedStatus(previous?.status) && status === 'submitted') return current
        return {
          ...current,
          [submission.challengeId]: {
            completedAt: new Date().toISOString(),
            evidence: submission.evidence || submission.output.join(' | '),
            status,
            tier: submission.tier,
            // CHAL-02 第 7 条：口径随记录留档，旧记录缺字段由界面标注为旧版记录。
            ...(submission.judgeMode ? { judgeMode: submission.judgeMode } : {}),
            ...(submission.observation ? { observation: submission.observation } : {}),
          },
        }
      })
    },
    [setProgress],
  )

  /** 人工确认外部证据（R4）：只有显式确认才把 submitted 提升为 verified。 */
  const verifySubmission = useCallback(
    (challengeId: string, observation?: ChallengeRecord['observation']) => {
      setProgress((current) => {
        const previous = current[challengeId]
        if (!previous || previous.status !== 'submitted') return current
        return {
          ...current,
          [challengeId]: {
            ...previous,
            status: 'verified',
            ...(observation ? { observation } : {}),
          },
        }
      })
    },
    [setProgress],
  )

  /** 标记不通过（人工复核或复测失败）。 */
  const rejectSubmission = useCallback(
    (challengeId: string) => {
      setProgress((current) => {
        const previous = current[challengeId]
        if (!previous) return current
        return { ...current, [challengeId]: { ...previous, status: 'rejected' } }
      })
    },
    [setProgress],
  )

  /**
   * STAT-01 第 5 条：单条判断复用统计那一个口径（`isPassedRecord`），本 hook 不再自带比较式。
   *
   * 说清楚差别有多大：`validateProgress` 会把缺 `status` 的记录补成 `'passed'`
   * （`:29`），所以**今天**这份数据里两种写法结果相同；改版前这里是
   * `isPassedStatus(progress[id]?.status)`——那是全站唯一的第二套「通过」定义，
   * 一旦校验放松（旧裸记录带 `completedAt` 而无 `status` 直接进内存），
   * 「已通过 N 关」与「这一关打不打勾」就会当场分家。
   */
  const isCompleted = useCallback(
    (challenge: Challenge) => isPassedRecord(progress[challenge.id]),
    [progress],
  )

  const isSubmitted = useCallback(
    (challenge: Challenge) => progress[challenge.id]?.status === 'submitted',
    [progress],
  )

  /**
   * STAT-01 第 5 条：挑战通过数全库只许一个口径 —— 复用 `countPassedChallenges`，本 hook 不再自带判断。
   *
   * 改版前这里自己数一遍 `isPassedStatus(record?.status)`，与统计侧规定的 `isPassedRecord`
   * （缺 `status` 按迁移语义视为已通过，`types/lesson.ts:235-244`）是**两套并存的定义**。
   * 今天量不到差异：`validateProgress:29` 会把缺 `status` 的记录补成 `'passed'`，
   * 两种写法在这份数据上同解 —— 所以这不是「正在出错的缺陷」，而是删掉全站最后一套自写判断。
   * 顺带一条待查：既然缺 `status` 进不了内存，`legacy` 这一桶在现役写入路径上是否恒为 0，
   * 本轮只读到校验函数、没有构造数据实测，不写成结论。
   */
  const passedCounts = countPassedChallenges(progress)
  const completedCount = passedCounts.passed + passedCounts.legacy
  const pendingVerifyCount = passedCounts.pendingVerify

  return {
    progress,
    completedCount,
    pendingVerifyCount,
    isCompleted,
    isSubmitted,
    applySubmission,
    verifySubmission,
    rejectSubmission,
  }
}
