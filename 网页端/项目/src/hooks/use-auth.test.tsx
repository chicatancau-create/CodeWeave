// @vitest-environment jsdom
/**
 * R5-C 认证错误模型：区分「未登录」「服务不可用」「响应异常」，并保证登出必然清除本地登录态。
 * 这三条对应审计中“服务重启与网络中断表现相同、用户被静默登出与卡在登录页”的实际问题。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from './use-auth'

type MockResponse = { ok: boolean; status: number; json: () => Promise<unknown> }

function jsonResponse(body: unknown, status = 200): MockResponse {
  return { ok: status < 400, status, json: async () => body }
}

function stubFetch(handler: (input: string, init?: RequestInit) => MockResponse | Promise<MockResponse>) {
  vi.stubGlobal('fetch', vi.fn(handler as unknown as typeof fetch))
}

/** 把 hook 状态渲染成可断言的文本，避免为测试引入额外依赖。 */
function Probe({ onReady }: { onReady?: (api: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth()
  onReady?.(auth)
  if (!auth.checked) return <p>checking</p>
  return (
    <div>
      <p data-testid="user">{auth.user ? auth.user.email : 'none'}</p>
      <p data-testid="conn">{auth.connectionError ?? 'none'}</p>
      <p data-testid="error">{auth.error}</p>
      <button onClick={() => void auth.handleLogout()}>登出</button>
    </div>
  )
}

const testUser = {
  id: 'user-1',
  email: 'student@example.com',
  phone: undefined,
  name: '小明',
  bio: '',
  createdAt: '2026-09-01T00:00:00.000Z',
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('R5-C 登录状态检查的错误区分', () => {
  it('未登录（401）不标记为连接故障', async () => {
    stubFetch(() => jsonResponse({ error: '请先登录', code: 'unauthorized' }, 401))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('conn').textContent).toBe('none'))
    expect(screen.getByTestId('user').textContent).toBe('none')
  })

  it('网络失败标记为 unavailable，提示启动完整服务', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('conn').textContent).toBe('unavailable'))
  })

  it('服务返回非 JSON 响应标记为 bad_response，而不是崩溃', async () => {
    stubFetch(() => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON')
      },
    }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('conn').textContent).toBe('bad_response'))
  })

  it('成功登录后写入用户且清空连接故障', async () => {
    stubFetch(() => jsonResponse({ data: testUser }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('student@example.com'))
    expect(screen.getByTestId('conn').textContent).toBe('none')
  })
})

describe('R5-C 登出的本地兜底', () => {
  it('服务端登出失败也清除本地登录态（不卡在已登录界面）', async () => {
    let loggedIn = true
    stubFetch((input) => {
      if (String(input).includes('/api/auth/logout')) {
        // 模拟会话已过期：服务端返回 401
        loggedIn = false
        return jsonResponse({ error: '未登录', code: 'unauthorized' }, 401)
      }
      if (!loggedIn) return jsonResponse({ data: null })
      return jsonResponse({ data: testUser })
    })
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('student@example.com'))

    screen.getByRole('button', { name: '登出' }).click()
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('none'))
  })

  it('登出请求抛网络错误时不产生未捕获异常', async () => {
    let first = true
    stubFetch(() => {
      if (first) {
        first = false
        return jsonResponse({ data: testUser })
      }
      throw new TypeError('Failed to fetch')
    })
    const errors: unknown[] = []
    const onError = (event: ErrorEvent) => errors.push(event.error)
    window.addEventListener('error', onError)
    try {
      render(<Probe />)
      await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('student@example.com'))
      screen.getByRole('button', { name: '登出' }).click()
      await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('none'))
      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
    }
  })
})
