import { useCallback, useEffect, useState } from 'react'
import { unwrapEnvelope, writeLocalData } from '../utils/storage'

type Options<T> = {
  /** 读取后的校验/规范化；返回 undefined 表示数据非法，使用初始值并记录可读警告。 */
  validate?: (value: unknown) => T | undefined
}

/**
 * 读取并规范化一条本地数据。
 * 显式接收 key / 初始值 / 校验函数，避免闭包捕获首次渲染的陈旧 initialValue 或 options；
 * 也不在渲染期读 ref（并发渲染下不安全）。
 */
function readValidated<T>(key: string, initialValue: T, validate?: (value: unknown) => T | undefined): T {
  try {
    const item = localStorage.getItem(key)
    if (!item) return initialValue
    // 兼容三种形态：当前版本信封 / 旧版本信封 / 更早期的裸数据
    const parsed = unwrapEnvelope(JSON.parse(item) as unknown)
    const validated = validate ? validate(parsed) : (parsed as T)
    if (validated === undefined) {
      console.warn(`[code-canvas] 本地数据 ${key} 格式无法识别，已使用默认值。`)
      return initialValue
    }
    return validated
  } catch (error) {
    console.warn(`[code-canvas] 本地数据 ${key} 解析失败，已使用默认值。`, error)
    return initialValue
  }
}

export function useLocalStorage<T>(key: string, initialValue: T, options?: Options<T>): [T, (value: T | ((prev: T) => T)) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => readValidated(key, initialValue, options?.validate))
  const [prevKey, setPrevKey] = useState(key)

  // 键（账户作用域）变化时在渲染期重置为对应作用域的数据（React 官方推荐模式）。
  // initialValue / validate 取本次渲染的最新值，因此不会残留上一作用域的默认值。
  if (prevKey !== key) {
    setPrevKey(key)
    setStoredValue(readValidated(key, initialValue, options?.validate))
  }

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStoredValue((current) => {
        const valueToStore = value instanceof Function ? value(current) : value
        // 写入统一带 schemaVersion 信封；读取侧兼容旧裸数据，首次写回即完成升级。
        writeLocalData(key, valueToStore)
        return valueToStore
      })
    },
    [key],
  )

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === key && event.newValue) {
        try {
          setStoredValue(unwrapEnvelope(JSON.parse(event.newValue) as unknown) as T)
        } catch {
          // Ignore parse errors
        }
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [key])

  return [storedValue, setValue]
}
