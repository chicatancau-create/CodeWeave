import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * 桌面端自带端口。刻意与浏览器端那台服务的 4173 分开：两端各自跑一台后端、
 * 各用一份数据根，共用端口的话只能开一个，而且后起的那一端会读到前一端的账户与进度。
 * 这是**固定默认值**而不是冲突后改选——桌面版仍然拒绝静默换端口（换端口等于换一份浏览器存储）。
 */
export const DESKTOP_DEFAULT_PORT = 4273

export function isWorkspace(directory) {
  try {
    return statSync(directory).isDirectory() && existsSync(join(directory, 'config', 'codeweave.config.example.json'))
  } catch {
    return false
  }
}

/** Explicit choices are never silently replaced by an empty workspace. */
export function findWorkspace({ explicit, saved, packaged, sourceRoot, portableDirectory, executable, cwd }) {
  const chosen = explicit || saved
  if (chosen) {
    const result = resolve(chosen)
    if (!isWorkspace(result)) throw new Error(`所选工作目录不可用：${result}。请在“文件 → 选择工作目录”中重新选择。`)
    return result
  }
  if (!packaged && isWorkspace(sourceRoot)) return sourceRoot
  const bases = [portableDirectory, dirname(executable), cwd].filter(Boolean)
  for (const base of bases) {
    for (const candidate of [base, join(base, 'workspace'), resolve(base, '..', 'workspace')]) {
      if (isWorkspace(candidate)) return resolve(candidate)
    }
  }
  return null
}

export function parseOptions(args) {
  const value = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
  const text = value('desktop-port')
  if (text && (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > 65535)) {
    throw new Error('--desktop-port 必须是 1–65535 之间的整数。')
  }
  return { workspace: value('workspace'), port: text ? Number(text) : undefined }
}

export function readDesktopSettings(file) {
  if (!existsSync(file)) return {}
  const value = JSON.parse(readFileSync(file, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value.workspace !== undefined && typeof value.workspace !== 'string')) {
    throw new Error('桌面工作目录配置格式无效，请从文件菜单重新选择工作目录。')
  }
  return value
}

export function isAllowedNavigation(url, origin) {
  try {
    return new URL(url).origin === origin
  } catch {
    return false
  }
}

export function isExternalWebUrl(url) {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

export async function probeHealth(origin) {
  try {
    const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(900) })
    if (!response.ok) return null
    // 成功响应统一是 `{ data: ... }` 信封（sendJson），project/instanceId/buildId 在信封里面；
    // 没有 data 也当成「端口上有个不报本项目身份的服务」，好让上层给出端口冲突而不是静默再起一个。
    const payload = await response.json()
    return payload?.data ?? payload ?? null
  } catch {
    return null
  }
}

export function matchesBuild(actual, expected) {
  return actual?.project === expected.project && actual?.instanceId === expected.instanceId && actual?.buildId === expected.buildId
}
