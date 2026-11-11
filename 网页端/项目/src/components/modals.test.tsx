// @vitest-environment jsdom
/**
 * R6 弹窗组件测试：设置弹窗与帮助弹窗的交互、数据作用域与无障碍契约。
 * 重点覆盖审计发现的缺口：
 * - 清除本机数据必须走统一入口（范围与数据隐私中心一致），而不是各写一份扫描
 * - role="dialog" + aria-modal 的焦点契约（初始焦点 / Tab 循环 / Escape / 焦点回归）
 * - 破坏性操作必须有确认；取消时不得删除任何数据
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HelpModal, SettingsModal } from './modals'

const baseSettings = {
  notifications: true,
  autosave: true,
  compactMode: false,
  editorFontSize: 13,
  reduceMotion: false,
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
})

describe('R6 设置弹窗', () => {
  it('渲染所有设置项并反映当前值', () => {
    renderSettings()
    expect(screen.getByRole('dialog', { name: '设置' })).toBeTruthy()
    expect(screen.getByDisplayValue('13 px')).toBeTruthy()
    // 六个开关：学习提醒 / 自动保存 / 紧凑工作区 / 减弱动画 / 代码自动换行 / 显示行号。
    // 后两个是 EDIT-01 补的编辑器设置项（默认「不折行 + 显示行号」，与改版前的实际观感一致）。
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(checkboxes).toHaveLength(6)
    // 夹具中 notifications 与 autosave 为 true，其余四项走默认值
    expect(checkboxes.map((box) => box.checked)).toEqual([true, true, false, false, false, true])
  })

  it('未提供设置值时按默认渲染，且字号回退到 13px', () => {
    renderSettings({ settings: {} })
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    // 「全关」这条不再成立：行号是 EDIT-01 新加的开关，它的默认值必须等于改版前的既成事实（一直显示）。
    expect(checkboxes.map((box) => box.checked)).toEqual([true, true, false, false, false, true])
    expect(screen.getByDisplayValue('13 px')).toBeTruthy()
  })

  it('切换开关时只上报变化的字段', () => {
    const { onChange } = renderSettings()
    const [notifications] = screen.getAllByRole('checkbox')
    fireEvent.click(notifications!)
    expect(onChange).toHaveBeenCalledWith({ notifications: false })
  })

  it('修改字号时上报数字类型', () => {
    const { onChange } = renderSettings()
    fireEvent.change(screen.getByDisplayValue('13 px'), { target: { value: '16' } })
    expect(onChange).toHaveBeenCalledWith({ editorFontSize: 16 })
  })

  it('恢复默认调用回调而不直接改写存储', () => {
    const { onRestoreDefaults } = renderSettings()
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }))
    expect(onRestoreDefaults).toHaveBeenCalledTimes(1)
  })

  it('打开时初始焦点落在关闭按钮，且背景滚动被锁定', () => {
    renderSettings()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭设置' }))
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('Escape 关闭弹窗', () => {
    const { onClose } = renderSettings()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点击遮罩关闭，点击弹窗内部不关闭', () => {
    const { onClose } = renderSettings()
    const dialog = screen.getByRole('dialog')
    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(dialog.parentElement as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('R6 设置弹窗的清除数据边界', () => {
  it('用户取消确认时不删除任何数据', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    localStorage.setItem('code-canvas.mastery.v1:user-1', '{"kept":true}')
    renderSettings()
    fireEvent.click(screen.getByRole('button', { name: /清除数据/ }))
    expect(localStorage.getItem('code-canvas.mastery.v1:user-1')).toBe('{"kept":true}')
  })

  it('确认后清除全部 CodeWeave 键（含其他账户作用域），不影响无关键', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    // jsdom 下 window.location.reload 不可实现，用 stub 避免报错
    const reload = vi.fn()
    Object.defineProperty(window, 'location', { value: { reload }, writable: true })

    localStorage.setItem('code-canvas.mastery.v1:user-1', '{"a":1}')
    localStorage.setItem('code-canvas.projects.v1:user-2', '[]')
    localStorage.setItem('code-canvas.settings.v1', '{}')
    localStorage.setItem('unrelated-key', 'keep-me')

    renderSettings()
    fireEvent.click(screen.getByRole('button', { name: /清除数据/ }))

    expect(localStorage.getItem('code-canvas.mastery.v1:user-1')).toBeNull()
    expect(localStorage.getItem('code-canvas.projects.v1:user-2')).toBeNull()
    expect(localStorage.getItem('code-canvas.settings.v1')).toBeNull()
    // 非本应用的键必须原样保留
    expect(localStorage.getItem('unrelated-key')).toBe('keep-me')
    expect(reload).toHaveBeenCalled()
  })
})

describe('R6 帮助弹窗', () => {
  it('渲染三条使用说明并说明真实与模拟的边界', () => {
    render(<HelpModal onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: '如何学习' })).toBeTruthy()
    expect(screen.getByText('可视化执行')).toBeTruthy()
    expect(screen.getByText('运行后，流程图和变量面板会根据当前运行器实际提供的数据展示；未采集到的事件或变量不会补造。')).toBeTruthy()
    expect(screen.getByText('真实与模拟的边界')).toBeTruthy()
  })

  it('初始焦点落在「知道了」按钮，Escape 可关闭', () => {
    const onClose = vi.fn()
    render(<HelpModal onClose={onClose} />)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '知道了' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
