// @vitest-environment jsdom
/**
 * M4 全站统一 · 项目页契约测试（01 号方案 §3.4 挑战与项目 + §2.2 令牌 + §5 无障碍 + §8 验收清单）
 *
 * 本仓此前**没有** projects-view 的测试文件（自检命令里那一条即为空跑说明），
 * 这一批用例是把改版前后的行为钉住的第一份基线：
 * 1. 编号清单：项目与检查点都是真实文本编号，结构是 `<ol role="list"> + <li>`；
 * 2. 两个状态区：01 本机草稿（虚线、写「未快照」）/ 02 检查点快照（实线、写「可恢复」），
 *    检查点保存与恢复的回调口径一字不改（恢复前由 use-projects 自动留安全点）；
 * 3. 轻边界信息区与恒定语义色（删除=危险档，不跟随场景点缀）；
 * 4. §5.4：16px/1.7、44px、长中文项目名折行、长代码行横向滚动、320px、双路径真停。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectsView } from './projects-view'
import type { Project } from '../types/lesson'

const fsSpecifier: string = 'node:fs'
const { readFileSync } = (await import(fsSpecifier)) as {
  readFileSync: (path: string, encoding: 'utf8') => string
}
const moduleDir = (import.meta as unknown as { dirname?: string }).dirname ?? '.'
const cssText = readFileSync(`${moduleDir}/projects-view.css`, 'utf8')
const tsxText = readFileSync(`${moduleDir}/projects-view.tsx`, 'utf8')
const cssCode = cssText.replace(/\/\*[\s\S]*?\*\//g, '')

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()

/** 取某条规则的声明体：支持逗号选择器列表，并剥掉媒体块收尾的 `}`。 */
function rulesFor(selector: string): string[] {
  const wanted = normalize(selector)
  const bodies: string[] = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null = pattern.exec(cssText)
  while (match) {
    const selText = (match[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/}/g, ' ')
    const parts = selText.split(',').map((part) => normalize(part))
    if (normalize(selText) === wanted || parts.some((part) => part === wanted)) bodies.push(match[2] ?? '')
    match = pattern.exec(cssText)
  }
  return bodies
}

/** 找不到规则时返回哨兵串，避免「断言空字符串」假绿。 */
function ruleBody(selector: string): string {
  const bodies = rulesFor(selector)
  if (bodies.length === 0) return `__NO_RULE_FOR__${selector}__`
  return bodies[0]!
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

/** 括号外切分的逗号才算是选择器分隔符（:is(a, b) 内部不算）。 */
function allSelectors(): string[] {
  const splitTopLevel = (value: string): string[] => {
    const parts: string[] = []
    let depth = 0
    let current = ''
    for (const char of value) {
      if (char === '(' || char === '[') depth += 1
      else if (char === ')' || char === ']') depth -= 1
      if (char === ',' && depth === 0) {
        parts.push(current)
        current = ''
      } else {
        current += char
      }
    }
    parts.push(current)
    return parts
  }
  return [...cssCode.matchAll(/([^{}]+)\{/g)]
    .map((match) => normalize((match[1] ?? '').replace(/}/g, ' ')))
    .filter((selector) => selector.length > 0 && !selector.startsWith('@'))
    .flatMap((selector) => splitTopLevel(selector).map((part) => normalize(part)))
}

const file = (overrides: Partial<Project['files'][number]> = {}): Project['files'][number] => ({
  id: 'file-1',
  name: 'main.py',
  language: 'python',
  code: 'print("hello")',
  updatedAt: '2026-09-10T00:00:00.000Z',
  ...overrides,
})

const project = (overrides: Partial<Project> = {}): Project => ({
  id: 'p-1',
  name: '循环累加练习',
  description: '把 1—100 累加并留档',
  files: [file()],
  updatedAt: '2026-09-12T00:00:00.000Z',
  checkpoints: [],
  ...overrides,
})

function renderView(props: Partial<Parameters<typeof ProjectsView>[0]> = {}) {
  const projects = props.projects ?? [project(), project({ id: 'p-2', name: '一个特别长的中文项目名用来验证不破版的能力要求' })]
  const handlers = {
    onCreate: vi.fn(),
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onUpdate: vi.fn(),
    onSaveCheckpoint: vi.fn(),
    onRestoreCheckpoint: vi.fn(),
  }
  const view = render(
    <ProjectsView
      projects={projects}
      selectedProjectId={props.selectedProjectId ?? projects[0]?.id}
      {...handlers}
      {...props}
    />,
  )
  return { ...view, projects, ...handlers }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('M4 项目页 · 编号列表', () => {
  it('组件引入页面 CSS，样式表原文可读', () => {
    expect(tsxText).toContain("import './projects-view.css'")
    expect(cssText.length).toBeGreaterThan(4000)
  })

  it('项目清单是 ol[role=list] + li，编号为两位真实文本', () => {
    renderView()
    const list = document.querySelector('ol.project-list')
    expect(list?.getAttribute('role')).toBe('list')
    expect(document.querySelectorAll('.project-list-item')).toHaveLength(2)
    const first = screen.getByRole('button', { name: /循环累加练习/ })
    expect(first.querySelector('.project-card-no')?.textContent).toBe('01')
    expect(first.closest('li')).toBeTruthy()
    expect(first.getAttribute('aria-pressed')).toBe('true')
    expect(
      screen.getByRole('button', { name: /一个特别长的中文项目名/ }).querySelector('.project-card-no')?.textContent,
    ).toBe('02')
  })

  it('检查点也是编号清单，序号 + 时间 + 文件数 + 恢复动作成行', () => {
    renderView({
      projects: [
        project({
          checkpoints: [
            { id: 'cp-2', at: '2026-09-11T08:00:00.000Z', files: [file()] },
            { id: 'cp-1', at: '2026-09-09T08:00:00.000Z', files: [file(), file({ id: 'file-2' })] },
          ],
        }),
      ],
    })
    const rows = document.querySelectorAll('.checkpoint-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.querySelector('.checkpoint-no')?.textContent).toBe('01')
    expect(rows[1]!.querySelector('.checkpoint-no')?.textContent).toBe('02')
    expect(rows[1]!.textContent).toContain('2 个文件')
    expect(document.querySelector('.checkpoint-counter')?.textContent).toContain('已存 02 / 10')
  })

  it('CSS 不注入编号文字：无 counter，伪元素只画几何图形', () => {
    expect(cssCode).not.toMatch(/counter\(|counters\(/)
    const contents = [...cssCode.matchAll(/(?<![\w-])content:\s*([^;]+)/g)].map((match) => match[1]!.trim())
    expect(contents.every((value) => value === "''")).toBe(true)
  })
})

describe('M4 项目页 · 草稿与快照两个区', () => {
  it('01 本机草稿：写明即时写本机、未快照回不去', () => {
    renderView()
    const draft = document.querySelector('.project-zone--draft')
    expect(draft?.textContent).toContain('本机草稿')
    expect(draft?.textContent).toContain('未快照前回不到旧版本')
    expect(draft?.textContent).toContain('草稿状态')
    expect(draft?.textContent).toContain('1 个文件 · 1 行')
    expect(draft?.textContent).toContain('这部分只存在本机')
    // 编辑器与命名/描述输入都属于草稿区
    expect(draft?.querySelector('.project-code')).toBeTruthy()
    expect(draft?.querySelector('.challenge-submit')).toBeNull()
  })

  it('02 检查点快照：写明可恢复，并预告恢复前自动留安全点', () => {
    renderView()
    const zone = document.querySelector('.project-zone--snapshot')
    expect(zone?.textContent).toContain('检查点快照')
    expect(zone?.textContent).toContain('本地保留最近 10 个')
    expect(zone?.textContent).toContain('恢复前会先用当前草稿自动留一个安全点')
    expect(zone?.textContent).toContain('还没有检查点')
  })

  it('两个区靠形状分：草稿虚线边、快照实线边', () => {
    expect(ruleBody('.projects-view .project-zone--draft')).toContain('border-style: dashed')
    expect(ruleBody('.projects-view .project-zone--snapshot')).toContain('border-style: solid')
  })

  it('保存检查点：只上抛 projectId，快照口径由 use-projects 负责（不改判定语义）', () => {
    const { onSaveCheckpoint, projects } = renderView()
    fireEvent.click(screen.getByRole('button', { name: /保存检查点/ }))
    expect(onSaveCheckpoint).toHaveBeenCalledTimes(1)
    expect(onSaveCheckpoint.mock.calls[0]).toEqual([projects[0]!.id])
  })

  it('恢复检查点：把 projectId 与所选 checkpointId 原样上抛', () => {
    const { onRestoreCheckpoint } = renderView({
      projects: [
        project({
          checkpoints: [
            { id: 'cp-newer', at: '2026-09-11T08:00:00.000Z', files: [file()] },
            { id: 'cp-older', at: '2026-09-09T08:00:00.000Z', files: [file()] },
          ],
        }),
      ],
    })
    const rows = document.querySelectorAll('.checkpoint-row')
    fireEvent.click(rows[1]!.querySelector('button')!)
    expect(onRestoreCheckpoint).toHaveBeenCalledTimes(1)
    expect(onRestoreCheckpoint.mock.calls[0]).toEqual(['p-1', 'cp-older'])
  })

  it('编辑文件代码：只替换该文件并刷新 updatedAt，其余字段与文件原样上抛', () => {
    const { onUpdate } = renderView({
      projects: [project({ files: [file({ id: 'f-a' }), file({ id: 'f-b', code: 'x = 1' })] })],
    })
    const editors = screen.getAllByRole('textbox')
    fireEvent.change(editors[editors.length - 1]!, { target: { value: 'y = 2' } })
    expect(onUpdate).toHaveBeenCalledTimes(1)
    const [projectId, updates] = onUpdate.mock.calls[0]!
    expect(projectId).toBe('p-1')
    const files = (updates as { files: Project['files'] }).files
    expect(files).toHaveLength(2)
    expect(files[0]!.code).toBe('print("hello")')
    expect(files[1]!.code).toBe('y = 2')
    expect(new Date(files[1]!.updatedAt).getTime()).toBeGreaterThan(new Date(files[0]!.updatedAt).getTime())
  })

  it('重命名与描述同样走 onUpdate（长度上限未动）', () => {
    const { onUpdate } = renderView()
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '新名字' } })
    fireEvent.change(screen.getByLabelText('项目描述'), { target: { value: '新描述' } })
    expect(onUpdate.mock.calls.map((call) => call[1])).toEqual([{ name: '新名字' }, { description: '新描述' }])
  })

  it('删除仍需二次确认；取消则不上抛（确认口径未改）', () => {
    const { onDelete } = renderView()
    vi.stubGlobal('confirm', vi.fn(() => false))
    fireEvent.click(screen.getByRole('button', { name: /删除/ }))
    expect(onDelete).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
    vi.stubGlobal('confirm', vi.fn(() => true))
    fireEvent.click(screen.getByRole('button', { name: /删除/ }))
    expect(onDelete).toHaveBeenCalledWith('p-1')
  })

  it('复制上抛整个项目对象；新建带上所选语言', () => {
    const { onDuplicate, onCreate, projects } = renderView()
    fireEvent.click(screen.getByRole('button', { name: /复制/ }))
    expect(onDuplicate).toHaveBeenCalledWith(projects[0])
    fireEvent.change(screen.getByLabelText('新项目语言'), { target: { value: 'java' } })
    fireEvent.click(screen.getByRole('button', { name: /新建项目/ }))
    expect(onCreate).toHaveBeenCalledWith('java')
  })

  it('没有项目时保留原空态文案', () => {
    renderView({ projects: [], selectedProjectId: undefined })
    expect(screen.getByText('还没有保存的项目')).toBeTruthy()
    expect(screen.getByText('创建第一个项目开始练习')).toBeTruthy()
    expect(document.querySelector('.project-zone')).toBeNull()
  })
})

describe('M4 项目页 · 轻边界信息区与恒定语义色', () => {
  it('黑场 + 发丝线分行，卡片不铺玻璃底', () => {
    expect(ruleBody('.projects-view')).toContain('background: var(--pv-canvas)')
    const list = ruleBody('.projects-view .project-list')
    expect(list).toContain('border-top: var(--pv-hair-width) solid var(--pv-hair)')
    expect(ruleBody('.projects-view .project-list-item')).toContain(
      'border-bottom: var(--pv-hair-width) solid var(--pv-hair)',
    )
    const card = ruleBody('.projects-view .project-card')
    expect(card).toContain('background: none')
    expect(card).toContain('box-shadow: var(--pv-glow-inset)')
  })

  it('无渐变 / 无模糊；box-shadow 一律走 --pv-glow-*', () => {
    expect(cssCode).not.toMatch(/backdrop-filter|linear-gradient|radial-gradient|conic-gradient|text-shadow/)
    const shadows = [...cssCode.matchAll(/box-shadow:\s*([^;]+)/g)].map((match) => match[1]!.trim())
    expect(shadows.length).toBeGreaterThan(0)
    // 科技档反转（tokens §4.5）：深色画布上黑投影等于没有，层级改由冷色外发光承担。
    // 约束不放松 —— 不允许裸投影字面量，每条只允许落到 --pv-glow-* 或共享的 --ds-glow-*。
    for (const value of shadows) {
      expect(/^var\(--(pv|ds)-glow-(near|panel|inset)(,\s*[^;]+)?\)$/.test(value), `未走发光令牌：${value}`).toBe(true)
    }
  })

  it('圆角只有 0 / 50% / 100px 三档，且全部经令牌', () => {
    const radii = [...cssCode.matchAll(/border-radius:\s*([^;]+)/g)].map((match) => match[1]!.trim())
    const allowed = new Set([
      'var(--ds-radius-panel, 0)',
      'var(--ds-radius-control, 0)',
      'var(--ds-shape-none, 0)',
      'var(--ds-shape-circle, 50%)',
      'var(--ds-shape-pill, 100px)',
    ])
    expect(radii.length).toBeGreaterThan(3)
    expect(radii.filter((value) => !allowed.has(value))).toEqual([])
  })

  it('删除 = 恒定危险色，快照说明 = 恒定信息色，都不指场景点缀', () => {
    const danger = ruleBody('.projects-view .detail-actions .danger-button')
    expect(danger).toContain('var(--pv-bad)')
    expect(danger).not.toMatch(/--ds-scene|--pv-scene|--c-|--accent/)
    expect(ruleBody('.projects-view')).toContain('--pv-bad: var(--ds-status-danger')
    expect(ruleBody('.projects-view')).toContain('--pv-info: var(--ds-status-info')
    expect(ruleBody('.projects-view .checkpoint-note')).toContain('var(--pv-info)')
  })

  it('每个 --ds-* 令牌消费都带兜底值；没有任何全局裸选择器', () => {
    expect(cssCode.match(/var\(--ds-[a-z0-9-]+\)/g) ?? []).toEqual([])
    const unscoped = allSelectors().filter(
      (selector) =>
        !selector.startsWith('.projects-view') &&
        !selector.startsWith('.reduce-motion .projects-view') &&
        !selector.startsWith('.projects-view.reduce-motion'),
    )
    expect(unscoped).toEqual([])
  })
})

describe('M4 项目页 · §5.4 可读性与降级', () => {
  it('正文 16px / 行高 1.7，触控 44px，焦点可见且不取消 outline', () => {
    const root = ruleBody('.projects-view')
    expect(root).toContain('--pv-body: var(--ds-size-body, 16px)')
    expect(root).toContain('--pv-leading: var(--ds-leading-body, 1.7)')
    expect(root).toContain('--pv-tap: var(--ds-tap-min, 44px)')
    for (const selector of [
      '.projects-view .project-card',
      '.projects-view .detail-actions .subtle-button',
      '.projects-view .detail-actions .danger-button',
      '.projects-view .checkpoint-row .subtle-button',
      '.projects-view .project-create .primary-action',
      '.projects-view .setting-select',
    ]) {
      expect(ruleBody(selector)).toContain('var(--pv-tap)')
    }
    expect(ruleBody('.projects-view :focus-visible')).toContain('var(--ds-focus-ring, rgba(220, 233, 251, 0.72))')
    expect(cssCode).not.toMatch(/outline(-style)?:\s*(none|0)\b/)
  })

  it('长中文项目名折行不省略；长代码行横向滚动不挤压', () => {
    expect(ruleBody('.projects-view .project-card strong')).toContain('white-space: normal')
    expect(cssCode).not.toMatch(/text-overflow:\s*ellipsis/)
    expect(cssCode).not.toMatch(/white-space:\s*nowrap/)
    const code = ruleBody('.projects-view .project-code')
    expect(code).toContain('overflow-x: auto')
    expect(code).toContain('white-space: pre')
    expect(code).toContain('var(--editor-font-size, 13px)')                    /* 编辑器保留用户字号 */
    expect(ruleBody('.projects-view :is(h1, h2, h3, p, span, li, label, strong, small, code, button)')).toContain(
      'overflow-wrap: anywhere',
    )
  })

  it('320px 最小宽度有专门降级（检查点行改两列、留白收紧）', () => {
    const block = mediaBlock('max-width: 360px')
    expect(block).toContain('--pv-pad: 12px')
    expect(block).toContain('grid-template-columns: auto minmax(0, 1fr)')
  })

  it('系统 prefers-reduced-motion 与根类 .reduce-motion 都真停', () => {
    const system = mediaBlock('prefers-reduced-motion: reduce')
    expect(system).toContain('animation: none !important')
    expect(system).toContain('transition: none !important')
    const scoped = ruleBody('.reduce-motion .projects-view *')
    expect(scoped).toContain('animation: none !important')
    expect(cssCode).not.toMatch(/infinite/)
    expect(cssCode.match(/@keyframes/g) ?? []).toEqual([])
  })

  it('!important 只出现在降级块内', () => {
    const cut = cssCode.indexOf('@media (prefers-reduced-motion')
    expect(cut).toBeGreaterThan(0)
    expect(cssCode.slice(0, cut)).not.toContain('!important')
  })
})

describe('M4 项目页 · 无障碍（axe-core）', () => {
  const axeRules = {
    'color-contrast': { enabled: false },
    'target-size': { enabled: false },
    // 项目详情是清单的下钻视图，h1 只在页眉；页面级最佳实践项由浏览器复核承担
    'landmark-one-main': { enabled: false },
    region: { enabled: false },
  }

  it('列表 + 详情（含检查点两行）无 axe 违规', async () => {
    const { container } = renderView({
      projects: [
        project({
          checkpoints: [
            { id: 'cp-2', at: '2026-09-11T08:00:00.000Z', files: [file()] },
            { id: 'cp-1', at: '2026-09-09T08:00:00.000Z', files: [file(), file({ id: 'file-2' })] },
          ],
        }),
      ],
    })
    const results = await axe.run(container, { rules: axeRules })
    expect(results.violations.map((violation) => `${violation.id}: ${violation.description}`)).toEqual([])
  })
})

/**
 * 01 号方案 §4 的 error 行 + §2.1 状态层：写不进本机时要说出口，
 * 并且语义色之外还要有文字与边界（不只靠颜色承载）。
 * 失败原因由 `useProjects` 统一给出，本组件只负责把它说出来并给一次重试。
 */
describe('M4 项目页 · 落盘失败那一块', () => {
  const FAILURE = '这台设备的浏览器没有收下这次改动（本地存储配额已满，或浏览器禁止写入站点数据）。'

  it('有失败原因时：role=alert、原话、以及「只存在于这一次会话」的后果都说清', () => {
    const { container } = renderView({ persistFailure: FAILURE })
    const block = container.querySelector('.projects-persist-error')
    expect(block?.getAttribute('role'), '失败必须播报，不能只换一行灰字').toBe('alert')
    expect(block?.textContent).toContain('改动没有保存到这台设备')
    expect(block?.textContent).toContain(FAILURE)
    expect(block?.textContent).toContain('只存在于这一次会话')
    expect(container.querySelector('.projects-persist-error-reason')?.textContent).toContain(FAILURE)
  })

  it('没有失败原因时整块不渲染（不留一个空壳占位）', () => {
    const { container } = renderView()
    expect(container.querySelector('.projects-persist-error')).toBeNull()
  })

  it('重试按钮按一次就要求重写一遍，不要求用户重做刚才的编辑', () => {
    const onRetryPersist = vi.fn()
    renderView({ persistFailure: FAILURE, onRetryPersist })
    const button = screen.getByRole('button', { name: '重试保存' })
    fireEvent.click(button)
    expect(onRetryPersist).toHaveBeenCalledTimes(1)
  })

  it('没给重试回调时不画一颗按了没用的按钮', () => {
    const { container } = renderView({ persistFailure: FAILURE })
    expect(container.querySelector('.projects-persist-retry')).toBeNull()
  })

  it('失败块的颜色只走令牌，且带边界：红不是唯一通道（§2.1 状态层）', () => {
    const block = ruleBody('.projects-view .projects-persist-error')
    expect(block).toContain('border:')
    expect(block).toMatch(/var\(--ds-status-danger/)
    const strong = ruleBody('.projects-view .projects-persist-error strong')
    expect(strong).toMatch(/var\(--ds-status-danger/)
  })
})
