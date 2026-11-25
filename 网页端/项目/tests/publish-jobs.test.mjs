import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { openPublicationJobs } from '../server/service/server/content/publish-jobs.mjs'

let fixture
let repository
const scope = { vaultId: 'vault-a', accountId: 'publisher-a' }
const request = { ...scope, key: 'one-idempotency-key', requestHash: 'hash-a', dryRun: true }

beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'codeweave-publish-jobs-'))
  repository = openPublicationJobs(fixture)
})

afterEach(async () => {
  repository?.close()
  if (fixture) await rm(fixture, { recursive: true, force: true })
})

test('a retried POST gets the original job and a changed request conflicts', () => {
  const { job } = repository.reserve(request)
  expect(repository.reserve({ ...request, rateLimited: true })).toEqual({ reused: true, job })
  expect(repository.reserve({ ...request, requestHash: 'hash-b' })).toEqual({ code: 'idempotency_conflict' })
  expect(repository.reserve({ ...request, key: 'second-key' })).toEqual({ code: 'publish_busy' })
  expect(repository.get(job.jobId, { ...scope, accountId: 'publisher-b' })).toBeNull()
  expect(repository.get(job.jobId, { ...scope, accountId: 'owner', isOwner: true })).toEqual(job)
  expect(repository.get(job.jobId, { ...scope, vaultId: 'vault-b', isOwner: true })).toBeNull()
})

test.each(['ready', 'invalid', 'unavailable'])('retains the %s terminal state across restart', (state) => {
  const { job, attempt } = repository.reserve(request)
  const result = { ...job, status: state, finishedAt: '2026-11-23T10:00:00.000Z' }
  expect(() => repository.complete(job.jobId, 'superseded-attempt', result)).toThrow()
  repository.complete(job.jobId, attempt, result)
  repository.close()
  repository = openPublicationJobs(fixture)
  repository.recoverInterrupted()
  expect(repository.get(job.jobId, scope)).toEqual(result)
  expect(repository.reserve(request)).toEqual({ reused: true, job: result })
})

test('startup gives an interrupted uncommitted job a durable failure', () => {
  const { job } = repository.reserve(request)
  repository.close()
  repository = openPublicationJobs(fixture)
  repository.recoverInterrupted()
  expect(repository.get(job.jobId, scope)).toMatchObject({ status: 'unavailable', error: { code: 'publish_interrupted' } })
})
