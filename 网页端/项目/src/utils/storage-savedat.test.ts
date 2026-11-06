// @vitest-environment jsdom
/**
 * DATA-01 第 2 条的门禁：「最后保存时间」四种读数必须互相分得开。
 *
 * 改版前 `readSavedAt()` 只回 `string | null`，于是界面把「键不存在」「数据在但没有 savedAt
 * （裸数据或更早的信封）」「JSON 读不出来」三种情况一律说成「从未保存」——
 * 那是在替用户编造一个不存在的事实：数据明明在，只是那一版没记时间。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readSavedAt, readSavedAtState } from './storage'

const KEY = 'code-canvas.test.savedat-reading'

function put(value: string) {
  localStorage.setItem(KEY, value)
}

afterEach(() => {
  localStorage.removeItem(KEY)
})

describe('readSavedAtState · 四种读数', () => {
  it('键不存在 → absent（界面写「未写入过」）', () => {
    expect(readSavedAtState(KEY)).toEqual({ state: 'absent' })
  })

  it('空串也算没写过，不算「读不出来」', () => {
    put('')
    expect(readSavedAtState(KEY)).toEqual({ state: 'absent' })
  })

  it('版本化信封带 savedAt → saved，并原样交出那个 ISO', () => {
    put(JSON.stringify({ schemaVersion: 3, savedAt: '2026-09-25T09:00:00.000Z', data: { a: 1 } }))
    expect(readSavedAtState(KEY)).toEqual({ state: 'saved', iso: '2026-09-25T09:00:00.000Z' })
    // 兼容旧接口：同一条数据在旧签名下仍拿得到 ISO
    expect(readSavedAt(KEY)).toBe('2026-09-25T09:00:00.000Z')
  })

  it('裸数据 / 更早的信封没有时间戳 → no-timestamp，不许被说成「从未保存」', () => {
    put(JSON.stringify({ a: 1 }))
    expect(readSavedAtState(KEY)).toEqual({ state: 'no-timestamp' })
    put(JSON.stringify({ schemaVersion: 1, data: { a: 1 } }))
    expect(readSavedAtState(KEY)).toEqual({ state: 'no-timestamp' })
    expect(readSavedAt(KEY)).toBeNull()
  })

  it('数据在但读不出来 → unreadable（与「没写过」分开）', () => {
    put('{ 这不是 JSON')
    expect(readSavedAtState(KEY)).toEqual({ state: 'unreadable' })
  })

  it('存储本身抛错也不冒泡，一律 unreadable', () => {
    const original = Storage.prototype.getItem
    Storage.prototype.getItem = () => {
      throw new Error('quota')
    }
    try {
      expect(readSavedAtState(KEY)).toEqual({ state: 'unreadable' })
    } finally {
      Storage.prototype.getItem = original
    }
  })
})
