import { useEffect, useState } from 'react'

const REDUCE_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** 系统「减少动效」偏好。非浏览器环境与 jsdom（不实现 matchMedia）按「不减少」处理。 */
function systemReduceMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(REDUCE_MOTION_QUERY).matches
}

/**
 * §5.3 第 3 条把两条来源并列写进同一句：「尊重系统偏好及现有『减少动效』设置」。
 * CSS 那半边由 `.reduce-motion` 根类与媒体查询两道开关承担；**JS 侧的持续动作问不到它们**——
 * 定时器驱动的时间线（运行播放头就是）只能问这里。auth-view 的场景动效另有「用户暂停 /
 * 页面后台」两条路径，那是它自己的语义，不并进这个通用信号。
 */
export function useReducedMotion(settingsReduce: boolean): boolean {
  const [system, setSystem] = useState(systemReduceMotion)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(REDUCE_MOTION_QUERY)
    const onChange = (event: MediaQueryListEvent) => setSystem(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return settingsReduce || system
}
