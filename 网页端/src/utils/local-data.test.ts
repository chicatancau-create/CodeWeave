// @vitest-environment jsdom
/**
 * R2-C 本地数据作用域（E.3 第 4 条）与导出 schema（E.3 第 5 条）。
 * - clearLocalData(scope) 三态：account / device / all
 * - buildExportPayload：显式 schema、导出版本、账户范围、数据类别；默认排除认证与设备通知
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { buildExportPayload, clearLocalData, classifyKey, EXPORT_SCHEMA, EXPORT_VERSION, previewImport } from './local-data'
import { scopedKey, STORAGE_KEYS } from './constants'

beforeEach(() => {
  localStorage.clear()
})

describe('R2-C classifyKey 数据类别归类', () => {
  it('账户级键：工作区/项目/挑战记录/打卡/掌握度/挑战草稿', () => {
    for (const base of [
      STORAGE_KEYS.WORKSPACE,
      STORAGE_KEYS.PROJECTS,
      STORAGE_KEYS.CHALLENGES,
      STORAGE_KEYS.CHECKIN,
      STORAGE_KEYS.MASTERY,
      STORAGE_KEYS.CODE_DRAFTS,
    ]) {
      expect(classifyKey(scopedKey(base, 'user-1'))).toBe('account')
    }
  })

  it('设备级键：工作台偏好设置', () => {
    expect(classifyKey(STORAGE_KEYS.SETTINGS)).toBe('device')
  })

  it('会话级键：通知已读与通知事件', () => {
    expect(classifyKey(scopedKey(STORAGE_KEYS.NOTIFICATIONS, 'user-1'))).toBe('session')
    expect(classifyKey(scopedKey(STORAGE_KEYS.NOTIF_EVENTS, 'user-1'))).toBe('session')
  })

  it('未知 / 非 CodeWeave 键归类为 unknown', () => {
    expect(classifyKey('code-canvas.unknown.v1')).toBe('unknown')
    expect(classifyKey('other-app.key')).toBe('unknown')
  })
})

describe('R2-C clearLocalData 三态作用域', () => {
  const seed = () => {
    localStorage.setItem(scopedKey(STORAGE_KEYS.WORKSPACE, 'user-1'), 'w1')
    localStorage.setItem(scopedKey(STORAGE_KEYS.PROJECTS, 'user-2'), 'p2')
    localStorage.setItem(STORAGE_KEYS.SETTINGS, 's')
    localStorage.setItem(scopedKey(STORAGE_KEYS.NOTIFICATIONS, 'user-1'), 'n1')
    localStorage.setItem('other-app.key', 'keep')
  }

  it("scope='account' 只删除指定账户数据，保留其他账户与设备设置", () => {
    seed()
    const removed = clearLocalData('account', 'user-1')
    expect(removed.removed).toBe(true)
    expect(localStorage.getItem(scopedKey(STORAGE_KEYS.WORKSPACE, 'user-1'))).toBeNull()
    expect(localStorage.getItem(scopedKey(STORAGE_KEYS.NOTIFICATIONS, 'user-1'))).toBeNull()
    // 其他账户与设备设置保留
    expect(localStorage.getItem(scopedKey(STORAGE_KEYS.PROJECTS, 'user-2'))).not.toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.SETTINGS)).not.toBeNull()
    expect(localStorage.getItem('other-app.key')).not.toBeNull()
  })

  it("scope='device' 只删除设备级设置，保留账户学习数据", () => {
    seed()
    clearLocalData('device')
    expect(localStorage.getItem(STORAGE_KEYS.SETTINGS)).toBeNull()
    expect(localStorage.getItem(scopedKey(STORAGE_KEYS.WORKSPACE, 'user-1'))).not.toBeNull()
    expect(localStorage.getItem(scopedKey(STORAGE_KEYS.PROJECTS, 'user-2'))).not.toBeNull()
  })

  it("scope='all' 删除全部 CodeWeave 本地数据，且不触碰其他应用键", () => {
    seed()
    clearLocalData('all')
    expect(localStorage.getItem(scopedKey(STORAGE_KEYS.WORKSPACE, 'user-1'))).toBeNull()
    expect(localStorage.getItem(scopedKey(STORAGE_KEYS.PROJECTS, 'user-2'))).toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.SETTINGS)).toBeNull()
    expect(localStorage.getItem(scopedKey(STORAGE_KEYS.NOTIFICATIONS, 'user-1'))).toBeNull()
    expect(localStorage.getItem('other-app.key')).not.toBeNull()
  })

  it('返回被删除的键清单，供界面提示范围', () => {
    seed()
    const result = clearLocalData('account', 'user-1')
    expect(result.keys.length).toBe(2)
    expect(result.keys.every((k) => k.includes('user-1'))).toBe(true)
  })
})

describe('R2-C 导出 schema', () => {
  it('导出带显式 schema、导出版本、账户范围与数据类别', () => {
    localStorage.setItem(
      scopedKey(STORAGE_KEYS.WORKSPACE, 'user-1'),
      JSON.stringify({ schemaVersion: 2, data: { languageId: 'java' } }),
    )
    const payload = buildExportPayload('user-1')
    expect(payload.schema).toBe(EXPORT_SCHEMA)
    expect(payload.version).toBe(EXPORT_VERSION)
    expect(payload.scope).toBe('user-1')
    expect(typeof payload.exportedAt).toBe('string')
    expect(Array.isArray(payload.categories)).toBe(true)
    expect(payload.categories.every((c) => 'base' in c && 'category' in c)).toBe(true)
  })

  it('默认排除设备级与通知类数据（只导出账户学习数据）', () => {
    localStorage.setItem(scopedKey(STORAGE_KEYS.WORKSPACE, 'user-1'), '{"x":1}')
    localStorage.setItem(STORAGE_KEYS.SETTINGS, '{"theme":"dark"}')
    localStorage.setItem(scopedKey(STORAGE_KEYS.NOTIFICATIONS, 'user-1'), '{"read":[]}')
    const payload = buildExportPayload('user-1')
    const keys = Object.keys(payload.data)
    expect(keys.some((k) => k.includes('workspace'))).toBe(true)
    expect(keys.some((k) => k.includes('settings'))).toBe(false)
    expect(keys.some((k) => k.includes('notifications'))).toBe(false)
  })

  it('导出内容不含任何认证敏感字段（password / passwordHash / token / cookie）', () => {
    localStorage.setItem(
      scopedKey(STORAGE_KEYS.WORKSPACE, 'user-1'),
      JSON.stringify({ schemaVersion: 2, data: { password: 'plain', token: 'abc' } }),
    )
    const payload = buildExportPayload('user-1')
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('"password"')
    expect(serialized).not.toContain('"passwordHash"')
    expect(serialized).not.toContain('"token"')
    expect(serialized.toLowerCase()).not.toContain('set-cookie')
  })

  it('不导出其他账户的数据', () => {
    localStorage.setItem(scopedKey(STORAGE_KEYS.WORKSPACE, 'user-1'), '{"a":1}')
    localStorage.setItem(scopedKey(STORAGE_KEYS.WORKSPACE, 'user-2'), '{"b":2}')
    const payload = buildExportPayload('user-1')
    const keys = Object.keys(payload.data)
    expect(keys.every((k) => !k.includes('user-2'))).toBe(true)
  })

  it('无 scope 时导出 guest 作用域', () => {
    localStorage.setItem(scopedKey(STORAGE_KEYS.WORKSPACE, undefined), '{"g":1}')
    const payload = buildExportPayload(undefined)
    expect(Object.keys(payload.data).some((k) => k.includes('guest'))).toBe(true)
  })
})

/**
 * #62：预览表那一列写的是「大小 … B」，但实现取的是 `JSON.stringify(value).length`——
 * 那是 UTF-16 码元数，不是字节数。浏览器内恢复复跑实测：界面报 327 B 的条目真实 UTF-8 是 417 B，
 * 低报 21.6%；含中文的导出件必然偏小。
 */
describe('#62 预览条目的「大小」按 UTF-8 字节计，不是字符串长度', () => {
  it('含中文的条目：字节数等于 TextEncoder 的结果，且大于码元数', () => {
    localStorage.setItem(
      scopedKey(STORAGE_KEYS.WORKSPACE, 'user-zh'),
      JSON.stringify({ schemaVersion: 2, data: { code: '指针就是地址，内存单元是最小存储单位，每个单元都有唯一编号' } }),
    )
    const payload = buildExportPayload('user-zh')
    const key = Object.keys(payload.data).find((k) => k.includes('workspace'))
    expect(key).toBeTruthy()
    const text = JSON.stringify((payload.data as Record<string, unknown>)[key as string])
    const utf8Bytes = new TextEncoder().encode(text).length
    const preview = previewImport(payload, 'user-zh')
    const item = preview.items.find((entry) => entry.key === key)
    expect(item, '预览表里应当有这一条').toBeTruthy()
    expect(item?.bytes).toBe(utf8Bytes)
    // 中文是多字节：按码元数计必然偏小，这一条就是缺陷本身的可判别断言
    expect(utf8Bytes).toBeGreaterThan(text.length)
  })

  it('纯 ASCII 条目：字节数与码元数相等，改动不影响这一档', () => {
    localStorage.setItem(scopedKey(STORAGE_KEYS.PROJECTS, 'user-zh'), JSON.stringify({ schemaVersion: 2, data: { code: 'print(1)' } }))
    const payload = buildExportPayload('user-zh')
    const key = Object.keys(payload.data).find((k) => k.includes('projects'))
    const text = JSON.stringify((payload.data as Record<string, unknown>)[key as string])
    const item = previewImport(payload, 'user-zh').items.find((entry) => entry.key === key)
    expect(item?.bytes).toBe(text.length)
  })
})
