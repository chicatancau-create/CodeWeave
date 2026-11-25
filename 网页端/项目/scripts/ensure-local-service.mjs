import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { createConnection } from 'node:net'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { resolveRuntimePaths } from '../server/service/server/config.mjs'
import { instanceIdentity, matchesInstance } from '../server/service/server/instance.mjs'

const projectRoot = resolve(import.meta.dirname, '../server')
const runtime = resolveRuntimePaths({ startDir: projectRoot })
if (!runtime.configFile || runtime.conflicts.length) throw new Error('本机服务配置尚未就绪')
const expected = instanceIdentity({ dataDir: runtime.dataDir, distDir: runtime.staticDir })

async function matchesRunningService() {
  try {
    const response = await fetch(runtime.origin + '/api/health', { signal: globalThis.AbortSignal.timeout(800), redirect: 'error' })
    if (!response.ok) return false
    const payload = (await response.json()).data
    return payload?.status === 'ok' && matchesInstance(payload, expected) && payload.buildId === expected.buildId
  } catch {
    return false
  }
}

function portOpen() {
  return new Promise((done) => {
    const socket = createConnection({ host: runtime.host, port: runtime.port })
    function finish(isOpen) {
      socket.destroy()
      done(isOpen)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(400, () => finish(false))
  })
}

async function ensure() {
  if (await matchesRunningService()) return
  if (await portOpen()) throw new Error('本机配置端口已被其他进程或构建占用')
  const logDir = join(runtime.dataDir, 'logs')
  mkdirSync(logDir, { recursive: true })
  const log = openSync(join(logDir, 'service.log'), 'a')
  const environment = {
    ...process.env,
    CODEWEAVE_PROJECT_ROOT: projectRoot,
    CODE_CANVAS_NO_OPEN: '1',
    CODE_CANVAS_QUIET_LOGS: '1',
    CODEWEAVE_ALLOW_REGISTRATION: '0',
  }
  let child
  try {
    child = spawn(process.execPath, [join(projectRoot, 'service', 'server.mjs')], {
      cwd: projectRoot, detached: true, windowsHide: true, env: environment, stdio: ['ignore', log, log],
    })
    child.on('error', () => {})
    child.unref()
  } finally {
    closeSync(log)
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await matchesRunningService()) return
    await delay(200)
  }
  throw new Error('本机服务未就绪，请检查运行日志')
}

await ensure()
if (process.argv.includes('--open') && process.platform === 'win32') {
  const browser = spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'start', '', runtime.origin], {
    windowsHide: true, detached: true, stdio: 'ignore',
  })
  browser.unref()
}
console.log(runtime.origin)
