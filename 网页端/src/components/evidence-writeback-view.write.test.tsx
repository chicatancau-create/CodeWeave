// @vitest-environment jsdom
/**
 * LINK-09 写回路径的**判定**测试（M3 复核挂账 ②③④⑤ 的修复面）。
 *
 * 与另两个文件的分工：
 * - `evidence-writeback-view.test.tsx` 钉业务流（预览不写盘、必须勾选、冲突逐字段、部分成功提示）；
 * - `evidence-writeback-view.m3.test.tsx` 钉 §5.1/§5.2/§5.4 的结构与状态双通道；
 * - 本文件只钉这四件事：读取失败与加载态分得开（②）、冲突后失效预览必须撤下（③）、
 *   冲突未重新预览前没有写入入口（④）、部分成功的重试带真实指纹（⑤），
 *   以及错误文本不回显本机绝对路径（隐私边界）。
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { redactAbsolutePaths } from '../content/api'
import { ContentProvider } from '../content/provider'
import { EvidenceWritebackPanel } from './evidence-writeback-view'

type Reply = { ok: boolean; status?: number; json: () => Promise<unknown> }
type Handler = (input: string, init?: RequestInit) => Reply | Promise<Reply>

const json = (body: unknown, status = 200): Reply => ({ ok: status < 400, status, json: async () => body })

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
  topic: 'Java Hello World',
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

const LOG_PATH = '全栈工程师学习计划/学习日志/2026-09/2026-09-19-Java Hello World.md'
const PROGRESS_PATH = '全栈工程师学习计划/进度追踪.md'
const PLAN_PATH = '全栈工程师学习计划/全栈竞赛长期冲刺总计划.md'

/** 三个目标各带指纹（日志是新建，指纹为 null）：⑤ 要求重试把这一批原样带回。 */
const PREVIEW = {
  operationId: 'op-test-abc123',
  evidenceIds: ['ev-1'],
  at: '2026-09-19',
  topic: 'Java Hello World',
  targets: [
    { path: LOG_PATH, kind: 'log', exists: false, expectedHash: null, preview: '## 学习证据 · Java Hello World\n' },
    {
      path: PROGRESS_PATH,
      kind: 'progress',
      exists: true,
      expectedHash: 'abc12345',
      preview: {
        edits: [{ field: '最近学习证据', kind: 'evidence-date', before: '2026-09-14', after: '2026-09-19' }],
        masteryBlocked: [],
      },
    },
    { path: PLAN_PATH, kind: 'index', exists: true, expectedHash: 'def67890', preview: { changed: true, line: '- [[x]]' } },
  ],
  masteryBlocked: [],
  conflicts: [],
  notices: ['预览不会修改任何资料库文件。'],
}

const PREVIEW_HASHES = { [LOG_PATH]: null, [PROGRESS_PATH]: 'abc12345', [PLAN_PATH]: 'def67890' }

const CONFLICT_DETAILS = {
  code: 'sync_conflict',
  files: [
    {
      path: PROGRESS_PATH,
      kind: 'progress',
      reason: 'third_party_change',
      fieldDiffs: [{ field: '最近学习证据', previewed: '2026-09-14', current: '2026-09-15' }],
    },
  ],
  logSaved: false,
}

const PROGRESS_PENDING = () =>
  json(
    {
      error: '日志已保存，进度待合并：写入失败（EPERM）',
      code: 'progress_pending',
      details: { logSaved: true, progressPending: true },
    },
    409,
  )

function stubFetch(handler: Handler) {
  return vi.stubGlobal('fetch', vi.fn(handler as unknown as typeof fetch))
}

/** 默认把所有写回端点路由到给定响应，并记录每次 POST 的路径与请求体。 */
function route({
  queue = { pending: [stagedRecord()], synced: [] as unknown[] },
  queueFails = false,
  preview = () => json({ data: PREVIEW }),
  commit = () => json({ data: { synced: true, idempotent: false, operationId: 'op-test-abc123', targets: [] } }),
  posts = [] as { path: string; body: Record<string, unknown> }[],
}: {
  queue?: { pending: unknown[]; synced: unknown[] }
  queueFails?: boolean
  preview?: () => Reply
  commit?: () => Reply
  posts?: { path: string; body: Record<string, unknown> }[]
} = {}) {
  stubFetch((input, init) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      posts.push({ path: String(input), body: (init?.body ? JSON.parse(String(init.body)) : {}) as Record<string, unknown> })
    }
    if (input === '/api/content/status') return json({ data: CONTENT_STATUS })
    if (input === '/api/learning/status') return json({ data: LEARNING_STATUS_OWNER })
    if (input === '/api/content/catalog') return json({ data: EMPTY_SNAPSHOT })
    if (input === '/api/learning/evidence' && method === 'GET') {
      return queueFails ? json({ error: '暂存文件损坏', code: 'evidence_store_corrupt' }, 500) : json({ data: queue })
    }
    if (input === '/api/learning/evidence-preview') return preview()
    if (input === '/api/learning/evidence-commit') return commit()
    return json({ error: '未模拟的接口', code: 'not_mocked' }, 404)
  })
  return posts
}

function renderPanel() {
  return render(
    <ContentProvider enabled>
      <EvidenceWritebackPanel />
    </ContentProvider>,
  )
}

/** 走到「已勾选确认、等待提交」的那一步。 */
async function openPreviewAndConfirm(commit: () => Reply) {
  route({ commit })
  renderPanel()
  await screen.findByText('Java Hello World')
  fireEvent.click(screen.getByRole('button', { name: /③ 预览将写入的内容/ }))
  await screen.findByText('预览（尚未写入任何文件）')
  fireEvent.click(screen.getByLabelText(/我已核对以上将写入的内容/))
  fireEvent.click(screen.getByRole('button', { name: '确认写入' }))
}

/** 取出提交请求体列表（下标访问一律给兜底，避免「没发出去」被读成断言通过）。 */
function commitBodies(posts: { path: string; body: Record<string, unknown> }[]) {
  const bodies = posts.filter((post) => post.path === '/api/learning/evidence-commit').map((post) => post.body)
  return {
    count: bodies.length,
    at: (index: number) => bodies[index] ?? { __missing: index },
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('挂账② 队列读取四态', () => {
  it('读取失败：给出原因、错误码与重试入口，且不说成空态也不说成加载中', async () => {
    route({ queueFails: true })
    const { container } = renderPanel()

    const reason = await screen.findByText(/读取暂存证据失败：暂存文件损坏/)
    expect(reason.closest('.ewb-state--failed')).not.toBeNull()
    expect(screen.getByText(/evidence_store_corrupt/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /重新读取队列/ })).toBeTruthy()
    // 四态互斥：失败时既不在转圈，也不谎称空。
    expect(screen.queryByText(/正在读取暂存证据/)).toBeNull()
    expect(screen.queryByText(/没有待写回证据/)).toBeNull()
    expect(container.querySelectorAll('.ewb-skeleton-bar').length).toBe(0)
    // 总账在没读到数据时不给计数：不把「读不到」写成「0 条」。
    expect(screen.getByText(/读取失败，计数不可用/)).toBeTruthy()
    expect(screen.queryByText(/0 条暂存/)).toBeNull()
  })

  it('已经读到过数据后重读失败：保留上一次结果并标出这次失败，不清空成空队列', async () => {
    const posts: { path: string; body: Record<string, unknown> }[] = []
    let readAttempts = 0
    stubFetch((input, init) => {
      if (input === '/api/content/status') return json({ data: CONTENT_STATUS })
      if (input === '/api/learning/status') return json({ data: LEARNING_STATUS_OWNER })
      if (input === '/api/content/catalog') return json({ data: EMPTY_SNAPSHOT })
      if (input === '/api/learning/evidence' && (init?.method ?? 'GET') === 'GET') {
        readAttempts += 1
        return readAttempts === 1
          ? json({ data: { pending: [stagedRecord()], synced: [] } })
          : json({ error: '暂存文件损坏', code: 'evidence_store_corrupt' }, 500)
      }
      if (input === '/api/learning/evidence-preview') return json({ data: PREVIEW })
      if (input === '/api/learning/evidence-commit') {
        posts.push({ path: String(input), body: (init?.body ? JSON.parse(String(init.body)) : {}) as Record<string, unknown> })
        return PROGRESS_PENDING()
      }
      return json({ error: 'x', code: 'x' }, 404)
    })
    renderPanel()
    await screen.findByText('Java Hello World')

    fireEvent.click(screen.getByRole('button', { name: /③ 预览将写入的内容/ }))
    await screen.findByText('预览（尚未写入任何文件）')
    fireEvent.click(screen.getByLabelText(/我已核对以上将写入的内容/))
    fireEvent.click(screen.getByRole('button', { name: '确认写入' }))

    // 提交后半失败 → 面板重读队列，这次读取失败：条目仍在，失败被单独说清。
    expect(await screen.findByText(/日志已保存，进度待合并/)).toBeTruthy()
    expect(await screen.findByText(/队列重读失败/)).toBeTruthy()
    expect(screen.getByText('Java Hello World')).toBeTruthy()
    expect(screen.queryByText(/没有待写回证据/)).toBeNull()
    expect(screen.queryByText(/正在读取暂存证据/)).toBeNull()
  })
})

describe('挂账③④ 冲突后的界面不再有可用的写入入口', () => {
  it('提交冲突：失效预览整块撤下，页面上只剩「重新预览」', async () => {
    await openPreviewAndConfirm(() => json({ error: '目标文件已被其他编辑者修改，未写入任何内容', code: 'sync_conflict', details: CONFLICT_DETAILS }, 409))

    expect(await screen.findByText('检测到第三方改动，未覆盖任何内容')).toBeTruthy()
    expect(screen.getByRole('button', { name: /重新预览/ })).toBeTruthy()
    // 旧预览的指纹在冲突后已失效：预览区与它的「确认写入」都不能再留在页面上。
    expect(screen.queryByText('预览（尚未写入任何文件）')).toBeNull()
    expect(screen.queryByRole('button', { name: '确认写入' })).toBeNull()
    expect(screen.queryByLabelText(/我已核对以上将写入的内容/)).toBeNull()
  })

  it('冲突后重新预览：必须重新勾选确认，写入入口按新指纹重来', async () => {
    let previews = 0
    const posts: { path: string; body: Record<string, unknown> }[] = []
    stubFetch((input, init) => {
      const method = init?.method ?? 'GET'
      if (input === '/api/content/status') return json({ data: CONTENT_STATUS })
      if (input === '/api/learning/status') return json({ data: LEARNING_STATUS_OWNER })
      if (input === '/api/content/catalog') return json({ data: EMPTY_SNAPSHOT })
      if (input === '/api/learning/evidence' && method === 'GET') return json({ data: { pending: [stagedRecord()], synced: [] } })
      if (input === '/api/learning/evidence-preview') {
        previews += 1
        return json({ data: { ...PREVIEW, operationId: previews === 1 ? 'op-test-abc123' : 'op-second-000001' } })
      }
      if (input === '/api/learning/evidence-commit') {
        posts.push({ path: String(input), body: (init?.body ? JSON.parse(String(init.body)) : {}) as Record<string, unknown> })
        return previews === 1
          ? json({ error: '目标文件已被其他编辑者修改，未写入任何内容', code: 'sync_conflict', details: CONFLICT_DETAILS }, 409)
          : json({ data: { synced: true, idempotent: false, operationId: 'op-second-000001', targets: [] } })
      }
      return json({ error: 'x', code: 'x' }, 404)
    })
    renderPanel()
    await screen.findByText('Java Hello World')
    fireEvent.click(screen.getByRole('button', { name: /③ 预览将写入的内容/ }))
    await screen.findByText('预览（尚未写入任何文件）')
    fireEvent.click(screen.getByLabelText(/我已核对以上将写入的内容/))
    fireEvent.click(screen.getByRole('button', { name: '确认写入' }))

    await screen.findByText('检测到第三方改动，未覆盖任何内容')
    fireEvent.click(screen.getByRole('button', { name: /重新预览/ }))

    await screen.findByText('预览（尚未写入任何文件）')
    // 新预览带着新的 operationId，确认勾选被重置：未重新核对就不能写入。
    expect(await screen.findByText('op-second-000001')).toBeTruthy()
    const confirm = screen.getByRole('button', { name: '确认写入' }) as HTMLButtonElement
    expect((screen.getByLabelText(/我已核对以上将写入的内容/) as HTMLInputElement).checked).toBe(false)
    expect(confirm.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText(/我已核对以上将写入的内容/))
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => expect(posts.filter((post) => post.path === '/api/learning/evidence-commit')).toHaveLength(2))
    expect(screen.queryByText('检测到第三方改动，未覆盖任何内容')).toBeNull()
  })

  it('预览过期（stale_preview）不冒充第三方冲突：同样撤下预览，只给「重新预览」的理由', async () => {
    await openPreviewAndConfirm(() =>
      json({ error: '页面上的预览已过期，请重新预览后再提交', code: 'stale_preview', details: { path: PROGRESS_PATH } }, 409),
    )

    expect(await screen.findByText(/页面上的预览已过期/)).toBeTruthy()
    // 「检测到第三方改动」是需要证据的断言，stale_preview 给不出逐字段差异，不能冒领。
    expect(screen.queryByText('检测到第三方改动，未覆盖任何内容')).toBeNull()
    expect(screen.queryByText('预览（尚未写入任何文件）')).toBeNull()
    expect(screen.queryByRole('button', { name: '确认写入' })).toBeNull()
  })

  it('与指纹无关的失败（格式非法）不撤销预览：写入没有开始，核对结果仍然有效', async () => {
    await openPreviewAndConfirm(() => json({ error: 'operationId 格式非法', code: 'invalid_operation' }, 400))

    expect(await screen.findByText(/operationId 格式非法/)).toBeTruthy()
    // 预览内容与目标指纹都没有变化：不把它说成冲突，也不撤掉已经核对过的预览。
    expect(screen.queryByText('检测到第三方改动，未覆盖任何内容')).toBeNull()
    expect(screen.getByText('预览（尚未写入任何文件）')).toBeTruthy()
    expect(screen.getByRole('button', { name: '确认写入' }).hasAttribute('disabled')).toBe(false)
  })
})

describe('挂账⑤ 部分成功的重试带真实指纹', () => {
  it('重试补齐提交的 expectedHashes 与预览一致，不是空对象', async () => {
    const posts = route({ commit: PROGRESS_PENDING })
    renderPanel()
    await screen.findByText('Java Hello World')
    fireEvent.click(screen.getByRole('button', { name: /③ 预览将写入的内容/ }))
    await screen.findByText('预览（尚未写入任何文件）')
    fireEvent.click(screen.getByLabelText(/我已核对以上将写入的内容/))
    fireEvent.click(screen.getByRole('button', { name: '确认写入' }))

    await screen.findByText(/日志已保存，进度待合并/)
    fireEvent.click(screen.getByRole('button', { name: /重试补齐/ }))
    await waitFor(() => expect(commitBodies(posts).count).toBe(2))

    const commits = commitBodies(posts)
    expect(commits.at(0)).toMatchObject({ operationId: 'op-test-abc123' })
    expect(commits.at(0).expectedHashes).toEqual(PREVIEW_HASHES)
    // 关键：第二次（重试）与第一次带同一批真实指纹，绝不退回 `{}` 关闭校验。
    expect(commits.at(1).expectedHashes).toEqual(PREVIEW_HASHES)
    expect(Object.keys(commits.at(1).expectedHashes as Record<string, unknown>)).toHaveLength(3)
    expect(commits.at(1).operationId).toBe('op-test-abc123')
  })

  it('重试按钮旁写明沿用的指纹项数；没有指纹可带时宁可不可点', async () => {
    route({ commit: PROGRESS_PENDING })
    renderPanel()
    await screen.findByText('Java Hello World')
    fireEvent.click(screen.getByRole('button', { name: /③ 预览将写入的内容/ }))
    await screen.findByText('预览（尚未写入任何文件）')
    fireEvent.click(screen.getByLabelText(/我已核对以上将写入的内容/))
    fireEvent.click(screen.getByRole('button', { name: '确认写入' }))

    const note = await screen.findByText(/重试沿用的目标指纹/)
    const zone = note.closest('.ewb-zone--partial')
    expect(zone).not.toBeNull()
    expect(within(zone as HTMLElement).getByText('3 项')).toBeTruthy()
    expect(within(zone as HTMLElement).getByText('校验不关闭')).toBeTruthy()

    // 目标清单为空（没有任何指纹可带）时，不提供盲写入口。
    cleanup()
    route({ preview: () => json({ data: { ...PREVIEW, targets: [] } }), commit: PROGRESS_PENDING })
    renderPanel()
    await screen.findByText('Java Hello World')
    fireEvent.click(screen.getByRole('button', { name: /③ 预览将写入的内容/ }))
    await screen.findByText('预览（尚未写入任何文件）')
    fireEvent.click(screen.getByLabelText(/我已核对以上将写入的内容/))
    fireEvent.click(screen.getByRole('button', { name: '确认写入' }))
    await screen.findByText(/日志已保存，进度待合并/)
    expect((screen.getByRole('button', { name: /重试补齐/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('重试再次半成功时仍然保留同一批指纹，可继续补齐', async () => {
    const posts = route({ commit: PROGRESS_PENDING })
    renderPanel()
    await screen.findByText('Java Hello World')
    fireEvent.click(screen.getByRole('button', { name: /③ 预览将写入的内容/ }))
    await screen.findByText('预览（尚未写入任何文件）')
    fireEvent.click(screen.getByLabelText(/我已核对以上将写入的内容/))
    fireEvent.click(screen.getByRole('button', { name: '确认写入' }))
    await screen.findByText(/日志已保存，进度待合并/)
    fireEvent.click(screen.getByRole('button', { name: /重试补齐/ }))
    await waitFor(() => expect(commitBodies(posts).count).toBe(2))
    expect(screen.getByText(/日志已保存，进度待合并/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /重试补齐/ }))
    await waitFor(() => expect(commitBodies(posts).count).toBe(3))
    const commits = commitBodies(posts)
    expect(commits.at(1).expectedHashes).toEqual(PREVIEW_HASHES)
    expect(commits.at(2).expectedHashes).toEqual(PREVIEW_HASHES)
  })
})

describe('隐私边界：错误文本不回显本机绝对路径', () => {
  it('服务端错误里的 Windows / UNC / POSIX 绝对路径都被隐去，库内相对路径保留', () => {
    expect(redactAbsolutePaths('写入失败：E:\\CodeWeave\\runtime\\data\\users.json')).toBe('写入失败：（已隐去本机路径）')
    expect(redactAbsolutePaths('写入失败：\\\\file-server\\share\\note.md')).toBe('写入失败：（已隐去本机路径）')
    expect(redactAbsolutePaths('open /home/codeweave/.codeweave/users.json failed')).toBe(
      'open （已隐去本机路径） failed',
    )
    // 库内相对路径是有效信息，不能被吃掉。
    expect(redactAbsolutePaths('目标文件不存在：全栈工程师学习计划/进度追踪.md')).toBe(
      '目标文件不存在：全栈工程师学习计划/进度追踪.md',
    )
  })

  it('界面上只出现隐去后的措辞，不出现盘符路径', async () => {
    stubFetch((input, init) => {
      if (input === '/api/content/status') return json({ data: CONTENT_STATUS })
      if (input === '/api/learning/status') return json({ data: LEARNING_STATUS_OWNER })
      if (input === '/api/content/catalog') return json({ data: EMPTY_SNAPSHOT })
      if (input === '/api/learning/evidence' && (init?.method ?? 'GET') === 'GET') {
        return json({ error: '暂存写入失败：E:\\CodeWeave\\runtime\\data\\learning 不可写', code: 'storage_error' }, 500)
      }
      return json({ error: 'x', code: 'x' }, 404)
    })
    const { container } = renderPanel()
    await screen.findByText(/读取暂存证据失败/)
    expect(container.textContent).toContain('（已隐去本机路径）')
    expect(container.textContent).toContain('不可写') // 只隐去路径，不吞掉可读原因
    expect(container.textContent).toContain('storage_error')
    expect(container.textContent).not.toContain('E:\\CodeWeave')
  })
})
