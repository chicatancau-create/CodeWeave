/**
 * 快照仓库（LINK-04，02 号方案 §7 导入/同步 + 00 号方案 §2 职责边界）。
 *
 * 状态机：unconfigured → scanning → validating → ready；失败为 invalid / unavailable；
 * 旧包仍可用时对外显示 stale。
 *
 * 一致性要求：
 * - 候选包先写临时位置，schema/引用校验通过后再原子切换 current 指针；
 * - 至少保留一个上次有效包；
 * - 同一时刻只有一个同步任务（重复点击返回同一 job）；
 * - list/detail/search 都从同一 bundleId 读取；载荷 hash 校验失败即视为失效，不混用新旧快照。
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stableStringify } from './markdown.mjs'

export const STATUS = {
  UNCONFIGURED: 'unconfigured',
  SCANNING: 'scanning',
  VALIDATING: 'validating',
  READY: 'ready',
  INVALID: 'invalid',
  UNAVAILABLE: 'unavailable',
}

export const KEEP_SNAPSHOTS = 3

function hashPayload(bundle) {
  return createHash('sha256').update(stableStringify(bundle), 'utf8').digest('hex')
}

export function createSnapshotStore({ dataRoot }) {
  const baseDir = join(dataRoot, 'content')
  const snapshotsDir = join(baseDir, 'snapshots')
  const currentPath = join(baseDir, 'current.json')
  /** 同步任务：同一时刻只允许一个；重复点击返回同一 job。 */
  let activeJob = null

  async function ensureDirs() {
    await mkdir(snapshotsDir, { recursive: true })
  }

  function snapshotPath(bundleId) {
    return join(snapshotsDir, `${bundleId}.json`)
  }

  /** 读取 current 指针；不存在或损坏时返回 null（不抛错，由上层决定状态词）。 */
  async function readPointer() {
    try {
      return JSON.parse(await readFile(currentPath, 'utf8'))
    } catch {
      return null
    }
  }

  /**
   * 读取当前生效快照。载荷 hash 校验失败视为 invalid，绝不返回半损坏内容。
   */
  async function readCurrent() {
    const pointer = await readPointer()
    if (!pointer?.bundleId) return { status: STATUS.UNCONFIGURED, bundle: null, pointer: null }
    let raw
    try {
      raw = JSON.parse(await readFile(snapshotPath(pointer.bundleId), 'utf8'))
    } catch {
      return { status: STATUS.INVALID, bundle: null, pointer, reason: 'current 指针指向的快照文件不可读' }
    }
    const actual = hashPayload(raw.bundle)
    if (actual !== raw.payloadHash || actual !== pointer.payloadHash) {
      return { status: STATUS.INVALID, bundle: null, pointer, reason: '快照载荷校验失败，禁止使用' }
    }
    return { status: STATUS.READY, bundle: raw.bundle, pointer }
  }

  /** 读快照记录里的发布时间；读不到（损坏或手写）记为空串，按最旧处理。 */
  async function publishedAtOf(bundleId) {
    try {
      const raw = JSON.parse(await readFile(snapshotPath(bundleId), 'utf8'))
      return typeof raw?.publishedAt === 'string' ? raw.publishedAt : ''
    } catch {
      return ''
    }
  }

  /**
   * 列出已发布快照（新→旧），顺序 = 各记录自身的 publishedAt。
   *
   * 绝不能按文件名排序：bundleId 是内容 hash，字典序与发布先后无关。
   * 2026-09-29 那次发布就是因此删掉了「上一版」（7a29e08f…）而留下了两个更老的包，
   * 回滚只能靠仓外备份——保留窗口的设计意图是留最近 N 代，不是留 hash 最大的 N 个。
   * publishedAt 也不取文件 mtime：从备份恢复回来的文件，mtime 是恢复那一刻。
   */
  async function listSnapshots() {
    let files
    try {
      files = await readdir(snapshotsDir)
    } catch {
      return []
    }
    const ids = files.filter((file) => file.endsWith('.json')).map((file) => file.replace(/\.json$/, ''))
    const stamped = await Promise.all(ids.map(async (id) => ({ id, at: await publishedAtOf(id) })))
    // 同一毫秒发布两个包时用字典序兜底，保证排序稳定（否则 stale 判定随 readdir 顺序漂移）。
    return stamped.sort((a, b) => (a.at === b.at ? compareIdDesc(b.id, a.id) : a.at < b.at ? 1 : -1)).map((entry) => entry.id)
  }

  function compareIdDesc(a, b) {
    return a < b ? 1 : a > b ? -1 : 0
  }

  /**
   * 退役超出保留窗口的快照，返回本次被删掉的 id（新→旧）。
   * keepBundleId 必须在窗口内，所以只保留其余最近 KEEP_SNAPSHOTS-1 代。
   */
  async function retireOldSnapshots(keepBundleId) {
    const ids = await listSnapshots()
    const stale = ids.filter((id) => id !== keepBundleId).slice(KEEP_SNAPSHOTS - 1)
    for (const id of stale) {
      await rm(snapshotPath(id), { force: true }).catch(() => {})
    }
    return stale
  }

  /**
   * 阶段 1：只把候选包落到快照目录，不改变对外生效版本。
   * 失败或中断时旧版本继续生效，不会形成混包。
   */
  async function stageCandidate(bundle) {
    await ensureDirs()
    // 先做一次 JSON 往返规范化：`undefined` 字段在落盘时会被丢弃，
    // 若直接对内存对象取 hash，读回后校验必然失败（假报“载荷损坏”）。
    const normalized = JSON.parse(JSON.stringify(bundle))
    const payloadHash = hashPayload(normalized)
    const record = { bundleId: normalized.bundleId, publishedAt: new Date().toISOString(), payloadHash, bundle: normalized }
    const finalPath = snapshotPath(normalized.bundleId)
    const tempPath = `${finalPath}.${process.pid}.tmp`
    await writeFile(tempPath, JSON.stringify(record), 'utf8')
    await rename(tempPath, finalPath)
    return { bundle: normalized, payloadHash, publishedAt: record.publishedAt }
  }

  async function readRecord(bundleId) {
    return JSON.parse(await readFile(snapshotPath(bundleId), 'utf8'))
  }

  /** 阶段 2：切换活动指针。 */
  async function flipPointer(bundleId, payloadHash, { schemaVersion = null, publishedAt = null } = {}) {
    await ensureDirs()
    const pointer = { bundleId, publishedAt: publishedAt ?? new Date().toISOString(), payloadHash, schemaVersion }
    const temp = `${currentPath}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify(pointer), 'utf8')
    await rename(temp, currentPath)
    return pointer
  }

  /** 回滚到此前已知有效的指针；指针本就为空时清除。 */
  async function restorePointer(previous) {
    if (!previous?.bundleId) {
      await rm(currentPath, { force: true })
      return null
    }
    const temp = `${currentPath}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify(previous), 'utf8')
    await rename(temp, currentPath)
    return previous
  }

  async function discardCandidate(bundleId) {
    if (!bundleId) return
    await rm(snapshotPath(bundleId), { force: true })
  }

  // --- 发布事务日志（DATA-05）：跨进程重启也能判断停在哪一步 ---
  const journalPath = join(baseDir, 'publish-journal.json')

  async function readJournal() {
    try {
      return JSON.parse(await readFile(journalPath, 'utf8'))
    } catch {
      return null
    }
  }

  async function writeJournal(journal) {
    await ensureDirs()
    const temp = `${journalPath}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(journal, null, 2)}\n`, 'utf8')
    await rename(temp, journalPath)
    return journal
  }

  async function clearJournal() {
    await rm(journalPath, { force: true })
  }

  /**
   * 原子发布候选包（无跨文件事务需求的调用方使用）。
   * 失败时抛错并由上层保留旧包。
   */
  async function publish(bundle) {
    const staged = await stageCandidate(bundle)
    await flipPointer(staged.bundle.bundleId, staged.payloadHash, {
      schemaVersion: staged.bundle.schemaVersion,
      publishedAt: staged.publishedAt,
    })
    await retireOldSnapshots(staged.bundle.bundleId)
    return readRecord(staged.bundle.bundleId)
  }

  /** 同步任务的互斥入口：进行中直接返回同一 job。 */
  function runExclusive(work) {
    if (activeJob) return { reused: true, job: activeJob }
    const job = {
      jobId: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      status: STATUS.SCANNING,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      report: null,
      error: null,
      published: false,
    }
    activeJob = job
    job.promise = (async () => {
      try {
        await work(job)
      } finally {
        job.finishedAt = new Date().toISOString()
        activeJob = null
      }
    })()
    return { reused: false, job }
  }

  function currentJob() {
    return activeJob
  }

  return {
    baseDir,
    publish,
    stageCandidate,
    flipPointer,
    restorePointer,
    discardCandidate,
    readRecord,
    readJournal,
    writeJournal,
    clearJournal,
    retireOldSnapshots,
    currentPath,
    readCurrent,
    readPointer,
    listSnapshots,
    runExclusive,
    currentJob,
    hasSnapshot: () => existsSync(currentPath),
  }
}