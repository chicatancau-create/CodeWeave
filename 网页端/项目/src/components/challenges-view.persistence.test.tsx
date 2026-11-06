// @vitest-environment jsdom
/**
 * R2-B 挑战草稿与证据持久化（AUD-04）。
 * 草稿/证据按账户作用域写入版本化存储层，切页、重挂载、刷新后仍在。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChallengesView } from './challenges-view'
import { challenges } from '../data/challenges'
import { scopedKey, STORAGE_KEYS } from '../utils/constants'

const draftKey = (scope: string) => scopedKey(STORAGE_KEYS.CODE_DRAFTS, scope)

const renderView = (props: { scope?: string } = {}) =>
  render(
    <ChallengesView
      challenges={challenges}
      progress={{}}
      unitsByStage={{}}
      onOpenUnit={vi.fn()}
      onSubmit={vi.fn()}
      scope={props.scope ?? 'user-1'}
    />,
  )

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('R2-B 挑战草稿持久化', () => {
  it('编辑草稿后写入版本化信封存储', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    fireEvent.click(screen.getByRole('tab', { name: '编写与运行' }))
    fireEvent.change(screen.getByRole('textbox', { name: /代码编辑器/ }), {
      target: { value: 'int total = 42;' },
    })
    const raw = localStorage.getItem(draftKey('user-1'))
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!) as { schemaVersion: number; data: Record<string, { code: string }> }
    expect(typeof parsed.schemaVersion).toBe('number')
    expect(parsed.data['stage-b']!.code).toBe('int total = 42;')
  })

  it('不碰编辑器就运行与切页：草稿不得被写成空串、编辑器不得被清空', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    fireEvent.click(screen.getByRole('tab', { name: '编写与运行' }))
    const starter = challenges[1]!.starterCode
    const editorOf = () => screen.getByRole('textbox', { name: /代码编辑器/ }) as HTMLTextAreaElement
    expect(editorOf().value).toBe(starter)

    fireEvent.click(screen.getByRole('button', { name: /运行检查/ }))
    fireEvent.click(screen.getByRole('tab', { name: '提交记录' }))
    fireEvent.click(screen.getByRole('tab', { name: '编写与运行' }))

    // 允许「从头到尾没写过草稿」，不允许「写过一份空草稿把 starter 顶掉」
    const raw = localStorage.getItem(draftKey('user-1'))
    if (raw !== null) {
      const parsed = JSON.parse(raw) as { data: Record<string, { code?: string }> }
      expect(parsed.data['stage-b']?.code).toBeUndefined()
    }
    expect(editorOf().value).toBe(starter)
  })

  it('只填证据不碰代码：草稿不得凭空生出空 code，起始代码不得被顶掉', () => {
    const starter = challenges[1]!.starterCode
    const first = renderView()
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    fireEvent.click(screen.getByRole('tab', { name: '提交记录' }))
    fireEvent.change(screen.getByRole('textbox', { name: '完成证据说明' }), {
      target: { value: '只写了证据说明。' },
    })

    // 存下来的条目里根本不该出现 code 键：写一个空串就等于声明「用户把起始代码删干净了」
    const raw = localStorage.getItem(draftKey('user-1'))
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!) as { data: Record<string, { code?: string; evidence: string }> }
    expect(parsed.data['stage-b']!.evidence).toBe('只写了证据说明。')
    expect('code' in parsed.data['stage-b']!).toBe(false)

    first.unmount()
    renderView()
    fireEvent.click(screen.getByRole('tab', { name: '编写与运行' }))
    expect((screen.getByRole('textbox', { name: /代码编辑器/ }) as HTMLTextAreaElement).value).toBe(starter)
    expect(document.querySelector('.challenge-draft-state--code')?.textContent).toContain('本机无代码草稿')
  })

  it('重新挂载组件后草稿从存储恢复（模拟切页/刷新）', () => {
    const first = renderView()
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    fireEvent.click(screen.getByRole('tab', { name: '编写与运行' }))
    fireEvent.change(screen.getByRole('textbox', { name: /代码编辑器/ }), {
      target: { value: 'int total = 777; // 持久草稿' },
    })
    first.unmount()

    renderView()
    // 视图状态持久化：重挂载后直接恢复到 B 关详情，无需再次选择
    fireEvent.click(screen.getByRole('tab', { name: '编写与运行' }))
    const editor = screen.getByRole('textbox', { name: /代码编辑器/ }) as HTMLTextAreaElement
    expect(editor.value).toContain('持久草稿')
  })

  it('证据说明同样持久化并可在重挂载后恢复', () => {
    const first = renderView()
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    fireEvent.click(screen.getByRole('tab', { name: '提交记录' }))
    fireEvent.change(screen.getByRole('textbox', { name: '完成证据说明' }), {
      target: { value: '证据已写入真实终端并留档。' },
    })
    first.unmount()

    renderView()
    // 视图状态持久化：重挂载后直接恢复到 B 关详情
    fireEvent.click(screen.getByRole('tab', { name: '提交记录' }))
    expect((screen.getByRole('textbox', { name: '完成证据说明' }) as HTMLTextAreaElement).value).toBe(
      '证据已写入真实终端并留档。',
    )
  })

  it('账户作用域隔离：不同 scope 的草稿互不可见', () => {
    const first = renderView({ scope: 'user-a' })
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    fireEvent.click(screen.getByRole('tab', { name: '编写与运行' }))
    fireEvent.change(screen.getByRole('textbox', { name: /代码编辑器/ }), {
      target: { value: '// user-a 私有草稿' },
    })
    first.unmount()

    renderView({ scope: 'user-b' })
    // 视图状态跨 scope 保留，但草稿按 scope 隔离：编辑器应回到起始代码
    fireEvent.click(screen.getByRole('tab', { name: '编写与运行' }))
    const editor = screen.getByRole('textbox', { name: /代码编辑器/ }) as HTMLTextAreaElement
    expect(editor.value).not.toContain('user-a 私有草稿')
  })

  it('草稿存储损坏时回退到起始代码，不抛出', () => {
    localStorage.setItem(draftKey('user-1'), '{broken json')
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    fireEvent.click(screen.getByRole('tab', { name: '编写与运行' }))
    const editor = screen.getByRole('textbox', { name: /代码编辑器/ }) as HTMLTextAreaElement
    expect(editor.value).toContain(challenges[1]!.starterCode.slice(0, 10))
  })

  it('未提供 scope 时退化为 guest 作用域，不串号', () => {
    render(
      <ChallengesView
        challenges={challenges}
        progress={{}}
        unitsByStage={{}}
        onOpenUnit={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    fireEvent.click(screen.getByRole('tab', { name: '编写与运行' }))
    fireEvent.change(screen.getByRole('textbox', { name: /代码编辑器/ }), {
      target: { value: 'int x = 1;' },
    })
    expect(localStorage.getItem(draftKey('guest'))).not.toBeNull()
  })
})
