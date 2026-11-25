import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'

const [, , dataDirectory, backupDirectory] = process.argv
assert(dataDirectory && backupDirectory, '指定 SQLite 运行目录和备份目录')
const source = new DatabaseSync(join(dataDirectory, 'unified.sqlite'), { readOnly: true })
const output = resolve(backupDirectory)
const saved = join(output, 'unified.sqlite')
const temporary = await mkdtemp(join(tmpdir(), 'codeweave-sqlite-restore-'))

function counts(db) {
  const tables = ['accounts', 'sessions', 'learning_events', 'learning_conflicts', 'publication_jobs']
  return Object.fromEntries(tables.map((table) => [table, db.prepare('SELECT count(*) AS total FROM ' + table).get().total]))
}

try {
  assert.equal(source.prepare("SELECT count(*) AS total FROM publication_jobs WHERE state IN ('scanning','validating')").get().total, 0)
  await mkdir(output)
  await backup(source, saved)
  const restored = join(temporary, 'unified.sqlite')
  await cp(saved, restored, { errorOnExist: true, force: false })
  const digest = async (filename) => createHash('sha256').update(await readFile(filename)).digest('hex')
  const sha256 = await digest(saved)
  assert.equal(await digest(restored), sha256)
  const replica = new DatabaseSync(restored, { readOnly: true })
  try {
    assert.equal(replica.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
    assert.deepEqual(counts(replica), counts(source))
    const result = { saved, sha256, restored: true, schemaVersion: replica.prepare('PRAGMA user_version').get().user_version, counts: counts(replica) }
    await writeFile(join(output, 'verification.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
    console.log(JSON.stringify(result))
  } finally { replica.close() }
} finally {
  source.close()
  if (dirname(temporary) === resolve(tmpdir()) && basename(temporary).startsWith('codeweave-sqlite-restore-')) {
    await rm(temporary, { recursive: true, force: true })
  }
}
