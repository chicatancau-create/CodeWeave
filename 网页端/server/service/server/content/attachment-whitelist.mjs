/**
 * 附件白名单与路径合法性判据（**后端副本**，契约源见 `contracts/asset-whitelist.json`）。
 *
 * 为什么后端要有一份纯函数：`tests/content.asset.test.mjs` 要证明「前后端是同一份白名单」，
 * 以前它是直接 `import` 网页端 `src/content/wikilink.ts` 的 `ASSET_ALLOWED_EXTENSIONS`、
 * `ASSET_IMAGE_EXTENSIONS`、`resolveImageAttachment` 来比对的——那正是分离方案 §2 耦合表里
 * 「后端测试直接导入 `../../frontend/src/...`」这一条。§5 允许跨边界共享的只有「不含业务状态的
 * 格式定义」，所以白名单与路径规则被抽成契约数据，本文件按契约实现，行为逐字对齐原前端函数。
 *
 * 加载即自证的三件事（任何一件不成立就直接抛，不留「绿着骗人」的余地）：
 * 1. 契约里的类别扩展名并集 == `asset.mjs` 的 `ASSET_TYPES` 键集（服务端放行面与共享契约同源）；
 * 2. `neverOpened` 里那些可执行/可嵌入类型必须**确实不在**白名单里（防止有人从表里删一行就当排除）；
 * 3. `pathRules.rules` 的顺序、判定对象与文案齐全且可执行（判据形状变了这里就红，而不是悄悄换语义）。
 *
 * 与网页端 `resolveImageAttachment()` 的口径差别只有一处：本函数**不生成 `<img>`**，
 * 只给出 `kind` / `relPath` / `src` 三个判定结果。是否真的可读仍由服务端的白名单 +
 * 已发布目录门禁 + 鉴权决定（见 `asset.mjs` 的 `resolveContentAsset()`）。
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { ASSET_TYPES, assetExtensionOf } from './asset.mjs'

export const ATTACHMENT_CONTRACT_PATH = join(resolve(import.meta.dirname, '..', '..', '..'), 'contracts', 'asset-whitelist.json')
export const ATTACHMENT_CONTRACT_SCHEMA_VERSION = 1

const KNOWN_TARGETS = new Set(['raw', 'compact', 'compactSegments'])
const KNOWN_TESTS = new Set(['codepointRanges', 'isEmpty', 'longerThanMax', 'regex', 'startsWith', 'someSegmentEquals', 'someSegmentRegex'])

function loadContract() {
  const raw = JSON.parse(readFileSync(ATTACHMENT_CONTRACT_PATH, 'utf8'))
  if (raw.schemaVersion !== ATTACHMENT_CONTRACT_SCHEMA_VERSION) {
    throw new Error(`附件契约 schemaVersion=${raw.schemaVersion}，本副本只认 ${ATTACHMENT_CONTRACT_SCHEMA_VERSION}`)
  }
  const categories = Array.isArray(raw.categories) ? raw.categories : []
  if (categories.length === 0) throw new Error('附件契约没有任何类别：白名单会被读成「什么都不放行」')
  for (const category of categories) {
    if (!Array.isArray(category?.extensions) || category.extensions.some((ext) => typeof ext !== 'string' || ext === '')) {
      throw new Error(`附件契约类别 ${category?.id} 的 extensions 不合法`)
    }
  }
  const rules = raw.pathRules?.rules
  if (!Array.isArray(rules) || rules.length === 0) throw new Error('附件契约的 pathRules.rules 是空的：越界判定会一条都不执行')
  for (const [index, rule] of rules.entries()) {
    if (!KNOWN_TARGETS.has(rule?.on)) throw new Error(`附件契约规则 ${rule?.id} 的 on=${rule?.on} 不可识别`)
    if (!KNOWN_TESTS.has(rule?.test)) throw new Error(`附件契约规则 ${rule?.id} 的 test=${rule?.test} 不可识别`)
    if (typeof rule?.reason !== 'string' || rule.reason.trim() === '') throw new Error(`附件契约规则 ${rule?.id} 缺少拒绝理由文案`)
    if (rule.test === 'regex' || rule.test === 'someSegmentRegex') {
      if (typeof rule.source !== 'string') throw new Error(`附件契约规则 ${rule.id} 缺少 source`)
      try {
        new RegExp(rule.source, rule.flags ?? '')
      } catch (error) {
        throw new Error(`附件契约规则 ${rule.id} 的正则无法编译：${error.message}`)
      }
    }
  }
  return raw
}

const CONTRACT = loadContract()

/** 客户端可内嵌的位图（与网页端 `ASSET_IMAGE_EXTENSIONS` 同序）。 */
export const ATTACHMENT_IMAGE_EXTENSIONS = Object.freeze(
  CONTRACT.categories.filter((category) => category.embeddedByClient).flatMap((category) => category.extensions),
)
/** 白名单全集：类别扩展名的并集，顺序按类别书写顺序。 */
export const ATTACHMENT_ALLOWED_EXTENSIONS = Object.freeze(CONTRACT.categories.flatMap((category) => category.extensions))
export const ATTACHMENT_ENDPOINT = CONTRACT.endpoint

const IMAGE_SET = new Set(ATTACHMENT_IMAGE_EXTENSIONS)
const ALLOWED_SET = new Set(ATTACHMENT_ALLOWED_EXTENSIONS)

/** 扩展名 → 契约类别 id；不在白名单里返回 `null`。 */
export function assetCategoryOf(extension) {
  const ext = String(extension ?? '').toLowerCase()
  for (const category of CONTRACT.categories) {
    if (category.extensions.includes(ext)) return category.id
  }
  return null
}

// ---------------------------------------------------------------------------
// 加载即自证：副本与同包的放行面（ASSET_TYPES）必须一字不差
// ---------------------------------------------------------------------------
const mimeKeys = Object.keys(ASSET_TYPES).sort()
const contractKeys = [...ALLOWED_SET].sort()
if (mimeKeys.join('|') !== contractKeys.join('|')) {
  throw new Error(
    `附件白名单漂移：契约列了 [${contractKeys.join(',')}]，而 asset.mjs 的 ASSET_TYPES 是 [${mimeKeys.join(',')}]` +
      '—— 两边必须一起改，改一边就是「前端以为能读、服务端 403」那种事故',
  )
}
for (const ext of CONTRACT.neverOpened?.extensions ?? []) {
  if (ALLOWED_SET.has(ext)) throw new Error(`附件契约把 ${ext} 同时列为「永不开放」和白名单成员`)
}
export const ATTACHMENT_NEVER_OPENED = Object.freeze([...(CONTRACT.neverOpened?.extensions ?? [])])

// ---------------------------------------------------------------------------
// 路径合法性：一套规则，按契约顺序求值（对齐网页端 rejectReasonFor）
// ---------------------------------------------------------------------------

/** 码位是否属于「判定时要先剔除」的那一族：ASCII 控制符、空白、零宽与双向格式字符。 */
function isStrippedCode(code) {
  const below = CONTRACT.pathRules.compactBeforeTest.stripCodepointBelow
  return code < below || CONTRACT.pathRules.compactBeforeTest.stripCodepoints.includes(code)
}

function hasCodepointInRanges(value, ranges) {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (ranges.some(([lo, hi]) => code >= lo && code <= hi)) return true
  }
  return false
}

/** 清掉空白/控制/零宽字符后的形态：安全判定用它，避免 `java\nscript:` 与拆字绕过。 */
function compact(value) {
  return Array.from(value)
    .filter((char) => !isStrippedCode(char.codePointAt(0) ?? 0))
    .join('')
}

/** 归一分隔符后的紧凑形态（`\\` → `/`），逐字对应原实现里喂给协议与越界规则的那一份。 */
function unify(value) {
  return value.replace(/\\/g, '/')
}

/**
 * 一条附件目标（库根相对路径形态）的拒绝理由；返回 `null` 表示形态合法。
 * 判定顺序与文案都来自契约，本函数不额外加规则。
 */
export function rejectAttachmentPathReason(target) {
  const raw = String(target ?? '')
  const compactValue = unify(compact(raw))
  const segments = compactValue.split(CONTRACT.pathRules.segmentSeparator)
  const views = { raw, compact: compactValue, compactSegments: segments }
  for (const rule of CONTRACT.pathRules.rules) {
    const view = views[rule.on]
    let hit = false
    switch (rule.test) {
      case 'codepointRanges':
        hit = hasCodepointInRanges(view, rule.ranges)
        break
      case 'isEmpty':
        hit = view === ''
        break
      case 'longerThanMax':
        hit = raw.length > CONTRACT.pathRules.maxTargetLength
        break
      case 'regex':
        hit = new RegExp(rule.source, rule.flags ?? '').test(view)
        break
      case 'startsWith':
        hit = view.startsWith(rule.value)
        break
      case 'someSegmentEquals':
        hit = view.some((segment) => segment === rule.value)
        break
      case 'someSegmentRegex': {
        const regexp = new RegExp(rule.source, rule.flags ?? '')
        hit = view.some((segment) => regexp.test(segment))
        break
      }
      default:
        throw new Error(`附件契约规则 ${rule.id} 的 test=${rule.test} 未被副本实现`)
    }
    if (hit) return rule.reason.replaceAll('{maxTargetLength}', String(CONTRACT.pathRules.maxTargetLength))
  }
  return null
}

/**
 * 一条附件目标能不能被当作白名单附件读取（对齐网页端 `resolveImageAttachment()` 的判定形状）。
 *
 * @param {string} target 资料库根相对路径形态的目标
 * @returns {{ kind: 'image', category: string, relPath: string, src: string }
 *          | { kind: 'text', category: null, reason: string }}
 */
export function classifyAttachment(target) {
  const value = String(target ?? '').trim()
  const reason = rejectAttachmentPathReason(value)
  if (reason) return { kind: 'text', category: null, reason }
  const relPath = value.replace(/\\/g, '/')
  const extension = assetExtensionOf(relPath)
  if (!IMAGE_SET.has(extension)) {
    return {
      kind: 'text',
      category: assetCategoryOf(extension),
      reason: ALLOWED_SET.has(extension) ? CONTRACT.reasons.notEmbedded : CONTRACT.reasons.notWhitelisted,
    }
  }
  return { kind: 'image', category: assetCategoryOf(extension), relPath, src: `${ATTACHMENT_ENDPOINT}?path=${encodeURIComponent(relPath)}` }
}

/** 给诊断与网页端核对用的契约快照（只读，不含任何教材内容）。 */
export function attachmentContractSummary() {
  return {
    schemaVersion: CONTRACT.schemaVersion,
    endpoint: ATTACHMENT_ENDPOINT,
    categories: CONTRACT.categories.map((category) => ({ id: category.id, embeddedByClient: category.embeddedByClient === true, extensions: [...category.extensions] })),
    neverOpened: ATTACHMENT_NEVER_OPENED,
    ruleOrder: CONTRACT.pathRules.rules.map((rule) => rule.id),
    maxTargetLength: CONTRACT.pathRules.maxTargetLength,
    reasons: { ...CONTRACT.reasons },
  }
}
