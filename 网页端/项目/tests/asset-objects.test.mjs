import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { collectPublishedAssets } from '../server/service/server/content/asset-objects.mjs'
import { resolveContentAsset } from '../server/service/server/content/asset.mjs'
import { createContentService } from '../server/service/server/content/index.mjs'
import { createSnapshotStore } from '../server/service/server/content/snapshot.mjs'

const path = '发布正文/附件/示意图.png'
const lesson = { contentId: 'u01', exerciseIds: [], stageIds: [], reading: { path: '发布正文/U01.md', markdown: `![示意图](${path})` } }
let fixture
let dataRoot
let vaultRoot
let store

beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'codeweave-asset-objects-'))
  dataRoot = join(fixture, 'data')
  vaultRoot = join(fixture, 'vault')
  await mkdir(join(vaultRoot, '发布正文', '附件'), { recursive: true })
  store = createSnapshotStore({ dataRoot })
})

afterEach(async () => {
  if (fixture) await rm(fixture, { recursive: true, force: true })
})

async function publish(bundleId, body) {
  await writeFile(join(vaultRoot, path), body)
  const collected = await collectPublishedAssets(vaultRoot, [lesson])
  expect(collected.problems).toEqual([])
  await store.assets.add(collected.objects)
  await store.publish({ bundleId, schemaVersion: 1, lessons: [lesson], exercises: [], stages: [], assets: collected.assets })
  return collected.assets[0]
}

function requestAsset(bundleId, relativePath = path, ifNoneMatch) {
  const url = new URL('http://localhost/api/content/asset')
  url.searchParams.set('path', relativePath)
  if (bundleId) url.searchParams.set('bundleId', bundleId)
  return resolveContentAsset({ url, snapshotStore: store, ifNoneMatch })
}

test('a pinned lesson and asset follow the catalog bundle after publication and source deletion', async () => {
  const old = await publish('previous', 'first asset bytes')
  const service = createContentService({ dataRoot, vaultRoot })
  const catalog = await service.catalog()
  await publish('current', 'changed asset bytes')
  await rm(join(vaultRoot, path))

  const detail = await service.lesson('u01', catalog.data.bundleId)
  expect(detail).toMatchObject({ ok: true, bundleId: 'previous' })
  const original = await requestAsset(detail.bundleId)
  expect(original.bytes.toString()).toBe('first asset bytes')
  expect(original.headers).toMatchObject({ ETag: `"${old.sha256}"`, 'X-Content-Bundle': 'previous' })
  expect((await requestAsset(null)).bytes.toString()).toBe('changed asset bytes')
  expect(await requestAsset('previous', path, original.headers.ETag)).toMatchObject({ ok: true, notModified: true })
  expect(await requestAsset('retired')).toMatchObject({ ok: false, status: 410 })
})

test('CAS corruption fails integrity even when the original file and a matching ETag exist', async () => {
  const asset = await publish('current', 'first asset bytes')
  await writeFile(join(dataRoot, 'content', 'objects', asset.sha256), 'other asset bytes')
  expect(await requestAsset('current', path, `"${asset.sha256}"`)).toMatchObject({ ok: false, code: 'asset_integrity_failed' })
})

test('unreferenced files and staged candidates cannot be read as published attachments', async () => {
  await publish('current', 'first asset bytes')
  await store.stageCandidate({ bundleId: 'staged', schemaVersion: 1 })
  await writeFile(join(vaultRoot, '发布正文', '未发布.txt'), 'unpublished')
  expect(await requestAsset('staged')).toMatchObject({ ok: false, status: 410 })
  expect(await requestAsset('current', '发布正文/未发布.txt')).toMatchObject({ ok: false, status: 404 })
  expect(await requestAsset('current', '%2e%2e%2fprivate.txt')).toMatchObject({ ok: false, status: 400 })
})
