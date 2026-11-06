// @vitest-environment jsdom
/**
 * M4 全站统一 · 正式进度与拥有者绑定契约测试（§5.2 第七行 + §10.1 + §5.4）
 *
 * 核心是**拥有者权限不得放宽**与**不确定必须保持不确定**：
 * 1. 非拥有者即使数据层返回了完整进度对象，界面也不得渲染任何私人进度与证据——
 *    只能看到原有那句未授权说明（这条把「渲染层不放宽权限」钉死）；
 * 2. `无法确认`、`0—1 级` 原样显示，不折算成整数；解析不了的块显示原文 +「结构待适配」；
 * 3. 环境核验日期与最近学习证据日期分行，不推导「环境齐全 = 阶段通过」；
 * 4. 五块分区（规范主题/原文位置/核验状态/同步时间/正式事实）与 ledger 表格语义；
 * 5. CSS 源码不变式。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VaultBindingPanel, VaultProgressCard } from './vault-progress-view'
import { ContentProviderHost, type ContentContextValue } from '../content/provider'
import type { LearningStatus, VaultProgress } from '../content/types'

/* ────────────────── CSS 原文（vitest 不处理 CSS，只能读盘核对） ────────────────── */

const fsSpecifier: string = 'node:fs'
const { readFileSync } = (await import(fsSpecifier)) as { readFileSync: (path: string, encoding: 'utf8') => string }
const pathSpecifier: string = 'node:path'
const { resolve } = (await import(pathSpecifier)) as { resolve: (...parts: string[]) => string }
const procSpecifier: string = 'node:process'
const { cwd } = (await import(procSpecifier)) as { cwd: () => string }

const cssText = readFileSync(resolve(cwd(), 'src/components/vault-progress-view.css'), 'utf8')
const cssCode = cssText.replace(/\/\*[\s\S]*?\*\//g, '')

function splitTopLevel(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let buffer = ''
  for (const char of value) {
    if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth -= 1
    if (char === ',' && depth === 0) {
      out.push(buffer.trim())
      buffer = ''
      continue
    }
    buffer += char
  }
  if (buffer.trim()) out.push(buffer.trim())
  return out
}

function selectorParts(css: string): string[] {
  const parts: string[] = []
  const pattern = /([^{}]+)\{/g
  let match: RegExpExecArray | null = pattern.exec(css)
  while (match) {
    const head = (match[1] ?? '').replace(/\s+/g, ' ').trim()
    if (!head.startsWith('@')) parts.push(...splitTopLevel(head))
    match = pattern.exec(css)
  }
  return parts.filter((part) => part !== '')
}

function declarationBlock(selector: string): string {
  const wanted = selector.replace(/\s+/g, ' ').trim()
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null = pattern.exec(cssText)
  while (match) {
    const head = (match[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').trim()
    if (head === wanted || splitTopLevel(head).includes(wanted)) return match[2] ?? ''
    match = pattern.exec(cssText)
  }
  return ''
}

function mediaBlock(query: string): string {
  const at = cssText.indexOf(`@media (${query})`)
  if (at === -1) return ''
  const open = cssText.indexOf('{', at)
  let depth = 0
  for (let index = open; index < cssText.length; index += 1) {
    const char = cssText[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return cssText.slice(open + 1, index)
    }
  }
  return ''
}

/* ────────────────────────────── 夹具 ────────────────────────────── */

const OWNER_STATUS: LearningStatus = {
  bound: true,
  isOwner: true,
  vaultId: 'ob-main',
  vaultMatches: true,
  publicContent: false,
  contentAccess: { allowed: true, reason: 'owner' },
  progressAccess: true,
  boundAt: '2026-09-18T00:00:00.000Z',
  recordCorrupt: false,
  notice: '资料库已绑定拥有者。',
}

const OTHER_STATUS: LearningStatus = {
  ...OWNER_STATUS,
  isOwner: false,
  contentAccess: { allowed: true, reason: 'public_content' },
  progressAccess: false,
  notice: '教材已放开给其他账户（正式进度仍仅拥有者可见）。',
}

const UNBOUND_STATUS: LearningStatus = { ...OWNER_STATUS, bound: false, isOwner: false, boundAt: null, progressAccess: false }

const PROGRESS: VaultProgress = {
  schemaVersion: 1,
  status: 'partial',
  source: { path: '资料库/进度追踪.md', fileHash: 'deadbeefcafebabe', parsedAt: '2026-09-20T01:00:00.000Z' },
  header: {
    structureUpdatedOn: '2026-09-10',
    environmentVerifiedOn: '2026-09-12',
    latestEvidenceOn: '2026-09-19',
    raw: '---',
  },
  snapshot: {
    items: [],
    currentStage: { label: '当前阶段', value: 'S2 并发基础', valueRaw: 'S2', evidence: '进度追踪 §当前' },
    stageProgress: null,
    stagePassable: { label: '阶段可通过', value: '', valueRaw: '', evidence: '' },
    nextStage: null,
    deadline: null,
    mainBlocker: { label: '主要阻塞', value: '缺少真实环境证据', valueRaw: '缺少真实环境证据', evidence: '日志 3 条' },
  },
  mastery: {
    rows: [
      { skill: '并发模型', level: { kind: 'numeric', value: 3, label: '3 级' }, levelRaw: '3', status: null, evidence: '证据 2 条' },
      { skill: '锁与竞态', level: { kind: 'range', low: 0, high: 1, label: '0—1 级' }, levelRaw: '0—1', status: '待补证据', evidence: '证据 0 条' },
      { skill: '内存模型', level: { kind: 'uncertain', label: '无法确认' }, levelRaw: '？', status: null, evidence: '原文未标' },
    ],
    raw: '| 并发模型 | 3 |',
    note: '> 等级口径来自资料库原文，不折算。',
  },
  nextActions: {
    rows: [
      { order: '1', action: '补齐线程观测记录', actionRaw: '补齐线程观测记录', deliverable: '一份观测日志', relation: 'S2', done: false },
      { order: '2', action: '', actionRaw: '整理竞态样例', deliverable: '', relation: '', done: true },
    ],
    raw: '- [ ] 补齐',
  },
  stages: { rows: [], raw: '' },
  environment: { rows: [], raw: '', conclusion: '' },
  handoff: { rows: [], raw: '' },
  unparsed: [{ key: '阶段表', scope: 'section', reason: '表头与解析器约定不一致', raw: '| 阶段 | 状态 |\n| S2 | 进行 |' }],
  readOnlyNotice: '只读投影：本页不写回资料库。',
}

function makeContent(overrides: Partial<ContentContextValue> = {}): ContentContextValue {
  return {
    learningStatus: OWNER_STATUS,
    /** Provider 的两档异步事实：默认「不在读取、没有错误」，各用例按需覆写。 */
    loading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    loadVaultProgress: vi.fn(async () => ({ ok: true, progress: PROGRESS }) as const),
    bindOwner: vi.fn(async () => ({ ok: true, message: '已绑定为拥有者' })),
    unbindOwner: vi.fn(async () => ({ ok: true, message: '已解除绑定' })),
    setVisibility: vi.fn(async () => ({ ok: true, message: '可见范围已更新' })),
    ...overrides,
  } as unknown as ContentContextValue
}

function fields(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('[data-vp-field]')].map((node) => ({
    key: node.getAttribute('data-vp-field') ?? '',
    label: node.querySelector('dt')?.textContent ?? '',
    value: node.querySelector('dd')?.textContent ?? '',
  }))
}

const FIVE_ZONES = ['topic', 'source', 'verification', 'sync', 'facts']

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('M4 拥有者绑定 · 权限入口不改语义', () => {
  it('§4 loading：没有学习状态且在读取中时挂占位，不整块塌陷、也不给猜测结论', () => {
    const { container } = render(
      <ContentProviderHost.Provider value={makeContent({ learningStatus: null, loading: true })}>
        <VaultBindingPanel />
      </ContentProviderHost.Provider>,
    )
    // 改版前这里是 `return null`：绑定面板在取数期间整块不存在，落地时把正文顶下去。
    expect(container.querySelector('[data-vp-panel="loading"]')).toBeTruthy()
    expect(container.querySelector('.vault-binding')).toBeTruthy()
    expect(container.querySelector('[data-vp-panel="loading"]')?.getAttribute('aria-busy')).toBe('true')
    const status = container.querySelector('.vault-progress-empty')
    expect(status?.getAttribute('role')).toBe('status')
    expect(container.textContent).toContain('正在读取资料库绑定状态')
    expect(status?.textContent).toContain('读取期间不显示推测出来的绑定结论')
    // 骨架只作装饰，朗读顺序里仍只有那句实话
    expect(container.querySelector('.view-skeleton__shape')?.getAttribute('aria-hidden')).toBe('true')
    // 未绑定 / 已绑定这两种结论一个都不许出现
    expect(container.textContent).not.toContain('资料库拥有者尚未绑定')
    expect(container.textContent).not.toContain('你是本资料库的拥有者')
    expect(container.querySelector('button')).toBeNull()
  })

  it('§4 error：读不到绑定状态说「读不到」，给重试并指向 Provider，不说成「尚未绑定」', async () => {
    const content = makeContent({
      learningStatus: null,
      loading: false,
      error: '内容服务返回 503：进度与绑定接口都不可用',
    })
    const { container } = render(
      <ContentProviderHost.Provider value={content}>
        <VaultBindingPanel />
      </ContentProviderHost.Provider>,
    )
    const box = container.querySelector('[data-vp-panel="error"]')
    expect(box).toBeTruthy()
    expect(container.textContent).toContain('读不到资料库绑定状态')
    const notice = box?.querySelector('.vault-progress-empty')
    expect(notice?.getAttribute('role')).toBe('status')
    expect(notice?.textContent).toContain('内容服务返回 503')
    expect(notice?.textContent).toContain('没读到和没有是两件事')
    expect(container.textContent).not.toContain('资料库拥有者尚未绑定')
    fireEvent.click(screen.getByRole('button', { name: /重试读取绑定状态/ }))
    expect(content.refresh).toHaveBeenCalledTimes(1)
  })

  it('未绑定：正式进度不对任何账户开放，绑定必须显式点击', () => {
    const content = makeContent({ learningStatus: UNBOUND_STATUS })
    const { container } = render(
      <ContentProviderHost.Provider value={content}>
        <VaultBindingPanel />
      </ContentProviderHost.Provider>,
    )
    expect(container.textContent).toContain('资料库拥有者尚未绑定')
    expect(container.textContent).toContain('正式进度（当前阶段、掌握矩阵、下一步）不对任何账户开放')
    expect(content.bindOwner).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '将当前账户设为资料库拥有者' }))
    expect(content.bindOwner).toHaveBeenCalledTimes(1)
    expect(fields(container).map((item) => item.key)).toEqual(FIVE_ZONES)
    expect(fields(container)[4]?.value).toBe('正式进度不对任何账户开放（含本账户）')
  })

  it('非拥有者：显示「看不到正式进度」，且没有放开/收紧与解除绑定的入口', () => {
    const content = makeContent({ learningStatus: OTHER_STATUS })
    const { container } = render(
      <ContentProviderHost.Provider value={content}>
        <VaultBindingPanel />
      </ContentProviderHost.Provider>,
    )
    expect(container.querySelector('.tag-verification')?.textContent).toBe('看不到正式进度')
    expect(container.textContent).toContain(OTHER_STATUS.notice)
    expect(screen.queryByRole('button', { name: /解除绑定/ })).toBeNull()
    expect(container.querySelector('input[type="checkbox"]')).toBeNull()
    expect(fields(container)[4]?.value).toBe('非拥有者：正式进度与学习日志不可读')
  })

  it('拥有者：教材可见范围开关与解除绑定都走既有接口', async () => {
    const content = makeContent({ learningStatus: OWNER_STATUS })
    render(
      <ContentProviderHost.Provider value={content}>
        <VaultBindingPanel />
      </ContentProviderHost.Provider>,
    )
    expect(screen.getByText('你是本资料库的拥有者')).toBeTruthy()
    const box = screen.getByRole('checkbox') as HTMLInputElement
    fireEvent.click(box)
    expect(content.setVisibility).toHaveBeenCalledWith(true)
    // 上一次操作结束后控件才解禁（忙态语义保留），再点解除绑定
    await waitFor(() => expect(box.disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: /解除绑定/ }))
    expect(content.unbindOwner).toHaveBeenCalledTimes(1)
    await screen.findByText('已解除绑定')
  })

  it('换过资料库时如实告警，不宣称跨库进度可用', () => {
    const content = makeContent({ learningStatus: { ...OWNER_STATUS, vaultMatches: false } })
    const { container } = render(
      <ContentProviderHost.Provider value={content}>
        <VaultBindingPanel />
      </ContentProviderHost.Provider>,
    )
    expect(container.textContent).toContain('当前连接的资料库与绑定记录不是同一个（换过资料库）')
    expect(container.textContent).toContain('正式进度不会跨库串用')
    expect(fields(container)[2]?.value).toContain('不一致')
    expect(container.querySelector('.vp-mark')?.getAttribute('data-vp-mark')).toBe('warn')
  })

  /**
   * §4 disabled 行：改版前这三个控件在忙态只被共享层 `.primary-action:disabled{opacity:.5}`
   * 压淡，界面完全没说「为什么按不了」。现在保留 disabled（真的不能点）同时补
   * `aria-disabled` + 一句渲染出来的条件说明，并用 aria-describedby 指过去。
   */
  it('§4 disabled：忙态的复选框与解除绑定都带 aria-disabled 和一句可见的条件说明', async () => {
    let release: (value: { ok: boolean; message: string }) => void = () => {}
    const content = makeContent({
      setVisibility: vi.fn(
        () => new Promise<{ ok: boolean; message: string }>((res) => { release = res }),
      ),
    })
    const { container } = render(
      <ContentProviderHost.Provider value={content}>
        <VaultBindingPanel />
      </ContentProviderHost.Provider>,
    )
    const box = screen.getByRole('checkbox') as HTMLInputElement
    fireEvent.click(box)
    await waitFor(() => expect(content.setVisibility).toHaveBeenCalledWith(true))

    const hint = container.querySelector<HTMLElement>('.vp-disabled-hint')
    expect(hint?.getAttribute('role')).toBe('status')
    expect(hint?.textContent).toContain('现在不能再用：上一步绑定操作还没返回')
    expect(box.disabled).toBe(true)
    expect(box.getAttribute('aria-disabled')).toBe('true')
    expect(box.getAttribute('aria-describedby')).toBe(hint?.id)
    const unbind = screen.getByRole('button', { name: /解除绑定/ })
    expect(unbind.getAttribute('aria-disabled')).toBe('true')
    expect(unbind.getAttribute('aria-describedby')).toBe(hint?.id)

    release({ ok: true, message: '可见范围已更新' })
    await waitFor(() => expect(box.disabled).toBe(false))
    expect(box.hasAttribute('aria-disabled')).toBe(false)
    expect(container.querySelector('.vp-disabled-hint')).toBeNull()
  })

  it('§4 disabled：未绑定那一档的绑定按钮同样说条件，不只把字压淡', async () => {
    let release: (value: { ok: boolean; message: string }) => void = () => {}
    const content = makeContent({
      learningStatus: UNBOUND_STATUS,
      bindOwner: vi.fn(() => new Promise<{ ok: boolean; message: string }>((res) => { release = res })),
    })
    const { container } = render(
      <ContentProviderHost.Provider value={content}>
        <VaultBindingPanel />
      </ContentProviderHost.Provider>,
    )
    const bind = screen.getByRole('button', { name: '将当前账户设为资料库拥有者' })
    expect(bind.hasAttribute('aria-disabled')).toBe(false)
    fireEvent.click(bind)
    await waitFor(() => expect(content.bindOwner).toHaveBeenCalled())
    const busyBind = screen.getByRole('button', { name: '绑定中…' })
    expect((busyBind as HTMLButtonElement).disabled).toBe(true)
    expect(busyBind.getAttribute('aria-disabled')).toBe('true')
    const hint = container.querySelector<HTMLElement>('.vp-disabled-hint')
    expect(busyBind.getAttribute('aria-describedby')).toBe(hint?.id)
    expect(hint?.textContent).toContain('现在不能再用')
    release({ ok: true, message: '已绑定' })
  })
})

describe('M4 正式进度 · 非拥有者读不到私人进度与证据', () => {
  it('数据层即便返回完整进度，非拥有者界面也不渲染任何私人事实', async () => {
    const content = makeContent({ learningStatus: OTHER_STATUS })
    const { container } = render(
      <ContentProviderHost.Provider value={content}>
        <VaultProgressCard />
      </ContentProviderHost.Provider>,
    )
    await waitFor(() => expect(content.loadVaultProgress).toHaveBeenCalled())
    expect(container.textContent).toContain(
      '未授权：正式进度与学习日志只对资料库拥有者可见。本页下方显示的都是本机历史活动，不是资料库事实。',
    )
    // 私密值一个都不许出现
    expect(container.textContent).not.toContain('S2 并发基础')
    expect(container.textContent).not.toContain('deadbeef')
    expect(container.textContent).not.toContain('并发模型')
    expect(container.textContent).not.toContain('补齐线程观测记录')
    expect(container.textContent).not.toContain('资料库/进度追踪.md')
    expect(container.querySelectorAll('table.vp-ledger')).toHaveLength(0)
    expect(fields(container).map((item) => item.key)).toEqual(FIVE_ZONES)
    expect(fields(container)[1]?.value).toContain('不返回资料库文件路径与指纹')
    expect(container.querySelector('.vp-mark')?.getAttribute('data-vp-mark')).toBe('unknown')
  })

  it('未绑定时说明暂不对任何账户开放，而不是空白或 0', () => {
    const content = makeContent({ learningStatus: UNBOUND_STATUS })
    const { container } = render(
      <ContentProviderHost.Provider value={content}>
        <VaultProgressCard />
      </ContentProviderHost.Provider>,
    )
    expect(container.textContent).toContain('资料库拥有者尚未绑定，正式进度暂不对任何账户开放。')
    expect(container.textContent).not.toMatch(/当前阶段[：:]\s*0/)
  })

  it('§4 loading：读取期间挂占位块，撤掉后不留任何进度值', async () => {
    let resolveLoad: (value: { ok: true; progress: VaultProgress }) => void = () => {}
    const content = makeContent({
      loadVaultProgress: vi.fn(
        () => new Promise<{ ok: true; progress: VaultProgress }>((res) => { resolveLoad = res }),
      ),
    })
    const { container } = render(
      <ContentProviderHost.Provider value={content}>
        <VaultProgressCard />
      </ContentProviderHost.Provider>,
    )
    await waitFor(() => expect(content.loadVaultProgress).toHaveBeenCalled())
    const loading = container.querySelector('[data-vp-card="loading"]')
    expect(loading?.querySelector('.vault-progress-empty')?.getAttribute('role')).toBe('status')
    expect(loading?.querySelector('.vault-progress-empty')?.textContent).toContain('正在读取进度追踪')
    expect(loading?.querySelector('.view-skeleton__shape')?.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelectorAll('table.vp-ledger')).toHaveLength(0)
    resolveLoad({ ok: true, progress: PROGRESS })
    await waitFor(() => expect(container.querySelectorAll('table.vp-ledger').length).toBe(3))
    expect(container.querySelector('[data-vp-card="loading"]')).toBeNull()
  })

  /** §4 error 行：三因合一那句话换成分档陈述；只有「读取失败」给重试。 */
  it('§4 error：HTTP 403 说成无权限，不给重试按钮（重试不会多出一个拥有者）', async () => {
    const content = makeContent({
      learningStatus: { ...OWNER_STATUS, isOwner: true, bound: true },
      loadVaultProgress: vi.fn(async () => ({ ok: false, message: '仅拥有者可读', status: 403 }) as const),
    })
    const { container } = render(
      <ContentProviderHost.Provider value={content}>
        <VaultProgressCard />
      </ContentProviderHost.Provider>,
    )
    await waitFor(() => expect(container.textContent).toContain('无权限：进度追踪只对资料库拥有者返回内容（HTTP 403：仅拥有者可读）'))
    expect(container.textContent).toContain('这里不会用 0 级或猜测值替代')
    expect(container.textContent).not.toContain('未绑定、未授权或进度追踪不可读')
    expect(screen.queryByRole('button', { name: /重试读取进度/ })).toBeNull()
  })

  it('§4 error：HTTP 409 说成未绑定并指向绑定面板，同样不给重试', async () => {
    const content = makeContent({
      loadVaultProgress: vi.fn(async () => ({ ok: false, message: '拥有者绑定缺失', status: 409 }) as const),
    })
    const { container } = render(
      <ContentProviderHost.Provider value={content}>
        <VaultProgressCard />
      </ContentProviderHost.Provider>,
    )
    await waitFor(() => expect(container.textContent).toContain('未绑定：服务端那边的拥有者绑定记录缺失'))
    expect(container.textContent).toContain('下一步：在上方绑定面板重新绑定')
    expect(screen.queryByRole('button', { name: /重试读取进度/ })).toBeNull()
  })

  it('§4 error：503 说成读取失败并给重试，重试真的再走一次接口', async () => {
    const loadVaultProgress = vi.fn(
      async () => ({ ok: false, message: '进度追踪文件读不出来', status: 503 }) as const,
    )
    const content = makeContent({ loadVaultProgress })
    const { container } = render(
      <ContentProviderHost.Provider value={content}>
        <VaultProgressCard />
      </ContentProviderHost.Provider>,
    )
    await waitFor(() => expect(container.textContent).toContain('读取失败：进度追踪文件读不出来（HTTP 503）'))
    expect(container.textContent).toContain('这是「读不到」，不是「没有进度」')
    expect(container.textContent).not.toContain('未绑定、未授权或进度追踪不可读')
    fireEvent.click(await screen.findByRole('button', { name: /重试读取进度/ }))
    expect(loadVaultProgress).toHaveBeenCalledTimes(2)
  })

  it('§4 error：绑定记录显示未绑定时优先说未绑定（本地事实先于接口码）', async () => {
    const content = makeContent({
      learningStatus: { ...OWNER_STATUS, bound: false },
      loadVaultProgress: vi.fn(async () => ({ ok: false, message: 'owner_unbound', status: 409 }) as const),
    })
    const { container } = render(
      <ContentProviderHost.Provider value={content}>
        <VaultProgressCard />
      </ContentProviderHost.Provider>,
    )
    await waitFor(() => expect(container.textContent).toContain('未绑定：资料库拥有者还没绑定'))
    expect(container.textContent).toContain('下一步：在上方「资料库拥有者绑定」面板里显式点一次绑定')
  })
})

describe('M4 正式进度 · 五块分区与 ledger 表格语义', () => {
  async function renderOwnerCard() {
    const content = makeContent()
    const result = render(
      <ContentProviderHost.Provider value={content}>
        <VaultProgressCard />
      </ContentProviderHost.Provider>,
    )
    await waitFor(() => expect(result.container.querySelectorAll('table.vp-ledger').length).toBe(3))
    return result
  }

  it('主 specs 依序给出五块，快照 specs 另列三条独立时间事实', async () => {
    const { container } = await renderOwnerCard()
    const specs = [...container.querySelectorAll('dl.vp-specs')]
    expect(specs).toHaveLength(2)
    expect(fields(container).slice(0, 5).map((item) => item.key)).toEqual(FIVE_ZONES)
    const dates = [...specs[1]!.querySelectorAll<HTMLElement>('[data-vp-field]')].map(
      (node) => node.querySelector('dt')?.textContent,
    )
    expect(dates).toEqual(['结构维护', '环境核验', '最近学习证据'])
    expect(container.textContent).toContain(
      '环境核验与最近学习证据是两件不同的事实：环境齐全不代表阶段通过，本界面不由二者推导任何结论。',
    )
  })

  it('核验状态只说结构解析结论，不写成已核实', async () => {
    const { container } = await renderOwnerCard()
    const verification = fields(container).find((item) => item.key === 'verification')
    expect(verification?.value).toContain('部分解析：1 处结构待适配，按原文展示')
    expect(verification?.value).toContain('结构解析结论不等同于知识正确性核验')
    expect(verification?.value).not.toContain('已核实')
    expect(verification?.value).not.toContain('已验证')
    expect(container.querySelector('.vp-mark')?.getAttribute('data-vp-mark')).toBe('warn')
    expect(container.textContent).toContain('进度追踪有 1 处结构待适配；这些块按原文展示，不推断数值。')
  })

  it('快照表：caption + 列表头 + 行表头，缺失项显示「原文未填写」', async () => {
    const { container } = await renderOwnerCard()
    const snapshot = container.querySelector('table.vp-ledger') as HTMLTableElement
    expect(snapshot.querySelector('caption')?.textContent).toBe('正式进度快照（原文口径），共 3 项')
    expect([...snapshot.querySelectorAll('thead th[scope="col"]')].map((th) => th.textContent)).toEqual([
      '次',
      '事实项',
      '原文值',
      '证据',
    ])
    const rows = [...snapshot.querySelectorAll('tbody tr')]
    expect(rows).toHaveLength(3)
    expect([...snapshot.querySelectorAll('tbody th[scope="row"]')].map((th) => th.textContent)).toEqual(['01', '02', '03'])
    expect(rows[1]?.textContent).toContain('原文未填写')
  })

  it('掌握矩阵：三张表都有 caption 与行表头，编号 01/02/03 与 02/03 小标题成文', async () => {
    const { container } = await renderOwnerCard()
    const tables = [...container.querySelectorAll('table.vp-ledger')]
    expect(tables).toHaveLength(3)
    for (const table of tables) {
      expect(table.querySelector('caption')?.className).toContain('vp-sr-only')
      expect(table.querySelectorAll('tbody th[scope="row"]').length).toBeGreaterThan(0)
    }
    expect(tables[1]?.querySelector('caption')?.textContent).toContain('不折算为整数')
    expect(tables[2]?.querySelector('caption')?.textContent).toContain('不重新排序')
    expect([...container.querySelectorAll('.vp-subtitle-idx')].map((el) => el.textContent)).toEqual(['02', '03'])
  })
})

describe('M4 正式进度 · 不确定保持不确定（原文口径）', () => {
  it('无法确认 / 0—1 级 原样显示，不折算成整数', async () => {
    const content = makeContent()
    const { container } = render(
      <ContentProviderHost.Provider value={content}>
        <VaultProgressCard />
      </ContentProviderHost.Provider>,
    )
    await waitFor(() => expect(container.querySelectorAll('table.vp-ledger').length).toBe(3))
    const matrix = [...container.querySelectorAll('table.vp-ledger')][1] as HTMLTableElement
    const cells = [...matrix.querySelectorAll('tbody .vp-cell-value')].map((cell) => cell.textContent)
    expect(cells).toEqual(['3 级', '0—1 级', '无法确认'])
    const marks = [...matrix.querySelectorAll<HTMLElement>('.vp-mark')].map((mark) => mark.getAttribute('data-vp-mark'))
    expect(marks).toEqual(['ok', 'warn', 'unknown'])
    for (const mark of matrix.querySelectorAll('.vp-mark')) {
      expect(mark.querySelector('.vp-mark-glyph')?.getAttribute('aria-hidden')).toBe('true')
      expect((mark.querySelector('.vp-mark-text')?.textContent ?? '').length).toBeGreaterThan(0)
    }
    expect(matrix.textContent).toContain('待补证据')
    expect(matrix.textContent).toContain('原文未标')
  })

  it('结构待适配的块显示原文，不显示猜测值', async () => {
    const content = makeContent()
    const { container } = render(
      <ContentProviderHost.Provider value={content}>
        <VaultProgressCard />
      </ContentProviderHost.Provider>,
    )
    await waitFor(() => expect(container.querySelectorAll('table.vp-ledger').length).toBe(3))
    const details = container.querySelector('.vp-unparsed') as HTMLDetailsElement
    expect(details.querySelector('summary')?.textContent).toContain('结构待适配的原文（1）')
    expect(details.querySelector('pre')?.textContent).toContain('| 阶段 | 状态 |')
  })

  it('下一步行动按原文顺序，空 action 回退 actionRaw，完成状态双通道', async () => {
    const content = makeContent()
    const { container } = render(
      <ContentProviderHost.Provider value={content}>
        <VaultProgressCard />
      </ContentProviderHost.Provider>,
    )
    await waitFor(() => expect(container.querySelectorAll('table.vp-ledger').length).toBe(3))
    const actions = [...container.querySelectorAll('table.vp-ledger')][2] as HTMLTableElement
    const orders = [...actions.querySelectorAll('tbody th[scope="row"]')].map((th) => th.textContent)
    expect(orders).toEqual(['1', '2'])
    expect([...actions.querySelectorAll('tbody .vp-cell-value')].map((cell) => cell.textContent)).toEqual([
      '补齐线程观测记录',
      '整理竞态样例',
    ])
    expect([...actions.querySelectorAll('.vp-mark-text')].map((el) => el.textContent)).toEqual([
      '原文未标完成',
      '原文标为已完成',
    ])
    expect(actions.textContent).toContain('原文未填写')
  })

  it('只读边界声明保留：本机历史活动不算等级、不写回、不因阅读提升', async () => {
    const content = makeContent()
    const { container } = render(
      <ContentProviderHost.Provider value={content}>
        <VaultProgressCard />
      </ContentProviderHost.Provider>,
    )
    await waitFor(() => expect(container.querySelectorAll('table.vp-ledger').length).toBe(3))
    expect(container.textContent).toContain('本机历史活动不算作资料库掌握等级')
    expect(container.textContent).toContain('本卡片只读，不提供写回，也不因导入或阅读而提升任何等级。')
    expect(container.textContent).toContain('只读投影：本页不写回资料库。')
    expect(container.textContent).toContain('等级口径来自资料库原文，不折算。')
  })
})

describe('M4 正式进度 · CSS 源码不变式', () => {
  it('样式表原文确实读到，且全局裸选择器数量为 0', () => {
    expect(cssText.length).toBeGreaterThan(3000)
    expect(selectorParts(cssCode).length).toBeGreaterThan(35)
    const bare = selectorParts(cssCode).filter(
      (selector) => !selector.startsWith('.cw-vault') && !selector.startsWith('.reduce-motion'),
    )
    expect(bare).toEqual([])
  })

  it('不声明 :root / html / body；零 !important；发光走别名、无渐变玻璃；圆角只有令牌档', () => {
    const selectors = selectorParts(cssCode)
    expect(selectors.some((selector) => /(^|[\s,])(:root|html|body)(\s|,|$)/.test(selector))).toBe(false)
    expect(cssCode).not.toContain('!important')
    // 科技档反转（tokens §4.5）：发光代替黑投影承担层级；仍不许裸字面量。
    const shadows = [...cssCode.matchAll(/box-shadow:\s*([^;]+)/g)].map((m) => m[1]!.trim())
    for (const value of shadows) {
      expect(/^var\(--vp-glow-(near|panel|inset)\)$/.test(value), `未走发光令牌：${value}`).toBe(true)
    }
    expect(cssCode).not.toMatch(/backdrop-filter|linear-gradient|radial-gradient|conic-gradient|text-shadow/)
    expect(cssCode).not.toMatch(/border-radius:\s*[0-9]/)
    expect(cssCode).not.toMatch(/outline(-style)?:\s*(none|0)/)
  })

  it('每个 --ds-* 令牌消费都带兜底值', () => {
    expect(cssCode.match(/var\(--ds-[a-z0-9-]+\)/g) ?? []).toEqual([])
  })

  it('正文 16px、行高 1.6–1.75；长中文与原文代码块不破版', () => {
    const root = declarationBlock('.cw-vault')
    expect(root).toContain('--vp-body: var(--ds-size-body, 16px)')
    const leading = Number(/--vp-leading:\s*var\(--ds-leading-body,\s*([\d.]+)\)/.exec(root)?.[1])
    expect(leading).toBeGreaterThanOrEqual(1.6)
    expect(leading).toBeLessThanOrEqual(1.75)
    expect(declarationBlock('.cw-vault :is(dt, dd, p, span, strong, em, td, th, caption, button, summary, li)')).toContain(
      'overflow-wrap: anywhere',
    )
    // 原文代码块横向滚动而不是折行挤压
    const pre = declarationBlock('.cw-vault .vp-unparsed pre')
    expect(pre).toContain('white-space: pre')
    expect(pre).toContain('overflow-x: auto')
  })

  it('触控 44px 与焦点轮廓覆盖按钮、复选框与 summary', () => {
    expect(declarationBlock('.cw-vault')).toContain('--vp-tap: var(--ds-tap-min, 44px)')
    expect(declarationBlock('.cw-vault .vp-btn')).toContain('min-height: var(--vp-tap)')
    expect(declarationBlock('.cw-vault .vp-toggle')).toContain('min-height: var(--vp-tap)')
    expect(declarationBlock('.cw-vault .vp-unparsed summary')).toContain('min-height: var(--vp-tap)')
    expect(declarationBlock('.cw-vault :is(button, a, summary, input, [tabindex]):focus-visible')).toContain(
      'var(--ds-focus-ring, rgba(220, 233, 251, 0.72))',
    )
  })

  /**
   * #76：上面那条测试长期是绿的，因为 `.vp-toggle` 有 `min-height: var(--vp-tap)` ——
   * 但 §5.4 量的是**目标自身**的命中区，label 的高度不算（`tools/visual/probes.mjs` 的 hitBox 不认），
   * 而这颗复选框只在「资料库已绑定 + 本账户是拥有者」那一档出现，个人页绑定态第一次进浏览器
   * 就量到 hit 18×18。所以这里不认 label，只认 input 自己的 appearance 与伪元素外扩量。
   */
  it('#76 拥有者可见的那颗复选框自带 44px 命中区，不靠 label 的高度充数', () => {
    const box = declarationBlock(".cw-vault .vp-toggle input[type='checkbox']")
    const hit = declarationBlock(".cw-vault .vp-toggle input[type='checkbox']::before")
    // 原生外观的复选框是替换元素，::before 根本不参与命中：只加伪元素而不去掉原生外观是假修
    expect(box).toMatch(/appearance:\s*none/)
    expect(box).toMatch(/position:\s*relative/)
    expect(hit).toMatch(/content:\s*''/)
    expect(hit).toMatch(/position:\s*absolute/)
    const visualPx = Number((box.match(/width:\s*(\d+)px/) || [])[1])
    const spreadPx = Math.abs(Number((hit.match(/inset:\s*(-?\d+)px/) || [])[1]))
    expect(visualPx).toBeGreaterThan(0)
    expect(spreadPx).toBeGreaterThan(0)
    expect(visualPx + spreadPx * 2).toBeGreaterThanOrEqual(44)
    // 自绘之后必须自己管状态：勾（::after，且不吃命中）与禁用态都在
    expect(declarationBlock(".cw-vault .vp-toggle input[type='checkbox']::after")).toMatch(/pointer-events:\s*none/)
    expect(declarationBlock(".cw-vault .vp-toggle input[type='checkbox']:disabled")).toMatch(/cursor:\s*not-allowed/)
  })

  it('§4 disabled 行：禁用不靠降透明度，改用描边样式 + 一句真实文字', () => {
    // 共享层 styles.css 的 `.primary-action/.subtle-button:disabled{opacity:.5}` 是根源，
    // 本页必须把它顶回 opacity:1，禁用感交给「虚线 / 点线」这一非颜色通道。
    const btn = declarationBlock('.cw-vault .vp-btn:disabled')
    expect(btn).toMatch(/opacity:\s*1/)
    expect(btn).toMatch(/border-style:\s*dashed/)
    expect(btn).toMatch(/cursor:\s*not-allowed/)
    const box = declarationBlock(".cw-vault .vp-toggle input[type='checkbox']:disabled")
    expect(box).toMatch(/opacity:\s*1/)
    expect(box).toMatch(/border-style:\s*dotted/)
    expect(box).not.toMatch(/opacity:\s*0\.\d/)
    // 条件说明是真渲染出来的字（有样式，不会掉进装饰档），不是 title 提示
    const hint = declarationBlock('.cw-vault .vp-disabled-hint')
    expect(hint).toContain('color: var(--vp-dim)')
    expect(hint).toContain('font-size: var(--vp-meta)')
  })

  it('§4 loading 行：占位块自带高度下限，骨架本身零动画声明', () => {
    expect(declarationBlock('.cw-vault .vp-loading')).toMatch(/min-height:\s*\d+(\.\d+)?em/)
  })

  it('等级三档靠边框样式区分，不使用场景色或状态色', () => {
    expect(declarationBlock('.cw-vault .vp-mark--ok')).toContain('border-style: solid')
    expect(declarationBlock('.cw-vault .vp-mark--warn')).toContain('border-style: dashed')
    expect(declarationBlock('.cw-vault .vp-mark--unknown')).toContain('border-style: dotted')
    for (const selector of ['.cw-vault .vp-mark--ok', '.cw-vault .vp-mark--warn', '.cw-vault .vp-mark--unknown']) {
      expect(declarationBlock(selector)).not.toMatch(/var\(--vp-accent\)|var\(--c-|var\(--ds-status-/)
    }
  })

  it('本页零持续动画，两条降级通道都真停止', () => {
    expect(cssCode).not.toMatch(/animation[^;]*\binfinite\b/)
    expect(cssCode).not.toMatch(/@keyframes/)
    const system = mediaBlock('prefers-reduced-motion: reduce')
    expect(system).toContain('animation: none')
    expect(system).toContain('transition: none')
    expect(
      declarationBlock(
        '.reduce-motion .cw-vault, .reduce-motion .cw-vault *, .reduce-motion .cw-vault *::before, .reduce-motion .cw-vault *::after',
      ),
    ).toContain('animation: none')
  })
})

describe('M4 正式进度 · 无障碍（axe-core）', () => {
  it('绑定面板 + 三张进度表无 axe 违规', async () => {
    const content = makeContent()
    const { container } = render(
      <ContentProviderHost.Provider value={content}>
        <VaultBindingPanel />
        <VaultProgressCard />
      </ContentProviderHost.Provider>,
    )
    await waitFor(() => expect(container.querySelectorAll('table.vp-ledger').length).toBe(3))
    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false }, 'target-size': { enabled: false } },
    })
    expect(results.violations.map((violation) => violation.id)).toEqual([])
  })
})
