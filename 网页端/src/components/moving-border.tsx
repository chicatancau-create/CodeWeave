import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * Moving Border 主操作按钮（B6 原生重建）：
 * 边缘有一道缓慢旋转的渐变光束，用于强调“提交”类仪式性操作。
 *
 * - 纯 CSS conic-gradient + transform，零依赖（约 1KB）。
 * - 光束层 aria-hidden 且 pointer-events:none，按钮语义与键盘行为不变。
 * - 降级：active=false（如禁用态）或 reduce-motion 时不转，仅保留静态主按钮样式。
 *   动画层纯装饰，任何情况下点击/键盘提交不受影响。
 */
export type MovingBorderButtonProps = {
  children: ReactNode
  /** 光束是否流动；禁用态传 false */
  beam?: boolean
} & ButtonHTMLAttributes<HTMLButtonElement>

export function MovingBorderButton({ children, beam = true, className = '', ...buttonProps }: MovingBorderButtonProps) {
  return (
    <button
      type="button"
      {...buttonProps}
      className={`moving-border ${beam && !buttonProps.disabled ? 'moving-border--active' : ''} ${className}`.trim()}
    >
      <span className="moving-border__beam" aria-hidden="true" />
      <span className="moving-border__content">{children}</span>
    </button>
  )
}
