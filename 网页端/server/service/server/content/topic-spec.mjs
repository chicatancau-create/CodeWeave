/**
 * 主题识别规范（DATA-02）。
 *
 * 两端必须用同一套口径：资料库 `tools/build_topic_index.py` 与这里。
 * 三类条目分开计，不混成一个数字：
 * - `topic`          正式主题，可上架、计入覆盖率分母；
 * - `container`      空结构容器，只有标题没有正文，可上架但不计入“可教学”分母；
 * - `compat-pointer` 基础分册指向进阶分册的跳转标题，主题归进阶分册所有，**不重复上架**。
 *
 * 跳转标题的判定与 Python 完全一致：仅当分册是 knowledge-volume 且标题以该前缀开头时跳过。
 */
export const POINTER_HEADING = '下一阶段知识推理'
export const TOPIC_KINDS = ['topic', 'container', 'compat-pointer']

/** 默认的主题定位索引页（由资料库 Python 工具生成，不手工修改）。 */
export const DEFAULT_TOPIC_INDEX_PATH = '00-入口/主题定位索引.md'

export function classifyTopic({ volumeKind, title, isEmpty }) {
  if (volumeKind === 'knowledge-volume' && String(title ?? '').startsWith(POINTER_HEADING)) return 'compat-pointer'
  return isEmpty ? 'container' : 'topic'
}

/** 计入覆盖率分母的主题：正式主题与空容器之外的、可教学的正式主题。 */
export function isTeachable(topic) {
  return topic.topicKind === 'topic'
}

/** 可上架（进入课程包与目录）的主题：排除兼容跳转指针。 */
export function isPublishable(topic) {
  return topic.topicKind !== 'compat-pointer'
}

/** `复习大纲/x/y.md` → `复习大纲/x/y`，与索引页的 `## ` 标题一致。 */
function volumeKey(path) {
  return String(path).replace(/\.md$/, '')
}

const VOLUME_HEADING = /^## (.+?)\s*$/
const TOPIC_LINK = /^-\s*\[\[([^#\]]+)#([^|\]]+)(?:\|[^\]]+)?\]\]\s*$/

/**
 * 解析 `00-入口/主题定位索引.md`：分册 → 主题标题集合。
 * @returns {Map<string, Set<string>>|null} 页面缺失（text 为 null）时返回 null
 */
export function parseTopicIndex(text) {
  if (text === null || text === undefined) return null
  const index = new Map()
  let current = null
  for (const line of String(text).split('\n')) {
    const volume = VOLUME_HEADING.exec(line)
    if (volume) {
      current = volume[1].trim()
      if (!index.has(current)) index.set(current, new Set())
      continue
    }
    if (!current) continue
    const topic = TOPIC_LINK.exec(line)
    if (topic) index.get(current).add(topic[2].trim())
  }
  return index
}

/**
 * 集合差异：两端在同一规范下应当完全一致。
 * @param topics 已分类的主题
 */
export function diffTopicIndex({ topics, index }) {
  if (!index) return { available: false, nodeOnly: [], indexOnly: [], volumesWithoutIndexEntries: [] }
  const mine = new Map()
  for (const topic of topics) {
    if (!isPublishable(topic)) continue
    const key = volumeKey(topic.path)
    if (!mine.has(key)) mine.set(key, new Set())
    mine.get(key).add(topic.title)
  }
  const nodeOnly = []
  const indexOnly = []
  for (const [volume, titles] of [...mine.entries()].sort()) {
    const theirs = index.get(volume)
    if (!theirs) {
      for (const title of [...titles].sort()) nodeOnly.push({ volume, title })
      continue
    }
    for (const title of [...titles].sort()) if (!theirs.has(title)) nodeOnly.push({ volume, title })
    for (const title of [...theirs].sort()) if (!titles.has(title)) indexOnly.push({ volume, title })
  }
  for (const [volume, titles] of [...index.entries()].sort()) {
    if (mine.has(volume)) continue
    for (const title of [...titles].sort()) indexOnly.push({ volume, title })
  }
  return { available: true, nodeOnly, indexOnly, volumesWithoutIndexEntries: [] }
}

/** 可解释的口径算式，替代“一个总数”。 */
export function reconcileTopicCounts(topics) {
  const by = (predicate) => topics.filter(predicate).length
  const active = by((topic) => topic.status === 'active')
  const pointer = by((topic) => topic.status === 'active' && topic.topicKind === 'compat-pointer')
  const container = by((topic) => topic.status === 'active' && topic.topicKind === 'container')
  const formal = by((topic) => topic.status === 'active' && topic.topicKind === 'topic')
  return {
    registered: topics.length,
    retired: by((topic) => topic.status === 'retired'),
    active,
    compatPointer: pointer,
    emptyContainer: container,
    formalTopic: formal,
    // 与 Python 索引对齐的口径：登记 − 跳转指针；再扣空容器得到“可教学”分母。
    indexAligned: active - pointer,
    teachableDenominator: formal,
    arithmetic: `${active} active − ${pointer} 兼容指针 = ${active - pointer}（对齐索引口径）；其中 ${container} 空容器、${formal} 正式主题`,
  }
}
