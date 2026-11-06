// @vitest-environment jsdom
/**
 * 关卡清单（ChallengeGrid）的 §4 状态契约测试。
 *
 * 钉三件事：
 * 1. **empty 要同时有原因和下一步**（01 号方案 §4）：以前只有一句「暂无可用的挑战数据。」，
 *    而且在没开任何筛选时也会说成「当前筛选没有匹配的关卡」——那是假原因；
 * 2. 两档原因分开陈述：筛掉了 → 一键清除筛选；本来就没有 → 指向教材那一侧，
 *    且**不给**一个按了什么都不发生的按钮；
 * 3. 清单这一段是**同步**派生（`challenges-view.tsx` 的 `useMemo`，无取数、无防抖），
 *    因此不许出现空转的 loading 骨架；懒加载 chunk 的占位在壳层 `ViewFallback`，
 *    像素级高度与 CLS 要到真实浏览器按 §5.4 取证，这里只锁 DOM 结构与文案。
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChallengeGrid, type ChallengeRow } from './ChallengeGrid'
import type { Challenge } from '../../types/lesson'

function row(id: string): ChallengeRow {
  return {
    challenge: { id, stageId: 'S1', title: `关卡 ${id}`, description: '摘要', difficulty: '入门', runner: 'python', track: '并发' } as unknown as Challenge,
    sequence: '01',
    status: 'not-started',
    hasActivity: false,
    draftFlag: '',
  }
}

function renderGrid(overrides: {
  rows?: ChallengeRow[]
  filtersDirty?: boolean
  hasQuery?: boolean
  query?: string
}) {
  const onResetFilters = vi.fn()
  const onSelect = vi.fn()
  const result = render(
    <ChallengeGrid
      rows={overrides.rows ?? []}
      selectedId=""
      onSelect={onSelect}
      filtersDirty={overrides.filtersDirty ?? false}
      hasQuery={overrides.hasQuery ?? false}
      query={overrides.query ?? ''}
      onResetFilters={onResetFilters}
    />,
  )
  return { ...result, onResetFilters }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('§4 empty · 关卡清单为空时同时给原因和下一步', () => {
  it('筛掉了：说清是筛选的原因，下一步给一键清除筛选的真实动作', () => {
    const { container, onResetFilters } = renderGrid({ filtersDirty: true })
    const empty = container.querySelector('.challenge-grid-empty')
    expect(empty?.getAttribute('role')).toBe('status')
    expect(empty?.textContent).toContain('当前筛选条件下一个关卡都不匹配。')
    expect(empty?.querySelector('.challenge-grid-empty-next')?.textContent).toContain('下一步：清掉筛选条件再看一次全部关卡。')
    fireEvent.click(container.querySelector('.challenge-grid-empty .subtle-button') as HTMLButtonElement)
    expect(onResetFilters).toHaveBeenCalledTimes(1)
  })

  it('带关键词的筛选：原因里点名那个词，下一步仍然是清掉筛选', () => {
    const { container } = renderGrid({ filtersDirty: true, hasQuery: true, query: '竞态' })
    expect(container.textContent).toContain('筛选开着，但没有关卡匹配「竞态」。')
    expect(container.querySelector('.challenge-grid-empty-next')?.textContent).toContain('下一步：')
  })

  it('没开任何筛选却为空：不说成「筛没了」，改说清单本身是空的并指向教材那一侧', () => {
    const { container, onResetFilters } = renderGrid({ filtersDirty: false })
    const empty = container.querySelector('.challenge-grid-empty')
    expect(empty?.textContent).toContain('教材目录里没有带挑战的单元：清单本身是空的，不是被筛掉的。')
    expect(empty?.querySelector('.challenge-grid-empty-next')?.textContent).toContain('下一步：等教材同步完成后重进本页')
    // 没有可做的事就不摆按钮：这一档按下去什么都不发生的控件必须不存在
    expect(empty?.querySelector('button')).toBeNull()
    expect(onResetFilters).not.toHaveBeenCalled()
  })

  it('有数据时照常画编号清单，不出现空态', () => {
    const { container } = renderGrid({ rows: [row('c-1')] })
    expect(container.querySelector('.challenge-grid-empty')).toBeNull()
    expect(container.querySelector('ol.challenge-grid[role="list"]')).toBeTruthy()
  })
})

describe('§4 loading · 同步筛选路径不造空转骨架', () => {
  it('清单为空时也不出现 aria-busy / 骨架：这一段没有取数', () => {
    const { container } = renderGrid({ filtersDirty: true })
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
    expect(container.querySelector('.view-skeleton__shape')).toBeNull()
  })
})
