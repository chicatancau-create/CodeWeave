/**
 * 内容服务门面（LINK-05 服务侧）。
 *
 * 对外只暴露经过校验的快照数据；不暴露绝对路径、不返回私人进度、
 * 不接受客户端传入的磁盘路径。所有读取都以 bundleId 为版本边界。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { COMPILER_VERSION, compileContent } from './compiler.mjs'
import { resolveCanonicalContentId } from './identity.mjs'
import { publicAssetId } from './asset.mjs'
import { ContentError, normalizeText, sha256, stableStringify } from './markdown.mjs'
import { createSnapshotStore, KEEP_SNAPSHOTS, STATUS } from './snapshot.mjs'
import { readVaultText, resolveVaultRoot } from './vault-paths.mjs'

export const MANIFEST_PATH = 'CodeWeave/content-manifest.json'
const SYNC_LOG_PATH = 'CodeWeave/同步报告/同步记录.json'
const SYNC_LOG_LIMIT = 30

export function createContentService({ dataRoot, vaultRoot, configFingerprint, recordCommitted, publicationCheckpoint = () => {} } = {}) {
  const store = createSnapshotStore({ dataRoot })
  let lastError = null
  /** 上次扫描得到的派生信息（不进入快照）：缺口与诊断，供设置页展示。 */
  let lastReport = null

  function configuredRoot() {
    return resolveVaultRoot(vaultRoot ?? process.env.CODEWEAVE_VAULT_ROOT)
  }

  async function loadManifest() {
    const resolved = configuredRoot()
    if (!resolved.ok) {
      throw new ContentError('vault_unavailable', `资料库根不可用：${resolved.reason}`)
    }
    let raw
    try {
      raw = await readVaultText(resolved.root, MANIFEST_PATH)
    } catch (error) {
      if (error?.code === 'source_not_found') {
        throw new ContentError('invalid_manifest', `缺少内容清单：${MANIFEST_PATH}`)
      }
      throw error
    }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new ContentError('invalid_manifest', `${MANIFEST_PATH}: JSON 解析失败 ${error.message}`)
    }
    if (parsed.schemaVersion !== 1) {
      throw new ContentError('invalid_manifest', `${MANIFEST_PATH}: schemaVersion 必须为 1`)
    }
    if (typeof parsed.vaultId !== 'string' || !parsed.vaultId) {
      throw new ContentError('invalid_manifest', `${MANIFEST_PATH}: 缺少稳定 vaultId`)
    }
    return { root: resolved.root, manifest: parsed, manifestSourceHash: sha256(raw) }
  }

  /** 原子写回清单（只更新 topics / publishedContentIds，其余字段按原样保留）。 */
  async function writeManifest(root, manifest) {
    const abs = join(root, MANIFEST_PATH)
    const temp = `${abs}.${process.pid}.tmp`
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await rename(temp, abs)
  }

  async function appendSyncLog(root, entry) {
    const abs = join(root, SYNC_LOG_PATH)
    let history = []
    try {
      const parsed = JSON.parse(normalizeText(await readFile(abs, 'utf8')))
      if (Array.isArray(parsed?.history)) history = parsed.history
    } catch {
      history = []
    }
    // 重放同一个 operationId 不产生第二条记录（恢复流程可安全重试）。
    if (entry.operationId && history.some((item) => item.operationId === entry.operationId)) return
    history.unshift(entry)
    const payload = { schemaVersion: 1, updatedAt: entry.finishedAt, history: history.slice(0, SYNC_LOG_LIMIT) }
    const temp = `${abs}.${process.pid}.tmp`
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await rename(temp, abs)
  }

  /** 发布前复核：扫描后源文件是否被改动（含外部写入者并发修改）。 */
  async function detectSourceChanges(root, sourceHashes) {
    const changed = []
    for (const [path, expected] of Object.entries(sourceHashes)) {
      try {
        const actual = sha256(await readVaultText(root, path))
        if (actual !== expected) changed.push(path)
      } catch (error) {
        if (expected !== null || error?.code !== 'source_not_found') changed.push(path)
      }
    }
    return changed
  }

  /**
   * 发布事务（DATA-05）：候选包 → 事务日志 → 活动指针 → 源清单 → 同步报告。
   *
   * 每个跨文件边界都先写日志再动作，所以半途崩溃后 `reconcilePublishJournal` 能判断
   * 停在哪一步：要么前滚补完，要么回滚到上一个有效指针。源清单写失败不会留下
   * “对外已发布但无记录”的状态。
   */
  async function publishTransaction({ root, bundle, nextManifest, syncEntry, assetObjects, receipt }) {
    const operationId = `pub-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`
    const previousPointer = await store.readPointer()
    await store.assets.add(assetObjects)
    const staged = await store.stageCandidate(bundle)
    const journal = {
      operationId,
      stage: 'candidate',
      bundleId: staged.bundle.bundleId,
      payloadHash: staged.payloadHash,
      candidateCreated: staged.created,
      receipt,
      previousPointer,
      root,
      manifest: nextManifest,
      syncEntry: { ...syncEntry, operationId },
      startedAt: new Date().toISOString(),
    }
    await store.writeJournal(journal)
    await publicationCheckpoint('candidate')

    await store.flipPointer(staged.bundle.bundleId, staged.payloadHash, {
      schemaVersion: staged.bundle.schemaVersion,
      publishedAt: staged.publishedAt,
    })
    await publicationCheckpoint('pointer_switched')
    await store.writeJournal({ ...journal, stage: 'pointer', updatedAt: new Date().toISOString() })

    await publicationCheckpoint('pointer_logged')
    await writeManifest(root, nextManifest)
    await publicationCheckpoint('manifest_written')
    await store.writeJournal({ ...journal, stage: 'manifest', updatedAt: new Date().toISOString() })

    await publicationCheckpoint('manifest_logged')
    await appendSyncLog(root, journal.syncEntry)
    await publicationCheckpoint('sync_log_written')
    if (receipt) await recordCommitted(receipt)
    await publicationCheckpoint('job_committed')
    await store.clearJournal()
    const retired = await store.retireOldSnapshots(staged.bundle.bundleId)
    return { operationId, bundleId: staged.bundle.bundleId, retired }
  }

  /**
   * 启动或同步前收尾：处理上一次崩溃留下的发布事务。
   * 返回 null 表示没有待处理事务。
   */
  async function reconcilePublishJournal() {
    const journal = await store.readJournal()
    const pointer = await store.readPointer()
    if (journal === null) {
      if (pointer) await store.readVerifiedBundle(pointer)
      return null
    }
    const root = configuredRoot()
    const validJournal = root.ok && root.root === journal.root &&
      ['candidate', 'pointer', 'manifest'].includes(journal.stage) &&
      typeof journal.operationId === 'string' && Boolean(journal.operationId) &&
      journal.syncEntry?.operationId === journal.operationId && journal.manifest?.schemaVersion === 1 &&
      typeof journal.bundleId === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(journal.bundleId) &&
      /^[a-f0-9]{64}$/.test(journal.payloadHash ?? '')
    if (!validJournal) throw new Error('发布日志无法与当前资料库对账')

    const outcome = { operationId: journal.operationId, stage: journal.stage, bundleId: journal.bundleId }
    const pointsAtCandidate = pointer?.bundleId === journal.bundleId && pointer.payloadHash === journal.payloadHash
    const previous = journal.previousPointer ?? null
    const pointsAtPrevious = pointer === null ? previous === null
      : pointer.bundleId === previous?.bundleId && pointer.payloadHash === previous?.payloadHash

    // candidate 阶段也可能已经切换指针。先证明当前指向旧包，再决定是否删除本次创建的候选。
    if (journal.stage === 'candidate' && !pointsAtCandidate && pointsAtPrevious) {
      if (pointer) await store.readVerifiedBundle(pointer)
      if (journal.candidateCreated === true && previous?.bundleId !== journal.bundleId) {
        await store.discardCandidate(journal.bundleId)
      }
      await store.clearJournal()
      return { ...outcome, action: 'aborted' }
    }
    if (!pointsAtCandidate) throw new Error('发布日志与当前快照指针不一致')
    await store.readVerifiedBundle(pointer)

    // 保留日志直到对账完整结束。写回失败时下次重试前滚，避免只恢复指针却留下新清单。
    if (journal.stage !== 'manifest') {
      await writeManifest(root.root, journal.manifest)
      await store.writeJournal({ ...journal, stage: 'manifest', updatedAt: new Date().toISOString() })
    }
    await appendSyncLog(root.root, journal.syncEntry)
    if (journal.receipt) await recordCommitted(journal.receipt)
    await store.clearJournal()
    return { ...outcome, action: journal.stage === 'manifest' ? 'report-replayed' : 'completed-forward' }
  }

  let lastReconcile = null
  let reconcilePromise = null
  /** 每次进程启动只收尾一次，避免重复处理同一个事务。 */
  function reconcileOnce() {
    if (!reconcilePromise) {
      reconcilePromise = reconcilePublishJournal().then((outcome) => {
        lastReconcile = outcome
        return outcome
      })
    }
    return reconcilePromise
  }

  function statusOf(current) {
    const resolved = configuredRoot()
    const state = !resolved.ok
      ? (current.bundle ? STATUS.UNAVAILABLE : STATUS.UNCONFIGURED)
      : current.status
    return {
      state,
      vaultConfigured: resolved.ok,
      vaultReason: resolved.ok ? null : resolved.reason,
      compilerVersion: COMPILER_VERSION,
      bundleId: current.bundle?.bundleId ?? null,
      buildTime: current.bundle?.buildTime ?? null,
      publishedAt: current.pointer?.publishedAt ?? null,
      schemaVersion: current.bundle?.schemaVersion ?? null,
      counts: current.bundle?.counts ?? null,
      rulesStatus: current.bundle?.rules?.status ?? null,
      stale: state === STATUS.UNAVAILABLE && Boolean(current.bundle),
      lastError,
      lastReconcile,
      lastReport: lastReport
        ? {
            finishedAt: lastReport.finishedAt,
            blockingCount: lastReport.blocking?.length ?? 0,
            gaps: lastReport.gaps ?? null,
            rules: lastReport.rules ?? null,
          }
        : null,
    }
  }

  async function status() {
    await reconcileOnce()
    return statusOf(await store.readCurrent())
  }

  /**
   * 执行一次同步。dryRun 只做扫描与校验，不发布、不写清单、不留记录。
   * 重复调用在任务进行中会拿到同一个 job。
   */
  async function sync({ dryRun = false, approvedFingerprint, receiptFor } = {}) {
    const { reused, job } = store.runExclusive(async (active) => {
      let loaded
      try {
        loaded = await loadManifest()
      } catch (error) {
        lastError = { code: error.code ?? 'invalid_manifest', message: error.message }
        active.status = error.code === 'vault_unavailable' ? STATUS.UNAVAILABLE : STATUS.INVALID
        active.error = lastError
        return
      }
      const previous = await store.readCurrent()
      let attempt = 0
      let result = null
      let changed = []
      // 期间发生修改则重新扫描（最多两次），避免拼出两个不同版本的快照。
      while (attempt < 2) {
        attempt += 1
        active.status = STATUS.SCANNING
        result = await compileContent({
          manifest: loaded.manifest,
          rootOverride: loaded.root,
          previousBundle: previous.bundle,
        })
        if (!result.ok) {
          lastError = { code: result.code, message: result.message }
          active.status = STATUS.UNAVAILABLE
          active.error = lastError
          return
        }
        active.status = STATUS.VALIDATING
        changed = await detectSourceChanges(loaded.root, result.report.sourceHashes)
        if (changed.length === 0) break
      }
      if (changed.length > 0) {
        lastError = {
          code: 'source_changed',
          message: `扫描期间源文件被修改，已放弃本次发布：${changed.slice(0, 5).join('、')}${changed.length > 5 ? ' 等' : ''}`,
        }
        active.status = STATUS.INVALID
        active.error = lastError
        active.report = { ...result.report, changedSources: changed }
        return
      }

      const fingerprint = sha256(stableStringify({
        sourceHashes: result.report.sourceHashes,
        manifestSourceHash: loaded.manifestSourceHash,
        bundleId: result.bundle.bundleId,
        rules: result.report.rules?.fingerprint ?? null,
        compilerVersion: COMPILER_VERSION,
        config: configFingerprint ?? null,
      }))
      active.approvalFingerprint = fingerprint
      if (!dryRun && approvedFingerprint !== fingerprint) {
        active.status = STATUS.INVALID
        active.error = { code: 'approval_stale', message: '候选内容或配置已变化，请重新校验' }
        return
      }
      const blocking = result.report.blocking
      lastReport = { finishedAt: new Date().toISOString(), ...result.report }
      active.report = result.report
      if (blocking.length > 0) {
        lastError = { code: blocking[0].code, message: `校验未通过（${blocking.length} 项）：${blocking[0].message}` }
        active.status = STATUS.INVALID
        active.error = lastError
        active.published = false
        return
      }
      if (dryRun) {
        active.status = STATUS.READY
        active.published = false
        active.dryRun = true
        lastError = null
        return
      }
      try {
        await reconcileOnce()
        const freshManifest = await loadManifest()
        const fresh = await compileContent({ manifest: freshManifest.manifest, rootOverride: freshManifest.root, previousBundle: previous.bundle })
        if (!fresh.ok || freshManifest.manifestSourceHash !== loaded.manifestSourceHash ||
            fresh.bundle.bundleId !== result.bundle.bundleId || fresh.report.blocking.length ||
            stableStringify(fresh.report.sourceHashes) !== stableStringify(result.report.sourceHashes)) {
          active.status = STATUS.INVALID
          active.error = { code: 'approval_stale', message: '候选内容或配置已变化，请重新校验' }
          return
        }
        const finished = await publishTransaction({
          root: loaded.root,
          bundle: result.bundle,
          nextManifest: result.nextManifest,
        assetObjects: fresh.assetObjects,
        receipt: receiptFor?.(active),
          syncEntry: {
            finishedAt: new Date().toISOString(),
            bundleId: result.bundle.bundleId,
            counts: result.bundle.counts,
            rulesStatus: result.bundle.rules?.status ?? null,
            addedTopics: result.report.addedTopics,
            movedTopics: result.report.movedTopics,
            retiredTopics: result.report.retiredTopics,
            gapSummary: {
              emptyTopics: result.report.gaps.emptyTopics.length,
              uncoveredTopics: result.report.gaps.uncoveredTopics.length,
              publishedWithoutExercise: result.report.gaps.publishedWithoutExercise.length,
              unmappedLegacy: result.report.gaps.unmappedLegacy.length,
            },
          },
        })
        active.operationId = finished.operationId
        active.retention = { keepWindow: KEEP_SNAPSHOTS, retired: finished.retired, kept: await store.listSnapshots() }
      } catch (error) {
        lastError = { code: 'publish_failed', message: `发布失败，继续使用上次有效快照：${error?.message ?? error}` }
        active.status = STATUS.INVALID
        active.error = lastError
        return
      }
      lastError = null
      active.status = STATUS.READY
      active.published = true
    })
    return { reused, job }
  }

  /** 目录：阶段 + 课程摘要。所有页面共用同一 bundleId。 */
  async function catalog(bundleId, vaultId) {
    const current = await store.readBundle(bundleId, vaultId)
    if (!current.bundle) {
      return { ok: false, code: current.status, message: '尚无可用内容快照' }
    }
    const bundle = current.bundle
    const payload = {
      bundleId: bundle.bundleId,
      vaultId: bundle.vaultId,
      manifestHash: current.pointer.payloadHash,
      legacyAliases: bundle.legacyAliases ?? {},
      aliasVersion: bundle.aliasVersion ?? null,
      schemaVersion: bundle.schemaVersion,
      buildTime: bundle.buildTime,
      rules: { status: bundle.rules?.status ?? 'missing', reason: bundle.rules?.reason ?? '' },
      stages: bundle.stages,
      milestones: bundle.rules?.milestones ?? [],
      masteryLevels: bundle.rules?.masteryLevels ?? [],
      hintLevels: bundle.rules?.hintLevels ?? [],
      reviewOffsetsDays: bundle.rules?.reviewOffsetsDays ?? [],
      lessons: bundle.lessons.map(lessonSummary),
      counts: bundle.counts,
    }
    return { ok: true, etag: sha256(stableStringify(payload)).slice(0, 32), data: payload }
  }

  async function lesson(contentId, bundleId, vaultId) {
    const current = await store.readBundle(bundleId, vaultId)
    if (!current.bundle) return { ok: false, code: current.status, message: '尚无可用内容快照' }
    const canonicalId = resolveCanonicalContentId(current.bundle, contentId)
    const found = current.bundle.lessons.find((item) => item.contentId === canonicalId)
    if (!found) return { ok: false, code: 'not_found', message: `未发布的内容：${contentId}` }
    // 一并返回本课的练习契约，避免前端为每道题再发一次请求（详情接口仍是唯一正文出口）。
    const exercises = current.bundle.exercises.filter((item) => found.exerciseIds.includes(item.exerciseId))
    return {
      ok: true,
      bundleId: current.bundle.bundleId,
      manifestHash: current.pointer.payloadHash,
      data: {
        lesson: found,
        exercises,
        assets: (current.bundle.assets ?? []).filter((asset) => found.reading?.markdown.includes('(' + asset.path + ')'))
          .map((asset) => ({ ...asset, assetId: publicAssetId(asset) })),
        stages: current.bundle.stages.filter((stage) => found.stageIds.includes(stage.id)),
      },
    }
  }

  async function exercise(exerciseId, bundleId, vaultId) {
    const current = await store.readBundle(bundleId, vaultId)
    if (!current.bundle) return { ok: false, code: current.status, message: '尚无可用内容快照' }
    const found = current.bundle.exercises.find((item) => item.exerciseId === exerciseId)
    if (!found) return { ok: false, code: 'not_found', message: `未知练习：${exerciseId}` }
    // 公开用例之外不承诺隐藏判题（§9）。
    return { ok: true, bundleId: current.bundle.bundleId, manifestHash: current.pointer.payloadHash, data: found }
  }

  return { initialize: reconcileOnce, vaultId: async () => (await loadManifest()).manifest.vaultId, status, sync, catalog, lesson, exercise, snapshotStore: store, manifestPath: MANIFEST_PATH }
}

function lessonSummary(lesson) {
  return {
    contentId: lesson.contentId,
    primaryTopicId: lesson.primaryTopicId,
    title: lesson.title,
    subject: lesson.subject,
    language: lesson.language,
    objective: lesson.objective,
    lessonKind: lesson.lessonKind,
    stageIds: lesson.stageIds,
    prerequisiteRefs: lesson.prerequisiteRefs,
    exerciseIds: lesson.exerciseIds,
    executionPolicy: lesson.executionPolicy,
    estimatedMinutes: lesson.estimatedMinutes,
    verificationStatus: lesson.verificationStatus,
    sourceIds: lesson.sourceIds,
    sourcePath: lesson.reading?.path ?? lesson.sectionRefs?.[0]?.path ?? null,
    sourceHeadingPath: lesson.reading?.headingPath ?? lesson.sectionRefs?.[0]?.headingPath ?? null,
    legacyRefs: lesson.legacyRefs,
  }
}
