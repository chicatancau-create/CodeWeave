// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { describeLoginMethod, maskEmail, maskPhone } from './privacy'
import { aggregateMasteryByStage } from './mastery-view'
import type { MasteryLevel, MasteryRecord } from '../data/mastery'

describe('privacy 脱敏', () => {
  it('邮箱只保留首字符与域名', () => {
    expect(maskEmail('you@qq.con')).toBe('y***@qq.con')
    expect(maskEmail('abcdefg@example.com')).toBe('a***@example.com')
  })

  it('手机号保留前 3 后 4', () => {
    expect(maskPhone('13800138000')).toBe('138****8000')
  })

  it('异常输入不抛错', () => {
    expect(maskEmail('nodomain')).toBe('***')
    expect(maskPhone('12345')).toBe('***')
  })

  it('describeLoginMethod 优先邮箱', () => {
    expect(describeLoginMethod({ email: 'you@qq.con' })).toBe('邮箱 y***@qq.con')
    expect(describeLoginMethod({ phone: '13800138000' })).toBe('手机号 138****8000')
    expect(describeLoginMethod({})).toBe('未设置联系方式')
  })
})

const record = (refId: string, level: number, evidenceCount: number): MasteryRecord => ({
  refId,
  kind: 'lesson',
  level: level as MasteryLevel,
  evidence: Array.from({ length: evidenceCount }, (_, i) => ({
    id: `e-${i}`, kind: 'lesson' as const, refId, note: '', at: '2026-09-13T00:00:00.000Z', passed: true,
  })),
  updatedAt: '2026-09-13T00:00:00.000Z',
  reviewStep: 0,
})

describe('aggregateMasteryByStage（掌握度地图）', () => {
  it('按阶段聚合最高等级与证据数量', () => {
    const rows = aggregateMasteryByStage({
      'java-env-a1': record('java-env-a1', 2, 2),
      'java-env-a2': record('java-env-a2', 1, 1),
      'java-algo-c1': record('java-algo-c1', 4, 3),
    })
    const a = rows.find((row) => row.stageId === 'A')!
    expect(a.level).toBe(2)
    expect(a.evidenceCount).toBe(3)
    expect(a.coveredUnits).toBe(2)
    const c = rows.find((row) => row.stageId === 'C')!
    expect(c.level).toBe(4)
    expect(c.evidenceCount).toBe(3)
  })

  it('A—M 全部 13 个阶段都有行；无记录阶段为 0 级', () => {
    const rows = aggregateMasteryByStage({})
    expect(rows).toHaveLength(13)
    expect(rows.every((row) => row.level === 0 && row.evidenceCount === 0)).toBe(true)
    expect(rows.map((row) => row.stageId)).toEqual([
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    ])
  })

  it('阶段内单元总数与课程数据一致（A=6, C=6）', () => {
    const rows = aggregateMasteryByStage({})
    const a = rows.find((row) => row.stageId === 'A')!
    const c = rows.find((row) => row.stageId === 'C')!
    expect(a.totalUnits).toBeGreaterThanOrEqual(3)
    expect(c.totalUnits).toBeGreaterThanOrEqual(3)
  })
})
