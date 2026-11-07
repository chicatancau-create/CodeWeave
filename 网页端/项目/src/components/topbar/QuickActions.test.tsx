// @vitest-environment jsdom
/**
 * 顶栏「快捷动作」（01 号方案 §3.2 顶栏构成第三项 + §4 拆分表里的 QuickActions）。
 *
 * 钉的事，全部是 jsdom 里量得到的 DOM / 文案 / `aria-*`：
 *  1. 触发按钮有可读名称，`aria-haspopup` / `aria-expanded` / `aria-controls` 跟随开合；
 *  2. 三条目只用**上层给的事实**（recommended / dueCount），本组件不派生学习状态；
 *  3. `recommended` 为 null 时「继续学习」真的 `disabled`，并把禁用条件**说出口**
 *     （渲染成真实文字 + `aria-describedby`，§4 的 disabled 行：不许只变灰，
 *     也不许画一颗按了什么都不发生的按钮）；
 *  4. `dueCount` 为 0 时这一条不消失，文案换成「今天没有到期复测」且仍可进入复习中心；
 *  5. 学习指南这一条把 HelpModal 的入口从工作台里解绑出来（`onOpenHelp`）；
 *  6. Esc 关闭并把焦点还给触发按钮、点击面板外关闭 —— 与同栏 AccountMenu 同一份写法；
 *  7. 样式段落只用令牌（无硬编码色值）、面板静态（无持续动画）。
 *
 * 量不到的东西不在此声明：面板高度/最大高度是否溢出视口、色彩对比度、**真实** Tab 与
 * 焦点顺序（jsdom 的 focus() 不产生真实焦点序）—— 按 §5.4 到真实浏览器取证。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuickActions, type QuickActionsProps } from './QuickActions'
import { GlobalTopbar } from '../topbar'
import type { AuthUser } from '../../hooks/use-auth'
import type { NotificationItem } from '../../utils/notifications'
import type { SearchTarget } from '../../utils/search'

/* 读原文用的是 challenges/ChallengeGrid.test.tsx 同款写法：动态 import node:fs +
   `import.meta.dirname` 拼路径，不静态 import node:path，也不引未声明的全局。 */
const fsSpecifier: string = 'node:fs'
const { readFileSync } = (await import(fsSpecifier)) as {
  readFileSync: (path: string, encoding: 'utf8') => string
}
const moduleDir = (import.meta as unknown as { dirname?: string }).dirname ?? '.'
const cssRaw = readFileSync(`${moduleDir}/../../styles.css`, 'utf8')
/* 只看新增那一段（文件末尾），并去掉注释：注释里会照抄被禁止的写法。 */
const quickCssStart = cssRaw.indexOf('顶栏「快捷动作」')
const quickCss = cssRaw.slice(quickCssStart).replace(/\/\*[\s\S]*?\*\//g, '')

const recommended = { label: 'S1', title: '变量与作用域' }

function setup(overrides: Partial<QuickActionsProps> = {}) {
  const handlers: QuickActionsProps = {
    recommended,
    dueCount: 3,
    onContinue: vi.fn(),
    onGoReviews: vi.fn(),
    onOpenHelp: vi.fn(),
    ...overrides,
  }
  const utils = render(<QuickActions {...handlers} />)
  return { ...utils, ...handlers }
}

function openPanel() {
  const trigger = screen.getByRole('button', { name: '快捷动作' })
  fireEvent.click(trigger)
  return trigger
}

afterEach(() => {
  cleanup()
})

describe('§3.2 快捷动作 · 触发按钮与面板语义', () => {
  it('触发按钮有可读名称，未展开时 aria-expanded=false 且面板不挂载', () => {
    setup()
    const trigger = screen.getByRole('button', { name: '快捷动作' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menu', { name: '快捷动作' })).toBeNull()
  })

  it('点击展开：aria-expanded=true、aria-controls 指向真实存在的面板 id', () => {
    setup()
    const trigger = openPanel()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const panel = screen.getByRole('menu', { name: '快捷动作' })
    expect(trigger.getAttribute('aria-controls')).toBe(panel.id)
  })

  it('三条目各是一个 menuitem，且都带真实文字（图标只是装饰）', () => {
    setup()
    openPanel()
    const items = screen.getAllByRole('menuitem')
    expect(items.map((item) => (item.textContent ?? '').trim())).toEqual([
      expect.stringContaining('继续学习'),
      expect.stringContaining('今日复习 3 项'),
      expect.stringContaining('学习指南'),
    ])
    const svgs = [...screen.getByRole('menu', { name: '快捷动作' }).querySelectorAll('svg')]
    expect(svgs.length).toBe(3)
    expect(svgs.every((s) => s.getAttribute('aria-hidden') === 'true')).toBe(true)
  })

  it('再点一次触发按钮收起面板（与 AccountMenu 的 toggle 同一口径）', () => {
    setup()
    const trigger = openPanel()
    fireEvent.click(trigger)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('§3.2 快捷动作 · 继续学习', () => {
  it('有推荐课时时把上层的「编号 · 标题」原样说出来，点击走 onContinue 并收面板', () => {
    const { onContinue } = setup()
    openPanel()
    expect(screen.getByText('S1 · 变量与作用域')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: /继续学习/ }))
    expect(onContinue).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('recommended=null：这一条真的 disabled，且禁用条件写成真实文字（§4 disabled 行）', () => {
    const { onContinue } = setup({ recommended: null })
    openPanel()
    const row = screen.getByRole('menuitem', { name: /继续学习/ }) as HTMLButtonElement
    expect(row.disabled).toBe(true)
    const hintId = row.getAttribute('aria-describedby')
    expect(hintId, '禁用行必须用 aria-describedby 指到一句说明').toBeTruthy()
    const hint = document.getElementById(hintId as string)
    expect(hint?.textContent).toContain('现在按不了')
    expect(hint?.textContent).toContain('还没有完成证据')
    expect(hint?.textContent).toContain('资料库尚未连接')
    fireEvent.click(row)
    expect(onContinue).not.toHaveBeenCalled()
  })

  it('recommended=null 时不再渲染那行「编号 · 标题」的假事实', () => {
    setup({ recommended: null })
    openPanel()
    expect(screen.queryByText('S1 · 变量与作用域')).toBeNull()
  })

  it('本组件不自己算学习状态：推荐与计数原样来自 props（源码层无派生逻辑）', () => {
    const source = readFileSync(`${moduleDir}/QuickActions.tsx`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(source).not.toMatch(/hasCompletionEvidence|mastery\.|records|lessons|useMemo/)
  })
})

describe('§3.2 快捷动作 · 今日复习与学习指南', () => {
  it('dueCount=3 报出真实条数，点击走 onGoReviews', () => {
    const { onGoReviews } = setup({ dueCount: 3 })
    openPanel()
    fireEvent.click(screen.getByRole('menuitem', { name: /今日复习 3 项/ }))
    expect(onGoReviews).toHaveBeenCalledTimes(1)
  })

  it('dueCount=0 时这一条不消失、仍可点，文案换成「今天没有到期复测」', () => {
    const { onGoReviews } = setup({ dueCount: 0 })
    openPanel()
    const row = screen.getByRole('menuitem', { name: /今日复习 0 项/ }) as HTMLButtonElement
    expect(row.disabled).toBe(false)
    expect(screen.getByText('今天没有到期复测')).toBeTruthy()
    fireEvent.click(row)
    expect(onGoReviews).toHaveBeenCalledTimes(1)
  })

  it('学习指南：点击走 onOpenHelp（HelpModal 在工作台之外的唯一入口）', () => {
    const { onOpenHelp } = setup()
    openPanel()
    fireEvent.click(screen.getByRole('menuitem', { name: /学习指南/ }))
    expect(onOpenHelp).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('§3.2 快捷动作 · 键盘与焦点（同 AccountMenu 那份写法）', () => {
  it('Esc 关闭面板并把焦点还给触发按钮', () => {
    setup()
    const trigger = openPanel()
    trigger.focus()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('焦点在面板内条目上按 Esc 同样关闭并归焦点', () => {
    setup()
    const trigger = openPanel()
    const row = screen.getByRole('menuitem', { name: /学习指南/ })
    row.focus()
    fireEvent.keyDown(row, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('点击面板外部关闭；点击面板内部不关闭', () => {
    setup()
    openPanel()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
    openPanel()
    fireEvent.mouseDown(screen.getByRole('menuitem', { name: /学习指南/ }))
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('首项禁用时聚焦首个可用项；方向键循环、Home/End 跳转，并只有当前项在 Tab 序列', () => {
    setup({ recommended: null })
    openPanel()
    const reachable = screen.getAllByRole('menuitem').filter((item) => !(item as HTMLButtonElement).disabled)
    expect(reachable.length).toBe(2)
    expect(document.activeElement).toBe(reachable[0])
    expect(reachable.map((item) => item.tabIndex)).toEqual([0, -1])
    fireEvent.keyDown(reachable[0]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(reachable[1])
    expect(reachable.map((item) => item.tabIndex)).toEqual([-1, 0])
    fireEvent.keyDown(reachable[1]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(reachable[0])
    fireEvent.keyDown(reachable[0]!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(reachable[1])
    fireEvent.keyDown(reachable[1]!, { key: 'Home' })
    expect(document.activeElement).toBe(reachable[0])
    fireEvent.keyDown(reachable[0]!, { key: 'End' })
    expect(document.activeElement).toBe(reachable[1])
  })
})

describe('§3.2 快捷动作 · 静态面板与令牌', () => {
  it('面板不抢播报：没有 aria-live / role=status 的活区域', () => {
    setup()
    openPanel()
    const live = [...screen.getByRole('menu').querySelectorAll('[aria-live],[role="status"],[role="alert"]')]
    expect(live).toEqual([])
  })

  it('新增样式段只用令牌：无硬编码色值、无持续动画', () => {
    expect(quickCssStart).toBeGreaterThan(-1)
    expect(quickCss).toContain('.topbar-quick-actions__panel')
    expect(quickCss).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(quickCss).not.toMatch(/rgba?\(/)
    expect(quickCss).not.toMatch(/hsla?\(/)
    expect(quickCss).not.toMatch(/animation|@keyframes/)
    // 触控命中区仍按 §5.4 的 44 档
    expect(quickCss).toMatch(/\.topbar-quick-actions__item \{[\s\S]*?min-height: var\(--tap-min/)
    // 字号一律令牌，不写裸 px 档
    expect(quickCss).not.toMatch(/font-size:\s*\d+(\.\d+)?px/)
  })
})

describe('壳层接线 · GlobalTopbar 仍从 ./topbar 具名导出', () => {
  const user: AuthUser = {
    id: 'user-quick-1',
    email: 'student@example.com',
    name: '小明',
    bio: '',
    createdAt: '2026-09-01T00:00:00.000Z',
  }
  const targets: SearchTarget[] = [
    { id: 'lesson-1', type: 'lesson', title: '变量与作用域', subtitle: 'Python · 资料库', aliases: [] },
  ]
  const items: NotificationItem[] = [
    { id: 'n1', kind: 'review-due', title: '3 条复习到期', dateKey: '2026-09-20' },
  ]

  /** 壳层测试里只覆写这两处：ref 归属、以及「动作没接齐」那一档。 */
  type ShellOverrides = {
    settingsTriggerRef?: { current: HTMLButtonElement | null }
    onOpenHelp?: () => void
  }

  function setupShell(overrides: ShellOverrides = {}) {
    const handlers = {
      onMarkAllRead: vi.fn(),
      onPickLesson: vi.fn(),
      onPickChallenge: vi.fn(),
      onPickProject: vi.fn(),
      onNavigateView: vi.fn(),
      onOpenSettings: vi.fn(),
      onNavigateSecurity: vi.fn(),
      onNavigateData: vi.fn(),
      onExportData: vi.fn(),
      onLogout: vi.fn(),
      onContinueLesson: vi.fn(),
      onGoReviews: vi.fn(),
      onOpenHelp: vi.fn(),
    }
    const utils = render(
      <GlobalTopbar
        breadcrumbLabel="课程"
        currentEntry={{ index: '01', label: '学习路径' }}
        searchTargets={targets}
        recentViews={[{ id: 'reviews', label: '复习中心' }]}
        notifications={items}
        user={user}
        recommendedLesson={recommended}
        reviewDueCount={3}
        {...handlers}
        {...overrides}
      />,
    )
    return { ...utils, ...handlers }
  }

  it('五个新 props 齐了才出现快捷动作，并把上层的条数与推荐原样带进面板', () => {
    const shell = setupShell()
    fireEvent.click(screen.getByRole('button', { name: '快捷动作' }))
    expect(screen.getByText('S1 · 变量与作用域')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /今日复习 3 项/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: /学习指南/ }))
    expect(shell.onOpenHelp).toHaveBeenCalledTimes(1)
  })

  it('快捷动作不吃掉设置按钮：`打开设置` 仍在，且壳层 ref 指的还是设置那颗', () => {
    const ref = { current: null as HTMLButtonElement | null }
    const shell = setupShell({ settingsTriggerRef: ref })
    const settings = screen.getByRole('button', { name: '打开设置' })
    expect(ref.current).toBe(settings)
    fireEvent.click(settings)
    expect(shell.onOpenSettings).toHaveBeenCalledTimes(1)
    // 顺序按 §3.2：快捷动作在通知与设置之前，三者互不吞并
    const order = [...document.querySelectorAll('.topbar-actions > *')].map((el) => el.className)
    expect(order[0]).toContain('topbar-quick-actions')
    expect(order[1]).toContain('notification-wrap')
  })

  it('动作回调没接齐时整组不渲染（宁可不出现，也不画按了没用的按钮）', () => {
    setupShell({ onOpenHelp: undefined })
    expect(screen.queryByRole('button', { name: '快捷动作' })).toBeNull()
    expect(screen.getByRole('button', { name: '打开设置' })).toBeTruthy()
  })
})
