// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Trophy } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MovingBorderButton } from './moving-border'

afterEach(() => {
  cleanup()
})

describe('MovingBorderButton（B6 原生重建）', () => {
  it('渲染为真实 button，内容可见，光束层存在且 aria-hidden', () => {
    render(
      <MovingBorderButton>
        <Trophy size={14} />
        提交答案
      </MovingBorderButton>,
    )
    const button = screen.getByRole('button', { name: /提交答案/ })
    expect(button).toBeTruthy()
    const beam = button.querySelector('.moving-border__beam')
    expect(beam?.getAttribute('aria-hidden')).toBe('true')
    expect(button.querySelector('.moving-border__content')?.textContent).toContain('提交答案')
  })

  it('激活态带动画类；禁用或 beam=false 时不带（动画降级）', () => {
    const { rerender } = render(<MovingBorderButton>提交</MovingBorderButton>)
    expect(document.querySelector('.moving-border')?.className).toContain('moving-border--active')

    rerender(<MovingBorderButton disabled>提交</MovingBorderButton>)
    expect(document.querySelector('.moving-border')?.className).not.toContain('moving-border--active')

    rerender(<MovingBorderButton beam={false}>提交</MovingBorderButton>)
    expect(document.querySelector('.moving-border')?.className).not.toContain('moving-border--active')
  })

  it('点击与键盘行为不变：onClick 触发、透传 type/disabled', () => {
    const onClick = vi.fn()
    render(
      <MovingBorderButton onClick={onClick} disabled>
        提交
      </MovingBorderButton>,
    )
    const button = screen.getByRole('button', { name: '提交' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()

    cleanup()
    render(<MovingBorderButton onClick={onClick}>提交</MovingBorderButton>)
    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
