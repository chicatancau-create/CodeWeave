// @vitest-environment jsdom
/**
 * 挂账 #35 的界面半边：事务账本、逐步明细与回滚入口。
 *
 * 与另两个写回测试文件的分工：`evidence-writeback-view.test.tsx` 管业务流转，
 * `.m3.test.tsx` 管 §5.1/§5.2 的结构与状态标识，`.write.test.tsx` 管写路径上下文。
 * 本文件只测**新接上的读口**（GET evidence-transactions / evidence-transaction/:id）
 * 与**回滚出口**（POST evidence-rollback），并把 #35 的四条主张逐条钉住：
 * 1. 「部分成功」不再只活在 React 状态里：刷新后凭服务端账本仍能说出是哪一笔、还差哪一步；
 * 2. 补齐时的指纹必须是真的：重新载入后从**这笔事务自己的记录**里读回基线再提交，
 *    不通过传空对象关掉服务端校验（挂账⑤ 的同一条红线）；
 * 3. 回滚要显式确认，回来后一律以服务端读回的状态为准；`rollback_blocked` 逐条呈现，
 *    服务端没给结构化 blockers 时**不编**一份清单；
 * 4. 「读不到」永远不等于「没有」：账本的空态与失败态各有自己的标识与文字。
 *
 * 另有一条契约是给取证闸门的：06 区不得改动 01/03 两区的行类名与行数
 * （`tools/visual/visual-states.mjs` 的 `sectionWriteback` 数 `[aria-label="已同步记录"] .ewb-row--synced`）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContentProvider } from '../content/provider'
import { EvidenceWritebackPanel } from './evidence-writeback-view'

type Reply = { ok: boolean; status?: number; json: () => Promise<unknown> }

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

const LEARNING_STATUS_OWNER = {
  bound: true,
  isOwner: true,
  vaultId: 'ob-test',
  vaultMatches: true,
  publicContent: false,
  contentAccess: { allowed: true, reason: 'owner' },
  progressAccess: true,
  boundAt: '2026-09-19T00:00:00.000Z',
  recordCorrupt: false,
  notice: '资料库已绑定拥有者。',
}

const EMPTY_SNAPSHOT = {
  bundleId: 'b-test',
  schemaVersion: 1,
  buildTime: '2026-09-19T00:00:00.000Z',
  rules: { status: 'missing' },
  stages: [],
  milestones: [],
  masteryLevels: [],
  hintLevels: [],
  reviewOffsetsDays: [],
  lessons: [],
  counts: null,
}

const CONTENT_STATUS = {
  state: 'ready',
  vaultConfigured: true,
  vaultReason: null,
  bundleId: 'b-test',
  buildTime: '2026-09-19T00:00:00.000Z',
  publishedAt: '2026-09-19T00:00:00.000Z',
  counts: null,
  rulesStatus: 'missing',
  stale: false,
  lastError: null,
  lastReport: null,
}

const LOG_REL = '全栈工程师学习计划/学习日志/2026-09/2026-09-19-账本主题.md'
const PROGRESS_REL = '全栈工程师学习计划/进度追踪.md'
const INDEX_REL = '全栈工程师学习计划/全栈竞赛长期冲刺总计划.md'

const stagedRecord = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  evidenceId: 'ev-1',
  userId: 'u-1',
  state: 'pending',
  createdAt: '2026-09-19T00:00:00.000Z',
  operationId: null,
  syncedAt: null,
  logPath: null,
  at: '2026-09-19',
  topic: '账本主题',
  stage: 'S0',
  contentId: null,
  exerciseId: null,
  bundleId: null,
  expected: 'Hello',
  actual: 'Hello',
  ranBy: 'learner',
  independent: true,
  hintLevel: 'L1',
  artifacts: [],
  unfinished: [],
  notes: '',
  ...overrides,
})

/** 账本一行的桩：字段与 `toLedgerRow()` 输出一一对应。 */
const ledgerRow = (overrides: Record<string, unknown> = {}) => ({
  operationId: 'op-partial-aaaa11',
  state: 'partial',
  topic: '账本主题',
  at: '2026-09-19',
  createdAt: '2026-09-19T03:00:00.000Z',
  syncedAt: null,
  rolledBackAt: null,
  message: '日志已保存，进度待合并：写入失败（人工制造的取证条件）',
  evidenceCount: 2,
  targets: [
    { kind: 'log', path: LOG_REL, applied: true },
    { kind: 'progress', path: PROGRESS_REL, applied: false },
    { kind: 'index', path: INDEX_REL, applied: false },
  ],
  ...overrides,
})

/** 单笔试图（明细）的桩：与 `transactionStatus()` 输出一一对应。 */
const detailRecord = (overrides: Record<string, unknown> = {}) => ({
  operationId: 'op-partial-aaaa11',
  state: 'partial',
  at: '2026-09-19',
  topic: '账本主题',
  createdAt: '2026-09-19T03:00:00.000Z',
  syncedAt: null,
  rolledBackAt: null,
  logSaved: true,
  message: '日志已保存，进度待合并：写入失败（人工制造的取证条件）',
  evidenceCount: 2,
  targets: [
    {
      path: LOG_REL,
      kind: 'log',
      applied: true,
      appliedAt: '2026-09-19T03:00:04.000Z',
      skipped: false,
      backupPresent: false,
      createdNew: true,
      expectedHash: null,
    },
    {
      path: PROGRESS_REL,
      kind: 'progress',
      applied: true,
      appliedAt: '2026-09-19T03:00:05.000Z',
      skipped: true,
      backupPresent: true,
      createdNew: false,
      expectedHash: 'hash-progress',
    },
    {
      path: INDEX_REL,
      kind: 'index',
      applied: false,
      appliedAt: null,
      skipped: false,
      backupPresent: false,
      createdNew: false,
      expectedHash: 'hash-index',
    },
  ],
  ...overrides,
})

type Routes = {
  ledger?: Reply
  detail?: (operationId: string) => Reply
  rollback?: () => Reply
  commit?: () => Reply
  queue?: { pending: unknown[]; synced: unknown[] }
  status?: unknown
}

function renderPanel(routes: Routes = {}) {
  const calls: { path: string; method: string; body: unknown }[] = []
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ path: input, method, body: init?.body ? JSON.parse(String(init.body)) : null })
    if (input === '/api/content/status') return json({ data: CONTENT_STATUS })
    if (input === '/api/learning/status') return json({ data: routes.status ?? LEARNING_STATUS_OWNER })
    if (input === '/api/content/catalog') return json({ data: EMPTY_SNAPSHOT })
    if (input === '/api/learning/evidence' && method === 'GET') {
      return json({ data: routes.queue ?? { pending: [stagedRecord()], synced: [] } })
    }
    if (input === '/api/learning/evidence-transactions') return routes.ledger ?? json({ data: { transactions: [], total: 0, unreadable: 0, capped: 20 } })
    const detailMatch = /^\/api\/learning\/evidence-transaction\/(.+)$/.exec(input)
    if (detailMatch && method === 'GET') return (routes.detail ?? (() => json({ data: detailRecord() })))(detailMatch[1] ?? '')
    if (input === '/api/learning/evidence-rollback') return (routes.rollback ?? (() => json({ error: '未模拟', code: 'not_mocked' }, 404)))()
    if (input === '/api/learning/evidence-commit') {
      return (routes.commit ?? (() => json({ data: { synced: true, idempotent: false, operationId: 'op-partial-aaaa11', targets: [] } })))()
    }
    return json({ error: '未模拟的接口', code: 'not_mocked' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  const view = render(
    <ContentProvider enabled>
      <EvidenceWritebackPanel />
    </ContentProvider>,
  )
  return { view, calls }
}

/** 06 区标题：只有拥有者才请求事务端点，所以这也是「这一区渲染了没有」的探针。 */
const ledgerZone = () => document.querySelector('[aria-label="写回事务账本"]')
const text = (el: Element | null) => (el ? (el.textContent ?? '').replace(/\s+/g, ' ') : '')

/**
 * 等账本真的读回来。**不能拿 06 区标题当信号**：标题在加载态就在，
 * 拿它 await 会让下面的点击落在「还没有行」的 DOM 上（本文件第一版就是这么错的）。
 */
async function ledgerLoaded() {
  await waitFor(() => {
    const zone = ledgerZone()
    expect(zone, '06 区没渲染').toBeTruthy()
    const body = text(zone)
    const settled = /服务端共 \d+ 笔事务/.test(body) || !!zone?.querySelector('[aria-label="事务账本读取失败"]')
    expect(settled, '账本还停在加载态：' + body).toBe(true)
  })
  return ledgerZone() as Element
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('挂账 #35 · 事务账本渲染', () => {
  it('账本一行说清「哪一次、走到哪一步、几条证据」', async () => {
    const { calls } = renderPanel({
      ledger: json({
        data: {
          transactions: [ledgerRow(), ledgerRow({ operationId: 'op-synced-bbb22', state: 'synced', message: '日志、进度与索引均已写入并复核', syncedAt: '2026-09-18T02:00:00.000Z' })],
          total: 2,
          unreadable: 0,
          capped: 20,
        },
      }),
    })
    await ledgerLoaded()
    expect(calls.some((call) => call.path === '/api/learning/evidence-transactions')).toBe(true)
    const rows = ledgerZone()?.querySelectorAll('.ewb-tx-item')
    expect(rows?.length).toBe(2)
    expect(text(rows?.[0] ?? null)).toContain('部分成功')
    expect(text(rows?.[0] ?? null)).toContain('已落盘 1/3 步')
    expect(text(rows?.[0] ?? null)).toContain('2 条证据')
    expect(text(rows?.[1] ?? null)).toContain('已同步')
    expect(text(ledgerZone())).toContain('服务端共 2 笔事务，这里列出最近 2 笔')
  })

  it('状态认文字与图标，不靠颜色：partial 一步都没写时不说「部分成功」', async () => {
    renderPanel({
      ledger: json({
        data: { transactions: [ledgerRow({ state: 'partial', targets: ledgerRow().targets.map((step) => ({ ...step, applied: false })) })], total: 1, unreadable: 0, capped: 20 },
      }),
    })
    await ledgerLoaded()
    const row = document.querySelector('.ewb-tx-item')
    // 服务端把「检测到冲突、一步没写」也记成 partial：界面照实给「冲突」档，不说成写了一半。
    expect(text(row?.querySelector('.ewb-mark-text') ?? null)).toContain('冲突')
    expect(text(row)).not.toContain('部分成功')
  })

  it('被上限截断与读不出来的记录都要出声，不把这一列当全部历史', async () => {
    renderPanel({
      ledger: json({
        data: { transactions: Array.from({ length: 20 }, (_, i) => ledgerRow({ operationId: `op-batch${i}-aaaa11` })), total: 26, unreadable: 3, capped: 20 },
      }),
    })
    const zone = await ledgerLoaded()
    const body = text(zone.closest('[aria-label="写回事务账本"]'))
    expect(body).toContain('另有 6 笔更早的事务没有列在这里')
    expect(body).toContain('另有 3 条事务记录读不出来')
  })

  it('空态与「读不到」是两件事：读不到时不显示「还没有写回事务」', async () => {
    renderPanel({ ledger: json({ error: '写回事务记录读取失败', code: 'transactions_unreadable' }, 503) })
    await ledgerLoaded()
    const zone = ledgerZone()
    expect(zone?.querySelector('[aria-label="事务账本读取失败"]')).toBeTruthy()
    expect(text(zone)).toContain('读不到不等于一笔都没有')
    expect(text(zone)).not.toContain('还没有留下这笔账户的写回事务记录')
    expect(text(zone)).toContain('条数未定：这一次没读回来')
  })

  it('确实一笔都没有时才给空态文案', async () => {
    renderPanel({ ledger: json({ data: { transactions: [], total: 0, unreadable: 0, capped: 20 } }) })
    await ledgerLoaded()
    expect(text(ledgerZone())).toContain('还没有留下这笔账户的写回事务记录')
    expect(ledgerZone()?.querySelector('[aria-label="事务账本读取失败"]')).toBeNull()
  })

  it('06 区不动 01/03 两区的行类名与行数（取证闸门数的是 .ewb-row--synced）', async () => {
    renderPanel({
      queue: { pending: [stagedRecord()], synced: [stagedRecord({ evidenceId: 'ev-9', state: 'synced' })] },
      ledger: json({ data: { transactions: [ledgerRow(), ledgerRow({ operationId: 'op-two-aaaa11' }), ledgerRow({ operationId: 'op-three-aaaa11' })], total: 3, unreadable: 0, capped: 20 } }),
    })
    await ledgerLoaded()
    const syncedZone = document.querySelector('[aria-label="已同步记录"]')
    expect(syncedZone?.querySelectorAll('.ewb-row--synced').length).toBe(1)
    expect(ledgerZone()?.querySelectorAll('.ewb-row--synced').length).toBe(0)
    expect(ledgerZone()?.querySelectorAll('.ewb-tx-item').length).toBe(3)
  })
})

describe('挂账 #35 · 逐步明细与刷新后的横幅', () => {
  it('展开一笔 → 读回明细，三种「实际做了什么」与三种回滚处置各说各的', async () => {
    const { calls } = renderPanel({
      ledger: json({ data: { transactions: [ledgerRow()], total: 1, unreadable: 0, capped: 20 } }),
    })
    await ledgerLoaded()
    fireEvent.click(screen.getByRole('button', { name: /查看这一笔做了什么/ }))
    await screen.findByLabelText('写回事务 op-partial-aaaa11 的逐步明细')
    expect(calls.some((call) => call.path === '/api/learning/evidence-transaction/op-partial-aaaa11')).toBe(true)

    const body = text(document.querySelector('[aria-label="写回事务 op-partial-aaaa11 的逐步明细"]'))
    expect(body).toContain('部分写入，还在等补齐')
    expect(body).toContain('已写入')
    expect(body).toContain('无需改动（内容已一致，没有重复写）')
    expect(body).toContain('未写入（这一步没有落盘）')
    expect(body).toContain('本次新建的文件，回滚会把它移出资料库')
    expect(body).toContain('用写入前的备份覆盖回来')
    expect(body).toContain('不涉及：没写过，没有要还原的东西')
    expect(body).toContain('—（没落盘就没有时间）')
    // 明细表本身就是台账：三步按写入顺序排，且带列标题（不是把文字堆成一坨）。
    const table = document.querySelector('.ewb-table--steps')
    expect(Array.from(table?.querySelectorAll('thead th') ?? []).map((th) => th.textContent)).toEqual([
      '写入顺序',
      '步骤',
      '文件（库内相对路径）',
      '实际做了什么',
      '落盘时间',
      '回滚怎么处置这一步',
    ])
    expect(Array.from(table?.querySelectorAll('tbody tr td:first-child') ?? []).map((td) => td.textContent)).toEqual(['01', '02', '03'])
  })

  it('明细读不回时只坏这一块，不假装「没有步骤」', async () => {
    renderPanel({
      ledger: json({ data: { transactions: [ledgerRow()], total: 1, unreadable: 0, capped: 20 } }),
      detail: () => json({ error: '写回事务记录损坏', code: 'transaction_corrupt' }, 409),
    })
    await ledgerLoaded()
    fireEvent.click(screen.getByRole('button', { name: /查看这一笔做了什么/ }))
    const zone = await screen.findByText(/读不回这一笔的明细/)
    expect(zone.textContent).toContain('transaction_corrupt')
    expect(document.querySelector('.ewb-table--steps')).toBeNull()
  })

  it('刷新后横幅仍在：partial 由服务端账本兜着，并写明它读自事务记录', async () => {
    renderPanel({
      queue: { pending: [], synced: [stagedRecord({ evidenceId: 'ev-9', state: 'synced' })] },
      ledger: json({ data: { transactions: [ledgerRow()], total: 1, unreadable: 0, capped: 20 } }),
    })
    const zone = await screen.findByLabelText('部分成功的事务')
    expect(text(zone)).toContain('op-partial-aaaa11')
    expect(text(zone)).toContain('这条横幅读自服务端的事务记录')
    expect(text(zone)).toContain('点「重试补齐」时从服务端这笔事务的记录里读回')
  })

  it('重试补齐带的是从这笔事务记录读回的真实指纹，不是空对象', async () => {
    const { calls } = renderPanel({
      queue: { pending: [], synced: [stagedRecord({ evidenceId: 'ev-9', state: 'synced' })] },
      ledger: json({ data: { transactions: [ledgerRow()], total: 1, unreadable: 0, capped: 20 } }),
    })
    await screen.findByLabelText('部分成功的事务')
    fireEvent.click(screen.getByRole('button', { name: /重试补齐/ }))
    const commit = await waitFor(() => {
      const found = calls.find((call) => call.path === '/api/learning/evidence-commit')
      if (!found) throw new Error('还没发出补齐请求')
      return found
    })
    const body = commit.body as { operationId: string; expectedHashes: Record<string, string | null> }
    expect(body.operationId).toBe('op-partial-aaaa11')
    expect(Object.keys(body.expectedHashes).length).toBe(3)
    expect(body.expectedHashes[PROGRESS_REL]).toBe('hash-progress')
    expect(body.expectedHashes[INDEX_REL]).toBe('hash-index')
    expect(body.expectedHashes[LOG_REL]).toBeNull()
    // 取指纹在前、提交在后：顺序本身就是「不带空指纹盲写」的证据。
    const readIndex = calls.findIndex((call) => call.path === '/api/learning/evidence-transaction/op-partial-aaaa11')
    expect(readIndex).toBeGreaterThanOrEqual(0)
    expect(calls.findIndex((call) => call.path === '/api/learning/evidence-commit')).toBeGreaterThan(readIndex)
  })

  it('取不回基线就不提交：宁可停在这里，也不关掉校验走通流程', async () => {
    const { calls } = renderPanel({
      queue: { pending: [], synced: [stagedRecord({ evidenceId: 'ev-9', state: 'synced' })] },
      ledger: json({ data: { transactions: [ledgerRow()], total: 1, unreadable: 0, capped: 20 } }),
      detail: () => json({ error: '找不到对应的写回事务', code: 'operation_not_found' }, 404),
    })
    await screen.findByLabelText('部分成功的事务')
    fireEvent.click(screen.getByRole('button', { name: /重试补齐/ }))
    const banner = await screen.findByText(/取不回这笔事务的预览基线，未能重试/)
    expect(banner.textContent).toContain('找不到对应的写回事务')
    expect(calls.some((call) => call.path === '/api/learning/evidence-commit')).toBe(false)
  })
})

describe('挂账 #35 · 回滚入口', () => {
  it('回滚要两次点击：先确认说明，再真的发请求，回来一律重读服务端', async () => {
    let rollbacks = 0
    const { calls } = renderPanel({
      ledger: json({ data: { transactions: [ledgerRow()], total: 1, unreadable: 0, capped: 20 } }),
      rollback: () => {
        rollbacks += 1
        return json({
          data: {
            rolledBack: true,
            idempotent: false,
            operationId: 'op-partial-aaaa11',
            targets: [
              { path: INDEX_REL, kind: 'index', action: 'restored' },
              { path: PROGRESS_REL, kind: 'progress', action: 'restored' },
              { path: LOG_REL, kind: 'log', action: 'removed' },
            ],
          },
        })
      },
    })
    await ledgerLoaded()
    fireEvent.click(screen.getByRole('button', { name: /查看这一笔做了什么/ }))
    fireEvent.click(await screen.findByRole('button', { name: /回滚这一笔写回/ }))
    expect(rollbacks).toBe(0)
    expect(calls.some((call) => call.path === '/api/learning/evidence-rollback')).toBe(false)

    const confirm = await screen.findByLabelText('回滚确认')
    expect(text(confirm)).toContain('把已写入、且有备份的步骤，用写入前的备份覆盖回来')
    expect(text(confirm)).toContain('把这笔事务新建的文件移出资料库')
    expect(text(confirm)).toContain('回滚救不回从来没写到磁盘的步骤')

    const before = calls.length
    fireEvent.click(screen.getByRole('button', { name: /确认回滚这一笔/ }))
    await screen.findByText(/服务端已还原 2 个文件、移出本次新建的 1 个/)
    expect(rollbacks).toBe(1)
    // 回执之后必须重读：账本与这一笔的明细各一次，加上下方那句「重新从服务端读回的」。
    const after = calls.slice(before)
    expect(after.filter((call) => call.path === '/api/learning/evidence-transactions').length).toBeGreaterThanOrEqual(1)
    expect(after.filter((call) => call.path === '/api/learning/evidence-transaction/op-partial-aaaa11').length).toBeGreaterThanOrEqual(1)
    expect(text(document.querySelector('.ewb-tx-outcome--done'))).toContain('不是界面自己推断的')
  })

  it('rollback_blocked：逐条 blockers 原样呈现，回执停在 blocked', async () => {
    renderPanel({
      ledger: json({ data: { transactions: [ledgerRow()], total: 1, unreadable: 0, capped: 20 } }),
      rollback: () =>
        json(
          {
            error: '检测到第三方新改动或备份缺失，已停止回滚；请人工合并',
            code: 'rollback_blocked',
            details: {
              blockers: [
                { path: PROGRESS_REL, kind: 'progress', reason: '第三方新改动' },
                { path: INDEX_REL, kind: 'index', reason: '缺少备份文件' },
              ],
            },
          },
          409,
        ),
    })
    await ledgerLoaded()
    fireEvent.click(screen.getByRole('button', { name: /查看这一笔做了什么/ }))
    fireEvent.click(await screen.findByRole('button', { name: /回滚这一笔写回/ }))
    fireEvent.click(await screen.findByRole('button', { name: /确认回滚这一笔/ }))
    const outcome = await screen.findByRole('alert')
    expect(text(outcome)).toContain('检测到第三方新改动或备份缺失')
    expect(outcome.querySelectorAll('.ewb-tx-blockers li').length).toBe(2)
    expect(text(outcome)).toContain('进度追踪.md')
    expect(text(outcome)).toContain('缺少备份文件')
  })

  it('rollback_blocked 但没带结构化 blockers：只复述服务端那句话，不编逐条清单', async () => {
    renderPanel({
      ledger: json({ data: { transactions: [ledgerRow()], total: 1, unreadable: 0, capped: 20 } }),
      rollback: () => json({ error: '检测到第三方新改动或备份缺失，已停止回滚；请人工合并', code: 'rollback_blocked' }, 409),
    })
    await ledgerLoaded()
    fireEvent.click(screen.getByRole('button', { name: /查看这一笔做了什么/ }))
    fireEvent.click(await screen.findByRole('button', { name: /回滚这一笔写回/ }))
    fireEvent.click(await screen.findByRole('button', { name: /确认回滚这一笔/ }))
    const outcome = await screen.findByRole('alert')
    expect(text(outcome)).toContain('检测到第三方新改动或备份缺失')
    expect(outcome.querySelector('.ewb-tx-blockers')).toBeNull()
    expect(text(outcome)).toContain('上面就是它给的全部原因')
  })

  it('回滚被别的错误挡住（不是 blocked）：给失败档，同样不凭空长出逐条清单', async () => {
    renderPanel({
      ledger: json({ data: { transactions: [ledgerRow()], total: 1, unreadable: 0, capped: 20 } }),
      rollback: () => json({ error: '资料库根不可用：路径未配置', code: 'vault_unavailable' }, 503),
    })
    await ledgerLoaded()
    fireEvent.click(screen.getByRole('button', { name: /查看这一笔做了什么/ }))
    fireEvent.click(await screen.findByRole('button', { name: /回滚这一笔写回/ }))
    fireEvent.click(await screen.findByRole('button', { name: /确认回滚这一笔/ }))
    const outcome = await screen.findByRole('alert')
    expect(text(outcome)).toContain('资料库根不可用')
    expect(outcome.querySelector('.ewb-tx-blockers')).toBeNull()
    expect(text(outcome.querySelector('.ewb-mark-text'))).toContain('失败')
  })

  it('一步都没写的事务不给回滚入口：回滚无从谈起', async () => {
    renderPanel({
      ledger: json({
        data: {
          transactions: [ledgerRow({ state: 'partial', targets: ledgerRow().targets.map((step) => ({ ...step, applied: false })) })],
          total: 1,
          unreadable: 0,
          capped: 20,
        },
      }),
      detail: () => json({ data: detailRecord({ targets: detailRecord().targets.map((step) => ({ ...step, applied: false, appliedAt: null })) }) }),
    })
    await ledgerLoaded()
    fireEvent.click(screen.getByRole('button', { name: /查看这一笔做了什么/ }))
    await screen.findByLabelText('写回事务 op-partial-aaaa11 的逐步明细')
    expect(screen.queryByRole('button', { name: /回滚这一笔写回/ })).toBeNull()
    expect(text(document.querySelector('.ewb-rollback-none'))).toContain('这一笔一步都没写入')
  })

  it('非拥有者不请求事务端点，也不出现 06 区', async () => {
    const { calls } = renderPanel({ status: { ...LEARNING_STATUS_OWNER, isOwner: false, progressAccess: false } })
    // 非拥有者这一档，页面上有**两处**说同一件事：队列区那句「不给写回」的说明，
    // 加上预览按钮下面的条件清单里那一条（01 号方案 §4 disabled 行）。
    // 所以按 findAllByRole 之外的宽松法：拿 findAllByText 等「至少出现一次」，
    // 不用 getByText——它在两处同时在场时直接抛 Found multiple elements（实测就是这条）。
    await waitFor(() => {
      // queryAllByText：同步、且多处同时在场不抛（findAllByText 返回 Promise，
      // 塞进 waitFor 里量到的是 promise.length === undefined，那是另一种假通过）。
      expect(screen.queryAllByText(/不是资料库拥有者|只有拥有者|不可写回/).length).toBeGreaterThan(0)
    })
    expect(ledgerZone()).toBeNull()
    expect(calls.some((call) => call.path === '/api/learning/evidence-transactions')).toBe(false)
  })
})
