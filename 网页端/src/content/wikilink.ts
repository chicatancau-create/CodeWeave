/**
 * 双链 `[[目标|别名]]` 的目标解析与放行判定（DATA-10）。
 *
 * 口径（02 号方案 §1 活动内容层与 §2 数据对象、ID 和关系）：
 * - **只在已发布内容里定位**：候选集来自内容快照的 lessons 元数据
 *   （contentId / 标题 / 库根相对来源路径 / 标题链），前端不拼磁盘路径、
 *   不访问文件系统、不为未发布文件编造链接。
 * - 命中 → 返回可跳转的 `contentId`；未命中或目标不唯一 → `unresolved`，
 *   界面必须明确提示「指向未发布/未登记内容」，不允许静默变成死链。
 * - 危险目标一律 `rejected`：脚本/数据协议（`javascript:`、`data:text/html`、
 *   `vbscript:`）、绝对路径与网络路径、`..` 越界（含 `%2e%2e` 编码绕过）、
 *   HTML 标签片段、超长目标。被拒绝的目标**只作为文本渲染**，永不进入 href。
 *
 * 本模块是纯函数：不依赖 React，便于单测覆盖安全边界。
 */
import type { Lesson } from '../types/lesson'

/** 可定位目标：字段全部来自内容快照。 */
export type WikiLinkCandidate = {
  contentId: string
  title: string
  /** 快照里的库根相对路径，如 `复习大纲/01-编程语言/C/C语言基础.md`（不是磁盘路径） */
  sourcePath: string
  /** 主题在来源文件里的完整标题链 */
  headingPath: string[]
}

export type WikiLinkDecision =
  | { kind: 'resolved'; display: string; tooltip: string; contentId: string; title: string }
  | { kind: 'unresolved'; display: string; tooltip: string; reason: string }
  | { kind: 'rejected'; display: string; tooltip: string; reason: string }

/** 协议形目标：`scheme:` 前缀（javascript:/data:/http:/file:/C: 等）。 */
const SCHEME_LIKE = /^[a-z][a-z0-9+.-]*:/i
/** 非法路径字符（控制字符另用码位判断，避免 eslint 的 no-control-regex）。 */
const ILLEGAL_SEGMENT_CHAR = /[:*?"|\\]/
const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0xfeff])

function isStrippedChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0
  return code <= 0x20 || code === 0x7f || ZERO_WIDTH.has(code)
}

function hasControlChar(value: string): boolean {
  return Array.from(value).some((char) => (char.codePointAt(0) ?? 0) < 0x20 || (char.codePointAt(0) ?? 0) === 0x7f)
}

/** 零宽/双向格式字符：常被用来拆散 `javascript:` 这类关键字（按码位判断）。 */
function hasInvisibleFormatChar(value: string): boolean {
  return Array.from(value).some((char) => {
    const code = char.codePointAt(0) ?? 0
    return (code >= 0x200b && code <= 0x200f) || code === 0x2060 || code === 0xfeff
  })
}

const MAX_TARGET_LENGTH = 300

/** 路径归一：反斜杠转正斜杠、折叠重复斜杠、去掉 `./` 前缀与 `.md` 后缀、转小写。 */
function normalizePath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\.\//, '')
    .replace(/\.md$/i, '')
    .trim()
    .toLowerCase()
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** 清掉空白、控制字符与零宽字符后的形态：安全判定用它，避免 `java\nscript:` 之类绕过。 */
function compact(value: string): string {
  return Array.from(value)
    .filter((char) => !isStrippedChar(char))
    .join('')
}

/**
 * 拆分 `[[目标|别名]]`（含表格单元格里 `\|` 的转义写法）。
 * 别名取第一个未转义 `|` 之后的全部内容；无别名时取路径最后一段（Obsidian 口径）。
 */
export function splitWikiLink(raw: string): { target: string; display: string } {
  const unified = String(raw ?? '').replace(/\\\|/g, '|')
  const pipe = unified.indexOf('|')
  const target = (pipe === -1 ? unified : unified.slice(0, pipe)).trim()
  const alias = pipe === -1 ? '' : unified.slice(pipe + 1).trim()
  if (alias) return { target, display: alias }
  const withoutAnchor = target.split('#')[0] ?? ''
  const segments = withoutAnchor.split('/').filter((segment) => segment !== '')
  return { target, display: (segments.length > 1 ? segments.at(-1) : withoutAnchor)?.trim() || target }
}

/** 危险/越界目标的拒绝理由；返回 null 表示目标形态可进入发布状态判定。 */
export function rejectReasonFor(target: string): string | null {
  // 先拒绝控制字符与零宽字符：它们只被用来绕过协议/越界判定，正文里没有合法用途
  if (hasControlChar(target) || hasInvisibleFormatChar(target)) return '目标含控制字符或零宽字符'
  // 反斜杠先归一为 `/`：`\..\` 这类写法必须能被越界规则看到，而不是当成合法文件名
  const value = compact(target).replace(/\\/g, '/')
  if (!value) return '引用目标为空'
  if (target.length > MAX_TARGET_LENGTH) return `引用目标过长（超过 ${MAX_TARGET_LENGTH} 字符）`
  if (/[<>]/.test(value)) return '目标含 HTML 标签片段'
  if (value.startsWith('/')) return '不接受绝对路径或网络路径（//host、/abs、盘符另由协议规则处理）'
  if (SCHEME_LIKE.test(value)) return '不接受带协议的目标（javascript:、data:、http:、盘符等）'
  if (/%2e/i.test(value)) return '不接受编码后的越界路径'
  const segments = value.split('/')
  if (segments.some((segment) => segment === '..')) return '不接受越界路径（..）'
  if (segments.some((segment) => ILLEGAL_SEGMENT_CHAR.test(segment))) return '目标含非法路径字符'
  return null
}

/**
 * 整条目标（含 `#章节锚点`）的拒绝理由：路径段与每个锚点段都过同一套规则。
 * 锚点用 `>` 分级（与快照里 sectionRef 的口径一致），因此 `>` 本身不是危险字符。
 */
function targetRejectReason(target: string, pathPart: string, anchorChain: string[]): string | null {
  if (target.length > MAX_TARGET_LENGTH) return `引用目标过长（超过 ${MAX_TARGET_LENGTH} 字符）`
  const pathReason = rejectReasonFor(pathPart)
  if (pathReason) return pathReason
  for (const segment of anchorChain) {
    const reason = rejectReasonFor(segment)
    if (reason) return `章节锚点不合法：${reason}`
  }
  return null
}

/** 从内容快照的 lessons 里提取已发布候选集（旧内置课程 legacy 无 contentId，不作为目标）。 */
export function publishedWikiLinkCandidates(lessons: readonly Lesson[]): WikiLinkCandidate[] {
  const out: WikiLinkCandidate[] = []
  const seen = new Set<string>()
  for (const lesson of lessons) {
    const contentId = lesson.contentId
    if (!contentId || lesson.legacy) continue
    const candidate: WikiLinkCandidate = {
      contentId,
      title: String(lesson.title ?? ''),
      sourcePath: String(lesson.source?.path ?? ''),
      headingPath: (lesson.source?.headingPath ?? []).map((item) => String(item)),
    }
    const key = `${candidate.contentId}#${candidate.sourcePath}#${candidate.title}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(candidate)
  }
  return out
}

export type WikiLinkIndex = {
  total: number
  byContentId: Map<string, WikiLinkCandidate[]>
  byPath: Map<string, WikiLinkCandidate[]>
  byBaseName: Map<string, WikiLinkCandidate[]>
  byTitle: Map<string, WikiLinkCandidate[]>
}

function push(map: Map<string, WikiLinkCandidate[]>, key: string, candidate: WikiLinkCandidate): void {
  if (!key) return
  const list = map.get(key)
  if (list) {
    if (!list.some((item) => item.contentId === candidate.contentId)) list.push(candidate)
    return
  }
  map.set(key, [candidate])
}

/** 建一次索引，供多条双链复用（同一快照内稳定）。 */
export function buildWikiLinkIndex(candidates: readonly WikiLinkCandidate[]): WikiLinkIndex {
  const index: WikiLinkIndex = {
    total: candidates.length,
    byContentId: new Map(),
    byPath: new Map(),
    byBaseName: new Map(),
    byTitle: new Map(),
  }
  for (const candidate of candidates) {
    push(index.byContentId, normalizeTitle(candidate.contentId), candidate)
    push(index.byTitle, normalizeTitle(candidate.title), candidate)
    const path = normalizePath(candidate.sourcePath)
    if (path) {
      push(index.byPath, path, candidate)
      push(index.byBaseName, (path.split('/').at(-1) ?? ''), candidate)
    }
  }
  return index
}

/** 标题链锚点（`#标题1 > 标题2`）能否在已发布主题的元数据里对上。 */
function anchorMatches(candidate: WikiLinkCandidate, chain: string[]): boolean {
  if (chain.length === 0) return true
  const known = new Set([...candidate.headingPath, candidate.title].map(normalizeTitle).filter(Boolean))
  if (known.size === 0) return true // 摘要未提供标题链时不做否决，按整篇定位
  const last = normalizeTitle(chain[chain.length - 1] ?? '')
  return last === '' || known.has(last)
}

function pick(list: WikiLinkCandidate[] | undefined): WikiLinkCandidate[] {
  return list ?? []
}

/**
 * 解析一条双链。命中已发布主题时返回 `resolved`；
 * 目标形态危险返回 `rejected`；其余（未发布、同名不唯一、未连接快照）返回 `unresolved`。
 */
export function resolveWikiLink(raw: string, candidatesOrIndex: readonly WikiLinkCandidate[] | WikiLinkIndex): WikiLinkDecision {
  const index = 'byPath' in candidatesOrIndex ? candidatesOrIndex : buildWikiLinkIndex(candidatesOrIndex)
  const { target, display } = splitWikiLink(raw)
  const tooltipBase = `资料库引用：${target || raw}`

  const hashAt = target.indexOf('#')
  const pathPart = (hashAt === -1 ? target : target.slice(0, hashAt)).trim()
  const anchorPart = hashAt === -1 ? '' : target.slice(hashAt + 1)
  const chain = anchorPart
    .split(/>/)
    .flatMap((piece) => piece.split('#'))
    .map((piece) => piece.trim())
    .filter(Boolean)

  const reason = targetRejectReason(target, pathPart, chain)
  if (reason) return { kind: 'rejected', display: display || target || raw, tooltip: `${reason}（已按文本呈现，不跳转）`, reason }

  const normalized = normalizePath(pathPart)
  const baseName = normalized.split('/').at(-1) ?? ''
  const lookups: WikiLinkCandidate[] = []
  for (const list of [
    index.byContentId.get(normalizeTitle(pathPart)),
    index.byPath.get(normalized),
    index.byTitle.get(normalizeTitle(pathPart)),
    index.byBaseName.get(baseName),
  ]) {
    for (const candidate of pick(list)) if (!lookups.some((item) => item.contentId === candidate.contentId)) lookups.push(candidate)
  }

  if (index.total === 0) {
    return { kind: 'unresolved', display, tooltip: '未连接资料库内容快照，无法判定发布状态', reason: '未连接内容快照' }
  }
  if (lookups.length === 0) {
    return { kind: 'unresolved', display, tooltip: `${tooltipBase} 未发布或未登记`, reason: '该引用指向未发布/未登记内容' }
  }
  const matched = lookups.filter((candidate) => anchorMatches(candidate, chain))
  if (matched.length === 0) {
    return {
      kind: 'unresolved',
      display,
      tooltip: `${tooltipBase}：锚点标题不在已发布主题里`,
      reason: '该引用指向未发布/未登记内容（章节锚点未发布）',
    }
  }
  if (matched.length > 1) {
    return {
      kind: 'unresolved',
      display,
      tooltip: `${tooltipBase}：已发布内容里有 ${matched.length} 个同名目标`,
      reason: '目标不唯一，请用完整路径定位（未自动择一）',
    }
  }
  const found = matched[0]
  if (!found) {
    return { kind: 'unresolved', display, tooltip: `${tooltipBase} 未发布或未登记`, reason: '该引用指向未发布/未登记内容' }
  }
  return { kind: 'resolved', display, tooltip: `打开已发布主题：${found.title}`, contentId: found.contentId, title: found.title }
}

// ---------------------------------------------------------------------------
// 附件白名单判定（DATA-10 §4 前端侧）
//
// 路径合法性**只有一套规则**：复用上面的 `rejectReasonFor()`，不另起第二套。
// 扩展名清单与 `server/content/asset.mjs` 的 `ASSET_TYPES` 同口径，
// 由 `tests/content.asset.test.mjs` 逐项比对，防止两份清单各自漂移。
// 前端不据它放行内容：它只决定「要不要生成一个同源 `<img src>`」，
// 是否真的可读由服务端的白名单 + 已发布目录门禁 + 鉴权决定。
// ---------------------------------------------------------------------------

/** 可内嵌显示的位图扩展名（`svg` 能带脚本，明确排除）。 */
export const ASSET_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'] as const
/** 服务端可读但本轮不内嵌显示的类型（不产生任何 href/src 出口）。 */
export const ASSET_DOCUMENT_EXTENSIONS = ['pdf'] as const
export const ASSET_TEXT_EXTENSIONS = ['txt', 'csv', 'json'] as const
/** 白名单全集：与 `ASSET_TYPES` 的键一一对应。 */
export const ASSET_ALLOWED_EXTENSIONS: readonly string[] = [
  ...ASSET_IMAGE_EXTENSIONS,
  ...ASSET_DOCUMENT_EXTENSIONS,
  ...ASSET_TEXT_EXTENSIONS,
]

/** 附件接口（同源、GET、只有 path 一个查询参数）。 */
export const ASSET_ENDPOINT = '/api/content/asset'

const ASSET_IMAGE_SET: ReadonlySet<string> = new Set<string>(ASSET_IMAGE_EXTENSIONS)
const ASSET_ALLOWED_SET: ReadonlySet<string> = new Set(ASSET_ALLOWED_EXTENSIONS)

/** 扩展名（小写、不含点）；无扩展名返回空串。 */
export function assetExtensionOf(target: string): string {
  const base = String(target ?? '').replace(/\\/g, '/').split('/').at(-1) ?? ''
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

export type ImageAttachmentDecision =
  | { kind: 'image'; relPath: string; src: string }
  | { kind: 'text'; reason: string }

/**
 * 一条 `![说明](目标)` 能否渲染成 `<img src="/api/content/asset?path=…">`。
 * 通过条件：**库根相对路径（`rejectReasonFor` 无拒绝理由）+ 位图白名单扩展名**。
 * 其余（协议、绝对路径、盘符、`..`、svg/html/js/css、无扩展名）一律 `{kind:'text'}`，
 * 由调用方按今天的方式把原始语法当纯文本显示。
 */
export function resolveImageAttachment(target: string): ImageAttachmentDecision {
  const value = String(target ?? '').trim()
  const reason = rejectReasonFor(value)
  if (reason) return { kind: 'text', reason }
  const relPath = value.replace(/\\/g, '/')
  const extension = assetExtensionOf(relPath)
  if (!ASSET_IMAGE_SET.has(extension)) {
    return { kind: 'text', reason: ASSET_ALLOWED_SET.has(extension) ? '该类型不内嵌显示（只允许服务端按白名单读取）' : '扩展名不在附件白名单内' }
  }
  return { kind: 'image', relPath, src: `${ASSET_ENDPOINT}?path=${encodeURIComponent(relPath)}` }
}
