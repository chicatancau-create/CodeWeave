/**
 * 界面当前跑在哪个面上：桌面壳（Electron）还是浏览器。
 *
 * 两端消费同一份产物、同一套同源相对路径，页面里唯一可靠的区分依据是宿主运行时自己声明的
 * 身份：Electron 会在 UA 里追加 `Electron/<版本>`，普通浏览器不会。
 * 判不出来就按浏览器写——宁可把桌面窗口标成 WEB，也不要在浏览器里谎称 DESKTOP。
 */
export type Surface = 'desktop' | 'web'

export const SURFACE_LABEL: Record<Surface, string> = {
  desktop: 'DESKTOP',
  web: 'WEB',
}

export function resolveSurface(userAgent: string): Surface {
  return /(?:^|\s)Electron\//.test(userAgent) ? 'desktop' : 'web'
}

/** 模块加载时定一次：页面后续怎么改 URL 都不影响已经确定的运行面。 */
export const currentSurface: Surface = resolveSurface(typeof navigator === 'undefined' ? '' : navigator.userAgent)
