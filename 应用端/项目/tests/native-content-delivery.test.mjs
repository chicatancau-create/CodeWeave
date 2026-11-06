import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createContentPackage, loadCurriculum, exportContent } from '../scripts/export-native-content.mjs'
import { packageNative, validateContent } from '../scripts/package-native.mjs'

const rows = (text) => text.trim().split('\n').filter(Boolean).map((line) => line.split('\t').map((value) => Buffer.from(value, 'hex').toString('utf8')))
test('native snapshot preserves every source lesson, challenge and stage without synthetic progress', async () => {
  const source = await loadCurriculum()
  const result = createContentPackage(source)
  assert.deepEqual(result.counts, { lessons: 61, challenges: 13, stages: 13, catalog: 74, automaticExercises: 4, external: 49 })
  const snapshot = JSON.parse(result.files.get('curriculum.v1.json'))
  assert.deepEqual(snapshot.lessons, source.lessons.map(({ progress, ...lesson }) => JSON.parse(JSON.stringify(lesson))))
  assert.deepEqual(snapshot.challenges, source.challenges)
  assert.deepEqual(snapshot.stages, source.stages)
  for (const [id, , , , hash] of rows(result.files.get('catalog.v1.tsv'))) assert.equal(createHash('sha256').update(result.files.get(`${id}.txt`)).digest('hex'), hash)
  for (const lesson of source.lessons) {
    const body = result.files.get(`${lesson.id}.txt`)
    for (const value of [lesson.code, lesson.content.exercise, ...lesson.content.explanation]) assert.ok(body.includes(value), lesson.id)
  }
  const metadata = new Map(rows(result.files.get('metadata.v1.tsv')).map((row) => [row[0], row]))
  const exercises = rows(result.files.get('exercises.v1.tsv'))
  for (const challenge of source.challenges.filter((item) => item.runner === 'external')) {
    assert.equal(metadata.get(challenge.id)[3], 'external')
    assert.ok(!exercises.some((item) => item[0] === challenge.id))
  }
  assert.ok(exercises.every((row) => row[3] === 'L1'))
  for (const challenge of source.challenges) {
    assert.ok(!result.files.get(`${challenge.id}.txt`).includes(challenge.hint))
    assert.ok(result.files.get(`hints/${challenge.id}.txt`).includes(challenge.hint))
  }
  assert.deepEqual([...createContentPackage(source).files], [...result.files], 'export is deterministic')
})

test('native delivery is self-contained, verifies body hashes and refuses unsafe replacement', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'cw-native-delivery-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const content = join(root, 'content')
  await exportContent(content)
  assert.equal(await validateContent(content), 74)
  const exe = join(root, 'fixture.exe')
  await writeFile(exe, 'not an exe')
  await assert.rejects(packageNative({ exe, content, output: join(root, 'bad') }), /Windows executable/)
  const pe = Buffer.alloc(256)
  pe.write('MZ'); pe.writeUInt32LE(64, 0x3c); pe.write('PE\u0000\u0000', 64); pe.writeUInt16LE(0x8664, 68)
  await writeFile(exe, pe)
  const output = join(root, 'delivery')
  await packageNative({ exe, content, output })
  assert.deepEqual((await readdir(output)).sort(), ['CodeWeave.exe', 'LICENSE', 'README.txt', 'config', 'content', 'manifest.json'].sort())
  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))
  assert.equal(manifest.contentCount, 74)
  assert.ok(manifest.files.every((item) => !/electron|node_modules|renderer|backend/i.test(item.path)))
  for (const file of manifest.files) assert.equal(createHash('sha256').update(await readFile(join(output, file.path))).digest('hex'), file.sha256)
  await assert.rejects(packageNative({ exe, content, output }), /already exists/)
  const hints = join(content, 'hints/stage-d.txt')
  const originalHint = await readFile(hints)
  await writeFile(hints, 'changed hint')
  await assert.rejects(packageNative({ exe, content, output: join(root, 'bad-hint') }), /Hint hash mismatch/)
  await writeFile(hints, originalHint)
  await writeFile(join(content, 'unexpected-account-data.json'), '{}')
  await assert.rejects(packageNative({ exe, content, output: join(root, 'extra-file') }), /Unexpected packaged content/)
  await rm(join(content, 'unexpected-account-data.json'))
  await writeFile(join(content, 'stage-b.txt'), 'tampered')
  await assert.rejects(packageNative({ exe, content, output: join(root, 'tampered') }), /hash mismatch/)
})
