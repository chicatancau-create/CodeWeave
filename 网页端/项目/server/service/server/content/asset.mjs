/** 已发布附件的 MIME、路径和 CAS 读取规则。 */
import { ContentError, sha256 } from './markdown.mjs'


/** 单个附件的大小上限（契约 §3）。 */
export const ASSET_MAX_BYTES = 5 * 1024 * 1024
/** 教材正文按课读取，附件跟随会话：只允许私有短缓存。 */
export const ASSET_CACHE_CONTROL = 'private, no-cache'
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


/** 扩展名（小写、不含点）；无扩展名返回空串。 */
export function assetExtensionOf(relPath) {
  const base = String(relPath ?? '').replace(/\\/g, '/').split('/').at(-1) ?? ''
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

function notFound() {
  return { ok: false, status: 404, code: 'asset_not_found', message: NOT_FOUND_MESSAGE, denied: true }
}

/** 从请求中读取单个库根相对路径与可选快照标识。拒绝二次编码和非规范路径。 */
function assetQuery(url) {
  const names = [...url.searchParams.keys()]
  if (names.some((name) => name !== 'path' && name !== 'bundleId') ||
      url.searchParams.getAll('path').length !== 1 || url.searchParams.getAll('bundleId').length > 1) {
    throw new ContentError('invalid_relative_path', '无效的附件查询参数')
  }
  const path = url.searchParams.get('path')
  if (!path || SCHEME_LIKE.test(path) || /[%#?\\\x00-\x1f:]/.test(path) ||
      path.split('/').some((part) => !part || part.startsWith('.'))) {
    throw new ContentError('invalid_relative_path', '无效的附件路径')
  }
  return { path, bundleId: url.searchParams.get('bundleId') }
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

/** 只解析 bundle 内登记的 CAS 对象，且返回的字节已经校验。 */
export function publicAssetId(asset) {
  return 'asset-' + sha256(asset.path + '\0' + asset.sha256).slice(0, 32)
}

export async function resolveContentAsset({ url, assetId, snapshotStore, ifNoneMatch, vaultId }) {
  let query
  try {
    if (assetId !== undefined) {
      if (!/^asset-[a-f0-9]{32}$/.test(assetId)) return notFound()
      const names = [...url.searchParams.keys()]
      if (names.length !== 1 || names[0] !== 'bundleId') {
        throw new ContentError('invalid_bundle_id', '附件需要固定快照')
      }
      query = { bundleId: url.searchParams.get('bundleId') }
    } else {
      query = assetQuery(url)
    }
  } catch (error) {
    if (!(error instanceof ContentError)) throw error
    return { ok: false, status: 400, code: error.code, message: '附件路径不合法', denied: true }
  }
  const current = await snapshotStore.readBundle(query.bundleId, vaultId)
  if (!current.bundle) {
    const status = current.status === 'invalid_bundle_id' ? 400 : current.status === 'content_bundle_retired' ? 410 : 503
    return { ok: false, status, code: current.status, message: '请求的内容快照不可读', denied: false }
  }
  const asset = current.bundle.assets?.find((entry) => assetId ? publicAssetId(entry) === assetId : entry.path === query.path)
  if (!asset) return notFound()
  const type = ASSET_TYPES[assetExtensionOf(asset.path)]
  if (!type || type.contentType !== asset.contentType) return notFound()

  let bytes
  try {
    bytes = await snapshotStore.assets.read(asset)
  } catch {
    return { ok: false, status: 503, code: 'asset_integrity_failed', message: '快照附件校验失败', denied: false }
  }
  const etag = `"${asset.sha256}"`
  const headers = {
    'Cache-Control': ASSET_CACHE_CONTROL,
    ETag: etag,
    Vary: 'Cookie, Authorization',
    'X-Content-Bundle': current.bundle.bundleId,
    'X-Content-Manifest': current.pointer.payloadHash,
  }
  if (ifNoneMatchHits(ifNoneMatch, etag)) return { ok: true, notModified: true, headers }
  headers['Content-Type'] = type.contentType
  headers['Content-Length'] = String(bytes.length)
  if (type.contentDisposition) headers['Content-Disposition'] = type.contentDisposition
  return { ok: true, headers, bytes }
}
