/**
 * 附件与图片按白名单访问（DATA-10 §4 的实施；设计契约见 `src/content/README-attachments.md`）。
 *
 * 本模块只做「解析 + 判定 + 生成响应头」，**不写响应**：失败一律交回 `server.mjs`
 * 既有的 `sendJson` / 401→403→`contentErrorStatus` 口径，成功由调用方按 `headers` 流式发送
 * （`notModified: true` 时只发 304 头、不发正文）。
 * 这样新增一条分支不会改动全局 `/api/content/` 前缀判定与鉴权链。
 *
 * 三条硬规则（逐条对应契约 §2、§3）：
 * 1. 路径解析完全复用 `vault-paths.mjs` 的 `resolveInsideRoot()`：`..`、绝对路径、盘符、
 *    realpath 后越界、经 symlink/junction 逃逸都由它判定，这里不另起第二套路径规则；
 * 2. `ASSET_TYPES` 是「扩展名 → MIME」双清单，表里缺一行就等于该类型不开放；
 *    表外一律 403 `asset_type_forbidden`，其中 `svg`/`html`/`htm`/`xhtml`/`js`/`mjs`/`css`
 *    是**明确排除**项（能带脚本，属于「原始 HTML 执行」的旁路），永不进表；
 * 3. 第二道门禁：路径必须落在内容快照里已发布来源文件所在的目录之内，否则与「文件不存在」
 *    同样返回 404 `asset_not_found` —— 不给「用白名单扩展名试探库里未发布私人文件」留缝隙。
 *
 * 隐私边界：所有失败响应用**固定文案**，绝不把资料库绝对路径、磁盘位置或库外内容
 * 回给客户端（连客户端自己传进来的路径都不回显，见 `DENY_BY_CODE`）。
 */
import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import { ContentError } from './markdown.mjs'
import { resolveInsideRoot, resolveVaultRoot } from './vault-paths.mjs'

/** 单个附件的大小上限（契约 §3）。 */
export const ASSET_MAX_BYTES = 5 * 1024 * 1024
/** 教材正文按课读取，附件跟随会话：只允许私有短缓存。 */
export const ASSET_CACHE_CONTROL = 'private, max-age=300'
/** 未发布与不存在共用同一句话，避免成为存在性探针。 */
const NOT_FOUND_MESSAGE = '附件不存在或未发布'

/**
 * 白名单双清单（扩展名 → MIME，缺一不可）。
 * 只列位图、pdf 与「强制按纯文本返回」的 txt/csv/json；
 * `svg`、`html`、`htm`、`xhtml`、`js`、`mjs`、`css` 以及任何可执行/可嵌入类型都不在表内。
 */
export const ASSET_TYPES = {
  png: { contentType: 'image/png' },
  jpg: { contentType: 'image/jpeg' },
  jpeg: { contentType: 'image/jpeg' },
  gif: { contentType: 'image/gif' },
  webp: { contentType: 'image/webp' },
  pdf: { contentType: 'application/pdf', contentDisposition: 'inline' },
  txt: { contentType: 'text/plain; charset=utf-8' },
  csv: { contentType: 'text/plain; charset=utf-8' },
  json: { contentType: 'text/plain; charset=utf-8' },
}

/** 协议形目标（`https:`、`file:`、`javascript:`、盘符 `C:`…）—— 与前端 `wikilink.ts` 的 SCHEME_LIKE 同口径。 */
const SCHEME_LIKE = /^[a-z][a-z0-9+.-]*:/i

/**
 * 稳定错误码 → 状态码与固定文案。
 * `invalid_relative_path` / `path_escape` → 400（与 `contentErrorStatus()` 的兜底一致）；
 * `source_not_found` → 归一为 404 `asset_not_found`，不回显绝对路径。
 */
const DENY_BY_CODE = {
  invalid_relative_path: { status: 400, code: 'invalid_relative_path', message: '附件路径不合法：只接受资料库根内的相对路径' },
  path_escape: { status: 400, code: 'path_escape', message: '附件路径越出资料库根' },
  source_not_found: { status: 404, code: 'asset_not_found', message: NOT_FOUND_MESSAGE },
}

/** 扩展名（小写、不含点）；无扩展名返回空串。 */
export function assetExtensionOf(relPath) {
  const base = String(relPath ?? '').replace(/\\/g, '/').split('/').at(-1) ?? ''
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

function notFound() {
  return { ok: false, status: 404, code: 'asset_not_found', message: NOT_FOUND_MESSAGE, denied: true }
}

/**
 * 从查询串里取出唯一的 `path` 参数。
 * 除 `path` 外的任何参数（`root`、磁盘位置、绝对路径…）都视为非法请求；
 * 带协议或盘符形目标同样直接 400，不进入文件系统。
 */
function relPathFromUrl(url) {
  const names = [...url.searchParams.keys()]
  if (names.length !== 1 || names[0] !== 'path') {
    throw new ContentError('invalid_relative_path', '附件接口只接受 path 一个查询参数')
  }
  const raw = String(url.searchParams.get('path') ?? '').trim()
  if (!raw) throw new ContentError('invalid_relative_path', '缺少附件路径')
  const unified = raw.replace(/\\/g, '/')
  if (SCHEME_LIKE.test(unified)) {
    throw new ContentError('invalid_relative_path', '不接受带协议或盘符的目标')
  }
  // 查询串已被解码一次；还留着 `%` 说明是 `%2e%2e%2f` 这类二次编码试探，直接拒（契约 §5.3）。
  if (raw.includes('%')) throw new ContentError('invalid_relative_path', '不接受编码后的路径')
  return unified
}

/**
 * 第二道门禁的允许目录集合：内容快照里每个已发布单元的**来源文件所在目录**。
 * 取值口径与 `index.mjs` 的 `lessonSummary().sourcePath` 完全一致
 * （`reading.path` 优先，退回首条 `sectionRefs[].path`），不另立一套。
 * 库根顶层的单个文件（目录为空）不构成「目录前缀」，因此被跳过而不是放开整根。
 */
export function publishedAssetDirs(bundle) {
  const dirs = new Set()
  for (const lesson of bundle?.lessons ?? []) {
    const path = lesson?.reading?.path ?? lesson?.sectionRefs?.[0]?.path ?? null
    if (typeof path !== 'string' || path.trim() === '') continue
    const posix = path.replace(/\\/g, '/')
    const cut = posix.lastIndexOf('/')
    if (cut <= 0) continue
    dirs.add(posix.slice(0, cut))
  }
  return dirs
}

/**
 * 路径是否落在某个已发布来源目录之内。
 * 同时拒绝以 `.` 开头的目录段（`.obsidian`、清单里声明的 `.hidden` 等）——
 * 与 `vault-paths.mjs` 的 `listMarkdownFiles()` 同口径，隐藏配置不因白名单扩展名而外泄。
 */
export function isPublishedAssetPath(rel, dirs) {
  const segments = String(rel ?? '').split('/')
  if (segments.some((segment) => segment.startsWith('.'))) return false
  for (const dir of dirs) {
    if (dir && rel.startsWith(`${dir}/`)) return true
  }
  return false
}

/** ETag 用文件指纹（相对路径 + 大小 + mtime），不含磁盘绝对路径。 */
function fingerprint(rel, stat) {
  return createHash('sha256').update(`${rel}\u0000${stat.size}\u0000${stat.mtimeMs}`, 'utf8').digest('hex').slice(0, 32)
}

/**
 * `If-None-Match` 是否命中当前表示（RFC 9110 §8.8.3 / §2.3.2）：
 * 逗号分隔的实体标签列表逐个比对，弱标记前缀 `W/` 在匹配时忽略，`*` 在存在 ETag 时命中。
 * 比对是**不透明字符串相等**，绝不做路径或语义解析。
 */
export function ifNoneMatchHits(ifNoneMatch, etag) {
  const header = String(ifNoneMatch ?? '').trim()
  if (!header) return false
  if (header === '*') return Boolean(etag)
  if (!etag) return false
  const strong = etag.replace(/^W\//i, '')
  return header.split(',').some((token) => token.trim().replace(/^W\//i, '') === strong)
}

/**
 * 解析并判定一次附件请求。
 *
 * 判定顺序就是安全顺序：资料库在场 → 路径不越界 → 是普通文件 → 落在已发布目录 →
 * 类型在白名单 → 不超限，**全部过了**才轮到 `If-None-Match`。命中即 `notModified: true`，
 * 所以一条 304 只能出现在「这个请求本来就该拿到 200」的场合，不会变成存在性探针。
 *
 * @param {{ url: URL, snapshotStore: {readCurrent: () => Promise<{bundle: object|null}>}, vaultRoot?: string, ifNoneMatch?: string }} options
 * @returns {Promise<
 *   | { ok: true, abs: string, rel: string, size: number, headers: Record<string,string>, notModified?: undefined }
 *   | { ok: true, abs: string, rel: string, size: number, headers: Record<string,string>, notModified: true }
 *   | { ok: false, status: number, code: string, message: string, denied: boolean }
 * >}
 */
export async function resolveContentAsset({ url, snapshotStore, vaultRoot, ifNoneMatch }) {
  const resolved = resolveVaultRoot(vaultRoot ?? process.env.CODEWEAVE_VAULT_ROOT)
  if (!resolved.ok) {
    // 资料库未连接不是「试探」，不计入限流窗口；状态码与既有 vault_unavailable 同口径。
    return { ok: false, status: 503, code: 'vault_unavailable', message: '资料库未连接，附件不可读', denied: false }
  }

  let target
  try {
    target = resolveInsideRoot(resolved.root, relPathFromUrl(url))
  } catch (error) {
    if (!(error instanceof ContentError)) throw error
    const deny = DENY_BY_CODE[error.code] ?? { status: 400, code: error.code, message: '附件请求不合法' }
    return { ok: false, ...deny, denied: true }
  }

  let stat
  try {
    stat = statSync(target.abs)
  } catch {
    return notFound()
  }
  // 目录与任何非普通文件一律拒绝（契约 §3）。
  if (!stat.isFile()) return notFound()

  const current = await snapshotStore.readCurrent()
  if (!isPublishedAssetPath(target.rel, publishedAssetDirs(current.bundle))) return notFound()

  const type = ASSET_TYPES[assetExtensionOf(target.rel)]
  if (!type) {
    return {
      ok: false,
      status: 403,
      code: 'asset_type_forbidden',
      message: '该类型不在附件白名单内（svg/html/js/css 等可执行可嵌入类型永不开放）',
      denied: true,
    }
  }
  if (stat.size > ASSET_MAX_BYTES) {
    return { ok: false, status: 413, code: 'asset_too_large', message: '附件超过大小上限（5 MiB）', denied: true }
  }

  const etag = `"${fingerprint(target.rel, stat)}"`
  /**
   * 缓存键必须带上身份：一台浏览器里可以登多个账户，而同一条 URL 对不同账户的可见性
   * 不一样（`vault_private` / `owner_record_corrupt` 两道门禁是按账户判的）。
   * 没有 `Vary: Cookie`，账户 A 取到的正文或 304 会被浏览器原样给账户 B 用。
   */
  const vary = 'Cookie'

  if (ifNoneMatchHits(ifNoneMatch, etag)) {
    return {
      ok: true,
      notModified: true,
      abs: target.abs,
      rel: target.rel,
      size: stat.size,
      // 304 没有正文：Content-Type / Content-Length / Content-Disposition 一概不发。
      headers: { 'Cache-Control': ASSET_CACHE_CONTROL, ETag: etag, Vary: vary },
    }
  }

  const headers = {
    'Content-Type': type.contentType,
    'Content-Length': String(stat.size),
    'Cache-Control': ASSET_CACHE_CONTROL,
    ETag: etag,
    Vary: vary,
  }
  if (type.contentDisposition) headers['Content-Disposition'] = type.contentDisposition
  return { ok: true, abs: target.abs, rel: target.rel, size: stat.size, headers }
}
