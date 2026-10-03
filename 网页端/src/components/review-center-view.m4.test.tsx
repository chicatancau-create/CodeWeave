// @vitest-environment jsdom
/**
 * M4 全站统一 · 复习中心契约测试（01 号方案 §3.4 复习页 + §2.2 末段语义色 + §8 验收清单）
 *
 * 四组断言：
 * 1. ledger 表格语义：真 `<table>` + `<caption>` + `th[scope]`，到期分组靠编号与发丝线；
 * 2. 业务行为无回归：自评回顾（通过/未通过）、稍后提醒（写出实际日期）、查看原课程、空状态文案；
 * 3. 诚实指标：分母可复现（合计行、节点分母取 REVIEW_OFFSET_DAYS.length），
 *    「已逾期」「上次未通过」等原有语义文案逐字保留；
 * 4. CSS 源码不变式：jsdom 不做层叠与布局，故按样式表原文核对（与
 *    learning-path-view.m3.test.tsx 同一口径）——零全局裸选择器、零 !important、
 *    无泛光/渐变/玻璃、正文 16px、触控 44px、两条降级通道真停止。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { ReviewCenterView } from './review-center-view'
import { ContentProviderHost, type ContentContextValue } from '../content/provider'
import { REVIEW_OFFSET_DAYS, type MasteryRecord } from '../data/mastery'

/* ────────────────── CSS 原文（vitest 不处理 CSS，只能读盘核对） ────────────────── */

const fsSpecifier: string = 'node:fs'
const { readFileSync } = (await import(fsSpecifier)) as { readFileSync: (path: string, encoding: 'utf8') => string }
const pathSpecifier: string = 'node:path'
const { resolve } = (await import(pathSpecifier)) as { resolve: (...parts: string[]) => string }
const procSpecifier: string = 'node:process'
const { cwd } = (await import(procSpecifier)) as { cwd: () => string }

const cssText = readFileSync(resolve(cwd(), 'src/components/review-center-view.css'), 'utf8')
const cssCode = cssText.replace(/\/\*[\s\S]*?\*\//g, '')

/** 括号感知的顶层逗号拆分：`:is(a, b)` 内部的逗号不算选择器分隔符。 */
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

/** 全部真实样式规则的选择器片段（跳过 @media/@keyframes 头）。 */
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
    // 整条选择器列表精确匹配，或列表里的单个片段匹配
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

const record = (overrides: Partial<MasteryRecord> = {}): MasteryRecord => ({
  refId: 'lesson-s0-1',
  kind: 'lesson',
  level: 3,
  evidence: [
    { id: 'e1', kind: 'lesson', refId: 'lesson-s0-1', note: '完成单元', at: '2026-09-10T02:00:00.000Z', passed: true },
  ],
  updatedAt: '2026-09-10T02:00:00.000Z',
  reviewDueKey: '2026-09-17',
  reviewStep: 1,
  ...overrides,
})

const titles = {
  'lesson-s0-1': '开发环境清点',
  'lesson-s1-2': '函数与返回值',
  'lesson-s2-3': '并发模型',
  'stage-S3': 'S3 阶段复测',
}

function renderView(
  groups: Partial<Parameters<typeof ReviewCenterView>[0]['groups']> = {},
  // 回调槽位显式按 mock 类型声明：若写成 Partial<组件 props>，展开后 onReview 会退化成
  // 「真实函数类型 | Mock」的联合，`.mock.calls` 在 tsc 下不可访问（vitest 不做类型检查，
  // 所以这条只有跑 tsc -b 才暴露）。
  overrides: {
    groups?: Parameters<typeof ReviewCenterView>[0]['groups']
    onReview?: Mock
    onSnooze?: Mock
    onOpenLesson?: Mock
  } = {},
) {
  const props = {
    groups: {
      overdue: [] as MasteryRecord[],
      today: [] as MasteryRecord[],
      upcoming: [] as MasteryRecord[],
      next: null as { dateKey: string; record: MasteryRecord } | null,
      ...groups,
    },
    titles,
    // REVIEW-01：「这是不是一门课」与「顺延到哪天」都由数据给，组件不再自己猜。
    lessonIds: ['lesson-s0-1', 'lesson-s1-2', 'lesson-s2-3'],
    todayKey: '2026-09-20',
    onReview: vi.fn(),
    onSnooze: vi.fn(),
    onOpenLesson: vi.fn(),
    ...overrides,
  }
  render(<ReviewCenterView {...props} />)
  return props
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('M4 复习中心 · ledger 表格语义（§5.2 第六行）', () => {
  it('三组各是一张真细线表格，caption 说明组名与条数', () => {
    renderView({
      overdue: [record()],
      today: [record({ refId: 'lesson-s1-2', reviewDueKey: '2026-09-20' })],
      upcoming: [record({ refId: 'lesson-s2-3', reviewDueKey: '2026-09-24' })],
    })
    const tables = document.querySelectorAll('table.rv-ledger')
    expect(tables).toHaveLength(3)
    const captions = [...tables].map((table) => table.querySelector('caption')?.textContent)
    expect(captions).toEqual([
      '逾期复习清单，共 1 项（超过计划日期仍未复测，优先处理）',
      '今日到期复习清单，共 1 项（按 1/3/7/14/30 天计划今天应复测）',
      '未来 7 天复习清单，共 1 项（即将到期的复测）',
    ])
    for (const table of tables) {
      expect(table.querySelector('caption')?.className).toContain('rv-sr-only')
    }
  })

  it('列表头与行表头齐备：每行由 th[scope=row] 的编号担任行头', () => {
    renderView({ overdue: [record(), record({ refId: 'lesson-s1-2' })] })
    const table = document.querySelector('table.rv-ledger') as HTMLTableElement
    const cols = [...table.querySelectorAll('thead th[scope="col"]')].map((th) => th.textContent)
    expect(cols).toEqual(['次', '复习项', '掌握等级', '复测计划', '到期状态', '操作'])
    const rows = [...table.querySelectorAll('tbody th[scope="row"]')]
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toBe('01')
    expect(rows[1]?.textContent).toBe('02')
  })

  it('分组层次靠编号 01/02/03 与发丝线，不靠卡片：块标题带编号与计数分母', () => {
    renderView({
      overdue: [record()],
      upcoming: [record({ refId: 'lesson-s2-3', reviewDueKey: '2026-09-24' })],
    })
    const headings = [...document.querySelectorAll('.rv-block-heading')]
    expect(headings).toHaveLength(2)
    expect(headings[0]?.querySelector('.rv-block-idx')?.textContent).toBe('01')
    expect(headings[1]?.querySelector('.rv-block-idx')?.textContent).toBe('03')
    expect(headings[0]?.querySelector('.rv-block-note')?.textContent).toContain('1 / 2 项')
  })

  it('到期状态是「固定字符徽记 + 文字」双通道，徽记不进读屏顺序', () => {
    renderView({
      overdue: [record()],
      today: [record({ refId: 'lesson-s1-2', reviewDueKey: '2026-09-20' })],
      upcoming: [record({ refId: 'lesson-s2-3', reviewDueKey: '2026-09-24' })],
    })
    const marks = [...document.querySelectorAll<HTMLElement>('.rv-row .rv-mark')]
    expect(marks.map((mark) => mark.getAttribute('data-rv-mark'))).toEqual(['overdue', 'today', 'upcoming'])
    for (const mark of marks) {
      const glyph = mark.querySelector('.rv-mark-glyph')
      const text = mark.querySelector('.rv-mark-text')
      expect(glyph?.getAttribute('aria-hidden')).toBe('true')
      expect((text?.textContent ?? '').length).toBeGreaterThan(1)
    }
    expect(marks[0]?.querySelector('.rv-mark-text')?.textContent).toBe('已逾期')
  })

  it('每张台账都住在一个可 Tab 到、有名字的横向滚动区里（§5.4 320px 不撑破页面）', () => {
    renderView({
      overdue: [record()],
      today: [record({ refId: 'lesson-s1-2', reviewDueKey: '2026-09-20' })],
      upcoming: [record({ refId: 'lesson-s2-3', reviewDueKey: '2026-09-24' })],
    })
    const tables = [...document.querySelectorAll<HTMLTableElement>('table.rv-ledger')]
    expect(tables.length).toBe(3)
    for (const table of tables) {
      const wrap = table.parentElement
      expect(wrap?.className).toBe('rv-table-scroll')
      // 滚动容器必须键盘可达：拿不到焦点的滚动区会把列藏在够不着的地方
      expect(wrap?.getAttribute('tabindex')).toBe('0')
      expect(wrap?.getAttribute('role')).toBe('region')
      expect(wrap?.getAttribute('aria-label')).toContain('可横向滚动')
    }
    // 表本体不再靠压列宽迁就视口：窄屏有可读下限（320 档实测挤到 24px 就是没有这条时的样子）
    expect(cssCode).toMatch(/\.cw-review \.rv-table-scroll\s*\{[^}]*overflow-x:\s*auto/)
    const narrow = cssCode.slice(cssCode.indexOf('@media (max-width: 679px)'))
    expect(narrow).toMatch(/\.cw-review \.rv-ledger\s*\{[^}]*min-width:\s*4[0-9]{2}px/)
  })
})

describe('M4 复习中心 · 业务行为无回归', () => {
  it('开始自评回顾展开判定按钮，未通过上抛 passed=false', () => {
    const props = renderView({ overdue: [record()] })
    fireEvent.click(screen.getByRole('button', { name: '开始自评回顾' }))
    fireEvent.click(screen.getByRole('button', { name: '未通过' }))
    expect(props.onReview).toHaveBeenCalledTimes(1)
    expect(props.onReview.mock.calls[0]?.[1]).toBe(false)
  })

  it('通过按钮上抛 true，并带原记录对象', () => {
    const props = renderView({ today: [record({ refId: 'lesson-s1-2' })] })
    fireEvent.click(screen.getByRole('button', { name: '开始自评回顾' }))
    fireEvent.click(screen.getByRole('button', { name: '通过' }))
    expect(props.onReview).toHaveBeenCalledTimes(1)
    expect(props.onReview.mock.calls[0]?.[1]).toBe(true)
    expect(props.onReview.mock.calls[0]?.[0]).toMatchObject({ refId: 'lesson-s1-2' })
  })

  it('稍后提醒按 refId 上抛；查看原课程仍走 onOpenLesson', () => {
    const props = renderView({ today: [record({ refId: 'lesson-s1-2' })] })
    fireEvent.click(screen.getByRole('button', { name: /稍后提醒/ }))
    expect(props.onSnooze).toHaveBeenCalledWith('lesson-s1-2')
    fireEvent.click(screen.getByRole('button', { name: /查看原课程/ }))
    expect(props.onOpenLesson).toHaveBeenCalledWith('lesson-s1-2')
  })

  /**
   * 这条改的是**改版前写反的口径**，不是保真断言。
   *
   * 旧实现 `isLesson = tone !== 'overdue' && !refId.startsWith('stage-')` 把「逾期」整组排除在外，
   * 于是最需要回到原课的逾期项反而没有「查看原课程」；而 REVIEW-01 第 2 条要求的正是
   * 「按显式实体类型或数据查找确定，不能由逾期状态和 ID 前缀猜测」。
   * 现在按 `lessonIds`（当前真实存在的课程单元）判：逾期课程给入口，阶段复测不给。
   */
  it('查看原课程按数据判定：逾期课程照样可打开，阶段复测不给入口', () => {
    renderView({
      overdue: [record()],
      today: [record({ refId: 'stage-S3', reviewDueKey: '2026-09-20' })],
    })
    const open = screen.getAllByRole('button', { name: /查看原课程/ })
    expect(open).toHaveLength(1)
    expect(open[0]?.closest('tr')?.getAttribute('data-ref-id')).toBe('lesson-s0-1')
    expect(screen.getByText('逾期')).toBeTruthy()
  })

  it('稍后提醒把实际顺延到的那一天写在按钮上，与 mastery 的调度规则同源', () => {
    renderView({
      overdue: [record({ reviewDueKey: '2026-09-18' })],
      today: [record({ refId: 'lesson-s1-2', reviewDueKey: '2026-09-20' })],
    })
    const labels = [...document.querySelectorAll('.rv-snooze-date')].map((el) => el.textContent)
    // todayKey=2026-09-20：逾期那条从「今天」起算 → 09-21；今天到期那条同样 +1 天。
    expect(labels).toEqual(['到 2026-09-21', '到 2026-09-21'])
  })

  it('已排到未来的复测，顺延是在它自己的计划日之后，而不是今天之后', () => {
    renderView({ upcoming: [record({ refId: 'lesson-s2-3', reviewDueKey: '2026-09-27' })] })
    expect(document.querySelector('.rv-snooze-date')?.textContent).toBe('到 2026-09-28')
  })

  it('复测是自评：按钮写明「自评回顾」，记完一条就退出答题态并留到下一次计划', () => {
    const onReview = vi.fn()
    renderView({ today: [record({ refId: 'lesson-s1-2', reviewDueKey: '2026-09-20' })] }, { onReview })
    const start = screen.getByRole('button', { name: '开始自评回顾' })
    expect(start).toBeTruthy()
    fireEvent.click(start)
    fireEvent.click(screen.getByRole('button', { name: '通过' }))
    expect(onReview).toHaveBeenCalledTimes(1)
    expect(onReview.mock.calls[0]?.[1]).toBe(true)
    // 判完回到非答题态：不能一直停在 通过/未通过 两枚按钮上
    expect(screen.getByRole('button', { name: '开始自评回顾' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '未通过' })).toBeNull()
  })

  it('上次未通过原因与计划日期逐条保留（原有语义文案未被吃掉）', () => {
    renderView({ overdue: [record({ lastFailReason: '忘记参数顺序' })] })
    expect(screen.getByText('上次未通过：忘记参数顺序')).toBeTruthy()
    expect(screen.getByText('计划复测 2026-09-17')).toBeTruthy()
    // 「已逾期」在分组标题与每一行各出现一次（标题与行都是双通道标识）
    expect(document.querySelector('.rv-row .rv-mark-text')?.textContent).toBe('已逾期')
    expect(screen.getAllByText('已逾期')).toHaveLength(2)
  })
})

describe('M4 复习中心 · 空状态与真实分母', () => {
  it('完全没有安排时保留原有空态说明，不显示任何表格', () => {
    renderView()
    expect(screen.getByText('当前没有任何计划的复测。完成课程单元后会自动按计划安排。')).toBeTruthy()
    expect(document.querySelectorAll('table.rv-ledger')).toHaveLength(0)
    expect(document.querySelector('.rv-footnote')).toBeNull()
  })

  /**
   * REVIEW-01 第 3 条：远期任务不许被说成不存在。
   * 改版前的判据是「7 天窗口里没条目 + 今天没到期」就写「当前没有任何计划的复测」，
   * 而 `groups.next` 看的是**任何**晚于今天的排期——排在第 14 天的复测就这样被抹掉了。
   */
  it('排在 7 天窗口之外时，说的是下一次日期而不是「没有任何计划」', () => {
    const far = record({ refId: 'lesson-s2-3', reviewDueKey: '2026-10-04' })
    renderView({ next: { dateKey: '2026-10-04', record: far } })
    expect(screen.getByText(/今天没有到期的复测。下一次：2026-10-04（并发模型）/)).toBeTruthy()
    expect(screen.queryByText('当前没有任何计划的复测。完成课程单元后会自动按计划安排。')).toBeNull()
  })

  it('今日无到期时说明下一次日期与标题（原文案语义保留）', () => {
    const upcoming = record({ refId: 'lesson-s2-3', reviewDueKey: '2026-09-24' })
    renderView({ upcoming: [upcoming], next: { dateKey: '2026-09-24', record: upcoming } })
    expect(screen.getByText(/今天没有到期的复测。下一次：2026-09-24（并发模型）/)).toBeTruthy()
  })

  it('页脚只把「已安排复测」的记录计入分母，未安排的不冒充样本', () => {
    renderView({
      overdue: [record()],
      today: [record({ refId: 'lesson-s1-2', reviewDueKey: '2026-09-20' })],
      upcoming: [record({ refId: 'lesson-s2-3', reviewDueKey: '2026-09-24' })],
    })
    const foot = document.querySelector('.rv-footnote')?.textContent ?? ''
    expect(foot).toContain('逾期 1 项')
    expect(foot).toContain('今日 1 项')
    expect(foot).toContain('未来 7 天 1 项')
    expect(foot).toContain('合计 3 项')
    expect(foot).toContain('没有到期安排的记录不计入任何分母')
    expect(screen.getByText('待复测 2 项 · 未来 7 天 1 项')).toBeTruthy()
  })

  it('复测节点分母取本机排期数组长度，并显式标注是本机口径', () => {
    renderView({ overdue: [record({ reviewStep: 2 })] })
    const plan = document.querySelector('.rv-cell-plan')?.textContent ?? ''
    expect(plan).toContain(`复测节点 3 / ${REVIEW_OFFSET_DAYS.length}`)
    expect(plan).toContain('按本机排期：学完后第 1、3、7、14、30 天各一次')
  })

  it('掌握等级带 0—6 的真实上限与证据条数', () => {
    renderView({ overdue: [record({ level: 4 })] })
    expect(screen.getByText('能教别人')).toBeTruthy()
    expect(screen.getByText('等级 4 / 6 · 证据 1 条')).toBeTruthy()
  })
})

describe('M4 复习中心 · §4 状态矩阵的 loading / error 两档（排期口径的来源）', () => {
  /**
   * 本页的复测节点表有三个来源（本单元覆盖 → 资料库发布规则 → 本机兜底），
   * 中间那一档要等教材目录读回来才有：改版前这一段既没有 loading 也没有 error，
   * 「正在读」与「读失败」都说成「按本机排期」，用户既看不出是临时的也找不到重试。
   * Provider 缺席（上面所有用例）时这一块整体不出现——不造空转的骨架。
   */
  function renderWithContent(content: Partial<ContentContextValue>) {
    const value = { loading: false, error: null, refresh: vi.fn(async () => {}), lessons: [] } as unknown as ContentContextValue
    const stub = { ...value, ...content }
    const result = render(
      <ContentProviderHost.Provider value={stub}>
        <ReviewCenterView
          groups={{ overdue: [], today: [], upcoming: [], next: null }}
          titles={titles}
          lessonIds={['lesson-s0-1']}
          todayKey="2026-09-20"
          onReview={vi.fn()}
          onSnooze={vi.fn()}
          onOpenLesson={vi.fn()}
        />
      </ContentProviderHost.Provider>,
    )
    return { ...result, stub }
  }

  it('Provider 缺席时不渲染这一块（现有用例跑的是无内容服务的形态）', () => {
    renderView()
    expect(document.querySelector('[data-rv-async]')).toBeNull()
  })

  it('loading：读取中如实说是临时的，并挂同形占位', () => {
    const { container } = renderWithContent({ loading: true })
    const block = container.querySelector('[data-rv-async="loading"]')
    expect(block?.getAttribute('role')).toBe('status')
    expect(block?.getAttribute('aria-busy')).toBe('true')
    expect(block?.textContent).toContain('正在读取资料库发布规则')
    expect(block?.textContent).toContain('这一档是临时的')
    expect(block?.querySelector('.view-skeleton__shape')?.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('.rv-btn')).toBeNull()
  })

  it('error：读不到点名原因、说明不影响已排好的节点，并给真能用的重试', async () => {
    const { container, stub } = renderWithContent({
      loading: false,
      error: '内容服务返回 503：目录读取失败',
    })
    const block = container.querySelector('[data-rv-async="error"]')
    expect(block?.getAttribute('role')).toBe('alert')
    expect(block?.textContent).toContain('读不到资料库发布规则：内容服务返回 503：目录读取失败')
    expect(block?.textContent).toContain('已排好的复测节点不受影响')
    expect(block?.classList.contains('rv-async--failed')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '重试读取发布规则' }))
    await waitFor(() => expect(stub.refresh).toHaveBeenCalledTimes(1))
  })

  it('读取中不再同时宣布「读不到」，两档互斥', () => {
    const { container } = renderWithContent({ loading: true, error: '上一轮的失败还在' })
    expect(container.querySelector('[data-rv-async="loading"]')).toBeTruthy()
    expect(container.querySelector('[data-rv-async="error"]')).toBeNull()
  })
})

describe('M4 复习中心 · CSS 源码不变式', () => {
  it('样式表原文确实读到（防止下面的断言在空串上假通过）', () => {
    expect(cssText.length).toBeGreaterThan(3000)
    expect(selectorParts(cssCode).length).toBeGreaterThan(40)
  })

  it('全局裸选择器数量 = 0：每条规则都限定在 .cw-review 之下（或从 .reduce-motion 压下来）', () => {
    const bare = selectorParts(cssCode).filter(
      (selector) => !selector.startsWith('.cw-review') && !selector.startsWith('.reduce-motion'),
    )
    expect(bare).toEqual([])
  })

  it('不覆写别人页面的类，也不声明 :root / html / body', () => {
    const selectors = selectorParts(cssCode)
    expect(selectors.some((selector) => /(^|[\s,])(:root|html|body)(\s|,|$)/.test(selector))).toBe(false)
  })

  it('零 !important：降级靠更高优先级选择器而不是强制覆写', () => {
    expect(cssCode).not.toContain('!important')
  })

  it('形态：黑场 + 发丝线 + 冷色发光；无渐变、无玻璃、无第三种圆角', () => {
    // 科技档反转（tokens §4.5）：深色画布上黑投影等于没有，层级改由冷色外发光承担。
    // 约束不放松 —— box-shadow 仍不许出现裸字面量，每条只走 --rv-glow-* 别名。
    const shadows = [...cssCode.matchAll(/box-shadow:\s*([^;]+)/g)].map((m) => m[1]!.trim())
    expect(shadows.length).toBeGreaterThan(0)
    for (const value of shadows) {
      expect(/^var\(--rv-glow-(near|panel|inset)\)$/.test(value), `未走发光令牌：${value}`).toBe(true)
    }
    expect(cssCode).not.toMatch(/backdrop-filter|linear-gradient|radial-gradient|conic-gradient|text-shadow/)
    expect(cssCode).not.toMatch(/border-radius:\s*[0-9]/)
    expect(cssCode).not.toMatch(/outline(-style)?:\s*(none|0)/)
    expect(declarationBlock('.cw-review')).toContain('background: var(--rv-canvas)')
    expect(cssText).toContain('var(--ds-radius-panel, 0)')
    expect(cssText).toContain('var(--ds-shape-none, 0)')
    expect(cssText).not.toContain('var(--ds-shape-pill')
  })

  it('每个 --ds-* 令牌消费都带兜底值', () => {
    expect(cssCode.match(/var\(--ds-[a-z0-9-]+\)/g) ?? []).toEqual([])
  })

  it('正文 16px、行高落在 §5.4 的 1.6–1.75，长中文换行不破版', () => {
    const root = declarationBlock('.cw-review')
    expect(root).toContain('--rv-body: var(--ds-size-body, 16px)')
    const leading = Number(/--rv-leading:\s*var\(--ds-leading-body,\s*([\d.]+)\)/.exec(root)?.[1])
    expect(leading).toBeGreaterThanOrEqual(1.6)
    expect(leading).toBeLessThanOrEqual(1.75)
    expect(declarationBlock('.cw-review :is(h1, h2, p, span, td, th, caption, button)')).toContain(
      'overflow-wrap: anywhere',
    )
    expect(cssCode).not.toMatch(/white-space:\s*pre/)
    // 唯一允许 nowrap 的位置是读屏专用 sr-only（视觉上不占位）；正文一律换行
    expect(cssCode.match(/white-space:\s*nowrap/g)?.length ?? 0).toBeLessThanOrEqual(1)
  })

  it('触控目标 ≥44px 且焦点轮廓可见', () => {
    const root = declarationBlock('.cw-review')
    expect(root).toContain('--rv-tap: var(--ds-tap-min, 44px)')
    expect(declarationBlock('.cw-review .rv-btn')).toContain('min-height: var(--rv-tap)')
    expect(declarationBlock('.cw-review .rv-empty')).toContain('min-height: var(--rv-tap)')
    expect(declarationBlock('.cw-review :is(button, a, summary, [tabindex]):focus-visible')).toContain(
      'var(--ds-focus-ring, rgba(220, 233, 251, 0.72))',
    )
  })

  it('320px 最小宽度有专门降级规则', () => {
    expect(mediaBlock('max-width: 399px')).toContain('padding-left: var(--ds-space-10, 10px)')
    expect(cssCode).toContain('min-width: 0')
    expect(mediaBlock('max-width: 679px')).toContain('table-layout: auto')
  })

  it('§4 loading / error 两档自带高度下限，失败档用虚线而不是颜色', () => {
    expect(declarationBlock('.cw-review .rv-async')).toMatch(/min-height:\s*\d+(\.\d+)?em/)
    const failed = declarationBlock('.cw-review .rv-async--failed')
    expect(failed).toMatch(/border-bottom-style:\s*dashed/)
    expect(failed).not.toMatch(/var\(--rv-accent\)|var\(--c-|var\(--ds-status-/)
  })

  it('语义状态不靠颜色：三档边框样式互不相同，且没有任何场景色参与状态表达', () => {
    expect(declarationBlock('.cw-review .rv-mark--overdue')).toContain('border-style: dotted')
    expect(declarationBlock('.cw-review .rv-mark--today')).toContain('border-style: solid')
    expect(declarationBlock('.cw-review .rv-mark--upcoming')).toContain('border-style: dashed')
    expect(declarationBlock('.cw-review .rv-mark--overdue .rv-mark-text')).toContain('text-decoration-style: dotted')
    // 状态标识的边框/文字色全部取发丝线或暖白，不取 --rv-accent / --c-* 场景与状态色
    for (const selector of [
      '.cw-review .rv-mark--overdue',
      '.cw-review .rv-mark--today',
      '.cw-review .rv-mark--upcoming',
    ]) {
      expect(declarationBlock(selector)).not.toMatch(/var\(--rv-accent\)|var\(--c-|var\(--ds-status-/)
    }
  })

  it('持续动效被系统偏好与根类 .reduce-motion 两道开关真正停止', () => {
    const system = mediaBlock('prefers-reduced-motion: reduce')
    expect(system).toContain('.cw-review')
    expect(system.match(/animation: none/g)?.length).toBeGreaterThanOrEqual(1)
    expect(system).toContain('transition: none')
    expect(declarationBlock('.reduce-motion .cw-review, .reduce-motion .cw-review *, .reduce-motion .cw-review *::before, .reduce-motion .cw-review *::after')).toContain(
      'animation: none',
    )
    expect(cssCode).not.toMatch(/animation[^;]*\binfinite\b/)
    expect(cssCode).not.toMatch(/@keyframes/)
  })
})

describe('M4 复习中心 · 无障碍（axe-core）', () => {
  it('三组表格 + 复测操作按钮无 axe 违规', async () => {
    const upcoming = record({ refId: 'lesson-s2-3', reviewDueKey: '2026-09-24' })
    const { container } = render(
      <ReviewCenterView
        groups={{
          overdue: [record()],
          today: [record({ refId: 'lesson-s1-2', reviewDueKey: '2026-09-20' })],
          upcoming: [upcoming],
          next: { dateKey: '2026-09-24', record: upcoming },
        }}
        titles={titles}
        lessonIds={['lesson-s0-1', 'lesson-s1-2', 'lesson-s2-3']}
        todayKey='2026-09-20'
        onReview={vi.fn()}
        onSnooze={vi.fn()}
        onOpenLesson={vi.fn()}
      />,
    )
    const results = await axe.run(container, {
      rules: {
        // jsdom 无真实布局：色彩对比与触控尺寸由 CSS 源码不变式与浏览器复核承担
        'color-contrast': { enabled: false },
        'target-size': { enabled: false },
      },
    })
    expect(results.violations.map((violation) => violation.id)).toEqual([])
  })
})
