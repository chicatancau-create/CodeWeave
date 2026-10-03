/**
 * 来源登记一致性（DATA-04）。
 *
 * 权威关系：`知识来源/` 下的来源卡是材料身份的权威登记，`content-manifest.json` 的
 * `sourceRegistry` 是机器可读的索引投影。两边都要能解析到，才允许发布。
 *
 * 刻意不做的事：
 * - 不把「未复核 / 未核验」自动升级为已核验（DATA-04 验收标准）；
 * - 不强制为「无外部原件」的补充分册虚构来源卡——那会制造“有来源”的假象，
 *   这类 id 必须在登记项里显式写明豁免与指向的说明页，指向的页必须真实存在。
 */
import { normalizeText } from './markdown.mjs'
import { listMarkdownFiles, readVaultText } from './vault-paths.mjs'

export const VERIFICATION_STATUS = ['库内已存在', '外部未复核', '未核验', '无法确认']

const SOURCE_ID_ROW = /^\|\s*source_id\s*\|\s*`?([A-Z][A-Z0-9_-]+)`?\s*\|/m
const VERIFICATION_ROW = /^\|\s*核验状态\s*\|\s*(.+?)\s*\|/m
const CARD_FILE = /^SRC-[A-Z0-9_-]+/

function verificationToken(cell) {
  const text = String(cell ?? '')
  // 取卡片里最先出现的状态词；卡片常在括号里追加边界说明，那部分不改语义。
  const hits = VERIFICATION_STATUS.map((token) => ({ token, at: text.indexOf(token) })).filter((hit) => hit.at >= 0)
  if (hits.length === 0) return null
  return hits.sort((a, b) => a.at - b.at)[0].token
}

/**
 * 从来源卡提取 source_id 与核验状态。
 * @returns {{ sourceId: string, verificationStatus: string|null }|null} 非来源卡返回 null
 */
export function parseSourceCard(text, path) {
  const filename = path.split('/').pop() ?? path
  const row = SOURCE_ID_ROW.exec(text)
  const declared = row?.[1] ?? null
  if (!declared) {
    // 文件名按约定以 SRC- 开头却读不出 source_id，属于卡片自身损坏，不能静默跳过。
    if (!CARD_FILE.test(filename)) return null
    throw new Error(`来源卡缺少 source_id 行：${path}`)
  }
  if (CARD_FILE.test(filename) && !filename.startsWith(`${declared}-`) && filename !== `${declared}.md`) {
    throw new Error(`来源卡文件名与登记的 source_id 不一致：${path} 声明 ${declared}`)
  }
  return { sourceId: declared, verificationStatus: verificationToken(VERIFICATION_ROW.exec(text)?.[1]) }
}

/** 扫描 `知识来源/`，返回 sourceId → 卡片信息，以及库根相对的页清单（供豁免指向校验）。 */
export async function loadSourceCards(root, sourceRoot, { skipDirs = [] } = {}) {
  const files = await listMarkdownFiles(root, sourceRoot, { skipDirs })
  const cards = new Map()
  const problems = []
  for (const path of files) {
    let text
    try {
      text = normalizeText(await readVaultText(root, path))
    } catch (error) {
      problems.push({ code: 'source_card_unreadable', path, message: `来源卡不可读取：${error.message}` })
      continue
    }
    let card
    try {
      card = parseSourceCard(text, path)
    } catch (error) {
      problems.push({ code: 'source_card_invalid', path, message: error.message })
      continue
    }
    if (!card) continue
    if (cards.has(card.sourceId)) {
      problems.push({
        code: 'source_card_duplicate',
        path,
        message: `source_id 重复登记：${card.sourceId} 已由 ${cards.get(card.sourceId).path} 登记`,
      })
      continue
    }
    cards.set(card.sourceId, { path, sourceId: card.sourceId, verificationStatus: card.verificationStatus })
  }
  return { cards, pages: new Set(files), problems }
}

/**
 * 校验发布引用的来源。
 * @param referenced sourceId → 引用它的主题数
 */
export function checkSourceConsistency({ registry, cards, referenced, sourceRoot, knownPages }) {
  const blocking = []
  const warnings = []
  const reg = registry ?? {}

  for (const [sourceId, count] of [...referenced.entries()].sort()) {
    const entry = reg[sourceId]
    if (!entry) {
      blocking.push({
        code: 'source_unregistered',
        path: `${sourceRoot}/`,
        message: `发布内容引用了未登记的来源 ${sourceId}（被 ${count} 个主题引用）。来源卡是权威，请先在 content-manifest.json 的 sourceRegistry 登记，人工核对核验状态，不得自动改为已核验。`,
      })
      continue
    }
    const card = cards.get(sourceId)
    if (!card) {
      const exemption = typeof entry.cardExemption === 'string' ? entry.cardExemption.trim() : ''
      if (!exemption) {
        blocking.push({
          code: 'source_card_missing',
          path: `${sourceRoot}/`,
          message: `来源 ${sourceId} 被 ${count} 个主题引用，但没有来源卡，也没有声明 cardExemption。要么补卡，要么在登记项写明豁免与指向的说明页。`,
        })
        continue
      }
      const target = exemption.match(/([^\s，；;]+\.md)/)?.[1] ?? null
      if (!target || !knownPages.has(target)) {
        blocking.push({
          code: 'source_card_missing',
          path: `${sourceRoot}/`,
          message: `来源 ${sourceId} 的 cardExemption 指向的说明页不存在或无法解析：${exemption}`,
        })
        continue
      }
      warnings.push({
        code: 'source_card_exempted',
        path: target,
        message: `来源 ${sourceId} 按说明页登记，无逐项来源卡：${exemption}`,
      })
      continue
    }
    if (card.verificationStatus && entry.verificationStatus && card.verificationStatus !== entry.verificationStatus) {
      blocking.push({
        code: 'source_status_conflict',
        path: card.path,
        message: `来源 ${sourceId} 的核验状态冲突：来源卡 ${card.verificationStatus} ≠ 登记项 ${entry.verificationStatus}`,
      })
    }
    if (!card.verificationStatus && entry.verificationStatus) {
      warnings.push({ code: 'source_status_unreadable', path: card.path, message: `来源卡 ${sourceId} 的核验状态行无法识别，沿用登记项 ${entry.verificationStatus}` })
    }
  }

  for (const sourceId of Object.keys(reg)) {
    if (!referenced.has(sourceId) && !cards.has(sourceId)) {
      warnings.push({ code: 'source_orphan_registry', path: `${sourceRoot}/`, message: `登记项 ${sourceId} 既无来源卡也不被发布内容引用` })
    }
  }
  for (const [sourceId, card] of cards) {
    if (!reg[sourceId]) {
      blocking.push({
        code: 'source_card_unregistered',
        path: card.path,
        message: `来源卡 ${sourceId} 未在 content-manifest.json 的 sourceRegistry 登记`,
      })
    }
  }
  return { blocking, warnings }
}
