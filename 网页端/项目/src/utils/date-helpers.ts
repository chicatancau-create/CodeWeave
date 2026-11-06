/** 本地日期工具：全部按系统本地时区计算，跨午夜由 App 的时钟刷新触发重算。 */

export function getLocalDateKey(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

/**
 * STAT-01：把 ISO 瞬间时间转成本地日期键。
 *
 * `iso.slice(0, 10)` 会把 UTC 日期当成当地日期，在 UTC+8 的凌晨或 UTC 负时区
 * 会整体偏一天。此处统一走 Date 解析后按本地时区归日。
 *
 * 已经是本地日期键（YYYY-MM-DD）的输入原样返回——**不能**再当 UTC 二次转换。
 * 无效输入返回 null，由调用方决定跳过或报告，而不是静默算成今天。
 */
export function toLocalDateKey(value: string | undefined | null): string | null {
  if (!value) return null
  // 已是本地日期键：原样返回，避免二次时区转换。
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return getLocalDateKey(parsed)
}

export function formatLocalDate(date = new Date()): string {
  return date.toLocaleDateString('zh-CN', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

/** 读取本地存储中的打卡日期，容忍非法 JSON 与非法条目。 */
export function readCheckinDates(key = 'code-canvas.checkin.v1'): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? '[]')
    if (Array.isArray(stored)) {
      return stored
        .filter((item): item is string => typeof item === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item))
        .sort()
    }
    if (typeof stored === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(stored)) return [stored]
  } catch {
    return []
  }
  return []
}

/** 连续打卡天数：从今天（或昨天）往回数连续记录。 */
export function countStreak(dates: string[], todayKey = getLocalDateKey()): number {
  const set = new Set(dates)
  let cursor = todayKey
  if (!set.has(cursor)) {
    cursor = shiftDateKey(cursor, -1)
    if (!set.has(cursor)) return 0
  }
  let streak = 0
  while (set.has(cursor) && streak < 3650) {
    streak += 1
    cursor = shiftDateKey(cursor, -1)
  }
  return streak
}

export function shiftDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  if (!y || !m || !d) return dateKey
  const date = new Date(y, m - 1, d + days)
  return getLocalDateKey(date)
}

/** 构建某年某月的日历网格：前置空位 + 每天日期键。周从周一开始。 */
export function buildMonthGrid(year: number, month: number): (string | null)[] {
  const firstDay = new Date(year, month, 1)
  const leading = (firstDay.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (string | null)[] = Array.from({ length: leading }, () => null)
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(getLocalDateKey(new Date(year, month, day)))
  }
  return cells
}
