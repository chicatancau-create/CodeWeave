import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { createLearningService } from '../server/service/server/learning/index.mjs'
import { PROGRESS_BOARD_PATH } from '../server/service/server/learning/writeback.mjs'

let directory, vault, learning
const owner = 'fixture-owner'
const board = [
  '\uFEFF# 进度看板', '', '## 本周记录', '',
  '| 日期 | 投入时间 | 主要产出 | 验证证据 | 明日最小步骤 |',
  '| --- | --- | --- | --- | --- |',
  '|  |  |  |  |  |',
  '', '## 阶段评估', '', '待评估', '',
].join('\r\n')

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'codeweave-writeback-board-'))
  vault = join(directory, 'vault')
  await mkdir(join(vault, 'CodeWeave'), { recursive: true })
  await mkdir(dirname(join(vault, PROGRESS_BOARD_PATH)), { recursive: true })
  await writeFile(join(vault, 'CodeWeave', 'content-manifest.json'), JSON.stringify({ vaultId: 'fixture-board' }))
  await writeFile(join(vault, PROGRESS_BOARD_PATH), board)
  learning = createLearningService({ dataRoot: join(directory, 'runtime'), vaultRoot: vault })
  await learning.bind(owner)
})

afterEach(async () => {
  if (dirname(directory) === resolve(tmpdir()) && basename(directory).startsWith('codeweave-writeback-board-')) {
    await rm(directory, { recursive: true, force: true })
  }
})

test('adds the evidence to the current board and restores its original bytes on rollback', async () => {
  const staged = await learning.stageEvidence(owner, {
    at: '2026-11-25', topic: '隔离验收', actual: '夹具运行通过', independent: false, ranBy: 'assistant',
  })
  expect(staged.ok).toBe(true)
  const preview = await learning.previewEvidence(owner, { evidenceIds: [staged.data.evidenceId] })
  expect(preview.ok).toBe(true)
  expect(preview.data.targets.map(({ kind }) => kind)).toEqual(['log', 'progress'])
  const [log] = preview.data.targets
  expect(log.path).toContain('03-执行计划/学习日志/')
  const operationId = preview.data.operationId
  const expectedHashes = Object.fromEntries(preview.data.targets.map(({ path, expectedHash }) => [path, expectedHash]))
  const result = await learning.commitEvidence(owner, { operationId, expectedHashes })
  expect(result).toMatchObject({ ok: true, data: { synced: true } })
  expect(await learning.commitEvidence(owner, { operationId, expectedHashes })).toMatchObject({ ok: true, data: { idempotent: true } })
  const written = await readFile(join(vault, PROGRESS_BOARD_PATH), 'utf8')
  expect(written.match(/\[学习日志\]/g)).toHaveLength(1)
  expect(written).toContain('## 阶段评估\n\n待评估')
  expect(await learning.rollbackEvidence(owner, operationId)).toMatchObject({ ok: true, data: { rolledBack: true } })
  expect(await readFile(join(vault, PROGRESS_BOARD_PATH), 'utf8')).toBe(board)
  await expect(readFile(join(vault, log.path))).rejects.toMatchObject({ code: 'ENOENT' })
})
