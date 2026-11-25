// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useUnifiedCheckin } from './use-unified-checkin'
import { scopedKey, STORAGE_KEYS } from '../utils/constants'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

test('retains the original check-in while offline and clears its outbox on acceptance', async () => {
  const date = '2026-11-23'
  let online = false
  const attempts: string[] = []
  const fetchMock = vi.fn(async (path: string, options: RequestInit) => {
    if (options.method === 'POST') {
      const key = new Headers(options.headers).get('Idempotency-Key')
      if (!key) throw new Error('missing check-in key')
      attempts.push(key)
    }
    if (!online) throw new Error('offline')
    const data = options.method === 'POST' ? { status: 'accepted' } : {
      events: [{ change: { kind: 'learning.checkin.recorded', localDate: date } }],
      cursor: 'cursor-1',
      hasMore: false,
    }
    expect(path).toMatch(/^\/api\/sync\/(push|pull)/)
    return new Response(JSON.stringify({ data }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  const scope = { serviceInstance: 'service-a', vaultId: 'vault-a', accountId: 'account-a' }
  const { result, unmount } = renderHook(() => useUnifiedCheckin(scope.accountId, scope))
  await waitFor(() => expect(result.current.error).toContain('待同步记录已保留'))
  act(() => result.current.record(date, new Date('2026-11-23T03:00:00Z')))
  await waitFor(() => expect(attempts).toHaveLength(1))
  expect(result.current.pendingCount).toBe(1)
  expect(localStorage.getItem(scopedKey(STORAGE_KEYS.UNIFIED_CHECKIN, scope.accountId))).toContain(attempts[0])
  unmount()

  online = true
  const restarted = renderHook(() => useUnifiedCheckin(scope.accountId, scope))
  await waitFor(() => expect(restarted.result.current.pendingCount).toBe(0))
  expect(restarted.result.current.dates).toEqual([date])
  expect(restarted.result.current.error).toBeNull()
  expect(attempts).toEqual([attempts[0], attempts[0]])
  expect(localStorage.getItem(scopedKey(STORAGE_KEYS.CHECKIN, scope.accountId))).toBeNull()
})
