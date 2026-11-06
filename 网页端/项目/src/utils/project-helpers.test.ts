// @vitest-environment jsdom
/**
 * R2-A 项目数据协议：读写统一走版本化信封，兼容既有裸数组并迁移，
 * 损坏对象在边界处被过滤，不得扩散到组件。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../types/lesson'
import { readProjects, saveProjects } from './project-helpers'
import { SCHEMA_VERSION, readSavedAt } from './storage'
import { scopedKey, STORAGE_KEYS } from './constants'

const key = (scope?: string) => scopedKey(STORAGE_KEYS.PROJECTS, scope)

const validProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'project-1',
  name: '示例项目',
  description: '描述',
  updatedAt: '2026-09-13T00:00:00.000Z',
  files: [{ id: 'file-1', name: 'main.py', language: 'python', code: 'print(1)', updatedAt: '2026-09-13T00:00:00.000Z' }],
  ...overrides,
})

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('R2-A 项目读取：信封与裸数组兼容', () => {
  it('写入带 schemaVersion 信封与 savedAt，读回内容一致', () => {
    saveProjects([validProject()], 'user-1')
    const raw = JSON.parse(localStorage.getItem(key('user-1'))!)
    expect(raw.schemaVersion).toBe(SCHEMA_VERSION)
    expect(typeof raw.savedAt).toBe('string')
    expect(raw.data).toHaveLength(1)
    expect(readSavedAt(key('user-1'))).not.toBeNull()

    const back = readProjects('user-1')
    expect(back).toHaveLength(1)
    expect(back[0]!.id).toBe('project-1')
    expect(back[0]!.files[0]!.code).toBe('print(1)')
  })

  it('读取既有裸数组（旧版本遗留）不丢失内容，首次写回迁移为信封', () => {
    localStorage.setItem(key(), JSON.stringify([validProject({ id: 'legacy-1' })]))
    const back = readProjects()
    expect(back).toHaveLength(1)
    expect(back[0]!.id).toBe('legacy-1')

    saveProjects(back)
    const migrated = JSON.parse(localStorage.getItem(key())!)
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(Array.isArray(migrated.data)).toBe(true)
  })

  it('旧版本信封（schemaVersion 较小）可读取', () => {
    localStorage.setItem(key(), JSON.stringify({ schemaVersion: 1, data: [validProject({ id: 'v1' })] }))
    const back = readProjects()
    expect(back).toHaveLength(1)
    expect(back[0]!.id).toBe('v1')
  })

  it('账户作用域隔离：不同 scope 互不可见', () => {
    saveProjects([validProject({ id: 'a' })], 'user-a')
    saveProjects([validProject({ id: 'b' })], 'user-b')
    expect(readProjects('user-a').map((p) => p.id)).toEqual(['a'])
    expect(readProjects('user-b').map((p) => p.id)).toEqual(['b'])
  })
})

describe('R2-A 项目读取：损坏数据边界防御', () => {
  it('非法 JSON 返回空数组并输出警告，不抛出', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem(key(), '{bad json')
    expect(readProjects()).toEqual([])
    expect(warn).toHaveBeenCalled()
  })

  it('结构错误（对象而非数组）返回空数组', () => {
    localStorage.setItem(key(), JSON.stringify({ projects: [] }))
    expect(readProjects()).toEqual([])
  })

  it('过滤缺 id、缺 files、files 非数组的脏条目，仅保留合法项', () => {
    localStorage.setItem(key(), JSON.stringify([
      validProject({ id: 'good-1' }),
      { name: '缺 id' },
      { id: 'no-files', name: 'x', description: '', updatedAt: '', files: 'nope' },
      null,
      'string',
      validProject({ id: 'good-2' }),
    ]))
    const back = readProjects()
    expect(back.map((p) => p.id)).toEqual(['good-1', 'good-2'])
  })

  it('过滤 files 内的脏文件条目', () => {
    localStorage.setItem(key(), JSON.stringify([
      validProject({
        files: [
          { id: 'ok', name: 'main.py', language: 'python', code: '', updatedAt: '' },
          { name: '缺 id' },
          null,
        ] as never,
      }),
    ]))
    const back = readProjects()
    expect(back[0]!.files.map((f) => f.id)).toEqual(['ok'])
  })

  it('checkpoints 非法时归一为空数组，不阻塞项目读取', () => {
    localStorage.setItem(key(), JSON.stringify([validProject({ checkpoints: 'broken' as never })]))
    const back = readProjects()
    expect(back).toHaveLength(1)
    expect(Array.isArray(back[0]!.checkpoints)).toBe(true)
  })
})

describe('R2-A 保存失败不抛出', () => {
  it('localStorage 写入抛错时捕获并返回 false，不向上抛出', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    expect(() => saveProjects([validProject()])).not.toThrow()
    expect(warn).toHaveBeenCalled()
  })
})
