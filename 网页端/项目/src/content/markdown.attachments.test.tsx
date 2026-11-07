// @vitest-environment jsdom
/**
 * 附件与图片按白名单访问的前端接入（DATA-10 §4）。
 *
 * 契约：`README-attachments.md` §4 —— 只有「库根相对路径 + 位图白名单扩展名 + `rejectReasonFor`
 * 判定通过」才渲染 `<img src="/api/content/asset?path=…">`；其余**保持今天的纯文本显示**；
 * 加载失败/403/404 显示「附件不可用（未发布或类型不允许）」，不静默消失。
 *
 * 同时守住既有边界（与 `markdown.test.tsx` 同口径，不放宽任何一条）：
 * 不产生 `href`、不产生指向外部域或磁盘的 `src`、原始 HTML 只当文本、没有事件属性。
 *
 * jsdom 不会真的发起图片请求，所以「加载失败」用 `fireEvent.error` 模拟。
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MarkdownView, parseMarkdownBlocks } from './markdown'
import { ASSET_ALLOWED_EXTENSIONS, assetExtensionOf, resolveImageAttachment } from './wikilink'

afterEach(() => {
  cleanup()
})

const DIR = '复习大纲/01-测试语言/assets'

/** 所有渲染出来的 `src`/`href`/`srcdoc` 属性值（用来证明没有外部出口）。 */
function urlAttributes(container: HTMLElement): string[] {
  return [...container.querySelectorAll('*')].flatMap((el) =>
    [...el.attributes]
      .filter((attr) => attr.name === 'src' || attr.name === 'href' || attr.name === 'srcdoc')
      .map((attr) => attr.value),
  )
}

/** 「只当文本」的统一断言：不生成任何 img/src/href，也不出现事件属性。 */
function expectTextOnly(source: string, label: string) {
  const { container } = render(<MarkdownView markdown={source} />)
  expect(container.querySelector('img'), label).toBeNull()
  expect(urlAttributes(container), label).toEqual([])
  expect(container.querySelector('script'), label).toBeNull()
  expect(container.innerHTML.toLowerCase(), label).not.toContain('<script')
  expect([...container.querySelectorAll('*')].some((el) => [...el.attributes].some((attr) => /^on/i.test(attr.name))), label).toBe(false)
  expect(container.textContent, label).toContain(source)
  cleanup()
}

describe('白名单内图片渲染成 <img>', () => {
  it('库根相对路径 + png：同源 asset 接口、alt 取图片说明、没有 href', () => {
    const { container } = render(<MarkdownView markdown={`图示：![分支流程图](${DIR}/分支流程图.png)`} />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe(`/api/content/asset?path=${encodeURIComponent(`${DIR}/分支流程图.png`)}`)
    expect(img?.getAttribute('alt')).toBe('分支流程图')
    expect(img?.getAttribute('loading')).toBe('lazy')
    expect(img?.style.aspectRatio).toBe('16 / 9')
    expect(img?.style.objectFit).toBe('contain')
    expect(container.querySelector('a')).toBeNull()
    // 只允许指向同源附件接口的相对地址：既不是绝对 URL，也不是磁盘路径
    const urls = urlAttributes(container)
    expect(urls).toHaveLength(1)
    for (const value of urls) {
      expect(value.startsWith('/api/content/asset?path=')).toBe(true)
      expect(value).not.toMatch(/^[a-z][a-z0-9+.-]*:/i)
      expect(value).not.toMatch(/[A-Za-z]:[\\/]/)
      expect(value).not.toContain('..')
      expect(value).not.toContain('%5C')
    }
  })

  it('五种位图都给 src；pdf/txt/csv/json 与表外类型一律不渲染图片、仍是纯文本', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp']) {
      const { container } = render(<MarkdownView markdown={`![图](${DIR}/图.${ext})`} />)
      expect(container.querySelectorAll('img'), ext).toHaveLength(1)
      cleanup()
    }
    for (const ext of ['svg', 'html', 'htm', 'xhtml', 'js', 'mjs', 'css', 'md', 'pdf', 'txt', 'csv', 'json', 'exe']) {
      const source = `![图](${DIR}/图.${ext})`
      const { container } = render(<MarkdownView markdown={source} />)
      expect(container.querySelector('img'), ext).toBeNull()
      expect(container.querySelector('[src]'), ext).toBeNull()
      expect(container.textContent, ext).toContain(source)
      cleanup()
    }
    expect([...ASSET_ALLOWED_EXTENSIONS].sort()).toEqual(['csv', 'gif', 'jpeg', 'jpg', 'json', 'pdf', 'png', 'txt', 'webp'])
  })

  it('带标题的写法 ![说明](路径 "标题") 与空 alt ![](路径) 同样按白名单判定', () => {
    const titled = render(<MarkdownView markdown={`![流程图](${DIR}/a.png "可选标题")`} />)
    const img = titled.container.querySelector('img')
    expect(img?.getAttribute('alt')).toBe('流程图')
    expect(img?.getAttribute('src')).toBe(`/api/content/asset?path=${encodeURIComponent(`${DIR}/a.png`)}`)
    cleanup()
    const emptyAlt = render(<MarkdownView markdown={`![](${DIR}/a.png)`} />)
    expect(emptyAlt.container.querySelector('img')?.getAttribute('alt')).toBe('')
    cleanup()
  })

  it('图片语法不完整时不判定为图片：整段仍按纯文本显示', () => {
    for (const source of ['![未闭合](a.png', `![缺括号)] ${DIR}/a.png`, '![只有方括号 a.png)']) {
      const { container } = render(<MarkdownView markdown={source} />)
      expect(container.querySelector('img'), source).toBeNull()
      expect(container.textContent, source).toContain(source)
      cleanup()
    }
  })

  it('表格与列表单元格里同样按白名单判定，且不改变块级结构', () => {
    const md = ['| 图 | 说明 |', '|---|---|', `| ![流程图](${DIR}/a.png) | 位图 |`, '', `- ![危险](${DIR}/b.svg)`].join('\n')
    const { container } = render(<MarkdownView markdown={md} />)
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(container.querySelector('table')?.getAttribute('role')).toBe('table')
    expect(container.querySelector('li')?.textContent).toContain(`![危险](${DIR}/b.svg)`)
    expect(parseMarkdownBlocks(md).map((block) => block.kind)).toEqual(['table', 'list'])
  })

  it('正文里一行只放一张图时，图片段落不吞掉相邻文字', () => {
    const md = ['前置段落。', '', `![流程图](${DIR}/a.png)`, '', '后置段落。'].join('\n')
    const { container } = render(<MarkdownView markdown={md} />)
    const paragraphs = [...container.querySelectorAll('p')]
    expect(paragraphs).toHaveLength(3)
    expect(paragraphs[0]?.textContent).toBe('前置段落。')
    expect(paragraphs[1]?.querySelector('img')).not.toBeNull()
    expect(paragraphs[2]?.textContent).toBe('后置段落。')
  })
})

describe('危险目标不产生 src（与既有「只当文本」用例同口径）', () => {
  const dangerous: [string, string][] = [
    ['js 协议', `![x](javascript:alert(1))`],
    ['data 协议', '![x](data:text/html,<h1>x</h1>)'],
    ['vbscript', '![x](vbscript:msgbox(1))'],
    ['外部 http', '![x](https://evil.example/a.png)'],
    ['file 协议', '![x](file:///C:/Windows/win.ini)'],
    ['盘符', '![x](C:/Windows/win.ini)'],
    ['绝对路径', '![x](/etc/passwd)'],
    ['越界', '![x](../../../outside.png)'],
    ['编码越界', '![x](%2e%2e/%2e%2e/outside.png)'],
    ['HTML 片段', '![x](<img onerror=alert(1)>)'],
    ['网络路径', '![x](\\\\server\\share\\a.png)'],
    ['非白名单位置', `![x](${DIR}/脚本.js)`],
  ]

  for (const [label, source] of dangerous) {
    it(`${label}：只当文本，没有 img、没有 src/href、没有事件属性`, () => expectTextOnly(source, label))
  }

  it('`![[附件.pdf]]`（Obsidian 嵌入语法）本轮不放开：仍按双链文本呈现，不产生 src', () => {
    const { container } = render(<MarkdownView markdown={'![[复习大纲/附件.pdf]]'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[src]')).toBeNull()
    // 走的仍是既有双链判定（未连接快照时给可见提示），不是图片通道
    expect(container.querySelector('.md-wikilink')).not.toBeNull()
    expect(container.textContent).toContain('附件.pdf')
    expect(container.textContent).toContain('未连接内容快照')
  })

  it('围栏代码块里的图片语法只显示，不渲染', () => {
    const md = ['```md', `![流程图](${DIR}/a.png)`, '```'].join('\n')
    const { container } = render(<MarkdownView markdown={md} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('pre code')?.textContent).toContain(`![流程图](${DIR}/a.png)`)
  })

  it('判定函数本身只有一套路径规则：与 rejectReasonFor 同步', () => {
    expect(resolveImageAttachment(`${DIR}/a.png`)).toMatchObject({ kind: 'image' })
    expect(resolveImageAttachment('C:/Windows/win.ini')).toMatchObject({ kind: 'text' })
    expect(resolveImageAttachment('https://evil.example/a.png')).toMatchObject({ kind: 'text' })
    expect(resolveImageAttachment('复习大纲/../../etc/passwd')).toMatchObject({ kind: 'text' })
    expect(resolveImageAttachment(`${DIR}/a.png#frag`)).toMatchObject({ kind: 'text' })
    expect(assetExtensionOf('a/b/archive.tar.gz')).toBe('gz')
    expect(assetExtensionOf('a/无扩展名')).toBe('')
    expect(assetExtensionOf('a/.hidden')).toBe('')
    expect(resolveImageAttachment('  ').kind).toBe('text')
  })
})

describe('加载失败与 403/404 不静默消失', () => {
  it('图片错误事件 → 显示「附件不可用（未发布或类型不允许）」，并保留图片说明', () => {
    const { container } = render(<MarkdownView markdown={`![分支流程图](${DIR}/分支流程图.png)`} />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    fireEvent.error(img as unknown as Element)
    expect(container.querySelector('img')).toBeNull()
    const note = container.querySelector('.md-attachment--error')
    expect(note?.textContent).toContain('附件不可用（未发布或类型不允许）')
    expect(note?.textContent).toContain('分支流程图')
    expect(note?.getAttribute('role')).toBe('note')
    expect(urlAttributes(container)).toEqual([])
  })

  it('空说明的图片失败时仍给出可见提示，不留空白', () => {
    const { container } = render(<MarkdownView markdown={`![](${DIR}/x.png)`} />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    fireEvent.error(img as unknown as Element)
    expect(container.textContent).toBe('附件不可用（未发布或类型不允许）')
    expect(container.querySelector('img')).toBeNull()
  })
})
