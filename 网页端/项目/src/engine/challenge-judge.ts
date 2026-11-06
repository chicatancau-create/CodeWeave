/**
 * CHAL-02 第 1 条：关卡判题模式。
 *
 * 改版前只有一句 `runResult.output.some((line) => line.includes(expected))`——
 * 于是期望 `1` 会被实际输出 `10` 满足，期望 `8` 会被 `18` 满足，重复次数与是否各行一台
 * 也统统不看：一条输出行可以同时「满足」多个验收点。这是**假通过**，不是宽松判定。
 *
 * 现在默认 `exact-lines`：每个验收点必须**恰好等于某一整行**（只裁掉首尾空白），
 * 且一行只能被一个验收点用掉——这样「重复输出几次」与「顺序之外还多印了什么」都清清楚楚。
 * `legacy-contains` 只留给改版前已经写进进度里的旧记录，用来解释历史，不再产生新通过。
 */
import type { ChallengeJudgeMode } from '../types/lesson'

export type { ChallengeJudgeMode }

/** 默认口径：精确整行。新增关卡不写 judgeMode 就走这条。 */
export const DEFAULT_JUDGE_MODE: ChallengeJudgeMode = 'exact-lines'

export type JudgeCase = {
  expected: string
  matched: boolean
  /** 命中的那一行实际输出（未命中时给「最接近的一行」，方便学习者知道自己印了什么） */
  actual?: string
  /** 未命中的原因，逐条写出来——CHAL-02 第 3 条要求「不能只报一个总分」 */
  reason?: string
}

export type JudgeOutcome = {
  mode: ChallengeJudgeMode
  passed: boolean
  cases: JudgeCase[]
  /** 输出了但没被任何验收点用掉的行（多印的东西不藏起来） */
  extraLines: string[]
}

const trim = (value: string) => value.trim()

export function judgeOutput(
  expected: readonly string[],
  actual: readonly string[],
  mode: ChallengeJudgeMode = DEFAULT_JUDGE_MODE,
): JudgeOutcome {
  const pool = actual.map(trim)
  const used = new Array<boolean>(pool.length).fill(false)
  const cases: JudgeCase[] = []
  for (const want of expected) {
    const target = trim(want)
    const index =
      mode === 'legacy-contains'
        ? pool.findIndex((line, i) => !used[i] && line.includes(target))
        : pool.findIndex((line, i) => !used[i] && line === target)
    if (index >= 0) {
      used[index] = true
      cases.push({ expected: want, matched: true, actual: actual[index] })
      continue
    }
    cases.push({ expected: want, matched: false, reason: missReason(want, pool, used, mode, actual) })
  }
  return {
    mode,
    passed: cases.every((item) => item.matched) && cases.length > 0,
    cases,
    extraLines: pool.reduce<string[]>((acc, line, i) => {
      if (!used[i]) acc.push(actual[i] ?? line)
      return acc
    }, []),
  }
}

/** 未命中时把原因说清：是完全没有相近行，还是「只有包含它的行」——后者正是旧口径会误判通过的形态。 */
function missReason(
  want: string,
  pool: string[],
  used: boolean[],
  mode: ChallengeJudgeMode,
  actual: readonly string[],
): string {
  const target = trim(want)
  if (mode === 'exact-lines') {
    const substring = pool.findIndex((line, i) => !used[i] && line.includes(target))
    if (substring >= 0) {
      return `只有包含它的输出行「${actual[substring]}」——子串匹配从 CHAL-02 起不再算通过（旧口径会把 1 判成被 10 满足）`
    }
  }
  const leftover = pool.findIndex((_, i) => !used[i])
  if (leftover < 0) return '没有多余的输出行可以匹配（每行只能用一次）'
  return `没有与之相等的输出行，剩余最多的一行是「${actual[leftover]}」`
}

/** 旧记录没有记 judgeMode：如实标注为「旧版示例匹配记录」，不清零也不升级可信度（CHAL-02 第 7 条）。 */
export function judgeModeLabel(mode: ChallengeJudgeMode | undefined): string {
  if (!mode) return '旧版示例匹配记录（当时按「任意输出行包含验收点」判定，未记模式）'
  return mode === 'exact-lines' ? '精确整行匹配' : '旧口径复现（子串包含，仅用于解释历史）'
}

/** 界面上紧跟判定结果出现的一行短标签：只说口径，不复述结论。 */
export function judgeModeShortLabel(mode: ChallengeJudgeMode): string {
  return mode === 'exact-lines' ? '口径：验收点须整行相等，每行只用一次' : '口径：子串包含（旧版，仅用于解释历史）'
}
