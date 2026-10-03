import { describe, expect, it } from 'vitest'
import {
  addDaysKey,
  applyEvidence,
  describeReviewPlan,
  dueReviewRecords,
  effectiveReviewOffsets,
  effectiveReviewPlan,
  groupReviews,
  lessonCompletionNote,
  rescheduleReview,
  reviewPlanCadence,
  REVIEW_OFFSET_DAYS,
  scheduleFirstReview,
  scheduleNextReview,
  snoozeReview,
  type MasteryRecord,
} from './mastery'

const baseRecord = (overrides: Partial<MasteryRecord> = {}): MasteryRecord => ({
  refId: 'lesson-1',
  kind: 'lesson',
  level: 0,
  evidence: [],
  updatedAt: '2026-09-01T00:00:00.000Z',
  reviewStep: 0,
  ...overrides,
})

describe('mastery', () => {
  it('addDaysKey 跨月与跨年正确', () => {
    expect(addDaysKey('2026-09-01', 1)).toBe('2026-09-02')
    expect(addDaysKey('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDaysKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysKey('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('证据只能向上推进掌握等级（上限 6）', () => {
    let record = baseRecord()
    for (let i = 0; i < 10; i += 1) {
      record = applyEvidence(record, {
        id: `e-${i}`, kind: 'challenge', refId: 'lesson-1', note: '', at: '2026-09-01T00:00:00.000Z', passed: true,
      })
    }
    expect(record.level).toBe(6)
  })

  it('复测失败会降级且不低于 0', () => {
    let record = baseRecord({ level: 2 })
    record = applyEvidence(record, {
      id: 'e-fail', kind: 'review', refId: 'lesson-1', note: '', at: '2026-09-02T00:00:00.000Z', passed: false,
    })
    expect(record.level).toBe(1)

    record = applyEvidence(baseRecord({ level: 0 }), {
      id: 'e-fail2', kind: 'review', refId: 'lesson-1', note: '', at: '2026-09-02T00:00:00.000Z', passed: false,
    })
    expect(record.level).toBe(0)
  })

  it('非复测类型的失败证据不改变等级', () => {
    const record = applyEvidence(baseRecord({ level: 3 }), {
      id: 'e-bug', kind: 'bugfix', refId: 'lesson-1', note: '', at: '2026-09-02T00:00:00.000Z', passed: false,
    })
    expect(record.level).toBe(3)
  })

  it('首次复测安排在 1 天后；通过后按 3 天节点推进', () => {
    const first = scheduleFirstReview(baseRecord(), '2026-09-10')
    expect(first.reviewDueKey).toBe('2026-09-11')
    expect(first.reviewStep).toBe(0)

    const advanced = { ...first, reviewStep: 1 }
    const next = scheduleNextReview(advanced, '2026-09-11')
    expect(next.reviewDueKey).toBe('2026-09-14')
  })

  it('复测失败重新安排同一节点', () => {
    const record = baseRecord({ reviewStep: 2, reviewDueKey: '2026-09-20' })
    const rescheduled = rescheduleReview(record, '2026-09-20')
    expect(rescheduled.reviewStep).toBe(1)
    expect(rescheduled.reviewDueKey).toBe('2026-09-23') // 上一个已通过节点是 3 天档
  })

  it('dueReviewRecords 找出今天及过期项目并按日期排序', () => {
    const records: Record<string, MasteryRecord> = {
      a: baseRecord({ refId: 'a', reviewDueKey: '2026-09-12' }),
      b: baseRecord({ refId: 'b', reviewDueKey: '2026-09-10' }),
      c: baseRecord({ refId: 'c', reviewDueKey: '2026-09-20' }),
      d: baseRecord({ refId: 'd' }),
    }
    const due = dueReviewRecords(records, '2026-09-12')
    expect(due.map((record) => record.refId)).toEqual(['b', 'a'])
  })
})

describe('snoozeReview（F1 稍后提醒）', () => {
  it('逾期复测：从今天顺延到明天，其余字段不变', () => {
    const record: MasteryRecord = {
      refId: 'lesson-x', kind: 'lesson', level: 3, evidence: [],
      updatedAt: '2026-09-13T00:00:00.000Z', reviewStep: 2,
      reviewDueKey: '2026-09-12', lastFailReason: '上次忘了',
    }
    const snoozed = snoozeReview(record, '2026-09-13')
    expect(snoozed.reviewDueKey).toBe('2026-09-14')
    expect(snoozed.level).toBe(3)
    expect(snoozed.lastFailReason).toBe('上次忘了')
  })

  it('对已排到未来的复测，从其计划日期顺延一天（有可见效果）', () => {
    const record: MasteryRecord = {
      refId: 'lesson-y', kind: 'lesson', level: 2, evidence: [],
      updatedAt: '', reviewStep: 0, reviewDueKey: '2026-09-20',
    }
    // 今天 09-13，计划 09-20 → 顺延到 09-21 而不是拉回 09-14
    expect(snoozeReview(record, '2026-09-13').reviewDueKey).toBe('2026-09-21')
  })

  it('groupReviews 分组：逾期/今日/未来 7 天互斥且排序正确', () => {
    const records: MasteryRecord[] = [
      { refId: 'a', kind: 'lesson', level: 1, evidence: [], updatedAt: '', reviewStep: 0, reviewDueKey: '2026-09-10' },
      { refId: 'b', kind: 'lesson', level: 2, evidence: [], updatedAt: '', reviewStep: 0, reviewDueKey: '2026-09-13' },
      { refId: 'c', kind: 'lesson', level: 3, evidence: [], updatedAt: '', reviewStep: 0, reviewDueKey: '2026-09-18' },
      { refId: 'd', kind: 'lesson', level: 4, evidence: [], updatedAt: '', reviewStep: 0, reviewDueKey: '2026-09-25' },
    ]
    const groups = groupReviews(records, '2026-09-13')
    expect(groups.overdue.map((r) => r.refId)).toEqual(['a'])
    expect(groups.today.map((r) => r.refId)).toEqual(['b'])
    expect(groups.upcoming.map((r) => r.refId)).toEqual(['c'])
    expect(groups.next?.record.refId).toBe('c')
    expect(groups.next?.dateKey).toBe('2026-09-18')
  })
})

/** LEARN-01 第 4/5 条：完成证据要自己说清「谁判的」。 */
describe('lessonCompletionNote', () => {
  it('自动验证那一支写进口径与命中数', () => {
    expect(lessonCompletionNote('分支与循环', 'auto-verified', { matched: 3, total: 3 })).toBe(
      '自动验证通过：完成课程「分支与循环」，该题验收点 3/3 整行命中（口径：精确整行、每行只用一次）',
    )
  })

  it('自行声明那一支明写系统没比对输出，并区分「没有验收点」与「验收点未全中」', () => {
    expect(lessonCompletionNote('Git 版本管理', 'self-declared', null)).toContain(
      '本课无结构化验收点或属外部真实环境练习，系统未比对输出',
    )
    expect(lessonCompletionNote('函数与返回值', 'self-declared', { matched: 1, total: 2 })).toContain(
      '验收点未全中',
    )
  })

  it('两句话不可能互相混读：自动验证那支必带命中数，自行声明那支必带「未比对」', () => {
    const verified = lessonCompletionNote('X', 'auto-verified', { matched: 1, total: 1 })
    const declared = lessonCompletionNote('X', 'self-declared', null)
    expect(verified).not.toContain('自行声明')
    expect(declared).not.toContain('自动验证通过')
    expect(verified).toContain('1/1')
    expect(declared).toContain('系统未比对输出')
  })
})

/**
 * #33：延迟复测节点全仓只许有一份标准。
 *
 * 优先级（`effectiveReviewPlan` 是唯一解析口）：
 * 1. 本单元写了非空数组 → 本单元覆盖默认；
 * 2. 否则读资料库发布规则（运行时的标准，`[0, 1, 3, 7, 14, 30]`）；
 * 3. 都没有 → 本机兜底常量 `REVIEW_OFFSET_DAYS`。
 * `null` / `undefined` / `[]` 一律是「没写」，**永远不等于「不复测」**。
 */
const STANDARD = [0, 1, 3, 7, 14, 30]

describe('effectiveReviewPlan · #33 的三级优先', () => {
  it('第 3 级：单元与发布规则都没给 → 落到本机兜底常量，并且自己承认是兜底', () => {
    const plan = effectiveReviewPlan(null, null)
    expect(plan.offsets).toEqual([...REVIEW_OFFSET_DAYS])
    expect(plan.source).toBe('fallback')
    expect(describeReviewPlan(plan)).toContain('按本机排期')
  })

  it('第 2 级：发布规则盖掉客户端常量（客户端常量不再是运行时标准）', () => {
    const plan = effectiveReviewPlan(null, STANDARD)
    expect(plan.offsets).toEqual(STANDARD)
    expect(plan.source).toBe('published')
    expect(plan.offsets).not.toEqual([...REVIEW_OFFSET_DAYS])
  })

  it('第 1 级：单元写了非空数组就是本单元覆盖，哪怕与默认不同', () => {
    const plan = effectiveReviewPlan([1, 3, 7], STANDARD)
    expect(plan.offsets).toEqual([1, 3, 7])
    expect(plan.source).toBe('unit')
  })

  it('`[]`、`null`、`undefined` 都不许被读成「本单元不复测」——一律继承上一级', () => {
    for (const notWritten of [[], null, undefined]) {
      const plan = effectiveReviewPlan(notWritten, STANDARD)
      expect(plan.source, `${JSON.stringify(notWritten)} 该按「没写」处理`).toBe('published')
      expect(plan.offsets).toEqual(STANDARD)
      const scheduled = scheduleFirstReview(baseRecord(), '2026-09-10', plan.offsets)
      expect(scheduled.reviewDueKey, `${JSON.stringify(notWritten)} 排出了空计划`).toBeTruthy()
    }
  })

  it('发布规则自己也空着时，仍然有计划（空计划不是任何一级的结果）', () => {
    expect(effectiveReviewPlan([], []).offsets).toEqual([...REVIEW_OFFSET_DAYS])
    expect(effectiveReviewOffsets(undefined, undefined)).toEqual([...REVIEW_OFFSET_DAYS])
  })

  it('节点归一：乱序、重复、负数与非数字都清掉，剩下的按升序排', () => {
    const dirty = [7, 1, 1, -3, Number.NaN, 30] as unknown as number[]
    expect(effectiveReviewOffsets(dirty, null)).toEqual([1, 7, 30])
  })
})

describe('按 6 档标准计划走完全程（#33 裁定 1 的实际后果）', () => {
  const pass = (record: MasteryRecord, at: string): MasteryRecord =>
    applyEvidence(record, { id: `e-${at}`, kind: 'review', refId: record.refId, note: '复测通过', at, passed: true }, STANDARD.length)

  it('第 0 档是「学习当天」：刚学完就有一条今天要回顾，而不是 1 天后', () => {
    const first = scheduleFirstReview(baseRecord(), '2026-09-10', STANDARD)
    expect(first.reviewDueKey).toBe('2026-09-10')
    expect(first.reviewStep).toBe(0)
  })

  it('六个节点依次 0/1/3/7/14/30 天，第七次通过后才宣布计划走完', () => {
    let record = scheduleFirstReview(baseRecord(), '2026-09-10', STANDARD)
    const dates: (string | undefined)[] = []
    for (let step = 0; step < STANDARD.length; step += 1) {
      dates.push(record.reviewDueKey)
      expect(record.reviewStep).toBe(step)
      record = scheduleNextReview(pass(record, '2026-09-10'), '2026-09-10', STANDARD)
    }
    expect(dates).toEqual(['2026-09-10', '2026-09-11', '2026-09-13', '2026-09-17', '2026-09-24', '2026-10-10'])
    expect(record.reviewStep).toBe(STANDARD.length)
    expect(record.reviewDueKey).toBeUndefined()
  })

  it('封顶跟着计划走：6 档计划不会在第 5 档就推不动（旧写法会永远重排最后一个节点）', () => {
    const atLast = pass({ ...baseRecord(), reviewStep: 5, level: 4 }, '2026-10-10')
    expect(atLast.reviewStep).toBe(6)
    expect(scheduleNextReview(atLast, '2026-10-10', STANDARD).reviewDueKey).toBeUndefined()
    // 同一份记录若按兜底常量（5 档）封顶，就会被压在 5，说明计划长度必须显式传入
    expect(applyEvidence({ ...baseRecord(), reviewStep: 5 }, {
      id: 'e-x', kind: 'review', refId: 'lesson-1', note: '', at: '2026-10-10T00:00:00.000Z', passed: true,
    }).reviewStep).toBe(5)
  })

  it('失败重排第 0 档仍落在当天：当天那档没过就当天再来一次，要挪日子用 snooze', () => {
    const first = scheduleFirstReview(baseRecord(), '2026-09-10', STANDARD)
    const failed = rescheduleReview({ ...first, reviewStep: 0 }, '2026-09-10', STANDARD)
    expect(failed.reviewDueKey).toBe('2026-09-10')
    expect(failed.reviewStep).toBe(0)
  })
})

describe('计划文案（界面不许再自己抄一份节点）', () => {
  it('6 档标准：说出「学习当天」并给真实节点数，不把 0 写成「第 0 天」', () => {
    const plan = effectiveReviewPlan(null, STANDARD)
    expect(reviewPlanCadence(plan)).toBe('当天与 1/3/7/14/30 天')
    expect(describeReviewPlan(plan)).toBe(
      '按资料库发布规则：学习当天 + 学完后第 1、3、7、14、30 天各一次，共 6 个节点',
    )
  })

  it('5 档兜底：节奏串与本机排期字样保持原样，但节点数照样如实给', () => {
    const plan = effectiveReviewPlan(null, null)
    expect(reviewPlanCadence(plan)).toBe('1/3/7/14/30 天')
    expect(describeReviewPlan(plan)).toBe('按本机排期：学完后第 1、3、7、14、30 天各一次，共 5 个节点')
  })

  it('单元覆盖那一档要写明是覆盖，不能混读成默认', () => {
    const plan = effectiveReviewPlan([1, 3], STANDARD)
    expect(describeReviewPlan(plan)).toBe('按本单元自己写了的覆盖：学完后第 1、3 天各一次，共 2 个节点')
  })
})
