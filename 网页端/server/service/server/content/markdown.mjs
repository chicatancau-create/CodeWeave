/**
 * 资料库只读解析层（LINK-04）。
 *
 * 设计边界（02 号方案 §1 活动内容层）：
 * - 只解析**受限 frontmatter 子集**：顶层 `key: value` 标量 + 行内 `[a, b]` 列表。
 *   不支持嵌套映射、块标量（`|`/`>`）、锚点/别名（`&`/`*`）、标签（`!`）、块列表（`- `）。
 *   遇到子集外的写法直接报 `frontmatter_unsupported` 错误，**不猜测、不静默降级**。
 *   这样既不需要引入 YAML 依赖，也不会出现“几条正则假装完整解析器”的静默错误。
 * - 正文按 `visible_lines` 剔除 frontmatter 与围栏代码块，代码块里的 `#` 不会被当成标题。
 * - 与资料库既有 Python 工具（tools/check_vault.py、tools/build_topic_index.py）保持同一语义，
 *   但本模块是应用侧的唯一实现；Python 工具只负责资料库自身门禁。
 */
import { createHash } from 'node:crypto'

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]*(.*))?$/
const FENCE = /^\s*(`{3,}|~{3,})/
const HEADING = /^(#{1,6})\s+(.+?)\s*$/
const CLOSING_HASHES = /\s+#+\s*$/
const BRACKETED = /^\[(.*)\]$/

export const SUPPORTED_SCHEMA_VERSION = 1

/** 去掉 BOM；换行统一为 LF。换行规范化策略固定，重复同步同一内容不产生新版本。 */
export function normalizeText(raw) {
  return String(raw).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export class ContentError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ContentError'
    this.code = code
  }
}

/** 拆分受限标量：去引号、去未加引号的尾注释。 */
function scalar(raw) {
  const value = String(raw ?? '').trim()
  if (value.length >= 2 && value[0] === value.at(-1) && (value[0] === '"' || value[0] === "'")) {
    return value.slice(1, -1)
  }
  const hash = value.indexOf(' #')
  return (hash === -1 ? value : value.slice(0, hash)).trim()
}

/**
 * 按顶层逗号切分行内列表；引号内与嵌套方括号内的逗号不作为分隔符。
 * 这样 `["scores = [82, 45, 91] => 三行输出"]` 是一个元素而不是三个。
 */
function splitListItems(text) {
  const items = []
  let current = ''
  let quote = null
  let depth = 0
  for (const char of text) {
    if (quote) {
      current += char
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === '[') depth += 1
    if (char === ']') depth -= 1
    if (char === ',' && depth === 0) {
      items.push(current)
      current = ''
      continue
    }
    current += char
  }
  items.push(current)
  return items
}

function parseItem(raw) {
  const item = raw.trim()
  if (!item) return undefined
  if (item[0] === '"' || item[0] === "'") {
    if (item.length < 2 || item.at(-1) !== item[0]) {
      throw new ContentError('frontmatter_unsupported', `列表项引号未闭合：${raw}`)
    }
    return item.slice(1, -1)
  }
  return scalar(item)
}

/**
 * 解析受限 frontmatter。
 * @returns {{ fields: Record<string, string|string[]>, lineCount: number, present: boolean, bodyStartLine: number }}
 */
export function parseRestrictedFrontmatter(text, where = '') {
  const label = where ? `${where}: ` : ''
  const lines = text.split('\n')
  if (lines[0]?.trim() !== '---') {
    return { fields: {}, lineCount: 0, present: false, bodyStartLine: 1 }
  }
  const fields = {}
  // 先确认 frontmatter 有结束标记：否则后面每一行都会报“不符合子集”，
  // 掩盖真正的错误原因（缺一个 ---）。
  const closeLine = lines.findIndex((line, position) => position > 0 && line.trim() === '---')
  if (closeLine === -1) {
    throw new ContentError('frontmatter_unterminated', `${label}frontmatter 缺少结束的 ---`)
  }
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '---') {
      return { fields, lineCount: index + 1, present: true, bodyStartLine: index + 2 }
    }
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    if (/^[ \t]/.test(line)) {
      throw new ContentError(
        'frontmatter_unsupported',
        `${label}frontmatter 第 ${index + 1} 行使用了缩进（嵌套/块列表），本契约只支持顶层键与行内列表`,
      )
    }
    if (/^-\s/.test(line)) {
      throw new ContentError(
        'frontmatter_unsupported',
        `${label}frontmatter 第 ${index + 1} 行是块列表，请改写为行内形式 [a, b]`,
      )
    }
    const match = KEY_LINE.exec(line)
    if (!match) {
      throw new ContentError(
        'frontmatter_unsupported',
        `${label}frontmatter 第 ${index + 1} 行不符合受限子集（键必须以字母/下划线开头且顶格）`,
      )
    }
    const key = match[1]
    if (Object.hasOwn(fields, key)) {
      throw new ContentError('frontmatter_duplicate_key', `${label}frontmatter 重复键：${key}`)
    }
    const raw = match[2] ?? ''
    if (/^[&*!|>]/.test(raw.trim())) {
      throw new ContentError('frontmatter_unsupported', `${label}frontmatter 键 ${key} 使用了锚点/别名/标签/块标量`)
    }
    const bracketed = BRACKETED.exec(raw.trim())
    if (bracketed) {
      const items = bracketed[1].trim() ? splitListItems(bracketed[1]).map(parseItem) : []
      fields[key] = items.filter((item) => item !== undefined)
    } else {
      fields[key] = scalar(raw)
    }
  }
  throw new ContentError('frontmatter_unterminated', `${label}frontmatter 缺少结束的 ---`)
}

/**
 * 剔除 frontmatter 与围栏代码块后的正文行（保留原始行号）。
 * 与 tools/check_vault.py 的 visible_lines 语义一致。
 */
export function visibleLines(text) {
  const lines = text.split('\n')
  const frontmatter = lines[0]?.trim() === '---'
  const out = []
  let fence = null
  let inFrontmatter = frontmatter
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const number = index + 1
    if (inFrontmatter) {
      if (number > 1 && line.trim() === '---') inFrontmatter = false
      continue
    }
    const marker = FENCE.exec(line)
    if (marker) {
      const token = marker[1]
      if (fence === null) fence = token
      else if (token[0] === fence[0] && token.length >= fence.length) fence = null
      continue
    }
    if (fence === null) out.push([number, line])
  }
  return out
}

/** 正文标题（含层级与行号），已剔除代码块与 frontmatter。 */
export function headings(text) {
  return visibleLines(text)
    .map(([line, raw]) => {
      const match = HEADING.exec(raw)
      if (!match) return null
      return { level: match[1].length, title: match[2].replace(CLOSING_HASHES, '').trim(), line }
    })
    .filter(Boolean)
}

/**
 * 按 `topic_levels` 切分主题：每个指定层级的标题起一段，
 * 到下一个「同级或更高级」标题前结束，子标题保留在段内。
 */
export function topicsFromVolume(text, levels) {
  const lines = text.split('\n')
  const marks = headings(text)
  const topics = []
  for (let index = 0; index < marks.length; index += 1) {
    const mark = marks[index]
    if (!levels.includes(mark.level)) continue
    let end = lines.length
    for (let next = index + 1; next < marks.length; next += 1) {
      if (marks[next].level <= mark.level) {
        end = marks[next].line - 1
        break
      }
    }
    const body = lines.slice(mark.line, end)
    topics.push({
      level: mark.level,
      title: mark.title,
      line: mark.line,
      headingPath: ancestorPath(marks, index),
      body,
      bodyText: body.join('\n').trim(),
      isEmpty: body.every((line) => line.trim() === ''),
    })
  }
  return topics
}

/** 祖先标题链（不含自身）：用于「同名标题必须用父链定位」。 */
function ancestorPath(marks, index) {
  const chain = []
  let level = marks[index].level
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (marks[cursor].level < level) {
      chain.unshift(marks[cursor].title)
      level = marks[cursor].level
    }
  }
  return chain
}

/**
 * 按完整标题路径定位一个章节，返回 `{ title, level, line, headingPath, body, bodyText }`；
 * 找不到返回 null。正文含该标题之下的全部子章节，直到下一个同级或更高级标题。
 * headingPath 必须是一条真实的祖先链，不接受把同级标题拼接起来。
 */
export function findSection(text, headingPath) {
  const wanted = (headingPath ?? []).map((title) => String(title).trim())
  if (wanted.length === 0) return null
  const normalized = normalizeText(text)
  return (
    topicsFromVolume(normalized, [1, 2, 3, 4, 5, 6]).find(
      (topic) =>
        topic.headingPath.length === wanted.length - 1 &&
        [...topic.headingPath, topic.title].every((title, index) => title === wanted[index]),
    ) ?? null
  )
}

/** 解析 sectionRef 字符串：`<库根相对路径>#<标题1> > <标题2>`。 */
export function parseSectionRef(raw, where = '') {
  const label = where ? `${where}: ` : ''
  const text = String(raw ?? '').trim()
  const hash = text.indexOf('#')
  if (hash === -1) {
    throw new ContentError('source_ref_invalid', `${label}引用需形如 path/文件.md#标题1 > 标题2，实际：${text}`)
  }
  const path = text.slice(0, hash).trim()
  const headingPath = text.slice(hash + 1).split('>').map((part) => part.trim()).filter(Boolean)
  if (!path.endsWith('.md')) {
    throw new ContentError('source_ref_invalid', `${label}引用路径必须以 .md 结尾：${path}`)
  }
  if (headingPath.length === 0) {
    throw new ContentError('source_ref_invalid', `${label}引用缺少标题定位：${text}`)
  }
  return { path, headingPath }
}

/** 确定性 JSON：键排序，用于内容摘要与 bundleId。 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}