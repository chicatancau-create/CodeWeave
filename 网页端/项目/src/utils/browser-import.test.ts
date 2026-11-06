/**
 * DATA-09 导入预览与恢复（三合一方案 §6.2 · 优化清单 §3）。
 *
 * 验收：换 origin 后可从导出恢复；导入前预览版本 / scope / 冲突；
 * 默认不覆盖目标现有记录；不接受文件指定任意 localStorage 键；
 * 中途失败给出可恢复结果，不宣称绝对原子。
 *
 * 全部使用隔离的内存 localStorage，不触达真实账户数据。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STORAGE_KEYS } from './constants'
import { applyImport, buildExportPayload, EXPORT_SCHEMA, EXPORT_VERSION, previewImport } from './local-data'

class MemoryStorage {
  private store = new Map<string, string>()
  get length(): number {
    return this.store.size
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  clear(): void {
    this.store.clear()
  }
}

let storage: MemoryStorage
const ACCOUNT = 'user-7f3a'
const WORKSPACE = `${STORAGE_KEYS.WORKSPACE}:${ACCOUNT}`
const DRAFTS = `${STORAGE_KEYS.CODE_DRAFTS}:${ACCOUNT}`
const SETTINGS = STORAGE_KEYS.SETTINGS

function seed(): void {
  storage.setItem(
    WORKSPACE,
    JSON.stringify({ savedAt: '2026-09-18T02:00:00.000Z', data: { 'cw-java-control-flow-001': 'class A{}' } }),
  )
  storage.setItem(DRAFTS, JSON.stringify({ savedAt: '2026-09-18T02:05:00.000Z', data: { 'chal-B2': 'for(i=0;i<n;i++)' } }))
  // 设备级设置默认不导出，导入也不应触碰
  storage.setItem(SETTINGS, JSON.stringify({ reduceMotion: true }))
}

beforeEach(() => {
  storage = new MemoryStorage()
  vi.stubGlobal('localStorage', storage)
  seed()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DATA-09 往返恢复', () => {
  it('导出后清空，再按预览导入：记录与关联逐条一致，账户 ID 不变', () => {
    const payload = buildExportPayload(ACCOUNT)
    expect(Object.keys(payload.data).length).toBeGreaterThan(0)
    expect(payload.scope).toBe(ACCOUNT)

    const snapshot = new Map(Object.entries(payload.data).map(([k, v]) => [k, JSON.stringify(v)]))
    storage.clear()

    const preview = previewImport(payload, ACCOUNT)
    expect(preview.ok).toBe(true)
    expect(preview.counts.new).toBe(snapshot.size)

    const result = applyImport(payload, ACCOUNT, Object.fromEntries(preview.items.map((item) => [item.key, item.decision])))
    expect(result.failed).toEqual([])
    expect(result.applied.sort()).toEqual([...snapshot.keys()].sort())
    for (const [key, value] of snapshot) expect(storage.getItem(key)).toBe(value)
    // 账户 ID 与旧实体 ID 原样保留，没有重映射
    expect(storage.getItem(WORKSPACE)).toContain('cw-java-control-flow-001')
  })

  it('换 origin（新机器/新端口）后同一份导出仍可恢复', () => {
    const payload = buildExportPayload(ACCOUNT)
    const snapshot = new Map(Object.entries(payload.data).map(([k, v]) => [k, JSON.stringify(v)]))
    storage.clear()
    // 换了浏览器：只有设备级设置被重建，账户槽位是空的
    storage.setItem(SETTINGS, JSON.stringify({ reduceMotion: false }))
    const result = applyImport(payload, ACCOUNT)
    expect(result.applied.length).toBe(snapshot.size)
    for (const [key, value] of snapshot) expect(storage.getItem(key)).toBe(value)
    // 设备级设置不属于账户导出，保持本机自己的值
    expect(JSON.parse(storage.getItem(SETTINGS)!).reduceMotion).toBe(false)
  })

  it('重复导入同一份导出是幂等的：全部判为 identical，不再写', () => {
    const payload = buildExportPayload(ACCOUNT)
    applyImport(payload, ACCOUNT)
    const again = previewImport(payload, ACCOUNT)
    expect(again.counts.identical).toBe(Object.keys(payload.data).length)
    expect(again.counts.new).toBe(0)
    const before = storage.getItem(WORKSPACE)
    expect(applyImport(payload, ACCOUNT).applied).toEqual([])
    expect(storage.getItem(WORKSPACE)).toBe(before)
  })
})

describe('DATA-09 不可信输入', () => {
  it('导入文件不得指定任意 localStorage 键', () => {
    const payload = {
      ...buildExportPayload(ACCOUNT),
      data: { 'evil.key': { pwn: true }, [WORKSPACE]: { savedAt: 'x', data: {} } },
    }
    const preview = previewImport(payload, ACCOUNT)
    const evil = preview.items.find((item) => item.key === 'evil.key')
    expect(evil?.status).toBe('rejected')
    applyImport(payload, ACCOUNT, { 'evil.key': 'import' })
    expect(storage.getItem('evil.key')).toBeNull()
  })

  it('键的账户后缀与声明范围不一致时拒绝（防伪造他人账户槽位）', () => {
    const payload = { ...buildExportPayload(ACCOUNT), data: { [`${STORAGE_KEYS.WORKSPACE}:victim`]: { data: {} } } }
    const preview = previewImport(payload, ACCOUNT)
    expect(preview.items).toHaveLength(1)
    const [item] = preview.items
    expect(item?.status).toBe('rejected')
    expect(item?.reason).toContain('不一致')
    applyImport(payload, ACCOUNT, { [`${STORAGE_KEYS.WORKSPACE}:victim`]: 'import' })
    expect(storage.getItem(`${STORAGE_KEYS.WORKSPACE}:victim`)).toBeNull()
  })

  it('非对象 / 错 schema / 缺字段一律整体拒绝，且不写任何键', () => {
    for (const bad of [null, 'text', [], { schema: 'other', version: 1, data: {} }, { schema: EXPORT_SCHEMA, version: 1 }]) {
      const before = storage.getItem(WORKSPACE)
      const preview = previewImport(bad, ACCOUNT)
      expect(preview.ok).toBe(false)
      expect(preview.errors.length).toBeGreaterThan(0)
      expect(storage.getItem(WORKSPACE)).toBe(before)
    }
  })

  it('拒绝未来版本，旧版本给出升级路径而不是猜测', () => {
    const future = { ...buildExportPayload(ACCOUNT), version: EXPORT_VERSION + 1 }
    expect(previewImport(future, ACCOUNT).errors[0]).toContain('更新的版本')
    const older = { ...buildExportPayload(ACCOUNT), version: EXPORT_VERSION - 1 }
    expect(previewImport(older, ACCOUNT).errors[0]).toContain('迁移路径')
  })
})

describe('DATA-09 冲突与跨账户', () => {
  it('目标已有不同内容时默认保留现有记录，显式选择才覆盖', () => {
    const payload = buildExportPayload(ACCOUNT)
    const kept = JSON.stringify({ savedAt: 'later', data: { 'cw-java-control-flow-001': '改过的代码' } })
    storage.setItem(WORKSPACE, kept)

    const preview = previewImport(payload, ACCOUNT)
    expect(preview.items.find((item) => item.key === WORKSPACE)?.status).toBe('conflict')
    expect(preview.items.find((item) => item.key === WORKSPACE)?.decision).toBe('skip')

    expect(applyImport(payload, ACCOUNT).applied).toEqual([])
    expect(storage.getItem(WORKSPACE)).toBe(kept)

    const chosen = applyImport(payload, ACCOUNT, { [DRAFTS]: 'import', [WORKSPACE]: 'import' })
    expect(chosen.applied).toContain(WORKSPACE)
    expect(storage.getItem(WORKSPACE)).not.toBe(kept)
  })

  it('这份导出属于另一个账户时标为 cross-scope，默认不写入', () => {
    const payload = buildExportPayload(ACCOUNT)
    // 目标位置先放不同内容，覆盖「对面已有数据」这一支；空槽位见下一条用例
    storage.setItem(WORKSPACE, JSON.stringify({ savedAt: 'x', data: { other: 1 } }))
    storage.setItem(DRAFTS, JSON.stringify({ savedAt: 'x', data: { other: 2 } }))

    const preview = previewImport(payload, 'user-other')
    expect(preview.warnings.join(' ')).toContain(ACCOUNT)
    expect(preview.items.length).toBe(2)
    expect(preview.items.every((item) => item.status === 'cross-scope')).toBe(true)
    expect(preview.items.every((item) => item.decision === 'skip')).toBe(true)
    const before = storage.getItem(WORKSPACE)
    expect(applyImport(payload, 'user-other').applied).toEqual([])
    expect(storage.getItem(WORKSPACE)).toBe(before)
  })

  it('跨账户条目即使对面是空槽位也不判为「空位可恢复」，强制勾选同样不写', () => {
    const payload = buildExportPayload(ACCOUNT)
    storage.clear() // 换浏览器的全新机器：他人账户的槽位还没有数据

    const preview = previewImport(payload, 'user-other')
    expect(preview.counts.new).toBe(0)
    expect(preview.counts['cross-scope']).toBe(2)

    const forced = applyImport(payload, 'user-other', { [WORKSPACE]: 'import', [DRAFTS]: 'import' })
    expect(forced.applied).toEqual([])
    expect(storage.getItem(WORKSPACE)).toBeNull()
    expect(storage.getItem(DRAFTS)).toBeNull()
  })

  it('跨账户条目即使被强制勾选也不写——导入不是伪造他人槽位的入口', () => {
    const payload = buildExportPayload(ACCOUNT)
    storage.setItem(WORKSPACE, JSON.stringify({ savedAt: 'x', data: { other: 1 } }))
    storage.setItem(DRAFTS, JSON.stringify({ savedAt: 'x', data: { other: 2 } }))
    const before = storage.getItem(WORKSPACE)

    const forced = applyImport(payload, 'user-other', { [WORKSPACE]: 'import', [DRAFTS]: 'import' })
    expect(forced.applied).toEqual([])
    expect(forced.skipped).toEqual(expect.arrayContaining([WORKSPACE, DRAFTS]))
    expect(storage.getItem(WORKSPACE)).toBe(before)
  })
})

describe('DATA-09 部分失败可恢复', () => {
  /** 让指定键的写入抛错，模拟配额耗尽。 */
  function failWritesFor(keys: Set<string>): void {
    const original = MemoryStorage.prototype.setItem
    storage.setItem = function (this: MemoryStorage, key: string, value: string) {
      if (keys.has(key)) throw new Error('QuotaExceededError')
      original.call(this, key, value)
    }
  }

  it('写入中途配额失败：已写入的键回滚，整体不宣称成功', () => {
    const payload = buildExportPayload(ACCOUNT)
    const keptWorkspace = JSON.stringify({ savedAt: '本机旧值', data: {} })
    const keptDrafts = JSON.stringify({ savedAt: '本机旧值', data: {} })
    storage.setItem(WORKSPACE, keptWorkspace)
    storage.setItem(DRAFTS, keptDrafts)
    failWritesFor(new Set([DRAFTS]))

    const result = applyImport(payload, ACCOUNT, { [WORKSPACE]: 'import', [DRAFTS]: 'import' })
    expect(result.failed).toEqual([DRAFTS])
    expect(result.rolledBack).toBe(true)
    expect(result.applied).toEqual([])
    expect(result.unresolved).toEqual([])
    // 已经写入的那个键恢复成本机原值，不留半套数据
    expect(storage.getItem(WORKSPACE)).toBe(keptWorkspace)
    expect(storage.getItem(DRAFTS)).toBe(keptDrafts)
  })

  it('回滚本身失败时如实列进 unresolved，不静默', () => {
    const payload = buildExportPayload(ACCOUNT)
    storage.setItem(WORKSPACE, JSON.stringify({ savedAt: '本机旧值', data: {} }))
    storage.setItem(DRAFTS, JSON.stringify({ savedAt: '本机旧值', data: {} }))
    let writes = 0
    const original = MemoryStorage.prototype.setItem
    storage.setItem = function (this: MemoryStorage, key: string, value: string) {
      writes += 1
      // 第 1 次写入成功；第 2 次失败触发回滚；回滚阶段的写入同样失败。
      if (writes > 1) throw new Error('QuotaExceededError')
      original.call(this, key, value)
    }

    const result = applyImport(payload, ACCOUNT, { [WORKSPACE]: 'import', [DRAFTS]: 'import' })
    expect(result.applied).toEqual([WORKSPACE])
    expect(result.failed).toEqual([DRAFTS])
    expect(result.rolledBack).toBe(false)
    expect(result.unresolved).toEqual([{ key: WORKSPACE, reason: expect.stringContaining('回滚失败') }])
  })
})
