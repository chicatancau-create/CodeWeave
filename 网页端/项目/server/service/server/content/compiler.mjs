/**
 * 内容编译器（LINK-04）：资料库 → 候选内容包。
 *
 * 单向只读：只读资料库，绝不写回任何知识正文、进度或日志。
 * 输出是**派生包**（写进应用数据目录），失败时不发布，旧包继续可用。
 *
 * 主要职责：
 * 1. 白名单扫描「复习大纲」正式正文（knowledge-volume / knowledge-extension）。
 * 2. 维护稳定 topicId 登记（主题移动只更新定位，不重新分配 ID）。
 * 3. 解析教学单元与练习契约，做引用与结构校验。
 * 4. 校验规则投影的来源 hash；源标准变化时规则置 stale，不覆盖上次有效规则。
 * 5. 产出候选包 + 差异/缺口报告。
 */
import { readFile } from 'node:fs/promises'
import {
  ContentError,
  findSection,
  headings,
  normalizeText,
  parseRestrictedFrontmatter,
  parseSectionRef,
  sha256,
  stableStringify,
  topicsFromVolume,
} from './markdown.mjs'
import { listMarkdownFiles, readVaultText, resolveVaultRoot } from './vault-paths.mjs'
import { VERIFICATION_STATUS, checkSourceConsistency, loadSourceCards } from './sources.mjs'
import {
  DEFAULT_TOPIC_INDEX_PATH,
  classifyTopic,
  diffTopicIndex,
  isPublishable,
  isTeachable,
  parseTopicIndex,
  reconcileTopicCounts,
} from './topic-spec.mjs'
import { ID_MAP_SCHEMA_VERSION, parseIdMap, planIdMap } from './id-map.mjs'

export const COMPILER_VERSION = 2
export const BUNDLE_SCHEMA_VERSION = 1
export const LESSON_KINDS = ['reading', 'example', 'guided', 'exercise', 'project']
export const UNIT_STATUS = ['draft', 'published', 'retired']
export const EXECUTION_POLICIES = ['worker', 'teaching', 'external']
export const RELATION_KINDS = ['exact', 'partial', 'split', 'merge', 'unmapped']
export const REVIEW_STATUS = ['pending', 'reviewed', 'blocked']
export const TOPIC_HASH_FIELDS = ['topicId', 'path', 'headingPath', 'contentHash']

/** 允许纳入课程包的正文类型与排除项由 manifest 的 publishWhitelist 决定。 */
function whitelistOf(manifest) {
  const list = manifest?.publishWhitelist
  if (!list || typeof list !== 'object') {
    throw new ContentError('invalid_manifest', 'manifest 缺少 publishWhitelist')
  }
  return {
    contentRoot: list.contentRoot ?? '复习大纲',
    contentTypes: list.contentTypes ?? ['knowledge-volume', 'knowledge-extension'],
    excludedPathSegments: list.excludedPathSegments ?? [],
    excludedPathPrefixes: list.excludedPathPrefixes ?? [],
    teachingUnitDir: list.teachingUnitDir ?? 'CodeWeave/教学单元',
    exerciseDir: list.exerciseDir ?? 'CodeWeave/练习',
    sourceRoot: list.sourceRoot ?? '知识来源',
    rulesPath: list.rulesPath ?? 'CodeWeave/rules/teaching-rules.json',
    legacyMapPath: list.legacyMapPath ?? 'CodeWeave/mappings/legacy-map.json',
    topicIdMapPath: list.topicIdMapPath ?? 'CodeWeave/mappings/topic-id-map.json',
    topicIndexPath: list.topicIndexPath ?? DEFAULT_TOPIC_INDEX_PATH,
  }
}

async function readJsonIfExists(root, relPath) {
  try {
    return JSON.parse(normalizeText(await readFile(`${root}/${relPath}`, 'utf8')))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    if (error instanceof SyntaxError) {
      throw new ContentError('invalid_manifest', `${relPath}: JSON 解析失败 ${error.message}`)
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// 主题登记：稳定 ID 分配
// ---------------------------------------------------------------------------
export function topicKey(path, headingPath) {
  return `${path}#${headingPath.join(' > ')}`
}

export function formatSectionRef(path, headingPath) {
  return `${path}#${headingPath.join(' > ')}`
}

/**
 * 用扫描结果刷新主题登记表（DATA-03）。
 * 顺序：显式迁移映射 → 精确命中 → 唯一标题链的移动 → 新增。
 * - 显式映射（topic-id-map.json）完全决定归属，优先于任何猜测；
 * - 精确命中（路径 + 标题链）→ 保留原 ID；
 * - 标题链相同且只有唯一候选、原文件已消失 → 视为移动，保留原 ID 并记 movedFrom；
 * - 同文件里旧标题消失、新标题出现而**没有**映射 → 阻断 `id_map_required`，改名不自动继承；
 * - 多个候选 → 阻断 `id_map_ambiguous`，要求指定归属；
 * - 其余新增 → 追加新 ID；消失的标记 retired 并写明退役原因，不删除记录。
 */
export function refreshTopicRegistry(existing, scanned, startSeq, idMapEntries = []) {
  const registry = existing.map((topic) => ({ ...topic }))
  const byId = new Map(registry.map((topic) => [topic.topicId, topic]))
  const liveKeys = new Set(scanned.map((topic) => topicKey(topic.path, topic.headingPath)))
  const livePaths = new Set(scanned.map((topic) => topic.path))

  const homeless = new Map()
  for (const topic of registry) {
    if (liveKeys.has(topicKey(topic.path, topic.headingPath))) continue
    if (topic.status === 'retired') continue
    const key = topic.headingPath.join(' > ')
    if (!homeless.has(key)) homeless.set(key, [])
    homeless.get(key).push(topic)
  }

  const plan = planIdMap({ entries: idMapEntries, registry, scanned })
  const seqOf = (topic) => Number(/(\d+)$/.exec(topic.topicId)?.[1] ?? 0)
  let seq = Math.max(startSeq, ...registry.map(seqOf), 0)
  const added = []
  const moved = []
  const retired = []
  const autoRetired = []

  // 第 1 步：显式映射优先，且完全决定归属——不靠相似标题猜。
  for (const { entry, topicId, target } of plan.applied) {
    const topic = byId.get(topicId)
    if (!target) {
      if (topic.status !== 'retired') retired.push(topicId)
      topic.status = 'retired'
      topic.movedFrom = undefined
      topic.retiredReason = `显式退役（${entry.change}）：${entry.reason}`
      continue
    }
    const previousPath = topic.path
    Object.assign(topic, {
      path: target.path,
      headingPath: target.headingPath,
      title: target.title,
      level: target.level,
      line: target.line,
      topicKind: target.topicKind,
      sourceIds: target.sourceIds,
      verificationStatus: target.verificationStatus,
      contentHash: target.contentHash,
      fileHash: target.fileHash,
      isEmpty: target.isEmpty,
      status: 'active',
      retiredReason: undefined,
      idMapChange: entry.change,
      movedFrom: previousPath === target.path ? undefined : previousPath,
    })
    if (previousPath !== target.path) moved.push({ topicId, from: previousPath, to: target.path, via: 'id-map' })
  }
  const byKey = new Map(registry.map((topic) => [topicKey(topic.path, topic.headingPath), topic]))
  const mappedTargets = new Set(plan.applied.filter((item) => item.target).map((item) => topicKey(item.target.path, item.target.headingPath)))

  // 第 2 步：未被映射覆盖的主题。
  for (const topic of scanned) {
    const key = topicKey(topic.path, topic.headingPath)
    const exact = byKey.get(key)
    if (exact && !mappedTargets.has(key)) {
      Object.assign(exact, {
        title: topic.title,
        level: topic.level,
        line: topic.line,
        headingPath: topic.headingPath,
        topicKind: topic.topicKind,
        sourceIds: topic.sourceIds,
        verificationStatus: topic.verificationStatus,
        contentHash: topic.contentHash,
        fileHash: topic.fileHash,
        isEmpty: topic.isEmpty,
        status: 'active',
        movedFrom: undefined,
        retiredReason: undefined,
        idMapChange: undefined,
      })
      continue
    }
    if (exact) continue // 已由显式映射落到这个位置

    const candidates = (homeless.get(topic.headingPath.join(' > ')) ?? []).filter((entry) => !entry.consumed)
    const reusable = candidates.filter((entry) => !livePaths.has(entry.path) && entry.status !== 'retired')
    if (reusable.length === 1) {
      const entry = reusable[0]
      entry.consumed = true
      const previousPath = entry.path
      Object.assign(entry, {
        path: topic.path,
        title: topic.title,
        level: topic.level,
        line: topic.line,
        topicKind: topic.topicKind,
        sourceIds: topic.sourceIds,
        verificationStatus: topic.verificationStatus,
        contentHash: topic.contentHash,
        fileHash: topic.fileHash,
        isEmpty: topic.isEmpty,
        status: 'active',
        retiredReason: undefined,
        movedFrom: previousPath === topic.path ? undefined : previousPath,
      })
      if (previousPath !== topic.path) moved.push({ topicId: entry.topicId, from: previousPath, to: topic.path, via: 'unique-heading-path' })
      continue
    }
    if (reusable.length > 1) {
      plan.problems.push({
        code: 'id_map_ambiguous',
        path: topic.path,
        message: `${topicKey(topic.path, topic.headingPath)} 有多个同标题链的候选 ID（${reusable.map((item) => item.topicId).join('、')}），必须由 topic-id-map.json 指定归属，不得靠相似标题继承`,
      })
      continue
    }
    // 同文件里消失了旧标题、出现了新标题 = 改名。改名必须留映射记录。
    const vanishedHere = registry.filter(
      (entry) => entry.path === topic.path && entry.status !== 'retired' && !liveKeys.has(topicKey(entry.path, entry.headingPath)),
    )
    if (vanishedHere.length > 0) {
      plan.problems.push({
        code: 'id_map_required',
        path: topic.path,
        message: `${topic.path} 内标题改名后出现新主题 ${topicKey(topic.path, topic.headingPath)}，但 ${vanishedHere.map((e) => `${e.topicId}(${e.headingPath.join(' > ')})`).join('、')} 没有显式映射。改名必须经 topic-id-map.json 记录，不自动继承。`,
      })
      continue
    }
    seq += 1
    const entry = {
      topicId: `topic-${String(seq).padStart(4, '0')}`,
      path: topic.path,
      headingPath: topic.headingPath,
      title: topic.title,
      level: topic.level,
      line: topic.line,
      topicKind: topic.topicKind,
      sourceIds: topic.sourceIds,
      verificationStatus: topic.verificationStatus,
      contentHash: topic.contentHash,
      fileHash: topic.fileHash,
      isEmpty: topic.isEmpty,
      status: 'active',
    }
    registry.push(entry)
    byId.set(entry.topicId, entry)
    byKey.set(topicKey(entry.path, entry.headingPath), entry)
    added.push(entry.topicId)
  }

  for (const topic of registry) {
    if (topic.status === 'retired') continue
    if (!liveKeys.has(topicKey(topic.path, topic.headingPath))) {
      topic.status = 'retired'
      topic.movedFrom = undefined
      topic.retiredReason = 'auto:来源标题消失或被移动，且没有显式迁移映射'
      retired.push(topic.topicId)
      autoRetired.push(topic.topicId)
    }
  }

  registry.sort((a, b) => a.topicId.localeCompare(b.topicId))
  return { registry, nextSeq: seq, added, moved, retired, autoRetired, problems: plan.problems }
}

// ---------------------------------------------------------------------------
// 正文扫描
// ---------------------------------------------------------------------------
export async function scanVolumes(root, manifest) {
  const wl = whitelistOf(manifest)
  const files = await listMarkdownFiles(root, wl.contentRoot, { skipDirs: wl.excludedPathSegments })
  const volumes = []
  const topics = []
  const problems = []
  for (const path of files) {
    const rel = path.slice(`${wl.contentRoot}/`.length)
    if (wl.excludedPathSegments.some((seg) => rel.split('/').includes(seg))) continue
    if (wl.excludedPathPrefixes.some((prefix) => path.startsWith(prefix))) continue
    const text = await readVaultText(root, path)
    const fileHash = sha256(text)
    let front
    try {
      front = parseRestrictedFrontmatter(text, path)
    } catch (error) {
      problems.push({ code: error.code ?? 'frontmatter_error', path, message: error.message })
      continue
    }
    const kind = front.fields.type
    if (!front.present || !wl.contentTypes.includes(kind)) continue
    const levels = parseLevels(front.fields.topic_levels, path)
    const sourceIds = asList(front.fields.source_ids)
    const verificationStatus = asList(front.fields.verification_status)[0]
      ?? (manifest.sourceRegistry?.[sourceIds[0]]?.verificationStatus)
      ?? '未核验'
    const volume = {
      path,
      kind,
      levels,
      updated: front.fields.updated ?? null,
      sourceIds,
      verificationStatus,
      fileHash,
      title: null,
      topicCount: 0,
      duplicateTitles: [],
    }
    const sections = topicsFromVolume(text, levels)
    const seen = new Map()
    for (const section of sections) {
      if (section.level === 1 && !volume.title) volume.title = section.title
      const titleCount = (seen.get(section.title) ?? 0) + 1
      seen.set(section.title, titleCount)
      const headingPath = [...section.headingPath, section.title]
      const contentHash = sha256(stableStringify({ headingPath, body: section.bodyText }))
      topics.push({
        path,
        headingPath,
        title: section.title,
        level: section.level,
        line: section.line,
        topicKind: classifyTopic({ volumeKind: kind, title: section.title, isEmpty: section.isEmpty }),
        sourceIds,
        verificationStatus,
        contentHash,
        fileHash,
        isEmpty: section.isEmpty,
        bodyText: section.bodyText,
      })
    }
    volume.topicCount = sections.length
    volume.duplicateTitles = [...seen.entries()].filter(([, count]) => count > 1).map(([title]) => title)
    if (volume.duplicateTitles.length > 0) {
      problems.push({
        code: 'ambiguous_heading',
        path,
        message: `同名标题必须用父标题链定位，当前重复：${volume.duplicateTitles.join('、')}`,
      })
    }
    if (topics.length === 0) {
      problems.push({ code: 'empty_volume', path, message: '声明为正式正文但没有主题标题' })
    }
    volumes.push(volume)
  }
  return { volumes, topics, problems }
}

function parseLevels(raw, path) {
  const value = String(raw ?? '').trim()
  if (!value) return [2]
  const text = /^\[(.*)\]$/.exec(value) ? /^\[(.*)\]$/.exec(value)[1] : value
  const levels = text.split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
    if (!/^\d+$/.test(item)) {
      throw new ContentError('invalid_topic_levels', `${path}: topic_levels 只能是标题层级数字，实际 ${raw}`)
    }
    const level = Number(item)
    if (level < 1 || level > 6) {
      throw new ContentError('invalid_topic_levels', `${path}: topic_levels 必须在 1—6，实际 ${raw}`)
    }
    return level
  })
  return [...new Set(levels)].sort((a, b) => a - b)
}

function asList(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== '')
  if (value === undefined || value === '') return []
  return [value]
}

// ---------------------------------------------------------------------------
// 教学单元与练习
// ---------------------------------------------------------------------------
export async function loadTeachingUnits(root, manifest) {
  const wl = whitelistOf(manifest)
  const files = await listMarkdownFiles(root, wl.teachingUnitDir)
  const units = []
  const problems = []
  for (const path of files) {
    const text = await readVaultText(root, path)
    const sourceHash = sha256(text)
    let front
    try {
      front = parseRestrictedFrontmatter(text, path)
    } catch (error) {
      problems.push({ code: error.code ?? 'frontmatter_error', path, message: error.message })
      continue
    }
    if (front.fields.type !== 'teaching-unit') {
      problems.push({ code: 'invalid_unit', path, message: '教学单元文件必须声明 type: teaching-unit' })
      continue
    }
    try {
      validateUnitFields(front.fields, path)
    } catch (error) {
      problems.push({ code: error.code ?? 'invalid_unit', path, message: error.message })
      continue
    }
    const sectionRefs = asList(front.fields.sectionRefs).map((raw) => parseSectionRef(raw, path))
    const body = text.split('\n').slice(front.bodyStartLine - 1).join('\n').trim()
    units.push({
      path,
      sourceHash,
      contentId: front.fields.contentId,
      primaryTopicId: front.fields.primaryTopicId,
      primaryTopicRef: front.fields.primaryTopicRef ? parseSectionRef(front.fields.primaryTopicRef, path) : null,
      stageIds: asList(front.fields.stageIds),
      titleRef: front.fields.titleRef,
      subject: front.fields.subject,
      language: front.fields.language,
      objective: front.fields.objective,
      lessonKind: front.fields.lessonKind,
      prerequisiteRefs: asList(front.fields.prerequisiteRefs),
      sectionRefs,
      exerciseIds: asList(front.fields.exerciseIds),
      projectTaskRef: front.fields.projectTaskRef || null,
      runEnvironment: front.fields.runEnvironment || 'external',
      executionPolicy: front.fields.executionPolicy || (front.fields.runEnvironment === 'teaching' ? 'teaching' : 'external'),
      estimatedMinutes: front.fields.estimatedMinutes ? Number(front.fields.estimatedMinutes) : null,
      reviewOffsetsDays: asList(front.fields.reviewOffsetsDays).map(Number),
      verificationStatus: front.fields.verificationStatus ?? '未核验',
      sourceIds: asList(front.fields.sourceIds),
      status: front.fields.status ?? 'draft',
      legacyRefs: asList(front.fields.legacyRefs),
      notes: body,
    })
  }
  return { units, problems }
}

function requireField(fields, key, path) {
  const value = fields[key]
  if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
    throw new ContentError('invalid_unit', `${path}: 缺少必填字段 ${key}`)
  }
  return value
}

function validateUnitFields(fields, path) {
  if (String(fields.schemaVersion) !== String(BUNDLE_SCHEMA_VERSION)) {
    throw new ContentError('invalid_unit', `${path}: schemaVersion 必须为 ${BUNDLE_SCHEMA_VERSION}`)
  }
  for (const key of ['contentId', 'primaryTopicId', 'primaryTopicRef', 'stageIds', 'titleRef', 'objective', 'lessonKind', 'status', 'subject', 'language']) {
    requireField(fields, key, path)
  }
  if (!/^[A-Za-z0-9+#. -]+$/.test(fields.subject)) {
    throw new ContentError('invalid_unit', `${path}: subject 只接受简短科目名`)
  }
  if (!/^[a-z+#.-]+$/i.test(fields.language)) {
    throw new ContentError('invalid_unit', `${path}: language 只接受简短标识（无可执行语言时写 none）`)
  }
  if (!LESSON_KINDS.includes(fields.lessonKind)) {
    throw new ContentError('invalid_unit', `${path}: lessonKind 必须是 ${LESSON_KINDS.join('/')}`)
  }
  if (!UNIT_STATUS.includes(fields.status)) {
    throw new ContentError('invalid_unit', `${path}: status 必须是 ${UNIT_STATUS.join('/')}`)
  }
  if (!EXECUTION_POLICIES.includes(fields.executionPolicy ?? (fields.runEnvironment === 'teaching' ? 'teaching' : 'external'))) {
    throw new ContentError('invalid_unit', `${path}: executionPolicy 必须是 ${EXECUTION_POLICIES.join('/')}`)
  }
  if (fields.verificationStatus && !VERIFICATION_STATUS.includes(fields.verificationStatus)) {
    throw new ContentError('invalid_unit', `${path}: verificationStatus 必须是 ${VERIFICATION_STATUS.join('/')}`)
  }
  if (fields.reviewOffsetsDays !== undefined && !Array.isArray(fields.reviewOffsetsDays)) {
    throw new ContentError('invalid_unit', `${path}: reviewOffsetsDays 需为行内列表 [0, 1, 3]`)
  }
}

export async function loadExercises(root, manifest) {
  const wl = whitelistOf(manifest)
  const files = await listMarkdownFiles(root, wl.exerciseDir)
  const exercises = []
  const problems = []
  for (const path of files) {
    const text = await readVaultText(root, path)
    const sourceHash = sha256(text)
    let front
    try {
      front = parseRestrictedFrontmatter(text, path)
    } catch (error) {
      problems.push({ code: error.code ?? 'frontmatter_error', path, message: error.message })
      continue
    }
    if (front.fields.type !== 'exercise') {
      problems.push({ code: 'invalid_exercise', path, message: '练习文件必须声明 type: exercise' })
      continue
    }
    try {
      for (const key of ['exerciseId', 'primaryLessonId', 'title', 'prompt', 'executionPolicy', 'version']) {
        requireField(front.fields, key, path)
      }
      if (!EXECUTION_POLICIES.includes(front.fields.executionPolicy)) {
        throw new ContentError('invalid_exercise', `${path}: executionPolicy 必须是 ${EXECUTION_POLICIES.join('/')}`)
      }
      if (front.fields.language && !/^[a-z+#-]+$/i.test(front.fields.language)) {
        throw new ContentError('invalid_exercise', `${path}: language 只接受简短标识`)
      }
    } catch (error) {
      problems.push({ code: error.code ?? 'invalid_exercise', path, message: error.message })
      continue
    }
    const body = text.split('\n').slice(front.bodyStartLine - 1).join('\n')
    const starterMatch = /```([\w+#-]*)\n([\s\S]*?)```/.exec(body)
    exercises.push({
      path,
      sourceHash,
      exerciseId: front.fields.exerciseId,
      primaryLessonId: front.fields.primaryLessonId,
      supportingTopicIds: asList(front.fields.supportingTopicIds),
      title: front.fields.title,
      prompt: front.fields.prompt,
      inputConvention: front.fields.inputConvention ?? '',
      testCases: asList(front.fields.testCases),
      hintLevels: asList(front.fields.hintLevels),
      executionPolicy: front.fields.executionPolicy,
      language: front.fields.language ?? 'none',
      version: Number(front.fields.version),
      starterCode: starterMatch ? starterMatch[2].replace(/\n$/, '') : '',
      starterLanguage: starterMatch ? starterMatch[1] || 'text' : 'text',
      expectedOutput: asList(front.fields.expectedOutput),
      evidenceChecklist: asList(front.fields.evidenceChecklist),
      rubric: asList(front.fields.rubric),
      notes: body.trim(),
    })
  }
  return { exercises, problems }
}

// ---------------------------------------------------------------------------
// 规则投影（DATA-01）
// ---------------------------------------------------------------------------

/** v2 起按「明确规则段」取版本指纹；v1 的整文件 hash 继续可读，不使旧投影静默失效。 */
export const RULE_SCHEMA_VERSION = 2

export function ruleSourcePaths(rules) {
  const paths = new Set(Object.keys(rules?.sourceHashes ?? {}))
  for (const section of rules?.ruleSections ?? []) if (section?.path) paths.add(section.path)
  return [...paths]
}

/**
 * 读取规则来源并逐段定位。定位失败原样带出 `located: false`，不静默忽略，
 * 也不允许把几个同级标题拼成一条祖先链——findSection 只认真实祖先链。
 */
export async function loadRuleSources(root, rules) {
  const texts = {}
  for (const path of ruleSourcePaths(rules)) {
    try {
      texts[path] = normalizeText(await readVaultText(root, path))
    } catch {
      texts[path] = null
    }
  }
  const fileHashes = {}
  for (const [path, text] of Object.entries(texts)) fileHashes[path] = text === null ? null : sha256(text)

  const sections = (rules?.ruleSections ?? []).map((section) => {
    const text = section?.path ? (texts[section.path] ?? null) : null
    const found = text === null ? null : findSection(text, section.headingPath)
    const review = rules?.sectionReviews?.[String(section?.id ?? '')]
    return {
      id: String(section?.id ?? ''),
      path: String(section?.path ?? ''),
      headingPath: [...(section?.headingPath ?? [])],
      covers: [...(section?.covers ?? [])],
      sourceReadable: text !== null,
      located: Boolean(found),
      fingerprint: found ? sha256(normalizeText(found.bodyText)) : null,
      // 审阅记录：谁在哪一天核对了这一段，指纹是多少。
      reviewedAt: review?.reviewedAt ?? null,
      reviewer: review?.reviewer ?? null,
      reviewedFingerprint: review?.fingerprint ?? null,
    }
  })
  return { fileHashes, sections }
}

function labelSection(section) {
  return `${section.id}(${section.path}#${section.headingPath.join(' > ')})`
}

export function checkRules(rules, sources) {
  if (!rules) return { status: 'missing', reason: '未配置 rules/teaching-rules.json', usable: false, sections: [] }

  if ((rules.schemaVersion ?? 1) < RULE_SCHEMA_VERSION) {
    const stale = Object.entries(rules.sourceHashes ?? {})
      .filter(([path, hash]) => sources.fileHashes[path] !== hash)
      .map(([path]) => path)
    return stale.length > 0
      ? {
          status: 'stale',
          schema: 'v1-file-hash',
          reason: `规则来源（v1 整文件指纹）已变化或被移动，需人工复核后更新 sourceHashes：${stale.join('、')}`,
          usable: false,
          sections: [],
        }
      : { status: 'current', schema: 'v1-file-hash', reason: '', usable: true, sections: [] }
  }

  const ids = sources.sections.map((section) => section.id)
  if (new Set(ids).size !== ids.length) {
    const dup = ids.filter((id, index) => ids.indexOf(id) !== index)
    return { status: 'invalid', reason: `规则段 id 重复：${dup.join('、')}`, usable: false, sections: sources.sections }
  }
  const unscoped = sources.sections.filter((section) => section.covers.length === 0)
  if (unscoped.length > 0) {
    return {
      status: 'invalid',
      reason: `规则段未声明 covers，无法判断该段授权哪些投影字段：${unscoped.map(labelSection).join('、')}`,
      usable: false,
      sections: sources.sections,
    }
  }
  if (sources.sections.length === 0) {
    return {
      status: 'invalid',
      reason: 'schemaVersion 2 但没有声明任何 ruleSections，规则投影无从验证',
      usable: false,
      sections: [],
    }
  }
  const uncovered = uncoveredRuleFamilies(rules, sources.sections)
  const unreadable = sources.sections.filter((section) => !section.sourceReadable)
  if (unreadable.length > 0) {
    return {
      status: 'section_missing',
      reason: `规则来源文件不可读取：${[...new Set(unreadable.map((s) => s.path))].join('、')}`,
      usable: false,
      sections: sources.sections,
    }
  }
  const unlocated = sources.sections.filter((section) => !section.located)
  if (unlocated.length > 0) {
    return {
      status: 'section_missing',
      reason: `规则章节定位失败，需人工核对来源标题结构（不允许静默忽略）：${unlocated.map(labelSection).join('、')}`,
      usable: false,
      sections: sources.sections,
    }
  }

  const declared = rules.sectionReviews ?? {}
  const changed = sources.sections.filter((section) => declared[section.id]?.fingerprint !== section.fingerprint)
  const dropped = Object.keys(declared).filter((id) => !ids.includes(id))
  if (changed.length > 0 || dropped.length > 0 || uncovered.length > 0) {
    const parts = []
    if (changed.length > 0) {
      parts.push(`规则段内容或复核状态待更新：${changed.map((s) => `${s.id}[${s.covers.join(',')}]`).join('、')}`)
    }
    if (dropped.length > 0) parts.push(`规则投影中移除了已登记的规则段：${dropped.join('、')}`)
    if (uncovered.length > 0) parts.push(`投影字段缺少规则段授权，不能靠删除规则段关闭门禁：${uncovered.join('、')}`)
    return {
      status: 'stale',
      schema: 'v2-section-fingerprint',
      reason: `规则来源已变化，需人工复核后更新 sectionReviews（重算：node scripts/content-check.mjs --rule-hashes）。${parts.join('；')}`,
      usable: false,
      sections: sources.sections,
    }
  }
  return { status: 'current', schema: 'v2-section-fingerprint', reason: '', usable: true, sections: sources.sections }
}

// ---------------------------------------------------------------------------
// 引用校验
// ---------------------------------------------------------------------------
function validateCrossReferences({ units, exercises, topicByKey, topicById, volumes, rulesCheck, legacyMap, stageIds }) {
  const blocking = []
  const contentIds = new Set()
  const exerciseIds = new Set()
  const sceneIds = new Set(exercises.map((exercise) => exercise.exerciseId))

  for (const unit of units) {
    if (contentIds.has(unit.contentId)) {
      blocking.push({ code: 'duplicate_content_id', path: unit.path, message: `contentId 重复：${unit.contentId}` })
    }
    contentIds.add(unit.contentId)
  }
  for (const exercise of exercises) {
    if (exerciseIds.has(exercise.exerciseId)) {
      blocking.push({ code: 'duplicate_exercise_id', path: exercise.path, message: `exerciseId 重复：${exercise.exerciseId}` })
    }
    exerciseIds.add(exercise.exerciseId)
  }

  const published = units.filter((unit) => unit.status === 'published')
  for (const unit of published) {
    const topic = topicById.get(unit.primaryTopicId)
    if (!topic) {
      blocking.push({ code: 'unknown_topic', path: unit.path, message: `primaryTopicId 未登记：${unit.primaryTopicId}` })
    } else if (topic.status !== 'active') {
      blocking.push({ code: 'retired_topic', path: unit.path, message: `主主题已停用：${unit.primaryTopicId}` })
    } else if (unit.primaryTopicRef) {
      const resolvedKey = topicKey(unit.primaryTopicRef.path, unit.primaryTopicRef.headingPath)
      if (resolvedKey !== topicKey(topic.path, topic.headingPath)) {
        blocking.push({
          code: 'source_mismatch',
          path: unit.path,
          message: `primaryTopicRef 与 primaryTopicId 指向不同主题：${formatSectionRef(unit.primaryTopicRef.path, unit.primaryTopicRef.headingPath)} ≠ ${formatSectionRef(topic.path, topic.headingPath)}`,
        })
      }
    }
    for (const ref of unit.sectionRefs) {
      const key = topicKey(ref.path, ref.headingPath)
      if (!topicByKey.has(key)) {
        blocking.push({ code: 'source_not_found', path: unit.path, message: `章节引用不存在：${formatSectionRef(ref.path, ref.headingPath)}` })
      }
    }
    for (const stageId of unit.stageIds) {
      if (!stageIds.has(stageId)) {
        blocking.push({ code: 'unknown_stage', path: unit.path, message: `阶段未在规则投影中定义：${stageId}` })
      }
    }
    for (const exerciseId of unit.exerciseIds) {
      if (!sceneIds.has(exerciseId)) {
        blocking.push({ code: 'missing_exercise', path: unit.path, message: `引用了不存在的练习：${exerciseId}` })
      }
    }
    if (unit.sectionRefs.length === 0 && !unit.primaryTopicRef) {
      blocking.push({ code: 'empty_source', path: unit.path, message: '教学单元必须至少有一个来源引用' })
    }
    if (!rulesCheck.usable && unit.stageIds.length > 0) {
      const code = rulesCheck.status === 'section_missing' || rulesCheck.status === 'invalid' ? 'rules_section_unverifiable' : 'rules_stale'
      blocking.push({ code, path: unit.path, message: rulesCheck.reason })
    }
  }

  const unitById = new Map(units.map((unit) => [unit.contentId, unit]))
  for (const exercise of exercises) {
    const unit = unitById.get(exercise.primaryLessonId)
    if (!unit) {
      blocking.push({ code: 'missing_lesson', path: exercise.path, message: `primaryLessonId 不存在：${exercise.primaryLessonId}` })
    } else if (exercise.executionPolicy !== unit.executionPolicy) {
      blocking.push({
        code: 'policy_mismatch',
        path: exercise.path,
        message: `练习执行策略(${exercise.executionPolicy})与教学单元(${unit.executionPolicy})不一致`,
      })
    }
  }

  const cycle = findPrerequisiteCycle(units)
  if (cycle) {
    blocking.push({ code: 'prerequisite_cycle', message: `先备知识存在循环：${cycle.join(' → ')}` })
  }

  const legacyProblems = validateLegacyMap(legacyMap, { topicById, contentIds, stageIds })
  blocking.push(...legacyProblems)

  // 正式正文里「有内容但没有单元」的主题计入缺口，不阻止发布。
  const coveredTopicIds = new Set(published.map((unit) => unit.primaryTopicId))
  // 覆盖率分母只算正式主题：兼容指针不上架，空容器无可教学内容（DATA-02）。
  const gaps = {
    emptyTopics: [...topicById.values()].filter((topic) => topic.status === 'active' && topic.topicKind === 'container').map((topic) => topic.topicId),
    uncoveredTopics: [...topicById.values()]
      .filter((topic) => topic.status === 'active' && isTeachable(topic) && !coveredTopicIds.has(topic.topicId))
      .map((topic) => topic.topicId),
    // 练习覆盖只看「需要练习」的单元：清单 §7 要求纯阅读单元单列，
    // 既不留在分母里冒充缺口，也不静默丢掉（下面那一项就是给审计看的）。
    publishedWithoutExercise: published.filter((unit) => unit.exerciseIds.length === 0 && unit.lessonKind !== 'reading').map((unit) => unit.contentId),
    readingWithoutExercise: published.filter((unit) => unit.exerciseIds.length === 0 && unit.lessonKind === 'reading').map((unit) => unit.contentId),
    unmappedLegacy: (legacyMap?.entries ?? []).filter((entry) => entry.relation === 'unmapped').map((entry) => entry.legacyId),
    volumesWithoutUnit: volumes
      .filter((volume) => !published.some((unit) => unit.sectionRefs.some((ref) => ref.path === volume.path) || unit.primaryTopicRef?.path === volume.path))
      .map((volume) => volume.path),
  }
  return { blocking, gaps, publishedContentIds: published.map((unit) => unit.contentId) }
}

function findPrerequisiteCycle(units) {
  const graph = new Map(units.map((unit) => [unit.contentId, unit.prerequisiteRefs.filter((ref) => units.some((item) => item.contentId === ref))]))
  const state = new Map()
  const stack = []
  let found = null
  function visit(node) {
    if (found) return
    const current = state.get(node)
    if (current === 'done') return
    if (current === 'visiting') {
      found = [...stack.slice(stack.indexOf(node)), node]
      return
    }
    state.set(node, 'visiting')
    stack.push(node)
    for (const next of graph.get(node) ?? []) visit(next)
    stack.pop()
    state.set(node, 'done')
  }
  for (const node of graph.keys()) visit(node)
  return found
}

export function validateLegacyMap(legacyMap, { topicById, contentIds, stageIds }) {
  const problems = []
  if (!legacyMap) return problems
  if (!Array.isArray(legacyMap.entries)) {
    problems.push({ code: 'invalid_legacy_map', message: 'legacy-map.json 缺少 entries 数组' })
    return problems
  }
  const seen = new Set()
  for (const entry of legacyMap.entries) {
    const where = entry.legacyId ?? '(缺少 legacyId)'
    if (!entry.legacyId) problems.push({ code: 'invalid_legacy_map', message: '存在缺少 legacyId 的映射条目' })
    else if (seen.has(entry.legacyId)) problems.push({ code: 'invalid_legacy_map', message: `legacyId 重复：${entry.legacyId}` })
    else seen.add(entry.legacyId)
    if (entry.relation && !RELATION_KINDS.includes(entry.relation)) {
      problems.push({ code: 'invalid_legacy_map', message: `${where}: relation 非法 ${entry.relation}` })
    }
    if (entry.reviewStatus && !REVIEW_STATUS.includes(entry.reviewStatus)) {
      problems.push({ code: 'invalid_legacy_map', message: `${where}: reviewStatus 非法 ${entry.reviewStatus}` })
    }
    if (entry.relation !== 'unmapped' && entry.topicId && !topicById.has(entry.topicId)) {
      problems.push({ code: 'invalid_legacy_map', message: `${where}: topicId 未登记 ${entry.topicId}` })
    }
    if (entry.newContentId && !contentIds.has(entry.newContentId)) {
      problems.push({ code: 'invalid_legacy_map', message: `${where}: newContentId 未声明 ${entry.newContentId}` })
    }
    for (const stageId of entry.newStageIds ?? []) {
      if (!stageIds.has(stageId)) problems.push({ code: 'invalid_legacy_map', message: `${where}: newStageIds 含未定义阶段 ${stageId}` })
    }
  }
  return problems
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
export async function compileContent({ manifest, rootOverride, previousBundle = null, maxTopicBytes = 200_000 } = {}) {
  const resolved = resolveVaultRoot(rootOverride ?? process.env.CODEWEAVE_VAULT_ROOT)
  if (!resolved.ok) {
    return {
      ok: false,
      code: 'vault_unavailable',
      reason: resolved.reason,
      message: resolved.reason === 'unconfigured'
        ? '未配置资料库根（CODEWEAVE_VAULT_ROOT 或 config/codeweave.local.json），资料库未连接'
        : resolved.reason === 'config_invalid'
          ? `本机配置无法解析，资料库未连接：${resolved.detail}`
          : `资料库根不可用（${resolved.reason}）：${rootOverride ?? process.env.CODEWEAVE_VAULT_ROOT ?? '配置或工程相对默认'}`,
    }
  }
  const root = resolved.root
  const wl = whitelistOf(manifest)

  const scan = await scanVolumes(root, manifest)
  const scannedTopics = scan.topics

  const idMapRaw = await readJsonIfExists(root, wl.topicIdMapPath)
  if (idMapRaw && (idMapRaw.schemaVersion ?? 1) > ID_MAP_SCHEMA_VERSION) {
    return {
      ok: false,
      code: 'unsupported_id_map',
      reason: 'unsupported_schema',
      message: `${wl.topicIdMapPath}: schemaVersion ${idMapRaw.schemaVersion} 高于本版本支持的 ${ID_MAP_SCHEMA_VERSION}，请先升级应用`,
    }
  }
  const idMap = parseIdMap(idMapRaw, wl.topicIdMapPath)
  const { registry, added, moved, retired, autoRetired, problems: idMapProblems } = refreshTopicRegistry(
    manifest.topics ?? [],
    scannedTopics,
    (manifest.topics ?? []).reduce((max, topic) => Math.max(max, Number(/(\d+)$/.exec(topic.topicId)?.[1] ?? 0)), 0),
    idMap.entries,
  )

  // ID 登记表是源资产：历史里有过主题而现在登记表为空 = 被当缓存清空了，必须恢复而不是重建。
  const registryReset = (manifest.topics ?? []).length === 0 && (previousBundle?.topics?.length ?? 0) > 0

  const bodyByKey = new Map(scannedTopics.map((topic) => [topicKey(topic.path, topic.headingPath), topic]))
  const topicById = new Map(registry.map((topic) => [topic.topicId, topic]))
  const topicByKey = new Map(registry.map((topic) => [topicKey(topic.path, topic.headingPath), topic]))

  const { units, problems: unitProblems } = await loadTeachingUnits(root, manifest)
  const { exercises, problems: exerciseProblems } = await loadExercises(root, manifest)
  const rules = await readJsonIfExists(root, wl.rulesPath)
  const legacyMap = await readJsonIfExists(root, wl.legacyMapPath)

  const ruleSources = await loadRuleSources(root, rules)
  const rulesCheck = checkRules(rules, ruleSources)
  const stageIds = new Set((rules?.stages ?? []).map((stage) => stage.id))

  const { blocking, gaps, publishedContentIds } = validateCrossReferences({
    units,
    exercises,
    topicByKey,
    topicById,
    volumes: scan.volumes,
    rulesCheck,
    legacyMap,
    stageIds,
  })
  // DATA-04：发布引用的来源必须同时解析到登记项与来源卡。
  const sourceCards = await loadSourceCards(root, wl.sourceRoot, { skipDirs: wl.excludedPathSegments })
  const referencedSources = new Map()
  for (const topic of scannedTopics) {
    if (topic.isEmpty) continue
    for (const sourceId of topic.sourceIds) referencedSources.set(sourceId, (referencedSources.get(sourceId) ?? 0) + 1)
  }
  const sourceCheck = checkSourceConsistency({
    registry: manifest.sourceRegistry,
    cards: sourceCards.cards,
    referenced: referencedSources,
    sourceRoot: wl.sourceRoot,
    knownPages: sourceCards.pages,
  })

  const scanProblems = [...scan.problems, ...unitProblems, ...exerciseProblems]
  const blockingAll = [
    ...blocking,
    ...sourceCheck.blocking,
    ...sourceCards.problems,
    ...idMap.problems,
    ...idMapProblems,
    ...(registryReset
      ? [
          {
            code: 'topic_registry_reset',
            path: wl.topicIdMapPath,
            message: `主题登记表为空，但上次发布的内容包里有 ${(previousBundle?.topics ?? []).length} 条主题。ID 登记是源资产，不能当缓存清空重建；请从备份恢复 content-manifest.json 的 topics。`,
          },
        ]
      : []),
    ...scanProblems.filter((problem) => problem.code !== 'empty_volume'),
  ]
  const warnings = [
    ...scanProblems.filter((problem) => problem.code === 'empty_volume'),
    ...sourceCheck.warnings,
    ...(autoRetired.length > 0
      ? [
          {
            code: 'topic_auto_retired',
            path: wl.topicIdMapPath,
            message: `${autoRetired.length} 个主题因来源消失且无显式映射而自动退役（${autoRetired.slice(0, 8).join('、')}${autoRetired.length > 8 ? ' 等' : ''}）。若这是改名或拆分，请补 topic-id-map.json 记录。`,
          },
        ]
      : []),
  ]
  const lessons = units
    .filter((unit) => unit.status === 'published')
    .map((unit) => buildLesson({ unit, topicById, bodyByKey, exercises }))
    .sort((a, b) => a.contentId.localeCompare(b.contentId))

  const exerciseList = exercises
    .filter((exercise) => publishedContentIds.includes(exercise.primaryLessonId))
    .map((exercise) => ({
      exerciseId: exercise.exerciseId,
      primaryLessonId: exercise.primaryLessonId,
      supportingTopicIds: exercise.supportingTopicIds,
      title: exercise.title,
      prompt: exercise.prompt,
      inputConvention: exercise.inputConvention,
      testCases: exercise.testCases,
      hintLevels: exercise.hintLevels,
      executionPolicy: exercise.executionPolicy,
      language: exercise.language,
      version: exercise.version,
      starterCode: exercise.starterCode,
      starterLanguage: exercise.starterLanguage,
      expectedOutput: exercise.expectedOutput,
      evidenceChecklist: exercise.evidenceChecklist,
      rubric: exercise.rubric,
      source: { path: exercise.path, sourceHash: exercise.sourceHash },
    }))
    .sort((a, b) => a.exerciseId.localeCompare(b.exerciseId))

  const rulesPublished = rulesCheck.usable
    ? { status: 'current', ...projectRules(rules, ruleSources) }
    : previousBundle?.rules?.status === 'current'
      ? { ...previousBundle.rules, status: 'stale', reason: rulesCheck.reason }
      : { status: rulesCheck.status, reason: rulesCheck.reason, stages: [], milestones: [], masteryLevels: [], hintLevels: [], reviewOffsetsDays: [] }

  const topicsOut = registry.filter(isPublishable).map((topic) => {
    const body = bodyByKey.get(topicKey(topic.path, topic.headingPath))
    if (body && body.bodyText.length > maxTopicBytes) {
      blockingAll.push({ code: 'topic_too_large', path: topic.path, message: `主题 ${topic.topicId} 正文超过单主题上限` })
    }
    return {
      topicId: topic.topicId,
      path: topic.path,
      headingPath: topic.headingPath,
      title: topic.title,
      level: topic.level,
      line: topic.line,
      topicKind: topic.topicKind,
      sourceIds: topic.sourceIds,
      verificationStatus: topic.verificationStatus,
      contentHash: topic.contentHash,
      status: topic.status,
      isEmpty: topic.isEmpty,
      movedFrom: topic.movedFrom ?? null,
    }
  })

  const core = {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    compilerVersion: COMPILER_VERSION,
    vaultId: manifest.vaultId,
    ruleVersion: rules?.ruleVersion ?? null,
    // 迁移表也是发布契约的一部分：映射改了，快照版本必须跟着变。
    mapVersion: legacyMap?.mapVersion ?? null,
    legacyMapHash: sha256(stableStringify(legacyMap?.entries ?? [])),
    rules: rulesPublished,
    stages: rulesPublished.stages ?? [],
    topics: topicsOut,
    lessons,
    exercises: exerciseList,
    volumes: scan.volumes.map((volume) => ({
      path: volume.path,
      kind: volume.kind,
      levels: volume.levels,
      updated: volume.updated,
      sourceIds: volume.sourceIds,
      verificationStatus: volume.verificationStatus,
      fileHash: volume.fileHash,
      title: volume.title,
      topicCount: volume.topicCount,
      duplicateTitles: volume.duplicateTitles,
    })),
  }
  const bundleId = sha256(stableStringify(core)).slice(0, 32)

  // DATA-02：口径必须可解释，不能只报一个总数。
  const topicReconciliation = reconcileTopicCounts(registry)
  const counts = {
    volumes: scan.volumes.length,
    topics: topicReconciliation.formalTopic,
    registeredTopics: topicReconciliation.registered,
    activeTopics: topicReconciliation.active,
    compatPointerTopics: topicReconciliation.compatPointer,
    emptyTopics: topicReconciliation.emptyContainer,
    indexAlignedTopics: topicReconciliation.indexAligned,
    lessons: lessons.length,
    exercises: exerciseList.length,
    legacyEntries: legacyMap?.entries?.length ?? 0,
  }

  // 两端同一规范下主题集合必须一致：与资料库生成的定位索引逐册比对差集。
  let topicIndexDiff = { available: false, nodeOnly: [], indexOnly: [] }
  let indexText
  try {
    indexText = normalizeText(await readVaultText(root, wl.topicIndexPath))
  } catch {
    indexText = null
  }
  if (indexText === null) {
    warnings.push({ code: 'topic_index_absent', path: wl.topicIndexPath, message: '主题定位索引不存在，无法核对两端口径（资料库侧运行 build_topic_index.py 生成）' })
  } else {
    topicIndexDiff = diffTopicIndex({ topics: registry, index: parseTopicIndex(indexText) })
    if (topicIndexDiff.nodeOnly.length > 0 || topicIndexDiff.indexOnly.length > 0) {
      const describe = (items) => items.slice(0, 8).map((item) => `${item.volume}#${item.title}`).join('、')
      blockingAll.push({
        code: 'topic_index_mismatch',
        path: wl.topicIndexPath,
        message:
          `主题口径与定位索引不一致：应用侧多 ${topicIndexDiff.nodeOnly.length} 项` +
          `${topicIndexDiff.nodeOnly.length ? `（${describe(topicIndexDiff.nodeOnly)}）` : ''}；` +
          `索引侧多 ${topicIndexDiff.indexOnly.length} 项` +
          `${topicIndexDiff.indexOnly.length ? `（${describe(topicIndexDiff.indexOnly)}）` : ''}。` +
          `两端必须使用同一主题识别规范（DATA-02）。`,
      })
    }
  }

  const bundle = {
    ...core,
    bundleId,
    buildTime: new Date().toISOString(),
    counts,
    publishedContentIds,
    diagnostics: {
      blocking: blockingAll,
      warnings,
      gaps,
    },
  }

  const nextManifest = {
    ...manifest,
    topics: registry.map((topic) => ({
      topicId: topic.topicId,
      path: topic.path,
      headingPath: topic.headingPath,
      title: topic.title,
      level: topic.level,
      line: topic.line,
      topicKind: topic.topicKind,
      sourceIds: topic.sourceIds,
      verificationStatus: topic.verificationStatus,
      contentHash: topic.contentHash,
      status: topic.status,
      ...(topic.retiredReason ? { retiredReason: topic.retiredReason } : {}),
    })),
    publishedContentIds,
  }

  // 源文件 hash 台账：扫描前记录、发布前复核，期间被改则整包重扫（§5.3 第 1 条）。
  const sourceHashes = {}
  for (const volume of scan.volumes) sourceHashes[volume.path] = volume.fileHash
  for (const unit of units) sourceHashes[unit.path] = unit.sourceHash
  for (const exercise of exercises) sourceHashes[exercise.path] = exercise.sourceHash
  for (const [path, hash] of Object.entries(ruleSources.fileHashes)) sourceHashes[path] = hash

  return {
    ok: true,
    bundle,
    nextManifest,
    report: {
      generatedAt: bundle.buildTime,
      bundleId,
      counts: bundle.counts,
      sourceHashes,
      addedTopics: added.length,
      movedTopics: moved,
      retiredTopics: retired,
      blocking: blockingAll,
      warnings,
      gaps,
      topicReconciliation,
      topicIndex: { path: wl.topicIndexPath, ...topicIndexDiff },
      rules: {
        status: rulesCheck.status,
        reason: rulesCheck.reason,
        schemaVersion: rules.schemaVersion ?? 1,
        // 报告始终反映本次扫描的规则段实况，便于人工复核定位。
        fingerprint: ruleFingerprint(rulesCheck.sections),
        sections: rulesCheck.sections,
      },
    },
  }
}

/** 投影中会出现的规则字段家族；每个非空家族都必须由某个规则段授权。 */
export const RULE_FAMILIES = [
  'milestones',
  'stages',
  'stageTestComposition',
  'masteryLevels',
  'masteryRule',
  'hintLevels',
  'reviewOffsetsDays',
  'reviewMethods',
  'reviewRule',
]

/** `stages[S3].checkpoint` 与 `stages` 都归属 stages 家族。 */
function familyOf(cover) {
  return String(cover).split(/[.[]/)[0].trim()
}

/**
 * 未被任何规则段授权的非空字段家族。
 * 没有这一条时，删掉授权段落就能把规则门禁静默关掉。
 */
export function uncoveredRuleFamilies(rules, sections) {
  const covered = new Set(sections.flatMap((section) => section.covers).map(familyOf))
  return RULE_FAMILIES.filter((family) => {
    const value = rules?.[family]
    const present = Array.isArray(value) ? value.length > 0 : Boolean(value)
    return present && !covered.has(family)
  })
}

function ruleFingerprint(sections) {
  return sections.length > 0 ? sha256(stableStringify(sections.map((section) => [section.id, section.fingerprint]))) : null
}

function projectRules(rules, ruleSources) {
  const sections = ruleSources.sections
  return {
    ruleSchemaVersion: rules.schemaVersion ?? 1,
    sourceRefs: rules.sourceRefs ?? [],
    sourceHashes: ruleSources.fileHashes,
    // 可追溯定位：每个规则段的 id / 来源 / 真实祖先链 / 指纹 / 所覆盖的投影字段。
    ruleSections: sections,
    ruleFingerprint: ruleFingerprint(sections),
    milestones: rules.milestones ?? [],
    stages: rules.stages ?? [],
    stageTestComposition: rules.stageTestComposition ?? [],
    masteryLevels: rules.masteryLevels ?? [],
    masteryRule: rules.masteryRule ?? '',
    hintLevels: rules.hintLevels ?? [],
    reviewOffsetsDays: rules.reviewOffsetsDays ?? [],
    reviewMethods: rules.reviewMethods ?? [],
    reviewRule: rules.reviewRule ?? '',
  }
}

function buildLesson({ unit, topicById, bodyByKey, exercises }) {
  const topic = topicById.get(unit.primaryTopicId)
  const body = topic ? bodyByKey.get(topicKey(topic.path, topic.headingPath)) : null
  return {
    contentId: unit.contentId,
    primaryTopicId: unit.primaryTopicId,
    title: unit.titleRef,
    subject: unit.subject,
    language: unit.language,
    objective: unit.objective,
    lessonKind: unit.lessonKind,
    stageIds: unit.stageIds,
    prerequisiteRefs: unit.prerequisiteRefs,
    exerciseIds: unit.exerciseIds,
    projectTaskRef: unit.projectTaskRef,
    runEnvironment: unit.runEnvironment,
    executionPolicy: unit.executionPolicy,
    estimatedMinutes: unit.estimatedMinutes,
    reviewOffsetsDays: unit.reviewOffsetsDays.length > 0 ? unit.reviewOffsetsDays : null,
    verificationStatus: unit.verificationStatus,
    sourceIds: unit.sourceIds,
    status: unit.status,
    legacyRefs: unit.legacyRefs,
    reading: body
      ? {
          path: topic.path,
          headingPath: topic.headingPath,
          headings: headings(body.bodyText).map(({ level, title, line }) => ({ level, title, line })),
          markdown: body.bodyText,
          contentHash: topic.contentHash,
          fileHash: topic.fileHash,
          verificationStatus: topic.verificationStatus,
        }
      : null,
    sectionRefs: unit.sectionRefs.map((ref) => ({ path: ref.path, headingPath: ref.headingPath })),
    exerciseCount: exercises.filter((exercise) => unit.exerciseIds.includes(exercise.exerciseId)).length,
    sourceHash: unit.sourceHash,
  }
}