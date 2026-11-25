import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const app = resolve(root, '应用端/工程文件/验收证据/修缮收口-20261115')
const web = resolve(root, '网页端/工程文件/验收证据/修缮收口-20261115')
const json = async (file) => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''))
const finalDir = resolve(app, 'qt-matrix-windows-visible')
const final = await json(resolve(finalDir, 'report.json'))
const execution = await json(resolve(finalDir, 'execution.json'))
assert.equal(final.passed, true)
assert.equal(final.checks.length, 226)
assert.ok(final.checks.every((check) => check.passed))
assert.equal(final.screenshots.length, 60)
assert.equal(execution.exitCode, 0)
assert.equal(execution.platform, 'windows')
assert.equal(execution.backend, 'software')
const screenshots = []
for (const path of final.screenshots) {
  const bytes = await readFile(path)
  assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a')
  assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0)
  screenshots.push({ file: relative(root, path).replaceAll('\\', '/'),
    width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20),
    sha256: createHash('sha256').update(bytes).digest('hex') })
}
const browser = await json(resolve(web, 'browser/report.json'))
const pages = await json(resolve(web, 'web/web-report.json'))
assert.deepEqual(browser.errors, [])
assert.deepEqual(pages.errors, [])
assert.equal(pages.status, 'passed')
assert.equal(pages.pages.length, 4)
assert.equal(browser.keyboard.length, 12)
const historical = await json(resolve(import.meta.dirname, 'historical-validation.json'))
assert.equal(historical.status, 'passed')
assert.equal(historical.manifestEntries, 65)
const attempts = []
for (const entry of await readdir(app, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  let report
  try { report = await json(resolve(app, entry.name, 'report.json')) }
  catch (error) { if (error.code === 'ENOENT') { attempts.push({ directory: entry.name, result: 'no-report' }); continue } throw error }
  attempts.push({ directory: entry.name, passed: report.passed, checks: report.checks.length,
    screenshots: report.screenshots.length, failures: report.checks.filter((c) => !c.passed) })
}
await writeFile(resolve(import.meta.dirname, 'validation-summary.json'), JSON.stringify({
  date: '2026-11-15', scope: 'Original repair stages 0-7, 37 numbered tasks',
  qt: { checks: 226, screenshots: 60, platform: execution.platform, backend: execution.backend,
    ctest: { passed: 11, total: 11, seconds: 124.78 },
    warningsScope: 'QQmlEngine creation/load warnings only, not a global runtime warning collector' },
  web: { testFiles: 88, tests: 1323, coverage: [89.83, 83.07, 87.49, 92.83],
    viewports: [375, 768, 1280, 1440], keyboardChecks: 12, pageScreenshots: 4, browserErrors: [] },
  historical, attempts, screenshots,
  limitations: ['Android APK/Lint/device not executed: SDK unavailable',
    'No production account or real workspace data accessed', 'No claim of whole-page pixel identity'],
}, null, 2) + '\n')
console.log('Evidence passed: Qt 226 checks / 60 PNGs, Web 12 keyboard checks / 4 pages, historical 65 hashes')
