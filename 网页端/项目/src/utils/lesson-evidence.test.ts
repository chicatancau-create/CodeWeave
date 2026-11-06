/**
 * LEARN-01 第 4 条 · 六种学习状态的派生规则。
 *
 * 这一份测试钉的是「状态从哪来」：六态必须由已有的掌握度记录折出，两条新信号
 * （已阅读 / 已练习）必须以 `passed:false` 落盘且不推进等级。
 * 外部证据那一格是对着 `summarizeExternalEvidence` 的**真实输出**判的，
 * 不是照抄一份字符串 —— 序列化格式一改，这里当场红。
 */
import { describe, expect, it } from 'vitest'
import { applyEvidence, type MasteryEvidence, type MasteryRecord } from '../data/mastery'
import { summarizeExternalEvidence, type ExternalEvidence } from './external-evidence'
import {
  deriveLessonEvidenceStates,
  hasCompletionEvidence,
  hasExternalEvidenceInNote,
  hasLessonSignal,
  heldLessonStates,
  holdsCompletion,
  isCompletedPracticeRun,
  lessonAcceptancePoints,
  lessonSignalNote,
  lessonSignalOf,
  type LessonEvidenceStates,
} from './lesson-evidence'

const evidenceOf = (overrides: Partial<MasteryEvidence> = {}): MasteryEvidence => ({
  id: 'e-1',
  kind: 'lesson',
  refId: 'vault-s0-1',
  note: '',
  at: '2026-09-13T08:00:00.000Z',
  passed: false,
  ...overrides,
})

const recordOf = (evidence: MasteryEvidence[], level = 0): MasteryRecord => ({
  refId: 'vault-s0-1',
  kind: 'lesson',
  level: level as MasteryRecord['level'],
  evidence,
  updatedAt: '2026-09-13T08:00:00.000Z',
  reviewStep: 0,
})

describe('lessonSignalNote / lessonSignalOf（信号写进 note，再原样读回）', () => {
  it('两种信号都能读回，且 note 里写明「不是完成证明、不推进等级」', () => {
    for (const kind of ['read', 'practice'] as const) {
      const note = lessonSignalNote(kind, '开发环境清点')
      expect(
        lessonSignalOf(evidenceOf({ kind: 'lesson', passed: false, note })),
      ).toBe(kind)
      expect(note).toContain(kind === 'read' ? '已阅读' : '已练习')
      expect(note).toContain('不构成完成证明')
      expect(note).toContain('不推进掌握等级')
      expect(note).toContain('开发环境清点')
    }
  })

  it('完成证据与旧记录不会被误读成信号；别的 kind 也不算信号', () => {
    expect(lessonSignalOf(evidenceOf({ note: '自行声明完成：完成课程「X」（本课无结构化验收点）' }))).toBeNull()
    expect(
      lessonSignalOf(evidenceOf({ kind: 'challenge', note: lessonSignalNote('read', 'X') })),
    ).toBeNull()
  })

  it('hasLessonSignal 只认这一课记过的那一种', () => {
    const record = recordOf([evidenceOf({ note: lessonSignalNote('practice', 'X') })])
    expect(hasLessonSignal(record, 'practice')).toBe(true)
    expect(hasLessonSignal(record, 'read')).toBe(false)
    expect(hasLessonSignal(undefined, 'read')).toBe(false)
  })
})

/**
 * 第 4 条的硬要求：这两条不许上调级别。
 * `applyEvidence` 只在 passed 时 +1，所以这里同时钉「落盘 passed:false」与「等级真的没动」。
 */
describe('学习信号不推进掌握等级', () => {
  it('已阅读 / 已练习各记一次，等级仍是 0', () => {
    let record = recordOf([])
    for (const kind of ['read', 'practice'] as const) {
      const note = lessonSignalNote(kind, 'X')
      const evidence = evidenceOf({ id: `e-${kind}`, note })
      expect(evidence.passed).toBe(false)
      record = applyEvidence(record, evidence)
    }
    expect(record.level).toBe(0)
    expect(record.evidence).toHaveLength(2)
  })

  it('已有等级的记录上再加信号，等级与复测节点都不动', () => {
    const before = recordOf([evidenceOf({ note: '自动验证通过：完成课程「X」', passed: true, verification: 'auto-verified' })], 1)
    const after = applyEvidence(before, evidenceOf({ note: lessonSignalNote('read', 'X') }))
    expect(after.level).toBe(1)
    expect(after.reviewDueKey).toBeUndefined()
  })
})

describe('hasCompletionEvidence（有记录 ≠ 已完成）', () => {
  it('只有 lesson 类且 passed 的证据算完成', () => {
    expect(hasCompletionEvidence(recordOf([evidenceOf({ note: lessonSignalNote('read', 'X') })]))).toBe(false)
    expect(hasCompletionEvidence(recordOf([evidenceOf({ passed: true })]))).toBe(true)
    // 挑战类通过证据不构成「这一课已完成」
    expect(hasCompletionEvidence(recordOf([evidenceOf({ kind: 'challenge', passed: true })]))).toBe(false)
    expect(hasCompletionEvidence(undefined)).toBe(false)
  })
})

describe('外部证据是否留在 note 里', () => {
  const evidence: ExternalEvidence = {
    environment: 'Windows 11 + JDK 17.0.9',
    command: 'java -version',
    resultSummary: '三个工具链版本全部打印，并定位一次构建错误',
    artifactRef: 'logs/java-version.txt',
    reproducedOn: '2026-09-10',
  }

  it('认 summarizeExternalEvidence 的真实输出（格式改了这里就红）', () => {
    const note = `自行声明完成：完成课程「X」\n${summarizeExternalEvidence(evidence)}`
    expect(hasExternalEvidenceInNote(note)).toBe(true)
  })

  it('普通完成 note 与只写了一句「执行环境：」的散文字都不算', () => {
    expect(hasExternalEvidenceInNote('自行声明完成：完成课程「X」（本课无结构化验收点）')).toBe(false)
    expect(hasExternalEvidenceInNote('执行环境：我自己随手写的一行')).toBe(false)
  })
})

describe('deriveLessonEvidenceStates（六态逐条从记录里折）', () => {
  it('一条记录里六种状态各自成立时逐条为真', () => {
    const record = recordOf([
      evidenceOf({ id: 'r', note: lessonSignalNote('read', 'X') }),
      evidenceOf({ id: 'p', note: lessonSignalNote('practice', 'X') }),
      evidenceOf({
        id: 'x',
        passed: true,
        verification: 'self-declared',
        note: `自行声明完成：完成课程「X」\n${summarizeExternalEvidence({
          environment: 'Ubuntu 24.04',
          command: 'npm run build',
          resultSummary: '构建成功，产物 3 个文件',
          artifactRef: '',
          reproducedOn: '2026-09-10',
        })}`,
      }),
      evidenceOf({ id: 'v', kind: 'review', passed: true, note: '复测通过' }),
    ])
    const states = deriveLessonEvidenceStates(record)
    expect(states).toEqual({
      read: true,
      practiced: true,
      submittedEvidence: true,
      selfDeclaredPassed: true,
      autoVerifiedPassed: false,
      reviewMastered: true,
    })
  })

  it('自动验证那一支不再被算成自评', () => {
    const record = recordOf([
      evidenceOf({ passed: true, verification: 'auto-verified', note: '自动验证通过：完成课程「X」，验收点 1/1' }),
    ])
    expect(deriveLessonEvidenceStates(record)).toEqual({
      read: false,
      practiced: false,
      submittedEvidence: false,
      selfDeclaredPassed: false,
      autoVerifiedPassed: true,
      reviewMastered: false,
    })
  })

  it('缺 verification 的旧完成记录读成自评，不追认成自动验证', () => {
    const states = deriveLessonEvidenceStates(recordOf([evidenceOf({ passed: true, note: '完成课程「X」' })]))
    expect(states.selfDeclaredPassed).toBe(true)
    expect(states.autoVerifiedPassed).toBe(false)
  })

  it('复测未通过不叫掌握；无记录时六态全假', () => {
    expect(deriveLessonEvidenceStates(recordOf([evidenceOf({ kind: 'review', passed: false, note: '复测未通过' })])).reviewMastered).toBe(false)
    expect(deriveLessonEvidenceStates(undefined)).toEqual({
      read: false,
      practiced: false,
      submittedEvidence: false,
      selfDeclaredPassed: false,
      autoVerifiedPassed: false,
      reviewMastered: false,
    })
  })

  it('heldLessonStates 只回成立的，且按固定顺序', () => {
    const held = heldLessonStates({
      read: true,
      practiced: false,
      submittedEvidence: true,
      selfDeclaredPassed: false,
      autoVerifiedPassed: false,
      reviewMastered: true,
    })
    expect(held.map((item) => item.label)).toEqual(['已阅读', '已提交证据', '延迟复测掌握'])
  })
})

describe('isCompletedPracticeRun（已练习只认真跑完的那一次）', () => {
  const events = [{ id: 'e', type: 'start' as const, line: 1, label: '', detail: '', variables: [] }]

  it('completed + 有轨迹 + 无报错 = 记一次练习', () => {
    expect(isCompletedPracticeRun({ runStatus: 'completed', events })).toBe(true)
  })

  it('running / idle / 空轨迹 / 报错 / 认不出结构 / 外部等级都不记', () => {
    expect(isCompletedPracticeRun({ runStatus: 'running', events })).toBe(false)
    expect(isCompletedPracticeRun({ runStatus: 'idle', events })).toBe(false)
    expect(isCompletedPracticeRun({ runStatus: 'completed', events: [] })).toBe(false)
    expect(isCompletedPracticeRun({ runStatus: 'completed', events, error: { line: 2, message: 'boom' } })).toBe(false)
    expect(isCompletedPracticeRun({ runStatus: 'completed', events, unsupported: true })).toBe(false)
    expect(isCompletedPracticeRun({ runStatus: 'completed', events, tier: 'external' })).toBe(false)
  })
})

describe('lessonAcceptancePoints（课程验收点映射给校验器）', () => {
  it('练习契约的期望输出与证据清单都带上，缺字段时留空数组', () => {
    const lesson = {
      content: { completion: '输出 5', evidenceChecklist: ['截图位置'] },
      exercise: { expectedOutput: ['5'] },
      acceptance: { rubric: [], evidenceChecklist: [], testCases: [], hints: [] },
    } as unknown as Parameters<typeof lessonAcceptancePoints>[0]
    expect(lessonAcceptancePoints(lesson)).toEqual({ targetOutput: ['5'], evidence: ['截图位置', '输出 5'] })

    const bare = { content: emptyLessonContent } as unknown as Parameters<typeof lessonAcceptancePoints>[0]
    expect(lessonAcceptancePoints(bare)).toEqual({ targetOutput: [], evidence: [] })
  })
})

describe('holdsCompletion（六态里算「完成」的是哪三态）', () => {
  const six = (overrides: Partial<LessonEvidenceStates>): LessonEvidenceStates => ({
    read: false,
    practiced: false,
    submittedEvidence: false,
    selfDeclaredPassed: false,
    autoVerifiedPassed: false,
    reviewMastered: false,
    ...overrides,
  })

  it('三态任一成立即为完成；阅读与练习痕迹单独成立都不算', () => {
    expect(holdsCompletion(six({ selfDeclaredPassed: true }))).toBe(true)
    expect(holdsCompletion(six({ autoVerifiedPassed: true }))).toBe(true)
    expect(holdsCompletion(six({ reviewMastered: true }))).toBe(true)
    expect(holdsCompletion(six({ read: true, practiced: true })), '点过「已阅读」跑过一次不等于掌握').toBe(false)
    expect(holdsCompletion(six({ submittedEvidence: true })), '提交了证据 ≠ 通过').toBe(false)
    expect(holdsCompletion(six({}))).toBe(false)
    expect(holdsCompletion(undefined), '这一课还没有任何记录时按未完成读').toBe(false)
  })

  it('与读记录的那条口径同判据：折出来的六态不会和记录本身分家', () => {
    const read = evidenceOf({ note: lessonSignalNote('read', '函数与返回值'), refId: 'vault-s0-1' })
    const passed = evidenceOf({ note: '完成课程「函数与返回值」', refId: 'vault-s0-1', passed: true })
    const record: MasteryRecord = {
      refId: 'vault-s0-1',
      kind: 'lesson',
      level: 1,
      reviewStep: 0,
      updatedAt: '2026-09-20T00:00:00.000Z',
      evidence: [read, passed],
    }
    expect(holdsCompletion(deriveLessonEvidenceStates(record))).toBe(true)
    expect(hasCompletionEvidence(record)).toBe(true)

    const onlySignal: MasteryRecord = { ...record, evidence: [read] }
    expect(holdsCompletion(deriveLessonEvidenceStates(onlySignal))).toBe(false)
    expect(hasCompletionEvidence(onlySignal)).toBe(false)
  })
})

const emptyLessonContent = {
  objective: '',
  prerequisites: [],
  explanation: [],
  examples: [],
  guidedSteps: [],
  exercise: '',
  variant: '',
  projectTask: '',
  mistakes: [],
  runCommand: '',
  completion: '',
  reviewOffsetsDays: [],
}
