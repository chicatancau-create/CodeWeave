// @vitest-environment jsdom
/**
 * 受限 Markdown 渲染的块级契约（DATA-10 §4）。
 *
 * 覆盖两类要求：
 * 1. **表格可读**：GFM 管道表格渲染成带 `role="table"` 的真实 table，
 *    单元格内继续走行内格式（`code` / **粗体** / [[双链]]），
 *    缺分隔行或列数不齐时整块降级成普通段落，绝不崩；
 * 2. **原始 HTML 始终不执行**：脚本、事件属性、危险协议链接、未闭合标签
 *    只能作为文本出现，DOM 里不得出现 script/img/a 等元素或 on* 属性。
 *
 * 断言风格与项目现有 jsdom 测试一致：直接读 DOM 结构与文本，不依赖 jest-dom。
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MarkdownView, parseMarkdownBlocks } from './markdown'

afterEach(() => {
  cleanup()
})

/** 教材《八套课程复习总纲》里的真实表格形状（含对齐冒号、行内代码、粗体）。 */
const VOCAB_TABLE = [
  '### 分层结构',
  '',
  '| 层 | 位置 | 当前状态 | 完成信号 |',
  '|:---|:---:|---|---:|',
  '| 入口与规则 | `00-入口/` | 协议齐备 | 能定位下一课 |',
  '| 知识层 | **27 个正文分册** | 见 [[Java 核心基础]] | 不产生重复正文 |',
].join('\n')

describe('GFM 管道表格', () => {
  it('渲染为带 role="table" 的真实表格，表头是 th[scope=col]', () => {
    const { container } = render(<MarkdownView markdown={VOCAB_TABLE} />)
    const table = container.querySelector('table')
    expect(table).not.toBeNull()
    expect(table?.getAttribute('role')).toBe('table')
    const heads = [...table?.querySelectorAll('thead th') ?? []]
    expect(heads.map((th) => th.textContent)).toEqual(['层', '位置', '当前状态', '完成信号'])
    expect(heads.every((th) => th.getAttribute('scope') === 'col')).toBe(true)
    const rows = [...table?.querySelectorAll('tbody tr') ?? []]
    expect(rows).toHaveLength(2)
    expect(rows[0]?.querySelectorAll('td')).toHaveLength(4)
    expect(table?.textContent).toContain('入口与规则')
  })

  it('单元格内继续走行内格式，双链在表格里同样可判定', () => {
    const { container } = render(<MarkdownView markdown={VOCAB_TABLE} />)
    expect(container.querySelector('table code')?.textContent).toBe('00-入口/')
    expect(container.querySelector('table strong')?.textContent).toBe('27 个正文分册')
    expect(container.querySelector('table .md-wikilink')?.textContent).toContain('Java 核心基础')
  })

  it('单元格里的转义竖线 `\\|` 不被当作列分隔符', () => {
    const md = ['| 引用 | 显示 |', '|---|---|', '| [[a/b\\|别名]] | 别名 |'].join('\n')
    const blocks = parseMarkdownBlocks(md)
    const table = blocks.find((block) => block.kind === 'table')
    expect(table?.kind === 'table' && table.header).toEqual(['引用', '显示'])
    expect(table?.kind === 'table' && table.rows).toEqual([['[[a/b\\|别名]]', '别名']])
    const { container } = render(<MarkdownView markdown={md} />)
    expect(container.querySelectorAll('tbody td')).toHaveLength(2)
    expect(container.querySelector('.md-wikilink')?.textContent).toContain('别名')
  })

  it('缺少分隔行时按普通段落显示，不生成表格', () => {
    const md = '| 层 | 位置 |\n| 入口 | `00-入口/` |'
    const { container } = render(<MarkdownView markdown={md} />)
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('p')?.textContent).toContain('层')
    expect(container.textContent).toContain('| 入口 |')
    expect(container.textContent).toContain('00-入口/')
  })

  it('列数不齐时整块降级为段落，内容一行都不丢', () => {
    const md = [
      '| 分册 | 来源 | 性质 |',
      '|---|---|---|',
      '| C 语言基础 | C 一套通关 | 精读 |',
      '| Java 核心基础 | Java 入门 |',
      '| Vue 3 |',
    ].join('\n')
    const { container } = render(<MarkdownView markdown={md} />)
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('tbody')).toBeNull()
    expect(container.textContent).toContain('C 语言基础')
    expect(container.textContent).toContain('Vue 3')
    expect(container.querySelectorAll('p')).toHaveLength(5)
  })

  it('表格前后的段落与列表不被吞掉，表格结束于空行', () => {
    const md = ['前言段落。', '', '| A | B |', '|---|---|', '| 1 | 2 |', '', '- 列表项'].join('\n')
    const blocks = parseMarkdownBlocks(md)
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'table', 'list'])
    const { container } = render(<MarkdownView markdown={md} />)
    expect(container.querySelectorAll('table')).toHaveLength(1)
    expect(container.querySelector('li')?.textContent).toBe('列表项')
  })

  it('表格单元格里出现 <script> 也只当文本（无 script 节点、无 on* 属性）', () => {
    const md = ['| 反例 | 结果 |', '|---|---|', '| <script>alert(1)</script> | <img src=x onerror=alert(1)> |'].join('\n')
    const { container } = render(<MarkdownView markdown={md} />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('td')?.textContent).toContain('<script>alert(1)</script>')
    expect([...container.querySelectorAll('*')].some((el) => [...el.attributes].some((attr) => attr.name.startsWith('on')))).toBe(false)
  })
})

describe('原始 HTML 与危险链接：只显示文本，永不执行', () => {
  /** 渲染后允许出现的标签白名单：出现别的标签说明有内容被当 HTML 解析了。 */
  const ALLOWED_TAGS = new Set(['DIV', 'P', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'STRONG', 'SPAN', 'BUTTON', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD'])

  const samples: [string, string][] = [
    ['脚本标签', '<script>alert(1)</script>'],
    ['图片事件', '<img src=x onerror=alert(1)>'],
    ['未闭合标签', '<div class="x"><span>未闭合'],
    ['js 协议链接', '[点我](javascript:alert(1))'],
    ['vbscript 协议链接', '[x](vbscript:msgbox(1))'],
    ['data 协议链接', '[y](data:text/html,<script>alert(1)</script>)'],
    ['越界路径链接', '[z](../../../etc/passwd)'],
    ['iframe 注入', '<iframe src="https://evil.example"></iframe>'],
    ['svg onload', '<svg onload=alert(1)>'],
  ]

  for (const [label, source] of samples) {
    it(`${label}：按文本渲染，DOM 内无脚本/外链元素与事件属性`, () => {
      const { container } = render(<MarkdownView markdown={source} />)
      for (const el of container.querySelectorAll('*')) expect(ALLOWED_TAGS.has(el.tagName), `${label}:${el.tagName}`).toBe(true)
      expect(container.querySelector('script')).toBeNull()
      expect(container.querySelector('img')).toBeNull()
      expect(container.querySelector('iframe')).toBeNull()
      expect(container.querySelector('svg')).toBeNull()
      expect(container.querySelector('a')).toBeNull()
      expect(container.querySelector('[href]')).toBeNull()
      expect(container.innerHTML.toLowerCase()).not.toContain('<script')
      expect([...container.querySelectorAll('*')].some((el) => [...el.attributes].some((attr) => /^on/i.test(attr.name)))).toBe(false)
      expect(container.textContent).toContain(source.split('\n')[0] ?? '')
    })
  }

  it('围栏代码块里的 HTML 与命令同样只显示，不解析成结构', () => {
    const md = ['```html', '<script>alert(1)</script>', '| A | B |', '```'].join('\n')
    const { container } = render(<MarkdownView markdown={md} />)
    expect(container.querySelector('pre code')?.textContent).toContain('<script>alert(1)</script>')
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })

  it('双链里的危险协议与越界路径被拒绝：只渲染文本，不给跳转按钮', () => {
    const md = ['[[javascript:alert(1)]]', '', '[[../../outside/未发布|越界引用]]', '', '[[C:\\Windows\\win.ini]]'].join('\n')
    const { container } = render(<MarkdownView markdown={md} />)
    expect(container.querySelectorAll('button.md-wikilink--target')).toHaveLength(0)
    expect(container.querySelectorAll('.md-wikilink--rejected')).toHaveLength(3)
    expect(container.textContent).toContain('已拒绝')
    expect(container.querySelector('[href]')).toBeNull()
  })

  it('未连接内容快照时双链不猜发布状态：明确提示未连接', () => {
    const { container } = render(<MarkdownView markdown={'见 [[Java 核心基础]]'} />)
    const unresolved = container.querySelector('.md-wikilink--unresolved')
    expect(unresolved?.textContent).toContain('未连接内容快照')
    expect(container.querySelector('button')).toBeNull()
  })
})
