// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AccountMenu } from './AccountMenu'

afterEach(cleanup)

it('账户菜单首项聚焦，方向键循环，Home/End 定位，Esc 归还触发按钮', () => {
  render(<AccountMenu
    user={{ id: 'menu-test', name: '测试', bio: '', createdAt: '2026-11-07' }}
    onNavigateProfile={vi.fn()} onNavigateSecurity={vi.fn()} onNavigateData={vi.fn()}
    onExportData={vi.fn()} onLogout={vi.fn()}
  />)
  const trigger = screen.getByRole('button', { name: '账户菜单' })
  fireEvent.click(trigger)
  const items = screen.getAllByRole('menuitem')
  expect(document.activeElement).toBe(items[0])
  expect(items.map((item) => item.tabIndex)).toEqual([0, -1, -1, -1, -1])
  fireEvent.keyDown(items[0]!, { key: 'ArrowUp' })
  expect(document.activeElement).toBe(items[4])
  fireEvent.keyDown(items[4]!, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(items[0])
  fireEvent.keyDown(items[0]!, { key: 'End' })
  expect(document.activeElement).toBe(items[4])
  fireEvent.keyDown(items[4]!, { key: 'Home' })
  expect(document.activeElement).toBe(items[0])
  fireEvent.keyDown(items[0]!, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(items[1])
  expect(items.map((item) => item.tabIndex)).toEqual([-1, 0, -1, -1, -1])
  fireEvent.keyDown(items[1]!, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})
