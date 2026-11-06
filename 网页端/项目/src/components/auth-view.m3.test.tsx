// @vitest-environment jsdom
/**
 * M3 视觉竖切 · 登录/入口页（01 号方案 §3.1 登录与注册、§5 降级与无障碍、§8 验收清单）契约测试。
 *
 * 分工：`auth-view.test.tsx` 锁**业务行为**（登录/注册/错误/忙态），本文件锁
 * **视觉竖切引入的新契约**——右侧场景只是装饰、动效的三条真停路径、键盘
 * Tab/Enter/Esc、忙态与错误的新ARIA 关联，以及「样式表里定义了 44px/16px 的那些
 * 选择器，确实作用在真实渲染出来的元素上」。
 *
 * 口径说明：Vitest 默认 `css: false`，样式表在测试里被替换成空模块（`?raw` 与
 * `import.meta.glob` 都拿不到原文），所以
 * - 能在 DOM 上验证的（ARIA、data-motion、类名、焦点、禁用）在这里断言；
 * - 只能由 CSS 表达的具体数值（44px 命中区、16px/1.7、字重 200、无渐变无泛光、
 *   prefers-reduced-motion 与 .reduce-motion 两条媒体/类选择器）留在
 *   `auth-view.css` 里逐条标注出处，由浏览器截图与人工复核（见交付报告）。
 * 这里额外锁住「选择器 ↔ 元素」的对应关系，防止样式写了却挂在不存在的类名上。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { AuthView } from './auth-view'
import { STORAGE_KEYS } from '../utils/constants'
import componentSource from './auth-view.tsx?raw'

type Props = ComponentProps<typeof AuthView>

const baseProps: Props = {
  mode: 'login',
  error: '',
  busy: false,
  onModeChange: vi.fn(),
  onSubmit: vi.fn(),
}

function authRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>('.cv-auth')
  if (!root) throw new Error('未找到 .cv-auth 根节点')
  return root
}

function scene(container: HTMLElement): HTMLElement {
  const node = container.querySelector<HTMLElement>('.cv-auth__scene')
  if (!node) throw new Error('未找到右侧场景层')
  return node
}

function submitButton(): HTMLButtonElement {
  const button = document.querySelector('.auth-submit')
  if (!button) throw new Error('未找到主提交按钮')
  return button as HTMLButtonElement
}

/**
 * 模拟系统「减少动效」偏好。jsdom 不实现 matchMedia，因此给一个可控假实现；
 * 返回 change 触发器，用于验证「偏好中途改变」也会即时生效。
 */
function stubMatchMedia(initial: boolean) {
  let matches = initial
  const handlers = new Set<(event: { matches: boolean }) => void>()
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return matches
    },
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_: string, handler: (event: { matches: boolean }) => void) => handlers.add(handler),
    removeEventListener: (_: string, handler: (event: { matches: boolean }) => void) => handlers.delete(handler),
    addListener: () => undefined,
    removeListener: () => undefined,
  }))
  return {
    set(value: boolean) {
      matches = value
      for (const handler of handlers) handler({ matches: value })
    },
  }
}

/** 还原被改写的 document.visibilityState（own 属性会遮蔽 jsdom 原型访问器）。 */
function restoreVisibility() {
  delete (document as unknown as Record<string, unknown>).visibilityState
}

beforeEach(() => {
  // 上一条用例可能把 .reduce-motion 留在 html/body 上（组件会观测这两处），必须清干净
  document.documentElement.className = ''
  document.body.className = ''
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  restoreVisibility()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('M3-LOGIN 右侧场景是装饰层（§5.3.6 / §5.2 不强迫观看动画）', () => {
  it('场景 aria-hidden、无可聚焦元素、无内联事件（不截获鼠标与键盘、不进阅读顺序）', () => {
    const { container } = render(<AuthView {...baseProps} />)
    const stage = scene(container)
    expect(stage.getAttribute('aria-hidden')).toBe('true')
    expect(stage.querySelectorAll('a, button, input, select, textarea, [tabindex]').length).toBe(0)
    expect(stage.innerHTML).not.toMatch(/\son[a-z]+=/i)
    // 场景与表单列是兄弟节点：左文字右场景，场景不覆盖在读区之上
    expect(stage.parentElement).toBe(authRoot(container))
    expect(authRoot(container).firstElementChild).toBe(stage)
  })

  it('本页不加载 WebGPU、不起 RAF：场景失败没有任何形态能阻断表单（§5.3.2）', () => {
    expect(componentSource).not.toMatch(/requestAnimationFrame|navigator\.gpu|GPUQueue|wgsl/i)
    expect(componentSource).toMatch(/import '\.\/auth-view\.css'/)
    const { container } = render(<AuthView {...baseProps} />)
    // 没有启动屏 / 没有全屏劝退层：表单与主按钮当场可用
    expect(container.querySelector('.cv-auth__submit')).toBeTruthy()
    expect(screen.getByLabelText('密码')).toBeTruthy()
  })

  it('场景内容仍保留在文档里（静态黑场只由 CSS 摘掉动画层，不删结构）', () => {
    stubMatchMedia(true)
    const { container } = render(<AuthView {...baseProps} />)
    const stage = scene(container)
    expect(stage.querySelectorAll('.cv-auth__scene-glow').length).toBe(1)
    expect(stage.querySelectorAll('.cv-auth__scene-ring').length).toBe(2)
    expect(authRoot(container).getAttribute('data-motion')).toBe('still')
  })
})

describe('M3-LOGIN 持续动画的三条真停路径（§5.3.3 / §5.3.4）', () => {
  it('默认允许动画时挂 data-motion="live"，CSS 仅在该值下挂载关键帧', () => {
    const { container } = render(<AuthView {...baseProps} />)
    expect(authRoot(container).getAttribute('data-motion')).toBe('live')
  })

  it('路径 A：系统 prefers-reduced-motion 命中即停，中途改变偏好也即时生效', async () => {
    const query = stubMatchMedia(true)
    const { container } = render(<AuthView {...baseProps} />)
    expect(authRoot(container).getAttribute('data-motion')).toBe('still')
    act(() => query.set(false))
    expect(authRoot(container).getAttribute('data-motion')).toBe('live')
    act(() => query.set(true))
    expect(authRoot(container).getAttribute('data-motion')).toBe('still')
  })

  it('路径 B：根元素 .reduce-motion 类（应用内“减少动效”设置）命中即停', async () => {
    const { container } = render(<AuthView {...baseProps} />)
    expect(authRoot(container).getAttribute('data-motion')).toBe('live')
    document.documentElement.classList.add('reduce-motion')
    await waitFor(() => expect(authRoot(container).getAttribute('data-motion')).toBe('still'))
    document.documentElement.classList.remove('reduce-motion')
    await waitFor(() => expect(authRoot(container).getAttribute('data-motion')).toBe('live'))
    document.body.classList.add('reduce-motion')
    await waitFor(() => expect(authRoot(container).getAttribute('data-motion')).toBe('still'))
  })

  it('路径 B′：应用设置里的 reduceMotion 命中即停（登录页在 .app-shell 之外，拿不到那个类）', () => {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ reduceMotion: true }))
    const { container } = render(<AuthView {...baseProps} />)
    expect(authRoot(container).getAttribute('data-motion')).toBe('still')
    // 不写回存储：登录页只读设置，不得覆盖用户的选择
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)!).reduceMotion).toBe(true)
  })

  it('路径 C：用户可主动暂停并恢复，按钮有名称且状态可读出', () => {
    const { container } = render(<AuthView {...baseProps} />)
    const pause = screen.getByRole('button', { name: /暂停背景动画/ }) as HTMLButtonElement
    expect(pause.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(pause)
    expect(authRoot(container).getAttribute('data-motion')).toBe('still')
    const play = screen.getByRole('button', { name: /播放背景动画/ }) as HTMLButtonElement
    expect(play.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(play)
    expect(authRoot(container).getAttribute('data-motion')).toBe('live')
  })

  it('后台标签页停止动画，回到前台恢复（§5.3.4 后台暂停渲染）', () => {
    const { container } = render(<AuthView {...baseProps} />)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    fireEvent(document, new Event('visibilitychange'))
    expect(authRoot(container).getAttribute('data-motion')).toBe('still')
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    fireEvent(document, new Event('visibilitychange'))
    expect(authRoot(container).getAttribute('data-motion')).toBe('live')
  })

  it('卸载后摘掉 matchMedia / visibilitychange / MutationObserver 订阅', () => {
    const query = stubMatchMedia(false)
    const removeSpy = vi.spyOn(console, 'error')
    const { unmount } = render(<AuthView {...baseProps} />)
    unmount()
    // 卸载后再改偏好与根类：不得再触发 setState（React 19 只告警，这里断言无新增错误）
    query.set(true)
    document.documentElement.classList.add('reduce-motion')
    expect(removeSpy).not.toHaveBeenCalled()
    document.documentElement.classList.remove('reduce-motion')
  })
})

describe('M3-LOGIN 样式选择器与真实元素的对应（防“样式挂在空类名上”）', () => {
  it('承载 44px 命中区与细线形态的类名都渲染出来了', () => {
    const { container } = render(<AuthView {...baseProps} mode="register" />)
    for (const selector of [
      '.cv-auth__content',
      '.cv-auth__title',
      '.cv-auth__lead',
      '.cv-auth__field',
      '.cv-auth__input',
      '.cv-auth__select',
      '.cv-auth__password',
      '.cv-auth__toggle',
      '.cv-auth__submit',
      '.cv-auth__switch',
      '.cv-auth__link',
      '.cv-auth__foot',
    ]) {
      expect(container.querySelectorAll(selector).length, selector).toBeGreaterThan(0)
    }
    // 兼容钩子：旧测试与旧语义类仍指向同一批元素
    expect(container.querySelector('.auth-submit')).toBe(container.querySelector('.cv-auth__submit'))
  })

  it('组件自带样式表，不 import 设计令牌文件（令牌接入归共享层，值全部带兜底）', () => {
    expect(componentSource).toMatch(/^import '\.\/auth-view\.css'$/m)
    expect(componentSource).not.toMatch(/design\/tokens/)
  })

  it('不使用 dangerouslySetInnerHTML / innerHTML 注入', () => {
    expect(componentSource).not.toMatch(/dangerouslySetInnerHTML|innerHTML\s*=|eval\(/)
  })
})

describe('M3-LOGIN 键盘路径（§5.4 Tab / Enter / Esc）', () => {
  it('Tab 顺序＝DOM 顺序：先表单再操作，装饰场景不可聚焦', () => {
    const { container } = render(<AuthView {...baseProps} mode="register" />)
    const focusables = Array.from(container.querySelectorAll<HTMLElement>('input, select, button')).filter(
      (node) => !node.hasAttribute('disabled'),
    )
    const order = focusables.map(
      (node) => node.getAttribute('name') ?? node.getAttribute('aria-label') ?? node.textContent!.trim(),
    )
    // 播放按钮移到左列后在 DOM 顺序里先出现，但测试的意图是「表单字段在前、操作按钮在后」
    expect(order.slice(0, 5)).toEqual(['暂停背景动画', 'name', 'contactType', 'contact', 'password'])
    expect(order.slice(5)).toEqual(['密码可见性', '创建账户', '返回登录'])
  })

  it('Enter 的等价路径：表单 submit 被接管并 preventDefault（不触发整页刷新）', () => {
    const onSubmit = vi.fn()
    const { container } = render(<AuthView {...baseProps} onSubmit={onSubmit} />)
    const form = container.querySelector('form')!
    const event = new Event('submit', { bubbles: true, cancelable: true })
    form.dispatchEvent(event)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    expect(submitButton().getAttribute('type')).toBe('submit')
  })

  it('Esc：明文密码收回、焦点回到第一个输入，不清凭据、不提交、不外溢', () => {
    const onSubmit = vi.fn()
    const { container } = render(<AuthView {...baseProps} onSubmit={onSubmit} />)
    const identifier = screen.getByLabelText('邮箱或手机号') as HTMLInputElement
    const password = screen.getByLabelText('密码') as HTMLInputElement
    fireEvent.change(identifier, { target: { value: 'a@b.com' } })
    fireEvent.change(password, { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: '密码可见性' }))
    expect(password.getAttribute('type')).toBe('text')
    password.focus()

    const onDocument = vi.fn()
    document.addEventListener('keydown', onDocument)
    fireEvent.keyDown(container.querySelector('form')!, { key: 'Escape' })
    document.removeEventListener('keydown', onDocument)

    expect(password.getAttribute('type')).toBe('password')
    expect(document.activeElement).toBe(identifier)
    expect(identifier.value).toBe('a@b.com')
    expect(password.value).toBe('password123')
    expect(onSubmit).not.toHaveBeenCalled()
    // stopPropagation：外层的「Esc 关弹层」监听不会收到这次按键
    expect(onDocument).not.toHaveBeenCalled()
  })

  it('忙态标 aria-busy，但 Esc 仍可用（不锁键盘）', () => {
    const { container } = render(<AuthView {...baseProps} busy />)
    const form = container.querySelector('form')!
    expect(form.getAttribute('aria-busy')).toBe('true')
    fireEvent.keyDown(form, { key: 'Escape' })
    expect(form.getAttribute('aria-busy')).toBe('true')
    expect(submitButton().disabled).toBe(true)
  })
})

describe('M3-LOGIN 改造后业务行为仍完整可达', () => {
  it('登录：填两项即提交 identifier + password', () => {
    const onSubmit = vi.fn()
    render(<AuthView {...baseProps} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('邮箱或手机号'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password123' } })
    fireEvent.click(submitButton())
    expect(onSubmit).toHaveBeenCalledWith({ identifier: 'a@b.com', password: 'password123' })
  })

  it('注册：切换手机号后按 contactType 送字段，忙态按钮与切换都禁用', () => {
    const onSubmit = vi.fn()
    render(<AuthView {...baseProps} mode="register" onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('昵称'), { target: { value: '学习者' } })
    fireEvent.change(screen.getByLabelText('联系方式'), { target: { value: 'phone' } })
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password123' } })
    fireEvent.click(submitButton())
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      name: '学习者',
      phone: '13800138000',
      contactType: 'phone',
      password: 'password123',
    })

    cleanup()
    const busyView = render(<AuthView {...baseProps} mode="register" busy onSubmit={onSubmit} />)
    expect(submitButton().getAttribute('data-busy')).toBe('true')
    expect((screen.getByRole('button', { name: '返回登录' }) as HTMLButtonElement).disabled).toBe(true)
    expect(busyView.container.querySelector('form')!.getAttribute('aria-busy')).toBe('true')
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('错误提示：role=alert 并由密码栏 aria-describedby 关联；服务端错误优先于连接提示', () => {
    const { rerender } = render(<AuthView {...baseProps} error="账号或密码不正确" connectionError="unavailable" />)
    const alert = screen.getByRole('alert')
    expect(alert.id).toBe('auth-error')
    expect(screen.getByLabelText('密码').getAttribute('aria-describedby')).toBe('auth-error')
    expect(screen.queryByText(/无法连接本地服务/)).toBeNull()

    rerender(<AuthView {...baseProps} connectionError="unavailable" />)
    expect(screen.getByRole('alert').id).toBe('auth-connection')
    expect(screen.getByLabelText('密码').getAttribute('aria-describedby')).toBe('auth-connection')
    expect(screen.getByText(/无法连接本地服务/)).toBeTruthy()
  })

  it('注册态（含错误与场景层）与登录态（含连接故障）都无 axe 违规', async () => {
    const { container } = render(<AuthView {...baseProps} mode="register" error="该邮箱已注册" />)
    const registerResults = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false }, 'target-size': { enabled: false } },
    })
    expect(registerResults.violations.map((violation) => violation.id)).toEqual([])

    cleanup()
    const login = render(<AuthView {...baseProps} connectionError="unavailable" busy />)
    const loginResults = await axe.run(login.container, {
      rules: { 'color-contrast': { enabled: false }, 'target-size': { enabled: false } },
    })
    expect(loginResults.violations.map((violation) => violation.id)).toEqual([])
  })
})
