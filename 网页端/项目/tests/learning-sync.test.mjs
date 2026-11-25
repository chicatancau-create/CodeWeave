import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { openPublicationJobs } from '../server/service/server/content/publish-jobs.mjs'
import { createLearningSync } from '../server/service/server/learning/sync.mjs'

let directory, jobs, sync
const owner = { accountId: 'account-a', vaultId: 'vault-a' }
const other = { accountId: 'account-b', vaultId: 'vault-a' }
const config = { serviceInstance: 'test-instance', resolveContent: async () => ({ canonicalContentId: 'lesson-a' }) }

function draft(changeId, body, baseRevision = null, kind = 'learning.draft.updated') {
  return {
    schemaVersion: 1,
    changeId,
    deviceId: 'device-a',
    kind,
    occurredAt: '2026-11-23T00:00:00.000Z',
    baseRevision,
    payload: { entityId: 'draft-a', body },
  }
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'codeweave-learning-sync-'))
  jobs = openPublicationJobs(directory)
  for (const { accountId } of [owner, other]) {
    jobs.database.prepare('INSERT INTO accounts VALUES (?, ?)').run(accountId, '{}')
  }
  sync = createLearningSync(jobs.database, config)
})

afterEach(async () => {
  jobs?.close()
  if (dirname(directory) === resolve(tmpdir()) && basename(directory).startsWith('codeweave-learning-sync-')) {
    await rm(directory, { recursive: true, force: true })
  }
})

test('reopened sync keeps idempotency and a cursor cannot cross accounts or epochs', async () => {
  const first = draft('first', 'original draft')
  const accepted = await sync.push(owner, first)
  const { cursor } = sync.pull(owner)
  jobs.close()
  jobs = openPublicationJobs(directory)
  sync = createLearningSync(jobs.database, config)
  expect(await sync.push(owner, first)).toEqual(accepted)
  await expect(sync.push(owner, draft('first', 'changed body'))).rejects.toMatchObject({ code: 'idempotency_conflict' })
  expect(sync.pull(owner, cursor).events).toEqual([])
  expect(() => sync.pull(other, cursor)).toThrow(expect.objectContaining({ code: 'sync_cursor_expired' }))
  sync.bumpEpoch()
  expect(() => sync.pull(owner, cursor)).toThrow(expect.objectContaining({ code: 'sync_cursor_expired' }))
  expect(sync.pull(owner).events).toHaveLength(1)
})

test('an offline draft conflict keeps both sides and a later accepted delete creates a tombstone', async () => {
  const initial = await sync.push(owner, draft('first', 'initial'))
  const newer = await sync.push(owner, draft('online', 'edited online', initial.sequence))
  const incoming = draft('offline', 'edited offline', initial.sequence)
  const result = await sync.push(owner, incoming)
  expect(result).toMatchObject({ status: 'conflict', code: 'revision_conflict' })
  expect(await sync.push(owner, incoming)).toEqual(result)
  const [conflict] = sync.conflicts(owner)
  expect(conflict.incoming.change.payload.body).toBe('edited offline')
  expect(conflict.current.change.payload.body).toBe('edited online')
  expect(sync.conflicts(other)).toEqual([])
  await sync.push(owner, draft('delete', '', newer.sequence, 'learning.draft.deleted'))
  expect(sync.pull(owner).events.map((event) => event.tombstone)).toEqual([false, false, true])
})

test('two devices recording the same local day share the same check-in sequence', async () => {
  const event = {
    schemaVersion: 1, changeId: 'checkin-device-a', deviceId: 'device-a', kind: 'learning.checkin.recorded',
    occurredAt: '2026-11-23T01:00:00.000Z', localDate: '2026-11-23', timeZone: 'Asia/Shanghai', payload: {},
  }
  const later = { ...event, changeId: 'checkin-device-b', deviceId: 'device-b', occurredAt: '2026-11-23T02:00:00.000Z' }
  const accepted = await sync.push(owner, later)
  expect(await sync.push(owner, event)).toEqual(accepted)
  expect(await sync.push(owner, later)).toEqual(accepted)
  expect(sync.pull(owner).events).toHaveLength(1)
  await sync.push(other, event)
  expect(sync.pull(other).events).toHaveLength(1)
})
