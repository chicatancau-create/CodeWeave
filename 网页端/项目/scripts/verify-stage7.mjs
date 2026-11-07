/* global document */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [runtimePath, chromePath, outputPath] = process.argv.slice(2)
assert(runtimePath && chromePath && outputPath, 'Expected external Playwright runtime, Chrome and output directory')
const output = resolve(outputPath)
await mkdir(output, { recursive: true })
const isolatedRoot = await mkdtemp(join(tmpdir(), 'codeweave-stage7-http-'))
Object.assign(process.env, {
  CODEWEAVE_PROJECT_ROOT: isolatedRoot,
  CODE_CANVAS_DATA_DIR: join(isolatedRoot, 'runtime'),
  CODEWEAVE_VAULT_ROOT: join(isolatedRoot, 'empty-vault'),
  CODEWEAVE_STATIC_DIR: resolve(import.meta.dirname, '../dist'),
  CODE_CANVAS_QUIET_LOGS: '1',
})
const report = { startedAt: new Date().toISOString(), status: 'running', isolatedData: true, http: [], pages: [], errors: [] }
let server
let browser
try {
  const { createCodeCanvasServer } = await import('../server/service/server.mjs')
  server = createCodeCanvasServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  for (const path of ['/api/health', '/', '/api/auth/me']) {
    const response = await fetch(`${origin}${path}`)
    assert.equal(response.status, 200)
    const headers = Object.fromEntries(['x-content-type-options', 'referrer-policy', 'x-frame-options', 'content-security-policy']
      .map((name) => [name, response.headers.get(name)]))
    assert.equal(headers['x-content-type-options'], 'nosniff')
    assert.equal(headers['referrer-policy'], 'no-referrer')
    assert.equal(headers['x-frame-options'], 'DENY')
    for (const directive of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'"]) {
      assert(headers['content-security-policy'].includes(directive))
    }
    if (path === '/') assert.match(await response.text(), /<div id="root"><\/div>/)
    else {
      const body = await response.json()
      if (path === '/api/health') assert.equal(body.data.status, 'ok')
      else assert.equal(body.data, null)
    }
    report.http.push({ path, status: response.status, headers })
  }
  const { chromium } = await import(pathToFileURL(resolve(runtimePath, 'index.mjs')).href)
  browser = await chromium.launch({ executablePath: chromePath, headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await context.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname
    return route.fulfill({
      contentType: 'application/json', status: path === '/api/auth/me' ? 200 : 503,
      body: JSON.stringify(path === '/api/auth/me' ? { data: {
        id: 'stage7-isolated', name: '隔离验收', bio: '', createdAt: '2026-11-07T00:00:00Z',
      } } : { code: 'unavailable', error: '隔离截图：资料库未连接' }),
    })
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => report.errors.push(error.message))
  await page.goto(origin)
  await page.getByRole('heading', { name: '你的学习路径', exact: true }).waitFor()
  async function capture(name) {
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: resolve(output, `web-${name}.png`) })
    report.pages.push({ page: name, width: 1440, height: 900, screenshot: `web-${name}.png`,
      headings: await page.locator('main h1, main h2').allTextContents() })
  }
  await capture('learning')
  await page.locator('.main-nav button').filter({ hasText: '复习中心' }).click()
  await page.getByRole('heading', { name: '延迟复测', exact: true }).waitFor()
  await capture('review')
  await page.locator('.main-nav button').filter({ hasText: '实战挑战' }).click()
  await page.getByRole('heading', { name: '挑战关卡', exact: true }).waitFor()
  await capture('challenge')
  await page.locator('.main-nav button').filter({ hasText: '学习路径' }).click()
  await page.getByRole('button', { name: '进入学习', exact: true }).click()
  await page.locator('.code-editor').first().waitFor()
  await capture('workbench')
  assert.deepEqual(report.errors, [])
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.failure = String(error)
  throw error
} finally {
  await browser?.close()
  if (server) {
    const closed = new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
    server.closeAllConnections()
    await closed
  }
  await rm(isolatedRoot, { recursive: true, force: true })
  report.completedAt = new Date().toISOString()
  await writeFile(resolve(output, 'web-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
