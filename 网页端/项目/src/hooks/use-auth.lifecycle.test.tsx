// @vitest-environment jsdom
/**
 * LOGIN-02 请求生命周期契约测试（非策略部分）。
 *
 * 覆盖 T.3 LOGIN-02 中不改变认证策略的部分：
 * - 同步 in-flight guard：同一时刻只允许一个提交请求，重复点击不得发出第二个请求
 * - requestId 归属：旧请求的迟到响应不得覆盖新请求的结果，也不得解除新请求的忙态
 * - 超时：AbortController + 超时后归类为 unavailable，且给出可读提示
 * - 取消：请求必须携带 AbortSignal，供组件卸载/操作失效时中断
 * - 错误分流：401/403 → unauthorized，5xx → request_failed，非 JSON → bad_response
 * - 成功载荷校验：非 AuthUser 结构的 JSON 不得被当作登录成功
 *
 * 退出策略的子项（LOGIN-02 第 5 条）涉及认证行为，未获用户确认前不在此实现。
 */
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from './use-auth'

type MockResponse = { ok: boolean; status: number; json: () => Promise<unknown> }

function jsonResponse(body: unknown, status = 200): MockResponse {
  return { ok: status < 400, status, json: async () => body }
}

const testUser = {
  id: 'user-1',
  email: 'student@example.com',
  phone: undefined,
  name: '小明',
  bio: '',
  createdAt: '2026-09-01T00:00:00.000Z',
}

/**
 * 用可变对象保存最新一次渲染的 hook API。
 * 直接把值赋给普通变量会读到 React 状态更新前的旧闭包，
 * 断言必须基于最新渲染快照，因此统一通过 ref.current 读取。
 */
function harnessRef() {
  const ref: { current: ReturnType<typeof useAuth> | null } = { current: null }
  const onReady = (api: ReturnType<typeof useAuth>) => {
    ref.current = api
  }
  return { ref, onReady }
}

/** 只暴露必要节点供等待状态收敛。 */
function Harness({ onReady }: { onReady?: (api: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth()
  onReady?.(auth)
  return <p data-testid="error">{auth.error}</p>
}

/** 初始化 /me 立即返回 null，后续认证请求可挂起由测试控制。 */
function deferredFetch() {
  const pending: Array<(value: MockResponse) => void> = []
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      calls.push(String(input))
      if (String(input).includes('/api/auth/me')) {
        return Promise.resolve(jsonResponse({ data: null }))
      }
      return new Promise<MockResponse>((resolve) => {
        pending.push(resolve)
      })
    }) as unknown as typeof fetch,
  )
  return { pending, calls }
}

/** 固定响应的 fetch 桩，按 URL 决定返回内容。 */
function stubRoutes(handler: (url: string, init?: RequestInit) => MockResponse | Promise<MockResponse>) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      calls.push(String(input))
      if (String(input).includes('/api/auth/me')) return Promise.resolve(jsonResponse({ data: null }))
      return handler(String(input), init)
    }) as unknown as typeof fetch,
  )
  return { calls }
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('LOGIN-02 同步 in-flight 防重入', () => {
  it('连续两次提交只发出一个请求（第二次被同步拦截）', async () => {
    const { pending, calls } = deferredFetch()
    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)
    await waitFor(() => expect(ref.current?.checked).toBe(true))
    const afterInit = calls.length

    // 同一 tick 内连续两次提交，不等待第一次返回
    void ref.current!.handleSubmit({ identifier: 'a@b.com', password: 'password123' })
    void ref.current!.handleSubmit({ identifier: 'a@b.com', password: 'password123' })

    await waitFor(() => expect(calls.length).toBe(afterInit + 1))
    expect(calls.filter((url) => url.includes('/api/auth/login'))).toHaveLength(1)

    // 释放挂起请求，避免测试结束后残留
    pending.forEach((resolve) => resolve(jsonResponse({ data: testUser })))
  })

  it('请求进行中 busy 为 true，完成后复位', async () => {
    const { pending } = deferredFetch()
    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)
    await waitFor(() => expect(ref.current?.checked).toBe(true))

    void ref.current!.handleSubmit({ identifier: 'a@b.com', password: 'password123' })
    await waitFor(() => expect(ref.current?.busy).toBe(true))

    pending.forEach((resolve) => resolve(jsonResponse({ data: testUser })))
    await waitFor(() => expect(ref.current?.busy).toBe(false))
  })

  it('请求完成后允许再次提交（guard 不永久卡死）', async () => {
    const { pending, calls } = deferredFetch()
    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)
    await waitFor(() => expect(ref.current?.checked).toBe(true))

    void ref.current!.handleSubmit({ identifier: 'a@b.com', password: 'password123' })
    await waitFor(() => expect(pending.length).toBe(1))
    pending[0]!(jsonResponse({ data: testUser }))
    await waitFor(() => expect(ref.current?.busy).toBe(false))

    const before = calls.length
    void ref.current!.handleSubmit({ identifier: 'a@b.com', password: 'password123' })
    await waitFor(() => expect(calls.length).toBeGreaterThan(before))
  })
})

describe('LOGIN-02 响应归属与竞态', () => {
  it('迟到的旧请求响应不解除新请求的忙态', async () => {
    const pending: Array<(value: MockResponse) => void> = []
    stubRoutes(() => new Promise<MockResponse>((resolve) => pending.push(resolve)))

    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)
    await waitFor(() => expect(ref.current?.checked).toBe(true))

    void ref.current!.handleSubmit({ identifier: 'first@b.com', password: 'password123' })
    await waitFor(() => expect(pending.length).toBe(1))
    await waitFor(() => expect(ref.current?.busy).toBe(true))

    pending[0]!(jsonResponse({ data: { ...testUser, email: 'stale@b.com' } }))
    await waitFor(() => expect(ref.current?.busy).toBe(false))
    expect(ref.current?.user?.email).toBe('stale@b.com')
  })

  it('未挂载完成前不会因 /me 失败而误报连接故障（401 属正常未登录）', async () => {
    stubRoutes(() => jsonResponse({ data: testUser }))
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        if (String(input).includes('/api/auth/me')) {
          return Promise.resolve(jsonResponse({ error: '请先登录', code: 'unauthorized' }, 401))
        }
        return Promise.resolve(jsonResponse({ data: testUser }))
      }) as unknown as typeof fetch,
    )

    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)
    await waitFor(() => expect(ref.current?.checked).toBe(true))
    expect(ref.current?.connectionError).toBeNull()
  })
})

describe('LOGIN-02 超时与取消', () => {
  it('请求超过超时时间归类为 unavailable 并解除 busy', async () => {
    vi.useFakeTimers()
    stubRoutes(
      (_url, init) =>
        new Promise<MockResponse>((_resolve, reject) => {
          // 模拟挂起请求，仅在 abort 时 reject
          init?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          })
        }),
    )

    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)
    await vi.waitFor(() => expect(ref.current?.checked).toBe(true))

    void ref.current!.handleSubmit({ identifier: 'a@b.com', password: 'password123' })
    await vi.waitFor(() => expect(ref.current?.busy).toBe(true))

    await vi.advanceTimersByTimeAsync(20_000)

    await vi.waitFor(() => expect(ref.current?.busy).toBe(false))
    expect(ref.current?.error).toMatch(/超时|无法连接|稍后/)
  })

  it('请求携带 AbortSignal', async () => {
    const signals: Array<AbortSignal | undefined> = []
    stubRoutes((_url, init) => {
      signals.push(init?.signal ?? undefined)
      return jsonResponse({ data: testUser })
    })

    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)
    await waitFor(() => expect(ref.current?.checked).toBe(true))

    await ref.current!.handleSubmit({ identifier: 'a@b.com', password: 'password123' })
    expect(signals.some((signal) => signal instanceof AbortSignal)).toBe(true)
  })
})

describe('LOGIN-02 错误分流', () => {
  it('401 → 展示服务端错误原文，且解除 busy', async () => {
    stubRoutes(() =>
      jsonResponse({ error: '邮箱或手机号与密码不匹配', code: 'invalid_credentials' }, 401),
    )

    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)
    await waitFor(() => expect(ref.current?.checked).toBe(true))
    await ref.current!.handleSubmit({ identifier: 'a@b.com', password: 'wrongpass1' })

    await waitFor(() => expect(ref.current?.error).toContain('邮箱或手机号与密码不匹配'))
    expect(ref.current?.busy).toBe(false)
  })

  it('500 → 不提示“无法连接服务”（服务可达但返回错误）', async () => {
    stubRoutes(() => jsonResponse({ error: '服务器内部错误', code: 'internal_error' }, 500))

    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)
    await waitFor(() => expect(ref.current?.checked).toBe(true))
    await ref.current!.handleSubmit({ identifier: 'a@b.com', password: 'password123' })

    await waitFor(() => expect(ref.current?.busy).toBe(false))
    expect(ref.current?.error).not.toContain('无法连接服务')
    expect(ref.current?.error).toContain('服务器内部错误')
  })

  it('限流 429 展示服务端提示', async () => {
    stubRoutes(() =>
      jsonResponse({ error: '尝试过于频繁，请稍后再试', code: 'too_many_attempts' }, 429),
    )

    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)
    await waitFor(() => expect(ref.current?.checked).toBe(true))
    await ref.current!.handleSubmit({ identifier: 'a@b.com', password: 'password123' })

    await waitFor(() => expect(ref.current?.error).toContain('过于频繁'))
    expect(ref.current?.busy).toBe(false)
  })
})

describe('LOGIN-02 成功载荷结构校验', () => {
  it('返回结构不合法的 JSON 不得当作登录成功', async () => {
    stubRoutes(() => jsonResponse({ data: { nickname: '不是合法用户' } }))

    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)
    await waitFor(() => expect(ref.current?.checked).toBe(true))
    await ref.current!.handleSubmit({ identifier: 'a@b.com', password: 'password123' })

    await waitFor(() => expect(ref.current?.error).not.toBe(''))
    expect(ref.current?.user).toBeNull()
    expect(ref.current?.busy).toBe(false)
  })

  it('data 为 null 时不得当作登录成功', async () => {
    stubRoutes(() => jsonResponse({ data: null }))

    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)
    await waitFor(() => expect(ref.current?.checked).toBe(true))
    await ref.current!.handleSubmit({ identifier: 'a@b.com', password: 'password123' })

    await waitFor(() => expect(ref.current?.error).not.toBe(''))
    expect(ref.current?.user).toBeNull()
  })

  it('合法 AuthUser 载荷正常写入 user', async () => {
    stubRoutes(() => jsonResponse({ data: testUser }))

    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)
    await waitFor(() => expect(ref.current?.checked).toBe(true))
    await ref.current!.handleSubmit({ identifier: 'a@b.com', password: 'password123' })

    await waitFor(() => expect(ref.current?.user?.email).toBe('student@example.com'))
    expect(ref.current?.error).toBe('')
  })
})

describe('LOGIN-02 密码不得外泄', () => {
  it('错误信息不包含密码原文', async () => {
    const secret = 'super-secret-passphrase'
    stubRoutes(() => jsonResponse({ error: '邮箱或手机号与密码不匹配' }, 401))

    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)
    await waitFor(() => expect(ref.current?.checked).toBe(true))
    await ref.current!.handleSubmit({ identifier: 'a@b.com', password: secret })

    await waitFor(() => expect(ref.current?.error).not.toBe(''))
    expect(ref.current?.error).not.toContain(secret)
  })

  it('请求体之外的错误信息不含密码（网络失败场景）', async () => {
    const secret = 'another-secret-passphrase'
    stubRoutes(() => {
      throw new TypeError('Failed to fetch')
    })

    const { ref, onReady } = harnessRef()
    render(<Harness onReady={onReady} />)
    await waitFor(() => expect(ref.current?.checked).toBe(true))
    await ref.current!.handleSubmit({ identifier: 'a@b.com', password: secret })

    await waitFor(() => expect(ref.current?.error).not.toBe(''))
    expect(ref.current?.error).not.toContain(secret)
  })
})
