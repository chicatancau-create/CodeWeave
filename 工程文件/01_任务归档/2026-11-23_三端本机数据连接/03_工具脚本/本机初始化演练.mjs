import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const repository = resolve(import.meta.dirname, '../../../..')
const adapter = join(repository, '工作区', '全栈工程师学习资料库', 'CodeWeave')
const entry = join(repository, '网页端', '项目', 'server', 'service', 'server.mjs')

{
  const root = await mkdtemp(join(tmpdir(), 'codeweave-activate-test-'))
  try {
    await mkdir(join(root, 'config'))
    const vaultRoot = join(root, 'vault')
    await cp(adapter, join(vaultRoot, 'CodeWeave'), { recursive: true, force: false, errorOnExist: true })
    await writeFile(join(root, 'config', 'codeweave.local.json'), JSON.stringify({
      schemaVersion: 1, vaultRoot, dataDir: join(root, 'runtime'), port: 4173,
    }))
    const users = join(root, 'legacy-users.json')
    await writeFile(users, JSON.stringify([{
      id: 'fixture-owner', name: 'Fixture Owner', email: 'fixture@example.test',
      passwordHash: 'a'.repeat(32) + ':' + 'a'.repeat(128), createdAt: '2026-11-23T00:00:00.000Z',
    }]))
    const activate = () => {
      const child = spawnSync(process.execPath, [entry, '--initialize-local', users], {
        encoding: 'utf8', windowsHide: true, timeout: 20000,
        env: { ...process.env, CODEWEAVE_PROJECT_ROOT: root, CODEWEAVE_ALLOW_REGISTRATION: '0' },
      })
      assert.equal(child.status, 0, child.stderr)
      return JSON.parse(child.stdout)
    }
    const first = activate()
    const second = activate()
    assert.equal(first.initialized, true)
    assert.equal(second.initialized, false)
    assert.equal(first.lessonCount, 1)
    assert.equal(first.accountCount, 1)
    assert.equal(second.accountCount, 1)
    assert.equal(second.bundleId, first.bundleId)
    assert.equal(second.manifestHash, first.manifestHash)
    console.log(JSON.stringify({ recovered: true, first, second }))
  } finally {
    if (dirname(root) === resolve(tmpdir()) && basename(root).startsWith('codeweave-activate-test-')) {
      await rm(root, { recursive: true, force: true })
    }
  }
}
