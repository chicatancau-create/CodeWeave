/**
 * 打包输入与本机注入的验收（分离方案 §9 阶段 D、§10.1 最后一条、§10.3 的来源校验）。
 *
 * 用 node:test（本包不引测试框架；桌面侧要测的是纯路径与判据逻辑）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveBackendRuntime, resolveRendererArtifact, desktopRuntimeEnv } from '../src/runtime/artifacts.mjs'
import { DESKTOP_DEFAULT_PORT } from '../src/runtime/runtime.mjs'
import { isLoopbackOrigin, readInjectedApiOrigin } from '../src/api/loopback.mjs'

function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-desktop-artifacts-'))
  const cleanup = () => rmSync(dir, { recursive: true, force: true })
  return { dir, cleanup }
}

function makeBackendRuntime(base) {
  mkdirSync(join(base, 'backend', 'server', 'content'), { recursive: true })
  mkdirSync(join(base, 'config'), { recursive: true })
  writeFileSync(join(base, 'backend', 'server.mjs'), '', 'utf8')
  writeFileSync(join(base, 'backend', 'server', 'config.mjs'), '', 'utf8')
  writeFileSync(join(base, 'backend', 'server', 'instance.mjs'), '', 'utf8')
  writeFileSync(join(base, 'config', 'codeweave.config.example.json'), '{}', 'utf8')
  return base
}

test('开发态缺环境变量就明确报错，绝不回落到兄弟工程源码路径', () => {
  assert.throws(
    () => resolveBackendRuntime({ packaged: false, env: {} }),
    /找不到后端运行时产物|CODEWEAVE_DESKTOP_RUNTIME/,
  )
  assert.throws(
    () => resolveRendererArtifact({ packaged: false, env: {} }),
    /找不到网页端发布产物|CODEWEAVE_DESKTOP_RENDERER/,
  )
})

test('产物目录必须完整：缺 server.mjs / 缺 index.html 都拒绝', () => {
  const { dir, cleanup } = tempRoot()
  try {
    mkdirSync(join(dir, 'partial', 'backend'), { recursive: true })
    assert.throws(() => resolveBackendRuntime({ packaged: false, env: { CODEWEAVE_DESKTOP_RUNTIME: join(dir, 'partial') } }), /不存在|不完整/)
    makeBackendRuntime(join(dir, 'full'))
    assert.equal(resolveBackendRuntime({ packaged: false, env: { CODEWEAVE_DESKTOP_RUNTIME: join(dir, 'full') } }), join(dir, 'full'))
    mkdirSync(join(dir, 'renderer-empty'), { recursive: true })
    assert.throws(() => resolveRendererArtifact({ packaged: false, env: { CODEWEAVE_DESKTOP_RENDERER: join(dir, 'renderer-empty') } }), /缺 index\.html/)
    writeFileSync(join(dir, 'renderer-empty', 'index.html'), '<!doctype html>', 'utf8')
    assert.equal(resolveRendererArtifact({ packaged: false, env: { CODEWEAVE_DESKTOP_RENDERER: join(dir, 'renderer-empty') } }), join(dir, 'renderer-empty'))
  } finally {
    cleanup()
  }
})

test('打包后按 resourcesPath 定位两个产物，与开发态同一套判据', () => {
  const { dir, cleanup } = tempRoot()
  try {
    makeBackendRuntime(join(dir, 'runtime'))
    mkdirSync(join(dir, 'renderer'), { recursive: true })
    writeFileSync(join(dir, 'renderer', 'index.html'), '<!doctype html>', 'utf8')
    const backend = resolveBackendRuntime({ packaged: true, resourcesPath: dir, env: {} })
    assert.equal(backend, join(dir, 'runtime'))
    assert.equal(resolveRendererArtifact({ packaged: true, resourcesPath: dir, env: {} }), join(dir, 'renderer'))
  } finally {
    cleanup()
  }
})

test('注入给后端的环境：产物路径与数据根显式传下去，不静默开浏览器', () => {
  const env = desktopRuntimeEnv({
    backendRuntime: 'R:/runtime',
    rendererArtifact: 'R:/renderer',
    dataWorkspace: 'W:/workspace/data/runtime',
    vaultRoot: 'W:/workspace/data/knowledge/vault',
    port: 4280,
    base: { PATH: 'keepme', CODE_CANVAS_NO_OPEN: '0' },
  })
  assert.equal(env.CODEWEAVE_PROJECT_ROOT, 'R:/runtime')
  assert.equal(env.CODEWEAVE_STATIC_DIR, 'R:/renderer')
  assert.equal(env.CODE_CANVAS_DATA_DIR, 'W:/workspace/data/runtime')
  assert.equal(env.CODEWEAVE_VAULT_ROOT, 'W:/workspace/data/knowledge/vault')
  assert.equal(env.PORT, '4280')
  assert.equal(env.CODE_CANVAS_NO_OPEN, '1', '桌面端不许自己弹浏览器')
  assert.equal(env.CODE_CANVAS_QUIET_LOGS, '1')
  assert.equal(env.PATH, 'keepme', '必须继承真实环境而不是替换掉')
})

test('未显式指定端口时落到桌面端自己的端口，绝不与浏览器端共用 4173', () => {
  const env = desktopRuntimeEnv({
    backendRuntime: 'R:/runtime',
    rendererArtifact: 'R:/renderer',
    dataWorkspace: 'W:/workspace/data/runtime',
    vaultRoot: 'W:/workspace/data/knowledge/vault',
    port: undefined,
    base: { PATH: 'keepme', PORT: '3000' },
  })
  assert.equal(env.PORT, String(DESKTOP_DEFAULT_PORT))
  assert.notEqual(env.PORT, '4173', '4173 是浏览器端那台服务的端口，两端共用就开不了两个')
  assert.equal(env.PATH, 'keepme')
  assert.match(env.PORT, /^\d+$/, '端口必须是真数字，不能是 undefined 这种字符串')
})

test('renderer 只能拿到 loopback 的 http(s) origin，且必须显式注入', () => {
  for (const good of ['http://127.0.0.1:4173', 'http://localhost:5173', 'https://127.0.0.1', 'http://[::1]:4173']) {
    assert.equal(isLoopbackOrigin(good), true, good)
  }
  for (const bad of [
    'http://10.0.0.5:4173',
    'http://evil.example',
    'http://127.0.0.1:4173/api',
    'file:///C:/x',
    'http://user:pass@127.0.0.1:4173',
    '',
    'not a url',
  ]) {
    assert.equal(isLoopbackOrigin(bad), false, bad)
  }
  assert.throws(() => readInjectedApiOrigin(''), /没有被注入 apiOrigin/)
  assert.throws(() => readInjectedApiOrigin('?apiOrigin=http://10.0.0.5:4173'), /不是 loopback/)
  assert.equal(readInjectedApiOrigin('?apiOrigin=http%3A%2F%2F127.0.0.1%3A4173'), 'http://127.0.0.1:4173')
})
