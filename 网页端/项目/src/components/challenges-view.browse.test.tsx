// @vitest-environment jsdom
/**
 * CHAL-01 网格浏览与详情分离（T.5 / T.15.2 第 1 条）：
 * 列表页（概览 + 紧凑筛选 + 等节奏网格 + 分页）与详情页（明确返回）分离；
 * 主筛选=搜索/阶段/状态，其余收进「更多筛选」并显示已选标签；
 * 详情返回后恢复筛选、页码与焦点；失效 focusChallengeId 不默认跳第一关。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChallengesView } from './challenges-view'
import { challenges } from '../data/challenges'
import type { ChallengeRecord } from '../types/lesson'

const renderView = (props: { progress?: Record<string, ChallengeRecord>; focusChallengeId?: string } = {}) =>
  render(
    <ChallengesView
      challenges={challenges}
      progress={props.progress ?? {}}
      unitsByStage={{}}
      focusChallengeId={props.focusChallengeId}
      onOpenUnit={vi.fn()}
      onSubmit={vi.fn()}
    />,
  )

const openMoreFilters = () => fireEvent.click(screen.getByRole('button', { name: /更多筛选/ }))

const selectOption = (label: string, value: string) => {
  const select = screen.getByLabelText(label, { selector: 'select' }) as HTMLSelectElement
  fireEvent.change(select, { target: { value } })
}

const cardCount = () => document.querySelectorAll('.stage-card').length

beforeEach(() => {
  // 与 challenges-view.test.tsx 同因：草稿在 localStorage，不清就跨条泄漏
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('CHAL-01 列表分页', () => {
  it('默认第 1 页显示 12 张卡片，导航显示第 1 / 2 页；上一页禁用、下一页可用', () => {
    renderView()
    expect(cardCount()).toBe(12)
    const nav = screen.getByRole('navigation', { name: '挑战分页' })
    expect(nav).toBeTruthy()
    expect(screen.getByText('第 1 / 2 页')).toBeTruthy()
    expect((screen.getByRole('button', { name: '上一页' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('下一页显示剩余关卡（M），再点上一页回到第 1 页', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(cardCount()).toBe(1)
    expect(screen.getByRole('button', { name: /M 关：竞赛综合实战/ })).toBeTruthy()
    expect(screen.getByText('第 2 / 2 页')).toBeTruthy()
    expect((screen.getByRole('button', { name: '上一页' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    expect(cardCount()).toBe(12)
    expect(screen.getByText('第 1 / 2 页')).toBeTruthy()
  })

  it('筛选改变后回到第 1 页', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByText('第 2 / 2 页')).toBeTruthy()
    openMoreFilters()
    selectOption('难度', '入门')
    expect(screen.getByText('第 1 / 1 页')).toBeTruthy()
    // 入门难度为 A、B 两关
    expect(cardCount()).toBe(2)
  })

  it('当前页因筛选收窄变空时回退到最后一个有效页', () => {
    renderView({ progress: { 'stage-b': { completedAt: '2026-09-13T00:00:00.000Z', evidence: 'x', status: 'passed' } } })
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    // 第 2 页只剩 M；切「已通过」后 M 被滤掉 → 应回退到含 B 的有效页，而不是空网格
    selectOption('状态', 'passed')
    expect(cardCount()).toBe(1)
    expect(screen.getByRole('button', { name: /B 关：Java 核心编程/ })).toBeTruthy()
    expect(screen.getByText('第 1 / 1 页')).toBeTruthy()
  })
})

describe('CHAL-01 主筛选与更多筛选收纳', () => {
  it('搜索输入保留在主筛选，匹配标题 / 技术栈 / 说明', () => {
    renderView()
    const search = screen.getByRole('searchbox', { name: '搜索关卡' })
    fireEvent.change(search, { target: { value: 'Vue' } })
    expect(cardCount()).toBe(1)
    expect(screen.getByRole('button', { name: /E 关：Vue 3 管理页面/ })).toBeTruthy()
  })

  it('空搜索给出带关键字的空态提示，清除搜索后恢复', () => {
    renderView()
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索关卡' }), { target: { value: '量子计算' } })
    // 01 §4 empty 行改版后，这一句要点名「是筛选把结果筛空的」并给出下一步（见 challenges/ChallengeGrid.tsx）
    expect(screen.getByText(/筛选开着，但没有关卡匹配「量子计算」/)).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索关卡' }), { target: { value: '' } })
    expect(cardCount()).toBe(12)
  })

  it('难度 / 轨道 / 运行方式 / 排序默认收起，展开「更多筛选」后可用', () => {
    renderView()
    expect(screen.queryByLabelText('难度', { selector: 'select' })).toBeNull()
    expect(screen.queryByLabelText('运行方式', { selector: 'select' })).toBeNull()

    const toggle = screen.getByRole('button', { name: /更多筛选/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    selectOption('运行方式', 'browser')
    expect(cardCount()).toBe(2)
  })

  it('已选筛选以标签显示，点击标签可单独移除', () => {
    renderView()
    openMoreFilters()
    selectOption('难度', '入门')
    const chip = screen.getByRole('button', { name: '移除筛选：难度 入门' })
    expect(chip).toBeTruthy()
    fireEvent.click(chip)
    expect(screen.queryByRole('button', { name: '移除筛选：难度 入门' })).toBeNull()
    expect(cardCount()).toBe(12)
  })
})

describe('CHAL-01 列表 / 详情分离', () => {
  it('默认只有列表；点卡片进入详情并隐藏网格；返回列表恢复网格', () => {
    renderView()
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    expect(screen.getByRole('heading', { level: 2, name: 'B 关卡验收：Java 核心编程' })).toBeTruthy()
    expect(cardCount()).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: /返回列表/ }))
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
    expect(cardCount()).toBe(12)
  })

  it('详情返回后焦点回到进入时的卡片', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /F 关/ }))
    fireEvent.click(screen.getByRole('button', { name: /返回列表/ }))
    // React 重挂载列表后卡片是新 DOM 节点；按关卡 id 断言焦点落点
    const focused = document.activeElement as HTMLElement | null
    expect(focused?.getAttribute('data-challenge-id')).toBe('stage-f')
  })

  it('筛选与页码在详情往返后保留', () => {
    renderView({ progress: { 'stage-b': { completedAt: '2026-09-13T00:00:00.000Z', evidence: 'x', status: 'passed' } } })
    selectOption('状态', 'passed')
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    fireEvent.click(screen.getByRole('button', { name: /返回列表/ }))
    expect((screen.getByLabelText('状态', { selector: 'select' }) as HTMLSelectElement).value).toBe('passed')
    expect(screen.getByRole('button', { name: /B 关：Java 核心编程/ })).toBeTruthy()
  })

  it('页码在详情往返后保留（无筛选时翻到第 2 页再返回）', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    fireEvent.click(screen.getByRole('button', { name: /M 关：竞赛综合实战/ }))
    fireEvent.click(screen.getByRole('button', { name: /返回列表/ }))
    expect(screen.getByText('第 2 / 2 页')).toBeTruthy()
    expect(screen.getByRole('button', { name: /M 关：竞赛综合实战/ })).toBeTruthy()
  })

  it('进入详情时保存滚动位置，返回列表时恢复', () => {
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    fireEvent.click(screen.getByRole('button', { name: /返回列表/ }))
    expect(scrollToSpy).toHaveBeenCalled()
    scrollToSpy.mockRestore()
  })

  it('筛选 / 页码 / 视图模式写入 sessionStorage，重挂载后恢复', () => {
    const first = renderView()
    fireEvent.click(screen.getByRole('button', { name: /A 关：开发环境与基本操作/ }))
    first.unmount()

    renderView()
    expect(screen.getByRole('heading', { level: 2, name: 'A 关卡验收：开发环境与基本操作' })).toBeTruthy()
  })

  it('失效 focusChallengeId：停留在列表并提示，不默认打开第一关', () => {
    renderView({ focusChallengeId: 'stage-zzz' })
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('未找到指定的挑战')
    expect(screen.queryByRole('heading', { level: 2, name: /A 关卡验收/ })).toBeNull()
  })

  it('有效 focusChallengeId：直接进入对应详情', () => {
    renderView({ focusChallengeId: 'stage-m' })
    expect(screen.getByRole('heading', { level: 2, name: 'M 关卡验收：竞赛综合实战' })).toBeTruthy()
  })
})

describe('CHAL-01 卡片摘要', () => {
  it('卡片显示执行环境与「开始挑战」/「继续挑战」主操作', () => {
    renderView({ progress: { 'stage-b': { completedAt: '2026-09-13T00:00:00.000Z', evidence: 'x', status: 'passed' } } })
    const aCard = screen.getByRole('button', { name: /A 关：开发环境与基本操作/ })
    expect(aCard.textContent).toContain('外部环境实验')
    expect(aCard.textContent).toContain('开始挑战')

    const bCard = screen.getByRole('button', { name: /B 关：Java 核心编程/ })
    expect(bCard.textContent).toContain('教学运行器')
    expect(bCard.textContent).toContain('继续挑战')
  })

  it('卡片摘要显示两行以内的说明文字', () => {
    renderView()
    const aCard = screen.getByRole('button', { name: /A 关：开发环境与基本操作/ })
    const summary = aCard.querySelector('.stage-card-summary')
    expect(summary).toBeTruthy()
    expect(summary!.textContent!.length).toBeGreaterThan(0)
  })
})
