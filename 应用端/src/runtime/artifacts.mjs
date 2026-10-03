/**
 * 桌面端运行时的两个**发布产物**目录（分离方案 §5 禁止项倒数第二条、§9 阶段 D 第三条）。
 *
 * 旧实现会从工作区路径拼接服务入口与静态目录，主进程因此知道另一个产品的源码布局。
 * 现在只有两种合法来源：
 *   - 打包后：`<resourcesPath>/runtime`（后端运行时产物）与 `<resourcesPath>/renderer`（网页端产物）；
 *   - 开发态：必须由环境变量显式指出，**不猜、不回落到任何源码相对路径**。
 * 找不到就是明确报错，让人去跑发布命令，而不是静默用另一份代码。
 */
import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DESKTOP_DEFAULT_PORT } from './runtime.mjs'

export const BACKEND_ENTRY_REL = join('backend', 'server.mjs')
export const RENDERER_ENTRY = 'index.html'

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** 后端运行时产物：目录里必须真的能拿到 server.mjs 与配置解析器。 */
export function resolveBackendRuntime({ packaged, resourcesPath, env = process.env }) {
  const dir = packaged
    ? join(resourcesPath, 'runtime')
    : String(env.CODEWEAVE_DESKTOP_RUNTIME ?? '').trim()
  if (!dir) {
    throw new Error(
      '找不到后端运行时产物。开发态请设置 CODEWEAVE_DESKTOP_RUNTIME 指向 '
        + '网页项目发布出来的 runtime 目录（命令见本包 README），'
        + '桌面端不会去猜兄弟工程的源码路径。',
    )
  }
  const abs = resolve(dir)
  if (!isDirectory(abs)) throw new Error(`后端运行时产物目录不存在：${abs}`)
  for (const rel of [BACKEND_ENTRY_REL, join('backend', 'server', 'config.mjs'), join('backend', 'server', 'instance.mjs')]) {
    if (!existsSync(join(abs, rel))) throw new Error(`后端运行时产物不完整，缺 ${rel}：${abs}`)
  }
  return abs
}

/** 网页端产物：一个已构建的静态目录，不是源码相对路径。 */
export function resolveRendererArtifact({ packaged, resourcesPath, env = process.env }) {
  const dir = packaged
    ? join(resourcesPath, 'renderer')
    : String(env.CODEWEAVE_DESKTOP_RENDERER ?? '').trim()
  if (!dir) {
    throw new Error(
      '找不到网页端发布产物。开发态请设置 CODEWEAVE_DESKTOP_RENDERER 指向 '
        + '网页项目构建出来的 dist 目录（命令见本包 README）。',
    )
  }
  const abs = resolve(dir)
  if (!existsSync(join(abs, RENDERER_ENTRY))) {
    throw new Error(`网页端发布产物缺 ${RENDERER_ENTRY}，这份产物不可用：${abs}`)
  }
  return abs
}

/** 组装成本包要注入给后端进程的环境：产物路径显式传下去，不靠后端自己找。 */
export function desktopRuntimeEnv({ backendRuntime, rendererArtifact, dataWorkspace, vaultRoot, port, base = process.env }) {
  const explicit = port === undefined || port === null || String(port).trim() === '' ? '' : String(port)
  return {
    ...base,
    CODEWEAVE_PROJECT_ROOT: backendRuntime,
    CODEWEAVE_STATIC_DIR: rendererArtifact,
    CODE_CANVAS_DATA_DIR: dataWorkspace,
    CODEWEAVE_VAULT_ROOT: vaultRoot,
    CODE_CANVAS_NO_OPEN: '1',
    CODE_CANVAS_QUIET_LOGS: '1',
    // 端口必须显式给出：留空会落到后端解析器的工程默认 4173，而 4173 是浏览器端那台服务的端口，
    // 两端共用一个端口就只能开一个；`String(undefined)` 更会把 'undefined' 当端口值判非法。
    // 同样不继承 shell 的 PORT——桌面版拒绝任何静默换端口。
    PORT: explicit || String(DESKTOP_DEFAULT_PORT),
  }
}
