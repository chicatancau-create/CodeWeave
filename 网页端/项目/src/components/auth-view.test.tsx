// @vitest-environment jsdom
/**
 * LOGIN-01 登录/注册界面契约测试。
 *
 * 覆盖 T.3 任务卡列出的缺口：
 * - 提交按钮必须按模式区分文案与忙态文案（登录/创建账户，正在登录…/正在创建…）
 * - 忙态按钮必须带 data-busy 且禁用，且始终 type="submit"
 * - 密码栏必须由独立 label（htmlFor/id）关联，眼睛按钮 type="button"、aria-pressed 正确
 * - 显示/隐藏密码不得清空输入、不得改变光标位置、不得提交表单
 * - contactType 必须是受控状态，切换后联系方式输入的 type/inputMode 随之变化
 * - 模式切换按钮在 busy 时禁用
 * - 密码长度提示必须与后端 8-128 字符一致
 *
 * 断言风格与项目现有 jsdom 测试（challenges-view.test.tsx）保持一致：
 * 直接读取 DOM 属性，不依赖 jest-dom 匹配器。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthView } from './auth-view'

const baseProps = {
  error: '',
  busy: false,
  onModeChange: vi.fn(),
  onSubmit: vi.fn(),
}

/** 主提交按钮：class 唯一，避免与“注册新账户”等文案冲突。 */
function submitButton(): HTMLButtonElement {
  const button = document.querySelector('.auth-submit')
  if (!button) throw new Error('未找到主提交按钮')
  return button as HTMLButtonElement
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('LOGIN-01 提交按钮文案与忙态', () => {
  it('登录模式主按钮文案为“登录”，且为 submit 类型', () => {
    render(<AuthView {...baseProps} mode="login" />)
    const button = submitButton()
    expect(button.getAttribute('type')).toBe('submit')
    expect(button.textContent).toContain('登录')
    expect(button.textContent).not.toContain('正在登录')
  })

  it('注册模式主按钮文案为“创建账户”而不是“注册”', () => {
    render(<AuthView {...baseProps} mode="register" />)
    expect(submitButton().textContent).toContain('创建账户')
  })

  it('登录忙态文案为“正在登录…”，带 data-busy 且禁用', () => {
    render(<AuthView {...baseProps} mode="login" busy />)
    const button = submitButton()
    expect(button.textContent).toContain('正在登录')
    expect(button.getAttribute('data-busy')).toBe('true')
    expect(button.disabled).toBe(true)
  })

  it('注册忙态文案为“正在创建…”，带 data-busy 且禁用', () => {
    render(<AuthView {...baseProps} mode="register" busy />)
    const button = submitButton()
    expect(button.textContent).toContain('正在创建')
    expect(button.getAttribute('data-busy')).toBe('true')
    expect(button.disabled).toBe(true)
  })

  it('非忙态不声明 data-busy', () => {
    render(<AuthView {...baseProps} mode="login" />)
    expect(submitButton().getAttribute('data-busy')).toBeNull()
  })
})

describe('LOGIN-01 密码栏可访问性', () => {
  it('密码输入由独立 label 关联（htmlFor/id）', () => {
    render(<AuthView {...baseProps} mode="login" />)
    const input = screen.getByLabelText('密码') as HTMLInputElement
    expect(input.getAttribute('type')).toBe('password')
    expect(input.id).toBeTruthy()
    expect(input.name).toBe('password')
  })

  it('眼睛按钮为 type="button"：名称稳定不随状态改字，状态由 aria-pressed 承载', () => {
    render(<AuthView {...baseProps} mode="login" />)
    const toggle = screen.getByRole('button', { name: '密码可见性' })
    expect(toggle.getAttribute('type')).toBe('button')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(toggle)
    // 按下之后仍然叫同一个名字：改版前把它改成「隐藏密码」，与 aria-pressed=true 一起
    // 会被读成「显示密码，已按下」这类自相矛盾的播报（LOGIN-01 第 6 条）。
    const after = screen.getByRole('button', { name: '密码可见性' })
    expect(after.getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('button', { name: '显示密码' })).toBeNull()
    expect(screen.queryByRole('button', { name: '隐藏密码' })).toBeNull()
    // 目视用户的动作提示留在 title 上，随状态给出「显示/隐藏」两种说法。
    expect(after.getAttribute('title')).toBe('隐藏密码')

    const input = screen.getByLabelText('密码') as HTMLInputElement
    expect(input.getAttribute('type')).toBe('text')
  })

  it('显示/隐藏密码不清空输入、不移动光标、不提交表单', () => {
    const onSubmit = vi.fn()
    render(<AuthView {...baseProps} mode="login" onSubmit={onSubmit} />)
    const input = screen.getByLabelText('密码') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'password123' } })
    input.setSelectionRange(4, 4)

    fireEvent.click(screen.getByRole('button', { name: '密码可见性' }))

    expect(input.value).toBe('password123')
    expect(input.selectionStart).toBe(4)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('密码长度提示与后端 8-128 字符一致', () => {
    render(<AuthView {...baseProps} mode="register" />)
    const input = screen.getByLabelText('密码') as HTMLInputElement
    expect(input.getAttribute('minlength')).toBe('8')
    expect(input.getAttribute('maxlength')).toBe('128')
    expect(input.getAttribute('placeholder')).toContain('8')
  })
})

describe('LOGIN-01 注册联系方式受控', () => {
  it('默认 contactType 为邮箱，联系方式输入 type="email"', () => {
    render(<AuthView {...baseProps} mode="register" />)
    const select = screen.getByLabelText('联系方式') as HTMLSelectElement
    const contact = screen.getByLabelText('邮箱') as HTMLInputElement
    expect(select.value).toBe('email')
    expect(contact.getAttribute('type')).toBe('email')
  })

  it('contactType 切换后联系方式输入切换到 type="tel" 与 inputMode="tel"', () => {
    render(<AuthView {...baseProps} mode="register" />)
    const select = screen.getByLabelText('联系方式') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'phone' } })

    const phone = screen.getByLabelText('手机号') as HTMLInputElement
    expect(phone.getAttribute('type')).toBe('tel')
    expect(phone.getAttribute('inputmode')).toBe('tel')
    // 切换后不应再残留邮箱输入
    expect(screen.queryByLabelText('邮箱')).toBeNull()
  })

  it('注册提交按当前 contactType 发送对应字段', () => {
    const onSubmit = vi.fn()
    render(<AuthView {...baseProps} mode="register" onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('昵称'), { target: { value: '学习者' } })
    fireEvent.change(screen.getByLabelText('联系方式'), { target: { value: 'phone' } })
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password123' } })
    fireEvent.click(submitButton())

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      name: '学习者',
      phone: '13800138000',
      contactType: 'phone',
      password: 'password123',
    })
  })

  it('登录模式只提交 identifier 与 password，不发送 contactType', () => {
    const onSubmit = vi.fn()
    render(<AuthView {...baseProps} mode="login" onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('邮箱或手机号'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password123' } })
    fireEvent.click(submitButton())

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]![0]).toEqual({ identifier: 'a@b.com', password: 'password123' })
  })
})

describe('LOGIN-01 模式切换', () => {
  it('模式切换按钮在 busy 时禁用', () => {
    render(<AuthView {...baseProps} mode="login" busy />)
    const switcher = screen.getByRole('button', { name: '注册新账户' }) as HTMLButtonElement
    expect(switcher.disabled).toBe(true)
  })

  it('模式切换按钮在非 busy 时可点击并回调', () => {
    const onModeChange = vi.fn()
    render(<AuthView {...baseProps} mode="login" onModeChange={onModeChange} />)
    fireEvent.click(screen.getByRole('button', { name: '注册新账户' }))
    expect(onModeChange).toHaveBeenCalledWith('register')
  })
})

describe('LOGIN-01 错误显示优先级', () => {
  it('服务端错误存在时不重复显示连接提示', () => {
    render(<AuthView {...baseProps} mode="login" error="账号或密码不正确" connectionError="unavailable" />)
    expect(screen.queryByText(/无法连接本地服务/)).toBeNull()
    expect(screen.getByText('账号或密码不正确')).toBeDefined()
  })

  it('无服务端错误时显示连接提示', () => {
    render(<AuthView {...baseProps} mode="login" connectionError="unavailable" />)
    const hint = screen.getByText(/无法连接本地服务/)
    expect(hint).toBeDefined()
    expect(hint.textContent).toContain('corepack pnpm server:start')
    expect(hint.textContent).toContain('corepack pnpm dev')
  })
})

describe('LOGIN-01 无障碍契约（axe-core）', () => {
  it('登录态与注册态均无 axe 违规（标签、按钮名、表单结构）', async () => {
    const { container } = render(<AuthView {...baseProps} mode="login" />)
    const loginResults = await axe.run(container, {
      rules: {
        // jsdom 无真实布局，色彩对比与目标尺寸由人工/构建期核对（见 总工程方案验收基线）
        'color-contrast': { enabled: false },
        'target-size': { enabled: false },
      },
    })
    expect(loginResults.violations.map((v) => v.id)).toEqual([])

    cleanup()
    const { container: registerContainer } = render(<AuthView {...baseProps} mode="register" />)
    const registerResults = await axe.run(registerContainer, {
      rules: {
        'color-contrast': { enabled: false },
        'target-size': { enabled: false },
      },
    })
    expect(registerResults.violations.map((v) => v.id)).toEqual([])
  })
})
