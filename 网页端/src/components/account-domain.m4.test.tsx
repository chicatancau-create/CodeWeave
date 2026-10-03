// @vitest-environment jsdom
/**
 * M4 全站统一 · 账户域契约测试（个人中心 / 账户安全 / 数据与隐私）。
 *
 * 依据：§5.2 末行「账户、设置、隐私和弹窗：相同字体、按钮、表单、焦点和遮罩体系；
 * 保留改密、导出、恢复、按范围清除」+ §5.4 验收 + §11.2（部分失败不得显示成功）。
 *
 * 分工：既有的 data-privacy-view.test.tsx 守导入预览/写入的数据语义（一条未动、
 * 继续全绿）；本文件守 ① 改密的请求与四种结果文案，② 导出入口，③ 不可决定项在
 * 界面上「不给勾选」的结构证据，④ 按范围清除的部分失败如实上报，⑤ account-domain.css
 * 的 CSS 不变式与「不串改他人面板」的作用域证据。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '../hooks/use-auth'
import { STORAGE_KEYS } from '../utils/constants'
import { STORAGE_REGISTRY } from '../utils/storage-registry'
import { EXPORT_SCHEMA, EXPORT_VERSION, type ClearResult } from '../utils/local-data'
import { AccountSecurityView } from './account-security-view'
import { DataPrivacyView } from './data-privacy-view'
import { ProfileView } from './profile-view'

/**
 * 个人中心里嵌着两个他人组件（VaultProgressCard / EvidenceWritebackPanel），它们要
 * ContentProvider 与网络。本文件只测账户域自身的呈现与调用，故把两者替换为空壳；
 * 「不串改它们的面板」改由下方 CSS 作用域不变式来证明（不依赖运行时渲染）。
 */
vi.mock('./vault-progress-view', () => ({ VaultProgressCard: () => null }))
vi.mock('./evidence-writeback-view', () => ({
  EvidenceWritebackPanel: () => null,
  EvidenceWritebackView: () => null,
}))

const fsSpecifier: string = 'node:fs'
const { readFileSync } = (await import(fsSpecifier)) as {
  readFileSync: (path: string, encoding: 'utf8') => string
}
const moduleDir = (import.meta as unknown as { dirname?: string }).dirname ?? '.'
const cssText = readFileSync(`${moduleDir}/account-domain.css`, 'utf8')
const cssCode = cssText.replace(/\/\*[\s\S]*?\*\//g, '')

expect(cssText.length).toBeGreaterThan(4000)

function splitSelectors(prelude: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of prelude) {
    if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  return parts.map((part) => part.trim()).filter(Boolean)
}

function allSelectors(css: string): string[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: string[] = []
  const pattern = /([^{}]+)\{/g
  let match: RegExpExecArray | null = pattern.exec(code)
  while (match) {
    let prelude = (match[1] ?? '').replace(/}/g, '').trim()
    if (prelude.startsWith('@')) prelude = prelude.slice(prelude.lastIndexOf(')') + 1).trim()
    out.push(...splitSelectors(prelude))
    match = pattern.exec(code)
  }
  return out.filter((selector) => !selector.startsWith('@'))
}

function declarationBlock(selector: string): string {
  const wanted = selector.replace(/\s+/g, ' ').trim()
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null = pattern.exec(cssText)
  while (match) {
    const prelude = (match[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ')
    if (splitSelectors(prelude).some((part) => part.replace(/\s+/g, ' ').trim() === wanted)) return match[2] ?? ''
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

function reduceMotionImportantCount(): number {
  const system = (mediaBlock('prefers-reduced-motion: reduce').match(/!important/g) ?? []).length
  const classCount = [...cssCode.matchAll(/\.reduce-motion[^{]*\{([^{}]*)\}/g)]
    .reduce((total, match) => total + ((match[1]?.match(/!important/g) ?? []).length), 0)
  const combined = [...cssCode.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .filter((match) => splitSelectors(match[1] ?? '').some((part) => part.startsWith('.reduce-motion ')))
    .reduce((total, match) => total + ((match[2]?.match(/!important/g) ?? []).length), 0)
  return system + Math.max(classCount, combined)
}

const ACCOUNT = 'user-aa11'
const OTHER = 'user-bb22'

const user = {
  id: ACCOUNT,
  name: '验收账户',
  bio: '',
  contactType: 'phone',
  phone: '',
  email: '',
  createdAt: '2026-01-02T00:00:00.000Z',
} as unknown as AuthUser

const envelope = (value: unknown) => JSON.stringify({ schemaVersion: 3, savedAt: '2026-09-20T00:00:00.000Z', data: value })

function payloadFor(scope: string, data: Record<string, unknown>) {
  return JSON.stringify({
    schema: EXPORT_SCHEMA,
    version: EXPORT_VERSION,
    exportedAt: '2026-09-20T00:00:00.000Z',
    scope,
    categories: [{ base: STORAGE_KEYS.WORKSPACE, category: 'account', label: '课程工作区与代码草稿' }],
    data,
  })
}

function renderSecurity() {
  return render(<AccountSecurityView user={user} onLogout={vi.fn()} />)
}

function renderPrivacy(clearResult: ClearResult) {
  const onClearLocalData = vi.fn(() => clearResult)
  const onExportData = vi.fn()
  render(<DataPrivacyView user={user} onExportData={onExportData} onClearLocalData={onClearLocalData} />)
  return { onClearLocalData, onExportData }
}

function renderProfile(clearResult: ClearResult) {
  const onClearLocalData = vi.fn(() => clearResult)
  const onExportData = vi.fn()
  render(
    <ProfileView
      user={user}
      onUpdateUser={vi.fn()}
      onLogout={vi.fn()}
      onNavigateReviews={vi.fn()}
      stageMastery={[]}
      completedLessons={0}
      completedChallenges={0}
      dueCount={0}
      onExportData={onExportData}
      onClearLocalData={onClearLocalData}
      onNavigateSecurity={vi.fn()}
    />,
  )
  return { onClearLocalData, onExportData }
}

const okClear: ClearResult = { removed: true, keys: ['k'], failedKeys: [], failures: [], categories: 1 }
const partialClear: ClearResult = {
  removed: false,
  keys: [],
  failedKeys: [`code-canvas.mastery.v1:${ACCOUNT}`],
  failures: [{ key: `code-canvas.mastery.v1:${ACCOUNT}`, reason: 'quota' }],
  categories: 1,
}

async function chooseFile(text: string): Promise<void> {
  const input = (await screen.findByLabelText(/选择导出的 JSON 文件/)) as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File([text], 'export.json', { type: 'application/json' })] } })
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.documentElement.className = ''
})

describe('M4 账户域 · 改密（§5.2 保留行为，调用与判定不得改）', () => {
  it('三个字段齐全才发请求，请求体只带两个密码且带 credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    renderSecurity()
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'old-secret-1' } })
    fireEvent.change(screen.getByLabelText('新密码（至少 8 个字符）'), { target: { value: 'new-secret-2' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'new-secret-2' } })
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/auth/change-password')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(String(init.body))).toEqual({ currentPassword: 'old-secret-1', newPassword: 'new-secret-2' })
  })

  it('两次新密码不一致时不发请求，直接给可读错误', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderSecurity()
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'old-secret-1' } })
    fireEvent.change(screen.getByLabelText('新密码（至少 8 个字符）'), { target: { value: 'new-secret-2' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'different-3' } })
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))
    expect(fetchMock).not.toHaveBeenCalled()
    const status = screen.getByRole('alert')
    expect(status.textContent).toContain('两次输入的新密码不一致')
  })

  it('成功：清空三个输入并显示「其他设备已退出登录」（固定标识 + 文字）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    renderSecurity()
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'old-secret-1' } })
    fireEvent.change(screen.getByLabelText('新密码（至少 8 个字符）'), { target: { value: 'new-secret-2' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'new-secret-2' } })
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))

    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('密码已修改，其他设备已退出登录')
    expect(status.className).toContain('cw-account-status--ok')
    expect((screen.getByLabelText('当前密码') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('新密码（至少 8 个字符）') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('确认新密码') as HTMLInputElement).value).toBe('')
  })

  it('服务端拒绝时回显服务端原因，缺原因才回退到「修改失败」', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: '当前密码不正确' }) }))
    renderSecurity()
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'wrong-old' } })
    fireEvent.change(screen.getByLabelText('新密码（至少 8 个字符）'), { target: { value: 'new-secret-2' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'new-secret-2' } })
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))
    expect((await screen.findByRole('alert')).textContent).toContain('当前密码不正确')
  })

  it('断连时说明是网络问题并指向本地服务，不伪造成功', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    renderSecurity()
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'old-secret-1' } })
    fireEvent.change(screen.getByLabelText('新密码（至少 8 个字符）'), { target: { value: 'new-secret-2' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'new-secret-2' } })
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))
    const status = await screen.findByRole('alert')
    expect(status.textContent).toContain('网络错误，请确认本地服务已启动')
    expect(status.className).toContain('cw-account-status--error')
    expect(document.querySelector('.cw-account-status--ok')).toBeNull()
  })

  it('状态标识是「固定符号 + 文字」双通道，符号对读屏隐藏', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    renderSecurity()
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'old-secret-1' } })
    fireEvent.change(screen.getByLabelText('新密码（至少 8 个字符）'), { target: { value: 'new-secret-2' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'new-secret-2' } })
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))
    await screen.findByRole('status')
    const glyph = document.querySelector('.cw-account-status-glyph') as HTMLElement
    expect(glyph.getAttribute('aria-hidden')).toBe('true')
    expect((glyph.textContent ?? '').length).toBeGreaterThan(0)
    expect((document.querySelector('.cw-account-status-text')?.textContent ?? '').length).toBeGreaterThan(4)
  })

  it('删除账户仍写「尚未开放」，不伪造入口', () => {
    renderSecurity()
    expect(screen.getByText(/该功能尚未开放/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /删除账户/ })).toBeNull()
  })
})

describe('M4 账户域 · §4 disabled（禁用必须说条件，不能只降透明度）', () => {
  /**
   * 共享层 styles.css 的 `.primary-action:disabled` 只有 `opacity:.5`：按钮名字被压到读不出，
   * 界面也从没说什么条件下才解禁。两处保存/改密按钮都按同一形态补：
   * 保留 `disabled`（真的不能点）+ `aria-disabled` + 一句渲染出来的条件说明 + `aria-describedby`。
   */
  it('账户安全：三项没填齐时说明条件，填齐后说明撤下、按钮解禁', () => {
    const { container } = renderSecurity()
    const button = screen.getByRole('button', { name: '修改密码' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    const hint = container.querySelector<HTMLElement>('.cw-account-disabled-hint')
    // 禁用条件是**静态说明文字**，靠 aria-describedby 绑到按钮上；它不是活区域——
    // 这一屏的播报权属于改密结果那一行（role=status），再加一个只会互相抢播报。
    expect(hint?.hasAttribute('role')).toBe(false)
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(hint?.textContent).toContain('当前密码、新密码、确认新密码三项都必须填写')
    expect(button.getAttribute('aria-describedby')).toBe(hint?.id)

    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'old-password' } })
    fireEvent.change(screen.getByLabelText('新密码（至少 8 个字符）'), { target: { value: 'new-password' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'new-password' } })
    const ready = screen.getByRole('button', { name: '修改密码' }) as HTMLButtonElement
    expect(ready.disabled).toBe(false)
    expect(ready.hasAttribute('aria-disabled')).toBe(false)
    expect(ready.hasAttribute('aria-describedby')).toBe(false)
    expect(container.querySelector('.cw-account-disabled-hint')).toBeNull()
  })

  it('个人中心：保存忙态说明「在等上一次返回」，返回后撤下', async () => {
    let release: (value: null) => void = () => {}
    const onUpdateUser = vi.fn(() => new Promise<null>((res) => { release = res }))
    const { container } = render(
      <ProfileView
        user={user}
        onUpdateUser={onUpdateUser}
        onLogout={vi.fn()}
        onNavigateReviews={vi.fn()}
        stageMastery={[]}
        completedLessons={0}
        completedChallenges={0}
        dueCount={0}
        onExportData={vi.fn()}
        onClearLocalData={vi.fn()}
        onNavigateSecurity={vi.fn()}
      />,
    )
    const save = screen.getByRole('button', { name: /保存修改/ })
    expect(save.hasAttribute('aria-disabled')).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(onUpdateUser).toHaveBeenCalledTimes(1))

    const busy = screen.getByRole('button', { name: /保存中…/ }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)
    expect(busy.getAttribute('aria-disabled')).toBe('true')
    const hint = container.querySelector<HTMLElement>('.cw-account-disabled-hint')
    // 同上：条件说明走 describe，不占活区域；这一屏唯一的 status 是保存结果那一行。
    expect(hint?.hasAttribute('role')).toBe(false)
    expect(hint?.textContent).toContain('上一次保存还没返回')
    expect(busy.getAttribute('aria-describedby')).toBe(hint?.id)

    release?.(null)
    await waitFor(() => expect(busy.disabled).toBe(false))
    expect(container.querySelector('.cw-account-disabled-hint')).toBeNull()
  })

  it('CSS 不变式：账户域的禁用档 opacity 保持 1，改走虚线描边', () => {
    // declarationBlock 是按**单个**选择器逐段比对的（splitSelectors），把两个选择器并成一条
    // 字符串永远查不到，只会拿到空串——那是一条永远不会绿的断言，比假绿更难查。
    const btnDisabled = declarationBlock('.cw-account .cw-account-btn:disabled')
    const btnAria = declarationBlock(".cw-account .cw-account-btn[aria-disabled='true']")
    for (const block of [btnDisabled, btnAria]) {
      expect(block, '两种禁用写法都得同一档：不靠透明度').toMatch(/opacity:\s*1/)
      expect(block).toMatch(/border-style:\s*dashed/)
    }
    const hint = declarationBlock('.cw-account .cw-account-disabled-hint')
    expect(hint).toContain('color: var(--ca-ink-2)')
    expect(hint).toContain('font-size: var(--ca-meta)')
  })
})

describe('M4 账户域 · 导出与恢复入口（§5.2 保留行为）', () => {
  it('数据与隐私页与个人中心都提供导出入口，且都只调用注入的导出实现', () => {
    const privacy = renderPrivacy(okClear)
    fireEvent.click(screen.getByRole('button', { name: /导出学习数据/ }))
    expect(privacy.onExportData).toHaveBeenCalledTimes(1)
    cleanup()
    const profile = renderProfile(okClear)
    fireEvent.click(screen.getByRole('button', { name: /导出学习数据/ }))
    expect(profile.onExportData).toHaveBeenCalledTimes(1)
  })

  it('跨账户导出件：不可决定的行只有「不写入」文字，界面上不给勾选', async () => {
    renderPrivacy(okClear)
    await chooseFile(
      payloadFor(OTHER, { [`${STORAGE_KEYS.WORKSPACE}:${OTHER}`]: { savedAt: 'x', data: { lessonId: 'theirs' } } }),
    )
    expect(await screen.findByText(/属于其他账户/)).toBeTruthy()
    expect(screen.getByText('不写入')).toBeTruthy()
    expect(screen.queryByLabelText(/覆盖现有记录/)).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('可决定的行才给勾选（空位默认勾、冲突默认不勾）', async () => {
    localStorage.setItem(`${STORAGE_KEYS.WORKSPACE}:${ACCOUNT}`, envelope({ lessonId: 'current' }))
    renderPrivacy(okClear)
    await chooseFile(
      payloadFor(ACCOUNT, {
        [`${STORAGE_KEYS.WORKSPACE}:${ACCOUNT}`]: { savedAt: 'x', data: { lessonId: 'from-file' } },
        [`${STORAGE_KEYS.PROJECTS}:${ACCOUNT}`]: { savedAt: 'x', data: { a: 1 } },
      }),
    )
    const override = (await screen.findByLabelText(/覆盖现有记录/)) as HTMLInputElement
    const fresh = (await screen.findByLabelText(/^恢复/)) as HTMLInputElement
    expect(override.checked).toBe(false)
    expect(fresh.checked).toBe(true)
  })
})

describe('M4 账户域 · 按范围清除（部分失败不得显示成功）', () => {
  it('数据与隐私页：部分失败时留字面告警，不出现成功态', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { onClearLocalData } = renderPrivacy(partialClear)
    fireEvent.click(screen.getByRole('button', { name: /清除本机学习数据/ }))
    expect(onClearLocalData).toHaveBeenCalledTimes(1)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('清除未完成：1 项数据删除失败')
    expect(alert.textContent).toContain('已保留未删除的数据')
    expect(document.querySelector('.cw-account-status--ok')).toBeNull()
  })

  it('数据与隐私页：全部成功时不留下任何告警区', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPrivacy(okClear)
    fireEvent.click(screen.getByRole('button', { name: /清除本机学习数据/ }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('取消确认时一个键都不删（确认仍是清除的前置）', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    localStorage.setItem(`${STORAGE_KEYS.MASTERY}:${ACCOUNT}`, '{"kept":true}')
    const { onClearLocalData } = renderPrivacy(okClear)
    fireEvent.click(screen.getByRole('button', { name: /清除本机学习数据/ }))
    expect(onClearLocalData).not.toHaveBeenCalled()
    expect(localStorage.getItem(`${STORAGE_KEYS.MASTERY}:${ACCOUNT}`)).toBe('{"kept":true}')
  })

  it('个人中心：部分失败在账户操作区如实上报', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { onClearLocalData } = renderProfile(partialClear)
    fireEvent.click(screen.getByRole('button', { name: /清除本机学习数据/ }))
    expect(onClearLocalData).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert').textContent).toContain('清除未完成：1 项数据删除失败')
  })

  it('清除文案点明范围是「当前账户」，与设置弹窗的「全部账户」不混用', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPrivacy(okClear)
    fireEvent.click(screen.getByRole('button', { name: /清除本机学习数据/ }))
    expect(String(confirmSpy.mock.calls[0]![0])).toContain('只清当前账户')
    expect(String(confirmSpy.mock.calls[0]![0])).not.toContain('所有账户')
  })
})

describe('M4 账户域 · §5.2 体系与形态（account-domain.css 不变式）', () => {
  it('每条选择器都带账户域前缀：全局裸选择器 0 条', () => {
    const offenders = allSelectors(cssText).filter(
      (selector) =>
        !selector.startsWith('.cw-account') &&
        !selector.startsWith('.cw-security') &&
        !selector.startsWith('.cw-profile') &&
        !selector.startsWith('.cw-privacy') &&
        !selector.startsWith('.reduce-motion '),
    )
    expect(offenders).toEqual([])
  })

  it('不串改他人面板：个人中心内不用全局类名作右端主语', () => {
    const foreign = ['field-label', 'primary-action', 'subtle-button', 'danger-button', 'profile-overview-card', 'security-card-title']
    const profileSelectors = allSelectors(cssText).filter((selector) => selector.startsWith('.cw-profile'))
    for (const selector of profileSelectors) {
      const tail = selector.split(/\s+/).pop() ?? ''
      for (const name of foreign) {
        expect(tail).not.toContain(`.${name}`)
      }
    }
    // 自有类名必须真的存在，否则上面那条是空断言（个人中心的卡与表单都靠它们落形）
    const every = allSelectors(cssText)
    expect(every.some((selector) => selector.startsWith('.cw-profile') || selector.startsWith('.cw-account'))).toBe(true)
    expect(every.filter((selector) => selector.includes('.cw-account-card')).length).toBeGreaterThan(0)
    expect(every.filter((selector) => selector.includes('.cw-account-field')).length).toBeGreaterThan(0)
    expect(every.filter((selector) => selector.includes('.cw-account-btn')).length).toBeGreaterThan(0)
  })

  it('圆角只有 0 / 50% / 100px 三档，本域取 0 与圆环', () => {
    const radii = [...cssCode.matchAll(/border-radius:\s*([^;]+);/g)].map((match) => (match[1] ?? '').trim())
    expect(radii.length).toBeGreaterThan(0)
    for (const value of radii) expect(['var(--ca-radius)', 'var(--ca-circle)', 'var(--ds-shape-none, 0)']).toContain(value)
    expect(cssCode).not.toMatch(/border-radius:\s*[0-9]/)
  })

  it('黑场 + 发丝线 + 零投影零玻璃零泛光，颜色全部走带兜底的令牌', () => {
    const root = declarationBlock('.cw-account')
    expect(root).toContain('--ca-canvas: var(--ds-canvas, #000)')
    expect(root).toContain('--ca-hair: var(--ds-line-hair, rgba(220, 233, 251, 0.14))')
    expect(cssCode).not.toMatch(/backdrop-filter|linear-gradient|radial-gradient|text-shadow/)
    const shadows = [...cssCode.matchAll(/box-shadow:\s*([^;]+);/g)].map((match) => (match[1] ?? '').trim())
    for (const value of shadows) expect(value).toBe('var(--ds-shadow-panel, none)')
    expect(cssCode.match(/var\(--ds-[a-z0-9-]+\)/g) ?? []).toEqual([])
    // 场景点缀**色**不参与语义状态；长度档 --ds-scene-glow-ring（1.5px 描边环）不在此列
    expect(cssCode).not.toMatch(/--ds-scene-singularity|--ds-scene-nebula|--ds-scene-tides|--ds-scene-firstlight|--ds-scene-active|--accent/)
    expect(declarationBlock('.cw-profile .profile-large-avatar')).toContain('var(--ds-scene-glow-ring, 1.5px)')
    expect(declarationBlock('.cw-profile .profile-large-avatar')).toContain('border-radius: var(--ca-circle)')
    expect(declarationBlock('.cw-profile .mastery-bar span')).toContain('background: var(--ca-ink-2)')
  })

  it('正文 16px / 行高 1.7、控件与行 ≥44px、焦点可见、320px 有降级', () => {
    const root = declarationBlock('.cw-account')
    expect(root).toContain('--ca-body: var(--ds-size-body, 16px)')
    expect(root).toContain('--ca-leading: var(--ds-leading-body, 1.7)')
    expect(root).toContain('--ca-tap: var(--ds-tap-min, 44px)')
    expect(declarationBlock('.cw-account .cw-account-field input')).toContain('min-height: var(--ca-tap)')
    expect(declarationBlock('.cw-account .cw-account-btn')).toContain('min-height: var(--ca-tap)')
    expect(declarationBlock('.cw-account .cw-account-table th')).toContain('height: var(--ca-tap)')
    expect(declarationBlock('.cw-profile .mastery-map li')).toContain('min-height: var(--ca-tap)')
    expect(declarationBlock('.cw-account :is(a, button, input, select, textarea, summary, [tabindex]):focus-visible')).toContain(
      'var(--ds-focus-ring-width, 2px)',
    )
    expect(cssCode).not.toMatch(/outline(-style)?:\s*(none|0)/)
    expect(mediaBlock('max-width: 420px')).toContain('flex-direction: column')
  })

  it('旧 10–11px 档已抬起：本域不出现 10px/10.5px/11px 字号（M3 §8.3 挂账）', () => {
    expect(cssCode).not.toMatch(/font-size:\s*1[01](\.[0-9])?px/)
    expect(cssCode).not.toMatch(/var\(--ds-size-meta|var\(--ds-size-rail|var\(--ds-size-hud/)
  })

  it('无持续动画；两条减动效路径各自真停，!important 只出现在这两处', () => {
    expect(cssCode).not.toMatch(/infinite|@keyframes|animation:/)
    expect(mediaBlock('prefers-reduced-motion: reduce')).toContain('transition: none !important')
    expect(declarationBlock('.reduce-motion .cw-account :is(a, button, input, select, textarea, .cw-account-btn)')).toContain(
      'transition: none !important',
    )
    const total = (cssCode.match(/!important/g) ?? []).length
    expect(total).toBeGreaterThan(0)
    expect(total).toBe(reduceMotionImportantCount())
  })
})

describe('M4 账户域 · #95 数据与隐私台账的列地板', () => {
  it('「最后保存」列有地板且不拆词，nowrap 只出现在容器真会横滚的地方', () => {
    // 320 档普查实测这一列 97px：`2026/9/25 16:48:29` 被折成约 3 行。时间戳是原子值，给下限 + 不拆词。
    const time = declarationBlock('.cw-privacy .cw-ca-time')
    expect(time).toMatch(/min-width:\s*1[0-9]em/)
    expect(time).toContain('white-space: nowrap')
    // 地板写成 em，就要把换算基数一起钉住：这一格走 --ca-meta 13px ⇒ 10em = 130px ≥ 本库 120px 关键列下限
    expect(declarationBlock('.cw-account')).toContain('--ca-meta: 13px')
    // #55 的教训：nowrap 撑破过个人页 1px。这里只允许它建立在「容器自己横滚」之上。
    const scroll = declarationBlock('.cw-privacy .cw-privacy-scroll')
    expect(scroll).toMatch(/overflow-x:\s*auto/)
    expect(scroll).toContain('min-width: 0')
    expect(declarationBlock('.cw-privacy .cw-privacy-scroll > .cw-account-table')).toContain('min-width: 460px')
  })

  it('清单由存储注册表生成，类名真的挂在时间戳那一列上', () => {
    renderPrivacy(okClear)
    const rows = [...document.querySelectorAll('.cw-privacy .cw-account-table tbody tr')]
    const timed = [...document.querySelectorAll<HTMLTableCellElement>('.cw-privacy td.cw-ca-time')]
    // DATA-01 第 1 条：以前这张表是手写的第三份类别清单（漏两类、还给设备级键加了账户后缀）。
    expect(timed).toHaveLength(STORAGE_REGISTRY.length)
    expect(rows).toHaveLength(STORAGE_REGISTRY.length + 1) // +1：服务端 users.json 那一行
    for (const cell of timed) expect(cell.textContent?.trim()).not.toBe('')
    // 末行那句说明不是时间戳，不该被 nowrap 顶成一整行不拆的词
    expect(timed.every((cell) => !cell.textContent?.includes('由服务端'))).toBe(true)
    // 第 2 条：没写过的键说「未写入过」，不许说「从未保存」——那是在编造一个不存在的事实
    expect(document.body.textContent).not.toContain('从未保存')
    expect(document.body.textContent).toContain('未写入过')
    // 设备级那一行不许再被拼上账户后缀（旧版对 SETTINGS 也 scopedKey，于是恒显「从未保存」）
    const deviceRow = rows.find((row) => row.textContent?.includes('工作台偏好设置'))
    expect(deviceRow?.textContent).toContain('设备级，与本账户无关')
  })
})

describe('M4 账户域 · 无障碍结构（axe-core）', () => {
  it('账户安全页无 axe 违规', async () => {
    const { container } = renderSecurity()
    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false }, 'target-size': { enabled: false } },
    })
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([])
  })

  it('数据与隐私页（含导入预览表格）无 axe 违规', async () => {
    renderPrivacy(okClear)
    await chooseFile(payloadFor(ACCOUNT, { [`${STORAGE_KEYS.PROJECTS}:${ACCOUNT}`]: { savedAt: 'x', data: { a: 1 } } }))
    expect(await screen.findByText(/空位可恢复/)).toBeTruthy()
    const results = await axe.run(document.body, {
      rules: { 'color-contrast': { enabled: false }, 'target-size': { enabled: false }, region: { enabled: false } },
    })
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([])
  })
})

/**
 * #63：全站补测（50 格）量出 `security@320x844` 整页溢出 18px——
 * `SECTION.security-card` 右边界 338 而视口只有 320，父容器 `.security-layout` 右边界 304。
 * 根因是网格最小轨道写死 260px：`repeat(auto-fit, minmax(260px, 1fr))` 在 320 档
 * （内容宽约 226px）永远缩不回去。钉住「最小轨道必须带 min(...,100%)」这一条。
 */
describe('#63 账户安全页的网格在 320px 必须能缩进容器', () => {
  it('三张细线卡的最小轨道是 min(260px, 100%)，不是裸 260px', () => {
    const block = declarationBlock('.cw-security .security-layout')
    expect(block).toMatch(/grid-template-columns:\s*repeat\(\s*auto-fit\s*,\s*minmax\(\s*min\(\s*260px\s*,\s*100%\s*\)\s*,\s*1fr\s*\)\s*\)/)
    // 本文件里其余固定 px 最小轨道：140px 那档在 320 下仍小于可用宽度（50 格实测溢出 0），
    // 所以只禁「大于 320 档可用宽度」的这一种写法。
    const tooWide = [...cssCode.matchAll(/minmax\(\s*(\d{3,})px\s*,\s*1fr\s*\)/g)]
      .map((m) => Number(m[1]))
      .filter((px) => px > 240)
    expect(tooWide, `不该再有裸 px 且宽到缩不回去的最小轨道：${JSON.stringify(tooWide)}`).toEqual([])
  })
})

/**
 * 账户安全页上关于「会话」的三句说明，以前每一句都与 `server.mjs` 的实际行为不符：
 * 写的是「有效期 7 天 / 同一账号最多 500 个 / 淘汰最早登录的设备」，
 * 实况是按最近使用的**滑动**过期（:285-292）、500 是**整个实例**的上限（:306 判 sessions.size）、
 * 淘汰的是**最久未使用**（:307-310 配 :296-299 的 LRU 重排）。
 * 这一条钉住改后的措辞，并把三种错写法钉回不去——界面文案是用户唯一的知情来源。
 */
describe('会话说明文案必须与 server.mjs 的行为一致', () => {
  it('说清滑动过期、实例级上限与 LRU 淘汰，不再出现旧的三种错写法', () => {
    renderSecurity()
    const notes = [...document.querySelectorAll('.cw-account-list li')].map((li) => li.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    const all = notes.join('\n')
    expect(all).toContain('连续空闲满 7 天')
    expect(all).toContain('CODE_CANVAS_MAX_SESSIONS')
    expect(all).toContain('最久未使用')
    expect(all).toContain('不是每个账号各 500 个')
    expect(all).not.toContain('同一账号最多 500')
    expect(all).not.toContain('最早登录')
    expect(all).toContain('修改密码后，除当前设备外的所有会话立即失效')
  })
})
