import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const scriptsRoot = fileURLToPath(new URL('../scripts/', import.meta.url))

function runNode(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(scriptsRoot, script), ...args], { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => resolve({ code, stdout, stderr }))
  })
}

test('native preflight remains read-only and reports metadata only', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codeweave-preflight-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'nested'))
  await writeFile(join(root, 'users.json'), '{"sensitive":"fixture"}\n', 'utf8')
  await writeFile(join(root, 'nested', 'unknown.txt'), 'fixture body\n', 'utf8')

  const result = await runNode('native-preflight.mjs', ['--root', root])
  assert.equal(result.code, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.contentRead, false)
  assert.equal(report.writesPerformed, false)
  assert.equal(report.migrationCommitted, false)
  assert.equal(report.kinds['account-source'], 1)
  assert.equal(report.filesByMetadata.some((file) => file.relativePath === 'nested/unknown.txt'), true)
  assert.equal(report.filesByMetadata.some((file) => file.relativePath.includes('sensitive')), false)
  assert.equal(await readFile(join(root, 'users.json'), 'utf8'), '{"sensitive":"fixture"}\n')
})

test('native preflight rejects write-like flags', async () => {
  const result = await runNode('native-preflight.mjs', ['--root', tmpdir(), '--commit'])
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /只支持只读模式/)
})
