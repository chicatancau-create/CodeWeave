/**
 * renderer 侧可见的本机 API 约定（分离方案 §7.2 第四条：把本机 API origin 注入 renderer）。
 *
 * 这里**只有常量与判据**，不读文件、不碰 Node——renderer 通过主进程注入的查询参数拿到 origin，
 * 再靠这份判据校验「我确实只在 loopback 上发请求」。renderer 永远拿不到文件系统能力。
 */

export const LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', 'localhost', '[::1]'])

/** 只允许 http(s) + loopback 主机 + 可选端口，且不带路径。 */
export function isLoopbackOrigin(value) {
  try {
    const url = new URL(String(value))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    if (!LOOPBACK_HOSTS.includes(url.hostname)) return false
    if (url.pathname !== '/' && url.pathname !== '') return false
    if (url.username || url.password) return false
    return true
  } catch {
    return false
  }
}

/**
 * 从窗口 URL 的查询参数里取注入进来的 origin。
 * 刻意要求显式带参：缺参就报错而不是猜 4173——桌面端与网页端消费同一份契约，
 * 端口由本机服务解析决定，写死就等于对着另一台服务排查（§6.2、ENV-01 §2）。
 */
export function readInjectedApiOrigin(search) {
  const params = new URLSearchParams(search ?? '')
  const origin = String(params.get('apiOrigin') ?? '').trim()
  if (!origin) {
    throw new Error('renderer 没有被注入 apiOrigin：主进程必须显式传本机服务地址，端侧不猜端口。')
  }
  if (!isLoopbackOrigin(origin)) {
    throw new Error(`注入的 apiOrigin 不是 loopback 地址：${origin}`)
  }
  return origin
}
