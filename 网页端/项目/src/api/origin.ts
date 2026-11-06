/**
 * API origin 的唯一来源（分离方案 §2：端口解析从后端配置文件挪到端侧配置）。
 *
 * 网页端**不再** import 后端的 `server/config.mjs`：那会让页面工程脱离后端目录就装不起来、
 * 类型检查跑不动（§10.2 的第一条门禁）。端侧也**不写死端口**（ENV-01 §2 原本就是这条禁令，
 * 只是过去靠「与后端共用一份解析」来满足它）——现在由启动器在拉起开发服务时把解析结果传进来：
 *
 *   1. `VITE_API_ORIGIN`        完整 origin，构建期与运行期都用它（生产与预览）
 *   2. `CODEWEAVE_DEV_API_ORIGIN` 开发代理目标（vite dev 专用，含义同上）
 *   3. `CODEWEAVE_DEV_API_PORT`   只给端口，主机沿用 `DEFAULT_API_HOST`
 *
 * 三者都没给就抛错。静默退回某个默认值，会让人对着另一台服务排查半天。
 */

/** 本机部署的主机名；这是协议常量不是端口，写死是安全的（§6.2 桌面端只允许 loopback）。 */
export const DEFAULT_API_HOST = '127.0.0.1'

const ORIGIN_PATTERN = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/
const PORT_PATTERN = /^\d{1,5}$/

export class ApiOriginError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApiOriginError'
  }
}

function trimmed(value: string | undefined): string {
  return String(value ?? '').trim()
}

/** 校验过的完整 origin；不合法就抛，不猜。 */
export function assertOrigin(raw: string, source: string): string {
  if (!ORIGIN_PATTERN.test(raw)) {
    throw new ApiOriginError(`${source} 需是 http(s)://host[:port] 且不带路径：${raw}`)
  }
  return raw
}

/**
 * 从一份环境变量集合里解析 API origin。参数显式传入而不是读全局 `process.env`：
 * 构建配置（Node 侧）与页面运行时（只有 `import.meta.env`）都要复用同一份判据。
 */
export function resolveApiOrigin(env: Record<string, string | undefined>): string {
  const buildOrigin = trimmed(env.VITE_API_ORIGIN)
  if (buildOrigin) return assertOrigin(buildOrigin, 'VITE_API_ORIGIN')

  const devOrigin = trimmed(env.CODEWEAVE_DEV_API_ORIGIN)
  if (devOrigin) return assertOrigin(devOrigin, 'CODEWEAVE_DEV_API_ORIGIN')

  const devPort = trimmed(env.CODEWEAVE_DEV_API_PORT)
  if (devPort) {
    if (!PORT_PATTERN.test(devPort)) throw new ApiOriginError(`CODEWEAVE_DEV_API_PORT 不是端口号：${devPort}`)
    const port = Number(devPort)
    if (port < 1 || port > 65_535) throw new ApiOriginError(`CODEWEAVE_DEV_API_PORT 超出范围：${devPort}`)
    return `http://${DEFAULT_API_HOST}:${port}`
  }

  throw new ApiOriginError(
    '没有给出 API origin。请用启动器拉起开发服务（它会把后端实际监听的端口传进来），'
      + '或显式设置 VITE_API_ORIGIN / CODEWEAVE_DEV_API_ORIGIN / CODEWEAVE_DEV_API_PORT 之一。'
      + '网页端刻意不写死默认端口：对着另一台服务排查比启动失败更费时间。',
  )
}
