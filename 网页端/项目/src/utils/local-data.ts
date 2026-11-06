/**
 * 本地数据作用域与导出协议（R2-C / DATA-01）。
 *
 * 类别、隔离范围、展示名与导出策略全部来自 `storage-registry.ts` 的唯一注册表，
 * 本文件不再维护第二份手写类别列表（这是 DATA-01 的根因）。
 *
 * 清除入口统一调用 clearLocalData(scope)，界面必须显示同一范围说明。
 * 导出使用显式 schema + 导出版本 + 账户范围 + 数据类别，默认排除设备级与通知数据。
 *
 * 诚实性边界：浏览器中的账户隔离是**应用级分区**，
 * 不是对本机管理员或开发者工具的加密保护。
 */

import {
  baseOf,
  belongsToScope,
  classifyKey,
  descriptorOf,
  exportableDescriptors,
  labelOf,
  scopeOf,
  STORAGE_PREFIX,
  type StorageScope,
} from './storage-registry'

export type { StorageScope as DataCategory } from './storage-registry'
export { classifyKey }

export type ClearScope = 'account' | 'device' | 'all'

/** 单个键的删除失败记录。 */
export type ClearFailure = { key: string; reason: string }

/** 清理结果：成功键、失败键与整体是否成功（失败时不宣称成功）。 */
export type ClearResult = {
  removed: boolean
  keys: string[]
  failedKeys: string[]
  failures: ClearFailure[]
  /** 本次涉及的类别数量，供界面提示影响范围。 */
  categories: number
}

/** 导出协议标识与版本：消费方据此判断兼容性。 */
export const EXPORT_SCHEMA = 'codeweave.learning-data'
export const EXPORT_VERSION = 1

/** 导出时排除的敏感字段名（尽力而为的兜底，正常数据不应包含）。 */
const SENSITIVE_FIELD_NAMES = ['password', 'passwordHash', 'token', 'cookie', 'secret', 'apiKey', 'authorization']

/** 枚举当前 localStorage 中所有 CodeWeave 键（前缀匹配）。 */
function collectKeys(): string[] {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (key && key.startsWith(STORAGE_PREFIX)) keys.push(key)
  }
  return keys
}

/**
 * 逐个删除并如实记录结果。
 * 失败不会被吞掉：failedKeys 与 failures 都返回给调用方，removed 仅在全部成功时为 true。
 */
function removeKeys(keys: string[]): ClearResult {
  const removedKeys: string[] = []
  const failures: ClearFailure[] = []
  const categories = new Set<string>()

  for (const key of keys) {
    const descriptor = descriptorOf(key)
    if (descriptor) categories.add(descriptor.baseKey)
    try {
      localStorage.removeItem(key)
      removedKeys.push(key)
    } catch (error) {
      failures.push({ key, reason: error instanceof Error ? error.message : String(error) })
      console.warn(`[code-canvas] 本地数据 ${key} 删除失败。`, error)
    }
  }

  return {
    removed: failures.length === 0,
    keys: removedKeys,
    failedKeys: failures.map((entry) => entry.key),
    failures,
    categories: categories.size,
  }
}

/**
 * 统一清除入口。
 * @param scope     'account' 仅当前账户学习数据 / 'device' 仅设备设置 / 'all' 全部 CodeWeave 本地数据
 * @param accountId scope='account' 时必填；其他作用域忽略
 */
export function clearLocalData(scope: ClearScope, accountId?: string): ClearResult {
  const all = collectKeys()
  if (scope === 'all') return removeKeys(all)
  if (scope === 'device') {
    return removeKeys(all.filter((key) => classifyKey(key) === 'device'))
  }
  // scope === 'account'：只删当前账户的账户级与会话级数据（两者都带账户 scope）。
  // 未带 scope 的旧键归属未知，不自动划给当前账户（DATA-01 第 3 条）。
  const target = accountId ?? 'guest'
  return removeKeys(all.filter((key) => belongsToScope(key, target)))
}

/** 递归剔除敏感字段，兜底防止凭据进入导出文件。 */
function stripSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSensitive)
  if (typeof value !== 'object' || value === null) return value
  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(source)) {
    if (SENSITIVE_FIELD_NAMES.some((name) => key.toLowerCase() === name.toLowerCase())) continue
    result[key] = stripSensitive(entry)
  }
  return result
}

export type ExportCategory = { base: string; category: string; label: string }

export type ExportPayload = {
  schema: string
  version: number
  exportedAt: string
  scope: string
  categories: ExportCategory[]
  data: Record<string, unknown>
}

/**
 * 构造导出负载：只含指定账户的账户级学习数据，
 * 默认排除设备级设置与通知类会话数据（E.3 第 5 条 / DATA-01 第 5 条）。
 *
 * 字段名过滤**不是**代码文本中的密钥检测：用户自己写进代码、笔记或证据里的
 * 敏感内容不会被识别，因此界面不得声称导出文件"绝对无凭据"。
 */
export function buildExportPayload(accountId?: string): ExportPayload {
  const scope = accountId ?? 'guest'
  const data: Record<string, unknown> = {}
  const categories: ExportCategory[] = []
  const allowedBases = new Set(exportableDescriptors().map((entry) => entry.baseKey))

  for (const key of collectKeys()) {
    const descriptor = descriptorOf(key)
    if (!descriptor) continue
    if (!allowedBases.has(descriptor.baseKey)) continue
    if (scopeOf(key) !== scope) continue

    let parsed: unknown
    const raw = localStorage.getItem(key)
    try {
      parsed = JSON.parse(raw ?? 'null')
    } catch {
      parsed = raw
    }
    data[key] = stripSensitive(parsed)
    const base = baseOf(key)
    if (!categories.some((entry) => entry.base === base)) {
      categories.push({ base, category: descriptor.scope, label: labelOf(key) })
    }
  }

  return {
    schema: EXPORT_SCHEMA,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    scope,
    categories,
    data,
  }
}

// ---------------------------------------------------------------------------
// 导入预览与恢复（DATA-09 · 方案 §6.2）
//
// 换目录或换 origin 后，浏览器 localStorage 看起来「丢了」；恢复路径是导出 → 预览 → 选择 → 应用。
// 不可信输入处理：只接受已注册且允许导出的键，绝不按文件里写的名字写任意 localStorage 键；
// 默认不覆盖目标已有记录；账户 ID 与旧实体 ID 原样保留，不做重映射。
// ---------------------------------------------------------------------------

export type ImportDecision = 'skip' | 'import'

/** 'cross-scope' 表示这份数据属于另一个账户的槽位：界面上不给勾选，数据层无条件跳过。 */
export type ImportStatus = 'new' | 'conflict' | 'identical' | 'cross-scope' | 'rejected'

export type ImportItemPlan = {
  key: string
  base: string
  label: string
  category: StorageScope
  status: ImportStatus
  bytes: number
  /** 默认决策：冲突与跨范围都是 skip，绝不静默覆盖。 */
  decision: ImportDecision
  reason?: string
}

export type ImportPreview = {
  ok: boolean
  errors: string[]
  warnings: string[]
  source: { scope: string; exportedAt: string; version: number } | null
  items: ImportItemPlan[]
  counts: Record<ImportStatus, number>
}

export type ImportResult = {
  applied: string[]
  skipped: string[]
  /** 本次写入失败的键（回滚成功时它们不算未解决）。 */
  failed: string[]
  /** 写入中途失败时是否已把写过的键恢复原值。 */
  rolledBack: boolean
  /** 恢复不回去的键：必须如实报告，不宣称成功。 */
  unresolved: { key: string; reason: string }[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** 校验导出文件并给出逐项计划；不写任何东西。 */
export function previewImport(payload: unknown, currentScope: string): ImportPreview {
  const errors: string[] = []
  const warnings: string[] = []
  const items: ImportItemPlan[] = []
  const emptyCounts: Record<ImportStatus, number> = { new: 0, conflict: 0, identical: 0, 'cross-scope': 0, rejected: 0 }

  const root = asRecord(payload)
  if (!root) {
    return { ok: false, errors: ['导出文件不是 JSON 对象'], warnings, source: null, items, counts: emptyCounts }
  }
  if (root.schema !== EXPORT_SCHEMA) {
    return { ok: false, errors: [`不是 CodeWeave 学习数据导出文件（schema=${String(root.schema)}）`], warnings, source: null, items, counts: emptyCounts }
  }
  const version = Number(root.version)
  if (!Number.isInteger(version)) {
    return { ok: false, errors: ['缺少导出版本号'], warnings, source: null, items, counts: emptyCounts }
  }
  if (version > EXPORT_VERSION) {
    return { ok: false, errors: [`导出来自更新的版本（${version} > ${EXPORT_VERSION}），本应用无法安全解读，拒绝导入`], warnings, source: null, items, counts: emptyCounts }
  }
  if (version < EXPORT_VERSION) {
    return { ok: false, errors: [`导出版本 ${version} 早于当前 ${EXPORT_VERSION}，尚无迁移路径；请先用原版本应用升级到 ${EXPORT_VERSION} 再导出`], warnings, source: null, items, counts: emptyCounts }
  }
  const data = asRecord(root.data)
  if (!data) {
    return { ok: false, errors: ['导出文件缺少 data 对象'], warnings, source: null, items, counts: emptyCounts }
  }
  const scope = typeof root.scope === 'string' ? root.scope : ''
  if (!scope) {
    return { ok: false, errors: ['导出文件缺少账户范围'], warnings: [], source: null, items, counts: emptyCounts }
  }
  if (scope !== currentScope) {
    warnings.push(`这份数据属于账户「${scope}」，当前登录的是「${currentScope}」；跨账户条目默认跳过，需逐项确认`)
  }

  for (const [key, value] of Object.entries(data)) {
    const descriptor = key.startsWith(STORAGE_PREFIX) ? descriptorOf(key) : undefined
    // 「大小」要的是字节数，不是字符串长度：JSON.stringify(...).length 数的是 UTF-16 码元，
    // 一份含中文的导出件会被低报两成（实测界面 327 B 对真实 417 B，差 21.6%）。
    // 落盘与恢复比较都按 UTF-8 字节走，这里也用 TextEncoder 取同一口径。
    const bytes = (() => {
      try {
        return new TextEncoder().encode(JSON.stringify(value ?? null)).length
      } catch {
        return 0
      }
    })()
    const push = (status: ImportStatus, reason?: string): void => {
      items.push({
        key,
        base: descriptor ? baseOf(key) : '',
        label: descriptor ? labelOf(key) : key,
        category: descriptor?.scope ?? 'unknown',
        status,
        bytes,
        decision: status === 'new' ? 'import' : 'skip',
        ...(reason ? { reason } : {}),
      })
    }

    if (!descriptor) {
      push('rejected', '未注册的键名，拒绝写入（导入文件不得指定任意 localStorage 键）')
      continue
    }
    if (descriptor.exportPolicy === 'never') {
      push('rejected', '该类别被标记为永不导入')
      continue
    }
    if (scopeOf(key) !== scope) {
      push('rejected', '键的账户后缀与导出声明的范围不一致')
      continue
    }
    if (value === undefined) {
      push('rejected', '条目为空')
      continue
    }
    // 跨账户判定必须先于目标槽位状态：文件声明的账户与当前登录不一致时，这些键是「别人的槽位」，
    // 无论对面是空位、相同还是不同内容，都不算本账户的可恢复项（空槽位也不写，见 applyImport 硬约束）。
    if (scope !== currentScope) {
      push('cross-scope', '目标账户与当前登录账户不同')
      continue
    }
    const existing = localStorage.getItem(key)
    if (existing === null) {
      push('new')
      continue
    }
    if (existing === JSON.stringify(value)) {
      push('identical', '与目标现有内容相同，重复导入无意义')
      continue
    }
    push('conflict', '目标已有不同内容，默认保留现有记录')
  }

  const counts = items.reduce(
    (acc, item) => {
      acc[item.status] += 1
      return acc
    },
    { ...emptyCounts },
  )
  return {
    ok: true,
    errors,
    warnings,
    source: { scope, exportedAt: String(root.exportedAt ?? ''), version },
    items,
    counts,
  }
}

/**
 * 应用导入决策。只写被显式标为 'import' 且状态允许的键。
 * localStorage 不具备事务：中途失败时尝试把已写入的键恢复原值，
 * 恢复不成功就如实列进 unresolved，不宣称成功。
 */
export function applyImport(payload: unknown, currentScope: string, decisions: Record<string, ImportDecision> = {}): ImportResult {
  const preview = previewImport(payload, currentScope)
  const result: ImportResult = { applied: [], skipped: [], failed: [], rolledBack: false, unresolved: [] }
  if (!preview.ok) {
    result.failed = preview.items.map((item) => item.key)
    return result
  }
  const data = asRecord(asRecord(payload)?.data) ?? {}
  const originals = new Map<string, string | null>()

  for (const item of preview.items) {
    if (item.status === 'rejected' || item.status === 'identical') {
      result.skipped.push(item.key)
      continue
    }
    // 跨账户的导出件不是「目标键」，即使界面被强制勾选也不写：
    // 换浏览器/换 origin 恢复用的是同一个账户 ID 的文件，写别人的槽位不是导入而是伪造。
    if (item.status === 'cross-scope') {
      result.skipped.push(item.key)
      continue
    }
    // 未显式选择时沿用预览给出的默认决策：空位可直接恢复，冲突与跨账户默认不写。
    if ((decisions[item.key] ?? item.decision) !== 'import') {
      result.skipped.push(item.key)
      continue
    }
    originals.set(item.key, localStorage.getItem(item.key))
    try {
      localStorage.setItem(item.key, JSON.stringify(data[item.key]))
      result.applied.push(item.key)
    } catch (error) {
      result.failed.push(item.key)
      console.warn(`[code-canvas] 导入 ${item.key} 失败：`, error)
    }
  }

  if (result.failed.length > 0 && result.applied.length > 0) {
    const restored: string[] = []
    for (const key of result.applied) {
      const before = originals.get(key) ?? null
      try {
        if (before === null) localStorage.removeItem(key)
        else localStorage.setItem(key, before)
        restored.push(key)
      } catch (error) {
        result.unresolved.push({ key, reason: `回滚失败：${error instanceof Error ? error.message : String(error)}` })
      }
    }
    result.rolledBack = restored.length === result.applied.length
    if (result.rolledBack) {
      result.skipped.push(...result.applied)
      result.applied = []
    }
  }
  return result
}
