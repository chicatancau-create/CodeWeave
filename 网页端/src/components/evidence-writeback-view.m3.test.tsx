// @vitest-environment jsdom
/**
 * LINK-09 证据写回页 —— M3 视觉竖切（01 号方案 §4 写回拆分目标 / §2.2 末段语义色）补充用例。
 *
 * 口径：本文件**不重复** evidence-writeback-view.test.tsx 的业务断言，
 * 只把 §5.2 与 §5.1 中「可被结构验证」的部分钉成回归断言：
 * 1) 「待处理 / 部分成功 / 已同步」是三个各自独立的区块，各自带说明标题与状态文字；
 * 2) 语义状态一律「图形 + 文字」双通道，不允许只靠颜色；
 * 3) 细线差异预览：目标表 / 日志追加行 / 逐字段差异都带列标题与文字前缀；
 * 4) 加载 / 空 / 失败三态各有自己的标识文字；
 * 5) 写路径关键上下文（operationId、指纹、事务保留提示）改版后仍在位。
 *
 * 焦点轮廓、16px 与 1.6–1.75 行高、prefers-reduced-motion 与 .reduce-motion 下动画真实停止
 * 都属于 CSS 计算结果，jsdom 不做样式计算（本仓库 vitest 未开 css），因此不在此伪造断言，
 * 已列入交付报告的浏览器复核清单。
 * 44px 命中区与 320px 换版例外：末段按**样式表源码**钉住规则（不伪造计算值），
 * 数字仍来自浏览器实测。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContentProvider } from '../content/provider'
import { EvidenceWritebackPanel } from './evidence-writeback-view'

type Reply = { ok: boolean; status?: number; json: () => Promise<unknown> }
/** 允许返回在途 Promise：加载态要用「还没读回来」驱动，而不是拿失败响应冒充。 */
type Handler = (input: string, init?: RequestInit) => Reply | Promise<Reply>

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

const syncedRecord = stagedRecord({
  evidenceId: 'ev-9',
  state: 'synced',
  syncedAt: '2026-09-18T02:00:00.000Z',
  logPath: '全栈工程师学习计划/学习日志/2026-09/2026-09-18-旧条目.md',
  operationId: 'op-done-1',
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
      preview: '## 学习证据 · Java Hello World\n- 预期：Hello\n',
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
      preview: { changed: true, line: '- [[全栈工程师学习计划/学习日志/2026-09/2026-09-19-Java Hello World]]' },
    },
  ],
  masteryBlocked: [{ skill: 'Java 编程', level: '4 级', reason: '本次证据不是学习者独立完成' }],
  conflicts: [],
  notices: ['预览不会修改任何资料库文件。', '写回顺序：学习日志 → 进度追踪 → 总计划日志索引。'],
}

function stubFetch(handler: Handler) {
  return vi.stubGlobal('fetch', vi.fn(handler as unknown as typeof fetch))
}

function route({
  queue = { pending: [] as unknown[], synced: [] as unknown[] },
  commit,
  preview,
}: {
  queue?: { pending: unknown[]; synced: unknown[] }
  commit?: () => { ok: boolean; status?: number; json: () => Promise<unknown> }
  preview?: () => { ok: boolean; status?: number; json: () => Promise<unknown> }
} = {}) {
  return stubFetch((input, init) => {
    const method = init?.method ?? 'GET'
    if (input === '/api/content/status') return json({ data: CONTENT_STATUS })
    if (input === '/api/learning/status') return json({ data: LEARNING_STATUS_OWNER })
    if (input === '/api/content/catalog') return json({ data: EMPTY_SNAPSHOT })
    if (input === '/api/learning/evidence' && method === 'GET') return json({ data: queue })
    if (input === '/api/learning/evidence-preview') return preview ? preview() : json({ data: PREVIEW })
    if (input === '/api/learning/evidence-commit')
      return commit ? commit() : json({ data: { synced: true, idempotent: false, operationId: 'op-test-abc123', targets: [] } })
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

/** 待处理区与已同步区可能各有一条同名主题，这里统一用 findAllByText。 */
const openPreview = async () => {
  await screen.findAllByText('Java Hello World')
  fireEvent.click(screen.getByRole('button', { name: /③ 预览将写入的内容/ }))
  await screen.findByText('预览（尚未写入任何文件）')
}

const confirmWrite = () => {
  fireEvent.click(screen.getByLabelText(/我已核对以上将写入的内容/))
  fireEvent.click(screen.getByRole('button', { name: '确认写入' }))
}

const progressPending = () =>
  json(
    { error: '日志已保存，进度待合并：写入失败（EPERM）', code: 'progress_pending', details: { logSaved: true, progressPending: true } },
    409,
  )

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('M3 §5.2 证据回写：三类状态明确分开', () => {
  it('待处理 / 部分成功 / 已同步各自成区，区标题带不依赖颜色的说明文字', async () => {
    route({ queue: { pending: [stagedRecord()], synced: [syncedRecord] }, commit: progressPending })
    renderPanel()
    await openPreview()
    confirmWrite()
    await screen.findByText(/日志已保存，进度待合并/)

    expect(await screen.findByText('待处理 · 尚未写入资料库任何文件')).toBeTruthy()
    expect(screen.getByText('部分成功 · 已写入的步骤不会重复追加')).toBeTruthy()
    expect(screen.getByText('已同步 · 写入资料库并复核完成')).toBeTruthy()
    expect(screen.getByText(/1 条暂存 \/ 1 条已同步/)).toBeTruthy()
    // 同一主题在两个区各列一次，说明列表真的分开了
    expect(screen.getAllByText('Java Hello World').length).toBe(2)
  })

  it('已同步条目不进待处理勾选，也不提供删除入口', async () => {
    route({ queue: { pending: [stagedRecord()], synced: [syncedRecord] } })
    renderPanel()
    await screen.findByText(/op-done-1/)

    // 勾选框只有表单的「独立完成」+ 一条待处理条目
    expect(screen.getAllByRole('checkbox').length).toBe(2)
    expect(screen.getAllByRole('button', { name: /删除/ }).length).toBe(1)
  })

  it('已同步逐条给出复核时间、日志落点与 operationId，不再只有计数', async () => {
    route({ queue: { pending: [stagedRecord()], synced: [syncedRecord] } })
    renderPanel()
    await screen.findByText(/op-done-1/)

    expect(screen.getByText(/2026-09-18T02:00:00\.000Z/)).toBeTruthy()
    expect(screen.getByText(/2026-09-18-旧条目\.md/)).toBeTruthy()
    expect(screen.getAllByText(/复核时间/).length).toBe(1)
  })
})

describe('M3 §5.1 末段：语义状态双通道', () => {
  it('每个状态标识都同时给出图形与文字，不存在只靠颜色的状态', async () => {
    route({ queue: { pending: [stagedRecord()], synced: [syncedRecord] } })
    const { container } = renderPanel()
    await screen.findAllByText('Java Hello World')

    const marks = Array.from(container.querySelectorAll<HTMLElement>('.ewb-mark'))
    expect(marks.length).toBeGreaterThan(0)
    for (const mark of marks) {
      expect(mark.querySelector('svg')).not.toBeNull()
      expect((mark.querySelector('.ewb-mark-text')?.textContent ?? '').trim().length).toBeGreaterThan(0)
    }
    expect(screen.getAllByText('待处理').length).toBeGreaterThan(0)
    expect(screen.getAllByText('已同步').length).toBeGreaterThan(0)
  })

  it('状态色全部由本组件 css 承担：渲染结果里没有任何行内样式', async () => {
    route({ queue: { pending: [stagedRecord()], synced: [syncedRecord] } })
    const { container } = renderPanel()
    await screen.findAllByText('Java Hello World')
    expect(container.querySelector('[style]')).toBeNull()
  })

  it('一次性横幅只标「提示」，不冒领「已同步」：状态归队列区条目承担', async () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    route({ queue: { pending: [stagedRecord()], synced: [] } })
    renderPanel()
    await screen.findByText('Java Hello World')
    fireEvent.click(screen.getByRole('button', { name: /导出待保存 Markdown/ }))

    const body = await screen.findByText(/导出不等于已同步/)
    const banner = body.closest('.ewb-banner')
    expect(banner).not.toBeNull()
    expect(banner?.querySelector('.ewb-mark--result')).not.toBeNull()
    expect(banner?.querySelector('.ewb-mark--synced')).toBeNull()
    // 同步区此时仍是空态：没有任何条目冒领「已同步」
    expect(screen.getByText(/还没有已同步的证据/)).toBeTruthy()
    expect(screen.getAllByText('已同步').length).toBe(1) // 只剩分区标题本身的状态标识
  })

  it('编号只是装饰：带 aria-hidden，不会混进无障碍名称', async () => {    route({ queue: { pending: [stagedRecord()], synced: [] } })
    const { container } = renderPanel()
    await screen.findByText('Java Hello World')

    const nums = Array.from(container.querySelectorAll<HTMLElement>('.ewb-num'))
    expect(nums.length).toBeGreaterThan(0)
    for (const num of nums) expect(num.getAttribute('aria-hidden')).toBe('true')
    // 装饰编号不进入按钮可访问名称
    expect(screen.getByRole('button', { name: '暂存证据' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /③ 预览将写入的内容/ })).toBeTruthy()
  })
})

describe('M3 §5.2 细线差异预览', () => {
  it('目标清单走细线表格：序 + 目标 + 文件 + 文字状态（含指纹）', async () => {
    route({ queue: { pending: [stagedRecord()], synced: [] } })
    renderPanel()
    await openPreview()

    expect(screen.getByRole('columnheader', { name: '序' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: '当前状态' })).toBeTruthy()
    expect(screen.getByText('不存在（将新建）')).toBeTruthy()
    expect(screen.getByText(/已存在 · 指纹 abc12345/)).toBeTruthy()
    expect(screen.getAllByText('01').length).toBeGreaterThan(0)
  })

  it('逐字段差异表带列标题与「旧 −／新 +」文字前缀', async () => {
    route({ queue: { pending: [stagedRecord()], synced: [] } })
    renderPanel()
    await openPreview()

    expect(screen.getByRole('columnheader', { name: '变更字段' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: '写入前' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: '写入后' })).toBeTruthy()
    expect(screen.getAllByText('旧 −').length).toBeGreaterThan(0)
    expect(screen.getAllByText('新 +').length).toBeGreaterThan(0)
    // 前缀只是额外通道，原值/新值仍是独立文本，可搜索可读
    expect(screen.getByText('2026-09-14')).toBeTruthy()
    expect(screen.getByText('2026-09-19')).toBeTruthy()
  })

  it('日志小节按追加行呈现：每行一个 + 前缀，并说明不覆盖已有内容', async () => {
    route({ queue: { pending: [stagedRecord()], synced: [] } })
    const { container } = renderPanel()
    await openPreview()

    expect(screen.getByText('将追加到日志的小节')).toBeTruthy()
    expect(screen.getByText(/整段追加，不覆盖日志已有内容/)).toBeTruthy()
    const lines = Array.from(container.querySelectorAll<HTMLElement>('.ewb-diff-line'))
    expect(lines.length).toBe(3) // 两行内容 + 结尾换行产生的一行空白
    for (const line of lines) expect(line.querySelector('.ewb-sign--plus')?.textContent).toBe('+')
  })

  it('冲突表沿用同一套细线结构与文字前缀', async () => {
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
    await openPreview()
    confirmWrite()
    await screen.findByText('检测到第三方改动，未覆盖任何内容')

    expect(screen.getByRole('columnheader', { name: '冲突字段' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: '当前文件的值' })).toBeTruthy()
    expect(screen.getByText('2026-09-15')).toBeTruthy()
    expect(screen.getByRole('button', { name: /重新预览/ })).toBeTruthy()
    // 冲突块自己就带「旧 −」前缀。改前这条是 `toBeGreaterThan(1)`：多出来的那一个
    // 正是**失效预览**留在页面上的差异表（挂账③）。预览撤下后计数落到 1，
    // 同时补两条更强的断言：失效预览区与「确认写入」入口都不许再和冲突块并存。
    expect(screen.getAllByText('旧 −').length).toBe(1)
    expect(screen.getAllByText('冲突').length).toBeGreaterThan(0)
    expect(screen.queryByText('预览（尚未写入任何文件）')).toBeNull()
    expect(screen.queryByRole('button', { name: '确认写入' })).toBeNull()
  })
})

describe('M3 §5.4 加载 / 空 / 失败三态', () => {
  it('加载态：状态标识 + 文案 + 静态骨架行（骨架不承载信息）', async () => {
    // 队列读取**保持在途**：加载态必须由「这一次还没读回来」触发，
    // 不能再用读取失败来冒充加载态（挂账②修完后失败有自己的外观）。
    const pendingRead = new Promise<never>(() => undefined)
    stubFetch((input) => {
      if (input === '/api/content/status') return json({ data: CONTENT_STATUS })
      if (input === '/api/learning/status') return json({ data: LEARNING_STATUS_OWNER })
      if (input === '/api/content/catalog') return json({ data: EMPTY_SNAPSHOT })
      if (input === '/api/learning/evidence') return pendingRead
      return json({ error: 'x', code: 'x' }, 404)
    })
    const { container } = renderPanel()
    await screen.findByText(/正在读取暂存证据/)

    expect(screen.getAllByText('加载中').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.ewb-skeleton-bar').length).toBeGreaterThan(0)
    expect(container.querySelector('.ewb-skeleton')?.getAttribute('aria-hidden')).toBe('true')
    // 在途时不给出失败外观，也不给出空态外观。
    expect(screen.queryByText('失败')).toBeNull()
    expect(screen.queryByText(/没有待写回证据/)).toBeNull()
  })

  it('读取失败不再借加载态的外观：失败标识 + 服务端原因 + 重试入口（挂账②）', async () => {
    stubFetch((input) => {
      if (input === '/api/content/status') return json({ data: CONTENT_STATUS })
      if (input === '/api/learning/status') return json({ data: LEARNING_STATUS_OWNER })
      if (input === '/api/content/catalog') return json({ data: EMPTY_SNAPSHOT })
      if (input === '/api/learning/evidence') return json({ error: '暂存文件损坏', code: 'evidence_store_corrupt' }, 500)
      return json({ error: 'x', code: 'x' }, 404)
    })
    const { container } = renderPanel()
    const reason = await screen.findByText(/读取暂存证据失败：暂存文件损坏/)
    expect(reason.closest('.ewb-state--failed')).not.toBeNull()
    expect(container.querySelector('.ewb-state--failed .ewb-mark--failed')).not.toBeNull()
    expect(screen.getByRole('button', { name: /重新读取队列/ })).toBeTruthy()
    // 失败态与加载态、空态互斥：既不转圈也不谎称队列为空。
    expect(screen.queryByText(/正在读取暂存证据/)).toBeNull()
    expect(screen.queryByText(/没有待写回证据/)).toBeNull()
    expect(container.querySelectorAll('.ewb-skeleton-bar').length).toBe(0)
  })

  it('空态：两个队列区各有「空」标识，并重申暂存不等于写回', async () => {
    route()
    renderPanel()
    await screen.findByText(/没有待写回证据/)

    // 待处理区与已同步区各自成区，因此各自给出空态标识（不共用一条提示）
    expect(screen.getAllByText('空').length).toBe(2)
    expect(screen.getByText(/还没有已同步的证据/)).toBeTruthy()
  })

  it('失败态：标识文字「失败」与服务端理由同处一条横幅，且不伪装成预览', async () => {
    route({
      queue: { pending: [stagedRecord()], synced: [] },
      preview: () => json({ error: '这些证据已同步过；重复提交不会再次追加', code: 'already_synced' }, 409),
    })
    renderPanel()
    await screen.findByText('Java Hello World')
    fireEvent.click(screen.getByRole('button', { name: /③ 预览将写入的内容/ }))

    const reason = await screen.findByText(/这些证据已同步过/)
    expect(reason.closest('.ewb-banner--bad')).not.toBeNull()
    // 限定在横幅内部：#35 之后页面还有一条「事务账本读取失败」（本文件的桩没模拟那个端点，
    // 新区如实停在失败态），全页找「失败」会一次抓到两个标识。
    expect(reason.closest('.ewb-banner--bad')?.querySelector('.ewb-mark-text')?.textContent).toContain('失败')
    // 钉住「这一页现在确实有两个失败标识」：一个是本次写回失败的横幅，另一个是
    // 06 区如实报出的账本读取失败。数字变了要说得出为什么变，不许靠全页找文本。
    expect(screen.getAllByText('失败').length).toBe(2)
    expect(screen.queryByText('预览（尚未写入任何文件）')).toBeNull()
  })
})

describe('M3 写路径回归：改版不掉上下文', () => {
  it('部分成功保留 operationId 与事务说明，且不同时宣称已同步', async () => {
    let commits = 0
    route({
      queue: { pending: [stagedRecord()], synced: [] },
      commit: () => {
        commits += 1
        return progressPending()
      },
    })
    renderPanel()
    await openPreview()
    confirmWrite()
    await screen.findByText(/日志已保存，进度待合并/)

    expect(screen.getByText('op-test-abc123')).toBeTruthy()
    expect(screen.queryByText(/已写入并复核/)).toBeNull()
    expect(screen.queryByText('预览（尚未写入任何文件）')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /重试补齐/ }))
    await waitFor(() => expect(commits).toBe(2))
  })

  it('确认写入门槛不变：未勾选禁用、勾选后可用，预览免责说明在位', async () => {
    route({ queue: { pending: [stagedRecord()], synced: [] } })
    renderPanel()
    await openPreview()

    const button = screen.getByRole('button', { name: '确认写入' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText(/我已核对以上将写入的内容/))
    expect(button.disabled).toBe(false)
    expect(screen.getByText(/预览不会修改任何资料库文件/)).toBeTruthy()
  })
})

/**
 * §5.4 的两枚 CSS 钉子（44px 命中区、320px 换版）。
 *
 * 这两条结论都是在真浏览器里量出来的（tools/visual/probes.mjs + tmp-m6-visual 下的复核脚本），
 * jsdom 不做样式计算，所以这里不伪造「计算后」的断言，只把**规则本身**钉住：
 * 改坏了会让 CI 红，而不是等下一轮多视口矩阵才发现。
 */
type NodeFsModule = { readFileSync: (path: string, encoding: 'utf8') => string }
type NodePathModule = { resolve: (...parts: string[]) => string }
type NodeProcessModule = { cwd: () => string }

async function panelCss() {
  const fs = await vi.importActual<NodeFsModule>('node:fs')
  const path = await vi.importActual<NodePathModule>('node:path')
  const proc = await vi.importActual<NodeProcessModule>('node:process')
  const text = fs.readFileSync(path.resolve(proc.cwd(), 'src/components/evidence-writeback-view.css'), 'utf8')
  /** 注释里的示例与说明不参与判定（口径同 learning-workspace-view.m3.test.tsx）。 */
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 扁平收集「选择器 → 声明块」，本文件只用到一层嵌套，够用。 */
function cssRules(css: string) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: (m[1] ?? '').trim().replace(/\s+/g, ' '),
    block: m[2] ?? '',
  }))
}

describe('§5.4 CSS 钉子：44px 命中区与 320px 换版', () => {
  it('#51 复选框靠 appearance:none 自绘 + ::before 外扩撑命中区，两者缺一不可', async () => {
    const rules = cssRules(await panelCss())
    const box = rules.filter((r) => /input\[type='checkbox'\]$/.test(r.selector))
    const hit = rules.filter((r) => /input\[type='checkbox'\]::before$/.test(r.selector))

    expect(box.length).toBeGreaterThan(0)
    expect(hit.length).toBeGreaterThan(0)
    // 原生外观的复选框是**替换元素**，::before 根本不参与命中：
    // 实测 appearance:auto + ::before{inset:-11px} 时 computed style 报 44×44，
    // 但那个坐标上 elementFromPoint 给的是 MAIN.content-wrap，受信点击也不翻转 checked。
    for (const rule of box) expect(rule.block).toMatch(/appearance:\s*none/)
    for (const rule of hit) {
      expect(rule.block).toMatch(/content:\s*''/)
      expect(rule.block).toMatch(/position:\s*absolute/)
      // 22px 视觉框要外扩到 44px 命中区：每边至少 11px
      expect(rule.block).toMatch(/inset:\s*-11px/)
    }
  })

  it('#55 面板按钮允许换行：共享层的 nowrap 在 320px 会撑破 .evidence-actions', async () => {
    const rules = cssRules(await panelCss())
    const buttonRules = rules.filter((r) => /\.(primary-action|subtle-button)/.test(r.selector))
    expect(buttonRules.length).toBeGreaterThan(0)
    // 反例是真实量出来的：「导出待保存 Markdown」在 320px 下按钮 227.7px > 容器可用 211px，
    // nowrap 让它缩不下去，整页 scrollWidth 321。
    for (const rule of buttonRules) expect(rule.block).not.toMatch(/white-space:\s*nowrap/)
    expect(buttonRules.some((r) => /white-space:\s*normal/.test(r.block))).toBe(true)
  })
})
