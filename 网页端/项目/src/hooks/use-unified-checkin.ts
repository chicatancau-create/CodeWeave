import { useCallback, useEffect, useState } from 'react'
import { scopedKey, STORAGE_KEYS } from '../utils/constants'
import { useLocalStorage } from './use-local-storage'

export type CheckinScope = {
  serviceInstance: string
  vaultId: string
  accountId: string
}

type CheckinChange = {
  schemaVersion: 1
  changeId: string
  deviceId: string
  kind: 'learning.checkin.recorded'
  occurredAt: string
  localDate: string
  timeZone: string
  payload: Record<string, never>
}

type State = {
  deviceId?: string
  cursor?: string
  dates: string[]
  pending: CheckinChange[]
}

type SyncResult = { status: 'accepted' | 'conflict' }
type PullPage = {
  events: { change: { kind: string; localDate?: string } }[]
  cursor: string
  hasMore: boolean
}
const empty: State = { dates: [], pending: [] }
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

async function syncRequest<T>(path: string, signal: AbortSignal, change?: CheckinChange): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    ...(change && {
      method: 'POST',
      body: JSON.stringify(change),
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': change.changeId },
    }),
  })
  const reply = await response.json() as { data?: T; code?: string }
  if (!response.ok || !reply.data) throw new Error(reply.code ?? 'sync_unavailable')
  return reply.data
}

export function useUnifiedCheckin(accountId: string | undefined, scope: CheckinScope | null) {
  const domain = scope ? [scope.serviceInstance, scope.vaultId, scope.accountId].map(encodeURIComponent).join('/') : null
  const [domains, setDomains] = useLocalStorage<Record<string, State>>(scopedKey(STORAGE_KEYS.UNIFIED_CHECKIN, accountId), {})
  const state = (domain && domains[domain]) || empty
  const save = useCallback((transform: (state: State) => State) => {
    if (!domain) return
    setDomains((previous) => {
      const current = previous[domain] ?? empty
      const next = transform(current)
      return current === next ? previous : { ...previous, [domain]: next }
    })
  }, [domain, setDomains])
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!domain) return
    const wake = () => setRefresh((value) => value + 1)
    const timer = window.setInterval(wake, 25000)
    window.addEventListener('online', wake)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', wake)
    }
  }, [domain])

  const { pending, cursor } = state
  useEffect(() => {
    if (!domain) return
    const controller = new AbortController()
    const { signal } = controller
    const changes = new Set<string>()
    let conflict = false

    async function sync() {
      try {
        for (const change of pending) {
          const result = await syncRequest<SyncResult>('/api/sync/push', signal, change)
          if (result.status === 'accepted') changes.add(change.changeId)
          else conflict = true
        }
        let next = cursor
        let dates: string[] = []
        let reset = false
        do {
          let page: PullPage
          try {
            page = await syncRequest<PullPage>(next ? '/api/sync/pull?cursor=' + encodeURIComponent(next) : '/api/sync/pull', signal)
          } catch (failure) {
            if (failure instanceof Error && failure.message === 'sync_cursor_expired' && next && !reset) {
              next = undefined
              dates = []
              reset = true
              continue
            }
            throw failure
          }
          for (const { change } of page.events) {
            if (change.kind === 'learning.checkin.recorded' && change.localDate && DATE_KEY.test(change.localDate)) {
              dates.push(change.localDate)
            }
          }
          next = page.cursor
          if (!page.hasMore) break
        } while (!signal.aborted)
        if (signal.aborted) return
        save((previous) => {
          const merged = [...new Set([...(reset ? [] : previous.dates), ...dates])].sort()
          const outstanding = changes.size ? previous.pending.filter((entry) => !changes.has(entry.changeId)) : previous.pending
          if (outstanding === previous.pending && next === previous.cursor && merged.join() === previous.dates.join()) return previous
          return { ...previous, cursor: next, dates: merged, pending: outstanding }
        })
        setError(conflict ? '部分打卡仍待处理' : null)
      } catch {
        if (!signal.aborted) setError('打卡同步暂不可用，待同步记录已保留')
      }
    }

    void sync()
    return () => controller.abort()
  }, [domain, pending, cursor, refresh, save])

  const record = useCallback((localDate: string, now: Date) => {
    if (!domain) return
    save((previous) => {
      if (previous.dates.includes(localDate) || previous.pending.some((entry) => entry.localDate === localDate)) return previous
      const deviceId = previous.deviceId ?? crypto.randomUUID()
      const change: CheckinChange = {
        schemaVersion: 1,
        changeId: crypto.randomUUID(),
        deviceId,
        kind: 'learning.checkin.recorded',
        localDate,
        occurredAt: now.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        payload: {},
      }
      return { ...previous, deviceId, pending: [...previous.pending, change] }
    })
  }, [domain, save])

  return {
    active: Boolean(domain),
    dates: [...new Set([...state.dates, ...state.pending.map((change) => change.localDate)])],
    pendingCount: state.pending.length,
    error,
    record,
  }
}
