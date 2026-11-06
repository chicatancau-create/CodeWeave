import { describe, expect, it } from 'vitest'
import {
  DEFAULT_JUDGE_MODE,
  judgeModeLabel,
  judgeModeShortLabel,
  judgeOutput,
} from './challenge-judge'

/**
 * CHAL-02：判题口径的回归基线。
 *
 * 改版前的一句 `output.some(line => line.includes(expected))` 会把验收点 `8`
 * 判成被输出 `18` 满足（C 关的真实验收点就是 `8`），也不看重复次数与多印的行。
 * 这里每一组都写成「旧口径会通过、新口径必须不通过」的对照，防止哪天又退回子串匹配。
 */
describe('judgeOutput · exact-lines（默认口径）', () => {
  it('默认口径就是精确整行：不传 mode 也不会退回子串', () => {
    expect(DEFAULT_JUDGE_MODE).toBe('exact-lines')
    const outcome = judgeOutput(['1'], ['10'])
    expect(outcome.mode).toBe('exact-lines')
    expect(outcome.passed).toBe(false)
  })

  it('验收点 1 不被输出 10 满足，并且将「只有包含它的行」这条理由说出来', () => {
    const outcome = judgeOutput(['1'], ['10'])
    expect(outcome.cases).toHaveLength(1)
    const [item] = outcome.cases
    expect(item?.matched).toBe(false)
    expect(item?.reason).toContain('只有包含它的输出行「10」')
    expect(item?.reason).toContain('不再算通过')
  })

  it('整行相等只裁首尾空白：验收点带空格仍然命中，actual 回报原样输出行', () => {
    const outcome = judgeOutput(['  15  '], ['  15'])
    expect(outcome.passed).toBe(true)
    expect(outcome.cases[0]?.matched).toBe(true)
    expect(outcome.cases[0]?.actual).toBe('  15')
    expect(outcome.extraLines).toEqual([])
  })

  it('一行只能被一个验收点用掉：重复验收点需要重复输出（旧口径一行就能糊两条）', () => {
    const outcome = judgeOutput(['15', '15'], ['15'])
    expect(outcome.cases[0]?.matched).toBe(true)
    expect(outcome.cases[1]?.matched).toBe(false)
    expect(outcome.cases[1]?.reason).toContain('每行只能用一次')
    expect(outcome.passed).toBe(false)
  })

  it('逐条报告：命中与未命中各自成条，不因一条失败就丢掉其余结论', () => {
    const outcome = judgeOutput(['待办数量: 2', '写周报', '跑一次构建'], ['待办数量: 2', '写周报'])
    expect(outcome.cases.map((item) => item.matched)).toEqual([true, true, false])
    expect(outcome.passed).toBe(false)
    expect(outcome.cases[2]?.reason).toContain('没有多余的输出行可以匹配')
  })

  it('多印未被使用的行如实列出，不静默忽略', () => {
    const outcome = judgeOutput(['8'], ['18', '8', '调试：进入分支'])
    expect(outcome.passed).toBe(true)
    expect(outcome.extraLines).toEqual(['18', '调试：进入分支'])
  })

  it('逐条覆盖不要求行序：顺序不同也算覆盖（面板标题写的是「逐条覆盖」）', () => {
    expect(judgeOutput(['a', 'b'], ['b', 'a']).passed).toBe(true)
  })

  it('没有任何验收点时不判通过：空 targetOutput 不能白送一个通过', () => {
    const outcome = judgeOutput([], ['15'])
    expect(outcome.cases).toEqual([])
    expect(outcome.passed).toBe(false)
  })

  it('空输出遇到非空验收点：每条都未命中并说明没有可用行', () => {
    const outcome = judgeOutput(['15'], [])
    expect(outcome.passed).toBe(false)
    expect(outcome.cases[0]?.reason).toContain('没有多余的输出行可以匹配')
  })
})

describe('judgeOutput · legacy-contains（只用于解释旧记录）', () => {
  it('复现旧口径的假通过：1 被 10 满足、8 被 18 满足', () => {
    expect(judgeOutput(['1'], ['10'], 'legacy-contains').passed).toBe(true)
    expect(judgeOutput(['8'], ['18'], 'legacy-contains').passed).toBe(true)
  })

  it('旧口径同样一行只用一次：与改版前的 every+some 相比仍少一类误判', () => {
    expect(judgeOutput(['15', '15'], ['15'], 'legacy-contains').passed).toBe(false)
  })
})

describe('口径标签', () => {
  it('旧记录没有口径字段时，如实说明当时按示例匹配判定且未记模式', () => {
    const label = judgeModeLabel(undefined)
    expect(label).toContain('旧版示例匹配记录')
    expect(label).toContain('未记模式')
  })

  it('两种口径的短标签都能读出判定规则本身', () => {
    expect(judgeModeShortLabel('exact-lines')).toContain('整行相等')
    expect(judgeModeShortLabel('legacy-contains')).toContain('子串包含')
  })
})
