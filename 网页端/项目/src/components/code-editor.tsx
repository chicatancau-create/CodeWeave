import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Save } from 'lucide-react'
import { tokenizeCode } from '../engine/syntax-tokenizer'
import type { LanguageId } from '../types/lesson'
import './code-editor.css'

type Props = {
  code: string
  /** 语言 id（用于词法着色） */
  language: LanguageId
  /** 展示用语言名 */
  languageLabel: string
  runtime: string
  activeLine?: number
  onChange: (code: string) => void
  /** 一次 Tab 进/退几格（设置项，EDIT-01）；默认 2，与基座 `tab-size: 2` 一致。 */
  tabSize?: number
  /** 自动换行（设置项，EDIT-01）。关掉时长行走横向滚动——那是 §5.4 的取证形态，别默认改。 */
  wordWrap?: boolean
  /** 行号层开关（设置项，EDIT-01）。关掉只是不画，不改变文本内容一个字。 */
  lineNumbers?: boolean
  /**
   * EDIT-01 第 6 条「错误定位」：外部（控制台）请求把某一行送到眼前。
   * 带 token 是因为同一行连点两次也要真的再滚一次——只比行号的话第二次什么也不会发生。
   */
  reveal?: { line: number; token: number }
}

/**
 * 一整块缩进的纯函数：EDIT-01 第 2 条要求「先补选区/缩进测试再扩能力」，
 * 所以算法不碰 DOM，键盘事件只负责把选区交给它。
 *
 * 两种模式，分界是**选区起点在不在本行的缩进区里**（或者选区跨行）：
 * - 在（或跨行）→ 整块进/退：每行前面加 `tabSize` 个空格，或每行**最多**退 `tabSize` 个
 *   （只缩了 1 格的行就退 1 格，不会因为按一次 Shift+Tab 把行首吃光）。
 * - 不在 → 光标处在代码中间：Tab 在光标处插一格宽的缩进，Shift+Tab 删掉光标前那几个空格；
 *   这一支保持的是改版前的「Tab 就在光标处插两个空格」，因为那半句本来没坏。
 */
export function indentBlock(
  code: string,
  selectionStart: number,
  selectionEnd: number,
  tabSize: number,
  dir: 1 | -1,
): { value: string; selectionStart: number; selectionEnd: number } {
  const unit = ' '.repeat(Math.max(1, tabSize))
  const blockStart = code.lastIndexOf('\n', selectionStart - 1) + 1
  const nextBreak = code.indexOf('\n', selectionEnd)
  const blockEnd = nextBreak === -1 ? code.length : nextBreak
  const leadingCount = /^ */.exec(code.slice(blockStart, blockEnd))?.[0].length ?? 0
  const spansLines = code.slice(selectionStart, selectionEnd).includes('\n')
  const startsInIndent = selectionStart <= blockStart + leadingCount
  if (!(spansLines || startsInIndent)) {
    if (dir === 1) {
      return {
        value: `${code.slice(0, selectionStart)}${unit}${code.slice(selectionEnd)}`,
        selectionStart: selectionStart + unit.length,
        selectionEnd: selectionStart + unit.length,
      }
    }
    let cut = 0
    while (cut < unit.length && code[selectionStart - 1 - cut] === ' ') cut += 1
    if (!cut) return { value: code, selectionStart, selectionEnd: selectionStart }
    return {
      value: `${code.slice(0, selectionStart - cut)}${code.slice(selectionEnd)}`,
      selectionStart: selectionStart - cut,
      selectionEnd: selectionStart - cut,
    }
  }
  const lines = code.slice(blockStart, blockEnd).split('\n')
  const shifted = lines.map((line) => {
    if (dir === 1) return unit + line
    const leading = /^ +/.exec(line)?.[0].length ?? 0
    return line.slice(Math.min(unit.length, leading))
  })
  const block = shifted.join('\n')
  const value = `${code.slice(0, blockStart)}${block}${code.slice(blockEnd)}`
  if (selectionStart === selectionEnd) {
    // 收起的光标跟着本行走，退到行首就停住不会跑到上一行。
    const col = selectionStart - blockStart
    const moved = col + ((shifted[0]?.length ?? 0) - (lines[0]?.length ?? 0))
    const caret = blockStart + Math.max(0, Math.min(shifted[0]?.length ?? 0, moved))
    return { value, selectionStart: caret, selectionEnd: caret }
  }
  return { value, selectionStart: blockStart, selectionEnd: blockStart + block.length }
}

const LineNumbersLayer = memo(function LineNumbersLayer({
  lines,
  activeLine,
  offset,
}: {
  lines: string[]
  activeLine?: number
  offset: number
}) {
  return (
    <div className="line-numbers" aria-hidden="true">
      <div className="line-numbers-inner" style={{ transform: `translateY(${-offset}px)` }}>
        {lines.map((_, index) => <span className={activeLine === index + 1 ? 'active' : ''} key={index}>{String(index + 1).padStart(2, '0')}</span>)}
      </div>
    </div>
  )
})

const CodeTokensLayer = memo(function CodeTokensLayer({
  tokens,
  left,
  top,
  tabSize,
  wordWrap,
}: {
  tokens: ReturnType<typeof tokenizeCode>
  left: number
  top: number
  tabSize: number
  wordWrap: boolean
}) {
  return (
    <pre
      className="code-tokens"
      aria-hidden="true"
      style={{
        transform: `translate(${-left}px, ${-top}px)`,
        tabSize,
        whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
      }}
    >
      <CodeTokenContent tokens={tokens} />
      {'\n'}
    </pre>
  )
})

const CodeTokenContent = memo(function CodeTokenContent({ tokens }: { tokens: ReturnType<typeof tokenizeCode> }) {
  return tokens.map((token, index) => token.type === 'plain'
    ? token.text
    : <span key={index} className={`tok-${token.type}`}>{token.text}</span>)
})

export function CodeEditor({ code, language, languageLabel, runtime, activeLine, onChange, tabSize = 2, wordWrap = false, lineNumbers = true, reveal }: Props) {
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const scrollFrame = useRef<number | null>(null)
  const pendingScroll = useRef({ top: 0, left: 0 })
  /**
   * EDIT-01 第 2 条要的那个「明确机制」：Tab 默认用来缩进，**按 Esc 交还给焦点导航**，
   * 再按一次 Esc 收回。状态写在页脚那句可见文字里（不是只在 title 里），
   * 因为「键盘能不能离开编辑区」是键盘用户当下必须知道的一件事。
   */
  const [tabReleasesFocus, setTabReleasesFocus] = useState(false)
  /** 复制只报**真实发生过**的结果：await 之后才定性，失败就说失败并给出手动回退。 */
  const [copyResult, setCopyResult] = useState<'idle' | 'ok' | 'fail'>('idle')
  const lines = useMemo(() => code.split('\n'), [code])
  const tokens = useMemo(() => tokenizeCode(code, language), [code, language])

  useEffect(() => () => {
    if (scrollFrame.current !== null) window.cancelAnimationFrame(scrollFrame.current)
  }, [])

  /**
   * 错误定位（EDIT-01 第 6 条）：把光标放到那一行的行首并聚焦，滚动由浏览器按
   * 「选区变化即把光标滚进可视区」完成。这里**不**用 scrollTop 乘行高来算——
   * 开了自动换行之后一行占多高是内容决定的，算出来的位置会偏。
   */
  useEffect(() => {
    const editor = editorRef.current
    if (!reveal || !editor) return
    const editorLines = editor.value.split('\n')
    const target = Math.max(1, Math.min(reveal.line, editorLines.length))
    const index = editorLines
      .slice(0, target - 1)
      .reduce((offset, line) => offset + line.length + 1, 0)
    editor.focus()
    editor.setSelectionRange(index, index)
  }, [reveal])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const editor = editorRef.current
      if (!editor || event.target !== editor) return
      // 输入法合成期间的按键不归编辑器管：中文候选框里按 Esc 是取消候选，
      // 不该顺手把「Tab 交还焦点导航」这件事翻过去（EDIT-01 第 5 条）。
      if (event.isComposing) return
      if (event.key === 'Escape') {
        // 只翻转本编辑器这一处，不拦下 Esc 的其他用途（关弹窗由 app.tsx 的全局处理负责）。
        setTabReleasesFocus((current) => !current)
        return
      }
      if (event.key !== 'Tab' || tabReleasesFocus) return
      event.preventDefault()
      const next = indentBlock(code, editor.selectionStart, editor.selectionEnd, tabSize, event.shiftKey ? -1 : 1)
      onChange(next.value)
      window.requestAnimationFrame(() => {
        editor.selectionStart = next.selectionStart
        editor.selectionEnd = next.selectionEnd
      })
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [code, onChange, tabSize, tabReleasesFocus])

  const handleCopy = async () => {
    const snapshot = code // 只复制点下去这一刻的快照，之后改的不算进这次复制
    const clip = navigator.clipboard
    if (!clip?.writeText) {
      editorRef.current?.select()
      setCopyResult('fail')
      return
    }
    try {
      await clip.writeText(snapshot)
      setCopyResult('ok')
    } catch {
      // 权限被拒 / 非安全上下文：把文本选好，交回手动 Ctrl+C，不谎报成功。
      editorRef.current?.select()
      setCopyResult('fail')
    }
  }

  const handleScroll = (event: React.UIEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget
    pendingScroll.current = { top: el.scrollTop, left: el.scrollLeft }
    if (scrollFrame.current !== null) return
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null
      setScroll(pendingScroll.current)
    })
  }

  return <>
    <div className={`code-editor${wordWrap ? ' code-editor--wrap' : ''}`}>
      {lineNumbers && (
        <LineNumbersLayer lines={lines} activeLine={activeLine} offset={scroll.top} />
      )}
      <div className="code-surface">
        {/* 高亮层：纯展示，aria-hidden 且不接收鼠标事件；输入始终由下方真实 textarea 承担。
            强制颜色模式下这一层整层隐掉，见 code-editor.css 的 forced-colors 段。 */}
        <CodeTokensLayer tokens={tokens} left={scroll.left} top={scroll.top} tabSize={Math.max(1, tabSize)} wordWrap={wordWrap} />
        {activeLine && (
          <div
            className="code-highlight"
            style={{ top: `calc(var(--editor-font-size) * var(--line-height-editor) * ${activeLine - 1} - ${scroll.top}px)` }}
          />
        )}
        <textarea
          ref={editorRef}
          aria-label={`${languageLabel} 代码编辑器`}
          spellCheck="false"
          value={code}
          style={{ tabSize: Math.max(1, tabSize), whiteSpace: wordWrap ? 'pre-wrap' : 'pre' }}
          onChange={(event) => onChange(event.target.value)}
          onScroll={handleScroll}
        />
      </div>
    </div>
    <div className="code-footer">
      <span>{runtime} · {languageLabel}</span>
      <span className="editor-actions">
        {/* 键盘模式是当前状态、不是「刚发生的事」，所以只做可见文字：
            一处 `role=status` 已经归复制结果用，两个活区会把工作台自己那条执行等级播报挤掉。 */}
        <span className="editor-keyhint">
          {tabReleasesFocus ? 'Tab = 切换焦点（Esc 改回缩进）' : 'Tab = 缩进 · Shift+Tab 退缩进（Esc 交还焦点导航）'}
        </span>
        <button aria-label="复制代码" onClick={handleCopy}><Copy size={11} /> 复制</button>
        {copyResult !== 'idle' && (
          <span role="status" className={copyResult === 'ok' ? 'editor-copy-ok' : 'editor-copy-fail'}>
            {copyResult === 'ok' ? '已复制到剪贴板' : '复制失败：代码已全选，请按 Ctrl+C'}
          </span>
        )}
        <span>Ctrl + Enter 运行</span>
        <Save size={11} />
      </span>
    </div>
  </>
}
