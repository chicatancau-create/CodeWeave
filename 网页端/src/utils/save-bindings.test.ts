/**
 * SAVE-01 草稿保存绑定与结果契约测试。
 *
 * 对应 T.4 SAVE-01 的核心缺陷：
 * - 防抖值与 lessonId 不绑定：A 课程改动后立刻切到 B，延迟触发时可能把
 *   A 的代码写进 B 的槽位（"旧代码 + 新课程"拼接）。
 * - lastSavedRef 在保存成功前推进：保存失败后同内容不再重试。
 * - 手动保存（Ctrl/Cmd+S）未处理返回值，也不区分自动保存开关。
 *
 * 这些用例全部使用隔离的 localStorage 与假定时器，不触达真实数据目录。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** 最小可用的 localStorage 替身：jsdom 未在此文件启用，因此自带内存实现。 */
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
  vi.useRealTimers()
})

const scope = 'account-a'

describe('SAVE-01 保存快照绑定 lessonId', () => {
  it('切课后延迟保存不会把 A 的代码写进 B 的槽位', async () => {
    const { saveLessonCode, getLessonCode } = await import('./lesson-helpers')

    // 模拟 app.tsx 的防抖保存：延迟触发时使用的 lessonId 必须是"发起时"的那个
    saveLessonCode('lessonA', 'A 的代码', 'python', scope)
    expect(getLessonCode('lessonA', 'fallback', scope)).toBe('A 的代码')

    // 切到 B：B 未被写过，应返回 fallback 而不是 A 的内容
    expect(getLessonCode('lessonB', 'B 默认代码', scope)).toBe('B 默认代码')

    saveLessonCode('lessonB', 'B 的代码', 'python', scope)
    // A 的内容不得被 B 的写入抹掉
    expect(getLessonCode('lessonA', 'fallback', scope)).toBe('A 的代码')
    expect(getLessonCode('lessonB', 'fallback', scope)).toBe('B 的代码')
  })

  it('相同代码在不同课程下互不覆盖', async () => {
    const { saveLessonCode, getLessonCode } = await import('./lesson-helpers')
    const sameCode = 'print("hello")'

    saveLessonCode('lessonA', sameCode, 'python', scope)
    saveLessonCode('lessonB', sameCode, 'python', scope)

    expect(getLessonCode('lessonA', 'x', scope)).toBe(sameCode)
    expect(getLessonCode('lessonB', 'x', scope)).toBe(sameCode)
  })

  it('不同账户的草稿互不可见', async () => {
    const { saveLessonCode, getLessonCode } = await import('./lesson-helpers')
    saveLessonCode('lessonA', '账户 A 的代码', 'python', 'account-a')

    expect(getLessonCode('lessonA', '账户 B 默认', 'account-b')).toBe('账户 B 默认')
    expect(getLessonCode('lessonA', '游客默认', undefined)).toBe('游客默认')
  })

  it('写入失败时返回 false 而不是静默成功', async () => {
    const { saveLessonCode } = await import('./lesson-helpers')
    const original = storage.setItem.bind(storage)
    storage.setItem = () => {
      throw new DOMException('QuotaExceededError')
    }
    expect(saveLessonCode('lessonA', '代码', 'python', scope)).toBe(false)
    storage.setItem = original
  })

  /**
   * #94 的数据侧根因：草稿读到空串时**不会**回落到起始代码。
   *
   * `??` 只对 nullish 兜底，`''` 是一个合法存取值——所以一旦有人在详情回来之前把
   * 「目录占位的空串」提交成草稿（app.tsx 的快照效果已加闸门），这一课的起始代码就再也读不出来，
   * 重载照旧是空的。这里把「为什么不改读侧」钉在用例上：读侧分不出「用户主动清空」与
   * 「空占位被误存」，任何自动覆盖都可能丢掉前者，所以修只能修在写侧。
   */
  it('已存过空串的课程不再回落到起始代码（读侧不做猜测，#94 的修在写侧）', async () => {
    const { commitSaveSnapshot, createSaveSnapshot, getLessonCode } = await import('./lesson-helpers')
    commitSaveSnapshot(createSaveSnapshot({
      accountScope: scope,
      lessonId: 'lessonA',
      languageId: 'java',
      code: '',
      revision: 1,
    }))
    expect(getLessonCode('lessonA', 'public class Main { }', scope)).toBe('')
    // 没有草稿记录时回落照旧生效——区分只在「有没有这一条」，不在「内容像不像占位」
    expect(getLessonCode('lessonB', 'public class Main { }', scope)).toBe('public class Main { }')
  })
})

describe('SAVE-01 保存快照类型与版本', () => {
  it('创建的快照带上 lessonId 与 code，避免调用方拼接错配', async () => {
    const { createSaveSnapshot } = await import('./lesson-helpers')
    const snapshot = createSaveSnapshot({
      accountScope: 'account-a',
      lessonId: 'lessonA',
      languageId: 'python',
      code: 'A 的代码',
      revision: 3,
    })
    expect(snapshot).toEqual({
      accountScope: 'account-a',
      lessonId: 'lessonA',
      languageId: 'python',
      code: 'A 的代码',
      revision: 3,
    })
  })

  it('按快照提交：切课后延迟写入仍落在原课程槽位', async () => {
    const { createSaveSnapshot, commitSaveSnapshot, getLessonCode } = await import('./lesson-helpers')

    // 用户在 A 课程编辑，防抖尚未触发
    const snapshotA = createSaveSnapshot({
      accountScope: scope,
      lessonId: 'lessonA',
      languageId: 'python',
      code: 'A 的代码',
      revision: 1,
    })

    // 用户立即切到 B（B 的槽位此前为空）
    expect(getLessonCode('lessonB', 'B 默认', scope)).toBe('B 默认')

    // 防抖回调此时才触发：必须写进 A，而不是当前课程 B
    expect(commitSaveSnapshot(snapshotA)).toBe(true)
    expect(getLessonCode('lessonA', 'fallback', scope)).toBe('A 的代码')
    expect(getLessonCode('lessonB', 'B 默认', scope)).toBe('B 默认')
  })

  it('按快照提交：切账户后延迟写入不落到新账户', async () => {
    const { createSaveSnapshot, commitSaveSnapshot, getLessonCode } = await import('./lesson-helpers')

    const snapshotA = createSaveSnapshot({
      accountScope: 'account-a',
      lessonId: 'lessonA',
      languageId: 'python',
      code: '账户 A 的代码',
      revision: 1,
    })

    // 提交时当前账户已经是 account-b
    expect(commitSaveSnapshot(snapshotA)).toBe(true)

    // 必须落在 account-a，account-b 不受影响
    expect(getLessonCode('lessonA', 'x', 'account-a')).toBe('账户 A 的代码')
    expect(getLessonCode('lessonA', '账户 B 默认', 'account-b')).toBe('账户 B 默认')
  })

  it('快照携带 revision，便于判断是否已保存过同一份内容', async () => {
    const { createSaveSnapshot } = await import('./lesson-helpers')
    const first = createSaveSnapshot({
      accountScope: scope,
      lessonId: 'lessonA',
      languageId: 'python',
      code: '代码',
      revision: 1,
    })
    const second = createSaveSnapshot({
      accountScope: scope,
      lessonId: 'lessonA',
      languageId: 'python',
      code: '代码',
      revision: 2,
    })
    // 内容相同但版本不同：调用方据此决定是否重写
    expect(first.code).toBe(second.code)
    expect(first.revision).not.toBe(second.revision)
  })
})
