// @vitest-environment jsdom
/**
 * LINK-09 写回界面测试。
 *
 * 目的：
 * 1) 验证界面与方案一致的行为（预览不写盘、必须勾选确认、冲突逐字段展示、部分成功如实提示）；
 * 2) 新组件在覆盖率门禁内被测到，避免为了过阈值下调阈值（vitest.config.ts 的约定）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContentProvider } from '../content/provider'
import { EvidenceWritebackPanel } from './evidence-writeback-view'

type Reply = { ok: boolean; status?: number; json: () => Promise<unknown> }
/** 允许返回在途 Promise：加载态要由「这一次还没读回来」驱动（挂账②）。 */
type Handler = (input: string, init?: RequestInit) => Reply | Promise<Reply>

/** 受测试控制的挂起响应：先让界面停在加载态，再由测试放行拿到真实结果。 */
function deferred() {
  let resolve!: (reply: Reply) => void
  const promise = new Promise<Reply>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

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

const LEARNING_STATUS_OTHER = { ...LEARNING_STATUS_OWNER, isOwner: false, contentAccess: { allowed: true, reason: 'public_content' }, progressAccess: false, notice: '教材已放开给其他账户（正式进度仍仅拥有者可见）。' }

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

const PREVIEW = {
  operationId: 'op-test-abc123',
  evidenceIds: ['ev-1'],
  at: '2026-09-19',
  topic: 'Java Hello World',
  targets: [
    {
      path: '全栈工程师学习计划/学习日志/2026-09/2026-09-19-Java Hello World.md',
      kind: 'log',
      exists: false,
      expectedHash: null,
      preview: '## 学习证据 · Java Hello World\n',
    },
    {
      path: '全栈工程师学习计划/进度追踪.md',
      kind: 'progress',
      exists: true,
      expectedHash: 'abc12345',
      preview: {
        edits: [{ field: '最近学习证据', kind: 'evidence-date', before: '2026-09-14', after: '2026-09-19' }],
        masteryBlocked: [{ skill: 'Java 编程', level: '4 级', reason: '本次证据不是学习者独立完成' }],
      },
    },
    {
      path: '全栈工程师学习计划/全栈竞赛长期冲刺总计划.md',
      kind: 'index',
      exists: true,
      expectedHash: 'def67890',
      preview: { changed: true, line: '- [[全栈工程师学习计划/学习日志/2026-09/2026-09-19-Java Hello World]] — S0 Java Hello World' },
    },
  ],
  masteryBlocked: [{ skill: 'Java 编程', level: '4 级', reason: '本次证据不是学习者独立完成' }],
  conflicts: [],
  notices: ['预览不会修改任何资料库文件。', '写回顺序：学习日志 → 进度追踪 → 总计划日志索引。'],
}

function stubFetch(handler: Handler) {
  return vi.stubGlobal('fetch', vi.fn(handler as unknown as typeof fetch))
}

/** 默认路由：只覆盖本组件需要端点，其余返回 404，避免测试依赖真实网络。 */
function route({
  learningStatus = LEARNING_STATUS_OWNER,
  queue = { pending: [] as unknown[], synced: [] as unknown[] },
  stage,
  preview,
  commit,
  onPost,
}: {
  learningStatus?: unknown
  queue?: { pending: unknown[]; synced: unknown[] }
  stage?: () => { ok: boolean; status?: number; json: () => Promise<unknown> }
  preview?: () => { ok: boolean; status?: number; json: () => Promise<unknown> }
  commit?: () => { ok: boolean; status?: number; json: () => Promise<unknown> }
  onPost?: (path: string, body: unknown) => void
} = {}) {
  return stubFetch((input, init) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    if (method !== 'GET') onPost?.(input, body)
    if (input === '/api/content/status') return json({ data: CONTENT_STATUS })
    if (input === '/api/learning/status') return json({ data: learningStatus })
    if (input === '/api/content/catalog') return json({ data: EMPTY_SNAPSHOT })
    if (input === '/api/learning/evidence' && method === 'GET') return json({ data: queue })
    if (input === '/api/learning/evidence' && method === 'POST') return stage ? stage() : json({ data: stagedRecord() }, 201)
    if (input === '/api/learning/evidence-preview') return preview ? preview() : json({ data: PREVIEW })
    if (input === '/api/learning/evidence-commit') return commit ? commit() : json({ data: { synced: true, idempotent: false, operationId: 'op-test-abc123', targets: [] } })
    if (input === '/api/learning/evidence/remove') return json({ data: { removed: true } })
    if (input === '/api/learning/evidence-export') return json({ data: { markdown: '# 待保存\n', evidenceIds: ['ev-1'], logPath: 'x.md' } })
    return json({ error: '未模拟的接口', code: 'not_mocked' }, 404)
  })
}

function renderPanel() {
  return render(
    <ContentProvider enabled>
      <EvidenceWritebackPanel />
    </ContentProvider>,
  )
}

const stageOne = async (topic = 'Java Hello World') => {
  fireEvent.change(screen.getByLabelText('学习主题'), { target: { value: topic } })
  fireEvent.click(screen.getByRole('button', { name: '暂存证据' }))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('LINK-09 写回界面', () => {
  it('非拥有者：明确说明不能写入，且预览按钮禁用', async () => {
    route({ learningStatus: LEARNING_STATUS_OTHER })
    renderPanel()

    expect(await screen.findByText(/当前账户不是资料库拥有者/)).toBeTruthy()
    const preview = screen.getByRole('button', { name: /③ 预览将写入的内容/ })
    expect((preview as HTMLButtonElement).disabled).toBe(true)
    // 暂存与导出仍然可用（本机数据）
    expect(screen.getByRole('button', { name: '暂存证据' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /导出待保存 Markdown/ })).toBeTruthy()
  })

  it('队列为空时说明暂存不等于写回', async () => {
    route()
    renderPanel()
    expect(await screen.findByText(/没有待写回证据/)).toBeTruthy()
  })

  it('暂存成功：提示未修改资料库，并把条目放入队列', async () => {
    let posted: unknown = null
    route({
      onPost: (path, body) => {
        if (path === '/api/learning/evidence') posted = body
      },
      stage: () => json({ data: stagedRecord() }, 201),
    })
    // 第一次 GET 返回空队列，暂存后第二次返回新条目
    let calls = 0
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const base = fetchMock.getMockImplementation() as Handler
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      if (input === '/api/learning/evidence' && (init?.method ?? 'GET') === 'GET') {
        calls += 1
        return json({ data: calls === 1 ? { pending: [], synced: [] } : { pending: [stagedRecord()], synced: [] } })
      }
      return base(input, init)
    })

    renderPanel()
    await screen.findByText(/没有待写回证据/)
    await stageOne()

    expect(await screen.findByText(/已暂存为待写回证据（pending）/)).toBeTruthy()
    expect(await screen.findByText('Java Hello World')).toBeTruthy()
    expect(posted).toMatchObject({ topic: 'Java Hello World', ranBy: 'learner', independent: true })
  })

  it('暂存被拒时如实显示服务端理由', async () => {
    route({ stage: () => json({ error: 'AI 助手运行的记录不能标记为「学习者独立完成」', code: 'invalid_evidence' }, 400) })
    renderPanel()
    await screen.findByText(/没有待写回证据/)
    await stageOne()
    expect(await screen.findByText(/不能标记为「学习者独立完成」/)).toBeTruthy()
  })

  it('预览：展示目标、进度差异与被阻止的提升；未勾选时不能写入', async () => {
    route({ queue: { pending: [stagedRecord()], synced: [] } })
    renderPanel()
    await screen.findByText('Java Hello World')

    fireEvent.click(screen.getByRole('button', { name: /③ 预览将写入的内容/ }))

    expect(await screen.findByText('预览（尚未写入任何文件）')).toBeTruthy()
    expect(screen.getByText('全栈工程师学习计划/学习日志/2026-09/2026-09-19-Java Hello World.md')).toBeTruthy()
    expect(screen.getByText('最近学习证据')).toBeTruthy()
    expect(screen.getByText('2026-09-14')).toBeTruthy()
    expect(screen.getByText('2026-09-19')).toBeTruthy()
    expect(screen.getByText(/已阻止提升「Java 编程」到 4 级/)).toBeTruthy()

    const confirm = screen.getByRole('button', { name: '确认写入' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText(/我已核对以上将写入的内容/))
    expect(confirm.disabled).toBe(false)
  })

  it('确认写入成功：显示复核完成文案', async () => {
    route({ queue: { pending: [stagedRecord()], synced: [] } })
    renderPanel()
    await screen.findByText('Java Hello World')
    fireEvent.click(screen.getByRole('button', { name: /③ 预览将写入的内容/ }))
    await screen.findByText('预览（尚未写入任何文件）')
    fireEvent.click(screen.getByLabelText(/我已核对以上将写入的内容/))
    fireEvent.click(screen.getByRole('button', { name: '确认写入' }))

    expect(await screen.findByText(/已写入并复核：学习日志 → 进度追踪 → 总计划日志索引，全部成功/)).toBeTruthy()
  })

  it('冲突：展示逐字段差异，不显示成功', async () => {
    route({
      queue: { pending: [stagedRecord()], synced: [] },
      commit: () =>
        json(
          {
            error: '目标文件已被其他编辑者修改，未写入任何内容',
            code: 'sync_conflict',
            details: {
              code: 'sync_conflict',
              files: [
                {
                  path: '全栈工程师学习计划/进度追踪.md',
                  kind: 'progress',
                  reason: 'third_party_change',
                  fieldDiffs: [{ field: '最近学习证据', previewed: '2026-09-14', current: '2026-09-15' }],
                },
              ],
              logSaved: false,
            },
          },
          409,
        ),
    })
    renderPanel()
    await screen.findByText('Java Hello World')
    fireEvent.click(screen.getByRole('button', { name: /③ 预览将写入的内容/ }))
    await screen.findByText('预览（尚未写入任何文件）')
    fireEvent.click(screen.getByLabelText(/我已核对以上将写入的内容/))
    fireEvent.click(screen.getByRole('button', { name: '确认写入' }))

    expect(await screen.findByText('检测到第三方改动，未覆盖任何内容')).toBeTruthy()
    expect(screen.getByText(/不按修改时间决胜/)).toBeTruthy()
    expect(screen.getByText('2026-09-15')).toBeTruthy()
    expect(screen.getByRole('button', { name: /重新预览/ })).toBeTruthy()
    expect(screen.queryByText(/已写入并复核/)).toBeNull()
  })

  it('部分成功：提示日志已保存、进度待合并，并提供重试', async () => {
    const calls: string[] = []
    route({
      queue: { pending: [stagedRecord()], synced: [] },
      onPost: (path) => calls.push(path),
      commit: () =>
        json(
          { error: '日志已保存，进度待合并：写入失败（EPERM）', code: 'progress_pending', details: { logSaved: true, progressPending: true } },
          409,
        ),
    })
    renderPanel()
    await screen.findByText('Java Hello World')
    fireEvent.click(screen.getByRole('button', { name: /③ 预览将写入的内容/ }))
    await screen.findByText('预览（尚未写入任何文件）')
    fireEvent.click(screen.getByLabelText(/我已核对以上将写入的内容/))
    fireEvent.click(screen.getByRole('button', { name: '确认写入' }))

    expect(await screen.findByText(/日志已保存，进度待合并/)).toBeTruthy()
    const retry = screen.getByRole('button', { name: /重试补齐/ })
    fireEvent.click(retry)
    await waitFor(() => {
      expect(calls.filter((path) => path === '/api/learning/evidence-commit').length).toBe(2)
    })
    // 重试不再要求重新勾选（继续同一事务）
    expect(screen.queryByText(/已写入并复核/)).toBeNull()
  })

  it('导出待保存 Markdown：请求导出接口并提示导出不等于已同步', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const paths: string[] = []
    route({ queue: { pending: [stagedRecord()], synced: [] }, onPost: (path) => paths.push(path) })

    renderPanel()
    await screen.findByText('Java Hello World')
    fireEvent.click(screen.getByRole('button', { name: /导出待保存 Markdown/ }))

    expect(await screen.findByText(/导出不等于已同步/)).toBeTruthy()
    expect(paths).toContain('/api/learning/evidence-export')
    expect(createObjectURL).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()
  })

  it('未绑定拥有者时不渲染面板（没有可写回的目标）', () => {
    route({ learningStatus: null })
    renderPanel()
    expect(screen.queryByLabelText('学习证据写回')).toBeNull()
  })
})

describe('LINK-09 写回界面：不实证据与次要分支', () => {
  it('运行者选 AI 助手时禁用「独立完成」，并按非独立提交', async () => {
    let posted: Record<string, unknown> | null = null
    route({ onPost: (path, body) => { if (path === '/api/learning/evidence') posted = body as Record<string, unknown> } })
    renderPanel()
    await screen.findByText(/没有待写回证据/)

    fireEvent.change(screen.getByLabelText('运行者'), { target: { value: 'ai_assistant' } })
    const independent = screen.getByLabelText(/由我独立完成/) as HTMLInputElement
    expect(independent.disabled).toBe(true)

    await stageOne()
    expect(await screen.findByText(/已暂存为待写回证据/)).toBeTruthy()
    expect(posted).toMatchObject({ ranBy: 'ai_assistant', independent: false })
  })

  it('提示等级选 L3 时同样禁用「独立完成」', async () => {
    route()
    renderPanel()
    await screen.findByText(/没有待写回证据/)
    fireEvent.change(screen.getByLabelText('提示等级'), { target: { value: 'L3' } })
    expect((screen.getByLabelText(/由我独立完成/) as HTMLInputElement).disabled).toBe(true)
  })

  it('删除暂存证据会调用删除接口并刷新队列', async () => {
    const paths: string[] = []
    route({ queue: { pending: [stagedRecord()], synced: [] }, onPost: (path) => paths.push(path) })
    renderPanel()
    await screen.findByText('Java Hello World')

    fireEvent.click(screen.getByRole('button', { name: /删除/ }))
    await waitFor(() => expect(paths).toContain('/api/learning/evidence/remove'))
  })

  it('进度无需变更、索引已存在、没有日志目标时如实说明，不伪造变更', async () => {
    route({
      queue: { pending: [stagedRecord()], synced: [] },
      preview: () =>
        json({
          data: {
            ...PREVIEW,
            targets: [
              { path: '全栈工程师学习计划/进度追踪.md', kind: 'progress', exists: true, expectedHash: 'abc', preview: { edits: [], masteryBlocked: [] } },
              { path: '全栈工程师学习计划/全栈竞赛长期冲刺总计划.md', kind: 'index', exists: true, expectedHash: 'def', preview: { changed: false, reason: '索引里已存在当天日志链接' } },
            ],
          },
        }),
    })
    renderPanel()
    await screen.findByText('Java Hello World')
    fireEvent.click(screen.getByRole('button', { name: /③ 预览将写入的内容/ }))
    await screen.findByText('预览（尚未写入任何文件）')

    expect(screen.getByText(/进度追踪无需变更/)).toBeTruthy()
    expect(screen.getByText(/索引里已存在当天日志链接/)).toBeTruthy()
    expect(screen.queryByText('将追加到日志的小节')).toBeNull()
  })

  it('导出在没有勾选任何条目时也可用（导出全部暂存）', async () => {
    const posts: { path: string; body: Record<string, unknown> }[] = []
    route({
      queue: { pending: [stagedRecord()], synced: [] },
      onPost: (path, body) => posts.push({ path, body: body as Record<string, unknown> }),
    })
    renderPanel()
    await screen.findByText('Java Hello World')
    // 取消默认勾选：队列全不选时导出应导出全部暂存证据
    fireEvent.click(screen.getByLabelText(/Java Hello World/))
    fireEvent.click(screen.getByRole('button', { name: /导出待保存 Markdown/ }))

    await screen.findByText(/导出不等于已同步/)
    const exportCall = posts.find((item) => item.path === '/api/learning/evidence-export')
    expect(exportCall?.body).toEqual({ evidenceIds: [] })
  })

  it('已同步计数单独展示，不把已同步的条目混进待写回队列', async () => {
    route({ queue: { pending: [], synced: [stagedRecord({ state: 'synced', evidenceId: 'ev-9' })] } })
    renderPanel()
    expect(await screen.findByText(/0 条暂存 \/ 1 条已同步/)).toBeTruthy()
    expect(screen.getByText(/没有待写回证据/)).toBeTruthy()
  })

  it('队列读取：先如实显示加载态，失败后转成带原因的失败态，始终不谎称没有证据', async () => {
    const read = deferred()
    stubFetch((input) => {
      if (input === '/api/content/status') return json({ data: CONTENT_STATUS })
      if (input === '/api/learning/status') return json({ data: LEARNING_STATUS_OWNER })
      if (input === '/api/content/catalog') return json({ data: EMPTY_SNAPSHOT })
      if (input === '/api/learning/evidence') return read.promise
      return json({ error: 'x', code: 'x' }, 404)
    })
    renderPanel()
    // ① 这一次读还没回来 → 加载态（改前的两条断言逐字保留）。
    expect(await screen.findByText(/正在读取暂存证据/)).toBeTruthy()
    expect(screen.queryByText(/没有待写回证据/)).toBeNull()

    // ② 读回来了、但是失败 → 必须是带原因与重试入口的失败态，
    //    不能永久停在「正在读取暂存证据…」（挂账②）。
    read.resolve(json({ error: '暂存文件损坏', code: 'evidence_store_corrupt' }, 500))
    expect(await screen.findByText(/读取暂存证据失败：暂存文件损坏/)).toBeTruthy()
    expect(screen.getByText(/evidence_store_corrupt/)).toBeTruthy()
    expect(screen.queryByText(/正在读取暂存证据/)).toBeNull()

    // ③ 失败态仍然不说成空态。
    expect(screen.queryByText(/没有待写回证据/)).toBeNull()

    // ④ 重试入口：放行后同一次读取成功，界面回到有数据。
    const retry = screen.getByRole('button', { name: /重新读取队列/ })
    const second = deferred()
    stubFetch((input) => {
      if (input === '/api/content/status') return json({ data: CONTENT_STATUS })
      if (input === '/api/learning/status') return json({ data: LEARNING_STATUS_OWNER })
      if (input === '/api/content/catalog') return json({ data: EMPTY_SNAPSHOT })
      if (input === '/api/learning/evidence') return second.promise
      return json({ error: 'x', code: 'x' }, 404)
    })
    second.resolve(json({ data: { pending: [stagedRecord()], synced: [] } }))
    fireEvent.click(retry)

    expect(await screen.findByText('Java Hello World')).toBeTruthy()
    expect(screen.queryByText(/读取暂存证据失败/)).toBeNull()
  })

  it('队列条目按运行者与提示等级如实标注', async () => {
    route({
      queue: {
        pending: [stagedRecord({ ranBy: 'ai_assistant', independent: false, hintLevel: null, topic: 'AI 演示' })],
        synced: [],
      },
    })
    renderPanel()
    expect(await screen.findByText('AI 演示')).toBeTruthy()
    expect(screen.getByText(/AI 助手 · 非独立/)).toBeTruthy()
  })

  it('预览被拒时显示服务端理由，且不显示预览块', async () => {
    route({
      queue: { pending: [stagedRecord()], synced: [] },
      preview: () => json({ error: '这些证据已同步过；重复提交不会再次追加', code: 'already_synced' }, 409),
    })
    renderPanel()
    await screen.findByText('Java Hello World')
    fireEvent.click(screen.getByRole('button', { name: /③ 预览将写入的内容/ }))

    expect(await screen.findByText(/这些证据已同步过/)).toBeTruthy()
    expect(screen.queryByText('预览（尚未写入任何文件）')).toBeNull()
    expect(screen.queryByText('检测到第三方改动，未覆盖任何内容')).toBeNull()
  })

  it('提交失败但无冲突详情时只显示错误，不显示冲突表', async () => {
    route({
      queue: { pending: [stagedRecord()], synced: [] },
      commit: () => json({ error: 'operationId 格式非法', code: 'invalid_operation' }, 400),
    })
    renderPanel()
    await screen.findByText('Java Hello World')
    fireEvent.click(screen.getByRole('button', { name: /③ 预览将写入的内容/ }))
    await screen.findByText('预览（尚未写入任何文件）')
    fireEvent.click(screen.getByLabelText(/我已核对以上将写入的内容/))
    fireEvent.click(screen.getByRole('button', { name: '确认写入' }))

    expect(await screen.findByText(/operationId 格式非法/)).toBeTruthy()
    expect(screen.queryByText('检测到第三方改动，未覆盖任何内容')).toBeNull()
    expect(screen.queryByText(/已写入并复核/)).toBeNull()
  })

  it('暂存失败时不产生队列条目', async () => {
    route({ stage: () => json({ error: '证据暂存文件损坏', code: 'evidence_store_corrupt' }, 500) })
    renderPanel()
    await screen.findByText(/没有待写回证据/)
    await stageOne()
    expect(await screen.findByText(/证据暂存文件损坏/)).toBeTruthy()
    expect(screen.getByText(/没有待写回证据/)).toBeTruthy()
  })
})

/**
 * 01 号方案 §4 的 disabled 行：写回页三颗按钮的禁用条件必须被说出来。
 * 改版前它们只被共享层 `styles.css` 的 `:disabled{opacity:.5}` 压淡——
 * 「正在提交」「没勾选」「不是拥有者」「没确认预览」四种不同的事实是同一种灰。
 *
 * 两处判据写法要说清：
 * - 说明按 **id 定位**，不能按 `.ewb-disabled-hint` 类名：同一屏可以同时有两颗按钮禁用，
 *   类名查询会抓到别人的那一条（本文件第一版就是这么错的）。
 * - 队列行**默认是勾好的**，所以「当前 0 项」这一档必须先点掉勾选才成立。
 */
describe('§4 disabled · 按不动时要说清条件，条件消失时说明与属性一起撤下', () => {
  const hintOf = (container: HTMLElement, button: HTMLElement) => {
    const hintId = button.getAttribute('aria-describedby')
    expect(hintId, '禁用却没有 describe 目标 = 只有视觉通道').toBeTruthy()
    return container.querySelector(`#${hintId}`) as HTMLElement
  }

  it('主题名没填：暂存按钮说「先填主题名」，填上之后说明与属性一起撤下', async () => {
    route()
    const { container } = renderPanel()
    await screen.findByText(/没有待写回证据/)

    const stage = screen.getByRole('button', { name: '暂存证据' }) as HTMLButtonElement
    expect(stage.disabled).toBe(true)
    expect(stage.getAttribute('aria-disabled')).toBe('true')
    const hint = hintOf(container, stage)
    expect(hint.textContent).toContain('先填这条证据的主题名')
    // 条件说明是静态文字：本页的播报权属于结果那一行（写入结果 / 失败原因），
    // 多挂一个活区域只会和它抢播报。
    expect(hint.hasAttribute('role')).toBe(false)

    fireEvent.change(screen.getByLabelText('学习主题'), { target: { value: 'Java Hello World' } })
    const ready = screen.getByRole('button', { name: '暂存证据' }) as HTMLButtonElement
    expect(ready.disabled).toBe(false)
    expect(ready.hasAttribute('aria-disabled'), '可点之后不许留着 aria-disabled').toBe(false)
    expect(ready.hasAttribute('aria-describedby')).toBe(false)
    expect(container.querySelector('#ewb-stage-disabled-hint')).toBeNull()
  })

  it('把默认勾选点掉：预览按钮说明「当前 0 项」，重新勾上就解禁', async () => {
    route({ queue: { pending: [stagedRecord()], synced: [] } })
    const { container } = renderPanel()
    await screen.findByText('Java Hello World')

    const preview = screen.getByRole('button', { name: /③ 预览将写入的内容/ }) as HTMLButtonElement
    expect(preview.disabled, '队列行默认已勾好，这一颗本该可点').toBe(false)

    fireEvent.click(screen.getByLabelText(/Java Hello World/))
    const blocked = screen.getByRole('button', { name: /③ 预览将写入的内容/ }) as HTMLButtonElement
    expect(blocked.disabled).toBe(true)
    expect(hintOf(container, blocked).textContent).toContain('上面还没勾出要写回的条目（当前 0 项）')

    fireEvent.click(screen.getByLabelText(/Java Hello World/))
    expect((screen.getByRole('button', { name: /③ 预览将写入的内容/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('不是拥有者：理由说的是权限本身，同时不牵连「导出待保存 Markdown」那颗', async () => {
    route({ learningStatus: LEARNING_STATUS_OTHER, queue: { pending: [stagedRecord()], synced: [] } })
    const { container } = renderPanel()
    await screen.findByText(/当前账户不是资料库拥有者/)

    const preview = screen.getByRole('button', { name: /③ 预览将写入的内容/ }) as HTMLButtonElement
    expect(preview.disabled).toBe(true)
    expect(hintOf(container, preview).textContent).toContain('写回资料库只有拥有者能做')

    const exportButton = screen.getByRole('button', { name: /导出待保存 Markdown/ }) as HTMLButtonElement
    expect(exportButton.disabled, '导出走的是本机数据，不该被同一条权限理由禁掉').toBe(false)
  })

  it('确认写入：没勾确认时说「还没勾」，勾上之后说明撤下', async () => {
    route({ queue: { pending: [stagedRecord()], synced: [] } })
    const { container } = renderPanel()
    await screen.findByText('Java Hello World')
    fireEvent.click(screen.getByRole('button', { name: /③ 预览将写入的内容/ }))
    await screen.findByText('预览（尚未写入任何文件）')

    const commit = screen.getByRole('button', { name: '确认写入' }) as HTMLButtonElement
    expect(commit.disabled).toBe(true)
    expect(hintOf(container, commit).textContent).toContain('还没勾「我已核对以上将写入的内容」')

    fireEvent.click(screen.getByLabelText(/我已核对以上将写入的内容/))
    const ready = screen.getByRole('button', { name: '确认写入' }) as HTMLButtonElement
    expect(ready.disabled).toBe(false)
    expect(container.querySelector('#ewb-commit-disabled-hint')).toBeNull()
  })

  it('CSS 不变式：本页按钮禁用档不靠透明度，改走虚线描边', async () => {
    const fsSpecifier: string = 'node:fs'
    const { readFileSync } = (await import(fsSpecifier)) as {
      readFileSync: (path: string, encoding: 'utf8') => string
    }
    const moduleDir = (import.meta as unknown as { dirname?: string }).dirname ?? '.'
    const css = readFileSync(`${moduleDir}/evidence-writeback-view.css`, 'utf8')
    const block = /\.evidence-writeback \.primary-action:disabled[\s\S]*?\}/.exec(css)
    expect(block, '共享层那条 opacity:.5 必须被本页覆盖掉').toBeTruthy()
    expect(block?.[0]).toMatch(/opacity:\s*1/)
    expect(block?.[0]).toMatch(/border-style:\s*dashed/)
  })
})
