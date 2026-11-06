// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './app'
import { SCHEMA_VERSION } from './utils/storage'

type MockResponse = { ok: boolean; status?: number; json: () => Promise<unknown> }
type FetchMock = (input: string, init?: RequestInit) => MockResponse | Promise<MockResponse>

function stubFetch(handler: FetchMock) {
  return vi.stubGlobal('fetch', vi.fn(handler as unknown as typeof fetch))
}

const testUser = {
  id: 'user-test-1',
  email: 'student@example.com',
  name: '小明',
  bio: '开始记录你的编程旅程。',
  createdAt: '2026-09-01T00:00:00.000Z',
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('App 入口', () => {
  it('未登录时渲染登录页，且可切换到注册', async () => {
    stubFetch((_input) => jsonResponse({ data: null }))

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )

    expect(await screen.findByText('登录你的工作区')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '注册新账户' }))
    expect(screen.getByText('创建学习账户')).toBeTruthy()
  })

  it('已登录时渲染工作台外壳与课程阶段数据', async () => {
    stubFetch((_input) => jsonResponse({ data: testUser }))

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )

    expect((await screen.findAllByText(/小明/)).length).toBeGreaterThan(0)
    // 学习路径视图：按**内容科目**选择（不是可执行语言）——HTML/CSS/Vue 等各自成组
    expect(screen.getByRole('heading', { name: '你的学习路径' })).toBeTruthy()
    // 13 个挑战阶段（A—M）体现在欢迎区文案
    expect(screen.getByText(/学习计划共 13 个阶段/)).toBeTruthy()
    const skipLink = screen.getByRole('link', { name: '跳到主内容' })
    const main = document.querySelector('main#main-content')
    expect(skipLink.getAttribute('href')).toBe('#main-content')
    expect(main?.getAttribute('tabindex')).toBe('-1')
    expect(document.querySelector('.main-content#main-content')).toBeNull()
  })

  it('认证接口失败时不白屏，回退到登录页', async () => {
    stubFetch((_input) => Promise.reject(new Error('network down')))

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )

    expect(await screen.findByText('登录你的工作区')).toBeTruthy()
  })

  it('进入挑战页显示全部 13 个关卡', async () => {
    stubFetch((_input) => jsonResponse({ data: testUser }))

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    await screen.findAllByText(/小明/)

    fireEvent.click(screen.getByRole('button', { name: /实战挑战/ }))
    // CHAL-01 分页：第 1 页渲染 12 张卡片，概览统计全部 13 关。
    // 01 号方案 §6 第 1 条把挑战页改成入口懒加载后，chunk 到不到位是异步的，
    // 「点一下就有 DOM」不再成立 —— 这里先等第一张卡片落地，再数分页与概览。
    // 等的是卡片本身（页面的产物），不是定时器，断言强度没有下降。
    // 超时放宽到 5s：并行跑全量时这一档要现场转译并装载 7 个模块，默认 1s 会误报
    // （单独跑本文件 581ms 就过）。放宽的是「等多久」，不是「等什么」。
    await screen.findByText('开发环境与基本操作', {}, { timeout: 5000 })
    expect(document.querySelectorAll('.stage-card')).toHaveLength(12)
    expect(screen.getByText('第 1 / 2 页')).toBeTruthy()
    expect(screen.getAllByText('开发环境与基本操作').length).toBeGreaterThan(0)
    expect(screen.getByText(/已完成 0 \/ 13/)).toBeTruthy()
  })
})

/**
 * 审计卡 NAV-01 / RUN-01 第 4 条的两处闸门。
 *
 * 标题这一处是**行为**断言：`activeLesson` 只在 closeWorkspace 里清空，切视图时它仍留着，
 * 所以以前人站在别的页面上，浏览器标签还写着上一节课的名字。
 * Ctrl+Enter 那一处只能是**源码不变式**：跑与不跑之后回到工作台，控制台都是同样的输出行，
 * jsdom 里观测不到差别（快捷键本身的行为由 use-execution.test.tsx 的 enabled 两条用例覆盖）。
 */
describe('离开学习路径视图时的两处闸门', () => {
  async function openLesson() {
    stubFetch((_input) => jsonResponse({ data: testUser }))
    render(<StrictMode><App /></StrictMode>)
    await screen.findAllByText(/小明/)
    const row = await waitFor(() => {
      const el = document.querySelector<HTMLButtonElement>('.desktop-unit-card')
      if (!el) throw new Error('学习路径里没有可点的课程行')
      return el
    })
    fireEvent.click(row)
    // 工作台现在是入口懒加载（01 号方案 §6 第 1 条），这一等要现场转译装载整棵子树；
    // 并行跑全量时默认 1s 会误报（单独跑 781ms 就过）。放宽的是「等多久」，判据不变。
    await waitFor(() => expect(document.querySelector('.cw-workspace')).toBeTruthy(), { timeout: 5000 })
  }

  it('切到别的视图后 document.title 不再挂着课程名', async () => {
    await openLesson()
    expect(document.querySelector('.learning-title'), '没进到工作台，标题断言无从谈起').toBeTruthy()
    const titleAtPath = document.title
    expect(titleAtPath).toMatch(/· Code Canvas$/)

    fireEvent.click(screen.getByRole('button', { name: /学习分析/ }))
    await waitFor(() => expect(document.querySelector('.cw-workspace')).toBeNull())
    expect(document.title).not.toBe(titleAtPath)
    expect(document.title).toContain('学习分析')
  })

  it('Ctrl+Enter 的启用条件与「工作台正在显示」是同一个判据', async () => {
    const fsSpecifier: string = 'node:fs'
    const { readFileSync } = (await import(fsSpecifier)) as { readFileSync: (path: string, encoding: 'utf8') => string }
    const moduleDir = (import.meta as unknown as { dirname?: string }).dirname ?? '.'
    const source = readFileSync(`${moduleDir}/app.tsx`, 'utf8')
    expect(source.length, '读不到 app.tsx 原文，下面两条断言就是假绿').toBeGreaterThan(1000)
    // useExecution 的第 4 个实参是 enabled：必须同时要求工作台正在显示（view === 'path'）
    expect(source).toMatch(/activeLesson !== null && view === 'path',/)
    // 标题与顶栏面包屑共用同一个闸门
    expect(source).toMatch(/const lessonInView = view === 'path' && activeLesson/)
  })

  /**
   * #94：详情在路上时那份空占位不许被存成草稿。
   *
   * 行为断言在 jsdom 里做不到确定性——它要的是「详情比 600ms 防抖晚到」这个竞态窗口，
   * 而本文件的 fetch 桩给的是内置课程（没有 contentId，也就没有详情请求）。
   * 所以这里钉源码不变式，真行为由取证段 editorperf 的「落位时代码面非空」那一格在浏览器里判。
   */
  it('资料课详情未落地的窗口里不出手保存快照', async () => {
    const fsSpecifier: string = 'node:fs'
    const { readFileSync } = (await import(fsSpecifier)) as { readFileSync: (path: string, encoding: 'utf8') => string }
    const moduleDir = (import.meta as unknown as { dirname?: string }).dirname ?? '.'
    const source = readFileSync(`${moduleDir}/app.tsx`, 'utf8')
    expect(source.length, '读不到 app.tsx 原文，这条断言就是假绿').toBeGreaterThan(1000)
    // ① 发起详情请求前先把这一课登记成「在路上」
    expect(source).toMatch(/detailPendingLessonId\.current = lesson\.id/)
    // ② 快照效果在该课在路上且代码为空时直接返回（不推进 revision，也就不进防抖保存）
    expect(source).toMatch(/detailPendingLessonId\.current === activeLesson\.id && code === ''/)
    // ③ 详情落地（含取不到详情的失败路径）后撤掉登记，不许留成永久抑制
    //（#105 之后这里是个块：同一格还要清掉给渲染用的镜像态，两条一起清才不会一半新一半旧）
    expect(source).toMatch(/if \(detailPendingLessonId\.current === lesson\.id\) \{\s*\n\s*detailPendingLessonId\.current = null/)
    // ④ #105：那一秒必须传到界面（只有 ref 的话不会重画，占位分支就是死代码）
    expect(source).toMatch(/setDetailPendingId\(lesson\.id\)/)
    expect(source).toMatch(/detailPending=\{detailPendingId === activeLesson\.id\}/)
  })
})

describe('#49 首屏加载门（§5.4 CLS ≤ 0.1 的修法）', () => {
  /** 门没开之前，取证脚本与 app.test 用来同步的侧栏不能出现，页面上只能有一句实话。 */
  it('首轮取数没结束时不画外壳，只挂加载态', async () => {
    const hanging = new Promise(() => {})
    stubFetch((input) => {
      if (String(input).includes('/api/auth/me')) return jsonResponse({ data: testUser })
      return { ok: true, status: 200, json: () => hanging } as MockResponse
    })

    render(<StrictMode><App /></StrictMode>)
    await new Promise((r) => setTimeout(r, 80))

    expect(document.querySelector('.app-shell'), '门没开就不该有外壳').toBeNull()
    expect(document.querySelector('.nav-item'), '侧栏是取证的同步点，门开着等于没门').toBeNull()
    const notice = document.querySelector('[role=status]')
    expect(notice, '加载态必须存在且带 role=status（§5.4 要验证加载态）').toBeTruthy()
    expect(notice?.textContent).toContain('正在读取本机教材与学习状态')
    vi.useRealTimers()
  })

  /** 预算的意义就在这：接口永不返回时也必须把界面还给用户，自救入口（登出/设置）都在壳里。 */
  it('接口卡死时到预算点放外壳出来，不留死屏', async () => {
    const hanging = new Promise(() => {})
    stubFetch((input) => {
      if (String(input).includes('/api/auth/me')) return jsonResponse({ data: testUser })
      return { ok: true, status: 200, json: () => hanging } as MockResponse
    })

    render(<StrictMode><App /></StrictMode>)
    await new Promise((r) => setTimeout(r, 80))
    expect(document.querySelector('.nav-item')).toBeNull()

    // BOOT_WAIT_BUDGET_MS = 2500，留出渲染余量再等一次
    await new Promise((r) => setTimeout(r, 2700))
    expect(document.querySelector('.app-shell'), '过了预算还挂着加载态就是死屏').toBeTruthy()
    expect(document.querySelector('.nav-item'), '外壳必须带侧栏回来').toBeTruthy()
  }, 15000)
})

/**
 * #77 的裁定（2026-09-25）：文档的 h1 归**页内标题**，壳层那句问候语不再是 h1。
 * jsdom 这层守的是「别悄悄退回去」；真浏览器那层的逐页 h1 判据在取证工具的 axtree 段里
 * （`tools/visual/visual-states.mjs`），两边各钉一次。
 */
describe('#77 每页恰好一个 h1，且它是页面自己的标题', () => {
  async function boot() {
    stubFetch((_input) => jsonResponse({ data: testUser }))
    render(<StrictMode><App /></StrictMode>)
    await screen.findAllByText(/小明/)
  }
  const h1s = () => [...document.querySelectorAll('h1')]

  it('学习路径：整页只有一个 h1 且是页级标题，问候语降成 <p>', async () => {
    await boot()
    expect(h1s()).toHaveLength(1)
    expect(h1s()[0]?.className).toContain('desktop-page-title')
    const greeting = document.querySelector('.welcome-row .welcome-greeting')
    expect(greeting?.tagName).toBe('P')
    expect(greeting?.textContent).toContain('小明')
  })

  it('工作台：h1 换成课名，标题序列不在 h1 与 h3 之间断档', async () => {
    await boot()
    const row = await waitFor(() => {
      const el = document.querySelector<HTMLButtonElement>('.desktop-unit-card')
      if (!el) throw new Error('学习路径里没有可点的课程行')
      return el
    })
    fireEvent.click(row)
    await waitFor(() => expect(document.querySelector('.cw-workspace')).toBeTruthy())
    expect(h1s()).toHaveLength(1)
    expect(document.querySelector('.learning-title h1')).toBeTruthy()
    // 不写死「第 2 个必须是 h2」：阅读区要是有主题原文才会有 h2，本用例的桩数据里没有。
    // 断的是 axe heading-order 那件事本身——标题层级不许比前一级跳超过一格。
    const levels = [...document.querySelectorAll('h1, h2, h3, h4')].map((h) => Number(h.tagName[1]))
    expect(levels.every((lv, i) => i === 0 || lv <= (levels[i - 1] ?? lv) + 1)).toBe(true)
  })
})

/**
 * LEARN-01 第 4 条的**接线**：`verifySubmission` / `rejectSubmission` 此前在全仓没有任何生产调用方
 * （只有 hooks.test.tsx 直接调函数本身），状态机五值齐、界面缺牙。
 * 这里刻意从界面点进去：证明 app.tsx 真把 hook 的两个函数递到了挑战页，
 * 并且「确认通过」会补一条 passed 的掌握度证据——两条通过路径同口径，
 * 而「标记不通过」不另造记录（不通过的事实由挑战记录自己承载）。
 */
describe('实战挑战的人工复核入口（LEARN-01 第 4 条接线）', () => {
  const CHALLENGE_KEY = `code-canvas.challenge-progress.v2:${testUser.id}`
  const MASTERY_KEY = `code-canvas.mastery.v1:${testUser.id}`

  beforeEach(() => {
    // CHAL-01 把「列表 / 详情 / 页码」存进 sessionStorage：不清就会带着上一条测试的详情页进来，
    // 这一条找不到卡片只找得到返回按钮。
    sessionStorage.clear()
  })

  const read = <T,>(key: string): T | null => {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  }
  const progressData = () =>
    read<{ data: Record<string, { status?: string; evidence?: string }> }>(CHALLENGE_KEY)?.data ?? {}
  const masteryEvidence = () =>
    read<{ data: Record<string, { evidence?: { passed: boolean; note: string; kind: string }[] }> }>(MASTERY_KEY)
      ?.data?.['stage-a']?.evidence ?? []

  async function openSubmissionTab() {
    stubFetch((_input) => jsonResponse({ data: testUser }))
    localStorage.setItem(
      CHALLENGE_KEY,
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        data: {
          'stage-a': {
            completedAt: '2026-09-13T00:00:00.000Z',
            evidence: '执行环境：Windows 11\n执行命令：java -version',
            status: 'submitted',
            tier: 'external',
          },
        },
      }),
    )
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    await screen.findAllByText(/小明/)
    fireEvent.click(screen.getByRole('button', { name: /实战挑战/ }))
    // 卡片的可访问名带序号与状态（`01 · A 关：…，已通过，难度…`），按文本认卡片更稳。
    const card = await waitFor(() => {
      const el = Array.from(document.querySelectorAll<HTMLElement>('.stage-card')).find((node) =>
        (node.textContent || '').includes('开发环境与基本操作'),
      )
      if (!el) throw new Error('挑战列表里没有 A 关卡片')
      return el
    })
    fireEvent.click(card)
    fireEvent.click(await screen.findByRole('tab', { name: /提交记录/ }))
  }

  it('确认通过：状态推到 verified，并补一条 passed 的掌握度证据', async () => {
    await openSubmissionTab()
    fireEvent.click(await screen.findByRole('button', { name: /确认通过（人工复核）/ }))
    await waitFor(() => expect(progressData()['stage-a']?.status).toBe('verified'))
    const entries = masteryEvidence()
    expect(entries.filter((item) => item.passed).length, '人工确认要计入掌握度，否则「计入完成数与掌握度」只兑了一半').toBe(1)
    expect(entries[0]?.note).toContain('人工复核通过')
    expect(entries[0]?.note).toContain('非本机自动验证')
  })

  it('标记不通过：状态退回 rejected，不凭空造一条掌握度记录', async () => {
    await openSubmissionTab()
    fireEvent.click(await screen.findByRole('button', { name: /标记不通过/ }))
    await waitFor(() => expect(progressData()['stage-a']?.status).toBe('rejected'))
    expect(masteryEvidence().length, '不通过的事实由挑战记录承载，记一条 passed:false 反而造出平行真相').toBe(0)
  })

  it('复核入口只对 submitted 存在：确认之后按钮撤下，不留重复入口', async () => {
    await openSubmissionTab()
    const button = await screen.findByRole('button', { name: /确认通过（人工复核）/ })
    fireEvent.click(button)
    await waitFor(() => expect(progressData()['stage-a']?.status).toBe('verified'))
    // 状态一改，整行复核按钮就不再画（app.tsx 里还有一道 `status !== 'submitted'` 的守卫：
    // 迟到或重复的点击不会写出第二条证据——练习次数是数出来的，多一条就是假数据）。
    expect(screen.queryByRole('button', { name: /确认通过（人工复核）/ })).toBeNull()
    fireEvent.click(button)
    expect(masteryEvidence().filter((item) => item.passed).length).toBe(1)
    expect(progressData()['stage-a']?.status).toBe('verified')
  })
})
