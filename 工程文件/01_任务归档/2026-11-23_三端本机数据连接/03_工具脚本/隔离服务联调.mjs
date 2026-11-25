import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { execFileSync, spawn } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const repository = resolve(import.meta.dirname, '..', '..', '..', '..')
const source = join(repository, '工作区', '全栈工程师学习资料库', 'CodeWeave')
const web = join(repository, '网页端', '项目')
const temporary = await mkdtemp(join(tmpdir(), 'codeweave-unified-smoke-'))
const vault = join(temporary, 'vault')
const runtime = join(temporary, 'runtime')
const logs = []
let server
let origin
let servicePort
let progress = '初始化'

async function start() {
  const portProbe = createServer()
  portProbe.listen(0, '127.0.0.1')
  await once(portProbe, 'listening')
  const probePort = portProbe.address().port
  const port = servicePort ??= probePort
  await new Promise((done) => portProbe.close(done))
  origin = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, [join(web, 'server', 'service', 'server.mjs')], {
    cwd: web, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, PORT: String(port), CODE_CANVAS_DATA_DIR: runtime, CODEWEAVE_VAULT_ROOT: vault,
      CODEWEAVE_STATIC_DIR: join(web, 'dist'), CODE_CANVAS_NO_OPEN: '1', CODE_CANVAS_QUIET_LOGS: '1',
      CODEWEAVE_ALLOW_REGISTRATION: '1',
    },
  })
  server.stderr.on('data', (part) => logs.push(part.toString()))
  server.stdout.resume()
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error('服务提前退出')
    const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) }).catch(() => null)
    if (response?.ok) return
    await delay(100)
  }
  throw new Error('服务未就绪')
}

async function stop() {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit')
    server.kill()
    await exited
  }
}

async function request(path, { cookie, body, key, method = body === undefined ? 'GET' : 'POST', status = 200 } = {}) {
  const headers = new Headers()
  if (cookie) headers.set('Cookie', cookie)
  if (key) headers.set('Idempotency-Key', key)
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  const response = await fetch(origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const payload = await response.json()
  assert.equal(response.status, status, `${method} ${path}: ${payload.code ?? '—'} ${payload.error ?? ''}`)
  return { payload, cookie: response.headers.get('Set-Cookie')?.split(';')[0] }
}

async function submit(cookie, key, body, status = 202) {
  return (await request('/api/content/sync', { cookie, key, body, status })).payload
}

async function awaitJob(cookie, id) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = (await request(`/api/content/sync/${id}`, { cookie })).payload.data
    if (job.status !== 'scanning' && job.status !== 'validating') return job
    await delay(50)
  }
  throw new Error('发布任务超时')
}

try {
  await cp(source, join(vault, 'CodeWeave'), { recursive: true, errorOnExist: true, force: false })
  await start()
  progress = '合成账户登录、设置拥有者'
  const owner = await request('/api/auth/register', {
    body: { name: 'Fixture owner', email: 'owner@example.test', password: 'fixture-owner-17' }, status: 201,
  })
  const reader = await request('/api/auth/register', {
    body: { name: 'Fixture reader', email: 'reader@example.test', password: 'fixture-reader-17' }, status: 201,
  })
  await request('/api/learning/owner', { cookie: owner.cookie, body: { confirm: true } })
  await request('/api/learning/owner/visibility', { method: 'PATCH', cookie: owner.cookie, body: { publicContent: true } })
  progress = '发布授权、任务幂等与审批过期'
  const readerRejected = await submit(reader.cookie, 'fixture-key-for-reader', { dryRun: true }, 403)
  assert.equal(readerRejected.code, 'publisher_required')
  await submit(reader.cookie, 'fixture-key-for-reader', { dryRun: false, approvalJobId: 'irrelevant' }, 403)
  const first = (await submit(owner.cookie, 'fixture-validation-1', { dryRun: true })).data
  assert.equal((await submit(owner.cookie, 'fixture-validation-1', { dryRun: true })).data.jobId, first.jobId)
  assert.equal((await awaitJob(owner.cookie, first.jobId)).status, 'ready')
  const mapPath = join(vault, 'CodeWeave', 'mappings', 'legacy-map.json')
  const original = await readFile(mapPath, 'utf8')
  await writeFile(mapPath, original + '\n')
  const changed = (await submit(owner.cookie, 'fixture-publication-stale', { dryRun: false, approvalJobId: first.jobId })).data
  assert.equal((await awaitJob(owner.cookie, changed.jobId)).error.code, 'approval_stale')
  for (const [index, relative] of ['mappings/topic-id-map.json', 'rules/teaching-rules.json'].entries()) {
    const candidate = (await submit(owner.cookie, 'fixture-validation-extra-' + index, { dryRun: true })).data
    assert.equal((await awaitJob(owner.cookie, candidate.jobId)).status, 'ready')
    const input = join(vault, 'CodeWeave', relative)
    await writeFile(input, (await readFile(input, 'utf8')) + '\n')
    const stale = (await submit(owner.cookie, 'fixture-publish-stale-extra-' + index, {
      dryRun: false, approvalJobId: candidate.jobId,
    })).data
    assert.equal((await awaitJob(owner.cookie, stale.jobId)).error.code, 'approval_stale')
  }
  const second = (await submit(owner.cookie, 'fixture-validation-2', { dryRun: true })).data
  const checked = await awaitJob(owner.cookie, second.jobId)
  assert.equal(checked.status, 'ready')
  const finished = (await submit(owner.cookie, 'fixture-publication-2', { dryRun: false, approvalJobId: second.jobId })).data
  assert.equal((await awaitJob(owner.cookie, finished.jobId)).published, true)
  const mismatch = await submit(owner.cookie, 'fixture-publication-2', { dryRun: true }, 409)
  assert.equal(mismatch.code, 'idempotency_conflict')
  progress = '固定版本正文、学习事实同步与服务重启'
  const catalog = (await request('/api/content/catalog', { cookie: owner.cookie })).payload.data
  assert.equal(catalog.bundleId, checked.summary.bundleId)
  assert.equal(catalog.lessons.length, 1)
  const contentId = catalog.lessons[0].contentId
  const detail = (await request(`/api/content/lessons/${contentId}?bundleId=${catalog.bundleId}`, { cookie: owner.cookie })).payload.data
  assert(detail.lesson.reading.markdown.length > 0)
  assert.equal(detail.exercises.length, 1)
  const bundlePath = '/api/content/bundles/' + catalog.bundleId
  const manifest = (await request(bundlePath + '/manifest', { cookie: owner.cookie })).payload.data
  assert.equal(manifest.manifestHash, catalog.manifestHash)
  assert.equal(manifest.files[0].sha256, catalog.manifestHash)
  const payloadResponse = await fetch(origin + bundlePath + '/payload', { headers: { Cookie: owner.cookie } })
  assert.equal(payloadResponse.status, 200)
  const bytes = Buffer.from(await payloadResponse.arrayBuffer())
  assert.equal(bytes.length, manifest.files[0].size)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.files[0].sha256)
  assert.equal(JSON.parse(bytes.toString()).bundleId, catalog.bundleId)
  const etag = payloadResponse.headers.get('etag')
  assert.equal((await fetch(origin + bundlePath + '/payload', {
    headers: { Cookie: owner.cookie, 'If-None-Match': etag },
  })).status, 304)
  assert.equal((await fetch(origin + bundlePath + '/payload', { headers: { 'If-None-Match': etag } })).status, 401)
  console.log(JSON.stringify({ offlineBundle: 'passed', bytes: bytes.length, assets: manifest.assets.length, manifestHash: catalog.manifestHash }))
  const change = {
    schemaVersion: 1, changeId: 'fixture-learning-change', deviceId: 'fixture-devices-a', kind: 'learning.evidence.recorded',
    occurredAt: new Date().toISOString(), contentRef: { vaultId: catalog.vaultId, contentId, bundleId: catalog.bundleId },
    payload: { memo: 'Synthetic evidence' },
  }
  const pushed = (await request('/api/sync/push', { cookie: owner.cookie, body: change, key: change.changeId })).payload.data
  assert.equal(pushed.status, 'accepted')
  const duplicate = (await request('/api/sync/push', { cookie: owner.cookie, body: change, key: change.changeId })).payload.data
  assert.deepEqual(duplicate, pushed)
  await stop()
  await start()
  for (const job of [first, changed, finished]) assert((await awaitJob(owner.cookie, job.jobId)).finishedAt)
  const pulled = (await request('/api/sync/pull', { cookie: owner.cookie })).payload.data
  assert.equal(pulled.events.length, 1)
  assert.equal(pulled.events[0].canonicalContentId, contentId)
  const finalCatalog = (await request('/api/content/catalog', { cookie: owner.cookie })).payload.data
  assert.equal(finalCatalog.serviceInstance, catalog.serviceInstance)
  assert.equal(finalCatalog.manifestHash, catalog.manifestHash)
  if (process.env.CODEWEAVE_SMOKE_ANDROID === '1') {
    progress = 'Android 模拟器真实页面'
    const adb = 'D:/DevCache/CodeWeave-Android-SDK/platform-tools/adb.exe'
    const serial = process.env.CODEWEAVE_SMOKE_ANDROID_SERIAL
    assert(/^emulator-\d+$/.test(serial ?? ''), 'Specify the isolated Android emulator serial')
    const result = (...args) => execFileSync(adb, ['-s', serial, 'shell', ...args], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
    function ui() {
      result('uiautomator', 'dump', '/sdcard/codeweave-smoke.xml')
      return result('cat', '/sdcard/codeweave-smoke.xml')
    }
    function tap(node) {
      const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node)
      assert(bounds, 'Android 控件缺少坐标')
      const [x1, y1, x2, y2] = bounds.slice(1).map(Number)
      result('input', 'tap', String((x1 + x2) >> 1), String((y1 + y2) >> 1))
    }
    function nodes(xml) { return [...xml.matchAll(/<node\s[^>]*>/g)].map((match) => match[0]) }
    function tapText(xml, text) {
      const target = nodes(xml).find((node) => node.includes(`text="${text}"`))
      assert(target, `Android 控件未找到 ${text}`)
      tap(target)
    }
    async function waitText(text) {
      for (let i = 0; i < 5; i += 1) {
        const layout = ui()
        if (layout.includes(text)) return layout
        await delay(350)
      }
      throw new Error(`Android 页面未显示 ${text}`)
    }
    result('am', 'start', '-W', '-n', 'com.codeweave.mobile/.MainActivity',
      '--es', 'codeweaveOrigin', origin.replace('127.0.0.1', '10.0.2.2'))
    const login = await waitText('邮箱或手机号')
    const editFields = nodes(login).filter((node) => node.includes('class="android.widget.EditText"'))
    assert.equal(editFields.length, 3)
    tap(editFields[1])
    result('input', 'text', 'owner@example.test')
    result('input', 'keyevent', '4')
    tap(editFields[2])
    result('input', 'text', 'fixture-owner-17')
    result('input', 'keyevent', '4')
    tapText(ui(), '登录')
    const screen = await waitText(catalog.bundleId)
    assert(screen.includes(catalog.serviceInstance) && screen.includes(catalog.manifestHash))
    const title = catalog.lessons[0].title.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
    tapText(screen, title)
    const course = await waitText('返回目录')
    assert(course.includes(title))
    await stop()
    tapText(course, '返回目录')
    tapText(ui(), title)
    assert((await waitText('离线只读')).includes(title))
    await start()
    tapText(ui(), '刷新目录')
    assert((await waitText(catalog.bundleId)).includes(catalog.manifestHash))
    result('rm', '/sdcard/codeweave-smoke.xml')
    console.log(JSON.stringify({
      android: 'passed', openCourse: contentId, offline: true, resumed: true,
      serviceInstance: catalog.serviceInstance, vaultId: catalog.vaultId,
      bundleId: catalog.bundleId, manifestHash: catalog.manifestHash,
    }))
  }
  if (process.env.CODEWEAVE_SMOKE_BROWSER === '1') {
    progress = 'Chrome 真实页面'
    const { chromium } = await import('file:///D:/DevCache/CodeWeave-Browser-Smoke/node_modules/playwright-core/index.mjs')
    const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
    try {
      const context = await browser.newContext()
      const [name, value] = owner.cookie.split('=')
      await context.addCookies([{ name, value, url: origin, httpOnly: true }])
      const page = await context.newPage()
      await page.goto(origin)
      const title = catalog.lessons[0].title
      await page.getByRole('button', { name: /\bGit\b/ }).first().click()
      const target = page.getByText(title, { exact: true }).first()
      try { await target.waitFor({ state: 'visible', timeout: 7000 }) }
      catch (error) {
        const title = await page.title()
        const text = (await page.locator('body').innerText()).slice(0, 750)
        throw new Error(`${error.message}\n浏览器页面 ${title}\n${text}`)
      }
      await target.click()
      await page.getByText(/来源事实明细|资料库/).first().waitFor({ state: 'visible' })
      console.log(JSON.stringify({ chrome: 'passed', visibleCourse: contentId }))
      if (process.env.CODEWEAVE_SMOKE_QT === '1') {
        const testOutbox = process.env.CODEWEAVE_SMOKE_QT_OUTBOX === '1'
        progress = '网页打卡后由 Qt 窗口同步'
        let checkinDate = ''
        if (!testOutbox) {
          await page.locator('.streak-card').click()
          let events = []
          for (let retry = 0; retry < 30; retry += 1) {
            const state = (await request('/api/sync/pull', { cookie: owner.cookie })).payload.data
            events = state.events.filter(({ change }) => change.kind === 'learning.checkin.recorded')
            if (events.length) break
            await delay(100)
          }
          assert.equal(events.length, 1)
          checkinDate = events[0].change.localDate
          await page.reload()
          await page.locator('.streak-card.checked-in').waitFor({ state: 'visible' })
        }
        const sdk = join(repository, '.local', 'prep', 'qt', '6.8.3', 'msvc2022_64')
        const executable = join(repository, '.local', 'qt', 'current', 'ui-qt', 'CodeWeaveQtShell.exe')
        const report = join(temporary, 'qt-unified.json')
        const disconnect = process.env.CODEWEAVE_SMOKE_QT_OFFLINE === '1' ? join(temporary, 'go-offline') : ''
        const options = {
          cwd: dirname(executable), windowsHide: true, timeout: 40000,
          env: {
            ...process.env, PATH: join(sdk, 'bin') + ';' + process.env.PATH, QT_QPA_PLATFORM: 'offscreen',
            QT_PLUGIN_PATH: join(sdk, 'plugins'), QML_IMPORT_PATH: join(sdk, 'qml'),
            CODEWEAVE_UNIFIED_ORIGIN: origin, CODEWEAVE_SMOKE_LOGIN: 'owner@example.test',
            CODEWEAVE_SMOKE_PASSWORD: 'fixture-owner-17', CODEWEAVE_SMOKE_CONTENT_ID: contentId,
            CODEWEAVE_SMOKE_CHECKIN: checkinDate, CODEWEAVE_SMOKE_DISCONNECT: disconnect, CODEWEAVE_SMOKE_CACHE: temporary,
          },
        }
        if (testOutbox) options.env.CODEWEAVE_SMOKE_OUTBOX = '1'
        try {
          if (!disconnect) {
            execFileSync(executable, ['--unified-content-smoke', report], options)
          } else {
            const qtProcess = spawn(executable, ['--unified-content-smoke', report], options)
            const done = once(qtProcess, 'exit')
            qtProcess.stdout.resume()
            qtProcess.stderr.resume()
            try {
              for (let retry = 0; retry < 120 && qtProcess.exitCode === null; retry += 1) {
                if (await readFile(disconnect + '.ready', 'utf8').catch(() => null) === 'verified') {
                  await stop()
                  await writeFile(disconnect, 'offline', { flag: 'wx' })
                  break
                }
                await delay(100)
              }
              if (testOutbox) {
                for (let retry = 0; retry < 260 && qtProcess.exitCode === null; retry += 1) {
                  if (await readFile(disconnect + '.queued', 'utf8').catch(() => null) === 'pending') {
                    await start()
                    await writeFile(disconnect + '.online', 'online', { flag: 'wx' })
                    break
                  }
                  await delay(100)
                }
              }
              assert.equal((await done)[0], 0)
            } finally {
              if (qtProcess.exitCode === null && qtProcess.signalCode === null) qtProcess.kill()
            }
          }
        } catch (error) {
          throw new Error((await readFile(report, 'utf8').catch(() => 'Qt smoke report missing')) +
            '\n' + (error.stderr?.toString() ?? error.message))
        }
        const qt = JSON.parse(await readFile(report, 'utf8'))
        for (const field of ['serviceInstance', 'vaultId', 'bundleId', 'manifestHash']) {
          assert.equal(qt[field], catalog[field])
        }
        assert.equal(qt.contentId, contentId)
        assert.equal(qt.exerciseCount, 1)
        if (testOutbox) {
          assert.equal(qt.outboxSynced, true)
          const record = (await request('/api/sync/pull', { cookie: owner.cookie })).payload.data
          assert.equal(record.events.filter(({ change }) => change.kind === 'learning.checkin.recorded').length, 1)
          await page.reload()
          await page.locator('.streak-card.checked-in').waitFor({ state: 'visible' })
        } else {
          assert.equal(qt.checkinCount, 1)
        }
        if (disconnect) assert.equal(qt.offlineOpened, true)
        console.log(JSON.stringify({ qt: 'passed', chromeReload: true, ...qt }))
        if (disconnect && !testOutbox && process.platform === 'win32') {
          const restoredPath = join(temporary, 'qt-restored.json')
          execFileSync(executable, ['--unified-content-smoke', restoredPath, '--restore-unified-session'], {
            ...options,
            env: {
              ...options.env, CODEWEAVE_SMOKE_LOGIN: '', CODEWEAVE_SMOKE_PASSWORD: '',
              CODEWEAVE_SMOKE_CHECKIN: '', CODEWEAVE_SMOKE_DISCONNECT: '',
            },
          })
          const restored = JSON.parse(await readFile(restoredPath, 'utf8'))
          assert.equal(restored.restoredSession, true)
          assert.equal(restored.offline, true)
          assert.equal(restored.bundleId, qt.bundleId)
          assert.equal(restored.contentId, qt.contentId)
          console.log(JSON.stringify({ qtRestart: 'passed', ...restored }))
        }
      }
    } finally { await browser.close() }
  }
  progress = '跨资料库绑定拒绝读取与写回'
  if (server.exitCode !== null || server.signalCode !== null) await start()
  const sourceManifest = join(vault, 'CodeWeave', 'content-manifest.json')
  const beforeSwitch = await readFile(sourceManifest)
  const switched = JSON.parse(beforeSwitch)
  switched.vaultId = 'synthetic-different-vault'
  await writeFile(sourceManifest, JSON.stringify(switched))
  for (const endpoint of ['/api/content/catalog', bundlePath + '/payload', '/api/sync/state', '/api/learning/vault-progress']) {
    const rejected = await request(endpoint, { cookie: owner.cookie, status: 403 })
    assert.equal(rejected.payload.code, 'owner_vault_mismatch')
  }
  assert.equal((await request('/api/learning/evidence-commit', {
    cookie: owner.cookie, status: 403, body: {},
  })).payload.code, 'owner_vault_mismatch')
  await writeFile(sourceManifest, beforeSwitch)
  console.log(JSON.stringify({ result: 'passed', bundleId: catalog.bundleId, contentId, crossVaultDenied: 5 }))
} catch (error) {
  console.error(progress, error.message)
  if (logs.length) console.error(logs.join('').replaceAll(temporary, '<fixture>'))
  process.exitCode = 1
} finally {
  await stop()
  const path = resolve(temporary)
  if (dirname(path) === resolve(tmpdir()) && basename(path).startsWith('codeweave-unified-smoke-')) await rm(path, { recursive: true, force: true })
}
