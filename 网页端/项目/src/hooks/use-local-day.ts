import { useEffect, useState } from 'react'
import { getLocalDateKey } from '../utils/date-helpers'

/** Learning schedules need a new date at midnight, without repainting the shell every tick. */
export function useLocalDay() {
  const [day, setDay] = useState(() => new Date())
  useEffect(() => {
    const refresh = () => {
      const next = new Date()
      setDay((current) => getLocalDateKey(current) === getLocalDateKey(next) ? current : next)
    }
    const timer = window.setInterval(refresh, 30_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  return day
}
