// @vitest-environment jsdom
/**
 * R2-E 预计时长消费（E.3 第 8 条）。
 * `estimatedMinutes`（结构化数值）必须在界面展示，并与旧 `duration`（展示字符串）定义区分。
 *
 * 末段是 LEARN-01 第 4 条落进来时加的：路径行的「证据」一行只登记记录里已经成立的学习状态，
 * 一条都不成立时整行不画。它与时长无关，但同属「路径行允许说什么」的契约。
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LearningPathView } from './learning-path-view'
import type { Lesson } from '../types/lesson'
import type { LessonEvidenceStates } from '../utils/lesson-evidence'

const lesson = (overrides: Partial<Lesson> = {}): Lesson =>
  ({
    id: 'java-env-a1',
    language: 'java',
    languageLabel: 'Java',
    label: 'A1',
    title: '开发环境清点',
    description: '把工具链逐个清点并留下版本记录',
    duration: '45 min',
    level: '入门',
    progress: 0,
    code: '',
    flow: [],
    insight: '',
    fileName: 'env-checklist.txt',
    runtime: '外部环境 · 终端',
    content: { estimatedMinutes: 45 },
    ...overrides,
  }) as Lesson

const renderPath = (target: Lesson, states?: LessonEvidenceStates) =>
  render(
    <LearningPathView
      subjectId="java"
      subjects={[{ id: 'java', label: 'Java', short: 'JA', color: 'orange', lessonCount: 1, hasVaultContent: false, executable: true }]}
      lessons={[target]}
      lessonStates={states ? { [target.id]: states } : undefined}
      selectedLessonId={target.id}
      recommended={null}
      onSubjectChange={vi.fn()}
      onLessonChange={vi.fn()}
      onContinue={vi.fn()}
    />,
  )

afterEach(() => {
  cleanup()
})

describe('R2-E 预计时长展示', () => {
  it('有 estimatedMinutes 时卡片展示预计时长（含“分钟”语义）', () => {
    renderPath(lesson())
    expect(screen.getByText(/预计 45 分钟/)).toBeTruthy()
  })

  it('无 estimatedMinutes 时回退到旧 duration 字符串，不显示空标签', () => {
    renderPath(
      lesson({
        id: 'python-basics',
        language: 'python',
        languageLabel: 'Python',
        title: 'Python 起步',
        duration: '8 min',
        content: {} as Lesson['content'],
      }),
    )
    expect(screen.queryByText(/预计/)).toBeNull()
    expect(screen.getByText('8 min')).toBeTruthy()
  })
})

describe('LEARN-01 第 4 条 · 路径行的证据一行只登记已成立的状态', () => {
  const states = (overrides: Partial<LessonEvidenceStates> = {}): LessonEvidenceStates => ({
    read: false,
    practiced: false,
    submittedEvidence: false,
    selfDeclaredPassed: false,
    autoVerifiedPassed: false,
    reviewMastered: false,
    ...overrides,
  })
  const row = () => document.querySelector('.lp-row')

  it('没有任何学习状态时不画「证据」这一行：不拿一串空勾冒充陈述', () => {
    renderPath(lesson(), states())
    expect(row()?.querySelector('.lp-row-states')).toBeNull()
    // 行本身照常存在——没有状态不等于没有这一课
    expect(row()).toBeTruthy()
  })

  it('成立的两条各成一个标识，语义由文字承载、勾只作装饰', () => {
    renderPath(lesson(), states({ read: true, practiced: true }))
    const line = row()?.querySelector('.lp-row-states')
    expect(line).toBeTruthy()
    const marks = Array.from(line?.querySelectorAll('.lp-mark--signal') ?? [])
    expect(marks.map((mark) => (mark.textContent || '').replace(/\s+/g, ' ').trim())).toEqual(['✓已阅读', '✓已练习'])
    expect(line?.querySelector('.lp-row-states-key')?.textContent).toBe('证据')
    // 勾在朗读顺序里不占位（§5.3 第 6 条），语义全在文字上
    expect(marks[0]?.querySelector('.lp-mark-glyph')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('六态齐了也只列六条，不自造第七条；旧的那批标识仍各自在位', () => {
    renderPath(lesson(), states({ read: true, practiced: true, submittedEvidence: true, selfDeclaredPassed: true, autoVerifiedPassed: true, reviewMastered: true }))
    const marks = Array.from(row()?.querySelectorAll('.lp-row-states .lp-mark--signal') ?? [])
    expect(marks.length).toBe(6)
    // 徽记与文字之间没有空格：textContent 就是「勾 + 标签」两段拼起来的样子
    expect(marks.map((mark) => (mark.textContent || '').trim())).toEqual([
      '✓已阅读',
      '✓已练习',
      '✓已提交证据',
      '✓自评通过',
      '✓自动验证通过',
      '✓延迟复测掌握',
    ])
    // 来源与缺口那批标识是另一件事，不并进这一行、也不被这一行顶掉
    expect(row()?.querySelectorAll('.lp-marks--states').length).toBe(1)
    expect(row()?.querySelectorAll('.lp-marks').length).toBe(2)
  })
})
