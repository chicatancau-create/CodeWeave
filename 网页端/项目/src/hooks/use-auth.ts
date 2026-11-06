import { useCallback, useEffect, useRef, useState } from 'react'

export type AuthUser = {
  id: string
  email?: string
  phone?: string
  name: string
  bio: string
  createdAt: string
}

export type AuthMode = 'login' | 'register'

export type AuthCredentials = {
  name?: string
  email?: string
  phone?: string
  identifier?: string
  contactType?: 'email' | 'phone'
  password: string
}

/** 请求失败的类型化错误：调用方据此区分“未登录”“服务不可用”“响应异常”。 */
export type AuthErrorKind = 'unauthorized' | 'unavailable' | 'bad_response' | 'request_failed'

export class AuthError extends Error {
  readonly kind: AuthErrorKind
  readonly status?: number
  constructor(message: string, kind: AuthErrorKind, status?: number) {
    super(message)
    this.name = 'AuthError'
    this.kind = kind
    this.status = status
  }
}

/** 认证与账户请求的统一超时（毫秒）。超时按 unavailable 归类，与“服务未启动”同属可操作提示。 */
const AUTH_TIMEOUT_MS = 15_000

/** 成功响应必须满足的最小 AuthUser 结构，防止任意 JSON 被 cast 后当作登录成功。 */
function isAuthUser(value: unknown): value is AuthUser {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string' && candidate.id !== '' && typeof candidate.name === 'string'
}

/**
 * 请求客户端。所有请求都带 AbortSignal 与超时，且不把密码等敏感字段写入任何日志或错误信息。
 * 调用方可通过 externalSignal 在组件卸载或操作失效时主动取消。
 */
async function authRequest(
  path: string,
  method: 'GET' | 'POST' | 'PATCH',
  body?: Record<string, string>,
  externalSignal?: AbortSignal,
) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS)
  const onExternalAbort = () => controller.abort()
  externalSignal?.addEventListener('abort', onExternalAbort)

  let response: Response
  try {
    response = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
      signal: controller.signal,
    })
  } catch (error) {
    // 调用方主动取消：向上抛出原始 AbortError，由调用方自行忽略。
    if (externalSignal?.aborted) throw error
    // 超时被 abort：归类为 unavailable 并给出可操作提示。
    if (controller.signal.aborted) {
      throw new AuthError('请求超时，服务可能未启动或响应过慢。请稍后重试。', 'unavailable')
    }
    // 网络层失败：服务未启动、连接被拒、断网。与“会话过期”必须区分，否则用户
    // 会误以为被登出而反复重新登录。
    throw new AuthError('无法连接服务，请确认已启动完整服务。', 'unavailable', undefined)
  } finally {
    clearTimeout(timeoutId)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }

  // 401 且有会话 Cookie 时是真正的“未登录”；其余 401 同样按未登录处理。
  let payload: { data?: AuthUser | null; error?: string; code?: string } | undefined
  try {
    payload = (await response.json()) as typeof payload
  } catch {
    // 反向代理错误页、空响应等非 JSON 情况：不要在这里二次抛错掩盖真实状态码。
    if (response.status === 401 || response.status === 403) {
      throw new AuthError('登录状态已失效，请重新登录。', 'unauthorized', response.status)
    }
    throw new AuthError(`服务返回了无法解析的响应（HTTP ${response.status}）。`, 'bad_response', response.status)
  }

  if (response.status === 401 || response.status === 403) {
    throw new AuthError(payload?.error ?? '登录状态已失效，请重新登录。', 'unauthorized', response.status)
  }
  if (!response.ok) {
    throw new AuthError(payload?.error ?? '请求失败，请稍后再试', 'request_failed', response.status)
  }
  return payload?.data ?? null
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [checked, setChecked] = useState(false)
  const [mode, setMode] = useState<AuthMode>('login')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  /** 登录状态检查阶段的故障：与服务重启/网络中断有关，界面据此给出可操作提示。 */
  const [connectionError, setConnectionError] = useState<AuthErrorKind | null>(null)
  /** 同步 in-flight 标志：只有它才能阻止同一 tick 内的重复提交（异步 setBusy 来不及）。 */
  const inFlightRef = useRef(false)
  /** 当前有效请求号：旧请求的迟到响应据此丢弃，且不得解除新请求的忙态。 */
  const requestIdRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    authRequest('/api/auth/me', 'GET')
      .then((result) => {
        if (cancelled) return
        setUser(result)
        setConnectionError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // 401 表示未登录（正常）；连接失败表示服务不可达（需要提示用户）。
        setUser(null)
        if (err instanceof AuthError && err.kind !== 'unauthorized') setConnectionError(err.kind)
      })
      .finally(() => {
        if (!cancelled) setChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = useCallback(
    async (credentials: AuthCredentials) => {
      // 同步防重入：必须在任何 await 之前完成判断与置位，否则同一 tick 的第二次调用会穿透。
      if (inFlightRef.current) return
      inFlightRef.current = true
      const requestId = ++requestIdRef.current

      setBusy(true)
      setError('')
      try {
        // 登录与注册返回的都是用户对象；成功载荷必须通过最小结构校验。
        const raw = await authRequest(`/api/auth/${mode}`, 'POST', credentials)
        if (requestId !== requestIdRef.current) return
        if (!isAuthUser(raw)) {
          throw new AuthError('服务返回的账户数据不完整，请稍后重试。', 'bad_response')
        }
        setUser(raw)
        setConnectionError(null)
      } catch (err) {
        if (requestId !== requestIdRef.current) return
        const message = err instanceof Error ? err.message : '请求失败，请稍后再试'
        const hint =
          err instanceof AuthError && err.kind === 'unavailable'
            ? '：请使用 CodeCanvas-OneClick.cmd 或 pnpm run start 启动完整服务。'
            : ''
        setError(message + hint)
      } finally {
        // busy 只由当前有效请求负责：旧请求结束时不得解除新请求的忙态。
        if (requestId === requestIdRef.current) {
          inFlightRef.current = false
          setBusy(false)
        }
      }
    },
    [mode],
  )

  /**
   * 登出：即使服务端请求失败也必须在本地清除登录态。
   * 否则用户会卡在“点登出没反应”的状态；服务端的会话过期本身有时限。
   */
  const handleLogout = useCallback(async () => {
    let failure = ''
    try {
      await authRequest('/api/auth/logout', 'POST')
    } catch (err) {
      failure = err instanceof Error ? err.message : '登出请求失败'
    } finally {
      setUser(null)
    }
    return failure
  }, [])

  const updateUser = useCallback(async (updates: Partial<Pick<AuthUser, 'name' | 'bio'>>) => {
    const result = await authRequest('/api/profile', 'PATCH', updates as Record<string, string>)
    if (result && !isAuthUser(result)) {
      throw new AuthError('服务返回的账户数据不完整，请稍后重试。', 'bad_response')
    }
    if (result) setUser(result)
    return result
  }, [])

  return {
    user,
    checked,
    mode,
    error,
    busy,
    connectionError,
    setMode,
    setError,
    handleSubmit,
    handleLogout,
    updateUser,
    setUser,
  }
}
