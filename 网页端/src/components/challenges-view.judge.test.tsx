// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChallengesView } from './challenges-view'
import { challenges } from '../data/challenges'
import type { Challenge, ChallengeRecord } from '../types/lesson'

/**
 * CHAL-02 在界面上的落点：判定明细、口径行、旧记录标注。
 *
 * 全部基于 B 关（教学运行器，起始代码稳定输出 `15`）改验收点，
 * 这样每条断言都是「真实运行器的输出 + 真实判定」，不是打桩出来的通过。
 */
const stageB = challenges[1]!
const withTargets = (targetOutput: string[]): Challenge[] => [{ ...stageB, targetOutput }]

const renderWith = (list: Challenge[], progress: Record<string, ChallengeRecord> = {}) =>
  render(
    <ChallengesView
      challenges={list}
      progress={progress}
      unitsByStage={{}}
      onOpenUnit={vi.fn()}
      onSubmit={vi.fn()}
    />,
  )

const openAndRun = (code?: string) => {
  fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
  fireEvent.click(screen.getByRole('tab', { name: '编写与运行' }))
  if (code !== undefined) {
    fireEvent.change(screen.getByRole('textbox', { name: /代码编辑器/ }), { target: { value: code } })
  }
  fireEvent.click(screen.getByRole('button', { name: /运行检查/ }))
}

/**
 * 运行结果同时渲染在「编写与运行」与「提交记录」两个面板里（隐藏面板仍在 DOM，
 * 沿用改版前的渲染方式），所以逐条明细按**其中一份**来断言，不数文本出现次数。
 */
const judgeRows = () => {
  const list = document.querySelector<HTMLElement>('.judge-cases')
  expect(list, '判定明细未渲染').toBeTruthy()
  return [...list!.querySelectorAll('li')]
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('CHAL-02 · 判定明细', () => {
  it('验收点 1 与 5 不再被输出 15 满足：报不一致，并逐条说明只差在整行相等', async () => {
    renderWith(withTargets(['1', '5']))
    openAndRun()
    expect((await screen.findAllByText(/输出与验收点不一致/)).length).toBeGreaterThan(0)
    // 每条未命中都给出「只有包含它的输出行」这类可行动的理由，而不是一个总分；
    // 那一行 15 谁也没用掉，所以还得多报一条「未匹配」。
    const rows = judgeRows()
    expect(rows.map((row) => row.className)).toEqual(['miss', 'miss', 'extra'])
    expect(rows[0]!.textContent).toContain('只有包含它的输出行「15」')
    expect(rows[1]!.textContent).toContain('只有包含它的输出行「15」')
    expect(rows[2]!.textContent).toContain('多印了 1 行没被任何验收点用掉：15')
  })

  it('重复验收点需要重复输出：一行 15 不能同时满足两条', async () => {
    renderWith(withTargets(['15', '15']))
    openAndRun()
    expect((await screen.findAllByText(/输出与验收点不一致/)).length).toBeGreaterThan(0)
    const rows = judgeRows()
    expect(rows.map((row) => row.className)).toEqual(['hit', 'miss'])
    expect(rows[1]!.textContent).toContain('每行只能用一次')
  })

  it('逐条通过时仍标口径行与每条命中，明细不是一句「一致」就完事', async () => {
    renderWith(withTargets(['15']))
    openAndRun()
    expect((await screen.findAllByText(/输出与验收点一致/)).length).toBeGreaterThan(0)
    const rows = judgeRows()
    expect(rows.map((row) => row.className)).toEqual(['hit'])
    expect(document.querySelector('.judge-mode')?.textContent).toContain('口径：验收点须整行相等')
  })

  it('目标输出清单跟着逐条标态，未运行时无态', async () => {
    renderWith(withTargets(['15', '99']))
    // 未运行：清单不带命中/未命中类
    expect(document.querySelector('.target-output code.hit')).toBeNull()
    expect(document.querySelector('.target-output code.miss')).toBeNull()
    openAndRun()
    await screen.findAllByText(/输出与验收点不一致/)
    expect(document.querySelector('.target-output code.hit')?.textContent).toBe('15')
    expect(document.querySelector('.target-output code.miss')?.textContent).toBe('99')
  })

  it('验收点重复时清单不因文本作 key 撞车：两条都渲染出来', async () => {
    renderWith(withTargets(['15', '15']))
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    expect(screen.getAllByText('15')).toHaveLength(2)
  })

  it('运行报错时不铺判定明细：没有输出可逐条比对', async () => {
    renderWith(withTargets(['15']))
    openAndRun('public class Main {\n    未闭合')
    const blocks = await screen.findAllByText(/输出与验收点不一致|第 \d+ 行/)
    expect(blocks.length).toBeGreaterThan(0)
    expect(screen.queryByText(/口径：验收点须整行相等/)).toBeNull()
  })
})

describe('CHAL-02 第 2 条 · 教学两关的起始代码在真 UI 里真能过', () => {
  /**
   * 「关卡可过」是 #91 那次没人在 UI 层钉住的不变式：D/J 两关在修前**永远**过不去，
   * 而列表与详情界面看不出任何异常。这里只走真实路径：点卡片 → 切「编写与运行」→
   * 点「运行检查」→ 读界面上那句判定，不桩运行器、不桩判题。
   */
  for (const [id, title] of [['stage-b', 'B 关：Java 核心编程'], ['stage-c', 'C 关：算法与复杂度']] as const) {
    it(`${id}：起始代码点一次运行即「输出与验收点一致」`, async () => {
      render(
        <ChallengesView
          challenges={challenges}
          progress={{}}
          unitsByStage={{}}
          onOpenUnit={vi.fn()}
          onSubmit={vi.fn()}
        />,
      )
      const card = document.querySelector<HTMLButtonElement>(`.stage-card[data-challenge-id="${id}"]`)
      expect(card, `第 1 页里没有这张卡：${id}`).toBeTruthy()
      fireEvent.click(card!)
      fireEvent.click(screen.getByRole('tab', { name: '编写与运行' }))
      fireEvent.click(screen.getByRole('button', { name: /运行检查/ }))
      const found = await screen.findAllByText(/输出与验收点一致/)
      expect(found.length, `${title} 的运行判定不是「一致」`).toBeGreaterThan(0)
      // 判定明细也得真出现（只有一句总分就说明逐条那半没接上）
      expect(document.querySelectorAll('.judge-cases li.hit').length, `${title} 的逐条命中数`).toBeGreaterThan(0)
    })
  }
})

describe('CHAL-02 · 提交与旧记录', () => {
  it('提交带上判定口径，通过的那次写入 exact-lines', async () => {
    const onSubmit = vi.fn()
    render(
      <ChallengesView
        challenges={withTargets(['15'])}
        progress={{}}
        unitsByStage={{}}
        onOpenUnit={vi.fn()}
        onSubmit={onSubmit}
      />,
    )
    openAndRun()
    expect((await screen.findAllByText(/输出与验收点一致/)).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: '提交记录' }))
    fireEvent.change(screen.getByRole('textbox', { name: '完成证据说明' }), {
      target: { value: '教学运行器输出 15，与验收点逐行相等。' },
    })
    fireEvent.click(screen.getByRole('button', { name: /提交答案/ }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const [, submission] = onSubmit.mock.calls[0]!
    expect(submission.passed).toBe(true)
    expect(submission.judgeMode).toBe('exact-lines')
  })

  it('口径改成的假通过者无法提交：子串满足不再解锁提交按钮', async () => {
    const onSubmit = vi.fn()
    render(
      <ChallengesView
        challenges={withTargets(['1', '5'])}
        progress={{}}
        unitsByStage={{}}
        onOpenUnit={vi.fn()}
        onSubmit={onSubmit}
      />,
    )
    openAndRun()
    await screen.findAllByText(/输出与验收点不一致/)
    fireEvent.click(screen.getByRole('tab', { name: '提交记录' }))
    fireEvent.change(screen.getByRole('textbox', { name: '完成证据说明' }), { target: { value: '输出里有 1 和 5。' } })
    expect((screen.getByRole('button', { name: /提交答案/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('旧记录（无口径字段）如实标注为旧版示例匹配记录', () => {
    renderWith(
      withTargets(['15']),
      { 'stage-b': { completedAt: '2026-09-13T00:00:00.000Z', evidence: '当时按示例匹配通过', status: 'passed', tier: 'teaching' } },
    )
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    fireEvent.click(screen.getByRole('tab', { name: '提交记录' }))
    expect(screen.getByText(/判定口径：旧版示例匹配记录/)).toBeTruthy()
  })

  it('新记录读出当时口径：exact-lines 显示精确整行匹配', () => {
    renderWith(
      withTargets(['15']),
      {
        'stage-b': {
          completedAt: '2026-09-24T00:00:00.000Z',
          evidence: '逐行相等',
          status: 'passed',
          tier: 'teaching',
          judgeMode: 'exact-lines',
        },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    fireEvent.click(screen.getByRole('tab', { name: '提交记录' }))
    expect(screen.getByText(/判定口径：精确整行匹配/)).toBeTruthy()
  })

  it('外部关卡记录不经输出判定，不显示判定口径行', () => {
    render(
      <ChallengesView
        challenges={[challenges[0]!]}
        progress={{
          'stage-a': { completedAt: '2026-09-13T00:00:00.000Z', evidence: '执行环境：Windows 11', status: 'submitted', tier: 'external' },
        }}
        unitsByStage={{}}
        onOpenUnit={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /A 关：开发环境与基本操作/ }))
    fireEvent.click(screen.getByRole('tab', { name: '提交记录' }))
    expect(screen.queryByText(/判定口径/)).toBeNull()
    expect(screen.getByText(/执行等级：/)).toBeTruthy()
  })
})
