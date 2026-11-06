import type { LanguageId } from '../types/lesson'
import { scopedKey, STORAGE_KEYS } from './constants'
import { readLocalData, writeLocalData } from './storage'

export type SavedWorkspace = {
  languageId?: LanguageId
  /** LINK-07：内容科目（与可执行语言分开）；旧数据没有该字段时按课程回推 */
  subjectId?: string
  lessonId?: string
  lessonCode?: Record<string, string>
}

function workspaceKey(scope: string | undefined): string {
  return scopedKey(STORAGE_KEYS.WORKSPACE, scope)
}

const LANGUAGE_IDS: readonly LanguageId[] = ['python', 'javascript', 'csharp', 'java', 'c']

/**
 * 工作区校验：逐字段规范化，非法字段丢弃而不是整块回退默认值。
 * 只保留可识别的结构，避免损坏数据（例如 lessonCode 被写成数组）扩散到工作台。
 */
function validateWorkspace(value: unknown): SavedWorkspace | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const result: SavedWorkspace = {}

  if (typeof source.languageId === 'string' && LANGUAGE_IDS.includes(source.languageId as LanguageId)) {
    result.languageId = source.languageId as LanguageId
  }
  if (typeof source.lessonId === 'string' && source.lessonId !== '') {
    result.lessonId = source.lessonId
  }
  if (typeof source.subjectId === 'string' && source.subjectId !== '') {
    result.subjectId = source.subjectId
  }
  if (typeof source.lessonCode === 'object' && source.lessonCode !== null && !Array.isArray(source.lessonCode)) {
    const codes: Record<string, string> = {}
    for (const [id, code] of Object.entries(source.lessonCode as Record<string, unknown>)) {
      if (typeof code === 'string') codes[id] = code
    }
    result.lessonCode = codes
  }
  return result
}

/** 读取工作区：统一走版本化信封（兼容早期裸数据），首次写回即完成迁移。 */
export function readWorkspace(scope?: string): SavedWorkspace {
  return readLocalData<SavedWorkspace>(workspaceKey(scope), validateWorkspace) ?? {}
}

export function saveWorkspace(workspace: SavedWorkspace, scope?: string): boolean {
  return writeLocalData(workspaceKey(scope), workspace)
}

export function getLessonCode(lessonId: string, defaultCode: string, scope?: string): string {
  return readWorkspace(scope).lessonCode?.[lessonId] ?? defaultCode
}

/**
 * SAVE-01：保存快照必须把「哪个账户、哪一课、哪份代码、第几版」绑成一个整体。
 *
 * 背景：此前 app.tsx 对 code 单独防抖，延迟触发时读取的是**当时**的 activeLesson，
 * 因此「A 课程改动后立即切到 B」会把 A 的代码写进 B 的槽位。
 * 快照在编辑动作发生的瞬间创建，延迟回调只消费快照，不再读取当前状态。
 */
export type SaveSnapshot = {
  accountScope: string
  lessonId: string
  languageId: LanguageId
  code: string
  revision: number
}

export function createSaveSnapshot(input: SaveSnapshot): SaveSnapshot {
  return { ...input }
}

/**
 * 按快照保存：写入的 lessonId / scope / languageId 全部来自快照本身，
 * 因此即使调用时用户已经切课或切账户，也不会错配。
 */
export function commitSaveSnapshot(snapshot: SaveSnapshot): boolean {
  return saveLessonCode(snapshot.lessonId, snapshot.code, snapshot.languageId, snapshot.accountScope)
}

/**
 * 保存单元代码。
 *
 * 注意：这是「读-改-写」，调用方必须保证同一时刻只有一处写入该作用域，
 * 否则后写者会用陈旧快照覆盖其他字段。当前调用点集中在 app.tsx 的自动保存
 * 与关闭工作台两处，且都经过防抖；若未来新增并发写入点，应改为按键级合并写入。
 */
export function saveLessonCode(lessonId: string, code: string, languageId: LanguageId, scope?: string): boolean {
  const workspace = readWorkspace(scope)
  workspace.languageId = languageId
  // 保留同一单元之外的其他代码：只覆盖当前单元，避免丢失其他单元的草稿。
  workspace.lessonCode = { ...workspace.lessonCode, [lessonId]: code }
  return saveWorkspace(workspace, scope)
}
