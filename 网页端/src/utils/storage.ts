/**
 * 本地学习数据的版本化读写层（B4）。
 *
 * 存储信封：{ schemaVersion: number, data: T }
 * - 读取时容忍三种形态：当前版本信封 / 旧版本信封 / 更早期的裸数据（无版本号）。
 *   三者都会交给调用方的 validate 规范化；非法数据返回 undefined（调用方使用默认值）。
 * - 写入时统一加当前版本信封，旧数据在第一次写入后自动升级。
 * - 禁止在本层保存密码、Token 或个人隐私字段（各 hook 只写入学习数据）。
 */

export const SCHEMA_VERSION = 3

type Envelope = { schemaVersion: number; data: unknown }

export function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    typeof (value as Envelope).schemaVersion === 'number' &&
    'data' in value
  )
}

/** 兼容读取：信封 / 裸数据统一解开，交给 validate 规范化。 */
export function unwrapEnvelope(value: unknown): unknown {
  return isEnvelope(value) ? value.data : value
}

export function readLocalData<T>(key: string, validate: (value: unknown) => T | undefined): T | undefined {
  let raw: string | null
  try {
    raw = localStorage.getItem(key)
  } catch (error) {
    console.warn(`[code-canvas] 本地存储不可读（${key}），使用默认值。`, error)
    return undefined
  }
  if (raw === null) return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    const result = validate(unwrapEnvelope(parsed))
    if (result === undefined) {
      console.warn(`[code-canvas] 本地数据 ${key} 格式无法识别（可能来自旧版本或损坏数据），已回退默认值。`)
    }
    return result
  } catch (error) {
    console.warn(`[code-canvas] 本地数据 ${key} 解析失败（可能是旧版本或损坏数据），已回退默认值。`, error)
    return undefined
  }
}

export function writeLocalData<T>(key: string, data: T): boolean {
  try {
    // savedAt 供“数据与隐私中心”展示最后保存时间（读取侧忽略该字段）。
    localStorage.setItem(key, JSON.stringify({ schemaVersion: SCHEMA_VERSION, savedAt: new Date().toISOString(), data }))
    return true
  } catch (error) {
    console.warn(`[code-canvas] 本地数据 ${key} 写入失败。`, error)
    return false
  }
}

/** 一条键的「最后保存时间」读数状态—— DATA-01 第 2 条：不能把「旧数据没时间」报成「从未保存」。 */
export type SavedAtReading =
  | { state: 'absent' }
  | { state: 'saved'; iso: string }
  | { state: 'no-timestamp' }
  | { state: 'unreadable' }

/**
 * 区分四种情况：键不存在 / 信封里确实有 savedAt / 数据在但没有 savedAt（裸数据或更早的信封）/
 * 数据在但读不出来（JSON 损坏或存储不可读）。后两种在界面上必须说不同的话，
 * 拿「从未保存」盖掉它们等于编造一个不存在的事实。
 */
export function readSavedAtState(key: string): SavedAtReading {
  let raw: string | null
  try {
    raw = localStorage.getItem(key)
  } catch {
    return { state: 'unreadable' }
  }
  if (raw === null || raw === '') return { state: 'absent' }
  try {
    const parsed = JSON.parse(raw) as unknown
    const savedAt = savedAtOf(parsed)
    return savedAt ? { state: 'saved', iso: savedAt } : { state: 'no-timestamp' }
  } catch {
    return { state: 'unreadable' }
  }
}

function savedAtOf(parsed: unknown): string | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const value = (parsed as { savedAt?: unknown }).savedAt
  return typeof value === 'string' ? value : undefined
}

/** 读取信封的 savedAt（无信封或无记录返回 null）——数据与隐私中心展示用。 */
export function readSavedAt(key: string): string | null {
  const reading = readSavedAtState(key)
  return reading.state === 'saved' ? reading.iso : null
}
