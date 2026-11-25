import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { sha256, stableStringify } from '../content/markdown.mjs'

const SYNC_VERSION = 1
const KINDS = new Set([
  'learning.evidence.recorded', 'learning.completion.recorded', 'learning.checkin.recorded',
  'learning.challenge.recorded', 'learning.review.recorded', 'learning.workspace.selected',
  'learning.position.updated', 'learning.bookmark.updated', 'learning.bookmark.deleted',
  'learning.draft.updated', 'learning.draft.deleted',
])
const MUTABLE = /\.(updated|deleted|selected)$/
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/

function failure(message, code, status = 400) {
  return Object.assign(new Error(message), { code, status })
}

function validate(change) {
  if (change?.schemaVersion !== SYNC_VERSION) throw failure('不支持该同步事件版本', 'unsupported_sync_schema', 409)
  if (!ID.test(change.changeId ?? '') || !ID.test(change.deviceId ?? '') || !KINDS.has(change.kind) ||
      !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(change.occurredAt ?? '') || !Number.isFinite(Date.parse(change.occurredAt)) ||
      !change.payload || typeof change.payload !== 'object' || Array.isArray(change.payload)) {
    throw failure('同步事件格式无效', 'invalid_sync_event')
  }
  if (change.kind === 'learning.checkin.recorded') {
    const date = change.localDate
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date || typeof change.timeZone !== 'string') {
      throw failure('打卡日期和时区无效', 'invalid_sync_event')
    }
    try { new Intl.DateTimeFormat('en', { timeZone: change.timeZone }) } catch {
      throw failure('打卡日期和时区无效', 'invalid_sync_event')
    }
  }
  const mutable = MUTABLE.test(change.kind)
  const base = change.baseRevision ?? null
  if (mutable && (!ID.test(change.payload.entityId ?? '') || (base !== null && (!Number.isSafeInteger(base) || base < 1)))) {
    throw failure('可编辑事件须指定对象及有效基准版本', 'invalid_sync_event')
  }
  const allowed = new Set(['schemaVersion', 'changeId', 'deviceId', 'kind', 'occurredAt', 'localDate', 'timeZone', 'contentRef', 'baseRevision', 'payload'])
  if (Object.keys(change).some((key) => !allowed.has(key))) throw failure('同步事件包含未支持字段', 'unsupported_sync_fields', 409)
  return change
}

export function createLearningSync(db, { serviceInstance, resolveContent }) {
  const setting = db.prepare('SELECT value FROM runtime_metadata WHERE name = ?')
  const saveSetting = db.prepare('INSERT INTO runtime_metadata VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value')
  if (!setting.get('syncSecret')) saveSetting.run('syncSecret', randomBytes(32).toString('hex'))
  if (!setting.get('syncEpoch')) saveSetting.run('syncEpoch', randomUUID())
  const secret = setting.get('syncSecret').value
  const epoch = () => setting.get('syncEpoch').value
  const previousRequest = db.prepare('SELECT request_hash, result_json FROM learning_idempotency WHERE account_id = ? AND change_id = ?')
  const recordRequest = db.prepare('INSERT INTO learning_idempotency VALUES (?, ?, ?, ?)')
  const append = db.prepare('INSERT INTO learning_events (account_id, vault_id, change_id, event_json) VALUES (?, ?, ?, ?)')
  const getCheckin = db.prepare('SELECT sequence FROM learning_checkins WHERE account_id = ? AND vault_id = ? AND local_date = ? AND time_zone = ?')
  const recordCheckin = db.prepare('INSERT INTO learning_checkins VALUES (?, ?, ?, ?, ?)')
  const newest = db.prepare('SELECT COALESCE(max(sequence), 0) AS sequence FROM learning_events WHERE account_id = ? AND vault_id = ?')
  const list = db.prepare('SELECT sequence, event_json FROM learning_events WHERE account_id = ? AND vault_id = ? AND sequence > ? ORDER BY sequence LIMIT ?')
  const getRevision = db.prepare('SELECT sequence, event_json FROM learning_revisions JOIN learning_events USING (sequence) WHERE learning_revisions.account_id = ? AND learning_revisions.vault_id = ? AND entity_key = ?')
  const setRevision = db.prepare('INSERT INTO learning_revisions VALUES (?, ?, ?, ?) ON CONFLICT(account_id, vault_id, entity_key) DO UPDATE SET sequence = excluded.sequence')
  const saveConflict = db.prepare('INSERT INTO learning_conflicts VALUES (?, ?, ?, ?)')
  const listConflicts = db.prepare('SELECT details_json FROM learning_conflicts WHERE account_id = ? AND vault_id = ? ORDER BY rowid')
  const countConflicts = db.prepare('SELECT count(*) AS count FROM learning_conflicts WHERE account_id = ? AND vault_id = ?')

  function mark(scope, sequence) {
    const encoded = Buffer.from(JSON.stringify([SYNC_VERSION, serviceInstance, scope.vaultId, scope.accountId, epoch(), sequence])).toString('base64url')
    const signature = createHmac('sha256', secret).update(encoded).digest('base64url')
    return `${encoded}.${signature}`
  }

  function decode(scope, cursor, highest) {
    if (!cursor) return 0
    try {
      if (typeof cursor !== 'string' || cursor.length > 1024) throw new Error('invalid cursor')
      const [encoded, signature, extra] = cursor.split('.')
      if (!signature || extra !== undefined) throw new Error('invalid cursor')
      const expected = createHmac('sha256', secret).update(encoded).digest('base64url')
      if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error('invalid cursor')
      const [version, instance, vault, account, cursorEpoch, sequence] = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
      if (version !== SYNC_VERSION || instance !== serviceInstance || vault !== scope.vaultId || account !== scope.accountId ||
          cursorEpoch !== epoch() || !Number.isSafeInteger(sequence) || sequence < 0 || sequence > highest) throw new Error('expired cursor')
      return sequence
    } catch {
      throw failure('同步游标失效，需要重新拉取', 'sync_cursor_expired', 409)
    }
  }

  function state(scope) {
    const { accountId, vaultId } = scope
    return {
      ...scope, serviceInstance, schemaVersion: SYNC_VERSION, syncEpoch: epoch(),
      cursor: mark(scope, newest.get(accountId, vaultId).sequence), conflicts: countConflicts.get(accountId, vaultId).count,
    }
  }

  function pull(scope, cursor, limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 250) throw failure('拉取数量必须在 1 到 250 之间', 'invalid_sync_limit')
    const { accountId, vaultId } = scope
    const highest = newest.get(accountId, vaultId).sequence
    const after = decode(scope, cursor, highest)
    const rows = list.all(accountId, vaultId, after, limit + 1)
    const events = rows.slice(0, limit).map((row) => ({ sequence: row.sequence, ...JSON.parse(row.event_json) }))
    return { events, cursor: mark(scope, events.at(-1)?.sequence ?? after), hasMore: rows.length > limit, syncEpoch: epoch() }
  }

  async function push(scope, input) {
    const change = validate(input)
    const { accountId, vaultId } = scope
    const requestHash = sha256(stableStringify({ vaultId, change }))
    function priorResult() {
      const row = previousRequest.get(accountId, change.changeId)
      if (!row) return null
      if (requestHash !== row.request_hash) throw failure('变更编号已用于不同请求', 'idempotency_conflict', 409)
      return JSON.parse(row.result_json)
    }
    const prior = priorResult()
    if (prior) return prior
    const content = await resolveContent(scope, change.contentRef)
    db.exec('BEGIN IMMEDIATE')
    try {
      let outcome = priorResult()
      if (!outcome) {
        const mutable = MUTABLE.test(change.kind)
        const entityKey = mutable ? stableStringify([change.kind.split('.').slice(0, 2), content.canonicalContentId, change.payload.entityId]) : null
        const current = entityKey ? getRevision.get(accountId, vaultId, entityKey) : null
        const event = { change, canonicalContentId: content.canonicalContentId ?? null, tombstone: change.kind.endsWith('.deleted') }
        const isCheckin = change.kind === 'learning.checkin.recorded'
        const checkin = isCheckin ? getCheckin.get(accountId, vaultId, change.localDate, change.timeZone) : null
        const cause = content.conflict ?? (mutable && (change.baseRevision ?? null) !== (current?.sequence ?? null) ? 'revision_conflict' : null)
        if (cause) {
          const id = randomUUID()
          const details = { id, cause, incoming: event, current: current ? { sequence: current.sequence, ...JSON.parse(current.event_json) } : null }
          saveConflict.run(id, accountId, vaultId, JSON.stringify(details))
          outcome = { status: 'conflict', conflictId: id, code: cause }
        } else if (checkin) {
          outcome = { status: 'accepted', sequence: checkin.sequence }
        } else {
          const inserted = append.run(accountId, vaultId, change.changeId, JSON.stringify(event))
          const sequence = Number(inserted.lastInsertRowid)
          if (entityKey) setRevision.run(accountId, vaultId, entityKey, sequence)
          if (isCheckin) recordCheckin.run(accountId, vaultId, change.localDate, change.timeZone, sequence)
          outcome = { status: 'accepted', sequence }
        }
        recordRequest.run(accountId, change.changeId, requestHash, JSON.stringify(outcome))
      }
      db.exec('COMMIT')
      return outcome
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  return {
    state, pull, push,
    conflicts: (scope) => listConflicts.all(scope.accountId, scope.vaultId).map((row) => JSON.parse(row.details_json)),
    bumpEpoch: () => saveSetting.run('syncEpoch', randomUUID()),
  }
}
