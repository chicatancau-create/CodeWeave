// @vitest-environment jsdom
/**
 * M4 全站统一 · 资料来源区契约测试（01 号方案 §3.4「数据页清楚标出来源、bundleId、更新时间、验证状态和缺口」+ §8）
 *
 * 三件核心保护：
 * 1. **五块分区清楚分开**：规范主题 / 原文位置 / 核验状态 / 同步时间 / 正式事实，
 *    逐个 data-cs-field 可寻，顺序与命名固定；
 * 2. **核验状态文案不得被改强**：「外部未复核」「待核验」原样出现，整页不出现
 *    「已核实 / 已验证」这类提升；`stateText` 的六种状态映射逐条钉住；
 * 3. 语义状态走「固定字符徽记 + 文字 + 边框样式」双通道，不跟场景色。
 * 另外钉住 M3 学习工作台对本组件的既有契约（.lesson-source / 查看主题原文 / .md-view），
 * 以及 CSS 源码不变式。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContentSourceBanner, LessonSourceDetail } from './content-source-view'
import { ContentProviderHost, type ContentContextValue } from '../content/provider'
import type { Lesson } from '../types/lesson'

/* ────────────────── CSS 原文（vitest 不处理 CSS，只能读盘核对） ────────────────── */

const fsSpecifier: string = 'node:fs'
const { readFileSync } = (await import(fsSpecifier)) as { readFileSync: (path: string, encoding: 'utf8') => string }
const pathSpecifier: string = 'node:path'
const { resolve } = (await import(pathSpecifier)) as { resolve: (...parts: string[]) => string }
const procSpecifier: string = 'node:process'
const { cwd } = (await import(procSpecifier)) as { cwd: () => string }

const cssText = readFileSync(resolve(cwd(), 'src/components/content-source-view.css'), 'utf8')
const cssCode = cssText.replace(/\/\*[\s\S]*?\*\//g, '')

function splitTopLevel(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let buffer = ''
  for (const char of value) {
    if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth -= 1
    if (char === ',' && depth === 0) {
      out.push(buffer.trim())
      buffer = ''
      continue
    }
    buffer += char
  }
  if (buffer.trim()) out.push(buffer.trim())
  return out
}

function selectorParts(css: string): string[] {
  const parts: string[] = []
  const pattern = /([^{}]+)\{/g
  let match: RegExpExecArray | null = pattern.exec(css)
  while (match) {
    const head = (match[1] ?? '').replace(/\s+/g, ' ').trim()
    if (!head.startsWith('@')) parts.push(...splitTopLevel(head))
    match = pattern.exec(css)
  }
  return parts.filter((part) => part !== '')
}

function declarationBlock(selector: string): string {
  const wanted = selector.replace(/\s+/g, ' ').trim()
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null = pattern.exec(cssText)
  while (match) {
    const head = (match[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').trim()
    if (head === wanted || splitTopLevel(head).includes(wanted)) return match[2] ?? ''
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

/* ────────────────────────────── 夹具 ────────────────────────────── */

const lessonAt = (overrides: Partial<Lesson> = {}): Lesson =>
  ({
    id: 'vault-s0-1',
    language: 'java',
    languageLabel: 'Java',
    label: 'S0',
    title: '开发环境清点',
    description: '把工具链逐个清点',
    duration: '45 min',
    level: '入门',
    progress: 0,
    code: '',
    flow: [],
    insight: '',
    fileName: 'env.txt',
    runtime: '外部环境 · 终端',
    contentId: 'topic-java-env',
    subject: 'Java',
    subjectId: 'java',
    legacy: false,
    executable: true,
    source: {
      path: '资料库/Java/环境.md',
      headingPath: ['Java', '环境'],
      verificationStatus: '外部未复核',
      sourceIds: ['src-1'],
      contentHash: 'abcdef1234567890',
    },
    reading: {
      markdown: '### 核心概念\n\n一条概念。',
      path: '资料库/Java/环境.md',
      headingPath: ['Java', '环境'],
      verificationStatus: '外部未复核',
      headings: [],
    },
    content: {
      objective: '清点工具链',
      prerequisites: [],
      explanation: [],
      examples: [],
      guidedSteps: [],
      exercise: '',
      variant: '',
      projectTask: '',
      mistakes: [],
      runCommand: '教学运行器',
      completion: '',
      reviewOffsetsDays: [],
      stageId: 'S0',
      estimatedMinutes: 45,
    },
    ...overrides,
  }) as Lesson

const vaultContent = {
  sourceKind: 'vault',
  state: 'ready',
  bundleId: 'bundle-12345678-90ab',
  buildTime: '2026-09-20T02:00:00.000Z',
  counts: { lessons: 12 },
  status: { vaultConfigured: true, vaultReason: null },
  error: null,
} as unknown as ContentContextValue

const legacyContent = {
  sourceKind: 'legacy-fallback',
  state: 'unavailable',
  bundleId: null,
  buildTime: null,
  counts: null,
  status: { vaultConfigured: false, vaultReason: 'missing' },
  error: null,
  sync: vi.fn(async () => ({ ok: false, message: '资料库未连接' })),
} as unknown as ContentContextValue

const FIVE_ZONES = ['topic', 'source', 'verification', 'sync', 'facts']

function fields(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('[data-cs-field]')].map((node) => ({
    key: node.getAttribute('data-cs-field') ?? '',
    label: node.querySelector('dt')?.textContent ?? '',
    value: node.querySelector('dd')?.textContent ?? '',
  }))
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('M4 来源详情 · 五块分区（§5.2 第七行）', () => {
  it('规范主题 / 原文位置 / 核验状态 / 同步时间 / 正式事实 依序各占一块', () => {
    const { container } = render(<LessonSourceDetail lesson={lessonAt()} />)
    const list = fields(container)
    expect(list.map((item) => item.key)).toEqual(FIVE_ZONES)
    expect(list.map((item) => item.label)).toEqual(['规范主题', '原文位置', '核验状态', '同步时间', '正式事实'])
  })

  it('每块都是发丝线 specs 的 dt/dd 键值，不做卡片', () => {
    const { container } = render(<LessonSourceDetail lesson={lessonAt()} />)
    const specs = container.querySelector('dl.cs-specs')
    expect(specs).toBeTruthy()
    expect(specs?.querySelectorAll('.cs-spec')).toHaveLength(5)
    expect(container.querySelector('.cs-spec dt')?.textContent).toBe('规范主题')
    expect(container.querySelector('.cs-spec dd')).toBeTruthy()
  })

  it('规范主题给稳定 ID 与科目；旧内置课程明确说没有主题 ID', () => {
    const { container } = render(<LessonSourceDetail lesson={lessonAt()} />)
    expect(fields(container)[0]?.value).toBe('主题 ID topic-java-env · 科目 Java')
    cleanup()
    const legacy = render(
      <LessonSourceDetail
        lesson={lessonAt({ id: 'legacy-1', contentId: undefined, legacy: true, source: lessonAt().source })}
      />,
    )
    expect(fields(legacy.container)[0]?.value).toContain('没有主题 ID，不并入资料库主题口径')
  })

  it('原文位置给分册路径与章节链；来源编号单独成行', () => {
    const { container } = render(<LessonSourceDetail lesson={lessonAt()} />)
    expect(fields(container)[1]?.value).toBe('资料库/Java/环境.md#Java > 环境')
    expect(container.querySelector('.cs-meta')?.textContent).toBe('来源编号：src-1')
  })
})

describe('M4 来源详情 · 核验状态不得改强', () => {
  it('「外部未复核」原样出现在三处，整页不含「已核实」「已验证」', () => {
    const { container } = render(<LessonSourceDetail lesson={lessonAt()} />)
    expect(container.textContent).toContain('外部未复核')
    expect(fields(container)[2]?.value).toContain('外部未复核')
    expect(fields(container)[2]?.value).toContain('本界面不改强、不折算')
    expect(container.querySelector('.cs-mark-text')?.textContent).toBe('外部未复核')
    expect(container.textContent).not.toMatch(/已核实|已验证|核验通过/)
  })

  it('「库内已存在」也不改口：文字仍是原文口径，只切换标识样式', () => {
    const { container } = render(
      <LessonSourceDetail
        lesson={lessonAt({
          source: { ...lessonAt().source!, verificationStatus: '库内已存在' },
        })}
      />,
    )
    const mark = container.querySelector<HTMLElement>('.cs-mark')
    expect(mark?.getAttribute('data-cs-mark')).toBe('verified')
    expect(mark?.querySelector('.cs-mark-text')?.textContent).toBe('库内已存在')
    expect(container.textContent).not.toMatch(/已核实|已验证/)
  })

  it('核验标识是「固定字符徽记 + 文字」双通道，徽记不进读屏顺序', () => {
    const { container } = render(<LessonSourceDetail lesson={lessonAt()} />)
    const mark = container.querySelector<HTMLElement>('.cs-mark')
    expect(mark?.getAttribute('data-cs-mark')).toBe('unverified')
    const glyph = mark?.querySelector('.cs-mark-glyph')
    expect(glyph?.getAttribute('aria-hidden')).toBe('true')
    expect((glyph?.textContent ?? '').length).toBeGreaterThan(0)
    expect((mark?.querySelector('.cs-mark-text')?.textContent ?? '').length).toBeGreaterThan(1)
  })

  it('「待核验」等其它状态同样原样转述，不套到 ok 档', () => {
    const { container } = render(
      <LessonSourceDetail lesson={lessonAt({ source: { ...lessonAt().source!, verificationStatus: '待核验' } })} />,
    )
    expect(container.querySelector('.cs-mark')?.getAttribute('data-cs-mark')).toBe('unverified')
    expect(container.textContent).toContain('待核验（资料库侧登记口径')
  })

  it('正式事实区分资料库快照与旧内置课程，不把旧课程当正式事实', () => {
    const { container } = render(<LessonSourceDetail lesson={lessonAt()} />)
    expect(fields(container)[4]?.value).toContain('资料库快照内的正式内容')
    cleanup()
    const legacy = render(
      <LessonSourceDetail
        lesson={lessonAt({ id: 'legacy-2', legacy: true, contentId: undefined, source: lessonAt().source })}
      />,
    )
    expect(fields(legacy.container)[4]?.value).toBe('旧内置课程：不作为资料库正式事实')
    expect(legacy.container.textContent).toContain('旧阶段口径：')
  })
})

describe('M4 来源详情 · 同步时间与 Provider 缺失', () => {
  it('Provider 之外渲染时如实说明取不到同步时间，不编造日期', () => {
    const { container } = render(<LessonSourceDetail lesson={lessonAt()} />)
    expect(fields(container)[3]?.value).toBe('本组件未取到快照构建时间；见顶部来源状态条')
  })

  it('在 Provider 内则显示快照与构建时间', () => {
    const { container } = render(
      <ContentProviderHost.Provider value={vaultContent}>
        <LessonSourceDetail lesson={lessonAt()} />
      </ContentProviderHost.Provider>,
    )
    const sync = fields(container)[3]?.value ?? ''
    expect(sync).toContain('当前快照 bundle-1')
    expect(sync).toContain('构建于')
  })
})

describe('M4 来源详情 · 保留的业务行为（含 M3 工作台契约）', () => {
  it('没有来源定位的单元整块不渲染，不显示猜测值', () => {
    const { container } = render(<LessonSourceDetail lesson={lessonAt({ source: undefined })} />)
    expect(container.querySelector('.lesson-source')).toBeNull()
  })

  it('.lesson-source 内含「资料库」与核验状态；原文按需展开（工作台的既有断言）', () => {
    const { container } = render(<LessonSourceDetail lesson={lessonAt()} />)
    const source = container.querySelector('.lesson-source') as HTMLElement
    expect(source.textContent).toContain('外部未复核')
    expect(source.textContent).toContain('资料库')
    expect(source.querySelector('.md-view')).toBeNull()
    const toggle = screen.getByRole('button', { name: '查看主题原文' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.textContent).toBe('收起原文')
    expect(source.querySelector('.md-view h3')?.textContent).toBe('核心概念')
  })

  it('不在常规页面暴露资料库绝对路径，只给分册相对定位与指纹', () => {
    const { container } = render(<LessonSourceDetail lesson={lessonAt()} />)
    expect(container.textContent).not.toMatch(/[A-Za-z]:[\\/]/)
    expect(container.textContent).toContain('原文指纹 abcdef12')
  })
})

describe('M4 来源状态条 · 状态文案不改强 + 五块分区', () => {
  it('资料库就绪时显示五块，并声明逐单元状态不折算', () => {
    const { container } = render(
      <ContentProviderHost.Provider value={vaultContent}>
        <ContentSourceBanner />
      </ContentProviderHost.Provider>,
    )
    expect(container.querySelector('.content-source-banner')?.getAttribute('role')).toBe('status')
    const list = fields(container)
    expect(list.map((item) => item.key)).toEqual(FIVE_ZONES)
    expect(list[2]?.value).toContain('资料库已连接')
    expect(list[2]?.value).toContain('不折算')
    expect(list[4]?.value).toContain('正式内容 12 条')
    expect(container.textContent).not.toMatch(/已核实|已验证|完全可信/)
  })

  it('未连接时明确说明当前是旧内置课程，五块仍然齐备', () => {
    const { container } = render(
      <ContentProviderHost.Provider value={legacyContent}>
        <ContentSourceBanner />
      </ContentProviderHost.Provider>,
    )
    expect(container.textContent).toContain('当前显示的是')
    expect(container.textContent).toContain('旧内置课程')
    expect(container.textContent).toContain('未找到资料库目录')
    expect(fields(container).map((item) => item.key)).toEqual(FIVE_ZONES)
    expect(fields(container)[2]?.value).toContain('未经资料库侧核验，不显示为已核实')
  })

  it('校验未通过 / 使用旧快照两种状态各自保留原文案，不合并成「已同步」', () => {
    for (const [state, expected] of [
      ['stale', '资料库暂不可用，正在使用上次成功快照'],
      ['invalid', '上次同步未通过校验，仍使用上一个有效快照'],
      ['scanning', '正在扫描资料库'],
      ['validating', '正在校验内容'],
    ] as const) {
      const { container } = render(
        <ContentProviderHost.Provider value={{ ...legacyContent, state } as unknown as ContentContextValue}>
          <ContentSourceBanner />
        </ContentProviderHost.Provider>,
      )
      expect(container.textContent).toContain(expected)
      // 「不显示为已核实」是否定句，允许出现；单独宣称「已核实 / 已同步」不允许
      expect(container.textContent).not.toMatch(/(?<!不显示为)已核实|已同步/)
      cleanup()
    }
  })

  it('重试同步按钮走 content.sync，忙态文案不改语义', async () => {
    const sync = vi.fn(async () => ({ ok: true, message: '同步完成：仍在等待校验' }))
    const { container } = render(
      <ContentProviderHost.Provider value={{ ...legacyContent, sync } as unknown as ContentContextValue}>
        <ContentSourceBanner />
      </ContentProviderHost.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /重试同步/ }))
    expect(sync).toHaveBeenCalledTimes(1)
    await screen.findByText(/同步完成：仍在等待校验/)
    expect(container.textContent).not.toMatch(/同步成功，内容已核实/)
  })

  /**
   * §4 loading 行：改版前「正在读」这一档直接落进 warn 分支，说的是
   * 「当前显示的是旧内置课程」——读取中不等于旧课程，那句话在取数期间是错的。
   */
  it('§4 loading：读取中不宣布旧内置课程，五块仍在、结构同形', () => {
    const { container } = render(
      <ContentProviderHost.Provider value={{ ...legacyContent, loading: true } as unknown as ContentContextValue}>
        <ContentSourceBanner />
      </ContentProviderHost.Provider>,
    )
    const banner = container.querySelector('[data-cs-banner="loading"]')
    expect(banner).toBeTruthy()
    expect(banner?.getAttribute('role')).toBe('status')
    expect(banner?.getAttribute('aria-busy')).toBe('true')
    expect(banner?.textContent).toContain('正在读取教材目录')
    expect(banner?.textContent).toContain('读取完成前不宣布当前显示的是哪一套内容')
    // 关键：这一档不许出现「旧内置课程 / 未迁移」这类结论
    expect(banner?.textContent).not.toContain('旧内置课程')
    expect(banner?.textContent).not.toContain('未迁移到资料库')
    expect(fields(banner as HTMLElement).map((item) => item.key)).toEqual(FIVE_ZONES)
    expect(fields(banner as HTMLElement)[2]?.value).toContain('读取中：本轮没有核验结论')
    expect(fields(banner as HTMLElement)[4]?.value).toBe('无：读取完成前不给任何来源结论，也不用 0 或猜测值占位')
    expect((banner as HTMLElement).querySelector('.view-skeleton__shape')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('§4 loading：扫描 / 校验这两档也走读取中，不落进旧课程那一版', () => {
    for (const state of ['scanning', 'validating'] as const) {
      const { container } = render(
        <ContentProviderHost.Provider
          value={{ ...legacyContent, state, loading: false } as unknown as ContentContextValue}
        >
          <ContentSourceBanner />
        </ContentProviderHost.Provider>,
      )
      expect(container.querySelector('[data-cs-banner="loading"]')).toBeTruthy()
      expect(container.textContent).toContain(state === 'scanning' ? '正在扫描资料库' : '正在校验内容')
      expect(container.textContent).not.toContain('旧内置课程')
      cleanup()
    }
  })

  it('§4 disabled：同步忙态的按钮带 aria-disabled，并有一句说明条件的可见文字', async () => {
    let release: (value: { ok: boolean; message: string }) => void = () => {}
    const sync = vi.fn(() => new Promise<{ ok: boolean; message: string }>((res) => { release = res }))
    const { container } = render(
      <ContentProviderHost.Provider value={{ ...legacyContent, sync } as unknown as ContentContextValue}>
        <ContentSourceBanner />
      </ContentProviderHost.Provider>,
    )
    const button = screen.getByRole('button', { name: /重试同步/ })
    expect(button.hasAttribute('aria-disabled')).toBe(false)
    fireEvent.click(button)
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(1))

    const busyButton = screen.getByRole('button', { name: /同步中…/ })
    expect((busyButton as HTMLButtonElement).disabled).toBe(true)
    expect(busyButton.getAttribute('aria-disabled')).toBe('true')
    const hint = container.querySelector<HTMLElement>('.cs-disabled-hint')
    expect(hint?.getAttribute('role')).toBe('status')
    expect(hint?.textContent).toContain('现在按不了：上一次「重试同步」还没返回')
    expect(busyButton.getAttribute('aria-describedby')).toBe(hint?.id)
    release({ ok: true, message: '同步任务已提交' })
    await waitFor(() => expect((busyButton as HTMLButtonElement).disabled).toBe(false))
    expect(container.querySelector('.cs-disabled-hint')).toBeNull()
  })
})

describe('M4 来源区 · CSS 源码不变式', () => {
  it('样式表原文确实读到，且全局裸选择器数量为 0', () => {
    expect(cssText.length).toBeGreaterThan(3000)
    expect(selectorParts(cssCode).length).toBeGreaterThan(25)
    const bare = selectorParts(cssCode).filter(
      (selector) => !selector.startsWith('.cw-source') && !selector.startsWith('.reduce-motion'),
    )
    expect(bare).toEqual([])
  })

  it('不声明 :root / html / body；零 !important；发光走别名、无渐变玻璃；圆角只有令牌档', () => {
    const selectors = selectorParts(cssCode)
    expect(selectors.some((selector) => /(^|[\s,])(:root|html|body)(\s|,|$)/.test(selector))).toBe(false)
    expect(cssCode).not.toContain('!important')
    // 科技档反转（tokens §4.5）：发光代替黑投影承担层级；仍不许裸字面量。
    const shadows = [...cssCode.matchAll(/box-shadow:\s*([^;]+)/g)].map((m) => m[1]!.trim())
    for (const value of shadows) {
      expect(/^var\(--cs-glow-(near|panel|inset)\)$/.test(value), `未走发光令牌：${value}`).toBe(true)
    }
    expect(cssCode).not.toMatch(/backdrop-filter|linear-gradient|radial-gradient|conic-gradient|text-shadow/)
    expect(cssCode).not.toMatch(/border-radius:\s*[0-9]/)
    expect(cssCode).not.toMatch(/outline(-style)?:\s*(none|0)/)
  })

  it('每个 --ds-* 令牌消费都带兜底值', () => {
    expect(cssCode.match(/var\(--ds-[a-z0-9-]+\)/g) ?? []).toEqual([])
  })

  it('正文 16px、行高 1.6–1.75；长路径与长中文换行不撑破 320px', () => {
    const root = declarationBlock('.cw-source')
    expect(root).toContain('--cs-body: var(--ds-size-body, 16px)')
    const leading = Number(/--cs-leading:\s*var\(--ds-leading-body,\s*([\d.]+)\)/.exec(root)?.[1])
    expect(leading).toBeGreaterThanOrEqual(1.6)
    expect(leading).toBeLessThanOrEqual(1.75)
    expect(declarationBlock('.cw-source :is(dt, dd, p, span, strong, em, button)')).toContain('overflow-wrap: anywhere')
    expect(mediaBlock('max-width: 399px')).toContain('--cs-body: 15px')
    expect(mediaBlock('max-width: 679px')).toContain('grid-template-columns: minmax(0, 1fr)')
  })

  it('触控 44px 与焦点轮廓：按钮与可聚焦元素都覆盖', () => {
    expect(declarationBlock('.cw-source')).toContain('--cs-tap: var(--ds-tap-min, 44px)')
    expect(declarationBlock('.cw-source .cs-btn')).toContain('min-height: var(--cs-tap)')
    expect(declarationBlock('.cw-source :is(button, a, summary, [tabindex]):focus-visible')).toContain(
      'var(--ds-focus-ring, rgba(220, 233, 251, 0.72))',
    )
  })

  it('核验状态的两档靠边框样式区分，不使用场景色或状态色', () => {
    expect(declarationBlock('.cw-source .cs-mark--verified')).toContain('border-style: solid')
    expect(declarationBlock('.cw-source .cs-mark--unverified')).toContain('border-style: dotted')
    expect(declarationBlock('.cw-source .cs-mark--unverified .cs-mark-text')).toContain('text-decoration-style: dotted')
    for (const selector of ['.cw-source .cs-mark--verified', '.cw-source .cs-mark--unverified']) {
      expect(declarationBlock(selector)).not.toMatch(/var\(--cs-accent\)|var\(--c-|var\(--ds-status-/)
    }
  })

  it('§4 disabled 行：忙态按钮不靠降透明度，改用虚线描边 + 一句可见的条件说明', () => {
    const btn = declarationBlock('.cw-source .cs-btn:disabled')
    expect(btn).toMatch(/opacity:\s*1/)          // 顶回共享层 styles.css 的 opacity:.5
    expect(btn).toMatch(/border-style:\s*dashed/)
    expect(btn).toMatch(/cursor:\s*not-allowed/)
    // 说明句是渲染出来的文字（有正文字号档），不是 title 提示
    const hint = declarationBlock('.cw-source .cs-disabled-hint')
    expect(hint).toContain('color: var(--cs-dim)')
    expect(hint).toContain('font-size: var(--cs-meta)')
  })

  it('§4 loading 行：读取中这一档不给 ok / warn 的结论色', () => {
    const loading = declarationBlock('.cw-source.content-source-banner.loading')
    expect(loading).toContain('color: var(--cs-dim)')
    expect(loading).not.toMatch(/var\(--c-|var\(--ds-status-/)
  })

  it('本页零持续动画，两条降级通道都真停止', () => {    expect(cssCode).not.toMatch(/animation[^;]*\binfinite\b/)
    expect(cssCode).not.toMatch(/@keyframes/)
    const system = mediaBlock('prefers-reduced-motion: reduce')
    expect(system).toContain('animation: none')
    expect(system).toContain('transition: none')
    expect(
      declarationBlock(
        '.reduce-motion .cw-source, .reduce-motion .cw-source *, .reduce-motion .cw-source *::before, .reduce-motion .cw-source *::after',
      ),
    ).toContain('animation: none')
  })
})

describe('M4 来源区 · 无障碍（axe-core）', () => {
  it('specs 五块 + 展开原文按钮无 axe 违规', async () => {
    const { container } = render(
      <ContentProviderHost.Provider value={vaultContent}>
        <ContentSourceBanner />
        <LessonSourceDetail lesson={lessonAt()} />
      </ContentProviderHost.Provider>,
    )
    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false }, 'target-size': { enabled: false } },
    })
    expect(results.violations.map((violation) => violation.id)).toEqual([])
  })
})
