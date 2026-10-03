import { useCallback, useMemo } from 'react'
import { countStreak, getLocalDateKey, shiftDateKey } from '../utils/date-helpers'
import { scopedKey, STORAGE_KEYS } from '../utils/constants'
import { useLocalStorage } from './use-local-storage'

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function validateDates(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string' && DATE_KEY_PATTERN.test(item))
}

/**
 * 每日打卡：按本地系统日期记录，跨午夜由外部传入的 now 触发重算；
 * 数据按账户作用域隔离。
 */
export function useCheckin(scope: string | undefined, now: Date) {
  const [checkinDates, setCheckinDates] = useLocalStorage<string[]>(
    scopedKey(STORAGE_KEYS.CHECKIN, scope),
    [],
    { validate: validateDates },
  )

  const todayKey = getLocalDateKey(now)
  const checkedIn = useMemo(() => checkinDates.includes(todayKey), [checkinDates, todayKey])
  const streak = useMemo(() => countStreak(checkinDates, todayKey), [checkinDates, todayKey])
  /** 已签到但可能断了连续（昨天未打卡），用于展示提示 */
  const streakAtRisk = useMemo(
    () => !checkedIn && streak === 0 && checkinDates.includes(shiftDateKey(todayKey, -2)),
    [checkedIn, streak, checkinDates, todayKey],
  )

  const handleCheckin = useCallback(() => {
    if (checkinDates.includes(todayKey)) return
    setCheckinDates((current) => [...current.filter((item) => DATE_KEY_PATTERN.test(item)), todayKey].sort())
  }, [checkinDates, todayKey, setCheckinDates])

  return {
    checkinDates: [...checkinDates].sort(),
    todayKey,
    checkedIn,
    streak,
    streakAtRisk,
    handleCheckin,
  }
}
