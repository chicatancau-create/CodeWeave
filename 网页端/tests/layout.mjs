/**
 * 网页端测试侧的定位层（与后端包 `tests/layout.mjs` 同职责，但只指向**网页端自己**与共享契约）。
 *
 * 测试只通过本项目根定位源码和版本化契约，避免测试重新依赖工作区兄弟目录。
 *
 * §5 的边界口径（本层存在的意义）：
 * - 网页端测试读**网页端源码**是同侧读取，合法；
 * - 网页端测试读本项目 `server/contracts/**` 的契约与脱敏 fixture，合法；不读运行数据；
 * - 桌面端不作为网页端测试的运行时或源码依赖。
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const here = import.meta.dirname

/** 网页端工程根：本目录自己的 `src/`。 */
const WEB_SOURCE_CANDIDATES = ['src']
const CONTRACTS_REL = join('server', 'contracts')

/** 从测试目录定位网页项目根，必须同时有本项目源码与契约目录。 */
function workspaceRoot() {
  let dir = here
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(dir, CONTRACTS_REL))) {
      if (WEB_SOURCE_CANDIDATES.some((candidate) => existsSync(join(dir, candidate)))) return dir
    }
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  throw new Error(
    `未能从 ${here} 定位工作区根：需要能找到 ${CONTRACTS_REL}，以及 ${WEB_SOURCE_CANDIDATES.join(' / ')} 之一。` +
      '',
  )
}

/** 网页端工程根。 */
export function webRoot() {
  const root = workspaceRoot()
  if (!existsSync(join(root, 'src'))) throw new Error(`网页端源码目录不存在：${resolve(root, 'src')}`)
  return root
}

/** 相对网页端工程根取一个路径，如 `webScript('src/engine/javascript-sandbox.ts')`。 */
export function webScript(relativeFromWebRoot) {
  return join(webRoot(), ...String(relativeFromWebRoot).split('/'))
}

export async function importWebScript(relativeFromWebRoot) {
  return import(pathToFileURL(webScript(relativeFromWebRoot)).href)
}

/** 网页项目内版本化的共享契约，如 `contract('sandbox-rules.json')`。 */
export function contract(relativeFromContracts) {
  return join(workspaceRoot(), CONTRACTS_REL, ...String(relativeFromContracts).split('/'))
}

/** 兼容旧测试调用方：返回网页项目的父目录，不作为源码依赖。 */
export function workspace() {
  return resolve(workspaceRoot(), '..')
}
