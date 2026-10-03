import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findWorkspace, isAllowedNavigation, isExternalWebUrl, matchesBuild, parseOptions, probeHealth, readDesktopSettings } from '../src/runtime/runtime.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'codeweave-desktop-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  mkdirSync(join(workspace, 'config'), { recursive: true })
  writeFileSync(join(workspace, 'config/codeweave.config.example.json'), '{}')
  return { root, workspace }
}

test('portable executable locates its adjacent workspace independent of current directory', (t) => {
  const { root, workspace } = fixture(t)
  assert.equal(findWorkspace({ packaged: true, portableDirectory: join(root, 'release'), executable: join(root, 'temp/app.exe'), cwd: root }), workspace)
})

test('missing explicit workspace rejects rather than changing data roots', (t) => {
  const { root, workspace } = fixture(t)
  assert.throws(() => findWorkspace({ explicit: join(root, 'missing'), sourceRoot: workspace }), /不可用/)
})

test('a clean portable location returns no workspace instead of using executable directory', (t) => {
  const { root } = fixture(t)
  assert.equal(findWorkspace({ packaged: true, executable: join(root, 'isolated/bin/app.exe'), cwd: join(root, 'isolated/bin') }), null)
})

test('navigation permits only exact local origin and external links only HTTPS', () => {
  const origin = 'http://127.0.0.1:4173'
  assert.equal(isAllowedNavigation(`${origin}/#workspace`, origin), true)
  for (const url of ['http://127.0.0.1:4174/', 'http://127.0.0.1:4173.evil.test/', 'file:///C:/Windows', 'javascript:alert(1)', 'https://example.com']) assert.equal(isAllowedNavigation(url, origin), false)
  assert.equal(isExternalWebUrl('https://example.com/'), true)
  assert.equal(isExternalWebUrl('file:///C:/Windows'), false)
  assert.equal(isExternalWebUrl('ms-settings:'), false)
})

test('health reuse requires matching project, data identity and frontend build', () => {
  const expected = { project: 'CodeWeave', instanceId: 'abc', buildId: 'v2' }
  assert.equal(matchesBuild({ ...expected, status: 'ok' }, expected), true)
  assert.equal(matchesBuild({ ...expected, buildId: 'old' }, expected), false)
  assert.equal(matchesBuild({ ...expected, instanceId: 'another-user' }, expected), false)
  assert.equal(matchesBuild(null, expected), false)
})

test('健康探针要穿过服务的 { data } 信封取身份，否则永远判不出本实例', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ data: { status: 'ok', project: 'CodeWeave', instanceId: 'abc', buildId: 'v2' } }))
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  try {
    const payload = await probeHealth(`http://127.0.0.1:${server.address().port}`)
    assert.equal(matchesBuild(payload, { project: 'CodeWeave', instanceId: 'abc', buildId: 'v2' }), true)
  } finally {
    await new Promise((done) => server.close(done))
  }
})

test('settings and explicit port are validated', (t) => {
  const { root } = fixture(t)
  const file = join(root, 'settings.json')
  assert.deepEqual(readDesktopSettings(file), {})
  writeFileSync(file, '{"workspace":42}')
  assert.throws(() => readDesktopSettings(file), /配置格式/)
  assert.deepEqual(parseOptions(['--workspace=C:/project', '--desktop-port=4173']), { workspace: 'C:/project', port: 4173 })
  assert.throws(() => parseOptions(['--desktop-port=0']), /65535/)
  assert.throws(() => parseOptions(['--desktop-port=4173;echo']), /65535/)
})
