import { describe, expect, it } from 'vitest'
import { challenges } from './challenges'
import { DEFAULT_JUDGE_MODE, judgeOutput } from '../engine/challenge-judge'
import type { Challenge } from '../types/lesson'

/**
 * CHAL-02 第 2 条：为现有题补正常 / 边界 / 反例，「每题至少覆盖其真实风险，
 * 不能只把示例输出多复制几次」。
 *
 * 本库 13 关里只有 4 关由本机判题（B/C 走教学运行器、D/J 走 JavaScript 沙箱），
 * 其余 9 关是外部环境实验，只进「待人工确认」，不存在自动通过一说。
 * 所以「关卡可过」这条不变式只能对这 4 关成立——而 #91 的教训正是：
 * **一条关卡从没被执行过，界面却永远显示「不一致」**，谁都没发现。
 *
 * 本文件只管**纯数据层**（验收点自身可满足、比旧口径严、缺行不放水）。
 * 「起始代码在真实运行器里真能跑出验收点」这一半分别在两处真跑：
 * 教学两关走 UI（`challenges-view.judge.test.tsx`），沙箱两关走真执行
 * （`javascript-sandbox.test.ts` 里那个用 node:vm 跑生成脚本的 FakeWorker）。
 */
const local = challenges.filter((item) => item.runner !== 'external')
const externalOnly = challenges.filter((item) => item.runner === 'external')


describe('关卡数据自身的契约（13 关全查）', () => {
  it('每关都有验收点，且验收点不重复', () => {
    for (const item of challenges) {
      expect(item.targetOutput.length, `${item.id} 没有验收点`).toBeGreaterThan(0)
      const unique = new Set(item.targetOutput)
      // 重复验收点在新口径下要求「同一行印两次」，起始代码只印一次就永远过不去。
      // 现库没有重复；真要有，得连起始代码一起改，所以钉在这里而不是默默允许。
      expect(unique.size, `${item.id} 的验收点有重复`).toBe(item.targetOutput.length)
    }
  })

  it('起始代码非空，外部关卡也一样（它是给学习者看的命令/清单，不是装饰）', () => {
    for (const item of challenges) {
      expect(item.starterCode.trim().length, `${item.id} 没有起始代码`).toBeGreaterThan(0)
    }
  })

  it('本库不新增旧口径关卡：judgeMode 缺省或 exact-lines，legacy-contains 只用于读旧记录', () => {
    for (const item of challenges) {
      expect(item.judgeMode ?? DEFAULT_JUDGE_MODE, `${item.id} 声明了旧口径`).toBe('exact-lines')
    }
  })

  it('本机判题的正好是 B/C/D/J 四关，其余只进待人工确认', () => {
    expect(local.map((item) => item.id).sort()).toEqual(['stage-b', 'stage-c', 'stage-d', 'stage-j'])
    expect(externalOnly).toHaveLength(9)
  })
})

describe('CHAL-02 正常 / 边界 / 反例（本机判题四关，逐关）', () => {
  it.each(local.map((item) => [item.id, item] as const))('%s：逐行原样输出即通过（正常例）', (_id, item: Challenge) => {
    const outcome = judgeOutput(item.targetOutput, item.targetOutput, item.judgeMode ?? DEFAULT_JUDGE_MODE)
    expect(outcome.passed, `${item.id} 的验收点自相矛盾：原样输出都不算过`).toBe(true)
    expect(outcome.extraLines).toEqual([])
  })

  it.each(local.map((item) => [item.id, item] as const))('%s：每行只被「多印一点」的行包含时不通过（边界例）', (_id, item: Challenge) => {
    const nearMiss = item.targetOutput.map((target) => `${target} 附带尾巴`)
    const strict = judgeOutput(item.targetOutput, nearMiss, item.judgeMode ?? DEFAULT_JUDGE_MODE)
    expect(strict.passed, `${item.id} 被子串满足判过了`).toBe(false)
    expect(strict.cases.every((entry) => !entry.matched)).toBe(true)
    // 同一份输入在改版前的口径下会**全部通过**——这一句钉的是「新口径确实比旧的严」，
    // 也说明为什么边界例非留不可：现役 B/C 的验收点是 `15` 与 `8`，115 / 18 就落在这一类里。
    const legacy = judgeOutput(item.targetOutput, nearMiss, 'legacy-contains')
    expect(legacy.passed).toBe(true)
  })

  it.each(local.map((item) => [item.id, item] as const))('%s：什么都不印时不通过（反例）', (_id, item: Challenge) => {
    const outcome = judgeOutput(item.targetOutput, [], item.judgeMode ?? DEFAULT_JUDGE_MODE)
    expect(outcome.passed).toBe(false)
    expect(outcome.cases.every((entry) => entry.matched === false)).toBe(true)
  })

  it.each(local.map((item) => [item.id, item] as const))('%s：少印一行就不通过（重复次数是判据的一部分）', (_id, item: Challenge) => {
    if (item.targetOutput.length < 2) return
    const dropped = item.targetOutput.slice(1)
    expect(judgeOutput(item.targetOutput, dropped, item.judgeMode ?? DEFAULT_JUDGE_MODE).passed).toBe(false)
  })
})
