// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChallengesView } from './challenges-view'
import { challenges } from '../data/challenges'
import type { Challenge } from '../types/lesson'

/**
 * 运行态的收尾归属（01 号方案 §4：disabled 要说明条件、按钮说的话必须是事实）。
 *
 * 场景：正在跑一关的时候导航走人（返回列表 / 切到别的关卡）。迟到的结果不许写回，
 * 这一条由 `runTokenRef` 承担、改版前后一致；但**按钮的 busy 态**从前只由那次运行自己收尾，
 * 而它收尾的条件是「令牌还是我的」——导航把令牌换了，于是 `busy` 永远停在 true，
 * 之后每一关的「运行检查」都显示禁用并写着「运行中…」，要等整页重挂才恢复。
 *
 * 只有浏览器沙箱那一档是真异步（`executeJavaScript` 返回 Promise），教学运行器同帧就返回，
 * 所以这里 mock 它：默认挂住不放（模拟「还在跑」），第三条用例改成一个可手动落定的 deferred，
 * 用来证明「收掉 busy」没有把「迟到结果不写回」这条原有语义一起丢掉。
 */
vi.mock('../engine/javascript-sandbox', () => ({
  executeJavaScript: vi.fn(() => new Promise(() => {})),
}))

/** 一关可被手动落定的运行结果队列：每次调用取走一个 resolver，取不到就永远挂着。 */
type DeferredRunResult = { output: string[]; variables: []; error: null; unsupported: false }
let pendingResolvers: ((value: DeferredRunResult) => void)[] = []

const renderChallenges = (list: Challenge[]) =>
  render(
    <ChallengesView
      challenges={list}
      progress={{}}
      unitsByStage={{}}
      onOpenUnit={vi.fn()}
      onSubmit={vi.fn()}
    />,
  )

const jsChallenge = (id: string, title: string): Challenge => ({
  ...challenges[0]!,
  id,
  title,
  runner: 'javascript-sandbox',
  language: 'javascript',
})

const runButton = () => screen.getByRole('button', { name: /运行检查|运行中/ }) as HTMLButtonElement

const openLab = (title: string) => {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(title) }))
  fireEvent.click(screen.getByRole('tab', { name: '编写与运行' }))
}

afterEach(() => {
  cleanup()
  pendingResolvers = []
})

describe('挑战页 · 运行中导航走人之后 busy 必须收尾', () => {
  it('运行途中返回列表：下一关的「运行检查」可点，不再挂着「运行中…」', () => {
    renderChallenges([jsChallenge('rs-a', '运行态用例甲'), jsChallenge('rs-b', '运行态用例乙')])

    openLab('运行态用例甲')
    fireEvent.click(runButton())
    // 先确认卡死的起点存在：这一刻按钮确实说「运行中…」并被禁用。
    expect(runButton().textContent).toContain('运行中')
    expect(runButton().disabled, '正在跑的时候按钮该禁用，否则测不到回归').toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /返回列表/ }))
    openLab('运行态用例乙')

    expect(runButton().textContent, '上一次运行迟不到来，按钮不能替它继续说运行中').toContain('运行检查')
    expect(runButton().disabled).toBe(false)
  })

  it('迟到的那一跑仍然不写回：收掉 busy 不能把原有语义一起丢掉', async () => {
    const { executeJavaScript } = await import('../engine/javascript-sandbox')
    vi.mocked(executeJavaScript).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          pendingResolvers.push(resolve as unknown as (value: DeferredRunResult) => void)
        }),
    )

    renderChallenges([jsChallenge('rs-a', '运行态用例甲')])
    openLab('运行态用例甲')
    fireEvent.click(runButton())
    fireEvent.click(screen.getByRole('button', { name: /返回列表/ }))
    expect(pendingResolvers, '这一跑必须还挂着，否则测不到「迟到」').toHaveLength(1)

    // 手动落定迟到的输出，再冲刷微任务让 .then 走完。
    pendingResolvers[0]!({ output: ['迟到的旧结果'], variables: [], error: null, unsupported: false })
    await Promise.resolve()
    await Promise.resolve()

    openLab('运行态用例甲')
    fireEvent.click(screen.getByRole('tab', { name: '提交记录' }))
    expect(
      document.querySelector('.challenge-result'),
      '放弃过的那一跑，迟到的输出不该出现在任何一关上',
    ).toBeNull()
    expect(document.body.textContent).not.toContain('迟到的旧结果')
  })
})
