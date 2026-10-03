/**
 * 实例与构建身份（03 号方案 §3 启动器和路径规则 + §5 运行和产品）。
 *
 * 启动器遇到端口上已有服务时，必须核对「这是不是本项目的这个实例」，
 * 不能把任意返回 200 的 `/api/health` 当成本项目；因此身份值只由本机路径与
 * 构建产物决定，不引入需要保密的凭据，也不对外暴露绝对路径。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, normalize } from 'node:path'

export const PROJECT_KEY = 'CodeWeave'

/** dist 未构建时为 'absent'；构建后随引用的产物名变化，用于判定「是不是同一份构建」。 */
export function distBuildId(distDir) {
  let html
  try {
    html = readFileSync(join(distDir, 'index.html'), 'utf8')
  } catch {
    return 'absent'
  }
  const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]).sort().join('\n')
  if (!assets) return 'no-assets'
  return createHash('sha256').update(assets).digest('hex').slice(0, 12)
}

/**
 * 同一台机器上区分实例：数据目录。端口不入身份——换端口属同一份数据，
 * 而入锁的文件已经是按数据目录判定的（`dataRoot/.server.lock`），两者口径一致。
 */
export function instanceIdentity({ dataDir, distDir }) {
  const normalizedPath = normalize(dataDir).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return {
    project: PROJECT_KEY,
    instanceId: createHash('sha256').update(normalizedPath).digest('hex').slice(0, 16),
    buildId: distBuildId(distDir),
  }
}

/** 探针响应是否就是本项目本实例（版本字段缺失一律判否）。 */
export function matchesInstance(payload, expected) {
  if (!payload || typeof payload !== 'object') return false
  return payload.project === expected.project && payload.instanceId === expected.instanceId
}
