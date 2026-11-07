import { useEffect, useRef } from 'react'

/** A single Tab stop with arrow-key navigation for the topbar action menus. */
export function useMenuFocus(open: boolean) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const menu = menuRef.current
    if (!open || !menu) return
    const items = () => Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'))
    const focus = (item: HTMLButtonElement | undefined) => {
      if (!item) return
      menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]').forEach((button) => {
        button.tabIndex = button === item ? 0 : -1
      })
      item.focus()
    }
    const onFocus = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof HTMLButtonElement) || target.getAttribute('role') !== 'menuitem') return
      menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]').forEach((button) => {
        button.tabIndex = button === target ? 0 : -1
      })
    }
    const onKey = (event: KeyboardEvent) => {
      const enabled = items()
      if (!enabled.length) return
      const index = enabled.findIndex((item) => item === document.activeElement)
      let next: HTMLButtonElement | undefined
      if (event.key === 'ArrowDown') next = enabled[(index + 1) % enabled.length]
      if (event.key === 'ArrowUp') next = enabled[(index - 1 + enabled.length) % enabled.length]
      if (event.key === 'Home') next = enabled[0]
      if (event.key === 'End') next = enabled.at(-1)
      if (!next) return
      event.preventDefault()
      focus(next)
    }
    menu.addEventListener('focusin', onFocus)
    menu.addEventListener('keydown', onKey)
    focus(items()[0])
    return () => {
      menu.removeEventListener('focusin', onFocus)
      menu.removeEventListener('keydown', onKey)
    }
  }, [open])

  return menuRef
}
