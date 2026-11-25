import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve, sep } from 'node:path'

// Use an existing external image runtime; do not add a product dependency.
const require = createRequire(import.meta.url)
const sharp = require(process.argv[2])
const root = resolve(import.meta.dirname, '../../..')
const evidence = resolve(root, '应用端/工程文件/验收证据/Phase41-split-comparison-20261111')
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
const manifest = await readJson(resolve(evidence, 'sha256.json'))
for (const entry of manifest) {
  const path = resolve(evidence, entry.path)
  assert(path.startsWith(evidence + sep), entry.path)
  const actual = createHash('sha256').update(await readFile(path)).digest('hex')
  assert.equal(actual, entry.sha256, entry.path)
}
const before = await readJson(resolve(evidence, 'before-fixed-results/report.json'))
const after = await readJson(resolve(evidence, 'isolated-fixed-results/report.json'))
assert.equal(before.passed, true)
assert.equal(after.passed, true)
assert.deepEqual(before.qmlWarnings, [])
assert.deepEqual(after.qmlWarnings, [])
assert.deepEqual(before.states, after.states)
assert.deepEqual(before.checks, after.checks)
assert.equal(before.checks.length, 8)
assert.deepEqual(before.screenshots, after.screenshots)
assert.equal(before.screenshots.length, 7)
const expected = await readJson(resolve(root,
  '应用端/工程文件/验收证据/修缮当前验收-20261112/split-evidence-validation.json'))
const pages = []
for (const entry of expected.pages) {
  const decode = (folder) => sharp(resolve(evidence, folder, entry.page + '.png'))
    .toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const first = await decode('before-fixed-results')
  const second = await decode('isolated-fixed-results')
  assert.deepEqual(first.info, second.info)
  assert.equal(first.info.width, 1440)
  assert.equal(first.info.height, 900)
  assert.equal(first.info.channels, 3)
  let differentPixels = 0
  let maxChannelDifference = 0
  for (let offset = 0; offset < first.data.length; offset += 3) {
    let changed = false
    for (let channel = 0; channel < 3; channel++) {
      const difference = Math.abs(first.data[offset + channel] - second.data[offset + channel])
      changed ||= difference !== 0
      maxChannelDifference = Math.max(maxChannelDifference, difference)
    }
    if (changed) differentPixels++
  }
  assert.equal(differentPixels, entry.differentPixels, entry.page)
  assert.equal(maxChannelDifference, entry.maxChannelDifference, entry.page)
  pages.push({ page: entry.page, differentPixels, maxChannelDifference })
}
const result = { status: 'passed', manifestEntries: manifest.length,
  matchingStates: true, checksPerReport: before.checks.length, pages,
  scope: 'controlled historical split only; no claim of pixel identity or all states' }
await writeFile(resolve(import.meta.dirname, 'historical-validation.json'),
  JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
