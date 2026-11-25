import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { createContentService, MANIFEST_PATH } from '../server/service/server/content/index.mjs'
import { createSnapshotStore } from '../server/service/server/content/snapshot.mjs'

let fixture
let dataRoot
let vaultRoot
let store
const initialManifest = { schemaVersion: 1, vaultId: 'test-vault' }
const nextManifest = { ...initialManifest, publishedContentIds: ['u01'] }

beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'codeweave-publish-recovery-'))
  dataRoot = join(fixture, 'data')
  vaultRoot = join(fixture, 'vault')
  await mkdir(join(vaultRoot, 'CodeWeave'), { recursive: true })
  await writeFile(join(vaultRoot, MANIFEST_PATH), JSON.stringify(initialManifest))
  store = createSnapshotStore({ dataRoot })
})

afterEach(async () => {
  if (fixture) await rm(fixture, { recursive: true, force: true })
})

async function stage(stage = 'candidate') {
  await store.publish({ bundleId: 'previous', schemaVersion: 1 })
  const previousPointer = await store.readPointer()
  const candidate = await store.stageCandidate({ bundleId: 'candidate', schemaVersion: 1 })
  const journal = {
    operationId: 'test-publication', stage, bundleId: candidate.bundle.bundleId,
    payloadHash: candidate.payloadHash, candidateCreated: true, previousPointer, root: vaultRoot, manifest: nextManifest,
    syncEntry: { operationId: 'test-publication', finishedAt: '2026-11-23T00:00:00.000Z' },
  }
  await store.writeJournal(journal)
  return journal
}

test('reopening after an interrupted pointer switch completes the publication without deleting current', async () => {
  const journal = await stage()
  await store.flipPointer(journal.bundleId, journal.payloadHash)

  const reloaded = createContentService({ dataRoot, vaultRoot })
  const status = await reloaded.status()
  expect(status.bundleId).toBe(journal.bundleId)
  expect(status.lastReconcile.action).toBe('completed-forward')
  expect(await store.readJournal()).toBeNull()
  expect(await store.readRecord(journal.bundleId)).toHaveProperty('payloadHash', journal.payloadHash)
  expect(JSON.parse(await readFile(join(vaultRoot, MANIFEST_PATH), 'utf8'))).toEqual(nextManifest)
})

test('a candidate staged before a pointer switch leaves the prior publication active', async () => {
  const journal = await stage()
  const reloaded = createContentService({ dataRoot, vaultRoot })

  expect(await reloaded.status()).toMatchObject({ bundleId: 'previous', lastReconcile: { action: 'aborted' } })
  expect(await store.readJournal()).toBeNull()
  await expect(store.readRecord(journal.bundleId)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(JSON.parse(await readFile(join(vaultRoot, MANIFEST_PATH), 'utf8'))).toEqual(initialManifest)
})
