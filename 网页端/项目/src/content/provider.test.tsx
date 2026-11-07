// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ContentProvider, useContent } from './provider'

function Probe() {
  const content = useContent()
  return <p>{content.loading ? 'loading' : content.error ?? 'ready'}</p>
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('状态读取后并行发起绑定状态与目录，卸载取消所有请求', async () => {
  const calls: { path: string; signal: AbortSignal | null | undefined }[] = []
  const fetchMock = vi.fn((path: string, init?: RequestInit) => {
    calls.push({ path, signal: init?.signal })
    if (path === '/api/content/status') return Promise.resolve({ ok: true, json: async () => ({ data: { state: 'ready' } }) })
    return new Promise<Response>(() => {})
  })
  vi.stubGlobal('fetch', fetchMock)
  const { unmount } = render(<ContentProvider enabled><Probe /></ContentProvider>)
  await waitFor(() => expect(calls.map((call) => call.path)).toEqual([
    '/api/content/status', '/api/learning/status', '/api/content/catalog',
  ]))
  expect(screen.getByText('loading')).toBeTruthy()
  expect(calls.every((call) => call.signal instanceof AbortSignal && !call.signal.aborted)).toBe(true)
  unmount()
  expect(calls.every((call) => call.signal?.aborted)).toBe(true)
})

it('禁用加载会取消请求，旧请求迟到不得替换禁用后的状态', async () => {
  let finish: (response: unknown) => void = () => {}
  vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finish = resolve })))
  const { rerender } = render(<ContentProvider enabled><Probe /></ContentProvider>)
  rerender(<ContentProvider enabled={false}><Probe /></ContentProvider>)
  expect(screen.getByText('ready')).toBeTruthy()
  await act(async () => {
    finish({ ok: false, status: 503, json: async () => ({ error: 'late failure' }) })
  })
  expect(screen.queryByText('late failure')).toBeNull()
  expect(screen.getByText('ready')).toBeTruthy()
})

it('目录失败保留可读错误，绑定状态失败不阻止成功目录', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => ({
    ok: path === '/api/content/status', status: 503,
    json: async () => path === '/api/content/status' ? { data: { state: 'ready' } } : { error: '目录暂不可读' },
  })))
  render(<ContentProvider enabled><Probe /></ContentProvider>)
  expect(await screen.findByText('目录暂不可读')).toBeTruthy()
  cleanup()
  vi.stubGlobal('fetch', vi.fn(async (path: string) => ({
    ok: path !== '/api/learning/status', status: path === '/api/learning/status' ? 503 : 200,
    json: async () => ({ data: path === '/api/content/status' ? { state: 'ready' } : {
      lessons: [], stages: [], rules: { status: 'current' },
    } }),
  })))
  render(<ContentProvider enabled><Probe /></ContentProvider>)
  expect(await screen.findByText('ready')).toBeTruthy()
})
