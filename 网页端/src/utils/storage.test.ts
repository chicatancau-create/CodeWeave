// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readLocalData, SCHEMA_VERSION, writeLocalData } from './storage'

type Sample = { name: string }

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('storage 版本化读写层（B4）', () => {
  it('写入带 schemaVersion 信封，读回数据一致', () => {
    const validate = (value: unknown): Sample | undefined =>
      typeof value === 'object' && value !== null && typeof (value as Sample).name === 'string'
        ? (value as Sample)
        : undefined

    writeLocalData('test-key', { name: '数据' })
    const raw = JSON.parse(localStorage.getItem('test-key')!)
    expect(raw.schemaVersion).toBe(SCHEMA_VERSION)
    expect(raw.data).toEqual({ name: '数据' })

    expect(readLocalData('test-key', validate)).toEqual({ name: '数据' })
  })

  it('旧版本信封（version 较小）可读取，首次写回自动升级', () => {
    localStorage.setItem('legacy', JSON.stringify({ schemaVersion: 1, data: { name: '旧' } }))
    expect(readLocalData<Sample>('legacy', (v) => v as Sample)).toEqual({ name: '旧' })
    writeLocalData('legacy', { name: '新' })
    expect(JSON.parse(localStorage.getItem('legacy')!).schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('更早期的裸数据（无信封）兼容读取', () => {
    localStorage.setItem('raw', JSON.stringify({ name: '裸数据' }))
    expect(readLocalData<Sample>('raw', (v) => v as Sample)).toEqual({ name: '裸数据' })
  })

  it('非法 JSON 返回 undefined 并输出可读警告，不抛出', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('broken', '{bad json')
    expect(readLocalData('broken', (v) => v as Sample)).toBeUndefined()
    expect(warn.mock.calls.some((args) => String(args[0]).includes('broken'))).toBe(true)
  })

  it('validate 判定非法的数据返回 undefined 并警告（非法字段/空结构走默认值）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('bad-shape', JSON.stringify({ schemaVersion: SCHEMA_VERSION, data: { nope: 1 } }))
    expect(readLocalData<Sample>('bad-shape', (v) => (typeof v === 'object' && v !== null && typeof (v as Sample).name === 'string' ? (v as Sample) : undefined))).toBeUndefined()
    expect(warn.mock.calls.some((args) => String(args[0]).includes('bad-shape'))).toBe(true)
  })
})
