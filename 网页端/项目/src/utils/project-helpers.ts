import type { LanguageId, Project, ProjectCheckpoint, ProjectFile } from '../types/lesson'
import { scopedKey, STORAGE_KEYS } from './constants'
import { readLocalData, writeLocalData } from './storage'

const DEFAULT_FILE_NAMES: Record<LanguageId, string> = {
  python: 'main.py',
  javascript: 'main.js',
  csharp: 'Program.cs',
  java: 'Main.java',
  c: 'main.c',
}

const DEFAULT_PROJECT_NAMES: Record<LanguageId, string> = {
  python: '我的 Python 项目',
  javascript: '我的 JavaScript 项目',
  csharp: '我的 C# 项目',
  java: '我的 Java 项目',
  c: '我的 C 项目',
}

/**
 * 生成唯一 id。
 *
 * 修复（审计发现）：原先直接用 `Date.now()`，同一毫秒内创建的两个项目会得到相同 id，
 * 导致 React key 冲突，且「删除某项目」会按 id 匹配而误删同 id 的另一个项目。
 * 这里改为时间戳 + 单调递增计数 + 随机后缀，保证同一会话内绝不重复。
 */
let idCounter = 0
export function makeLocalId(prefix: string): string {
  idCounter += 1
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}-${random}`
}

export function makeProject(languageId: LanguageId): Project {
  const now = new Date().toISOString()
  return {
    id: makeLocalId('project'),
    name: DEFAULT_PROJECT_NAMES[languageId] ?? '我的编程项目',
    description: '从一个小想法开始练习。',
    updatedAt: now,
    files: [
      {
        id: makeLocalId('file'),
        name: DEFAULT_FILE_NAMES[languageId] ?? 'main.txt',
        language: languageId,
        code: '',
        updatedAt: now,
      },
    ],
  }
}

function projectsKey(scope: string | undefined): string {
  return scopedKey(STORAGE_KEYS.PROJECTS, scope)
}

const LANGUAGE_IDS: readonly LanguageId[] = ['python', 'javascript', 'csharp', 'java', 'c']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 单文件深层校验：缺 id/name/language 或语言非法即丢弃。 */
function normalizeFile(value: unknown): ProjectFile | undefined {
  if (!isRecord(value)) return undefined
  const { id, name, language } = value
  if (typeof id !== 'string' || id === '') return undefined
  if (typeof name !== 'string') return undefined
  if (typeof language !== 'string' || !LANGUAGE_IDS.includes(language as LanguageId)) return undefined
  return {
    id,
    name,
    language: language as LanguageId,
    code: typeof value.code === 'string' ? value.code : '',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
  }
}

/** 检查点校验：files 必须为合法文件数组，否则整条检查点丢弃。 */
function normalizeCheckpoint(value: unknown): ProjectCheckpoint | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.id !== 'string' || value.id === '') return undefined
  const files = Array.isArray(value.files)
    ? value.files.map(normalizeFile).filter((file): file is ProjectFile => file !== undefined)
    : []
  if (files.length === 0) return undefined
  return { id: value.id, at: typeof value.at === 'string' ? value.at : '', files }
}

/**
 * 项目深层校验（R2-A）：缺 id 或 files 非数组的条目整体丢弃；
 * files 内的脏文件被过滤；checkpoints 非法时归一为空数组，不阻塞项目读取。
 */
function normalizeProject(value: unknown): Project | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.id !== 'string' || value.id === '') return undefined
  if (!Array.isArray(value.files)) return undefined
  const files = value.files.map(normalizeFile).filter((file): file is ProjectFile => file !== undefined)
  const checkpoints = Array.isArray(value.checkpoints)
    ? value.checkpoints.map(normalizeCheckpoint).filter((cp): cp is ProjectCheckpoint => cp !== undefined)
    : []
  return {
    id: value.id,
    name: typeof value.name === 'string' ? value.name : '未命名项目',
    description: typeof value.description === 'string' ? value.description : '',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    files,
    checkpoints,
  }
}

function validateProjects(value: unknown): Project[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map(normalizeProject).filter((project): project is Project => project !== undefined)
}

/** 项目读写统一走版本化存储层（B4），兼容既有裸数组并在首次写回时迁移。 */
export function readProjects(scope?: string): Project[] {
  return readLocalData<Project[]>(projectsKey(scope), validateProjects) ?? []
}

export function saveProjects(projects: Project[], scope?: string): boolean {
  return writeLocalData(projectsKey(scope), projects)
}
