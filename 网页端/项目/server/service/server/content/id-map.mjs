/**
 * 稳定主题 ID 的显式迁移映射（DATA-03）。
 *
 * 原则：`topicId` 是**源资产**，不是可清空重建的缓存。路径只用于定位，不兼任身份。
 * 改标题、拆分、合并必须走这里的显式映射；映射不明确时宁可阻断，也不靠相似标题猜测继承。
 *
 * 每条记录都写清「从哪来、到哪去、为什么、谁在什么时候登记」，
 * 这样旧草稿与证据引用在搬迁后仍可追溯。
 */
import { ContentError } from './markdown.mjs'

export const ID_MAP_SCHEMA_VERSION = 1
export const ID_CHANGES = ['renamed', 'moved', 'split', 'merged', 'retired', 'restored']

function locationOf(value, where, { allowNull = false } = {}) {
  if (value === null && allowNull) return null
  const path = String(value?.path ?? '').trim()
  const headingPath = Array.isArray(value?.headingPath) ? value.headingPath.map((title) => String(title).trim()).filter(Boolean) : null
  if (!path.endsWith('.md')) throw new ContentError('invalid_id_map', `${where}: path 必须以 .md 结尾，实际 ${path || '(空)'}`)
  if (!headingPath || headingPath.length === 0) throw new ContentError('invalid_id_map', `${where}: headingPath 必须是非空数组`)
  return { path, headingPath }
}

const keyOf = (location) => (location === null ? '' : `${location.path}#${location.headingPath.join(' > ')}`)
export const idMapKey = keyOf

/**
 * 解析并校验映射文件本身。文件不存在时返回空映射（首次建立库是合法状态）。
 * @returns {{ entries: Map<string, object[]>, problems: object[] }}
 */
export function parseIdMap(raw, where = 'CodeWeave/mappings/topic-id-map.json') {
  const problems = []
  const entries = []
  if (raw === null || raw === undefined) return { entries, problems }
  if (!Array.isArray(raw.entries)) {
    problems.push({ code: 'invalid_id_map', path: where, message: '缺少 entries 数组' })
    return { entries, problems }
  }
  const seen = new Set()
  raw.entries.forEach((entry, index) => {
    const label = `${where} entries[${index}]`
    const topicId = String(entry?.topicId ?? '').trim()
    const change = String(entry?.change ?? '').trim()
    if (!topicId) {
      problems.push({ code: 'invalid_id_map', path: where, message: `${label}: 缺少 topicId` })
      return
    }
    if (!ID_CHANGES.includes(change)) {
      problems.push({ code: 'invalid_id_map', path: where, message: `${label}: change 必须是 ${ID_CHANGES.join('/')}，实际 ${change || '(空)'}` })
      return
    }
    const dedupeKey = `${topicId}|${change}|${keyOf(safeLocation(entry.from))}`
    if (seen.has(dedupeKey)) {
      problems.push({ code: 'duplicate_id_map_entry', path: where, message: `${label}: 重复记录 ${topicId} / ${change}` })
      return
    }
    seen.add(dedupeKey)
    let from
    let to
    try {
      from = locationOf(entry.from, `${label}.from`)
      to = change === 'retired' ? locationOf(entry.to, `${label}.to`, { allowNull: true }) : locationOf(entry.to, `${label}.to`)
    } catch (error) {
      problems.push({ code: 'invalid_id_map', path: where, message: error.message })
      return
    }
    if (change !== 'retired' && !to) {
      problems.push({ code: 'invalid_id_map', path: where, message: `${label}: 只有 retired 允许 to 为 null` })
      return
    }
    if (!String(entry.reason ?? '').trim()) {
      problems.push({ code: 'invalid_id_map', path: where, message: `${label}: reason 必填，映射必须说明为什么` })
      return
    }
    if ((change === 'split' || change === 'merged') && Array.isArray(entry.successorIds) && entry.successorIds.length > 0) {
      const successors = entry.successorIds.map(String)
      // 拆分/合并必须点名由哪一个 ID 继承历史；其余后继在下一轮扫描时才拿到新 ID。
      if (!successors.includes(topicId)) {
        problems.push({ code: 'invalid_id_map', path: where, message: `${label}: ${change} 的 successorIds 必须包含本 ID（指定由谁继承历史）` })
        return
      }
    }
    entries.push({
      topicId,
      change,
      from,
      to,
      fromKey: keyOf(from),
      toKey: keyOf(to),
      reason: String(entry.reason).trim(),
      recordedBy: String(entry.recordedBy ?? '').trim(),
      recordedAt: String(entry.recordedAt ?? '').trim(),
      successorIds: Array.isArray(entry.successorIds) ? entry.successorIds.map(String) : [],
    })
  })

  // 同一个目标位置最多由一个 ID 拥有，否则继承关系有歧义。
  const byTarget = new Map()
  for (const entry of entries) {
    if (!entry.toKey) continue
    const prior = byTarget.get(entry.toKey)
    if (prior && prior.topicId !== entry.topicId) {
      problems.push({
        code: 'id_map_conflict',
        path: where,
        message: `同一目标位置被两个 ID 声明：${prior.topicId} 与 ${entry.topicId} → ${entry.toKey}。必须指定归属。`,
      })
    }
    byTarget.set(entry.toKey, entry)
  }
  return { entries, problems }
}

function safeLocation(value) {
  if (!value) return null
  const path = String(value.path ?? '').trim()
  const headingPath = Array.isArray(value.headingPath) ? value.headingPath.map((t) => String(t).trim()).filter(Boolean) : []
  return { path, headingPath }
}

/**
 * 从登记表与扫描结果求解映射，产出「ID → 应落到哪个扫描主题」的应用计划。
 * 任何对不上、指向不存在主题、或目标已被别的 ID 占用的情况都作为阻断项交回，
 * 让维护者修映射，而不是静默重新分配 ID。
 */
export function planIdMap({ entries, registry, scanned }) {
  const problems = []
  const byId = new Map(registry.map((topic) => [topic.topicId, topic]))
  const scannedByKey = new Map(scanned.map((topic) => [keyOf({ path: topic.path, headingPath: topic.headingPath }), topic]))
  const claims = new Map()
  const applied = []

  for (const entry of entries) {
    const registered = byId.get(entry.topicId)
    if (!registered) {
      problems.push({ code: 'id_map_unknown_topic', message: `映射引用了未登记的 topicId：${entry.topicId}（${entry.change}）` })
      continue
    }
    const registeredKey = keyOf({ path: registered.path, headingPath: registered.headingPath })
    if (registeredKey !== entry.fromKey && registered.status !== 'retired') {
      problems.push({
        code: 'id_map_from_mismatch',
        message: `映射 ${entry.topicId} 的 from 与登记位置不符：映射 ${entry.fromKey} ≠ 登记 ${registeredKey}`,
      })
      continue
    }
    if (entry.change === 'retired') {
      applied.push({ entry, topicId: entry.topicId, target: null })
      continue
    }
    const target = scannedByKey.get(entry.toKey)
    if (!target) {
      problems.push({ code: 'id_map_target_missing', message: `映射 ${entry.topicId}（${entry.change}）的目标主题不存在：${entry.toKey}` })
      continue
    }
    const prior = claims.get(entry.toKey)
    if (prior && prior !== entry.topicId) {
      problems.push({ code: 'id_map_conflict', message: `${entry.toKey} 同时被 ${prior} 与 ${entry.topicId} 声明，必须指定归属` })
      continue
    }
    claims.set(entry.toKey, entry.topicId)
    applied.push({ entry, topicId: entry.topicId, target })
  }
  return { applied, problems }
}
