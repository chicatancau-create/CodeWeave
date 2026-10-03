import { useEffect, useRef, type RefObject } from 'react'

/**
 * 模态框焦点管理（R6）：让 role="dialog" + aria-modal="true" 名副其实。
 *
 * 只保住「键盘用户可以完整使用并安全退出」这一条底线：
 * - 打开时把初始焦点移入对话框（优先 [data-autofocus]，其次第一个可聚焦元素）
 * - Tab / Shift+Tab 在对话框内循环，不会跑到背景页面
 * - 打开期间锁定 body 滚动，关闭后恢复
 * - 卸载时把焦点还给打开它的触发元素
 *
 * 刻意不做的事：不接管 Escape（由调用方决定是否关闭）、不模仿原生 <dialog>
 * 的 top-layer 行为、不做 inert 全页扫描（成本高且本项目弹窗层级简单）。
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * 元素是否参与 Tab 序列。
 * 不用 offsetParent 判定：jsdom 中它恒为 null，会让过滤在测试环境里误删全部元素。
 * 改为过滤 hidden 属性、aria-hidden 祖先与显式 display:none。
 */
function isFocusable(element: HTMLElement): boolean {
  if (element.hasAttribute('hidden')) return false
  if (element.closest('[aria-hidden="true"]')) return false
  // jsdom 的 getComputedStyle 对未挂载样式表返回空值，因此只在明确判定为 none 时排除。
  const style = window.getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

function focusableItems(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isFocusable)
}

export function useModalFocusTrap<T extends HTMLElement>(active = true): RefObject<T | null> {
  const containerRef = useRef<T | null>(null)

  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    // 打开时移动初始焦点：优先显式标记，否则第一个可聚焦元素，最后退化为容器本身。
    const items = focusableItems(container)
    const initial = container.querySelector<HTMLElement>('[data-autofocus]')
    const target = initial ?? items[0] ?? container
    if (target === container && !container.hasAttribute('tabindex')) {
      // 容器本身聚焦时避免出现可见轮廓（它只是兜底落点）。
      container.setAttribute('tabindex', '-1')
    }
    target.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const current = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isFocusable)
      if (current.length === 0) {
        event.preventDefault()
        container.focus()
        return
      }
      const firstItem = current[0]!
      const lastItem = current[current.length - 1]!
      const active = document.activeElement as HTMLElement | null
      if (!event.shiftKey && active === lastItem) {
        event.preventDefault()
        firstItem.focus()
      } else if (event.shiftKey && (active === firstItem || active === container)) {
        event.preventDefault()
        lastItem.focus()
      }
    }

    // 锁定背景滚动：记录原值以便精确恢复。
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    container.addEventListener('keydown', handleKeyDown)
    return () => {
      container.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      // 焦点回归触发元素；元素已从 DOM 移除时静默跳过。
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus()
    }
  }, [active])

  return containerRef
}

/**
 * Escape 关闭：只在 active 时监听，避免每个弹窗都挂全局监听。
 * 与 useModalFocusTrap 分开，是因为某些浮层（如日历）只需要其中一个行为。
 */
export function useEscapeToClose(onClose: () => void, active = true): void {
  useEffect(() => {
    if (!active) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, active])
}
