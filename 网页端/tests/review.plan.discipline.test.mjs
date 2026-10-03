/**
 * #33 的门禁：**延迟复测节点全仓只许有一份标准**，其余地方只许「如实转述」，不许另立。
 *
 * 标准那一处是资料库发布规则 `reviewOffsetsDays` = `[0, 1, 3, 7, 14, 30]`
 * （权威文本：总计划 §7.4「默认节点：学习当天、+1 天、+3 天、+7 天、+14 天、+30 天」；
 * 机器形态：`knowledge/vault/CodeWeave/rules/teaching-rules.json`，由
 * `server/content/compiler.mjs:1178` 编译、`server/content/index.mjs:344` 随目录发布），
 * 运行时的读取口是 `content/adapter.ts` 的 `publishedReviewOffsets()`，
 * 解析口径是 `data/mastery.ts` 的 `effectiveReviewPlan()`（本单元覆盖 → 发布规则 → 本机兜底）。
 *
 * 这一条 #33 之前同时存在四份互相矛盾的口径：`mastery.ts` 的常量写着 5 档却配了一句
 * 「当天、1、3、7、14、30」的注释、规则投影 6 档、复习中心文案硬写 5 档、`lessons.ts` 里
 * 36 处单元字面量互不相同。行为由 `src/data/mastery.test.ts` 与
 * `src/hooks/use-review-schedule.plan.test.tsx` 管，**这里扫源码**：再多一处独立定义就红，
 * 存量的旧账走白名单 + 棘轮（只许减不许增），格式照 `src/data/graph.test.ts` 的棘轮口径。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { webScript } from './layout.mjs'

// 归属：本条扫的是网页端源码里的复测节点抄写（§7.1），原先寄在后端包里靠 `tests/layout.mjs`
// 的 `app/` 映射读 `workspace/frontend/**`，属 §5 禁止项。断言一条没改，只是搬回它自己的工程。
const SRC = webScript('src')

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

/**
 * 逐行剔掉注释（`//`、行首 `*`、行首 `/*`）。
 * 为什么不像 date.discipline.test.mjs 那样整段剥块注释：本仓的教材正文里有真字符串
 * 长得就是 C 注释的开头，整段剥会把后面的代码一起吞掉，**门禁宁可多报也不能漏报**。
 */
function codeLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => (/^\s*(\/\/|\*|\/\*)/.test(line) ? '' : line))
    .join('\n')
}

const files = sourceFiles(SRC).map((full) => ({
  path: relative(join(SRC, '..'), full).split(sep).join('/'),
  raw: readFileSync(full, 'utf8'),
  code: codeLines(readFileSync(full, 'utf8')),
}))

/** 复测节点族的合法取值（天）：学习当天=0 与五个间隔档。 */
const NODE_FAMILY = new Set([0, 1, 3, 7, 14, 30])
const increasing = (nums) => nums.length >= 3 && nums.every((n) => NODE_FAMILY.has(n)) && nums.every((n, i) => i === 0 || n > nums[i - 1])
const parseNums = (literal) => literal.slice(1, -1).split(',').map((s) => Number(s.trim()))

/** 一份「独立的复测节点定义」= 挂在 reviewOffsets* 名字上的数组字面量，或形状就是节点族的数组字面量。 */
function planLiterals(code) {
  const found = []
  for (const match of code.matchAll(/\[\s*\d+(?:\s*,\s*\d+){1,}\s*\]/g)) {
    const nums = parseNums(match[0])
    const named = /reviewOffsets\w*\s*[:=]/i.test(code.slice(Math.max(0, match.index - 70), match.index + 3))
    if (named || increasing(nums)) found.push(nums.join(','))
  }
  return found
}

/** 散文里的节奏（`1/3/7/14/30` 或 `1、3、7`）：界面文案把节点抄第二遍的最常见形态。 */
function cadenceProse(code) {
  const found = []
  for (const match of code.matchAll(/(?:[0-9]+(?:\s*[/]\s*|[、])){2,}[0-9]+/g)) {
    if (increasing(match[0].split(/[/、]/).map((s) => Number(s.trim())))) found.push(match[0].replace(/\s+/g, ''))
  }
  return found
}

/**
 * 数组字面量白名单。每条都带「它为什么不算第二套标准」的一句话理由；
 * 计数是**上限**（超了就红），总数另有棘轮钉住「只许减」。
 */
const LITERAL_ALLOWLIST = [
  {
    path: 'src/data/mastery.ts',
    literal: '1,3,7,14,30',
    count: 1,
    why: '唯一的本机兜底常量 `REVIEW_OFFSET_DAYS`：只在读不到发布规则时顶上，注释已自述是兜底而不是标准',
  },
  {
    path: 'src/data/lessons.ts',
    literal: '1,3,7,14,30',
    count: 4,
    why: '旧内置课程：`const REVIEW_OFFSETS` 公共默认 + 3 门同值单元。非空即「本单元覆盖」，按 #33 裁定 2 仍然生效，界面会点名它是覆盖',
  },
  {
    path: 'src/data/lessons.ts',
    literal: '1,3,7',
    count: 12,
    why: '旧内置课程里最早那批单元只排三档：属单元级覆盖（同上），删掉一处就把计数往下调一格',
  },
  {
    path: 'src/data/lessons.ts',
    literal: '1,3,7,14',
    count: 21,
    why: '旧内置课程中段那批排四档：同上。这三批合计 36 处，正是 #33 之后该逐步删掉的存量账',
  },
]

/** 散文节奏白名单：界面/教材正文里把节点抄了一遍，但**不参与排期**。 */
const PROSE_ALLOWLIST = [
  {
    path: 'src/components/modals.tsx',
    count: 1,
    why: '帮助弹窗「按十步学习法推进」那一句仍写死 1/3/7/14/30；modals.tsx 不在 #33 的改动清单内，下次碰它时换成 `describeReviewPlan(生效计划)`',
  },
  {
    path: 'src/data/lessons.ts',
    count: 2,
    why: '两门旧内置课程的**正文**在教「延迟复测（1/3/7 天后重做核心题）」这个学习方法，是教材叙述不是排期定义',
  },
]

const counted = (list, rows) => {
  const byKey = new Map()
  for (const row of list) {
    for (const literal of planLiterals(row.code)) {
      const key = `${row.path}|${literal}`
      byKey.set(key, (byKey.get(key) ?? 0) + 1)
    }
  }
  const allowed = new Map(rows.map((row) => [`${row.path}|${row.literal ?? ''}`, row]))
  return { byKey, allowed }
}

describe('#33 · 复测节点只许有一份标准', () => {
  it('扫到源码文件（防空跑）', () => {
    expect(files.length).toBeGreaterThan(60)
  })

  it('白名单之外没有任何一处独立的复测节点数组定义', () => {
    const { byKey, allowed } = counted(files, LITERAL_ALLOWLIST)
    const offenders = [...byKey.keys()].filter((key) => !allowed.has(key)).map((key) => `${key.replace('|', ' 的 ')}`)
    expect(offenders, `这些位置又抄了一份节点表：${offenders.join('; ')}`).toEqual([])
  })

  it('白名单里每一写的数量不许变多（新增一处独立定义就红）', () => {
    const { byKey } = counted(files, LITERAL_ALLOWLIST)
    for (const row of LITERAL_ALLOWLIST) {
      const key = `${row.path}|${row.literal}`
      const seen = byKey.get(key) ?? 0
      expect(seen, `${key} 比登记的 ${row.count} 处更多了（理由：${row.why}）`).toBeLessThanOrEqual(row.count)
    }
  })

  it('存量账棘轮：全仓独立节点数组字面量总数 = 38，只许减不许增', () => {
    // 38 = mastery.ts 的 1 处兜底常量 + lessons.ts 的 37 处旧内置单元字面量。
    // 变小了说明有人在删旧覆盖（正是 #33 想要的方向）：把这里的数一并下调，别让它悬着。
    const { byKey } = counted(files, LITERAL_ALLOWLIST)
    const total = [...byKey.values()].reduce((sum, n) => sum + n, 0)
    expect(total, '复测节点数组字面量总数变多了：新写的独立定义必须改成读发布规则').toBeLessThanOrEqual(38)
    expect(total, '存量账变少了，请把本条与白名单的计数一起下调，别让门禁假装什么都没发生').toBe(38)
  })

  it('散文节奏棘轮：抄写在文案里的节点串 = 3 处，只许减不许增', () => {
    const rows = files.flatMap((row) => cadenceProse(row.code).map(() => row.path))
    const total = rows.length
    expect(total, `界面/正文里又多处把节点抄了一遍：${[...new Set(rows)].join(', ')}`).toBeLessThanOrEqual(3)
    expect(total, '抄写变少了就把这条与 PROSE_ALLOWLIST 的计数一起下调').toBe(3)
    const byPath = rows.reduce((a, p) => { a[p] = (a[p] ?? 0) + 1; return a }, {})
    for (const row of PROSE_ALLOWLIST) {
      expect(byPath[row.path] ?? 0, `${row.path} 的抄写数量与登记不符（理由：${row.why}）`).toBeLessThanOrEqual(row.count)
    }
    const offenders = Object.keys(byPath).filter((path) => !PROSE_ALLOWLIST.some((row) => row.path === path))
    expect(offenders, `这些文件在文案里另抄了一份节点：${offenders.join(', ')}`).toEqual([])
  })

  it('兜底常量的注释不许再和取值互相矛盾', () => {
    const row = files.find((item) => item.path === 'src/data/mastery.ts')
    expect(row, '找不到 src/data/mastery.ts').toBeTruthy()
    const literal = /export const REVIEW_OFFSET_DAYS\s*=\s*\[([^\]]*)\]/.exec(row.code)
    expect(literal, 'REVIEW_OFFSET_DAYS 的定义方式变了，请同步本门禁').toBeTruthy()
    const values = literal[1].split(',').map((s) => Number(s.trim()))
    // 注释里必须自述它是兜底，并按 `兜底节点=…（共 N 档` 的格式报出自己取值——机器可比对，杜绝「注释 6 档、值 5 档」
    const declared = /兜底节点=([\d、]+)（共 (\d+) 档/.exec(row.raw)
    expect(declared, '兜底常量的注释必须自述取值（格式：兜底节点=1、3、7、14、30（共 5 档…））').toBeTruthy()
    expect(declared[1].split('、').map(Number)).toEqual(values)
    expect(Number(declared[2])).toBe(values.length)
    expect(row.raw, '兜底常量该说明自己只在读不到发布规则时上场').toMatch(/不是排期标准|本机兜底/)
  })

  it('复习中心不再自带节点：既不抄数组，也不抄节奏，更不留「两侧不一致」的免责说明', () => {
    const row = files.find((item) => item.path === 'src/components/review-center-view.tsx')
    expect(row, '找不到 src/components/review-center-view.tsx').toBeTruthy()
    expect(planLiterals(row.code), '界面里不许出现节点数组字面量').toEqual([])
    expect(cadenceProse(row.code), '界面里不许抄写节点节奏，文案一律由生效计划派生').toEqual([])
    expect(row.raw, '口径已统一，界面不许再留「两侧各一套、界面不折算」的免责说明').not.toMatch(/不折算|两侧不一致/)
    expect(row.raw, '分母该取生效计划的节点数').toMatch(/nodeTotal\s*=\s*plan\.offsets\.length/)
  })

  it('单元级「没写」不许再被折成空计划（adapter 与类型两端都要诚实）', () => {
    const adapter = files.find((item) => item.path === 'src/content/adapter.ts')
    expect(adapter, '找不到 src/content/adapter.ts').toBeTruthy()
    expect(adapter.code, '`?? []` 会把「本单元没写」伪装成「空计划」').not.toMatch(/reviewOffsetsDays:\s*[^,\n]*\?\?\s*\[\s*\]/)
    expect(adapter.code, '排期标准的读取口只有一处').toMatch(/export function publishedReviewOffsets\(/)
    const types = files.find((item) => item.path === 'src/types/lesson.ts')
    expect(types.code, 'LessonUnit.reviewOffsetsDays 要能表达「没写」：number[] | null').toMatch(
      /reviewOffsetsDays: number\[\] \| null/,
    )
  })
})
