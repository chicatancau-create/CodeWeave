import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const project = resolve(import.meta.dirname, '../../../..')
const server = join(project, '网页端', '项目', 'server', 'service')
const { resolveRuntimePaths } = await import(pathToFileURL(join(server, 'server', 'config.mjs')))
const { createLearningService } = await import(pathToFileURL(join(server, 'server', 'learning', 'index.mjs')))
const { PROGRESS_BOARD_PATH } = await import(pathToFileURL(join(server, 'server', 'learning', 'writeback.mjs')))
const { acquireLock } = await import(pathToFileURL(join(server, 'server.mjs')))
const config = resolveRuntimePaths({ startDir: server })
const runtime = join(project, '工作区', 'data', 'runtime', 'unified-local')
const backup = resolve(process.argv[2] ?? '.')
const backupBase = resolve('G:/数据备份')
assert(backup.startsWith(backupBase + '\\'), '恢复证据必须保存在仓外备份目录')
assert.equal(config.dataDir, runtime)
assert.equal(config.vaultRoot, join(project, '工作区', '全栈工程师学习资料库'))
assert(acquireLock().ok, '本机服务需停止后才能执行受控写回验证')

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const database = new DatabaseSync(join(runtime, 'unified.sqlite'), { readOnly: true })
const learning = createLearningService({ dataRoot: runtime, vaultRoot: config.vaultRoot, database: () => database })
const boardFile = join(config.vaultRoot, PROGRESS_BOARD_PATH)
const contentFile = join(config.vaultRoot, 'CodeWeave', '发布正文', 'U01-Git与Shell.md')
let stagedId, operationId
let changed = false

try {
  const owner = await learning.ownerStore.read()
  assert(owner.ownerUserId && owner.vaultId === await learning.readVaultId())
  const before = await readFile(boardFile)
  const contentHash = sha256(await readFile(contentFile))
  await mkdir(backup)
  await copyFile(boardFile, join(backup, '进度看板.md.before'))
  assert.equal(sha256(await readFile(join(backup, '进度看板.md.before'))), sha256(before))
  const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
  const staged = await learning.stageEvidence(owner.ownerUserId, {
    at: date, topic: 'CodeWeave写回回滚验收-' + randomUUID().slice(0, 8),
    actual: '自动化验证记录，验收后回滚。', ranBy: 'assistant', independent: false,
  })
  assert(staged.ok, staged.code)
  stagedId = staged.data.evidenceId
  const preview = await learning.previewEvidence(owner.ownerUserId, { evidenceIds: [stagedId] })
  assert(preview.ok, preview.code)
  assert.deepEqual(preview.data.targets.map((target) => target.kind), ['log', 'progress'])
  operationId = preview.data.operationId
  const expectedHashes = Object.fromEntries(preview.data.targets.map((target) => [target.path, target.expectedHash]))
  assert.equal(preview.data.targets[0].expectedHash, null)
  const log = join(config.vaultRoot, preview.data.targets[0].path)
  const options = { operationId, expectedHashes }
  try {
    const applied = await learning.commitEvidence(owner.ownerUserId, options)
    changed = applied.ok || await readFile(log).then(() => true, () => false)
    assert(applied.ok && applied.data.synced, applied.code)
    const repeated = await learning.commitEvidence(owner.ownerUserId, options)
    assert(repeated.ok && repeated.data.idempotent)
    assert.notEqual(sha256(await readFile(boardFile)), sha256(before))
    assert.equal(sha256(await readFile(contentFile)), contentHash)
    assert((await readFile(log, 'utf8')).includes(operationId))
  } finally {
    if (changed) {
      const restore = await learning.rollbackEvidence(owner.ownerUserId, operationId)
      assert(restore.ok && restore.data.rolledBack, restore.code)
    }
  }
  assert.equal(sha256(await readFile(boardFile)), sha256(before))
  assert.equal(sha256(await readFile(contentFile)), contentHash)
  await assert.rejects(readFile(log), { code: 'ENOENT' })
  const removed = await learning.removeEvidence(owner.ownerUserId, stagedId)
  assert(removed.ok, removed.code)
  const output = { operationId, progressBoard: PROGRESS_BOARD_PATH, progressSha256: sha256(before), contentSha256: contentHash, rolledBack: true, targets: 2 }
  await writeFile(join(backup, 'verification.json'), JSON.stringify(output, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify(output))
} finally {
  database.close()
}
