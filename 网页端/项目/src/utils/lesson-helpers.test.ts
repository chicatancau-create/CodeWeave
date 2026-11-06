// @vitest-environment jsdom
/**
 * R2 工作区存储协议：统一版本化信封 + 损坏数据局部规范化。
 *
 * 背景（审计发现 AUD-05 同类问题）：工作区曾用裸 localStorage 读写，
 * 与 B4 的 `{schemaVersion, data}` 信封协议不一致，导致数据与隐私页
 * 读不到保存时间，且损坏结构会直接扩散到工作台。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getLessonCode, readWorkspace, saveLessonCode, saveWorkspace } from './lesson-helpers'
import { scopedKey, STORAGE_KEYS } from './constants'
import { SCHEMA_VERSION, unwrapEnvelope } from './storage'

const key = (scope: string) => scopedKey(STORAGE_KEYS.WORKSPACE, scope)

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

describe('R2 工作区版本化信封', () => {
  it('保存后写入 schemaVersion 信封，而不是裸对象', () => {
    saveWorkspace({ languageId: 'python', lessonId: 'python-loop-sum' }, 'user-1')
    const raw = JSON.parse(localStorage.getItem(key('user-1'))!)
    expect(raw.schemaVersion).toBe(SCHEMA_VERSION)
    expect(raw.savedAt).toBeTruthy()
    expect(unwrapEnvelope(raw)).toMatchObject({ lessonId: 'python-loop-sum' })
  })

  it('读取早期裸数据（无信封）仍然可用，并在写回时升级', () => {
    // 模拟旧版本写入的裸数据
    localStorage.setItem(key('user-1'), JSON.stringify({ languageId: 'java', lessonId: 'b1-array-basics' }))
    expect(readWorkspace('user-1').lessonId).toBe('b1-array-basics')

    saveLessonCode('b1-array-basics', 'const a = 1', 'java', 'user-1')
    const raw = JSON.parse(localStorage.getItem(key('user-1'))!)
    expect(raw.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('不同账户作用域互不可见', () => {
    saveWorkspace({ lessonId: 'a-lesson' }, 'user-1')
    saveWorkspace({ lessonId: 'b-lesson' }, 'user-2')
    expect(readWorkspace('user-1').lessonId).toBe('a-lesson')
    expect(readWorkspace('user-2').lessonId).toBe('b-lesson')
  })
})

describe('R2 工作区损坏数据的局部规范化', () => {
  it('非法 JSON 回退为空工作区，不抛错', () => {
    localStorage.setItem(key('user-1'), '{broken json')
    expect(readWorkspace('user-1')).toEqual({})
  })

  it('lessonCode 被写成数组时整块丢弃，但 lessonId 仍保留', () => {
    localStorage.setItem(
      key('user-1'),
      JSON.stringify({ schemaVersion: SCHEMA_VERSION, data: { lessonId: 'x', lessonCode: ['bad'] } }),
    )
    const workspace = readWorkspace('user-1')
    expect(workspace.lessonId).toBe('x')
    expect(workspace.lessonCode).toBeUndefined()
  })

  it('lessonCode 内的非字符串值被过滤，字符串值保留', () => {
    localStorage.setItem(
      key('user-1'),
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        data: { lessonCode: { keep: 'code', drop: 42, alsoDrop: null } },
      }),
    )
    expect(readWorkspace('user-1').lessonCode).toEqual({ keep: 'code' })
  })

  it('非法语言 id 被忽略', () => {
    localStorage.setItem(
      key('user-1'),
      JSON.stringify({ schemaVersion: SCHEMA_VERSION, data: { languageId: 'brainfuck', lessonId: 'x' } }),
    )
    const workspace = readWorkspace('user-1')
    expect(workspace.languageId).toBeUndefined()
    expect(workspace.lessonId).toBe('x')
  })

  it('顶层为数组或字符串时不视为合法工作区', () => {
    localStorage.setItem(key('user-1'), JSON.stringify([1, 2, 3]))
    expect(readWorkspace('user-1')).toEqual({})
  })
})

describe('R2 单元代码读写', () => {
  it('保存一个单元的代码不会丢失其他单元的草稿', () => {
    saveLessonCode('l1', 'code-1', 'python', 'user-1')
    saveLessonCode('l2', 'code-2', 'python', 'user-1')
    saveLessonCode('l1', 'code-1-updated', 'python', 'user-1')

    expect(getLessonCode('l1', 'default', 'user-1')).toBe('code-1-updated')
    // 关键回归：第二次保存不得把 l2 的快照覆盖掉
    expect(getLessonCode('l2', 'default', 'user-1')).toBe('code-2')
  })

  it('未保存过的单元返回默认代码', () => {
    expect(getLessonCode('never-saved', 'fallback', 'user-1')).toBe('fallback')
  })

  it('保存代码同时记录当前语言', () => {
    saveLessonCode('l1', 'x', 'javascript', 'user-1')
    expect(readWorkspace('user-1').languageId).toBe('javascript')
  })
})
