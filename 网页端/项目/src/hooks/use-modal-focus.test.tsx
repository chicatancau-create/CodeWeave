// @vitest-environment jsdom
/**
 * R6 模态框焦点管理：验证 role="dialog" + aria-modal="true" 名副其实。
 * 覆盖：初始焦点、Tab 循环、Shift+Tab 反向循环、Escape 关闭、焦点回归、背景滚动锁定。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEscapeToClose, useModalFocusTrap } from './use-modal-focus'

afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
})

/** 最小可用弹窗：三枚按钮足以观察循环边界。 */
function DemoModal({ onClose }: { onClose: () => void }) {
  const ref = useModalFocusTrap<HTMLDivElement>()
  useEscapeToClose(onClose)
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="演示弹窗">
      <button data-autofocus>第一个</button>
      <button>第二个</button>
      <button>最后一个</button>
    </div>
  )
}

/** 打开弹窗的宿主：验证焦点在关闭后回归触发按钮。 */
function Host() {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(true)}>打开弹窗</button>
      {open && <DemoModal onClose={() => setOpen(false)} />}
    </div>
  )
}

describe('R6 模态框焦点陷阱', () => {
  it('打开时把初始焦点移到 [data-autofocus] 元素', () => {
    render(<Host />)
    fireEvent.click(screen.getByRole('button', { name: '打开弹窗' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '第一个' }))
  })

  it('Tab 在最后一个元素上回到第一个（正循环）', () => {
    render(<Host />)
    fireEvent.click(screen.getByRole('button', { name: '打开弹窗' }))
    const last = screen.getByRole('button', { name: '最后一个' })
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '第一个' }))
  })

  it('Shift+Tab 在第一个元素上回到最后一个（反循环）', () => {
    render(<Host />)
    fireEvent.click(screen.getByRole('button', { name: '打开弹窗' }))
    const first = screen.getByRole('button', { name: '第一个' })
    first.focus()
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '最后一个' }))
  })

  it('Escape 触发关闭，且焦点回归打开它的触发按钮', () => {
    render(<Host />)
    const trigger = screen.getByRole('button', { name: '打开弹窗' })
    // jsdom 的 click 不会像真实浏览器那样自动聚焦按钮，这里显式聚焦以模拟真实前提。
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('打开期间锁定背景滚动，关闭后恢复原值', () => {
    document.body.style.overflow = 'auto'
    render(<Host />)
    fireEvent.click(screen.getByRole('button', { name: '打开弹窗' }))
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.body.style.overflow).toBe('auto')
  })

  it('容器内无可聚焦元素时不会抛错，Tab 被收束到容器', () => {
    function EmptyModal() {
      const ref = useModalFocusTrap<HTMLDivElement>()
      return (
        <div ref={ref} role="dialog" aria-modal="true" aria-label="空弹窗">
          <p>没有可聚焦元素</p>
        </div>
      )
    }
    render(<EmptyModal />)
    const dialog = screen.getByRole('dialog')
    expect(document.activeElement).toBe(dialog)
    expect(() => fireEvent.keyDown(dialog, { key: 'Tab' })).not.toThrow()
  })

  it('useEscapeToClose 在 active=false 时不响应', () => {
    const onClose = vi.fn()
    function Inactive() {
      useEscapeToClose(onClose, false)
      return <p>不监听</p>
    }
    render(<Inactive />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('卸载后不再残留 window 键盘监听', () => {
    const onClose = vi.fn()
    function Simple() {
      const ref = useRef<HTMLDivElement>(null)
      useEscapeToClose(onClose)
      return <div ref={ref}>内容</div>
    }
    const view = render(<Simple />)
    view.unmount()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})
