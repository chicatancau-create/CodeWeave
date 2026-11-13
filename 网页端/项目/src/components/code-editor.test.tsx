// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodeEditor, indentBlock } from './code-editor'
import * as cachedTokenizer from '../engine/cached-syntax-tokenizer'

/**
 * EDIT-01「编辑器输入与辅助能力」的行为契约。
 *
 * 改版前的三件事都在这里钉住：
 * ① Tab 与 Shift+Tab 都被当成「插两个空格」，键盘用户**出不去**编辑区，也没人退缩进；
 * ② 复制按钮 `await` 都没写就渲染完事了，剪贴板被拒时界面毫无反应；
 * ③ 设置里根本没有 Tab 宽度 / 自动换行 / 行号，卡片要的「先补选区缩进测试再扩能力」
 *    就是这一份。缩进算法本身是纯函数（`indentBlock`），先测它再测键盘事件。
 */
const baseProps = {
  language: 'javascript' as const,
  languageLabel: 'JavaScript',
  runtime: 'Browser JS',
  onChange: () => {},
}

function editor(over = {}) {
  const props = { ...baseProps, ...over }
  render(<CodeEditor {...(props as unknown as React.ComponentProps<typeof CodeEditor>)} />)
  return document.querySelector<HTMLTextAreaElement>('.code-editor textarea')!
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('高亮缓存与编辑器实例', () => {
  it('每个编辑器各有一个缓存，编辑和语言切换仍正确更新高亮', () => {
    const factory = vi.spyOn(cachedTokenizer, 'createCachedTokenizer')
    const { rerender } = render(<>
      <CodeEditor {...baseProps} code={'let first = 1\nprint(first)'} />
      <CodeEditor {...baseProps} code="let second = 2" />
    </>)
    expect(factory).toHaveBeenCalledTimes(2)
    rerender(<>
      <CodeEditor {...baseProps} code={'let first = 3\nprint(first)'} language="python" />
      <CodeEditor {...baseProps} code="let second = 2" />
    </>)
    expect(factory).toHaveBeenCalledTimes(2)
    const highlighted = document.querySelectorAll('.code-tokens')
    expect(highlighted[0]?.textContent).toBe('let first = 3\nprint(first)\n')
    expect(highlighted[0]?.querySelector('.tok-keyword')).toBeNull()
    expect(highlighted[1]?.textContent).toBe('let second = 2\n')
    expect(highlighted[1]?.querySelector('.tok-keyword')?.textContent).toBe('let')
  })
})

describe('indentBlock（纯函数：选区与缩进）', () => {
  it('Tab 每行前面补 tabSize 个空格，跨行选区覆盖到的每一行都算', () => {
    const code = 'let a = 1\nlet b = 2'
    const r = indentBlock(code, 0, code.length, 2, 1)
    expect(r.value).toBe('  let a = 1\n  let b = 2')
    expect(r.selectionStart).toBe(0)
    expect(r.selectionEnd).toBe(r.value.length)
  })

  it('Shift+Tab 每行最多退 tabSize 格；只缩了一格的行退掉那一格而不是清空行首', () => {
    expect(indentBlock('  let a = 1', 0, 11, 2, -1).value).toBe('let a = 1')
    expect(indentBlock(' let a = 1', 0, 10, 2, -1).value).toBe('let a = 1')
    expect(indentBlock('let a = 1', 0, 9, 2, -1).value).toBe('let a = 1')
    // 行首之外一个字符都不动
    expect(indentBlock('    let a = 1', 0, 13, 2, -1).value).toBe('  let a = 1')
  })

  it('TabSize 是设置项：4 格档一次进 4、一次退 4', () => {
    expect(indentBlock('a', 0, 1, 4, 1).value).toBe('    a')
    expect(indentBlock('    a', 0, 5, 4, -1).value).toBe('a')
  })

  it('收起的光标跟着本行走，退到行首就停住不会跑到上一行', () => {
    const r = indentBlock('  a', 2, 2, 2, -1)
    expect(r.value).toBe('a')
    expect(r.selectionStart).toBe(0)
    expect(r.selectionEnd).toBe(0)
    // 光标在代码中间（不在缩进区内）→ 保持改版前的行为：在光标处插一格缩进
    const mid = indentBlock('a', 1, 1, 2, 1)
    expect(mid.value).toBe('a  ')
    expect(mid.selectionStart).toBe(3)
    // 光标在行首 → 才算整行缩进
    const head = indentBlock('a', 0, 0, 2, 1)
    expect(head.value).toBe('  a')
    expect(head.selectionStart).toBe(2)
  })

  it('最后一行没有换行符、以及整段只有一个光标时都不越界', () => {
    expect(indentBlock('a\nb', 2, 3, 2, 1).value).toBe('a\n  b')
    expect(indentBlock('', 0, 0, 2, -1).value).toBe('')
  })
})

describe('键盘：Tab 缩进 / Shift+Tab 退缩进 / Esc 交还焦点导航', () => {
  it('Tab 拦下默认行为并按 tabSize 缩进', () => {
    const onChange = vi.fn()
    const el = editor({ code: 'let a = 1', onChange, tabSize: 4 })
    el.selectionStart = 0
    el.selectionEnd = 9
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    el.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(onChange).toHaveBeenCalledWith('    let a = 1')
  })

  it('Shift+Tab 是退缩进，不是再插两格（改版前两者走同一条分支）', () => {
    const onChange = vi.fn()
    const el = editor({ code: '  let a = 1', onChange })
    el.selectionStart = 0
    el.selectionEnd = 11
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    el.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(onChange).toHaveBeenCalledWith('let a = 1')
  })

  it('按一次 Esc 之后，Tab 交还给焦点导航：不拦默认、也不改代码；再按一次收回', () => {
    const onChange = vi.fn()
    const el = editor({ code: 'let a = 1', onChange })
    fireEvent.keyDown(el, { key: 'Escape' })
    expect(document.querySelector('.editor-keyhint')?.textContent).toContain('Tab = 切换焦点')

    const tabbed = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    el.dispatchEvent(tabbed)
    expect(tabbed.defaultPrevented).toBe(false)
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.keyDown(el, { key: 'Escape' })
    expect(document.querySelector('.editor-keyhint')?.textContent).toContain('Tab = 缩进')
    el.selectionStart = 0
    el.selectionEnd = 9
    fireEvent.keyDown(el, { key: 'Tab' })
    expect(onChange).toHaveBeenCalledWith('  let a = 1')
  })

  it('输入法合成期间的按键不归编辑器管（候选框里按 Esc 不该翻转键盘模式）', () => {
    const onChange = vi.fn()
    const el = editor({ code: 'let a = 1', onChange })
    fireEvent.keyDown(el, { key: 'Escape' })
    expect(document.querySelector('.editor-keyhint')?.textContent).toContain('Tab = 切换焦点')
    fireEvent.keyDown(el, { key: 'Escape' }) // 收回，确认基线
    onChange.mockClear()
    const composing = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    Object.defineProperty(composing, 'isComposing', { value: true })
    el.selectionStart = 0
    el.selectionEnd = 9
    el.dispatchEvent(composing)
    expect(composing.defaultPrevented).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
    expect(document.querySelector('.editor-keyhint')?.textContent).toContain('Tab = 缩进')
  })

  it('焦点不在本编辑器时不抢别人的 Tab', () => {
    const onChange = vi.fn()
    editor({ code: 'let a = 1', onChange })
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('复制：只报真发生过的事', () => {
  it('成功后才出「已复制到剪贴板」；await 之前一个字都不报', async () => {
    let release: () => void = () => {}
    const writeText = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    editor({ code: 'console.log(1)' })
    fireEvent.click(screen.getByRole('button', { name: '复制代码' }))
    expect(screen.queryByText(/已复制|复制失败/)).toBeNull()

    release()
    await waitFor(() => expect(screen.getByText('已复制到剪贴板')).toBeTruthy())
    expect(writeText).toHaveBeenCalledWith('console.log(1)')
  })

  it('被拒绝时报失败并把手动回退说出来，同时全选代码', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('NotAllowedError')))
    const el = editor({ code: 'let a = 1' })
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    fireEvent.click(screen.getByRole('button', { name: '复制代码' }))
    await waitFor(() => expect(screen.getByText('复制失败：代码已全选，请按 Ctrl+C')).toBeTruthy())
    expect(el.selectionStart).toBe(0)
    expect(el.selectionEnd).toBe(9)
    expect(screen.queryByText('已复制到剪贴板')).toBeNull()
  })

  it('没有剪贴板 API 的旧环境不抛异常，走同一条失败提示', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined })
    editor({ code: 'let a = 1' })
    fireEvent.click(screen.getByRole('button', { name: '复制代码' }))
    await waitFor(() => expect(screen.getByText(/复制失败/)).toBeTruthy())
  })

  it('复制的是点下去那一刻的快照', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    editor({ code: '第一版' })
    fireEvent.click(screen.getByRole('button', { name: '复制代码' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('第一版'))
  })
})

describe('三项设置真的落到 DOM 上', () => {
  it('连续滚动合并到一帧，使用最后位置同步高亮与行号；卸载取消未处理帧', () => {
    let flush: FrameRequestCallback = () => {}
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      flush = callback
      return 27
    })
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    const el = editor({ code: 'let a = 1\nlet b = 2' })
    fireEvent.scroll(el, { target: { scrollTop: 10, scrollLeft: 4 } })
    fireEvent.scroll(el, { target: { scrollTop: 25, scrollLeft: 9 } })
    expect(frame).toHaveBeenCalledTimes(1)
    act(() => flush(0))
    expect(document.querySelector<HTMLElement>('.code-tokens')?.style.transform).toBe('translate(-9px, -25px)')
    expect(document.querySelector<HTMLElement>('.line-numbers-inner')?.style.transform).toBe('translateY(-25px)')
    fireEvent.scroll(el, { target: { scrollTop: 30 } })
    cleanup()
    expect(cancel).toHaveBeenCalledWith(27)
  })
  it('行号可关：关掉后不画那一列，代码文本一字不变', () => {
    editor({ code: 'a\nb\nc', lineNumbers: true })
    expect(document.querySelectorAll('.line-numbers span')).toHaveLength(3)
    cleanup()
    editor({ code: 'a\nb\nc', lineNumbers: false })
    expect(document.querySelector('.line-numbers')).toBeNull()
    expect(document.querySelector<HTMLTextAreaElement>('.code-editor textarea')?.value).toBe('a\nb\nc')
  })

  it('Tab 宽度与自动换行同时驱动输入层与高亮层（两层不一致就会逐行错位）', () => {
    editor({ code: 'a', tabSize: 4, wordWrap: true })
    const area = document.querySelector<HTMLTextAreaElement>('.code-editor textarea')
    const pre = document.querySelector('.code-tokens')
    expect(area?.style.tabSize).toBe('4')
    expect((pre as HTMLElement).style.tabSize).toBe('4')
    expect(area?.style.whiteSpace).toBe('pre-wrap')
    expect((pre as HTMLElement).style.whiteSpace).toBe('pre-wrap')
    expect(document.querySelector('.code-editor')?.className).toContain('code-editor--wrap')
  })

  it('默认档位与改版前一致：Tab 两格、不折行、行号在', () => {
    editor({ code: 'a' })
    expect(document.querySelector('.code-editor')?.className).not.toContain('--wrap')
    expect(document.querySelector('.line-numbers')).toBeTruthy()
    expect(document.querySelector<HTMLTextAreaElement>('.code-editor textarea')?.style.tabSize).toBe('2')
  })
})

describe('错误定位（EDIT-01 第 6 条：控制台的「定位到第 N 行」）', () => {
  /** 'aa\nbb\ncc' 的行首偏移：1=0、2=3、3=6。 */
  const code = 'aa\nbb\ncc'

  it('reveal 一到：编辑器拿到焦点，光标落在该行行首', () => {
    const el = editor({ code, reveal: { line: 3, token: 1 } })
    expect(document.activeElement).toBe(el)
    expect(el.selectionStart).toBe(6)
    expect(el.selectionEnd).toBe(6)
  })

  it('行号超出代码长度时收在最后一行，不甩到文本末尾之外', () => {
    const el = editor({ code, reveal: { line: 99, token: 1 } })
    expect(el.selectionStart).toBe(6)
  })

  it('同一行连点两次也要真的再来一次：token 变了就重新定位', () => {
    const { rerender } = render(<CodeEditor {...baseProps} code={code} reveal={{ line: 3, token: 1 }} />)
    const el = document.querySelector<HTMLTextAreaElement>('.code-editor textarea')!
    el.setSelectionRange(0, 0)
    rerender(<CodeEditor {...baseProps} code={code} reveal={{ line: 3, token: 2 }} />)
    expect(el.selectionStart).toBe(6)
    // 只换代码不换 token 时不该抢焦点：用户正在别处打字，定位不是每敲一个字都发生的事
    rerender(<CodeEditor {...baseProps} code={`${code}\ndd`} reveal={{ line: 3, token: 2 }} />)
    expect(el.selectionStart).toBe(6)
  })
})

/**
 * EDIT-01 第 4 条里「撤销重做 / 多行粘贴」这两样。
 *
 * jsdom 没有浏览器的 undo 栈，所以**不假装测得动撤销**：能测的是两件事——
 * ① 编辑器不抢 Ctrl+Z / Ctrl+Y（把按键交回浏览器，原生撤销栈才有机会工作）；
 * ② 组件从不直接改 `textarea.value`（受控组件一旦绕过 onChange 直接写 value，
 *    浏览器就把这次改动当成程序设定而非用户编辑，原生 undo 栈当场失效）。
 * 多行粘贴走的是同一条 `input` 通道（值一次性变更多行），所以真测得动：
 * 行数、行号层与高亮层必须一起跟上，否则粘进来就是错位。
 */
describe('撤销重做与多行粘贴（EDIT-01 第 4 条的两样）', () => {
  it('Ctrl+Z / Ctrl+Y 不被拦截：既不 preventDefault 也不触发改代码', () => {
    const onChange = vi.fn()
    const el = editor({ code: 'let a = 1', onChange })
    for (const key of ['z', 'y']) {
      const event = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true })
      el.dispatchEvent(event)
      expect(event.defaultPrevented, `Ctrl+${key.toUpperCase()} 被编辑器吞掉了`).toBe(false)
    }
    expect(onChange).not.toHaveBeenCalled()
  })

  it('组件从不直接写 textarea.value：改动一律走 onChange 回灌（否则原生撤销栈当场失效）', async () => {
    const fsSpecifier: string = 'node:fs'
    const { readFileSync } = (await import(fsSpecifier)) as { readFileSync: (path: string, encoding: 'utf8') => string }
    const moduleDir = (import.meta as unknown as { dirname?: string }).dirname ?? '.'
    const source = readFileSync(`${moduleDir}/code-editor.tsx`, 'utf8')
    expect(source.length, '读不到 code-editor.tsx 原文，这条断言就是假绿').toBeGreaterThan(1000)
    // 直接给 .value 赋值会被浏览器当成「程序设定」而非用户编辑，原生 undo 栈就此清空；
    // 读 .value（定位与缩进都读）不算，所以只查赋值形态。
    const writes = source.split('\n').filter((line) => /\.value\s*=(?!=)/.test(line) && !/\.value\s*=\s*$/.test(line))
    expect(writes, `code-editor.tsx 里出现了直接写 value：${JSON.stringify(writes)}`).toEqual([])
    // defaultValue 会把受控组件变成半受控，同样禁掉
    expect(source).not.toMatch(/defaultValue=/)
  })

  it('多行粘贴：一次变更多行时行号层与高亮层一起跟上', () => {
    const onChange = vi.fn()
    const el = editor({ code: 'let a = 1', onChange, lineNumbers: true })
    expect(document.querySelectorAll('.line-numbers span')).toHaveLength(1)
    expect(el.value).toBe('let a = 1')
    const pasted = ['function f() {', '  return 1', '}', 'const g = f()'].join('\n')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(el, pasted)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    expect(onChange).toHaveBeenCalledWith(pasted)
  })

  it('多行粘贴后重绘：行号 4 行、高亮层字符数与文本一致（含组件补的那个尾换行）', () => {
    const pasted = ['function f() {', '  return 1', '}', 'const g = f()'].join('\n')
    const el = editor({ code: pasted, lineNumbers: true })
    expect(el.value).toBe(pasted)
    expect(document.querySelectorAll('.line-numbers span')).toHaveLength(4)
    const pre = document.querySelector('.code-tokens')
    expect(String(pre?.textContent || '').length).toBe(pasted.length + 1)
  })
})
