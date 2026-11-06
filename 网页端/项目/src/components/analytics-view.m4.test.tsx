// @vitest-environment jsdom
/**
 * M4 全站统一 · 学习分析契约测试（01 号方案 §3.4「不把指标图表装饰成掌握结论」+ §8 验收清单）
 *
 * 重点是**诚实指标保护**：
 * 1. 样本不足时逐字保留「样本不足：近 7 天还没有复测记录…」，且整页不出现任何
 *    伪造的百分号；
 * 2. 完成率出现时必须同时给出真实分母（通过 / 全部复测），口径写在同一行；
 * 3. 没有可复现分母的指标显示「无分母，不折算百分比」，不拿计数冒充比率；
 * 4. 学习时长与到期任务完成率保持「未统计」（STAT-01 第 4/6 条），不用活动次数推算。
 * 结构上验证 ledger 细线表格语义（caption / th[scope]）与 CSS 源码不变式。
 */
import { cleanup, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsView } from './analytics-view'
import type { WeeklyStats } from '../utils/analytics'

/* ────────────────── CSS 原文（vitest 不处理 CSS，只能读盘核对） ────────────────── */

const fsSpecifier: string = 'node:fs'
const { readFileSync } = (await import(fsSpecifier)) as { readFileSync: (path: string, encoding: 'utf8') => string }
const pathSpecifier: string = 'node:path'
const { resolve } = (await import(pathSpecifier)) as { resolve: (...parts: string[]) => string }
const procSpecifier: string = 'node:process'
const { cwd } = (await import(procSpecifier)) as { cwd: () => string }

const cssText = readFileSync(resolve(cwd(), 'src/components/analytics-view.css'), 'utf8')
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

const stats = (overrides: Partial<WeeklyStats> = {}): WeeklyStats => ({
  lessonsCompleted: 2,
  lessonPracticeCount: 5,
  challengesPassed: 1,
  challengesLegacyPassed: 0,
  reviewsPassed: 3,
  reviewsFailed: 1,
  reviewRate: 75,
  periodStartKey: '2026-09-14',
  todayKey: '2026-09-20',
  ...overrides,
})

function renderView(overrides: Partial<WeeklyStats> = {}, checkin = { streak: 4, checkedInToday: true }) {
  render(<AnalyticsView stats={stats(overrides)} streak={checkin.streak} checkedInToday={checkin.checkedInToday} />)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('M4 学习分析 · ledger 表格语义（§5.2 第六行）', () => {
  it('三块指标都是真表格，caption 写明内容与统计窗口', () => {
    renderView()
    const tables = document.querySelectorAll('table.an-ledger')
    expect(tables).toHaveLength(3)
    expect(tables[0]?.querySelector('caption')?.textContent).toBe(
      '近 7 天学习活动指标，共 6 项，窗口 2026-09-14 至 2026-09-20',
    )
    expect(tables[1]?.querySelector('caption')?.textContent).toContain('复测完成率与到期任务完成率，共 2 项')
    expect(tables[2]?.querySelector('caption')?.textContent).toContain('连续打卡与今日状态，共 3 项')
    for (const table of tables) expect(table.querySelector('caption')?.className).toContain('an-sr-only')
  })

  it('每张台账住在一个可 Tab 到、有名字的横向滚动区里，且 CSS 给了指标名列下限', () => {
    renderView()
    const tables = [...document.querySelectorAll<HTMLTableElement>('table.an-ledger')]
    expect(tables).toHaveLength(3)
    for (const table of tables) {
      const wrap = table.parentElement
      expect(wrap?.className).toBe('an-table-scroll')
      expect(wrap?.getAttribute('tabindex')).toBe('0')
      expect(wrap?.getAttribute('role')).toBe('region')
      expect(wrap?.getAttribute('aria-label')).toContain('可横向滚动')
    }
    // 320 档实测「指标名」列被挤到 37px（页面不溢出但一个字一行）——下限与滚动区都得在
    expect(cssCode).toMatch(/\.cw-analytics \.an-table-scroll\s*\{[^}]*overflow-x:\s*auto/)
    const narrow = cssCode.slice(cssCode.indexOf('@media (max-width: 679px)'))
    expect(narrow).toMatch(/\.cw-analytics \.an-ledger\s*\{[^}]*min-width:\s*6[0-9]{2}px/)
    expect(narrow).toMatch(/\.cw-analytics \.an-cell-name\s*\{[^}]*min-width:\s*1[0-9]em/)
    // #95 普查实测「分母」列 109px≈7.3 字/行：口径与分母两列同样要地板
    expect(narrow).toMatch(
      /\.cw-analytics \.an-cell-basis,\s*\.cw-analytics \.an-cell-den\s*\{[^}]*min-width:\s*1[0-9]em/,
    )
    // 地板用 em 写就得把换算基数钉住：这两列走 --an-meta，窄档 12px ⇒ 11em = 132px ≥ 120px
    expect(mediaBlock('max-width: 399px')).toMatch(/--an-meta:\s*12px/)
    expect(cssCode).toMatch(/\.cw-analytics \.an-cell-basis,\s*\.cw-analytics \.an-cell-den\s*\{[^}]*--an-meta/)
  })

  it('列表头含「分母」列，行表头是编号', () => {
    renderView()
    const table = document.querySelector('table.an-ledger') as HTMLTableElement
    expect([...table.querySelectorAll('thead th[scope="col"]')].map((th) => th.textContent)).toEqual([
      '次',
      '指标',
      '数值',
      '派生口径',
      '分母',
    ])
    expect([...table.querySelectorAll('tbody th[scope="row"]')].map((th) => th.textContent)).toEqual([
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
    ])
  })

  it('分组编号 01/02/03 成文，层次不靠卡片', () => {
    renderView()
    expect([...document.querySelectorAll('.an-block-idx')].map((el) => el.textContent)).toEqual(['01', '02', '03'])
    expect(document.querySelectorAll('.an-block')).toHaveLength(3)
  })
})

describe('M4 学习分析 · 诚实指标（真实分母 / 样本不足 / 未统计）', () => {
  it('样本不足时逐字保留原有说明，且整页不出现任何百分比', () => {
    renderView({ reviewsPassed: 0, reviewsFailed: 0, reviewRate: null })
    expect(
      screen.getByText('样本不足：近 7 天还没有复测记录。完成课程后按计划复测，这里会出现完成率。'),
    ).toBeTruthy()
    const value = [...document.querySelectorAll('.an-row')].find((row) => row.textContent?.includes('复测完成率'))
    expect(value?.querySelector('.an-cell-value')?.textContent).toBe('样本不足')
    expect(document.body.textContent).not.toContain('%')
  })

  it('完成率出现时同一条给出真实分母（通过 / 全部复测），不是孤立的百分数', () => {
    renderView({ reviewsPassed: 3, reviewsFailed: 1, reviewRate: 75 })
    const row = [...document.querySelectorAll('.an-row')].find((item) => item.textContent?.includes('复测完成率'))
    expect(row?.querySelector('.an-cell-value')?.textContent).toBe('75%')
    expect(row?.querySelector('.an-cell-den')?.textContent).toBe(
      '全部复测 4 次（通过 3 · 未通过 1）',
    )
    expect(row?.querySelector('.an-cell-basis')?.textContent).toContain('通过 /（通过 + 未通过）')
  })

  it('没有可复现分母的指标显示「无分母，不折算百分比」', () => {
    renderView()
    const noDen = [...document.querySelectorAll('.an-no-den')]
    expect(noDen.length).toBeGreaterThanOrEqual(4)
    expect(noDen.every((node) => node.textContent === '无分母，不折算百分比')).toBe(true)
    // 挑战通过数只有计数、没有窗口内尝试次数分母，因此不显示比率
    const challengeRow = [...document.querySelectorAll('.an-row')].find((item) =>
      item.textContent?.includes('挑战通过（本机已验证）'),
    )
    expect(challengeRow?.querySelector('.an-cell-value')?.textContent).toBe('1')
    expect(challengeRow?.querySelector('.an-cell-den')?.textContent).toContain('无分母')
  })

  it('学习时长与到期任务完成率保持「未统计」，不用活动次数推算', () => {
    renderView()
    const untranslated = [...document.querySelectorAll('.an-cell-value')]
      .filter((cell) => cell.textContent === '未统计')
      .map((cell) => cell.closest('.an-row')?.querySelector('.an-cell-name')?.textContent)
    expect(untranslated).toContain('学习时长（近 7 天）')
    expect(untranslated).toContain('到期任务完成率')
    expect(screen.getByText('学习时长按 STAT-01 第 6 条保持「未统计」：本机没有时长数据源，不用活动次数推算。')).toBeTruthy()
  })

  /**
   * 01 号方案 §4 的 empty 行：说明为空的原因**和下一步动作**。
   * 改版前这三格只有「样本不足 / 未统计」+ 原因，看完不知道该做什么。
   */
  it('§4 empty：样本不足与未统计三格都给出下一步，且不引入任何百分比或新口径', () => {
    renderView({ reviewsPassed: 0, reviewsFailed: 0, reviewRate: null })
    const actions = [...document.querySelectorAll('.an-cell-action')].map((node) => node.textContent ?? '')
    expect(actions).toHaveLength(3)
    expect(actions.every((text) => text.startsWith('下一步：'))).toBe(true)
    const rateRow = [...document.querySelectorAll('.an-row')].find((row) => row.textContent?.includes('复测完成率'))
    expect(rateRow?.querySelector('.an-cell-action')?.textContent).toContain('到复习中心完成一次复测')
    const dueRow = [...document.querySelectorAll('.an-row')].find((row) => row.textContent?.includes('到期任务完成率'))
    expect(dueRow?.querySelector('.an-cell-action')?.textContent).toContain('不提供手填任务数的入口')
    const durationRow = [...document.querySelectorAll('.an-row')].find((row) => row.textContent?.includes('学习时长（近 7 天）'))
    expect(durationRow?.querySelector('.an-cell-action')?.textContent).toContain('不拿活动次数折算时长')
    // 下一步的话术不许把「未统计」变成另一种指标：整页仍然没有百分比
    expect(document.body.textContent).not.toContain('%')
    // 比率出现时不再催用户去复测（那一档不是空态）；另外两格的「未统计」照旧带下一步
    cleanup()
    renderView({ reviewsPassed: 3, reviewsFailed: 1, reviewRate: 75 })
    const rateRowAfter = [...document.querySelectorAll('.an-row')].find((row) => row.textContent?.includes('复测完成率'))
    expect(rateRowAfter?.querySelector('.an-cell-action')).toBeNull()
    expect(document.querySelectorAll('.an-cell-action').length).toBe(2)
  })

  it('旧版迁移口径的通过数单列一行，不混入本机已验证的通过', () => {
    renderView({ challengesPassed: 2, challengesLegacyPassed: 3 })
    expect(screen.getByText('挑战通过（旧版迁移口径）')).toBeTruthy()
    const legacy = [...document.querySelectorAll('.an-row')].find((item) =>
      item.textContent?.includes('挑战通过（旧版迁移口径）'),
    )
    expect(legacy?.querySelector('.an-cell-value')?.textContent).toBe('3')
    expect(legacy?.querySelector('.an-cell-basis')?.textContent).toContain('不混入上一行')
  })

  it('完成单元与练习次数是两个口径，各自成行且分母同源', () => {
    renderView({ lessonsCompleted: 2, lessonPracticeCount: 5 })
    const dedup = [...document.querySelectorAll('.an-row')].find((item) => item.textContent?.includes('完成课程单元'))
    const practice = [...document.querySelectorAll('.an-row')].find((item) => item.textContent?.includes('课程练习次数'))
    expect(dedup?.querySelector('.an-cell-value')?.textContent).toBe('2')
    expect(practice?.querySelector('.an-cell-value')?.textContent).toBe('5')
    expect(practice?.querySelector('.an-cell-basis')?.textContent).toContain('两个口径')
  })

  it('统计周期整句逐字保留，打卡事实按本地日期判定', () => {
    renderView({}, { streak: 0, checkedInToday: false })
    expect(screen.getByText('统计周期：近 7 天（2026-09-14 至 2026-09-20，按学习证据时间）。')).toBeTruthy()
    expect(screen.getByText('未打卡')).toBeTruthy()
    const streakRow = [...document.querySelectorAll('.an-row')].find((item) =>
      item.textContent?.includes('连续打卡天数'),
    )
    expect(streakRow?.querySelector('.an-cell-value')?.textContent).toBe('0')
  })
})

describe('M4 学习分析 · CSS 源码不变式', () => {
  it('样式表原文确实读到，且全局裸选择器数量为 0', () => {
    expect(cssText.length).toBeGreaterThan(3000)
    expect(selectorParts(cssCode).length).toBeGreaterThan(30)
    const bare = selectorParts(cssCode).filter(
      (selector) => !selector.startsWith('.cw-analytics') && !selector.startsWith('.reduce-motion'),
    )
    expect(bare).toEqual([])
  })

  it('不声明 :root / html / body，不覆写别人页面的类', () => {
    const selectors = selectorParts(cssCode)
    expect(selectors.some((selector) => /(^|[\s,])(:root|html|body)(\s|,|$)/.test(selector))).toBe(false)
  })

  it('零 !important；发光走别名、无渐变玻璃；圆角只有令牌档', () => {
    expect(cssCode).not.toContain('!important')
    // 科技档反转（tokens §4.5）：发光代替黑投影承担层级；仍不许裸字面量。
    const shadows = [...cssCode.matchAll(/box-shadow:\s*([^;]+)/g)].map((m) => m[1]!.trim())
    for (const value of shadows) {
      expect(/^var\(--an-glow-(near|panel|inset)\)$/.test(value), `未走发光令牌：${value}`).toBe(true)
    }
    expect(cssCode).not.toMatch(/backdrop-filter|linear-gradient|radial-gradient|conic-gradient|text-shadow/)
    expect(cssCode).not.toMatch(/border-radius:\s*[0-9]/)
    expect(cssCode).not.toMatch(/outline(-style)?:\s*(none|0)/)
  })

  it('每个 --ds-* 令牌消费都带兜底值', () => {
    expect(cssCode.match(/var\(--ds-[a-z0-9-]+\)/g) ?? []).toEqual([])
  })

  it('正文 16px、行高 1.6–1.75，长中文换行不撑破表格', () => {
    const root = declarationBlock('.cw-analytics')
    expect(root).toContain('--an-body: var(--ds-size-body, 16px)')
    const leading = Number(/--an-leading:\s*var\(--ds-leading-body,\s*([\d.]+)\)/.exec(root)?.[1])
    expect(leading).toBeGreaterThanOrEqual(1.6)
    expect(leading).toBeLessThanOrEqual(1.75)
    expect(declarationBlock('.cw-analytics :is(h1, h2, p, span, dt, dd, td, th, caption)')).toContain(
      'overflow-wrap: anywhere',
    )
    expect(cssCode.match(/white-space:\s*nowrap/g)?.length ?? 0).toBeLessThanOrEqual(1)
  })

  it('焦点轮廓可见、触控 44px 令牌就位（本页无按钮，行仍按 tap 档留白）', () => {
    expect(declarationBlock('.cw-analytics')).toContain('--an-tap: var(--ds-tap-min, 44px)')
    expect(declarationBlock('.cw-analytics :is(button, a, summary, [tabindex]):focus-visible')).toContain(
      'var(--ds-focus-ring, rgba(220, 233, 251, 0.72))',
    )
  })

  it('320px 最小宽度有专门降级规则', () => {
    expect(mediaBlock('max-width: 399px')).toContain('padding-left: var(--ds-space-10, 10px)')
    expect(cssCode).toContain('min-width: 0')
    expect(mediaBlock('max-width: 679px')).toContain('table-layout: auto')
  })

  it('本页零持续动画，且两条降级通道都真停止', () => {
    expect(cssCode).not.toMatch(/animation[^;]*\binfinite\b/)
    expect(cssCode).not.toMatch(/@keyframes/)
    const system = mediaBlock('prefers-reduced-motion: reduce')
    expect(system).toContain('.cw-analytics')
    expect(system).toContain('animation: none')
    expect(system).toContain('transition: none')
    expect(
      declarationBlock(
        '.reduce-motion .cw-analytics, .reduce-motion .cw-analytics *, .reduce-motion .cw-analytics *::before, .reduce-motion .cw-analytics *::after',
      ),
    ).toContain('animation: none')
  })
})

describe('M4 学习分析 · 无障碍（axe-core）', () => {
  it('三张指标表格无 axe 违规', async () => {
    const { container } = render(
      <AnalyticsView stats={stats({ reviewsPassed: 0, reviewsFailed: 0, reviewRate: null })} streak={0} checkedInToday={false} />,
    )
    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false }, 'target-size': { enabled: false } },
    })
    expect(results.violations.map((violation) => violation.id)).toEqual([])
  })
})
