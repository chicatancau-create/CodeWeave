/**
 * 资料库根目录解析与路径安全（02 号方案 §1 活动内容层与 §9 禁止误判；根解析口径见 03 号方案 §3）。
 *
 * 规则：
 * - 根目录只由本机配置决定（调用方显式参数 > `CODEWEAVE_VAULT_ROOT` >
 *   `config/codeweave.local.json` > 工程相对默认 `<工程根>/knowledge/vault`），
 *   绝不接受客户端传入的 root / 磁盘路径 / Shell 命令。
 * - 一律先 realpath 再判定相对关系，`..`、编码绕过、指向根目录外的
 *   symlink/junction 全部拒绝。
 * - 对外只暴露库根相对路径（正斜杠）；根目录变化不改变任何 ID。
 */
import { existsSync, realpathSync, statSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { runtimeConfig } from '../config.mjs'
import { ContentError, normalizeText } from './markdown.mjs'

/** 未显式传参时的资料库根：本机配置解析失败按「未连接」呈现，不把异常抛成 500。 */
function configuredVaultRoot() {
  try {
    return { value: runtimeConfig().vaultRoot }
  } catch (error) {
    return { value: '', detail: error.message }
  }
}

/** 解析并校验资料库根：不存在时返回 { ok:false }，由调用方呈现「资料库未连接」。 */
export function resolveVaultRoot(configured) {
  const fallback = configured === undefined || configured === null ? configuredVaultRoot() : { value: configured }
  const raw = String(fallback.value ?? '').trim()
  if (!raw) {
    return fallback.detail
      ? { ok: false, reason: 'config_invalid', detail: fallback.detail }
      : { ok: false, reason: 'unconfigured' }
  }
  let real
  try {
    real = realpathSync(resolve(raw))
  } catch {
    return { ok: false, reason: 'missing' }
  }
  try {
    if (!statSync(real).isDirectory()) return { ok: false, reason: 'not_a_directory' }
  } catch {
    return { ok: false, reason: 'missing' }
  }
  return { ok: true, root: real }
}

/** 库根相对路径规范化：统一正斜杠、拒绝空段与 `..`。 */
export function normalizeRelPath(input) {
  const text = String(input ?? '').trim().replace(/\\/g, '/')
  if (!text || isAbsolute(text) || /^[A-Za-z]:/.test(text)) {
    throw new ContentError('invalid_relative_path', `只接受库根相对路径：${input}`)
  }
  const parts = text.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.some((part) => part === '..')) {
    throw new ContentError('invalid_relative_path', `路径不得包含 ..：${input}`)
  }
  return parts.join('/')
}

/**
 * 把库根相对路径解析为根目录内的真实绝对路径。
 * realpath 之后仍必须位于根目录内，越界（含 junction/symlink 逃逸）一律拒绝。
 */
export function resolveInsideRoot(root, relPath) {
  const rel = normalizeRelPath(relPath)
  const target = resolve(root, rel)
  const inside = relative(root, target)
  if (inside.startsWith('..') || isAbsolute(inside)) {
    throw new ContentError('path_escape', `路径越出资料库根：${relPath}`)
  }
  if (!existsSync(target)) {
    throw new ContentError('source_not_found', `文件不存在：${relPath}`)
  }
  let real
  try {
    real = realpathSync(target)
  } catch {
    throw new ContentError('source_not_found', `文件不可读：${relPath}`)
  }
  const realInside = relative(root, real)
  if (realInside.startsWith('..') || isAbsolute(realInside)) {
    throw new ContentError('path_escape', `路径经链接越出资料库根：${relPath}`)
  }
  return { rel, abs: real }
}

/**
 * 解析一个**待写入**的库根相对路径：目标文件可以尚不存在（如当天第一次建日志），
 * 但仍要求路径位于根目录内；已存在时再走 realpath，防止经链接逃逸。
 * 只允许库内相对路径，绝不接受客户端传入的绝对路径。
 */
export function resolveWritablePath(root, relPath) {
  const rel = normalizeRelPath(relPath)
  const target = resolve(root, rel)
  const inside = relative(root, target)
  if (inside.startsWith('..') || isAbsolute(inside)) {
    throw new ContentError('path_escape', `路径越出资料库根：${relPath}`)
  }
  if (!existsSync(target)) return { rel, abs: target, existed: false }
  let real
  try {
    real = realpathSync(target)
  } catch {
    throw new ContentError('source_not_found', `文件不可读：${relPath}`)
  }
  const realInside = relative(root, real)
  if (realInside.startsWith('..') || isAbsolute(realInside)) {
    throw new ContentError('path_escape', `路径经链接越出资料库根：${relPath}`)
  }
  return { rel, abs: real, existed: true }
}

/** 读取库内文件为标准化的 UTF-8 文本（去 BOM、统一 LF）。 */
export async function readVaultText(root, relPath) {
  const { abs } = resolveInsideRoot(root, relPath)
  try {
    return normalizeText(await readFile(abs, 'utf8'))
  } catch (error) {
    if (error instanceof ContentError) throw error
    throw new ContentError('source_not_found', `文件不可读：${relPath}（${error?.message ?? error}）`)
  }
}

/**
 * 递归列出目录下的 Markdown 文件（库根相对路径，正斜杠，按字典序）。
 * - 跳过隐藏目录（以 `.` 开头）；
 * - 跳过符号链接，避免跟随到根目录之外；
 * - 目录不存在时返回空数组（资料库可能尚未建立该层）。
 */
export async function listMarkdownFiles(root, relDir, { skipDirs = [] } = {}) {
  const skip = new Set(skipDirs)
  const base = resolve(root, normalizeRelPath(relDir))
  const inside = relative(root, base)
  if (inside.startsWith('..') || isAbsolute(inside)) {
    throw new ContentError('path_escape', `目录越出资料库根：${relDir}`)
  }
  const found = []
  async function walk(absDir, relPrefix) {
    let entries
    try {
      entries = await readdir(absDir, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) continue
      if (entry.name.startsWith('.')) continue
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (skip.has(entry.name) || skip.has(rel)) continue
        await walk(join(absDir, entry.name), rel)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        found.push(rel)
      }
    }
  }
  await walk(base, normalizeRelPath(relDir))
  return found.sort()
}

export function toPosix(absPath, root) {
  return relative(root, absPath).split(sep).join('/')
}