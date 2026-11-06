// @vitest-environment jsdom
/**
 * M4 全站统一 · 全局壳与顶栏（§5.2 第二行 + §5.3 第 6 条）的不变式。
 *
 * 锁四件事：
 *  1) 当前入口的编号是**真实 DOM 文本**，不是 CSS counter 注入（§5.2 编号主导航）；
 *  2) 装饰（分隔斜杠、图标）不进辅助技术朗读顺序，编号与信息文字留在名称里（§5.3 第 6 条）；
 *  3) 搜索 / 通知 / 账户 / 键盘通道（`/` 聚焦、Esc 关闭并把焦点还给触发者、
 *     ↑↓ + Enter 选择结果）行为不回归（§5.2「保留的业务行为」）；
 *  4) 壳层样式层的档位收口（z 层、触控目标、字号）在 styles.css 里成文。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GlobalTopbar } from './topbar'
import { NotificationCenter } from './topbar/Notifications'
import type { AuthUser } from '../hooks/use-auth'
import type { NotificationItem } from '../utils/notifications'
import type { SearchTarget } from '../utils/search'

/* 读原文用的是 learning-path-view.m3.test.tsx 同款写法：动态 import node:fs +
   `import.meta.dirname` 拼路径，不静态 import node:path，也不引未声明的全局。 */
const fsSpecifier: string = 'node:fs'
const { readFileSync } = (await import(fsSpecifier)) as {
  readFileSync: (path: string, encoding: 'utf8') => string
}
const moduleDir = (import.meta as unknown as { dirname?: string }).dirname ?? '.'
const cssRaw = readFileSync(`${moduleDir}/../styles.css`, 'utf8')
const desktopTheme = readFileSync(`${moduleDir}/../design/desktop-theme.css`, 'utf8')
/* 否定断言只看真实声明，不看注释（M3 的同款做法）：注释里会提到被禁止的写法。 */
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '')
const appSource = readFileSync(`${moduleDir}/../app.tsx`, 'utf8')

const user: AuthUser = {
  id: 'user-topbar-1',
  email: 'student@example.com',
  name: '小明',
  bio: '',
  createdAt: '2026-09-01T00:00:00.000Z',
}

const targets: SearchTarget[] = [
  { id: 'lesson-1', type: 'lesson', title: '变量与作用域', subtitle: 'Python · 资料库', aliases: [] },
  { id: 'chal-1', type: 'challenge', title: '关卡验收：循环', subtitle: 'S3', aliases: [] },
]

const items: NotificationItem[] = [
  { id: 'n1', kind: 'review-due', title: '3 条复习到期', dateKey: '2026-09-20' },
  { id: 'n2', kind: 'challenge-passed', title: '关卡验收：循环 已通过', dateKey: '2026-09-19' },
]

function setup(overrides: Partial<Record<string, unknown>> = {}) {
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
    ...overrides,
  }
  const utils = render(
    <GlobalTopbar
      breadcrumbLabel="课程"
      currentEntry={{ index: '01', label: '学习路径' }}
      contextTitle="变量与作用域"
      searchTargets={targets}
      recentViews={[{ id: 'reviews', label: '复习中心' }]}
      notifications={items}
      user={user}
      {...handlers}
    />,
  )
  return { ...utils, ...handlers }
}

afterEach(() => {
  cleanup()
})

describe('§5.2 清楚的当前入口 · 编号是真实文本', () => {
  it('顶栏当前入口渲染为「编号 + 页面名」，编号在 DOM 文本里', () => {
    setup()
    const entry = document.querySelector('.breadcrumbs__entry')
    expect(entry?.textContent).toBe('01学习路径')
    expect(entry?.querySelector('.breadcrumbs__index')?.textContent).toBe('01')
  })

  it('编号不用 CSS counter 注入：styles.css 里不存在给导航/面包屑造文字的 counter', () => {
    expect(css).not.toMatch(/content:\s*counter\(/)
    expect(css).not.toMatch(/counter-increment/)
  })

  it('导航项的编号同样落在真实文本里（app.tsx 渲染，非伪元素）', () => {
    expect(appSource).toMatch(/<span className="nav-item__index">\{navIndex\(position\)\}<\/span>/)
    expect(appSource).not.toMatch(/content:\s*['"]counter/)
  })

  it('装饰性分隔符不进入朗读文本，但页面名与分类仍在文本顺序里', () => {
    setup()
    const nav = screen.getByRole('navigation', { name: '当前位置' })
    const readAloud = [...nav.querySelectorAll(':scope > *:not([aria-hidden="true"])')]
    expect(nav.textContent).toContain('变量与作用域')
    // 三个 `/` 分隔符都必须是 aria-hidden 的装饰
    const seps = [...nav.querySelectorAll('.breadcrumbs__sep')]
    expect(seps.length).toBeGreaterThanOrEqual(2)
    expect(seps.every((s) => s.getAttribute('aria-hidden') === 'true')).toBe(true)
    expect(readAloud.length).toBeGreaterThan(0)
  })

  it('顶栏图标一律带 aria-hidden（lucide 默认值 + 显式声明双保险）', () => {
    setup()
    const svgs = [...document.querySelectorAll('.topbar svg')]
    expect(svgs.length).toBeGreaterThan(0)
    expect(svgs.every((s) => s.getAttribute('aria-hidden') === 'true')).toBe(true)
  })
})

describe('桌面主题断点', () => {
  it('桌面布局令牌与派生定位只在 1201px 以上覆盖基础响应式规则', () => {
    const desktopStart = desktopTheme.indexOf('@media (min-width: 1201px) {')
    const reducedMotionStart = desktopTheme.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(desktopStart).toBeGreaterThan(-1)
    expect(reducedMotionStart).toBeGreaterThan(desktopStart)
    const desktopRules = desktopTheme.slice(desktopStart, reducedMotionStart)
    expect(desktopTheme.slice(0, desktopStart)).not.toMatch(/--(?:sidebar-w|topbar-h|tap-min):/)
    expect(desktopRules).toContain('--sidebar-w: 240px')
    expect(desktopRules).toContain('--topbar-h: 68px')
    expect(desktopRules).toContain('.app-shell .sidebar { top: var(--topbar-h)')
    expect(desktopRules).not.toContain('@media (max-width: 1200px)')
    expect(desktopRules).not.toContain('@media (max-width: 1000px)')
  })
})

describe('§5.2 保留行为 · 全局搜索', () => {
  it('按 `/` 聚焦搜索输入框', () => {
    setup()
    const input = screen.getByRole('combobox', { name: '全局搜索课程、挑战与项目' })
    expect(document.activeElement).not.toBe(input)
    fireEvent.keyDown(window, { key: '/' })
    expect(document.activeElement).toBe(input)
  })

  it('在输入框里打字不会触发 `/` 快捷键抢焦点', () => {
    setup()
    const input = screen.getByRole('combobox')
    input.focus()
    fireEvent.keyDown(input, { key: '/' })
    // 在输入框里按 /：全局快捷键让位给输入，不 preventDefault，也不重开面板
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('结果行用 ↑↓ + Enter 选择，Enter 命中课程时走 onPickLesson', () => {
    const { onPickLesson } = setup()
    const input = screen.getByRole('combobox', { name: '全局搜索课程、挑战与项目' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '变量' } })
    expect(screen.getByRole('listbox', { name: '搜索结果' })).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPickLesson).toHaveBeenCalledWith('lesson-1')
  })

  it('Esc 关闭结果面板并把焦点留在输入框（与通知面板、账户菜单同一口径）', () => {
    setup()
    const input = screen.getByRole('combobox', { name: '全局搜索课程、挑战与项目' })
    fireEvent.focus(input)
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    // 原先这里断言的是「焦点不在输入框」，实现写的是 blur() —— 浏览器实测焦点因此掉回 body，
    // 而同一个顶栏里通知面板与账户菜单的 Esc 都把焦点还给触发控件（历史执行记录 docs/M6-整体验收-执行记录.md §14 escwalk 量出来的一条）。
    // 本库对模态的契约本来就是「Esc 关闭 + 焦点回归」（见 modals.test.tsx 文件头），搜索框按同一口径改。
    expect(document.activeElement).toBe(input)
  })

  it('空结果显示提示，并可一键清除搜索词', () => {
    setup()
    const input = screen.getByRole('combobox', { name: '全局搜索课程、挑战与项目' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '不存在的东西' } })
    expect(screen.getByText('没有匹配的结果')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }))
    expect((input as HTMLInputElement).value).toBe('')
  })

  it('未输入时展示最近访问，选择后走 onNavigateView', () => {
    const { onNavigateView } = setup()
    const input = screen.getByRole('combobox', { name: '全局搜索课程、挑战与项目' })
    fireEvent.focus(input)
    fireEvent.click(screen.getByText('复习中心'))
    expect(onNavigateView).toHaveBeenCalledWith('reviews')
  })
})

describe('§5.2 保留行为 · 通知中心', () => {
  it('触发按钮的无障碍名称带真实未读数', () => {
    setup()
    expect(screen.getByRole('button', { name: '通知中心（2 条未读）' })).toBeTruthy()
  })

  it('打开面板可读通知列表；关闭时把可见项上报为已读', async () => {
    const { onMarkAllRead } = setup()
    fireEvent.click(screen.getByRole('button', { name: '通知中心（2 条未读）' }))
    expect(screen.getByRole('region', { name: '通知列表' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(onMarkAllRead).toHaveBeenCalledWith(['n1', 'n2']))
  })

  it('Esc 关闭后焦点回到触发按钮', () => {
    setup()
    const trigger = screen.getByRole('button', { name: '通知中心（2 条未读）' })
    fireEvent.click(trigger)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.activeElement).toBe(trigger)
  })

  it.each(['Escape', 'outside click'])('面板打开期间通知更新后，%s 按最新列表标记已读', (closeBy) => {
    const onClose = vi.fn()
    const onNavigateView = vi.fn()
    const latestItems: NotificationItem[] = [
      { id: 'n3', kind: 'review-due', title: '最新复习提醒', dateKey: '2026-09-21' },
    ]
    const { rerender } = render(<NotificationCenter items={items} onClose={onClose} onNavigateView={onNavigateView} />)
    fireEvent.click(screen.getByRole('button', { name: '通知中心（2 条未读）' }))
    rerender(<NotificationCenter items={latestItems} onClose={onClose} onNavigateView={onNavigateView} />)
    if (closeBy === 'Escape') fireEvent.keyDown(window, { key: 'Escape' })
    else fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledWith(['n3'])
  })

  it('点击某条通知跳到对应视图并上报已读', () => {
    const { onNavigateView, onMarkAllRead } = setup()
    fireEvent.click(screen.getByRole('button', { name: '通知中心（2 条未读）' }))
    fireEvent.click(screen.getByText('关卡验收：循环 已通过'))
    expect(onNavigateView).toHaveBeenCalledWith('challenges')
    expect(onMarkAllRead).toHaveBeenCalledWith(['n1', 'n2'])
  })
})

describe('§5.2 保留行为 · 设置与账户', () => {
  it('设置按钮可被壳层 ref 捕获（弹层关闭后焦点回得来）', () => {
    const ref = { current: null as HTMLButtonElement | null }
    const { onOpenSettings } = setup({ settingsTriggerRef: ref })
    const button = screen.getByRole('button', { name: '打开设置' })
    expect(ref.current).toBe(button)
    fireEvent.click(button)
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    button.focus()
    button.blur()
    expect(document.activeElement).not.toBe(button)
  })

  it('账户菜单：menu/menuitem 语义齐备，退出登录走 onLogout', () => {
    const { onLogout } = setup()
    fireEvent.click(screen.getByRole('button', { name: '账户菜单' }))
    const menu = screen.getByRole('menu', { name: '账户操作' })
    expect(menu).toBeTruthy()
    expect(screen.getAllByRole('menuitem').length).toBe(5)
    fireEvent.click(screen.getByRole('menuitem', { name: /退出登录/ }))
    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('账户菜单 Esc 关闭并把焦点还给头像按钮', () => {
    setup()
    const trigger = screen.getByRole('button', { name: '账户菜单' })
    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('账户菜单里只有文字入口，图标是装饰', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '账户菜单' }))
    const items = screen.getAllByRole('menuitem')
    expect(items.every((item) => (item.textContent ?? '').trim().length > 0)).toBe(true)
    expect([...document.querySelectorAll('.account-menu svg')].every((s) => s.getAttribute('aria-hidden') === 'true')).toBe(true)
  })
})

describe('M4 样式层收口 · z 档 / 触控 / 字号', () => {
  it('z 层只有五档：装饰 10、chrome 15、浮层 40、模态 50、系统 60', () => {
    for (const [name, value] of [
      ['--z-content', '1'],
      ['--z-decor', '10'],
      ['--z-chrome', '15'],
      ['--z-popover', '40'],
      ['--z-modal', '50'],
      ['--z-system', '60'],
    ] as const) {
      expect(css).toContain(`  ${name}: ${value};`)
    }
    // 侧栏与顶栏同一档，不再互相遮盖
    expect(css).toMatch(/\.sidebar \{[\s\S]*?z-index: var\(--z-chrome\);/)
    expect(css).toMatch(/\.topbar \{[\s\S]*?z-index: var\(--z-chrome\);/)
    // 浮层家族不再出现 30 / 45 / 借用的 50
    expect(css).not.toMatch(/z-index:\s*3[05];/)
    expect(css).not.toMatch(/z-index:\s*45;/)
  })

  it('装饰层不截获指针（§5.3 第 6 条）', () => {
    expect(css).toMatch(/\.shell-decor \{[\s\S]*?z-index: var\(--z-decor\);\r?\n {2}pointer-events: none;/)
  })

  it('顶栏与浮层的控件命中区按 §5.4 收在 44px 档', () => {
    expect(css).toMatch(/\.icon-button \{\r?\n {2}width: var\(--tap-min\);\r?\n {2}height: var\(--tap-min\);/)
    expect(css).toMatch(/\.topbar-avatar \{ min-width: var\(--tap-min\); min-height: var\(--tap-min\);/)
    expect(css).toMatch(/\.account-menu button \{[\s\S]*?min-height: var\(--tap-min\);/)
    expect(css).toMatch(/\.global-search__input \{[\s\S]*?min-height: var\(--tap-min\);/)
    expect(css).toMatch(/\.profile \{[\s\S]*?min-height: var\(--tap-min\);/)
  })

  it('styles.css 里不再有 11–12.5px 的裸字号（§5.4 正文档 / meta 档二选一）', () => {
    expect(css).not.toMatch(/font-size:\s*1[12](\.5)?px/)
  })

  it('窄屏档：搜索与通知浮层按 .topbar 算宽，不再塌进那 44px 的折叠盒', () => {
    // 浏览器实测出来的两条（历史执行记录 docs/M6-整体验收-执行记录.md §14）：390 档结果面板只有 44px 宽、通知面板左溢 34px（320 档 104px）。
    // 同一个根因：它们是绝对定位的，包含块是 .global-search / .notification-wrap 那两个 44px 的
    // position:relative 盒。钉住「窄屏档把包含块交回 .topbar + 通知面板有左右安全边距」。
    const at = css.indexOf('@media (max-width: 760px)')
    expect(at, '找不到 ≤760px 那一档').toBeGreaterThan(-1)
    let depth = 0
    let end = -1
    for (let i = css.indexOf('{', at); i < css.length; i += 1) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') { depth -= 1; if (depth === 0) { end = i; break } }
    }
    const narrow = css.slice(at, end)
    expect(narrow).toMatch(/\.global-search:focus-within \{[^}]*position: static/)
    expect(narrow).toMatch(/\.notification-wrap \{[^}]*position: static/)
    expect(narrow).toMatch(/\.notification-panel \{[^}]*left: 12px;[^}]*right: 12px;[^}]*width: auto/)
    // 展开态本身仍是绝对定位（否则顶栏会跳行），这条一起钉住，防止下次「顺手」改成 static 以外的东西
    expect(narrow).toMatch(/\.global-search__input:focus \{[^}]*position: absolute/)
  })

  it('减少动效的两条路径都挂在根类上，不依赖 .app-shell', () => {
    expect(css).not.toMatch(/\.app-shell\.reduce-motion|\.app-shell \.reduce-motion/)
    expect(css).toMatch(/\.reduce-motion, \.reduce-motion \*, \.reduce-motion \*::before, \.reduce-motion \*::after \{/)
    expect(appSource).toContain("document.documentElement.classList.toggle('reduce-motion'")
  })
})

/* 01 号方案 §5「弹层焦点进出正确」。搜索面板由 onFocus 打开，此前只有 Esc / 点面板外 /
   选中结果三条关闭路，Tab 走出去不收——键盘用户过一次搜索框，listbox 就一直盖在内容上。
   实测出处：terminal113 writeback「绑定 + 有数据」200% 那一格整页 Tab 只走 3 站，
   stop-0 截图上挂着的就是上一格留下的搜索面板。 */
describe('§5 搜索面板跟着键盘离开而收', () => {
  it('焦点在区内移动不收，离开本区才收（面板是 onFocus 开的，不收就是键盘死角）', () => {
    setup()
    const input = document.querySelector('.global-search__input') as HTMLInputElement
    fireEvent.focus(input)
    expect(document.querySelector('.global-search__panel')).not.toBeNull()
    const row = document.querySelector('.global-search__row') as HTMLElement
    expect(row).toBeTruthy()
    // 输入框 → 结果行：还在 .global-search 之内，面板必须留着
    fireEvent.blur(input, { relatedTarget: row })
    expect(document.querySelector('.global-search__panel')).not.toBeNull()
    // 结果行 → 本区之外：面板必须收，否则它一直盖住身后的内容
    fireEvent.blur(row, { relatedTarget: document.body })
    expect(document.querySelector('.global-search__panel')).toBeNull()
  })
})
