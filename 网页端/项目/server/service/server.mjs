import { createServer as createHttpServer } from 'node:http'
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { existsSync, createReadStream, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { extname, join, normalize, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { createContentService } from './server/content/index.mjs'
import { ifNoneMatchHits, publicAssetId, resolveContentAsset } from './server/content/asset.mjs'
import { sha256, stableStringify } from './server/content/markdown.mjs'
import { openPublicationJobs } from './server/content/publish-jobs.mjs'
import { createAccountStore } from './server/accounts.mjs'
import { createContentReferenceResolver } from './server/content/identity.mjs'
import { createLearningSync } from './server/learning/sync.mjs'
import { createLearningService } from './server/learning/index.mjs'
import { resolveRuntimePaths } from './server/config.mjs'
import { instanceIdentity } from './server/instance.mjs'

const scrypt = promisify(scryptCallback)

// 路径与端口由 §6.2 的统一解析器决定：CLI/环境变量 > 本机配置 > 工程相对默认。
// 数据目录仍可由 CODE_CANVAS_DATA_DIR 覆盖（测试隔离用）。
const root = resolve(import.meta.dirname)
const runtime = resolveRuntimePaths({ startDir: root })
// 同源服务的网页端产物：由本机配置 / CODEWEAVE_STATIC_DIR / 默认 `<本包>/data/web-client` 决定，
// 不认兄弟工程的源码相对路径（分离方案 §5）。未发布产物时服务照开，API 与 /api/health 仍可用。
const distRoot = resolve(runtime.staticDir)
const dataRoot = runtime.dataDir
const usersPath = join(dataRoot, 'users.json')

// 内容联动服务：教材快照是派生数据，落在应用数据目录，不从资料库根直接对外提供。
let accounts
let learningSync
let publicationJobs
let initialization
const contentService = createContentService({
  dataRoot, vaultRoot: runtime.vaultRoot,
  configFingerprint: sha256(stableStringify({ vaultRoot: runtime.vaultRoot, dataRoot, staticDir: distRoot, port: runtime.port })),
  recordCommitted: ({ jobId, attempt, result }) => publicationJobs.complete(jobId, attempt, result),
})

function initialize() {
  initialization ??= (async () => {
    publicationJobs = openPublicationJobs(dataRoot)
    accounts = createAccountStore(publicationJobs.database)
    learningSync = createLearningSync(publicationJobs.database, {
      serviceInstance: instanceIdentity({ dataDir: dataRoot, distDir: distRoot }).instanceId,
      resolveContent: createContentReferenceResolver(contentService.snapshotStore),
    })
    await contentService.initialize()
    publicationJobs.recoverInterrupted()
  })()
  return initialization
}
// 学习事实服务（LINK-08）：拥有者绑定 + 正式进度只读投影；同样只落在应用数据目录。
const learningService = createLearningService({ dataRoot, vaultRoot: runtime.vaultRoot, database: () => publicationJobs.database })
// 同步是重操作：单独限流，避免被当作低成本接口反复触发。
const CONTENT_SYNC_MAX = Number(process.env.CODE_CANVAS_CONTENT_SYNC_MAX ?? 30)

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 天
const SESSION_COOKIE = 'code_canvas_session'
const MAX_BODY_BYTES = 100_000
// 密码长度上限：注册 / 登录 / 改密统一，进入 scrypt 前先拦截（避免超长输入耗尽 CPU）。
const MAX_PASSWORD_LENGTH = 128
// 会话上限（测试可用环境变量调低）；超限后按创建时间淘汰最早会话。
const MAX_SESSIONS = Number(process.env.CODE_CANVAS_MAX_SESSIONS ?? 500)
// 过期会话的周期清理间隔；登录时也会顺带清理一次。
const SESSION_SWEEP_INTERVAL_MS = 60 * 60 * 1000

// --- R3 限流：按（维度 + 标识）在滑动窗口内计数失败尝试；键数量有硬上限。 ---
const RATE_LIMIT_MAX = Number(process.env.CODE_CANVAS_RATE_LIMIT_MAX ?? 10)
const RATE_LIMIT_WINDOW_MS = Number(process.env.CODE_CANVAS_RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000)
const RATE_LIMIT_MAX_KEYS = Number(process.env.CODE_CANVAS_RATE_LIMIT_MAX_KEYS ?? 5000)
/** key -> { count, firstAt }。超过 RATE_LIMIT_MAX_KEYS 时按最早时间淘汰。 */
const rateLimits = new Map()

const SCRYPT_KEYLEN = 64
/** scrypt 成本参数（显式配置，便于审计与未来迁移）。 */
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
/** 哈希格式版本前缀：v1 = scrypt。未来更换算法时可据此并行迁移。 */
const HASH_PREFIX = 'scrypt$v1$'


// ---------------------------------------------------------------------------
// R3 限流：滑动窗口计数，键数量有硬上限，攻击输入不会造成内存无界增长。
// ---------------------------------------------------------------------------
/** 清除过期窗口并按上限淘汰最早键；返回当前键数量。 */
function sweepRateLimits(now = Date.now()) {
  for (const [key, entry] of rateLimits) {
    if (now - entry.firstAt > RATE_LIMIT_WINDOW_MS) rateLimits.delete(key)
  }
  while (rateLimits.size > RATE_LIMIT_MAX_KEYS) {
    const oldest = rateLimits.keys().next().value
    if (oldest === undefined) break
    rateLimits.delete(oldest)
  }
  return rateLimits.size
}

/** 是否已被限流（不增加计数）。 */
function isRateLimited(key, now = Date.now()) {
  const entry = rateLimits.get(key)
  if (!entry) return false
  if (now - entry.firstAt > RATE_LIMIT_WINDOW_MS) {
    rateLimits.delete(key)
    return false
  }
  return entry.count >= RATE_LIMIT_MAX
}

/** 记录一次失败尝试。 */
function recordFailure(key, now = Date.now()) {
  const entry = rateLimits.get(key)
  if (!entry || now - entry.firstAt > RATE_LIMIT_WINDOW_MS) {
    rateLimits.set(key, { count: 1, firstAt: now })
  } else {
    entry.count += 1
  }
  sweepRateLimits(now)
}

/** 成功登录/注册后清空该标识的失败计数。 */
function clearFailures(key) {
  rateLimits.delete(key)
}

/** 供测试重置与观测内部状态。 */
export function resetRateLimits() {
  rateLimits.clear()
}
export function rateLimitSize() {
  return rateLimits.size
}

// ---------------------------------------------------------------------------
// 用户存储：整体读、队列化原子写（临时文件 + rename），避免并发写损坏。
// 数据状态机：ok（正常）/ corrupt（文件存在但不可用——只读，拒绝一切写操作）。
// ---------------------------------------------------------------------------
let dataState = 'ok'
let dataStateReason = ''

/** 哈希格式：可选算法/版本前缀 + 32 位盐 + 128 位派生（兼容无前缀的历史数据）。 */
const HASH_FORMAT = /^(?:scrypt\$v1\$)?[0-9a-f]{32}:[0-9a-f]{128}$/

/** 统一用户文件校验：顶层数组、必需字段、类型、哈希格式、标识唯一。 */
export function validateUsers(value) {
  const errors = []
  if (!Array.isArray(value)) {
    return { valid: false, errors: ['用户文件顶层必须是数组'] }
  }
  const seenIds = new Set()
  value.forEach((user, index) => {
    const label = `users[${index}]`
    if (typeof user !== 'object' || user === null) {
      errors.push(`${label} 不是对象`)
      return
    }
    if (typeof user.id !== 'string' || !user.id) errors.push(`${label}.id 缺失或非字符串`)
    else if (seenIds.has(user.id)) errors.push(`${label}.id 重复（id 必须唯一）`)
    else seenIds.add(user.id)
    if (!user.email && !user.phone) errors.push(`${label} 缺少 email 或 phone`)
    if (typeof user.name !== 'string' || user.name.length < 1) errors.push(`${label}.name 缺失`)
    if (typeof user.passwordHash !== 'string' || !HASH_FORMAT.test(user.passwordHash)) {
      errors.push(`${label}.passwordHash 格式非法（应为 salt:hash 十六进制）`)
    }
  })
  return { valid: errors.length === 0, errors }
}

/** 启动时清理遗留的写入临时文件（异常退出残留）。 */
export function cleanupTempFiles(dir = dataRoot) {
  try {
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.tmp')) {
        rmSync(join(dir, file), { force: true })
      }
    }
  } catch {
    // 目录尚不存在时无需清理
  }
}

/** 独立 SQLite 锁文件持有系统文件锁。异常退出时操作系统释放锁。 */
const lockPath = join(dataRoot, '.instance.sqlite')
let instanceLock
export function acquireLock() {
  if (instanceLock) return { ok: false, holder: process.pid }
  let connection
  try {
    mkdirSync(dataRoot, { recursive: true })
    connection = new DatabaseSync(lockPath)
    connection.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;')
    instanceLock = connection
    return { ok: true }
  } catch (error) {
    connection?.close()
    return { ok: false, holder: null, error }
  }
}

function releaseLock() {
  if (!instanceLock) return
  instanceLock.close()
  instanceLock = undefined
}

/** 本机部署命令。Windows 用户以本机文件权限运行，整个过程不开放 HTTP 入口。 */
async function initializeLocal(legacyUsersPath) {
  if (!legacyUsersPath || !runtime.configFile || runtime.sources.dataDir !== 'config' ||
      runtime.sources.vaultRoot !== 'config' || runtime.conflicts.length || process.env.CODEWEAVE_ALLOW_REGISTRATION === '1') {
    throw new Error('本机初始化需要明确的本机配置、已备份的旧账户文件和关闭注册的服务配置')
  }
  const legacyUsers = JSON.parse((await readFile(legacyUsersPath, 'utf8')).replace(/^\uFEFF/, ''))
  if (!validateUsers(legacyUsers).valid) throw new Error('旧账户备份结构无效')
  if (!acquireLock().ok) throw new Error('该运行根正在使用，无法离线初始化')
  try {
    await initialize()
    const vaultId = await contentService.vaultId()
    const binding = await learningService.ownerStore.read()
    if (binding.corrupt || (binding.ownerUserId && binding.vaultId !== vaultId)) {
      throw new Error('拥有者绑定无法用于当前资料库')
    }
    const existing = accounts.imported() ? accounts.users() : legacyUsers
    const owner = binding.ownerUserId
      ? existing.find((entry) => entry.id === binding.ownerUserId)
      : existing.length === 1 ? existing[0] : null
    if (!owner) throw new Error('无法唯一确认既有本机拥有者')

    const scope = { vaultId, accountId: owner.id, isOwner: true }
    const active = await contentService.catalog()
    if (active.ok) {
      if (active.data.vaultId !== vaultId || binding.ownerUserId !== owner.id) {
        throw new Error('生效快照与本机拥有者绑定不一致')
      }
      return { ...active.data, initialized: false, accountCount: accounts.users().length }
    }

    const run = async (key, dryRun, requestHash, fingerprint) => {
      const reservation = publicationJobs.reserve({ ...scope, key, dryRun, requestHash })
      if (reservation.code) throw new Error(reservation.code)
      if (!reservation.reused) await executePublication(reservation, fingerprint)
      return publicationJobs.get(reservation.job.jobId, scope)
    }
    const operation = randomBytes(16).toString('hex')
    const dryRun = await run('local-check-' + operation, true, sha256(operation + ':validate'))
    if (dryRun?.status !== 'ready' || dryRun.summary?.blockingCount !== 0 || !dryRun.approvalFingerprint) {
      throw new Error('本机候选校验未通过：' + (dryRun?.error?.code ?? 'missing_result'))
    }
    if (!accounts.imported()) accounts.importLegacy([owner])
    await learningService.bind(owner.id)
    const published = await run('local-publish-' + operation, false, sha256(operation + ':publish'), dryRun.approvalFingerprint)
    if (published?.status !== 'ready' || !published.published || published.summary?.bundleId !== dryRun.summary.bundleId) {
      throw new Error('本机候选未激活：' + (published?.error?.code ?? 'missing_result'))
    }
    const current = await contentService.catalog()
    if (!current.ok || current.data.bundleId !== published.summary.bundleId) throw new Error('本机激活结果无法对账')
    return {
      initialized: true, accountCount: accounts.users().length, vaultId, bundleId: current.data.bundleId,
      manifestHash: current.data.manifestHash, lessonCount: current.data.lessons.length,
      approvalJobId: dryRun.jobId, publishJobId: published.jobId,
    }
  } finally {
    publicationJobs?.close()
    releaseLock()
  }
}

/** 进程退出时释放单实例锁（仅当锁归属当前进程）。 */
/** 首次启动只读导入已验证的本机旧账户。随后 SQLite 是唯一账户权威。 */
async function readUsers() {
  if (accounts.imported()) return accounts.users()
  let users = []
  try {
    const raw = await readFile(usersPath, 'utf8')
    users = JSON.parse(raw.replace(/^\uFEFF/, ''))
    if (!validateUsers(users).valid) throw new Error('账户结构无效')
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      dataState = 'corrupt'
      dataStateReason = '旧账户数据不可读或结构无效'
      return []
    }
  }
  accounts.importLegacy(users)
  dataState = 'ok'
  dataStateReason = ''
  return accounts.users()
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS)
  // 带算法/版本前缀：未来更换算法时按前缀分流校验，实现平滑迁移。
  return `${HASH_PREFIX}${salt}:${Buffer.from(derived).toString('hex')}`
}

async function verifyPassword(password, stored) {
  const raw = String(stored ?? '')
  const body = raw.startsWith(HASH_PREFIX) ? raw.slice(HASH_PREFIX.length) : raw
  const [salt, expectedHex] = body.split(':')
  if (!salt || !expectedHex) return false
  const derived = Buffer.from(await scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS))
  const expected = Buffer.from(expectedHex, 'hex')
  return expected.length === derived.length && timingSafeEqual(expected, derived)
}

/**
 * 会话是否已过期。
 * 采用「按最近使用时间」的滑动过期：持续使用的会话不会被强制登出，
 * 空闲超过 7 天才失效。这与淘汰策略（LRU）语义一致。
 * 唯一的过期判定来源，避免多处比较产生漂移。
 */
function isSessionExpired(session, now = Date.now()) {
  return now - (session.lastSeenAt ?? session.createdAt) > SESSION_TTL_MS
}

function createSession(userId) {
  pruneSessions()
  const sessionId = randomBytes(24).toString('hex')
  const now = Date.now()
  accounts.sessions.set(sessionId, { userId, createdAt: now, lastSeenAt: now })
  accounts.sessions.trim(MAX_SESSIONS)
  return sessionId
}

export function pruneSessions(now = Date.now()) {
  return accounts?.sessions.expire(now - SESSION_TTL_MS) ?? 0
}

function destroySession(sessionId) {
  if (sessionId) accounts.sessions.delete(sessionId)
}

export function sessionCount() {
  return accounts?.sessions.count() ?? 0
}

export function debugSetSessionTimestamps(cookieValue, { createdAt, lastSeenAt }) {
  const session = accounts?.sessions.get(cookieValue)
  if (!session) return false
  if (typeof createdAt === 'number') session.createdAt = createdAt
  if (typeof lastSeenAt === 'number') session.lastSeenAt = lastSeenAt
  accounts.sessions.set(cookieValue, session)
  return true
}

function sessionUser(request, users) {
  const sessionId = parseCookies(request)[SESSION_COOKIE]
  const session = accounts.sessions.get(sessionId)
  if (!session) return undefined
  if (isSessionExpired(session)) {
    accounts.sessions.delete(sessionId)
    return undefined
  }
  session.lastSeenAt = Date.now()
  accounts.sessions.set(sessionId, session)
  return users.find((user) => user.id === session.userId)
}

// ---------------------------------------------------------------------------
// 校验与工具
// ---------------------------------------------------------------------------
function publicUser(user) {
  return { id: user.id, email: user.email, phone: user.phone, name: user.name, bio: user.bio, createdAt: user.createdAt }
}

function normalizePhone(value) { return String(value ?? '').replace(/[^\d]/g, '') }
function isPhone(value) { return /^1[3-9]\d{9}$/.test(value) }
function isEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) }

/**
 * 客户端标识：本地部署下取 socket 远端地址即可。
 * 若将来置于反向代理之后，应显式信任并解析 X-Forwarded-For（当前不信任该头，防止伪造绕过限流）。
 */
function clientIp(request) {
  return request.socket?.remoteAddress ?? 'unknown'
}

/** 无请求体的写操作：不要求 Content-Type: application/json。 */
const BODYLESS_WRITE_PATHS = new Set(['/api/auth/logout', '/api/learning/owner'])

/** R3：统一安全响应头（所有响应都带，含 JSON 与静态资源）。 */
function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    // 本应用为本地单机工具，CSP 收紧到同源。
    // worker-src / script-src 必须显式允许 blob:：JavaScript 沙箱用
    // `new Worker(URL.createObjectURL(blob))` 创建隔离线程；worker-src 缺省时
    // 回退到 script-src，而 blob: 不会被 'self' 覆盖，沙箱会被静默阻断。
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' blob:",
      "worker-src 'self' blob:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  }
}

function sendJson(response, status, data, code, extraHeaders) {
  const body = JSON.stringify(status >= 400 ? { error: data, code: code ?? 'error' } : { data })
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
    ...securityHeaders(),
  })
  response.end(body)
}

/**
 * 带结构化 details 的 JSON 响应（LINK-09 写回专用）。
 * 冲突详情（逐字段差异）必须能到达界面，但仍不裸抛堆栈、不回显资料库绝对路径。
 */
function sendJsonWithDetails(response, status, message, code, details) {
  const body = JSON.stringify({ error: message, code: code ?? 'error', ...(details ? { details } : {}) })
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...securityHeaders(),
  })
  response.end(body)
}

/** 写回错误码 → HTTP 状态。冲突与部分成功都用 409，交由界面区分处理。 */
function writebackErrorStatus(code) {
  if (code === 'forbidden') return 403
  if (code === 'source_not_found') return 404
  if (code === 'vault_unavailable') return 503
  // 事务账本「这一次没读到」：与 GET /api/learning/evidence 的暂存队列同一口径（§11.2），
  // 压成 400 会被界面读成「请求不合法」，而真正的原因是服务端读不出记录。
  if (code === 'transactions_unreadable') return 503
  if (['owner_unbound', 'sync_conflict', 'stale_preview', 'structure_unsupported', 'rollback_blocked', 'operation_rolled_back', 'transaction_corrupt', 'progress_pending'].includes(code)) {
    return 409
  }
  return 400
}

/**
 * 内容接口的稳定错误码 → HTTP 状态。
 * 不向浏览器裸抛堆栈，也不回显资料库绝对路径。
 */
function contentErrorStatus(code) {
  if (code === 'vault_unavailable') return 503
  if (code === 'invalid_manifest' || code === 'source_changed' || code === 'publish_failed') return 409
  if (code === 'not_found') return 404
  if (code === 'content_bundle_retired') return 410
  if (code === 'invalid') return 503
  if (code === 'sync_rate_limited') return 429
  return 400
}

function contentHeaders(bundleId, manifestHash, etag) {
  return {
    'X-Content-Bundle': bundleId,
    'X-Content-Manifest': manifestHash,
    'Cache-Control': 'private, no-cache',
    Vary: 'Cookie, Authorization',
    ETag: `"${etag}"`,
  }
}

function sendContentJson(request, response, result) {
  if (!result.ok) return sendJson(response, contentErrorStatus(result.code), result.message, result.code)
  const headers = contentHeaders(result.bundleId, result.manifestHash, sha256(stableStringify(result.data)))
  if (ifNoneMatchHits(request.headers['if-none-match'], headers.ETag)) {
    response.writeHead(304, { ...headers, ...securityHeaders() })
    return response.end()
  }
  return sendJson(response, 200, result.data, undefined, headers)
}

/** 内容接口统一入口：必须是已登录会话；资料库默认私人。 */
async function handleContentRequest(request, response, url, users) {
  const user = sessionUser(request, users)
  if (!user) return sendJson(response, 401, '资料库内容需要登录后访问', 'unauthorized')

  // LINK-08：教材准入由拥有者绑定决定；未绑定时保持对已登录账户开放。
  const access = await learningService.contentAccess(user.id)
  if (access.reason === 'owner_vault_mismatch') return sendJson(response, 403, '拥有者绑定属于其他资料库', access.reason)
  if (!access.allowed) {
    return sendJson(
      response,
      403,
      access.reason === 'owner_record_corrupt'
        ? '拥有者绑定记录损坏，教材访问已暂停；请修复数据后重试'
        : '该账户未被授权查看此资料库（资料库默认私人）',
      access.reason === 'owner_record_corrupt' ? 'owner_record_corrupt' : 'vault_private',
    )
  }

  if (url.pathname === '/api/content/status' && request.method === 'GET') {
    const state = await contentService.status()
    // 只返回通俗状态与计数，不返回资料库绝对路径或任何私人文件内容。
    return sendJson(response, 200, state)
  }

  if (url.pathname === '/api/content/catalog' && request.method === 'GET') {
    const result = await contentService.catalog(url.searchParams.get('bundleId'), await learningService.readVaultId())
    if (!result.ok) return sendJson(response, contentErrorStatus(result.code), result.message, result.code)
    const identity = instanceIdentity({ dataDir: dataRoot, distDir: distRoot })
    const catalog = {
      ...result.data, serviceInstance: identity.instanceId, contractVersion: 1, minimumClientVersion: 1,
      capabilities: ['pinnedContent', 'assetCas', 'offlineBundle', 'publicationJobs', 'learningSync'],
    }
    return sendContentJson(request, response, { ok: true, bundleId: catalog.bundleId, manifestHash: catalog.manifestHash, data: catalog })
  }

  const lessonMatch = /^\/api\/content\/lessons\/([^/]+)$/.exec(url.pathname)
  if (lessonMatch && request.method === 'GET') {
    const id = safeContentId(lessonMatch[1])
    if (!id) return sendJson(response, 400, '内容 ID 格式非法', 'invalid_content_id')
    const result = await contentService.lesson(id, url.searchParams.get('bundleId'), await learningService.readVaultId())
    return sendContentJson(request, response, result)
  }

  const exerciseMatch = /^\/api\/content\/exercises\/([^/]+)$/.exec(url.pathname)
  if (exerciseMatch && request.method === 'GET') {
    const id = safeContentId(exerciseMatch[1])
    if (!id) return sendJson(response, 400, '练习 ID 格式非法', 'invalid_content_id')
    const result = await contentService.exercise(id, url.searchParams.get('bundleId'), await learningService.readVaultId())
    return sendContentJson(request, response, result)
  }

  const bundleMatch = /^\/api\/content\/bundles\/([^/]+)\/(manifest|payload)$/.exec(url.pathname)
  if (bundleMatch && request.method === 'GET') {
    const vaultId = await learningService.readVaultId()
    const current = await contentService.snapshotStore.readBundle(bundleMatch[1], vaultId)
    if (!current.bundle) return sendJson(response, contentErrorStatus(current.status), '请求的内容快照不可读', current.status)
    const { bundle } = current
    const manifestHash = current.pointer.payloadHash
    const payload = Buffer.from(stableStringify(bundle))
    if (bundleMatch[2] === 'manifest') {
      const data = {
        schemaVersion: 1,
        serviceInstance: instanceIdentity({ dataDir: dataRoot, distDir: distRoot }).instanceId,
        vaultId, bundleId: bundle.bundleId, manifestHash,
        files: [{ path: 'content.json', sha256: manifestHash, size: payload.length }],
        assets: (bundle.assets ?? []).map((asset) => ({
          assetId: publicAssetId(asset), path: 'objects/' + asset.sha256, sha256: asset.sha256,
          size: asset.size, contentType: asset.contentType,
        })),
      }
      return sendContentJson(request, response, { ok: true, bundleId: bundle.bundleId, manifestHash, data })
    }
    const headers = contentHeaders(bundle.bundleId, manifestHash, manifestHash)
    if (ifNoneMatchHits(request.headers['if-none-match'], headers.ETag)) {
      response.writeHead(304, { ...headers, ...securityHeaders() })
      return response.end()
    }
    response.writeHead(200, {
      ...headers, ...securityHeaders(), 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length,
    })
    return response.end(payload)
  }

  // DATA-10 §4：附件与图片按白名单访问（契约见 src/content/README-attachments.md）。
  // 这里只新增这一条分支：401 unauthorized → 403 vault_private/owner_record_corrupt →
  // 既有错误码口径全部沿用上面的链路，全局 /api/content/ 前缀判定与限流不动。
  const opaqueAsset = /^\/api\/content\/assets\/([^/]+)$/.exec(url.pathname)
  if ((url.pathname === '/api/content/asset' || opaqueAsset) && request.method === 'GET') {
    // 附件接口是「试探面」：被拒绝的读取按 R3 同一套滑动窗口计数（独立维度，不影响登录与同步）。
    const probeKey = `content:asset:${user.id}`
    if (isRateLimited(probeKey)) {
      return sendJson(response, 429, '附件访问尝试过于频繁，请稍后再试', 'asset_rate_limited')
    }
    const asset = await resolveContentAsset({
      url,
      assetId: opaqueAsset?.[1],
      vaultId: await learningService.readVaultId(),
      snapshotStore: contentService.snapshotStore,
      ifNoneMatch: request.headers['if-none-match'],
    })
    if (!asset.ok) {
      if (asset.denied) recordFailure(probeKey)
      return sendJson(response, asset.status, asset.message, asset.code)
    }
    response.writeHead(asset.notModified ? 304 : 200, { ...asset.headers, ...securityHeaders() })
    return response.end(asset.notModified ? undefined : asset.bytes)
  }

  if (url.pathname === '/api/content/sync' && request.method === 'POST') {
    const vaultId = await learningService.readVaultId()
    const isOwner = access.reason === 'owner'
    if (!isOwner && (!vaultId || !publicationJobs.canPublish(vaultId, user.id))) {
      return sendJson(response, 403, '该账户没有发布权限', 'publisher_required')
    }
    if (!vaultId) return sendJson(response, 503, '资料库不可用', 'vault_unavailable')
    const key = request.headers['idempotency-key']
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{12,128}$/.test(key)) {
      return sendJson(response, 400, '缺少有效的 Idempotency-Key', 'invalid_idempotency_key')
    }
    const body = await requestBody(request)
    if (typeof body?.dryRun !== 'boolean' || (!body.dryRun && (typeof body.approvalJobId !== 'string' || !safeContentId(body.approvalJobId)))) {
      return sendJson(response, 400, '发送 dryRun 或提供已完成的候选校验编号', 'approval_required')
    }
    const approvalJobId = body.dryRun ? null : body.approvalJobId
    const requestHash = sha256(stableStringify({ dryRun: body.dryRun, approvalJobId }))
    const scope = { vaultId, accountId: user.id, isOwner }
    const approval = approvalJobId ? publicationJobs.get(approvalJobId, scope) : null
    if (!body.dryRun && (approval?.status !== 'ready' || !approval.dryRun || !approval.approvalFingerprint)) {
      return sendJson(response, 409, '候选校验尚未完成或不可用', 'approval_required')
    }
    const limitKey = `content:sync:${user.id}`
    const change = publicationJobs.reserve({ ...scope, key, requestHash, dryRun: body.dryRun, rateLimited: rateLimitCount(limitKey, CONTENT_SYNC_MAX), active: Boolean(contentService.snapshotStore.currentJob()) })
    if (change.code === 'sync_rate_limited') return sendJson(response, 429, '同步过于频繁，请稍后再试', change.code)
    if (change.code) return sendJson(response, 409, '发布请求冲突或已有任务正在运行', change.code)
    if (!change.reused) {
      recordFailure(limitKey)
      void executePublication(change, approval?.approvalFingerprint).catch((error) => {
        console.error(JSON.stringify({ event: 'publish_job_storage_failed', code: error.code ?? 'storage_error' }))
      })
    }
    return sendJson(response, 202, { ...change.job, reused: change.reused })
  }
  const jobMatch = /^\/api\/content\/sync\/([^/]+)$/.exec(url.pathname)
  if (jobMatch && request.method === 'GET') {
    const vaultId = await learningService.readVaultId()
    const job = publicationJobs.get(safeContentId(jobMatch[1]) ?? '', { vaultId, accountId: user.id, isOwner: access.reason === 'owner' })
    if (!job) return sendJson(response, 404, '同步任务不存在', 'job_not_found')
    return sendJson(response, 200, job)
  }

  return sendJson(response, 404, '接口不存在', 'not_found')
}

async function executePublication({ job, attempt }, approvedFingerprint) {
  function terminal(active, committed = false) {
    const status = committed ? 'ready' : active.status
    return {
      ...job, status, finishedAt: new Date().toISOString(), published: committed,
      approvalFingerprint: job.dryRun && status === 'ready' ? active.approvalFingerprint : null,
      error: active.error ? { code: active.error.code, message: active.error.code === 'approval_stale' ? '请重新校验候选内容' : '发布任务未通过，请查看本机诊断' } : null,
      summary: active.report ? { bundleId: active.report.bundleId, counts: active.report.counts, blockingCount: active.report.blocking.length } : null,
    }
  }
  let receipt
  try {
    const started = await contentService.sync({
      dryRun: job.dryRun, approvedFingerprint,
      receiptFor: (active) => {
        receipt = terminal(active, true)
        return { jobId: job.jobId, attempt, result: receipt }
      },
    })
    if (started.reused) throw new Error('发布作业重复执行')
    await started.job.promise
    if (!receipt) publicationJobs.complete(job.jobId, attempt, terminal(started.job))
  } catch {
    if (!receipt) {
      publicationJobs.complete(job.jobId, attempt, terminal({ status: 'unavailable', error: { code: 'publish_failed' } }))
    }
  }
}

async function handleLearningSync(request, response, url, users) {
  const user = sessionUser(request, users)
  if (!user) return sendJson(response, 401, '学习同步需要登录', 'unauthorized')
  const access = await learningService.contentAccess(user.id)
  if (access.reason !== 'owner') {
    return sendJson(response, 403, '该账户未获同步授权', access.reason === 'owner_vault_mismatch' ? access.reason : 'sync_forbidden')
  }
  const scope = { accountId: user.id, vaultId: await learningService.readVaultId() }
  if (!scope.vaultId) return sendJson(response, 503, '资料库不可用', 'vault_unavailable')
  try {
    if (request.method === 'GET') {
      switch (url.pathname) {
        case '/api/sync/state': return sendJson(response, 200, learningSync.state(scope))
        case '/api/sync/pull': return sendJson(response, 200, learningSync.pull(scope, url.searchParams.get('cursor'), Number(url.searchParams.get('limit') ?? 100)))
        case '/api/sync/conflicts': return sendJson(response, 200, learningSync.conflicts(scope))
      }
    }
    if (url.pathname === '/api/sync/push' && request.method === 'POST') {
      const input = await requestBody(request)
      if (request.headers['idempotency-key'] !== input?.changeId || typeof input?.changeId !== 'string') {
        return sendJson(response, 400, 'Idempotency-Key 必须与 changeId 一致', 'invalid_idempotency_key')
      }
      const result = await learningSync.push(scope, input)
      return sendJson(response, 200, result)
    }
    return sendJson(response, 404, '接口不存在', 'not_found')
  } catch (error) {
    if (error.status && error.code) return sendJson(response, error.status, error.message, error.code)
    throw error
  }
}

/** 学习事实接口（LINK-08）：绑定状态、拥有者绑定、教材可见范围、正式进度只读投影。 */
async function handleLearningRequest(request, response, url, users) {
  const user = sessionUser(request, users)
  if (!user) return sendJson(response, 401, '学习事实需要登录后访问', 'unauthorized')
  const vaultAccess = await learningService.contentAccess(user.id)
  if (vaultAccess.reason === 'owner_vault_mismatch') return sendJson(response, 403, '拥有者绑定属于其他资料库', vaultAccess.reason)

  if (url.pathname === '/api/learning/status' && request.method === 'GET') {
    return sendJson(response, 200, await learningService.status(user.id))
  }

  if (url.pathname === '/api/learning/owner' && request.method === 'POST') {
    if (!users.some((item) => item.id === user.id)) {
      return sendJson(response, 401, '账户无效', 'unauthorized')
    }
    // 显式绑定：必须由用户主动提交确认，服务端不根据昵称/邮箱猜测。
    const body = await requestBody(request).catch(() => ({}))
    if (body?.confirm !== true) {
      return sendJson(response, 400, '绑定拥有者需要显式确认（confirm: true）', 'confirmation_required')
    }
    try {
      return sendJson(response, 200, await learningService.bind(user.id))
    } catch (error) {
      return sendJson(response, error?.code === 'owner_taken' ? 409 : 400, error?.message ?? '绑定失败', error?.code ?? 'bind_failed')
    }
  }

  if (url.pathname === '/api/learning/owner' && request.method === 'DELETE') {
    try {
      return sendJson(response, 200, await learningService.unbind(user.id))
    } catch (error) {
      return sendJson(response, 403, error?.message ?? '解绑失败', error?.code ?? 'unbind_failed')
    }
  }

  if (url.pathname === '/api/learning/owner/visibility' && request.method === 'PATCH') {
    const body = await requestBody(request)
    try {
      return sendJson(response, 200, await learningService.setVisibility(user.id, body?.publicContent === true))
    } catch (error) {
      return sendJson(response, 403, error?.message ?? '修改失败', error?.code ?? 'visibility_failed')
    }
  }

  if (url.pathname === '/api/learning/vault-progress' && request.method === 'GET') {
    const result = await learningService.vaultProgress(user.id)
    if (!result.ok) {
      const statusCode = result.code === 'forbidden' ? 403 : result.code === 'owner_unbound' ? 409 : 503
      return sendJson(response, statusCode, result.message, result.code)
    }
    return sendJson(response, 200, result.data)
  }

  // -------------------------------------------------------------------------
  // LINK-09 确认式写回：暂存证据 → 预览 → 提交（仅拥有者）。
  // 全部不接受客户端传路径：目标文件由服务端按日期与主题推导。
  // -------------------------------------------------------------------------

  if (url.pathname === '/api/learning/evidence' && request.method === 'POST') {
    const body = await requestBody(request).catch(() => ({}))
    const result = await learningService.stageEvidence(user.id, body)
    if (!result.ok) return sendJson(response, 400, result.message, result.code)
    return sendJson(response, 201, result.data)
  }

  if (url.pathname === '/api/learning/evidence' && request.method === 'GET') {
    // 队列读取失败（暂存文件损坏等）不能被顶层兜底压成 400：那会让界面把它看成
    // 「请求不合法」而不是「服务端这次没读到」。给 503 + 稳定错误码，界面据此
    // 显示带原因的失败态并提供重试（00 号方案 §6 产品门禁 + 02 号方案 §8 数据验收清单）。
    try {
      return sendJson(response, 200, (await learningService.listEvidence(user.id)).data)
    } catch (error) {
      return sendJson(response, 503, error?.message ?? '暂存证据读取失败', error?.code ?? 'evidence_store_unreadable')
    }
  }

  if (url.pathname === '/api/learning/evidence/remove' && request.method === 'POST') {
    const body = await requestBody(request).catch(() => ({}))
    const result = await learningService.removeEvidence(user.id, String(body?.evidenceId ?? ''))
    if (!result.ok) return sendJson(response, 400, result.message, result.code)
    return sendJson(response, 200, result.data)
  }

  if (url.pathname === '/api/learning/evidence-preview' && request.method === 'POST') {
    const body = await requestBody(request).catch(() => ({}))
    const result = await learningService.previewEvidence(user.id, {
      evidenceIds: body?.evidenceIds,
      masteryUpdates: body?.masteryUpdates,
    })
    if (!result.ok) return sendJsonWithDetails(response, writebackErrorStatus(result.code), result.message, result.code, result.details)
    return sendJson(response, 200, result.data)
  }

  if (url.pathname === '/api/learning/evidence-commit' && request.method === 'POST') {
    const body = await requestBody(request).catch(() => ({}))
    const result = await learningService.commitEvidence(user.id, {
      operationId: body?.operationId,
      expectedHashes: body?.expectedHashes,
    })
    if (!result.ok) return sendJsonWithDetails(response, writebackErrorStatus(result.code), result.message, result.code, result.details)
    return sendJson(response, 200, result.data)
  }

  if (url.pathname === '/api/learning/evidence-rollback' && request.method === 'POST') {
    const body = await requestBody(request).catch(() => ({}))
    const result = await learningService.rollbackEvidence(user.id, body?.operationId)
    if (!result.ok) return sendJsonWithDetails(response, writebackErrorStatus(result.code), result.message, result.code, result.details)
    return sendJson(response, 200, result.data)
  }

  if (url.pathname === '/api/learning/evidence-export' && request.method === 'POST') {
    const body = await requestBody(request).catch(() => ({}))
    const result = await learningService.exportEvidence(user.id, { evidenceIds: body?.evidenceIds })
    if (!result.ok) return sendJson(response, 400, result.message, result.code)
    return sendJson(response, 200, result.data)
  }

  // 事务账本（挂账 #35）：只读列出拥有者的写回事务，新→旧、条数受限。
  // 界面刷新后靠它复原「部分成功」横幅与逐步明细，不再只认 React 状态里的 operationId。
  if (url.pathname === '/api/learning/evidence-transactions' && request.method === 'GET') {
    const result = await learningService.evidenceTransactions(user.id)
    if (!result.ok) return sendJsonWithDetails(response, writebackErrorStatus(result.code), result.message, result.code, result.details)
    return sendJson(response, 200, result.data)
  }

  const transactionMatch = /^\/api\/learning\/evidence-transaction\/([^/]+)$/.exec(url.pathname)
  if (transactionMatch && request.method === 'GET') {
    const operationId = decodeURIComponentSafe(transactionMatch[1])
    const result = await learningService.evidenceTransaction(user.id, operationId)
    if (!result.ok) return sendJson(response, writebackErrorStatus(result.code), result.message, result.code)
    return sendJson(response, 200, result.data)
  }

  return sendJson(response, 404, '接口不存在', 'not_found')
}

/** 内容 ID 只接受受限字符集；绝不接受路径、`..` 或盘符。 */
function safeContentId(raw) {
  const value = decodeURIComponentSafe(raw)
  if (!value || value.length > 96) return null
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) ? value : null
}

function decodeURIComponentSafe(raw) {
  try {
    return decodeURIComponent(raw)
  } catch {
    return ''
  }
}

/** 独立维度的限流计数是否已达上限（不增加计数）。 */
function rateLimitCount(key, max) {
  return (rateLimits.get(key)?.count ?? 0) >= max
}

/**
 * R3 写操作前置校验：要求 application/json，并做跨源纵深防御。
 * 无请求体的写操作（如登出）不要求 Content-Type。
 * 返回 null 表示通过；否则返回应发送的错误响应参数。
 */
function guardWriteRequest(request, url) {
  // 跨源纵深防御优先：现代浏览器的 Sec-Fetch-Site 可判定跨站发起。
  const fetchSite = String(request.headers['sec-fetch-site'] ?? '')
  if (fetchSite === 'cross-site') {
    return { status: 403, message: '拒绝跨站写请求', code: 'cross_site_rejected' }
  }
  const origin = request.headers.origin
  if (origin) {
    const host = request.headers.host ?? ''
    let originHost
    try {
      originHost = new URL(origin).host
    } catch {
      originHost = undefined
    }
    if (!originHost || originHost !== host) {
      return { status: 403, message: '拒绝非同源写请求', code: 'cross_site_rejected' }
    }
  }
  // 无请求体的端点（登出）无需 Content-Type。
  if (BODYLESS_WRITE_PATHS.has(url.pathname)) return null
  const contentType = String(request.headers['content-type'] ?? '')
  if (!contentType.toLowerCase().includes('application/json')) {
    return { status: 415, message: '请求需使用 Content-Type: application/json', code: 'unsupported_media_type' }
  }
  return null
}

function parseCookies(request) {
  return Object.fromEntries(
    (request.headers.cookie ?? '')
      .split(';')
      .filter(Boolean)
      .map((item) => {
        const [key, ...value] = item.trim().split('=')
        return [key, decodeURIComponentSafe(value.join('='))]
      }),
  )
}

function requestBody(request) {
  return new Promise((resolveBody, reject) => {
    let raw = ''
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('请求体过大'), { code: 'body_too_large' }))
        request.destroy()
        return
      }
      raw += chunk
    })
    request.on('end', () => {
      try {
        resolveBody(JSON.parse(raw || '{}'))
      } catch {
        reject(Object.assign(new Error('请求格式无效'), { code: 'invalid_json' }))
      }
    })
    request.on('error', reject)
  })
}

function sessionCookieHeader(sessionId) {
  return `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`
}

function clearedCookieHeader() {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
}

// ---------------------------------------------------------------------------
// API 路由
// ---------------------------------------------------------------------------
async function handleApi(request, response, url) {
  // R3：健康检查最先处理，不读取用户文件、不受数据损坏状态影响，也不暴露任何用户信息。
  // §6.1：只额外带项目/实例/构建标识供启动器核对；资料库与页面是否就绪不在健康探针里宣称。
  if (url.pathname === '/api/health' && request.method === 'GET') {
    return sendJson(response, 200, {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      ...instanceIdentity({ dataDir: dataRoot, distDir: distRoot }),
    })
  }

  // 首次导入前校验旧账户格式。
  const users = await readUsers()
  if (dataState === 'corrupt') {
    return sendJson(response, 503, '用户数据文件已损坏，服务进入只读保护状态；请按 README 恢复数据后重启', 'storage_corrupt')
  }
  try {
    // R3：所有写操作统一做 Content-Type 与跨源校验。
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const rejection = guardWriteRequest(request, url)
      if (rejection) return sendJson(response, rejection.status, rejection.message, rejection.code)
    }

    if (url.pathname === '/api/auth/me' && request.method === 'GET') {
      const user = sessionUser(request, users)
      return sendJson(response, 200, user ? publicUser(user) : null)
    }

    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      destroySession(parseCookies(request)[SESSION_COOKIE])
      response.setHeader('Set-Cookie', clearedCookieHeader())
      return sendJson(response, 200, null)
    }

    if (url.pathname === '/api/auth/register' && request.method === 'POST') {
      if (process.env.CODEWEAVE_ALLOW_REGISTRATION !== '1') return sendJson(response, 403, '本机实例已关闭普通注册', 'registration_closed')
      const body = await requestBody(request)
      return await handleRegister(body, request, response, users)
    }

    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      const body = await requestBody(request)
      return await handleLogin(body, request, response, users)
    }

    if (url.pathname === '/api/profile' && request.method === 'PATCH') {
      const body = await requestBody(request)
      return await handleProfileUpdate(body, request, response, users)
    }

    if (url.pathname === '/api/auth/change-password' && request.method === 'POST') {
      const user = sessionUser(request, users)
      if (!user) return sendJson(response, 401, '请先登录', 'unauthorized')
      const body = await requestBody(request)
      const currentPassword = String(body.currentPassword ?? '')
      const newPassword = String(body.newPassword ?? '')
      // R3：进入 scrypt 前先做长度上限，避免超长输入造成 CPU 消耗。
      if (currentPassword.length > MAX_PASSWORD_LENGTH || newPassword.length > MAX_PASSWORD_LENGTH) {
        return sendJson(response, 400, '密码长度超出上限', 'invalid_password')
      }
      if (!(await verifyPassword(currentPassword, user.passwordHash))) {
        return sendJson(response, 400, '当前密码不正确', 'wrong_current_password')
      }
      if (newPassword.length < 8 || newPassword.length > MAX_PASSWORD_LENGTH) {
        return sendJson(response, 400, '密码需要 8-128 个字符', 'invalid_password')
      }
      if (newPassword === currentPassword) {
        return sendJson(response, 400, '新密码不能与当前密码相同', 'password_unchanged')
      }
      user.passwordHash = await hashPassword(newPassword)
      try {
        accounts.put(user)
      } catch {
        return sendJson(response, 500, '修改失败：无法写入用户数据', 'storage_error')
      }
      // 安全惯例：改密后使该用户的其余会话全部失效，仅保留发起修改的当前会话。
      const currentSessionId = parseCookies(request)[SESSION_COOKIE]
      accounts.sessions.deleteOthers(user.id, currentSessionId)
      return sendJson(response, 200, null)
    }

    // LINK-05：内容联动接口。必须在认证分支内、且不接受任何磁盘路径参数。
    if (url.pathname.startsWith('/api/content/')) {
      return await handleContentRequest(request, response, url, users)
    }

    // LINK-08：学习事实接口（拥有者绑定与正式进度只读投影）。
    if (url.pathname.startsWith('/api/sync/')) return await handleLearningSync(request, response, url, users)
    if (url.pathname.startsWith('/api/learning/')) {
      return await handleLearningRequest(request, response, url, users)
    }

    return sendJson(response, 404, '接口不存在', 'not_found')
  } catch (error) {
    if (error?.code === 'storage_corrupt') {
      return sendJson(response, 503, error.message, error.code)
    }
    if (error?.code) {
      return sendJson(response, 400, error.message, error.code)
    }
    return sendJson(response, 500, '服务器内部错误', 'internal_error')
  }
}

async function handleRegister(body, request, response, users) {
  const name = String(body.name ?? '').trim()
  const contactType = body.contactType === 'phone' ? 'phone' : 'email'
  const email = contactType === 'email' ? String(body.email ?? '').trim().toLowerCase() : undefined
  const phone = contactType === 'phone' ? normalizePhone(body.phone) : undefined
  const password = String(body.password ?? '')

  if (typeof body.name !== 'string' || name.length < 2 || name.length > 40) {
    return sendJson(response, 400, '昵称需要 2-40 个字符', 'invalid_name')
  }
  if (contactType === 'email' && !isEmail(email)) {
    return sendJson(response, 400, '请输入有效的邮箱地址', 'invalid_email')
  }
  if (contactType === 'phone' && !isPhone(phone)) {
    return sendJson(response, 400, '请输入有效的 11 位手机号码', 'invalid_phone')
  }
  if (password.length < 8 || password.length > MAX_PASSWORD_LENGTH) {
    return sendJson(response, 400, '密码需要 8-128 个字符', 'invalid_password')
  }
  if (contactType === 'email' && users.some((user) => user.email === email)) {
    return sendJson(response, 409, '该邮箱已经注册', 'email_taken')
  }
  if (contactType === 'phone' && users.some((user) => user.phone === phone)) {
    return sendJson(response, 409, '该手机号码已经注册', 'phone_taken')
  }

  const user = {
    id: `user-${randomBytes(8).toString('hex')}`,
    email,
    phone,
    name,
    bio: '开始记录你的编程旅程。',
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString(),
  }
  users.push(user)
  try {
    accounts.put(user)
  } catch {
    return sendJson(response, 500, '注册失败：无法保存用户数据', 'storage_error')
  }

  const sessionId = createSession(user.id)
  response.setHeader('Set-Cookie', sessionCookieHeader(sessionId))
  return sendJson(response, 201, publicUser(user))
}

async function handleLogin(body, request, response, users) {
  const identifier = String(body.identifier ?? body.email ?? body.phone ?? '').trim()
  const email = identifier.toLowerCase()
  const phone = normalizePhone(identifier)
  const password = String(body.password ?? '')

  if (!identifier || !password) {
    return sendJson(response, 400, '请输入账号和密码', 'invalid_credentials_format')
  }
  // R3：进入 scrypt 前先做长度上限，避免超长输入造成 CPU 消耗。
  if (password.length > MAX_PASSWORD_LENGTH) {
    return sendJson(response, 400, '密码长度超出上限', 'invalid_password')
  }

  // R3 限流：按账号标识与来源 IP 两个维度计数；返回信息不区分账号是否存在。
  const identifierKey = `login:id:${email || phone}`
  const ipKey = `login:ip:${clientIp(request)}`
  if (isRateLimited(identifierKey) || isRateLimited(ipKey)) {
    return sendJson(response, 429, '尝试过于频繁，请稍后再试', 'too_many_attempts')
  }

  const user = users.find((item) => item.email === email || item.phone === phone)
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    recordFailure(identifierKey)
    recordFailure(ipKey)
    return sendJson(response, 401, '邮箱或手机号与密码不匹配', 'invalid_credentials')
  }

  clearFailures(identifierKey)
  const sessionId = createSession(user.id)
  response.setHeader('Set-Cookie', sessionCookieHeader(sessionId))
  return sendJson(response, 200, publicUser(user))
}

async function handleProfileUpdate(body, request, response, users) {
  const user = sessionUser(request, users)
  if (!user) return sendJson(response, 401, '请先登录', 'unauthorized')

  const name = String(body.name ?? '').trim()
  const bio = String(body.bio ?? '').trim()
  if (name.length < 2 || name.length > 40) {
    return sendJson(response, 400, '昵称需要 2-40 个字符', 'invalid_name')
  }
  if (bio.length > 160) {
    return sendJson(response, 400, '个人简介不能超过 160 个字符', 'invalid_bio')
  }

  user.name = name
  user.bio = bio
  try {
    accounts.put(user)
  } catch {
    return sendJson(response, 500, '保存失败：无法写入用户数据', 'storage_error')
  }
  return sendJson(response, 200, publicUser(user))
}

// ---------------------------------------------------------------------------
// 静态资源（限制在 dist 内，防止路径穿越）
// ---------------------------------------------------------------------------
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

/** 静态资源缓存策略：Vite 产物带内容哈希，可长期不可变缓存；HTML 与无哈希文件每次校验。 */
function cacheControlFor(filePath) {
  const ext = extname(filePath).toLowerCase()
  // 入口 HTML 始终不缓存，保证发版后能立即拿到新的资源引用。
  if (ext === '.html') return 'no-cache'
  // Vite 产物形如 index-91oKdP6d.js / react-vendor-CPRZ3xNa.css：
  // 以「-<8 位以上哈希>.<扩展名>」结尾即视为内容寻址，可长期缓存。
  const hashed = /-[0-9A-Za-z_-]{8,}\.(?:js|mjs|css|woff2?|png|jpe?g|svg|webp|ico|map)$/.test(filePath)
  return hashed ? 'public, max-age=31536000, immutable' : 'no-cache'
}

function serveStatic(request, response, url) {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname
  // 路径穿越防护：先规范化分隔符（含反斜杠与重复斜杠），再做 dist 边界检查。
  // decodeURIComponent 对畸形编码（如 %ZZ）会抛错，退化为 400 而非 500。
  let decoded
  try {
    decoded = decodeURIComponent(requested)
  } catch {
    return sendJson(response, 400, '请求路径编码无效', 'invalid_path_encoding')
  }
  const safePath = decoded.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  const filePath = resolve(distRoot, `.${normalize(safePath)}`)
  const withinDist = relative(distRoot, filePath)
  const isInside = withinDist !== '' && !withinDist.startsWith('..') && !isAbsolutePath(withinDist)
  if (isInside && existsSync(filePath)) {
    response.writeHead(200, {
      'Content-Type': mime[extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': cacheControlFor(filePath),
      ...securityHeaders(),
    })
    createReadStream(filePath).pipe(response)
  } else {
    sendJson(response, 404, '页面不存在', 'not_found')
  }
}

/** 判断相对路径是否为绝对路径（跨平台）。 */
function isAbsolutePath(value) {
  return value.startsWith('/') || /^[A-Za-z]:/.test(value)
}

/** 慢速请求防护超时（毫秒）：本地工具也要防止连接长期占用。 */
const REQUEST_TIMEOUT_MS = 30_000
const HEADERS_TIMEOUT_MS = 10_000

// ---------------------------------------------------------------------------
// 服务器工厂（导出供集成测试使用）
// ---------------------------------------------------------------------------
export function createCodeCanvasServer() {
  const server = createHttpServer(async (request, response) => {
    const startedAt = Date.now()
    try {
      await initialize()
      // 以固定 origin 解析：request.url 只可能是路径+查询串。
      // 若直接 new URL(request.url, ...)，形如 "//package.json" 会被当作协议相对 URL，
      // 导致 host 被劫持为 "package.json"、pathname 退化为 "/"，从而错误地返回首页。
      // 先把开头的重复斜杠折叠为单个斜杠，再解析。
      const rawUrl = String(request.url ?? '/')
      const safeUrl = rawUrl.startsWith('//') ? `/${rawUrl.replace(/^\/+/, '')}` : rawUrl
      const url = new URL(safeUrl, `http://${request.headers.host ?? '127.0.0.1'}`)
      if (url.pathname.startsWith('/api/')) await handleApi(request, response, url)
      else serveStatic(request, response, url)
    } catch (error) {
      // R3：不把内部堆栈或错误详情返回客户端，仅记录到服务端日志。
      console.error(JSON.stringify({ event: 'request_failed', message: error instanceof Error ? error.message : String(error) }))
      if (!response.headersSent) {
        sendJson(response, 500, '服务器内部错误', 'internal_error')
      } else {
        response.end()
      }
    } finally {
      // 结构化访问日志：只记录方法、路径、状态、耗时，绝不记录请求体/Cookie/凭据。
      // 高频探测或测试环境可用 CODE_CANVAS_QUIET_LOGS=1 关闭。
      if (process.env.CODE_CANVAS_QUIET_LOGS !== '1') {
        const emitAccessLog = () => {
          console.log(
            JSON.stringify({
              event: 'request',
              method: request.method,
              // 去掉查询串，避免把查询参数写入日志
              path: String(request.url ?? '/').split('?')[0],
              status: response.statusCode,
              durationMs: Date.now() - startedAt,
            }),
          )
        }
        // 注意：response.end() 会在返回前同步派发 'close'（writableFinished 随之变为 true），
        // 因此在此处注册 'close' 时事件往往已经错过，导致访问日志整体丢失。
        // 先判断是否已结束，已结束则直接记录；否则等 'finish'（正常写完）或未写完即被
        // 提前中断的 'close' 兜底，保证恰好记录一次。
        if (response.writableFinished) {
          emitAccessLog()
        } else {
          let logged = false
          const logOnce = () => {
            if (logged) return
            logged = true
            emitAccessLog()
          }
          response.once('finish', logOnce)
          response.once('close', logOnce)
        }
      }
    }
  })
  // 慢速请求与响应头超时：防止连接长时间占用（slowloris 类）。
  server.requestTimeout = REQUEST_TIMEOUT_MS
  server.headersTimeout = HEADERS_TIMEOUT_MS
  server.keepAliveTimeout = 5_000
  return server
}

async function start() {
  // §6.2：配置把数据目录指向空目录、而旧目录仍持有账户时拒绝启动，
  // 避免「换根后看起来账户没了」。修正配置或先迁移数据。
  if (runtime.conflicts.length) {
    for (const conflict of runtime.conflicts) console.error(`[code-canvas] ${conflict.message}`)
    process.exit(2)
  }
  // R1：单实例锁 + 遗留临时文件清理。
  const lock = acquireLock()
  if (!lock.ok) {
    console.error(`[code-canvas] 检测到另一个实例已在运行（PID ${lock.holder ?? '未知'}，锁文件 ${lockPath}），本实例拒绝启动。`)
    process.exit(1)
  }
  try {
    cleanupTempFiles()
    await initialize()
  } catch (error) {
+
+    server.close(() => process.exit(0))
    throw error
  }
  const server = createCodeCanvasServer()
  // R3：端口只由服务端决定。被占用时明确失败并给出可读提示，
  // 不再静默递增改口（避免启动器探测端口与实际监听端口不一致）。
  const port = runtime.port
  try {
    await new Promise((resolveListen, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolveListen)
    })
  } catch (error) {
    if (error?.code === 'EADDRINUSE') {
      console.error(`[code-canvas] 端口 ${port} 已被占用，本实例拒绝启动。请设置 PORT 环境变量改用其他端口，或关闭占用该端口的进程。`)
  +
+    server.close(() => process.exit(0))
      process.exit(1)
    }
    throw error
  }
  // 过期会话周期清理。
  const sweepTimer = setInterval(() => pruneSessions(), SESSION_SWEEP_INTERVAL_MS)
  sweepTimer.unref?.()
  const url = `http://127.0.0.1:${port}/`
  console.log(`Code Canvas is running at ${url}`)
  console.log(`SQLite 数据目录：${dataRoot}`)
  console.log('会话由 SQLite 持久保存。')
  // 优雅关闭：释放单实例锁，避免残留锁文件阻塞下次启动。
  const shutdown = () => {
    clearInterval(sweepTimer)
+
+    server.close(() => process.exit(0))
    server.close(() => process.exit(0))
    // 兜底：连接未及时释放时强制退出。
    setTimeout(() => process.exit(0), 3000).unref?.()
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  if (process.platform === 'win32' && process.env.CODE_CANVAS_NO_OPEN !== '1') {
    const { exec } = await import('node:child_process')
    exec(`start "" "${url}"`, () => {})
  }
  return server
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  const operation = process.argv[2] === '--initialize-local'
    ? initializeLocal(process.argv[3]).then((result) => {
        const { initialized, accountCount, vaultId, bundleId, manifestHash, lessonCount, approvalJobId, publishJobId } = result
        console.log(JSON.stringify({
          initialized, accountCount, vaultId, bundleId, manifestHash, lessonCount: lessonCount ?? result.lessons.length,
          approvalJobId, publishJobId,
        }))
      })
    : start()
  operation.catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
