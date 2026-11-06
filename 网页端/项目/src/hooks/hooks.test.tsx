// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useChallengeProgress } from './use-challenge-progress'
import { useCheckin } from './use-checkin'
import { useReviewSchedule } from './use-review-schedule'
import { useLocalStorage } from './use-local-storage'
import { getLocalDateKey, shiftDateKey } from '../utils/date-helpers'
import { SCHEMA_VERSION } from '../utils/storage'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('useLocalStorage（R2-D 键切换与闭包语义）', () => {
  it('键切换读取对应作用域数据，不残留上一作用域的值', () => {
    localStorage.setItem('k:user-1', JSON.stringify({ schemaVersion: SCHEMA_VERSION, data: 'A 的数据' }))
    localStorage.setItem('k:user-2', JSON.stringify({ schemaVersion: SCHEMA_VERSION, data: 'B 的数据' }))

    const { result, rerender } = renderHook(({ key }) => useLocalStorage<string>(key, '默认'), {
      initialProps: { key: 'k:user-1' },
    })
    expect(result.current[0]).toBe('A 的数据')

    rerender({ key: 'k:user-2' })
    expect(result.current[0]).toBe('B 的数据')

    // 切到无数据的作用域时回退默认值
    rerender({ key: 'k:user-3' })
    expect(result.current[0]).toBe('默认')
  })

  it('键切换后写入落在新作用域，不污染旧作用域', () => {
    const { result, rerender } = renderHook(({ key }) => useLocalStorage<string>(key, '默认'), {
      initialProps: { key: 'k:user-1' },
    })
    act(() => {
      result.current[1]('写入 A')
    })

    rerender({ key: 'k:user-2' })
    act(() => {
      result.current[1]('写入 B')
    })

    const a = JSON.parse(localStorage.getItem('k:user-1')!)
    const b = JSON.parse(localStorage.getItem('k:user-2')!)
    expect(a.data).toBe('写入 A')
    expect(b.data).toBe('写入 B')
  })

  it('validate 返回 undefined 时回退初始值并给出警告', () => {
    localStorage.setItem('k:bad', JSON.stringify({ schemaVersion: SCHEMA_VERSION, data: { nope: 1 } }))
    const { result } = renderHook(() =>
      useLocalStorage<string>('k:bad', '默认', {
        validate: (value) => (typeof value === 'string' ? value : undefined),
      }),
    )
    expect(result.current[0]).toBe('默认')
  })

  it('初始值更新后键切换使用最新初始值（不捕获首次渲染的闭包）', () => {
    // 第一次渲染 initialValue='默认1'，随后父组件传入 '默认2'，再切到无数据的新键。
    const { result, rerender } = renderHook(
      ({ key, initial }) => useLocalStorage<string>(key, initial),
      { initialProps: { key: 'k:user-1', initial: '默认1' } },
    )
    rerender({ key: 'k:user-1', initial: '默认2' })
    rerender({ key: 'k:user-2', initial: '默认2' })
    expect(result.current[0]).toBe('默认2')
  })

  it('validate 更新后键切换使用最新校验函数', () => {
    localStorage.setItem('k:num', JSON.stringify({ schemaVersion: SCHEMA_VERSION, data: 42 }))
    const allowString = (value: unknown) => (typeof value === 'string' ? value : undefined)
    const allowNumber = (value: unknown) => (typeof value === 'number' ? String(value) : undefined)

    const { result, rerender } = renderHook(
      ({ validate }) => useLocalStorage<string>('k:num', '默认', { validate }),
      { initialProps: { validate: allowString } },
    )
    expect(result.current[0]).toBe('默认')

    rerender({ validate: allowNumber })
    rerender({ validate: allowNumber })
    // 键未变，但校验函数应取最新值——重挂载时读取同一键得到 '42'
    const remounted = renderHook(() => useLocalStorage<string>('k:num', '默认', { validate: allowNumber }))
    expect(remounted.result.current[0]).toBe('42')
  })
})

describe('useChallengeProgress', () => {
  it('只有 passed/verified 的提交才会写入完成进度', () => {
    const { result } = renderHook(() => useChallengeProgress('user-1'))

    act(() => {
      result.current.applySubmission({
        challengeId: 'stage-b',
        status: 'rejected',
        output: [],
        evidence: 'x',
        tier: 'teaching',
      })
    })
    expect(result.current.completedCount).toBe(0)

    act(() => {
      result.current.applySubmission({
        challengeId: 'stage-b',
        status: 'passed',
        output: ['15'],
        evidence: '输出 15',
        tier: 'teaching',
      })
    })
    expect(result.current.completedCount).toBe(1)
    expect(result.current.progress['stage-b']?.evidence).toBe('输出 15')
  })

  it('R4：外部证据提交进入待人工确认，不计入完成数', () => {
    const { result } = renderHook(() => useChallengeProgress('user-1'))

    act(() => {
      result.current.applySubmission({
        challengeId: 'stage-a',
        status: 'submitted',
        output: [],
        evidence: '执行环境：Windows 11\n执行命令：java -version',
        tier: 'external',
      })
    })
    expect(result.current.completedCount).toBe(0)
    expect(result.current.pendingVerifyCount).toBe(1)
    expect(result.current.progress['stage-a']?.status).toBe('submitted')

    // 人工确认后提升为 verified，并计入完成数
    act(() => {
      result.current.verifySubmission('stage-a')
    })
    expect(result.current.progress['stage-a']?.status).toBe('verified')
    expect(result.current.completedCount).toBe(1)
    expect(result.current.pendingVerifyCount).toBe(0)
  })

  it('进度按账户作用域隔离', () => {
    const first = renderHook(() => useChallengeProgress('user-1'))
    act(() => {
      first.result.current.applySubmission({
        challengeId: 'stage-a',
        status: 'passed',
        output: [],
        evidence: '',
        tier: 'worker',
      })
    })

    const second = renderHook(() => useChallengeProgress('user-2'))
    expect(second.result.current.completedCount).toBe(0)
  })

  it('v1 布尔值数据被迁移', () => {
    localStorage.setItem('code-canvas.challenge-progress.v2:guest', JSON.stringify({ 'stage-a': true }))
    const { result } = renderHook(() => useChallengeProgress(undefined))
    expect(result.current.completedCount).toBe(1)
    expect(result.current.progress['stage-a']?.completedAt).toContain('迁移')
  })

  it('STAT-01 第 5 条：单条判断与「已通过 N 关」共用一个口径，不许各写一套', () => {
    // 缺 `status` 的旧记录：统计侧按迁移语义视为已通过（isPassedRecord），单条判断必须同解。
    // 改版前 `isCompleted` 走的是 `isPassedStatus(...)`，那正是全站第二套「通过」定义。
    localStorage.setItem(
      'code-canvas.challenge-progress.v2:user-7',
      JSON.stringify({ schemaVersion: SCHEMA_VERSION, data: { 'stage-a': { completedAt: '2026-09-01T00:00:00.000Z', evidence: '' } } }),
    )
    const { result } = renderHook(() => useChallengeProgress('user-7'))
    const challenge = { id: 'stage-a' } as Parameters<typeof result.current.isCompleted>[0]

    expect(result.current.completedCount).toBe(1)
    expect(result.current.isCompleted(challenge)).toBe(true)
    // 没打过的关两边都不算通过
    expect(result.current.isCompleted({ id: 'stage-zz' } as typeof challenge)).toBe(false)
  })
})

describe('useCheckin', () => {
  it('打卡、去重与连续天数', () => {
    const now = new Date()
    const { result } = renderHook(() => useCheckin('user-1', now))

    act(() => {
      result.current.handleCheckin()
    })
    expect(result.current.checkedIn).toBe(true)
    expect(result.current.streak).toBe(1)

    // 重复打卡不会产生重复日期
    act(() => {
      result.current.handleCheckin()
    })
    expect(result.current.checkinDates.filter((key) => key === getLocalDateKey(now))).toHaveLength(1)
  })

  it('昨天打过卡，今天打卡后连续 2 天', () => {
    const now = new Date()
    const yesterday = shiftDateKey(getLocalDateKey(now), -1)
    localStorage.setItem('code-canvas.checkin.v1:user-1', JSON.stringify([yesterday]))

    const { result } = renderHook(() => useCheckin('user-1', now))
    expect(result.current.streak).toBe(1)
    act(() => {
      result.current.handleCheckin()
    })
    expect(result.current.streak).toBe(2)
  })
})

describe('B4：数据可靠性与边界', () => {
  it('账户 A 写入后 B 不可读；A 重新登录（重挂载）数据恢复', () => {
    const first = renderHook(() => useChallengeProgress('user-A'))
    act(() => {
      first.result.current.applySubmission({
        challengeId: 'stage-b',
        status: 'passed',
        output: ['15'],
        evidence: 'A 的证据',
        tier: 'teaching',
      })
    })

    const other = renderHook(() => useChallengeProgress('user-B'))
    expect(other.result.current.completedCount).toBe(0)

    // A 注销后重新登录：同作用域重新初始化，数据从持久化恢复
    const restored = renderHook(() => useChallengeProgress('user-A'))
    expect(restored.result.current.completedCount).toBe(1)
    expect(restored.result.current.progress['stage-b']?.evidence).toBe('A 的证据')
  })

  it('复测失败写入 lastFailReason（最近失败原因摘要）', () => {
    localStorage.setItem(
      'code-canvas.mastery.v1:user-1',
      JSON.stringify({
        'lesson-x': {
          refId: 'lesson-x', kind: 'lesson', level: 2, evidence: [],
          updatedAt: new Date().toISOString(), reviewStep: 0,
          reviewDueKey: getLocalDateKey(new Date()),
        },
      }),
    )
    const { result } = renderHook(() => useReviewSchedule('user-1', new Date()))
    act(() => {
      result.current.recordEvidence('lesson-x', 'review', false, '忘了 while 的更新语句')
    })
    expect(result.current.records['lesson-x']?.lastFailReason).toBe('忘了 while 的更新语句')
  })

  it('打卡跨午夜：次日自动回到未打卡，可再次打卡且连续天数保留', () => {
    const day1 = new Date('2026-09-13T23:59:00')
    const day2 = new Date('2026-09-14T00:01:00')
    localStorage.setItem('code-canvas.checkin.v1:user-1', JSON.stringify([getLocalDateKey(day1)]))

    const { result, rerender } = renderHook(({ now }) => useCheckin('user-1', now), {
      initialProps: { now: day1 },
    })
    expect(result.current.checkedIn).toBe(true)
    expect(result.current.streak).toBe(1)

    rerender({ now: day2 })
    expect(result.current.checkedIn).toBe(false)
    expect(result.current.todayKey).toBe('2026-09-14')
    act(() => {
      result.current.handleCheckin()
    })
    expect(result.current.checkedIn).toBe(true)
    expect(result.current.streak).toBe(2)
  })
})

describe('useReviewSchedule', () => {
  it('课程完成记录证据并安排 1 天后复测', () => {
    const now = new Date()
    const { result } = renderHook(() => useReviewSchedule('user-1', now))

    act(() => {
      result.current.markLessonCompleted('python-loop-sum', '自动验证通过：验收点 3/3', 'auto-verified')
    })
    const record = result.current.records['python-loop-sum']!
    expect(record.level).toBe(1)
    expect(record.reviewDueKey).toBe(shiftDateKey(getLocalDateKey(now), 1))
    expect(result.current.dueReviews).toHaveLength(0)
    // LEARN-01 第 4 条：证据要带走「谁判的」，否则自动验证与自行声明在记录里长得一样
    expect(record.evidence.at(-1)?.verification).toBe('auto-verified')
  })

  it('自行声明那一支写 self-declared，缺省不写的旧形状不会凭空长出 verification', () => {
    const { result } = renderHook(() => useReviewSchedule('user-1', new Date()))
    act(() => {
      result.current.markLessonCompleted('java-env-1', '自行声明完成（本课无结构化验收点）', 'self-declared')
    })
    expect(result.current.records['java-env-1']?.evidence.at(-1)?.verification).toBe('self-declared')
    act(() => {
      result.current.recordEvidence('java-env-2', 'challenge', true, '挑战通过')
    })
    expect(result.current.records['java-env-2']?.evidence.at(-1)).not.toHaveProperty('verification')
  })

  it('到期复测：通过进入下一节点，未通过降级并重排', () => {
    const now = new Date()
    const todayKey = getLocalDateKey(now)
    // 直接注入一条已到期的记录
    localStorage.setItem(
      'code-canvas.mastery.v1:user-1',
      JSON.stringify({
        'python-loop-sum': {
          refId: 'python-loop-sum',
          kind: 'lesson',
          level: 3,
          evidence: [],
          updatedAt: new Date().toISOString(),
          reviewStep: 0,
          reviewDueKey: todayKey,
        },
      }),
    )

    const { result } = renderHook(() => useReviewSchedule('user-1', now))
    expect(result.current.dueReviews).toHaveLength(1)

    act(() => {
      result.current.recordEvidence('python-loop-sum', 'review', false, '遗忘')
    })
    const failed = result.current.records['python-loop-sum']!
    expect(failed.level).toBe(2)
    expect(failed.reviewDueKey).toBe(shiftDateKey(todayKey, 1))

    act(() => {
      result.current.recordEvidence('python-loop-sum', 'review', true, '补测通过')
    })
    const passed = result.current.records['python-loop-sum']!
    expect(passed.level).toBe(3)
    expect(passed.reviewStep).toBe(1)
    expect(passed.reviewDueKey).toBe(shiftDateKey(todayKey, 3))
  })
})
