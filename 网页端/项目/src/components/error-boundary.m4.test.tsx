// @vitest-environment jsdom
/**
 * M4 全站统一 · 错误态契约测试。
 *
 * 依据：§5.2 末行（错误态与全站同一体系）、§11.2「缺失/损坏/断连 → 有明确错误、
 * 有效旧快照或恢复入口，不空数据覆盖」。本文件把「不得只留一个出错了」这条判据
 * 变成可执行断言：错误类型 + 原始消息 + 堆栈/组件栈 + 复制出口 + 数据现状 + 下一步。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { ErrorBoundary, buildErrorReport } from './error-boundary'

const fsSpecifier: string = 'node:fs'
const { readFileSync } = (await import(fsSpecifier)) as {
  readFileSync: (path: string, encoding: 'utf8') => string
}
const moduleDir = (import.meta as unknown as { dirname?: string }).dirname ?? '.'
const cssText = readFileSync(`${moduleDir}/error-boundary.css`, 'utf8')
const cssCode = cssText.replace(/\/\*[\s\S]*?\*\//g, '')

expect(cssText.length).toBeGreaterThan(3000)

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

function allSelectors(css: string): string[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: string[] = []
  const pattern = /([^{}]+)\{/g
  let match: RegExpExecArray | null = pattern.exec(code)
  while (match) {
    let prelude = (match[1] ?? '').replace(/}/g, '').trim()
    if (prelude.startsWith('@')) prelude = prelude.slice(prelude.lastIndexOf(')') + 1).trim()
    out.push(...splitSelectors(prelude))
    match = pattern.exec(code)
  }
  return out.filter((selector) => !selector.startsWith('@'))
}

function declarationBlock(selector: string): string {
  const wanted = selector.replace(/\s+/g, ' ').trim()
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null = pattern.exec(cssText)
  while (match) {
    const prelude = (match[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ')
    // 逗号分组的选择器列表逐条比对（`:is(a, b)` 内部的逗号不算分隔）
    if (splitSelectors(prelude).some((part) => part.replace(/\s+/g, ' ').trim() === wanted)) return match[2] ?? ''
    match = pattern.exec(cssText)
  }
  return ''
}

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

function reduceMotionImportantCount(): number {
  const system = (mediaBlock('prefers-reduced-motion: reduce').match(/!important/g) ?? []).length
  const classCount = [...cssCode.matchAll(/\.reduce-motion[^{]*\{([^{}]*)\}/g)].reduce(
    (total, match) => total + ((match[1]?.match(/!important/g) ?? []).length),
    0,
  )
  return system + classCount
}

/** 渲染时抛错的探针组件。 */
/** 总是抛出的测试组件；不写返回类型会被推成 `void`，`void` 不是合法的 JSX 返回。 */
function Boom({ message = 'Cannot read properties of undefined（测试用异常）' }: { message?: string }): never {
  throw new Error(message)
}

function renderBoundary(children: ReactNode = <Boom />) {
  return render(<ErrorBoundary>{children}</ErrorBoundary>)
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  document.documentElement.className = ''
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
  Object.defineProperty(document, 'execCommand', { value: undefined, configurable: true, writable: true })
})

describe('M4 错误态 · 明确错误与下一步（§11.2）', () => {
  it('不再只留一句「出错了」：给出错误类型、原始消息、堆栈出口与三段下一步', () => {
    renderBoundary()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('这一屏没能显示出来')
    expect(screen.getByText('错误类型')).toBeTruthy()
    expect(screen.getByText('Error')).toBeTruthy()
    // 消息原文出现在 pre.cw-error-message 里（堆栈里也含同一句，故按元素取）
    expect(document.querySelector('.cw-error-message')?.textContent).toContain('Cannot read properties of undefined')
    expect(screen.getByText('出了什么错')).toBeTruthy()
    expect(screen.getByText('你的数据现在怎么样')).toBeTruthy()
    expect(screen.getByText('下一步做什么')).toBeTruthy()
    expect(screen.getByRole('button', { name: /复制错误详情/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /重新尝试/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /重新载入页面/ })).toBeTruthy()
  })

  it('如实说明不空数据覆盖，并给出恢复入口（导出留档 / 从导出文件恢复）', () => {
    renderBoundary()
    expect(screen.getByText('你的数据现在怎么样')).toBeTruthy()
    const facts = screen.getByLabelText('数据现状')
    expect(facts.textContent).toContain('不写入、不回滚、不清空任何存储')
    expect(facts.textContent).toContain('不会用空数据覆盖')
    expect(facts.textContent).toContain('导出学习数据')
    const next = screen.getByLabelText('下一步')
    expect(next.textContent).toContain('重新载入页面')
    expect(next.textContent).toContain('数据与隐私 → 从导出文件恢复')
  })

  it('堆栈与组件栈留在可展开区里，定位到具体组件树', () => {
    renderBoundary()
    const details = document.querySelector('details.cw-error-details')
    expect(details).toBeTruthy()
    expect(details?.querySelector('summary')?.textContent).toContain('展开调用堆栈与组件栈')
    const stacks = [...(details?.querySelectorAll('pre.cw-error-stack') ?? [])]
    expect(stacks.length).toBeGreaterThanOrEqual(1)
    const text = stacks.map((node) => node.textContent ?? '').join('\n')
    expect(text).toContain('Boom')
  })

  it('自定义 fallback 契约未变：调用方接管时不渲染默认错误屏', () => {
    render(
      <ErrorBoundary fallback={(error, reset) => <button onClick={reset}>自定义出口：{error.message}</button>}>
        <Boom message="父级接管" />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('button', { name: /自定义出口：父级接管/ })).toBeTruthy()
    expect(screen.queryByText('这一屏没能显示出来')).toBeNull()
  })

  it('重新尝试只重挂载子树：错误消失后原内容继续渲染', () => {
    /** 用「点击后抛错」触发，避免初始渲染抛错走并发渲染路径带来的不确定性。 */
    function Toggle() {
      const [fail, setFail] = useState(false)
      if (fail) throw new Error('点击后抛错')
      return (
        <button
          onClick={() => {
            setFail(true)
          }}
        >
          让它出错
        </button>
      )
    }
    render(
      <ErrorBoundary>
        <Toggle />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('button', { name: '让它出错' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '让它出错' }))
    expect(screen.getByText('这一屏没能显示出来')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /重新尝试/ }))
    expect(screen.queryByText('这一屏没能显示出来')).toBeNull()
    expect(screen.getByRole('button', { name: '让它出错' })).toBeTruthy()
  })

  it('重新载入页面走整页刷新（前端恢复通道，不碰任何存储）', () => {
    const reload = vi.fn()
    Object.defineProperty(window, 'location', { value: { reload }, writable: true })
    renderBoundary()
    fireEvent.click(screen.getByRole('button', { name: /重新载入页面/ }))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('M4 错误态 · 可复制（诚实反馈，不假装成功）', () => {
  it('Clipboard API 可用时复制完整报告，并显示已复制', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderBoundary()
    fireEvent.click(screen.getByRole('button', { name: /复制错误详情/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const text = writeText.mock.calls[0]![0] as string
    expect(text).toContain('错误类型：Error')
    expect(text).toContain('错误消息：Cannot read properties of undefined')
    expect(text).toContain('调用堆栈：')
    expect(screen.getByRole('status').textContent).toContain('已复制到剪贴板')
    expect(screen.getByRole('status').className).toContain('cw-error-copy-state--copied')
  })

  it('剪贴板被拒 + execCommand 也失败时如实报失败，并给出手动选取路径', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    })
    Object.defineProperty(document, 'execCommand', { value: vi.fn(() => false), configurable: true, writable: true })
    renderBoundary()
    fireEvent.click(screen.getByRole('button', { name: /复制错误详情/ }))
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('复制失败')
    expect(status.textContent).toContain('手动复制')
    expect(status.textContent).not.toContain('已复制')
    expect(status.className).toContain('cw-error-copy-state--failed')
  })

  it('无 Clipboard API 时退回 execCommand 通道，成功才报成功', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true, writable: true })
    renderBoundary()
    fireEvent.click(screen.getByRole('button', { name: /复制错误详情/ }))
    await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'))
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('已复制到剪贴板')
  })

  it('buildErrorReport 原样给出事实，并在超长堆栈上截断而不是丢信息', () => {
    const error = new Error('短消息')
    error.stack = `stack-head\n${'x'.repeat(5000)}`
    const report = buildErrorReport(error, '    in Boom\n    in App', '2026-09-20T10:00:00.000Z')
    expect(report).toContain('发生时间：2026-09-20T10:00:00.000Z')
    expect(report).toContain('错误消息：短消息')
    expect(report).toContain('组件栈（React）：')
    expect(report).toContain('（已截断，共')
  })
})

describe('M4 错误态 · 与全站同一体系（CSS 源码不变式）', () => {
  it('每条选择器都带错误态前缀：全局裸选择器 0 条', () => {
    const offenders = allSelectors(cssText).filter(
      (selector) =>
        !selector.startsWith('.error-boundary') && !selector.startsWith('.reduce-motion '),
    )
    expect(offenders).toEqual([])
  })

  it('黑场 + 1px 发丝线 + 直角，无渐变、无泛光、无背景模糊', () => {
    const root = declarationBlock('.error-boundary.cw-error')
    expect(root).toContain('background: var(--ce-canvas)')
    expect(root).toContain('color: var(--ce-ink)')
    const panel = declarationBlock('.error-boundary .cw-error-panel')
    expect(panel).toContain('border: var(--ce-line) solid var(--ce-edge)')
    expect(panel).toContain('box-shadow: var(--ds-shadow-panel, none)')
    expect(cssCode).not.toMatch(/backdrop-filter|linear-gradient|radial-gradient|text-shadow/)
    const radii = [...cssCode.matchAll(/border-radius:\s*([^;]+);/g)].map((match) => (match[1] ?? '').trim())
    expect(radii.length).toBeGreaterThan(0)
    for (const value of radii) expect(['var(--ce-radius)', 'var(--ds-shape-none, 0)']).toContain(value)
    expect(cssCode).not.toMatch(/border-radius:\s*[0-9]/)
  })

  it('错误文本必读：16px/1.7、堆栈可选中、触控 ≥44px、焦点可见', () => {
    const root = declarationBlock('.error-boundary.cw-error')
    expect(root).toContain('--ce-body: var(--ds-size-body, 16px)')
    expect(root).toContain('--ce-leading: var(--ds-leading-body, 1.7)')
    expect(root).toContain('--ce-tap: var(--ds-tap-min, 44px)')
    const message = declarationBlock('.error-boundary .cw-error-message')
    expect(message).toContain('user-select: text')
    expect(message).toContain('white-space: pre-wrap')
    expect(message).toContain('overflow-wrap: anywhere')
    expect(declarationBlock('.error-boundary .cw-error-btn')).toContain('min-height: var(--ce-tap)')
    expect(declarationBlock('.error-boundary .cw-error-details summary')).toContain('min-height: var(--ce-tap)')
    expect(declarationBlock('.error-boundary.cw-error :is(button, summary, a, [tabindex]):focus-visible')).toContain(
      'var(--ds-focus-ring-width, 2px)',
    )
    expect(cssCode).not.toMatch(/outline(-style)?:\s*(none|0)/)
    expect(mediaBlock('max-width: 420px')).toContain('padding-inline: var(--ds-space-8, 8px)')
  })

  it('语义状态不靠颜色单独承担：三种复制状态各有边框样式，且只用 --ds-status-*', () => {
    expect(declarationBlock('.error-boundary .cw-error-copy-state--copied')).toContain('border-style: solid')
    expect(declarationBlock('.error-boundary .cw-error-copy-state--failed')).toContain('border-style: solid')
    expect(declarationBlock('.error-boundary .cw-error-copy-state--idle')).toContain('border-style: dashed')
    expect(cssCode).not.toMatch(/--ds-scene-|--accent/)
    expect(cssCode.match(/var\(--ds-[a-z0-9-]+\)/g) ?? []).toEqual([])
  })

  it('无持续动画；两条减动效路径各自真停，!important 只出现在这两处', () => {
    expect(cssCode).not.toMatch(/infinite|@keyframes|animation:/)
    expect(mediaBlock('prefers-reduced-motion: reduce')).toContain('transition: none !important')
    expect(declarationBlock('.reduce-motion .error-boundary.cw-error :is(button, summary)')).toContain(
      'transition: none !important',
    )
    const total = (cssCode.match(/!important/g) ?? []).length
    expect(total).toBeGreaterThan(0)
    expect(total).toBe(reduceMotionImportantCount())
  })
})

describe('M4 错误态 · 无障碍结构（axe-core）', () => {
  it('错误屏的标题层级、landmark 与按钮名字无 axe 违规', async () => {
    const { container } = renderBoundary()
    const results = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false },
        'target-size': { enabled: false },
      },
    })
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([])
  })
})
