// @vitest-environment jsdom
/**
 * M4 全站统一 · 弹层体系契约测试（01 号方案 §5 弹层角色与焦点 + 「账户、设置、隐私和弹窗」出自旧总工程方案 §5.2，由 Git 保留
 * + §5.1 形态行 + §5.3.3 减动效真停 + §5.4 验收；形态裁定见 src/design/geometry.md §2/§5）。
 *
 * 与既有 modals.test.tsx 的分工：那份文件守「功能与焦点契约」，本文件守
 * ① 遮罩/弹层体系与全站同形（黑场遮罩、1px 发丝线、无玻璃/渐变/泛光、圆角三档）；
 * ② Esc 关闭后**焦点归还触发元素**（既有文件只测了初始焦点，没测归还）；
 * ③ modals.css 的 CSS 不变式（jsdom 不做层叠，按规则原文核对，手法同 M3 四页）。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HelpModal, SettingsModal, type AppSettings } from './modals'

/**
 * 组件样式表原文。vitest 默认不处理 CSS，`?raw` 会被替换成空模块，
 * 因此按 M3 的做法从磁盘读原文（本仓库未装 @types/node：变量说明符动态 import +
 * 局部类型收窄，不引入未声明全局）。长度断言是防空模块的守卫。
 */
const fsSpecifier: string = 'node:fs'
const { readFileSync } = (await import(fsSpecifier)) as {
  readFileSync: (path: string, encoding: 'utf8') => string
}
const moduleDir = (import.meta as unknown as { dirname?: string }).dirname ?? '.'
const cssPath = `${moduleDir}/modals.css`
const cssText = readFileSync(cssPath, 'utf8')
const cssCode = cssText.replace(/\/\*[\s\S]*?\*\//g, '')

expect(cssText.length).toBeGreaterThan(3000)

/** 逗号拆分，但忽略括号内的逗号（`:is(a, b)` 是一个选择器，不是两条）。 */
function splitSelectors(prelude: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of prelude) {
    if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  return parts.map((part) => part.trim()).filter(Boolean)
}

/** 拆出全部选择器（去掉注释与 at-rule 前缀，逗号分隔逐条）。 */
function allSelectors(css: string): string[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: string[] = []
  const pattern = /([^{}]+)\{/g
  let match: RegExpExecArray | null = pattern.exec(code)
  while (match) {
    let prelude = (match[1] ?? '').replace(/}/g, '').trim()
    if (prelude.startsWith('@')) {
      prelude = prelude.slice(prelude.lastIndexOf(')') + 1).trim()
    }
    out.push(...splitSelectors(prelude))
    match = pattern.exec(code)
  }
  return out.filter((selector) => !selector.startsWith('@'))
}

/** 取某个选择器（规范化空白后精确匹配）的声明体。 */
function declarationBlock(selector: string): string {
  const wanted = selector.replace(/\s+/g, ' ').trim()
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null = pattern.exec(cssText)
  while (match) {
    const selectorText = (match[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').trim()
    if (selectorText === wanted) return match[2] ?? ''
    match = pattern.exec(cssText)
  }
  return ''
}

/** @media 查询的内部文本（支持嵌套花括号）。 */
function mediaBlock(query: string): string {
  const at = cssText.indexOf(`@media (${query})`)
  if (at === -1) return ''
  const open = cssText.indexOf('{', at)
  let depth = 0
  for (let index = open; index < cssText.length; index += 1) {
    const char = cssText[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return cssText.slice(open + 1, index)
    }
  }
  return ''
}

/** 减动效两条路径里出现的 !important 数量（其余位置必须为 0）。 */
function reduceMotionImportantCount(): number {
  const system = mediaBlock('prefers-reduced-motion: reduce')
  const systemCount = (system.match(/!important/g) ?? []).length
  const classCount = [...cssCode.matchAll(/\.reduce-motion[^{]*\{([^{}]*)\}/g)].reduce(
    (total, match) => total + ((match[1]?.match(/!important/g) ?? []).length),
    0,
  )
  return systemCount + classCount
}

/** 某条声明里的圆角取值集合（只允许 0 / 50% / 100px 三档，geometry.md §2 裁定 1）。 */
function radiusValues(): string[] {
  return [...cssCode.matchAll(/border-radius:\s*([^;]+);/g)].map((match) => (match[1] ?? '').trim())
}

const baseSettings: AppSettings = {
  notifications: true,
  autosave: true,
  compactMode: false,
  editorFontSize: 13,
  reduceMotion: false,
}

/** 模拟 app.tsx 的真实挂载方式：触发按钮 → 弹窗 → 关闭后焦点归还。 */
function Harness({ mode = 'settings' }: { mode?: 'settings' | 'help' }) {
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(baseSettings)
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <div className="app-shell">
      <button ref={triggerRef} onClick={() => setOpen(true)}>
        打开设置
      </button>
      {open && mode === 'settings' && (
        <SettingsModal
          settings={settings}
          onChange={(updates) => setSettings((current) => ({ ...current, ...updates }))}
          onClose={() => {
            setOpen(false)
            triggerRef.current?.focus()
          }}
          onExport={vi.fn()}
          onRestoreDefaults={vi.fn()}
        />
      )}
      {open && mode === 'help' && (
        <HelpModal
          onClose={() => {
            setOpen(false)
            triggerRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}

function renderSettings(overrides: Partial<Parameters<typeof SettingsModal>[0]> = {}) {
  const props = {
    settings: baseSettings,
    onChange: vi.fn(),
    onClose: vi.fn(),
    onExport: vi.fn(),
    onRestoreDefaults: vi.fn(),
    ...overrides,
  }
  render(<SettingsModal {...props} />)
  return props
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
  document.documentElement.className = ''
})

describe('M4 弹层 · 关闭与焦点契约（不得回归的既有行为）', () => {
  it('Esc 关闭后焦点归还到打开它的触发元素（设置弹窗）', () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: '打开设置' })
    fireEvent.click(trigger)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭设置' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('Esc 关闭后焦点归还到触发元素（帮助弹窗）', () => {
    render(<Harness mode="help" />)
    const trigger = screen.getByRole('button', { name: '打开设置' })
    fireEvent.click(trigger)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '知道了' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('弹窗卸载后 body 滚动锁被解除（不残留 overflow:hidden）', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '打开设置' }))
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.body.style.overflow).toBe('')
  })

  it('Tab 循环不逃出弹窗：末位元素之后回到首位', () => {
    renderSettings()
    const dialog = screen.getByRole('dialog')
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select'))
    const last = focusables[focusables.length - 1]!
    last.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(focusables[0])
  })

  it('点遮罩关闭、点弹层内部不关闭（遮罩本身 role=presentation）', () => {
    const { onClose } = renderSettings()
    const backdrop = document.querySelector('.cw-modal-backdrop') as HTMLElement
    expect(backdrop.getAttribute('role')).toBe('presentation')
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('设置项默认值未被改版改动（提醒/自动保存/行号默认开，紧凑/减动效/自动换行默认关）', () => {
    renderSettings({ settings: {} })
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    // 后两位是 EDIT-01 补的两项：自动换行默认关（§5.4 长代码行量的就是关着的样子）、
    // 行号默认开（改版前根本没有这个开关，行号一直在——默认值必须等于旧观感）。
    expect(boxes.map((box) => box.checked)).toEqual([true, true, false, false, false, true])
    expect(screen.getByDisplayValue('13 px')).toBeTruthy()
  })

  it('导出入口仍只调用注入的实现（不在弹窗里另写一份导出）', () => {
    const { onExport } = renderSettings()
    fireEvent.click(screen.getByRole('button', { name: /导出/ }))
    expect(onExport).toHaveBeenCalledTimes(1)
  })
})

describe('M4 弹层 · §5.2/§5.1 体系与形态（CSS 源码不变式）', () => {
  it('每条选择器都带弹层前缀：全局裸选择器 0 条', () => {
    const offenders = allSelectors(cssText).filter(
      (selector) =>
        !selector.startsWith('.cw-modal') &&
        !selector.startsWith('.modal-backdrop') &&
        !selector.startsWith('.reduce-motion '),
    )
    expect(offenders).toEqual([])
  })

  it('圆角只有 0 / 50% / 100px 三档（geometry.md §2 裁定 1）', () => {
    const allowed = [
      'var(--ds-shape-none, 0)',
      'var(--cm-radius)',
      'var(--ds-shape-pill, 100px)',
      'var(--ds-shape-circle, 50%)',
      '0',
    ]
    const used = radiusValues()
    expect(used.length).toBeGreaterThan(0)
    for (const value of used) expect(allowed).toContain(value)
    expect(cssCode).not.toMatch(/border-radius:\s*[0-9]/)
  })

  it('黑场遮罩：由 --ds-canvas-solid 算出的 α 档，无背景模糊（玻璃特征）', () => {
    const scrim = declarationBlock('.modal-backdrop.cw-modal-backdrop')
    // 模态档 50，或壳层收口后的等价令牌 --z-modal（两者同值，见 geometry.md §5 裁定 3）
    expect(scrim).toMatch(/z-index:\s*(50|var\(--z-modal[^)]*\))/)
    expect(scrim).toContain('color-mix(in srgb, var(--ds-canvas-solid, #000)')
    expect(cssCode).not.toMatch(/backdrop-filter/)
    expect(cssCode).not.toMatch(/linear-gradient|radial-gradient/)
  })

  it('弹层体是黑场实底 + 1px 发丝线边界，零投影零泛光', () => {
    const modal = declarationBlock('.modal-backdrop .cw-modal')
    expect(modal).toContain('border: var(--cm-line) solid var(--cm-edge)')
    expect(modal).toContain('background: var(--cm-canvas-solid)')
    expect(modal).toContain('box-shadow: var(--ds-shadow-panel, none)')
    // 全文件只允许「投影 = 令牌档（none）」这一种写法，且该档实测就是无投影
    const shadows = [...cssCode.matchAll(/box-shadow:\s*([^;]+);/g)].map((match) => (match[1] ?? '').trim())
    expect(shadows.length).toBeGreaterThan(0)
    for (const value of shadows) expect(value).toBe('var(--ds-shadow-panel, none)')
    expect(cssCode).not.toMatch(/text-shadow/)
  })

  it('遮罩层级不自造新档：只用 geometry.md §5 的模态档 50（或其等价令牌）', () => {
    const zValues = [...cssCode.matchAll(/z-index:\s*([^;]+);/g)].map((match) => (match[1] ?? '').trim())
    expect(zValues.length).toBeGreaterThan(0)
    // 允许字面 50 与 --z-modal 令牌两种写法；出现任何其它档位即为本条失败
    for (const value of zValues) expect(value).toMatch(/^(50|var\(--z-modal[^)]*\))$/)
  })

  it('正文 16px / 行高 1.7、触控 44px、焦点轮廓可见、320px 有降级规则', () => {
    const root = declarationBlock('.modal-backdrop.cw-modal-backdrop')
    expect(root).toContain('--cm-body: var(--ds-size-body, 16px)')
    expect(root).toContain('--cm-leading: var(--ds-leading-body, 1.7)')
    expect(root).toContain('--cm-tap: var(--ds-tap-min, 44px)')
    expect(declarationBlock('.cw-modal .cw-modal-close')).toContain('height: var(--cm-tap)')
    expect(declarationBlock('.cw-modal .cw-modal-row')).toContain('min-height: calc(var(--cm-tap) + 12px)')
    expect(declarationBlock('.cw-modal .cw-modal-select')).toContain('min-height: var(--cm-tap)')
    expect(declarationBlock('.cw-modal-backdrop :is(button, input, select, textarea, [tabindex]):focus-visible')).toContain(
      'var(--ds-focus-ring-width, 2px)',
    )
    expect(cssCode).not.toMatch(/outline(-style)?:\s*(none|0)/)
    expect(mediaBlock('max-width: 420px')).toContain('place-items: start center')
  })

  it('语义状态色恒定：危险按钮取 --ds-status-danger，不引用场景点缀', () => {
    const danger = declarationBlock('.cw-modal .danger-button')
    expect(danger).toContain('var(--cm-bad)')
    expect(cssCode).not.toMatch(/--ds-scene-|--accent/)
  })

  it('每个 --ds-* 消费都带兜底值', () => {
    expect(cssCode.match(/var\(--ds-[a-z0-9-]+\)/g) ?? []).toEqual([])
  })

  it('无持续动画；两条减动效路径各自取消过渡，!important 只出现在这两处', () => {
    expect(cssCode).not.toMatch(/infinite/)
    expect(cssCode).not.toMatch(/@keyframes/)
    expect(mediaBlock('prefers-reduced-motion: reduce')).toContain('transition: none !important')
    expect(declarationBlock('.reduce-motion .modal-backdrop.cw-modal-backdrop :is(button, input, select, textarea)')).toContain(
      'transition: none !important',
    )
    const total = (cssCode.match(/!important/g) ?? []).length
    expect(total).toBeGreaterThan(0)
    expect(total).toBe(reduceMotionImportantCount())
  })

  it('模态内不再写行内样式（§5.1：样式由令牌与类名承担）', () => {
    // 只看渲染容器：body 上的 overflow 是焦点钩子运行时写的，不属于组件标记
    const help = render(<HelpModal onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: '知道了' }).getAttribute('style')).toBeNull()
    expect(help.container.querySelector('[style]')).toBeNull()
    cleanup()
    const settings = render(
      <SettingsModal
        settings={baseSettings}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onExport={vi.fn()}
        onRestoreDefaults={vi.fn()}
      />,
    )
    expect(settings.container.querySelector('[style]')).toBeNull()
  })
})

describe('M4 弹层 · 无障碍结构（axe-core）', () => {
  it('设置弹窗的 dialog / 表单 / 开关结构无 axe 违规', async () => {
    const { container } = render(
      <SettingsModal
        settings={baseSettings}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onExport={vi.fn()}
        onRestoreDefaults={vi.fn()}
      />,
    )
    const results = await axe.run(container, {
      rules: {
        // jsdom 无布局：色彩对比与触控尺寸由上面的 CSS 源码不变式与浏览器复核承担
        'color-contrast': { enabled: false },
        'target-size': { enabled: false },
      },
    })
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([])
  })
})
