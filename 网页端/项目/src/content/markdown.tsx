/**
 * 资料库正文的受限 Markdown 渲染（LINK-05；DATA-10 扩展表格与双链跳转）。
 *
 * 安全边界（02 号方案 §1 活动内容层）：
 * - 只渲染受支持的块级结构（标题/段落/列表/引用/围栏代码/**管道表格**）；
 * - **不解析原始 HTML**：所有文本（含表格单元格）一律经 React 文本节点输出，
 *   天然转义，全文件没有 `dangerouslySetInnerHTML`、没有 innerHTML 赋值，
 *   因此 `<script>`、未闭合标签、`<img onerror=…>` 只会显示成文字，永不执行；
 * - 不生成任何 `href`：`[[双链]]` 的跳转走内容 Provider 已有的详情能力
 *   （见 wiki-link.tsx），危险协议与越界目标在解析阶段就被拒绝（wikilink.ts）；
 *   `[文字](url)` 这类普通链接语法同样**只按文本显示**（本轮不开外部跳转面），
 *   因此 `javascript:`、`data:text/html`、`vbscript:`、`file:`、`..`、绝对路径都无出口；
 * - 图片按 DATA-10 §4 的白名单访问：`![说明](库根相对路径)` 只有同时满足
 *   「`rejectReasonFor()` 不拒绝 + 位图白名单扩展名」才渲染成
 *   `<img src="/api/content/asset?path=…">`（同源、无 `href`、无外部域），
 *   其余（svg/html/js/css、绝对路径、`javascript:`、`..`）**继续按纯文本显示**；
 *   加载失败/403/404 显示「附件不可用（未发布或类型不允许）」，不静默消失；
 *   pdf/txt/csv/json 由服务端白名单受控读取，但正文里不生成任何可点出口。
 *   笔记里的命令只显示，不能执行。
 *
 * 这是「通用渲染实现」，不是第二份教材：输入永远来自内容快照里的资料库正文。
 */
import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { MarkdownBodyContext, MAX_MARKDOWN_DEPTH, type MarkdownRenderer } from './markdown-body'
import { WikiLink } from './wiki-link'
import { resolveImageAttachment } from './wikilink'

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'code'; language: string; code: string }
  | { kind: 'table'; header: string[]; rows: string[][] }

/** 宿主可接管双链跳转（例如在工作台里打开该课）；不接管时就地展开已发布原文。 */
export type MarkdownNavigateHandler = (target: { contentId: string; title: string }) => void

type LinkOptions = { depth: number; onNavigate?: MarkdownNavigateHandler }

const HEADING = /^(#{1,6})\s+(.+?)\s*$/
const UNORDERED = /^\s*[-*]\s+(.+)$/
const ORDERED = /^\s*\d+[.)]\s+(.+)$/
const FENCE = /^\s*```+\s*([\w+#.-]*)\s*$/
const QUOTE = /^\s*>\s?(.*)$/
/** 表格分隔行单元：`---`、`:---`、`---:`、`:---:`（对齐信息按 DATA-10 忽略） */
const DELIMITER_CELL = /^:?-{1,}:?$/
/** 图片语法 `![说明](目标 "可选标题")`；判定不过就整段按纯文本显示。 */
const IMAGE_TOKEN = /^!\[([^\]]*)\]\(([^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\)$/
/** 本轮不允许改 styles.css：附件只用最小内联样式保证可读与不溢出。 */
const IMAGE_STYLE = {
  maxWidth: '100%',
  width: '100%',
  aspectRatio: '16 / 9',
  objectFit: 'contain' as const,
  height: 'auto',
  display: 'block',
  margin: '8px 0',
}
const IMAGE_NOTE_STYLE = { color: 'var(--muted)', fontSize: '0.9em' }

/**
 * 按**未转义**的 `|` 切分表格行。
 * - 反引号内的 `|` 不算分隔符（单元格里的 `` `a|b` `` 保持完整）；
 * - `\|` 是 Obsidian 双链别名的转义写法，原样保留交给行内解析处理；
 * - 只剥掉**首尾各一个**竖线，因此中间的空单元格不会被吞掉。
 * 返回 null 表示这一行不是表格行。
 */
function splitRow(line: string): string[] | null {
  let text = line.trim()
  if (!text || !text.includes('|')) return null
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1)
  const cells: string[] = []
  let current = ''
  let inCode = false
  let escaped = false
  for (const char of text) {
    if (escaped) {
      escaped = false
      current += char === '|' ? '\\|' : char
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '`') {
      inCode = !inCode
      current += char
      continue
    }
    if (char === '|' && !inCode) {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  cells.push(current.trim())
  return cells.length > 0 ? cells : null
}

/** 表格候选：表头行 + 合法分隔行，且两者列数一致。 */
function tableShape(lines: string[], start: number): { header: string[] } | null {
  const header = splitRow(lines[start] ?? '')
  if (!header) return null
  const delimiter = splitRow(lines[start + 1] ?? '')
  if (!delimiter || delimiter.length !== header.length) return null
  if (!delimiter.every((cell) => DELIMITER_CELL.test(cell))) return null
  return { header }
}

/**
 * 尝试从 `start` 解析一个表格。
 * - `null`：这里没有表格（缺分隔行、分隔行列数不符等），交给段落分支原样显示；
 * - `degraded`：表体某行列数不齐，整块降级为普通段落（不崩、不猜）；
 * - 正常：返回表格块与下一行位置。
 */
function tryTable(lines: string[], start: number): { next: number; block?: Block; degraded?: string[] } | null {
  const shape = tableShape(lines, start)
  if (!shape) return null
  const consumed = [lines[start] ?? '', lines[start + 1] ?? '']
  const rows: string[][] = []
  let index = start + 2
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim() === '') break
    const cells = splitRow(line)
    if (!cells) break
    consumed.push(line)
    index += 1
    if (cells.length !== shape.header.length) {
      // 列数不齐：把已读入的原始行整体降级为段落，保证内容不丢
      return { next: index, degraded: consumed }
    }
    rows.push(cells)
  }
  return { next: index, block: { kind: 'table', header: shape.header, rows } }
}

export function parseMarkdownBlocks(markdown: string): Block[] {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let index = 0
  /** 越界返回 undefined；调用方必须先判空再使用（noUncheckedIndexedAccess）。 */
  const at = (position: number): string | undefined => lines[position]
  const pushParagraphs = (raw: string[]) => {
    for (const line of raw) blocks.push({ kind: 'paragraph', text: line.trim() })
  }
  while (index < lines.length) {
    const line = at(index)
    if (line === undefined) break
    if (line.trim() === '') {
      index += 1
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      const language = fence[1] ?? ''
      const code: string[] = []
      index += 1
      while (index < lines.length && !FENCE.test(at(index) ?? '')) {
        code.push(at(index) ?? '')
        index += 1
      }
      index += 1
      blocks.push({ kind: 'code', language, code: code.join('\n') })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: (heading[1] ?? '#').length, text: heading[2] ?? '' })
      index += 1
      continue
    }
    const quote = QUOTE.exec(line)
    if (quote) {
      const collected: string[] = []
      while (index < lines.length) {
        const current = QUOTE.exec(at(index) ?? '')
        if (!current) break
        collected.push(current[1] ?? '')
        index += 1
      }
      blocks.push({ kind: 'quote', lines: collected })
      continue
    }
    if (UNORDERED.test(line) || ORDERED.test(line)) {
      const ordered = ORDERED.test(line) && !UNORDERED.test(line)
      const items: string[] = []
      while (index < lines.length) {
        const raw = at(index) ?? ''
        const match = ordered ? ORDERED.exec(raw) : UNORDERED.exec(raw)
        if (!match) break
        items.push(match[1] ?? '')
        index += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }
    const table = tryTable(lines, index)
    if (table) {
      if (table.degraded) pushParagraphs(table.degraded)
      else if (table.block) blocks.push(table.block)
      index = table.next
      continue
    }
    const paragraph: string[] = []
    while (index < lines.length) {
      const current = at(index)
      if (current === undefined) break
      if (
        current.trim() === '' ||
        HEADING.test(current) ||
        FENCE.test(current) ||
        QUOTE.test(current) ||
        UNORDERED.test(current) ||
        ORDERED.test(current) ||
        tableShape(lines, index) !== null
      ) {
        break
      }
      paragraph.push(current)
      index += 1
    }
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
    else if (at(index) !== undefined) {
      // 兜底：没被任何分支吃掉时按段落推进一行，绝不死循环
      blocks.push({ kind: 'paragraph', text: (at(index) ?? '').trim() })
      index += 1
    }
  }
  return blocks
}

/**
 * 一张按白名单访问的图片附件。
 * 读取失败（未登录、403 类型不允许、404 未发布/不存在、网络中断）都显示**可见**的
 * 兜底文案，不静默消失；文案不猜原因，只说明「未发布或类型不允许」这两种真实可能。
 */
function MarkdownImage({ src, alt, relPath }: { src: string; alt: string; relPath: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <span className="md-attachment md-attachment--error" role="note" style={IMAGE_NOTE_STYLE}>
        {alt ? `${alt}：` : ''}附件不可用（未发布或类型不允许）
      </span>
    )
  }
  return (
    <span className="md-attachment">
      <img src={src} alt={alt} title={relPath} style={IMAGE_STYLE} loading="lazy" onError={() => setFailed(true)} />
    </span>
  )
}

/**
 * 把一个 `![说明](目标)` 令牌渲染成图片，或按今天的方式退回纯文本。
 * 判定完全交给 `wikilink.ts`（`rejectReasonFor` + 位图白名单），这里不重复路径规则。
 */
function renderImageToken(token: string, key: string): ReactNode {
  const parsed = IMAGE_TOKEN.exec(token)
  if (!parsed) return token
  const decision = resolveImageAttachment(parsed[2] ?? '')
  if (decision.kind !== 'image') return token
  return <MarkdownImage key={key} src={decision.src} alt={parsed[1] ?? ''} relPath={decision.relPath} />
}

/** 行内格式：`code`、**bold**、![说明](白名单图片)、[[双链]]。其余（含 HTML 片段与链接语法）按纯文本输出。 */
function renderInline(text: string, keyPrefix: string, links: LinkOptions): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(!\[[^\]]*\]\([^)\n]*\))|(\[\[[^\]]+\]\])/g
  let last = 0
  let match: RegExpExecArray | null
  let counter = 0
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    const token = match[0]
    counter += 1
    const key = `${keyPrefix}-i${counter}`
    if (token.startsWith('`')) nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
    else if (token.startsWith('**')) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    // 图片：库根相对路径 + 位图白名单才给同源 src；其余保持纯文本（见 README-attachments.md §4）
    else if (token.startsWith('!')) nodes.push(renderImageToken(token, key))
    // 双链：已发布才可跳转；未发布/危险目标只作为文本 + 明确提示（见 wiki-link.tsx）
    else nodes.push(<WikiLink key={key} raw={token.slice(2, -2)} depth={links.depth} onNavigate={links.onNavigate} />)
    last = match.index + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function renderBlocks(markdown: string, links: LinkOptions): ReactNode[] {
  return parseMarkdownBlocks(markdown).map((block, index) => {
    const key = `b${index}`
    if (block.kind === 'heading') {
      const level = Math.min(Math.max(block.level, 3), 6)
      const Tag = `h${level}` as 'h3' | 'h4' | 'h5' | 'h6'
      return <Tag key={key}>{renderInline(block.text, key, links)}</Tag>
    }
    if (block.kind === 'code') {
      return (
        <pre key={key} className="md-code">
          <code>{block.code}</code>
        </pre>
      )
    }
    if (block.kind === 'list') {
      const items = block.items.map((item, itemIndex) => (
        <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`, links)}</li>
      ))
      return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>
    }
    if (block.kind === 'quote') {
      return (
        <blockquote key={key}>
          {block.lines.map((line, lineIndex) => (
            <p key={`${key}-${lineIndex}`}>{renderInline(line, `${key}-${lineIndex}`, links)}</p>
          ))}
        </blockquote>
      )
    }
    if (block.kind === 'table') {
      // role="table" + th[scope] 给出表格语义；单元格内容一律走行内解析（文本节点）
      return (
        <div key={key} className="md-table-wrap" style={{ overflowX: 'auto' }}>
          <table role="table" className="md-table data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {block.header.map((cell, cellIndex) => (
                  <th key={`${key}-h${cellIndex}`} scope="col">
                    {renderInline(cell, `${key}-h${cellIndex}`, links)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={`${key}-r${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${key}-r${cellIndex}-${rowIndex}`}>{renderInline(cell, `${key}-r${cellIndex}-${rowIndex}`, links)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    return <p key={key}>{renderInline(block.text, key, links)}</p>
  })
}

/** 一棵可被双链面板复用的正文渲染树：`depth` 逐级 +1，用于限制嵌套展开。 */
function MarkdownTree({ markdown, depth, onNavigate }: { markdown: string; depth: number; onNavigate?: MarkdownNavigateHandler }) {
  const renderBody = useCallback<MarkdownRenderer>(
    (inner) =>
      depth >= MAX_MARKDOWN_DEPTH ? (
        <p className="md-wikilink-preview-note">已达最大嵌套层级（{MAX_MARKDOWN_DEPTH} 层），请关闭上层面板后从课程列表进入。</p>
      ) : (
        <MarkdownTree markdown={inner} depth={depth + 1} onNavigate={onNavigate} />
      ),
    [depth, onNavigate],
  )
  return <MarkdownBodyContext.Provider value={renderBody}>{renderBlocks(markdown, { depth, onNavigate })}</MarkdownBodyContext.Provider>
}

export function MarkdownView({
  markdown,
  className,
  onNavigate,
}: {
  markdown: string
  className?: string
  /** 宿主页面的双链跳转出口；缺省时双链在正文内就地展开已发布原文 */
  onNavigate?: MarkdownNavigateHandler
}) {
  // 双链面板里的正文沿用同一套受限管线（不解析 HTML、不生成 href）
  return (
    <div className={className ?? 'md-view'}>
      <MarkdownTree markdown={markdown} depth={0} onNavigate={onNavigate} />
    </div>
  )
}
