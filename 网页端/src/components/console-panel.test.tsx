// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConsolePanel } from './console-panel'

/**
 * EDIT-01 第 6 条：输出侧的清空 / 复制 / 错误定位。
 * 三态外观（空 / stdout / 错误）由 subcomponents-base.m4.test.tsx 管，这里只测动作。
 */
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const writeText = vi.fn()

const withClipboard = (impl?: { writeText: typeof writeText }) =>
  vi.stubGlobal('navigator', { ...(typeof navigator === 'undefined' ? {} : navigator), clipboard: impl })

describe('清空显示', () => {
  it('清空只清这一块的显示：行不在了，父组件给的数组一字未变', () => {
    const output = ['第一行', '第二行']
    const { container } = render(<ConsolePanel output={output} />)
    fireEvent.click(screen.getByRole('button', { name: /清空显示/ }))
    expect(container.querySelectorAll('.console-line')).toHaveLength(0)
    expect(screen.getByText(/显示已清空/)).toBeTruthy()
    // 审计卡那句「清输出不删除提交证据」：清空没有任何回调可往外跑，数组也仍是那两条
    expect(output).toEqual(['第一行', '第二行'])
  })

  it('清空之后新到的行照常显示（逐帧推进不会被一次清空闷住）', () => {
    const { container, rerender } = render(<ConsolePanel output={['a']} />)
    fireEvent.click(screen.getByRole('button', { name: /清空显示/ }))
    rerender(<ConsolePanel output={['a', 'b']} />)
    expect([...container.querySelectorAll('.console-line')].map((node) => node.textContent)).toEqual(['›b'])
  })

  it('重新运行输出变短：清空范围自动复位，显示完整新结果', () => {
    const { container, rerender } = render(<ConsolePanel output={['a', 'b', 'c']} />)
    fireEvent.click(screen.getByRole('button', { name: /清空显示/ }))
    rerender(<ConsolePanel output={['x']} />)
    expect([...container.querySelectorAll('.console-line')].map((node) => node.textContent)).toEqual(['›x'])
    expect(screen.getByRole('button', { name: /清空显示/ })).toBeTruthy()
  })

  it('没有输出时不画清空按钮', () => {
    render(<ConsolePanel output={[]} />)
    expect(screen.queryByRole('button', { name: /清空显示/ })).toBeNull()
  })
})

describe('复制输出', () => {
  it('复制的是点下去这一刻屏幕上的那份，不是完整运行结果', async () => {
    withClipboard({ writeText })
    const { rerender } = render(<ConsolePanel output={['a', 'b']} />)
    fireEvent.click(screen.getByRole('button', { name: /清空显示/ }))
    rerender(<ConsolePanel output={['a', 'b', 'c']} />)
    fireEvent.click(screen.getByRole('button', { name: /复制输出/ }))
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('c'))
  })

  it('成功与否写在按钮自己的名字上，面板里不多一个 role=status 抢播报', async () => {
    withClipboard({ writeText })
    const { container } = render(<ConsolePanel output={['a']} />)
    // 工作台已经有一条 role="status"（执行等级提示），这里再挂一条就会两条活区互相抢
    expect(container.querySelector('[role="status"]')).toBeNull()
    const button = screen.getByRole('button', { name: /复制输出/ })
    fireEvent.click(button)
    // await 之前不报成功
    expect(button.textContent).toContain('复制输出')
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /已复制到剪贴板/ })).toBeTruthy())
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('权限被拒时说失败，不假装复制好了', async () => {
    withClipboard({ writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) })
    render(<ConsolePanel output={['a']} />)
    fireEvent.click(screen.getByRole('button', { name: /复制输出/ }))
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: /复制失败，请手动选择后按 Ctrl\+C/ })).toBeTruthy(),
    )
  })

  it('旧环境没有剪贴板 API：不抛异常，走同一条失败提示', async () => {
    withClipboard(undefined)
    render(<ConsolePanel output={['a']} />)
    fireEvent.click(screen.getByRole('button', { name: /复制输出/ }))
    await vi.waitFor(() => expect(screen.getByText(/复制失败/)).toBeTruthy())
  })
})

describe('错误定位', () => {
  it('有错误且上层能定位：按钮点名那一行，回调收到同一个行号', () => {
    const onLocateError = vi.fn()
    render(<ConsolePanel output={[]} error={{ line: 3, message: '除数为零' }} onLocateError={onLocateError} />)
    fireEvent.click(screen.getByRole('button', { name: /定位到第 3 行/ }))
    expect(onLocateError).toHaveBeenCalledWith(3)
  })

  it('本单元没有代码（上层不给回调）时不画定位按钮，也不画一个按了没反应的控件', () => {
    render(<ConsolePanel output={[]} error={{ line: 3, message: '除数为零' }} />)
    expect(screen.queryByRole('button', { name: /定位到第/ })).toBeNull()
  })

  it('运行没报错时不画定位按钮', () => {
    render(<ConsolePanel output={['a']} onLocateError={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /定位到第/ })).toBeNull()
  })
})
