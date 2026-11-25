import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const repo = resolve(import.meta.dirname, '../../../..')
const backup = resolve(process.argv[2])
assert(backup.startsWith(resolve('G:/数据备份') + '\\'))
const runtime = join(repo, '工作区', 'data', 'runtime', 'unified-local')
const json = async (filename) => JSON.parse((await readFile(filename, 'utf8')).replace(/^\uFEFF/, ''))
const manifest = await json(join(backup, 'SHA-256.json'))
for (const item of manifest) {
  const actual = createHash('sha256').update(await readFile(join(backup, item.path))).digest('hex')
  assert.equal(actual, item.sha256, '历史备份 SHA-256 不一致')
}
const restore = await json(join(backup, 'restore-verification.json'))
assert.equal(restore.recovered, true)
const source = await json(join(backup, 'legacy-designated-runtime', 'users.json'))
const separate = await json(join(backup, 'legacy-web-default-runtime', 'users.json'))
assert(Array.isArray(source) && source.length === 1)
assert(Array.isArray(separate))
const sourceAccount = source[0]
const countsOfProfiles = restore.stats.filter(({ category }) => category === 'web owner registered export')
assert(countsOfProfiles.length >= 2, '浏览器数据盘点缺失')
for (const browser of countsOfProfiles) assert(Number.isSafeInteger(browser.keys) && browser.keys >= 0)
const webKeys = countsOfProfiles.reduce((sum, profile) => sum + profile.keys, 0)
const qtRoot = join(backup, 'qt-local-profile')
const qtFiles = await readdir(qtRoot, { recursive: true, withFileTypes: true })
const ledgerFiles = qtFiles.filter((file) => file.isFile()).length
assert.equal(webKeys, 0, '已发现网页学习记录，需逐条导入和对账')
assert.equal(ledgerFiles, 0, '已发现 Qt 账本，需逐条导入和对账')
const db = new DatabaseSync(join(runtime, 'unified.sqlite'), { readOnly: true })
try {
  const owner = JSON.parse(db.prepare('SELECT record_json FROM vault_owner WHERE singleton = 1').get().record_json)
  assert.equal(owner.ownerUserId, sourceAccount.id)
  const accountCount = db.prepare('SELECT count(*) AS count FROM accounts').get().count
  assert.equal(accountCount, 1)
  const foreign = separate.filter(({ id }) => id !== owner.ownerUserId)
  for (const { id } of foreign) {
    assert.equal(db.prepare('SELECT count(*) AS count FROM accounts WHERE id = ?').get(id).count, 0)
  }
  const byKind = Object.fromEntries(db.prepare(`
    SELECT json_extract(event_json, '$.change.kind') AS kind, count(*) AS count
    FROM learning_events WHERE account_id = ? AND vault_id = ?
    GROUP BY kind`).all(owner.ownerUserId, owner.vaultId).map(({ kind, count }) => [kind, count]))
  const categories = {
    '当前选课': ['learning.workspace.selected'], '最后位置': ['learning.position.updated'],
    '书签': ['learning.bookmark.updated'], '草稿': ['learning.draft.updated'],
    '挑战': ['learning.challenge.recorded'], '打卡': ['learning.checkin.recorded'],
    '掌握证据': ['learning.completion.recorded'], '复测': ['learning.review.recorded'],
    '外部证据': ['learning.evidence.recorded'], '待同步记录': [],
  }
  const rows = Object.entries(categories).map(([category, kinds]) => ({
    category, importedFromLegacy: 0, before: 0,
    currentEvents: kinds.reduce((sum, kind) => sum + (byKind[kind] ?? 0), 0),
    duplicates: 0, conflicts: 0, skipped: 0,
  }))
  const conflicts = db.prepare('SELECT count(*) AS count FROM learning_conflicts WHERE account_id = ? AND vault_id = ?').get(owner.ownerUserId, owner.vaultId).count
  console.log(JSON.stringify({
    audited: true, primaryAccountCount: accountCount, separatelyPreservedAccountCount: foreign.length,
    browserOriginProfilesChecked: countsOfProfiles.length, webKeys, qtLedgerFiles: ledgerFiles, currentConflicts: conflicts, rows,
  }, null, 2))
} finally { db.close() }
