import { useEffect, useState } from 'react'
import { formatLocalDate } from '../utils/date-helpers'

export function Clock({ name, stageCount, stageNote }: { name: string; stageCount: number; stageNote: string }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const hour = now.getHours()
  const greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'
  return (
    <div>
      <p className="welcome-greeting">
        {greeting}，{name}
        <span className="wave" aria-hidden="true">👋</span>
      </p>
      <p className="welcome-subtitle">
        {formatLocalDate(now)} · 学习计划共 {stageCount} 个阶段{stageNote}
      </p>
    </div>
  )
}
