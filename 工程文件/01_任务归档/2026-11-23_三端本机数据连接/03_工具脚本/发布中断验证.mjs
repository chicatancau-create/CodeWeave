import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const project = resolve(import.meta.dirname, '../../../..')
const modules = join(project, '网页端', '项目', 'server', 'service', 'server', 'content')
const { createContentService, MANIFEST_PATH } = await import(pathToFileURL(join(modules, 'index.mjs')))
const { openPublicationJobs } = await import(pathToFileURL(join(modules, 'publish-jobs.mjs')))
const faults = ['candidate', 'pointer_switched', 'pointer_logged', 'manifest_written', 'manifest_logged', 'sync_log_written', 'job_committed']
const accountId = 'process-crash-test'
const key = 'test-publication-key'

function open(dataRoot, vaultRoot, fault) {
  const jobs = openPublicationJobs(dataRoot)
  const content = createContentService({
    dataRoot, vaultRoot,
    recordCommitted: (receipt) => jobs.complete(receipt.jobId, receipt.attempt, receipt.result),
    publicationCheckpoint: (checkpoint) => {
      if (fault === checkpoint) process.exit(86)
    },
  })
  return { jobs, content }
}

if (process.argv[2] === '--child') {
  const [, , , dataRoot, vaultRoot, fault] = process.argv
  const { jobs, content } = open(dataRoot, vaultRoot, fault)
  try {
    await content.initialize()
    const vaultId = await content.vaultId()
    const validated = (await content.sync({ dryRun: true })).job
    await validated.promise
    assert.equal(validated.status, 'ready')
    const request = { vaultId, accountId, key, requestHash: 'fault-test', dryRun: false }
    const { job, attempt } = jobs.reserve(request)
    const publish = (await content.sync({
      approvedFingerprint: validated.approvalFingerprint,
      receiptFor: (current) => ({
        jobId: job.jobId, attempt,
        result: { ...job, status: 'ready', published: true, bundleId: current.report.bundleId },
      }),
    })).job
    await publish.promise
    throw new Error('Fault checkpoint was not reached: ' + fault + ' ' + publish.status)
  } finally {
    jobs.close()
  }
} else {
  const source = join(project, '工作区', '全栈工程师学习资料库', 'CodeWeave')
  const temporary = await mkdtemp(join(tmpdir(), 'codeweave-crash-'))
  try {
    for (const fault of faults) {
      const dataRoot = join(temporary, fault, 'runtime')
      const vaultRoot = join(temporary, fault, 'vault')
      await cp(source, join(vaultRoot, 'CodeWeave'), { recursive: true, force: false, errorOnExist: true })
      const before = await readFile(join(vaultRoot, MANIFEST_PATH))
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', dataRoot, vaultRoot, fault], {
        encoding: 'utf8', windowsHide: true, timeout: 20000,
      })
      assert.equal(child.status, 86, child.stderr)
      const { jobs, content } = open(dataRoot, vaultRoot)
      try {
        await content.initialize()
        jobs.recoverInterrupted()
        const vaultId = await content.vaultId()
        const result = jobs.reserve({ vaultId, accountId, key, requestHash: 'fault-test', dryRun: false })
        assert.equal(result.reused, true)
        const current = await content.catalog()
        if (fault === 'candidate') {
          assert.equal(result.job.status, 'unavailable')
          assert.equal(current.ok, false)
          assert.deepEqual(await readFile(join(vaultRoot, MANIFEST_PATH)), before)
        } else {
          assert.equal(result.job.status, 'ready')
          assert.equal(result.job.published, true)
          assert.equal(current.data.bundleId, result.job.bundleId)
          assert.equal(current.data.lessons[0].contentId, 'cw-u01-git-shell')
          const log = JSON.parse(await readFile(join(vaultRoot, 'CodeWeave', '同步报告', '同步记录.json'), 'utf8'))
          assert.equal(log.history?.length, 1)
          assert.equal(log.history[0].bundleId, result.job.bundleId)
        }
        assert.equal(await content.snapshotStore.readJournal(), null)
        console.log(JSON.stringify({ fault, exitCode: child.status, recovered: true, state: result.job.status }))
      } finally {
        jobs.close()
      }
    }
  } finally {
    if (dirname(temporary) === resolve(tmpdir()) && basename(temporary).startsWith('codeweave-crash-')) {
      await rm(temporary, { recursive: true, force: true })
    }
  }
}
