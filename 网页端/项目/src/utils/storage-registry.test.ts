/**
 * DATA-01 统一存储注册表与隔离契约测试。
 *
 * 对应 T.4 DATA-01 的验收要求：
 * - A/B 两个虚构账户、guest、设备偏好、旧通知键、外部证据均有隔离测试
 * - 清理返回成功键/失败键/错误类别，全失败不提示成功，部分失败不掩盖错误
 * - 导出仅含目标范围的账户级数据
 *
 * 全部使用隔离的内存 localStorage，不触达真实数据目录。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 本文件有一条源码核对（通知键必须过 scopedKey），按仓库惯例用动态 import 读盘（未装 @types/node）
const fsSpecifier: string = 'node:fs'
const { readFileSync } = (await import(fsSpecifier)) as { readFileSync: (path: string, encoding: 'utf8') => string }

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

beforeEach(() => {
  storage = new MemoryStorage()
  vi.stubGlobal('localStorage', storage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const K = {
  workspace: 'code-canvas.workspace.v2',
  projects: 'code-canvas.projects.v1',
  challenges: 'code-canvas.challenge-progress.v2',
  checkin: 'code-canvas.checkin.v1',
  settings: 'code-canvas.settings.v1',
  mastery: 'code-canvas.mastery.v1',
  drafts: 'code-canvas.challenge-drafts.v1',
  evidence: 'code-canvas.external-evidence.v1',
  notifications: 'code-canvas.notifications.v1',
  notifEvents: 'code-canvas.notification-events.v1',
}

describe('DATA-01 注册表覆盖与归类', () => {
  it('外部证据已纳入账户级类别（此前漏出导出与清理）', async () => {
    const { classifyKey, descriptorOf } = await import('./storage-registry')
    expect(classifyKey(K.evidence)).toBe('account')
    expect(descriptorOf(K.evidence)?.label).toContain('外部')
  })

  it('设置归类为设备级，通知归类为会话级', async () => {
    const { classifyKey } = await import('./storage-registry')
    expect(classifyKey(K.settings)).toBe('device')
    expect(classifyKey(K.notifications)).toBe('session')
    expect(classifyKey(K.notifEvents)).toBe('session')
  })

  it('所有 STORAGE_KEYS 都已登记，没有类别漂移', async () => {
    const { classifyKey } = await import('./storage-registry')
    const { STORAGE_KEYS } = await import('./constants')
    const unregistered = Object.values(STORAGE_KEYS).filter((key) => classifyKey(key) === 'unknown')
    expect(unregistered).toEqual([])
  })

  it('非本应用前缀的键归类为 unknown，不被误删', async () => {
    const { classifyKey } = await import('./storage-registry')
    expect(classifyKey('some-other-app.key')).toBe('unknown')
  })
})

describe('DATA-01 账户隔离', () => {
  it('A/B 两账户数据互不可见，guest 单独隔离', async () => {
    const { belongsToScope } = await import('./storage-registry')
    const keyA = `${K.workspace}:account-a`
    const keyB = `${K.workspace}:account-b`
    const keyGuest = `${K.workspace}:guest`

    expect(belongsToScope(keyA, 'account-a')).toBe(true)
    expect(belongsToScope(keyA, 'account-b')).toBe(false)
    expect(belongsToScope(keyB, 'account-b')).toBe(true)
    expect(belongsToScope(keyGuest, 'guest')).toBe(true)
    expect(belongsToScope(keyGuest, 'account-a')).toBe(false)
  })

  it('设备级数据不属于任何账户（清理账户数据不得删除设备设置）', async () => {
    const { belongsToScope } = await import('./storage-registry')
    expect(belongsToScope(K.settings, 'account-a')).toBe(false)
    expect(belongsToScope(K.settings, 'guest')).toBe(false)
  })

  it('旧的无 scope 通知键归属未知，不静默划给当前账户', async () => {
    const { belongsToScope, classifyKey } = await import('./storage-registry')
    // 旧键：无 `:scope` 后缀
    expect(classifyKey(K.notifications)).toBe('session')
    expect(belongsToScope(K.notifications, 'account-a')).toBe(false)
    expect(belongsToScope(K.notifications, 'guest')).toBe(false)
  })
})

describe('DATA-01 清理入口：成功键与失败键', () => {
  it('账户清理只删除当前账户的会话与账户级数据，保留设备设置与其他账户', async () => {
    const { clearLocalData } = await import('./local-data')
    storage.setItem(`${K.workspace}:account-a`, '{"a":1}')
    storage.setItem(`${K.challenges}:account-a`, '{"a":2}')
    storage.setItem(`${K.notifications}:account-a`, '{"a":3}')
    storage.setItem(`${K.workspace}:account-b`, '{"b":1}')
    storage.setItem(K.settings, '{"theme":1}')

    const result = clearLocalData('account', 'account-a')

    expect(result.removed).toBe(true)
    expect(result.failedKeys).toEqual([])
    expect(storage.getItem(`${K.workspace}:account-a`)).toBeNull()
    expect(storage.getItem(`${K.challenges}:account-a`)).toBeNull()
    expect(storage.getItem(`${K.notifications}:account-a`)).toBeNull()
    // 其他账户与设备设置必须保留
    expect(storage.getItem(`${K.workspace}:account-b`)).toBe('{"b":1}')
    expect(storage.getItem(K.settings)).toBe('{"theme":1}')
  })

  it('设备清理只删除设备级键，保留账户数据', async () => {
    const { clearLocalData } = await import('./local-data')
    storage.setItem(K.settings, '{"theme":1}')
    storage.setItem(`${K.workspace}:account-a`, '{"a":1}')

    const result = clearLocalData('device')

    expect(result.removed).toBe(true)
    expect(storage.getItem(K.settings)).toBeNull()
    expect(storage.getItem(`${K.workspace}:account-a`)).toBe('{"a":1}')
  })

  it('删除部分失败时返回失败键，且 removed 为 false（不掩盖错误）', async () => {
    const { clearLocalData } = await import('./local-data')
    storage.setItem(`${K.workspace}:account-a`, '{"a":1}')
    storage.setItem(`${K.challenges}:account-a`, '{"a":2}')

    const original = storage.removeItem.bind(storage)
    storage.removeItem = (key: string) => {
      if (key === `${K.challenges}:account-a`) throw new DOMException('SecurityError')
      original(key)
    }

    const result = clearLocalData('account', 'account-a')

    // 部分失败：不得声称整体成功
    expect(result.removed).toBe(false)
    expect(result.failedKeys).toEqual([`${K.challenges}:account-a`])
    expect(result.keys).toEqual([`${K.workspace}:account-a`])
    // 失败的那条数据必须仍在（未被误报删除）
    expect(storage.getItem(`${K.challenges}:account-a`)).toBe('{"a":2}')
  })

  it('全部失败时 removed 为 false 且失败键完整列出', async () => {
    const { clearLocalData } = await import('./local-data')
    storage.setItem(`${K.workspace}:account-a`, '{"a":1}')

    const original = storage.removeItem.bind(storage)
    storage.removeItem = () => {
      throw new DOMException('SecurityError')
    }

    const result = clearLocalData('account', 'account-a')

    expect(result.removed).toBe(false)
    expect(result.failedKeys).toEqual([`${K.workspace}:account-a`])
    expect(result.keys).toEqual([])
    storage.removeItem = original
  })
})

describe('DATA-01 导出范围', () => {
  it('导出只含目标账户的账户级数据，不含设备级与通知', async () => {
    const { buildExportPayload } = await import('./local-data')
    storage.setItem(`${K.workspace}:account-a`, JSON.stringify({ schemaVersion: 3, data: { languageId: 'python' } }))
    storage.setItem(`${K.evidence}:account-a`, JSON.stringify({ schemaVersion: 3, data: [{ command: 'npm test' }] }))
    storage.setItem(`${K.notifications}:account-a`, JSON.stringify({ schemaVersion: 3, data: { readIds: [] } }))
    storage.setItem(K.settings, JSON.stringify({ schemaVersion: 3, data: { autosave: true } }))
    storage.setItem(`${K.workspace}:account-b`, JSON.stringify({ schemaVersion: 3, data: { languageId: 'java' } }))

    const payload = buildExportPayload('account-a')

    expect(payload.scope).toBe('account-a')
    expect(Object.keys(payload.data)).toContain(`${K.workspace}:account-a`)
    // 外部证据必须被导出（此前缺失）
    expect(Object.keys(payload.data)).toContain(`${K.evidence}:account-a`)
    // 设备级与通知默认排除
    expect(Object.keys(payload.data)).not.toContain(K.settings)
    expect(Object.keys(payload.data)).not.toContain(`${K.notifications}:account-a`)
    // 其他账户不得混入
    expect(Object.keys(payload.data)).not.toContain(`${K.workspace}:account-b`)
  })

  it('导出的类别清单来自注册表，且包含外部证据', async () => {
    const { buildExportPayload } = await import('./local-data')
    storage.setItem(`${K.evidence}:account-a`, JSON.stringify({ schemaVersion: 3, data: [] }))

    const payload = buildExportPayload('account-a')
    const bases = payload.categories.map((entry) => entry.base)
    expect(bases).toContain(K.evidence)
  })

  it('损坏的 JSON 不导致导出崩溃', async () => {
    const { buildExportPayload } = await import('./local-data')
    storage.setItem(`${K.workspace}:account-a`, '{ 这不是合法 JSON')

    expect(() => buildExportPayload('account-a')).not.toThrow()
  })
})

/**
 * DATA-01 第 3 条的漂移守卫：注册表把两类通知都声明为按账户隔离，
 * 改版前 `app.tsx` 却把它们写在**未加后缀**的键上——于是「清除本账户数据」永远清不到
 * 真实通知，隐私清单那一行还恒显「从未保存」。这里钉住「写它的地方必须过 scopedKey」。
 * 说明：这是源码文本核对（jsdom 里跑一遍 App 再点通知也是可行的，但那份断言要等组件树上
 * 有可点的通知行才有意义，文本核对更稳），断言的是「不许退回未加后缀的写法」。
 */
describe('DATA-01 第 3 条 · 通知的真实写入必须带账户后缀', () => {
  const here = (import.meta as unknown as { dirname?: string }).dirname ?? '.'
  const appSource = readFileSync(`${here}/../app.tsx`, 'utf8')

  it('useLocalStorage 的两个通知键都包在 scopedKey 里', () => {
    for (const base of ['NOTIFICATIONS', 'NOTIF_EVENTS']) {
      const pattern = new RegExp(`useLocalStorage[\\s\\S]{0,160}scopedKey\\(STORAGE_KEYS\\.${base},\\s*scope\\)`)
      expect(pattern.test(appSource), `app.tsx 里 STORAGE_KEYS.${base} 又退回未加后缀的键了`).toBe(true)
      expect(appSource.includes(`useLocalStorage<NotificationItem[]>(STORAGE_KEYS.${base}`), `${base} 出现了裸键`).toBe(false)
    }
  })
})
