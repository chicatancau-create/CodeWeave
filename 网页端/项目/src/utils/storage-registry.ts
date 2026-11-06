/**
 * DATA-01：统一本地存储注册表。
 *
 * 背景（T.4 DATA-01 证据）：
 * - 此前有三份手写类别列表（local-data 的 ACCOUNT_BASES / DEVICE_BASES / SESSION_BASES、
 *   data-privacy-view 的展示清单、constants 的键定义），彼此漂移：
 *   · EXTERNAL_EVIDENCE 已存在但未纳入任何类别 → 外部证据草稿不参与导出与清理
 *   · 通知实际使用**未加 scope** 的键，却被 local-data 声明为带 scope 的会话数据
 * - 现在所有类别、隔离范围、展示名、导出策略都由本表唯一生成，不再手写第二份。
 *
 * 隔离范围（scope）语义：
 * - 'account'：按账户隔离，实际键形如 `base:scope`（未登录为 `:guest`）
 * - 'device' ：设备级，键无后缀，与账户无关
 * - 'session'：随账户变化的会话状态，实际键形如 `base:scope`
 *
 * 注意（诚实性要求）：浏览器内的账户隔离是**应用级分区**，
 * 不是对本机管理员或开发者工具的加密保护。
 */

import { STORAGE_KEYS } from './constants'

/** 数据隔离范围。'unknown' 仅用于归类无法识别的键。 */
export type StorageScope = 'account' | 'device' | 'session' | 'unknown'

/** 导出策略：'include' 默认导出 / 'exclude' 默认排除（可显式要求）/ 'never' 永不导出。 */
export type ExportPolicy = 'include' | 'exclude' | 'never'

export type StorageDescriptor = {
  /** 基础键（不含 `:scope` 后缀）。 */
  baseKey: string
  /** 隔离范围。 */
  scope: StorageScope
  /** 界面展示名称。 */
  label: string
  /** 导出策略。 */
  exportPolicy: ExportPolicy
  /** 读取版本信息的说明，供数据与隐私中心展示"读取保存时间"的方式。 */
  versionNote: string
}

/**
 * 唯一注册表。新增任何本地存储键都必须先在此登记，
 * 否则 classifyKey 会把它归为 'unknown'，导出与清理都不会触碰它。
 */
export const STORAGE_REGISTRY: readonly StorageDescriptor[] = [
  {
    baseKey: STORAGE_KEYS.WORKSPACE,
    scope: 'account',
    label: '课程工作区与代码草稿',
    exportPolicy: 'include',
    versionNote: '读取版本化信封的 savedAt',
  },
  {
    baseKey: STORAGE_KEYS.PROJECTS,
    scope: 'account',
    label: '项目检查点草稿',
    exportPolicy: 'include',
    versionNote: '读取版本化信封的 savedAt',
  },
  {
    baseKey: STORAGE_KEYS.CHALLENGES,
    scope: 'account',
    label: '挑战提交记录',
    exportPolicy: 'include',
    versionNote: '读取版本化信封的 savedAt',
  },
  {
    baseKey: STORAGE_KEYS.CHECKIN,
    scope: 'account',
    label: '每日打卡',
    exportPolicy: 'include',
    versionNote: '读取版本化信封的 savedAt',
  },
  {
    baseKey: STORAGE_KEYS.MASTERY,
    scope: 'account',
    label: '掌握度与复测计划',
    exportPolicy: 'include',
    versionNote: '读取版本化信封的 savedAt',
  },
  {
    baseKey: STORAGE_KEYS.CODE_DRAFTS,
    scope: 'account',
    label: '挑战代码草稿',
    exportPolicy: 'include',
    versionNote: '读取版本化信封的 savedAt',
  },
  {
    // DATA-01 第 2 条：此键此前未纳入任何类别，导致外部证据草稿漏出导出与清理。
    baseKey: STORAGE_KEYS.EXTERNAL_EVIDENCE,
    scope: 'account',
    label: '外部环境实验证据',
    exportPolicy: 'include',
    versionNote: '读取版本化信封的 savedAt',
  },
  {
    baseKey: STORAGE_KEYS.SETTINGS,
    scope: 'device',
    label: '工作台偏好设置',
    exportPolicy: 'exclude',
    versionNote: '读取版本化信封的 savedAt',
  },
  {
    // DATA-01 第 3 条：通知标题可能带课程/项目内容，因此应按账户隔离。
    // 历史数据可能是不带 scope 的旧键，仍能被识别（见 classifyKey 的兼容分支）。
    baseKey: STORAGE_KEYS.NOTIFICATIONS,
    scope: 'session',
    label: '通知已读状态',
    exportPolicy: 'exclude',
    versionNote: '读取版本化信封的 savedAt',
  },
  {
    baseKey: STORAGE_KEYS.NOTIF_EVENTS,
    scope: 'session',
    label: '通知事件记录',
    exportPolicy: 'exclude',
    versionNote: '读取版本化信封的 savedAt',
  },
] as const

const REGISTRY_BY_BASE = new Map(STORAGE_REGISTRY.map((entry) => [entry.baseKey, entry]))

export const STORAGE_PREFIX = 'code-canvas.'

/** 从 `base:scope` 取出 base 部分（无后缀时返回原键）。 */
export function baseOf(key: string): string {
  const colon = key.indexOf(':')
  return colon === -1 ? key : key.slice(0, colon)
}

/** 从 `base:scope` 取出 scope 部分（无后缀时返回 undefined）。 */
export function scopeOf(key: string): string | undefined {
  const colon = key.indexOf(':')
  return colon === -1 ? undefined : key.slice(colon + 1)
}

/** 按 base 取描述符；未登记的键返回 undefined。 */
export function descriptorOf(key: string): StorageDescriptor | undefined {
  return REGISTRY_BY_BASE.get(baseOf(key))
}

/** 归类键的隔离范围。未登记或非本应用前缀的键返回 'unknown'。 */
export function classifyKey(key: string): StorageScope {
  if (!key.startsWith(STORAGE_PREFIX)) return 'unknown'
  return descriptorOf(key)?.scope ?? 'unknown'
}

/**
 * 判断某键在给定账户作用域下是否属于"当前账户"。
 * 设备级数据与账户无关，恒为 false（清理账户数据时不应删除设备设置）。
 * 未带 scope 的旧键归属未知，不自动划给任何账户（DATA-01 第 3 条）。
 */
export function belongsToScope(key: string, target: string): boolean {
  const descriptor = descriptorOf(key)
  if (!descriptor) return false
  if (descriptor.scope !== 'account' && descriptor.scope !== 'session') return false
  return scopeOf(key) === target
}

/** 生成导出时使用的类别清单（只含 exportPolicy 允许的账户级类别）。 */
export function exportableDescriptors(): StorageDescriptor[] {
  return STORAGE_REGISTRY.filter(
    (entry) => entry.scope === 'account' && entry.exportPolicy === 'include',
  )
}

export function labelOf(key: string): string {
  return descriptorOf(key)?.label ?? baseOf(key)
}
