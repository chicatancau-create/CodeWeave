// @vitest-environment jsdom
/**
 * M4 全站统一 · 挑战页契约测试（01 号方案 §3.4 挑战与项目 + §2.2 令牌 + §5 无障碍 + §8 验收清单）
 *
 * 覆盖四件事：
 * 1. 编号列表：序号是**渲染进 DOM 的真实文本**并进入可访问名称，CSS 侧不做 counter 注入；
 * 2. 轻边界信息区 + 语义状态双通道：状态恒定 --ds-status-*，不借用场景点缀色；
 * 3. 提交与草稿分成两个信息区（虚线/实线 + 编号 + 文字三通道），且提交入口只在草稿区；
 * 4. 改版没碰到的行为：筛选、分页、键盘标签页、视图与草稿恢复、证据提交入口。
 *
 * 断言风格与 M3 代表页一致（docs/01-应用前端与交互重构方案.md §3）：jsdom 不做层叠与布局，
 * 视觉不变式按 CSS 源码文本核对；色彩对比与触控尺寸由 CSS 不变式 + 浏览器复核承担。
 * 本文件只读组件与样式；行为基线由 challenges-view.test.tsx / .browse / .persistence 三个
 * 文件承担（43 条测试）。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChallengesView } from './challenges-view'
import { challenges } from '../data/challenges'
import type { ChallengeRecord } from '../types/lesson'

/**
 * 组件样式表原文。
 * vitest 默认不处理 CSS，`?raw` 会被替换成空模块，所以只能从磁盘读原文核对 ——
 * 与 learning-path-view.m3.test.tsx 同一手法：变量说明符动态 import，不用 `process`。
 * 下方 length 断言是防空模块的守卫：读不到原文时全部 CSS 断言会失败而不是假绿。
 */
const fsSpecifier: string = 'node:fs'
const { readFileSync } = (await import(fsSpecifier)) as {
  readFileSync: (path: string, encoding: 'utf8') => string
}
const moduleDir = (import.meta as unknown as { dirname?: string }).dirname ?? '.'
const cssPath = `${moduleDir}/challenges-view.css`
const tsxPath = `${moduleDir}/challenges-view.tsx`
const cssText = readFileSync(cssPath, 'utf8')
const tsxText = readFileSync(tsxPath, 'utf8')
const cssCode = cssText.replace(/\/\*[\s\S]*?\*\//g, '')

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()

/**
 * 取某个选择器的声明体（支持同一规则里的逗号选择器列表）。
 * 顺带剥掉媒体块收尾的 `}` —— 否则紧跟在 @media 之后的那条规则选择器会被污染。
 */
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

/** 找不到规则时返回哨兵串，避免「断言空字符串通过」的假绿。 */
function ruleBody(selector: string): string {
  const bodies = rulesFor(selector)
  if (bodies.length === 0) return `__NO_RULE_FOR__${selector}__`
  return bodies[0]!
}

/** 取 @media 查询内部全文（支持嵌套花括号）。 */
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

/** 文件内所有选择器（去掉 at-rules 与媒体块残留括号；逗号只在括号外切分）。 */
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

const renderView = (props: { progress?: Record<string, ChallengeRecord>; scope?: string } = {}) =>
  render(
    <ChallengesView
      challenges={challenges}
      progress={props.progress ?? {}}
      unitsByStage={{}}
      onOpenUnit={vi.fn()}
      onSubmit={vi.fn()}
      scope={props.scope}
    />,
  )

const openDetail = (name: RegExp) => {
  fireEvent.click(screen.getByRole('button', { name }))
  fireEvent.click(screen.getByRole('tab', { name: '提交记录' }))
}

const cardNo = (name: RegExp) =>
  screen.getByRole('button', { name }).querySelector('.stage-card-no')?.textContent ?? ''

const passedRecord: Record<string, ChallengeRecord> = {
  'stage-b': { completedAt: '2026-09-13T00:00:00.000Z', evidence: '输出与验收点一致', status: 'passed' },
}
const submittedRecord: Record<string, ChallengeRecord> = {
  'stage-a': {
    completedAt: '2026-09-13T00:00:00.000Z',
    evidence: '执行环境：Windows 11 + JDK 17',
    status: 'submitted',
    tier: 'external',
  },
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('M4 挑战页 · 编号列表用真实文本编号', () => {
  it('组件按原样式表引入页面 CSS（作用域与令牌的前提）', () => {
    expect(tsxText).toContain("import './challenges-view.css'")
    expect(cssText.length).toBeGreaterThan(8000)
  })

  it('每张卡片首行是两位真实文本序号，并进入可访问名称', () => {
    renderView()
    const card = screen.getByRole('button', { name: /A 关：开发环境与基本操作/ })
    expect(card.querySelector('.stage-card-no')?.textContent).toBe('01')
    expect(card.getAttribute('aria-label')?.startsWith('01 · A 关：')).toBe(true)
    expect(card.closest('li')).toBeTruthy()
    expect(document.querySelector('ol.challenge-grid')?.getAttribute('role')).toBe('list')
  })

  it('序号是关卡身份：筛选或改排序后仍是同一个号', () => {
    renderView()
    const select = screen.getByLabelText('阶段', { selector: 'select' }) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'M' } })
    expect(cardNo(/M 关：竞赛综合实战/)).toBe('13')

    fireEvent.change(screen.getByLabelText('阶段', { selector: 'select' }) as HTMLSelectElement, {
      target: { value: 'all' },
    })
    fireEvent.click(screen.getByRole('button', { name: /更多筛选/ }))
    fireEvent.change(screen.getByLabelText('排序', { selector: 'select' }) as HTMLSelectElement, {
      target: { value: 'status' },
    })
    expect(cardNo(/B 关：Java 核心编程/)).toBe('02')
    expect(cardNo(/A 关：开发环境与基本操作/)).toBe('01')
  })

  it('详情头部沿用同一编号口径（第 N / 共 M 关 + 阶段）', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /C 关/ }))
    const no = document.querySelector('.challenge-detail-no')
    expect(no?.textContent).toContain('03')
    expect(no?.textContent).toContain('13')
    expect(no?.textContent).toContain('阶段 C')
  })

  it('CSS 不做 counter 注入：编号只能是 DOM 文本（§5.3 第 6 条）', () => {
    expect(cssCode).not.toMatch(/counter\(|counters\(|list-style-image/)
    // 伪元素只允许画几何图形：content 后只能是空串
    const contents = [...cssCode.matchAll(/(?<![\w-])content:\s*([^;]+)/g)].map((match) => match[1]!.trim())
    expect(contents.length).toBeGreaterThan(0)
    expect(contents.every((value) => value === "''")).toBe(true)
  })
})

describe('M4 挑战页 · 轻边界信息区与形态（§5.1）', () => {
  it('编号列表 = 顶线 + 每行底线，卡片不铺玻璃底', () => {
    const grid = ruleBody('.challenges-view .challenge-grid')
    expect(grid).toContain('border-top: var(--cv-hair-width) solid var(--cv-hair)')
    const row = ruleBody('.challenges-view .challenge-list-item')
    expect(row).toContain('border-bottom: var(--cv-hair-width) solid var(--cv-hair)')
    const card = ruleBody('.challenges-view .stage-card')
    expect(card).toContain('background: none')
    expect(card).toContain('border-radius: var(--ds-radius-panel, 0)')
  })

  it('黑场底 + 冷色发光承担层级：box-shadow 一律走 --cv-glow-*，无渐变/模糊', () => {
    expect(ruleBody('.challenges-view')).toContain('background: var(--cv-canvas)')
    const shadows = [...cssCode.matchAll(/box-shadow:\s*([^;]+)/g)].map((match) => match[1]!.trim())
    expect(shadows.length).toBeGreaterThan(0)
    // 旧规「全站零投影」在深色画布上无法表达层级（黑投影等于没有）；科技档改为冷色外发光。
    // 约束不放松：这里不允许裸投影字面量，每条只允许三种形态之一 ——
    //   ① --cv-glow-* 令牌；② inset 顶部内高光 token 消费；③ 进度条自发光（唯一豁免，见下）。
    // 四档别名（含 --cv-glow-mark：进度条自发光，比近档更收）。字面量一律不允许 ——
    // 原先把进度条那 0 0 8px 写成豁免字面量，它在 §7 色彩纪律里算「调用行上的裸色值」，
    // 已收进令牌定义行，这里随之下线豁免。
    const glowToken = /^var\(--cv-glow-(near|panel|inset|mark)\)$/
    for (const value of shadows) {
      const ok = glowToken.test(value)
      expect(ok, `未走发光令牌的 box-shadow：${value}`).toBe(true)
    }
    // 渐变与玻璃仍不出现在本页：发光已经承担层级，再叠玻璃/渐变就是双重装饰。
    expect(cssCode).not.toMatch(/backdrop-filter|linear-gradient|radial-gradient|conic-gradient|text-shadow/)
  })

  it('发光别名只落到 --ds-glow-*，且不参与语义状态（场景与状态仍分家）', () => {
    const root = ruleBody('.challenges-view')
    expect(root).toContain('--cv-glow-near: var(--ds-glow-near')
    expect(root).toContain('--cv-glow-panel: var(--ds-glow-panel')
    expect(root).toContain('--cv-glow-inset: var(--ds-glow-inset')
    // 语义状态四档一律不消费发光别名：发光是装饰，状态必须靠颜色 + 文字 + 图形三重通道。
    for (const state of ['--cv-ok', '--cv-warn', '--cv-bad', '--cv-info']) {
      expect(root).toContain(`${state}: var(--ds-status-`)
    }
    expect(root).not.toMatch(/--cv-(ok|warn|bad|info)[^:]*:\s*var\(--cv-glow/)
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
    expect(radii.length).toBeGreaterThan(4)
    expect(radii.filter((value) => !allowed.has(value))).toEqual([])
  })

  it('每个 --ds-* 令牌消费都带兜底值（令牌缺席时外观不回退到旧体系）', () => {
    expect(cssCode.match(/var\(--ds-[a-z0-9-]+\)/g) ?? []).toEqual([])
  })

  it('没有任何全局裸选择器：规则一律以页面根类或降级状态类起头', () => {
    const unscoped = allSelectors().filter(
      (selector) =>
        !selector.startsWith('.challenges-view') &&
        !selector.startsWith('.reduce-motion .challenges-view') &&
        !selector.startsWith('.challenges-view.reduce-motion'),
    )
    expect(unscoped).toEqual([])
  })
})

describe('M4 挑战页 · 语义状态恒定色 + 双通道（§5.1 末段）', () => {
  const statuses = [
    'status-not-started',
    'status-external-pending',
    'status-unsupported',
    'status-ready-to-submit',
    'status-pending-verify',
    'status-passed',
  ] as const

  it('六档状态色全部指到恒定 --ds-status-* 或暖白档，无一跟随场景点缀色', () => {
    const root = ruleBody('.challenges-view')
    expect(root).toContain('--cv-ok: var(--ds-status-success')
    expect(root).toContain('--cv-warn: var(--ds-status-warning')
    expect(root).toContain('--cv-bad: var(--ds-status-danger')
    expect(root).toContain('--cv-info: var(--ds-status-info')
    for (const status of statuses) {
      const body = ruleBody(`.challenges-view .stage-status.${status}`)
      expect(body.length).toBeGreaterThan(0)
      expect(body).not.toMatch(/--ds-scene|--cv-scene|--c-cyan|--c-purple|--c-orange|--accent/)
    }
    // 场景色在本文件只允许出现在编号/选中/进度，不得出现在状态块里
    expect(ruleBody('.challenges-view .stage-status.status-ready-to-submit')).toContain('var(--cv-info)')
    expect(ruleBody('.challenges-view .stage-status.status-pending-verify')).toContain('var(--cv-warn)')
  })

  it('执行等级徽标同样用恒定色（teaching 不再指场景青）', () => {
    const teaching = ruleBody('.challenges-view .execution-tier.tier-teaching')
    expect(teaching).toContain('var(--cv-info)')
    expect(teaching).not.toMatch(/--c-cyan|--ds-scene|--cv-scene/)
    expect(ruleBody('.challenges-view .execution-tier.tier-worker')).toContain('var(--cv-ok)')
    expect(ruleBody('.challenges-view .execution-tier.tier-external')).toContain('var(--cv-warn)')
  })

  it('标识双通道：每档状态都有固定图形（::before 形状）+ 中文文字', () => {
    const marker = ruleBody('.challenges-view .stage-status::before')
    expect(marker).toContain('width: 7px')
    expect(marker).toContain('border: var(--cv-hair-width) solid currentColor')
    renderView({ progress: passedRecord })
    const chip = screen
      .getByRole('button', { name: /B 关：Java 核心编程，已通过/ })
      .querySelector('.stage-status')!
    expect(chip.textContent).toContain('已通过')
    expect(chip.querySelector('svg')).toBeTruthy() // 图形通道（lucide 徽记）
  })

  it('难度是分类不是成败：中性细线，不借用语义色与场景色', () => {
    const body = ruleBody('.challenges-view .difficulty')
    expect(body).not.toMatch(/--cv-ok|--cv-warn|--cv-bad|--ds-scene|--cv-scene/)
    for (const level of ['入门', '基础', '进阶']) {
      expect(ruleBody(`.challenges-view .difficulty.${level}`)).not.toMatch(
        /--cv-ok|--cv-warn|--cv-bad|--ds-scene|--cv-scene/,
      )
    }
  })

  it('取消 3px 彩色左条与 2px 强调条：提示区统一 1px 发丝线', () => {
    expect(ruleBody('.challenges-view .challenge-notice')).toContain('border: var(--cv-hair-width) solid var(--cv-warn)')
    expect(cssCode).not.toMatch(/border-(left|top|right|bottom)(-width)?:\s*[2-9]px/)
  })
})

describe('M4 挑战页 · 提交与草稿一眼分开（§5.2）', () => {
  it('详情里有两个分区：01 本地草稿（未提交）/ 02 已提交记录', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    const draft = document.querySelector('.challenge-zone--draft')
    const submitted = document.querySelector('.challenge-zone--submitted')
    expect(draft?.textContent).toContain('本地草稿')
    expect(draft?.textContent).toContain('未提交')
    expect(submitted?.textContent).toContain('已提交记录')
    expect(submitted?.textContent).toContain('不随上面的草稿改变')
  })

  it('草稿区虚线边、提交区实线边：形状即通道（不靠颜色单传）', () => {
    expect(ruleBody('.challenges-view .challenge-zone--draft')).toContain('border-style: dashed')
    expect(ruleBody('.challenges-view .challenge-zone--submitted')).toContain('border-style: solid')
    expect(ruleBody('.challenges-view .challenge-zone')).toContain('border: var(--cv-hair-width) solid var(--cv-hair)')
  })

  it('未提交时：提交入口在草稿区，提交区写明「尚无提交记录」', () => {
    renderView()
    openDetail(/B 关：Java 核心编程/)
    const draft = document.querySelector('.challenge-zone--draft')!
    const submitted = document.querySelector('.challenge-zone--submitted')!
    expect(draft.querySelector('.challenge-submit')).toBeTruthy()
    expect(submitted.querySelector('.challenge-submit')).toBeNull()
    expect(submitted.textContent).toContain('尚无提交记录')
  })

  it('已通过：提交入口消失，事实在提交区（固定标识 + 文字）', () => {
    renderView({ progress: passedRecord })
    openDetail(/B 关：Java 核心编程/)
    expect(screen.queryByRole('button', { name: /提交答案/ })).toBeNull()
    const done = document.querySelector('.challenge-zone--submitted .challenge-done-note')
    expect(done?.textContent).toContain('已通过')
    expect(done?.textContent).toContain('已于')
    expect(done?.querySelector('svg')).toBeTruthy()
    expect(document.querySelector('.challenge-zone--submitted .challenge-submitted-evidence')?.textContent).toContain(
      '输出与验收点一致',
    )
  })

  it('待人工确认：文字明说「未计入已通过」，与草稿区不同处', () => {
    renderView({ progress: submittedRecord })
    openDetail(/A 关：开发环境与基本操作/)
    const pending = document.querySelector('.challenge-zone--submitted .challenge-pending-note')
    expect(pending?.textContent).toContain('待人工确认（未计入已通过）')
    expect(pending?.textContent).toContain('待确认')
    expect(pending?.querySelector('svg')).toBeTruthy()
  })

  it('草稿状态用文字写清「本机 / 未提交 / 何时存」，代码与证据各一条', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    fireEvent.click(screen.getByRole('tab', { name: '编写与运行' }))
    fireEvent.change(screen.getByRole('textbox', { name: /代码编辑器/ }), {
      target: { value: 'int total = 42;\n// 第二行' },
    })
    const codeState = document.querySelector('.challenge-draft-state--code')
    expect(codeState?.textContent).toContain('代码草稿')
    expect(codeState?.textContent).toContain('本机代码草稿已保存')
    expect(codeState?.textContent).toContain('2 行')
    expect(codeState?.textContent).toContain('尚未提交')

    fireEvent.click(screen.getByRole('tab', { name: '提交记录' }))
    fireEvent.change(screen.getByRole('textbox', { name: '完成证据说明' }), { target: { value: '跑通并留档' } })
    const evidenceState = document.querySelector('.challenge-draft-state--evidence')
    expect(evidenceState?.textContent).toContain('证据草稿')
    expect(evidenceState?.textContent).toContain('证据说明草稿 5 字，尚未提交')
  })

  it('提交成功后证据清空、代码留下：两区各自回到自己的口径', () => {
    const onSubmit = vi.fn()
    render(
      <ChallengesView
        challenges={challenges}
        progress={{}}
        unitsByStage={{}}
        onOpenUnit={vi.fn()}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    fireEvent.click(screen.getByRole('tab', { name: '编写与运行' }))
    const editor = screen.getByRole('textbox', { name: /代码编辑器/ })
    // 走「用户改过草稿」这条路径：React 对同值 change 不触发 onChange，故先改成别的再写回。
    fireEvent.change(editor, { target: { value: '// 编辑中' } })
    fireEvent.change(editor, { target: { value: challenges[1]!.starterCode } })
    fireEvent.click(screen.getByRole('button', { name: /运行检查/ }))
    fireEvent.click(screen.getByRole('tab', { name: '提交记录' }))
    fireEvent.change(screen.getByRole('textbox', { name: '完成证据说明' }), { target: { value: '输出 15 与验收点一致' } })
    fireEvent.click(screen.getByRole('button', { name: /提交答案/ }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('textbox', { name: '完成证据说明' }) as HTMLTextAreaElement).value).toBe('')
    expect(document.querySelector('.challenge-draft-state--evidence')?.textContent).toContain('证据说明草稿为空')
    expect(document.querySelector('.challenge-draft-state--code')?.textContent).toContain('本机代码草稿已保存')
    expect((screen.getByRole('textbox', { name: /代码编辑器/ }) as HTMLTextAreaElement).value).toBe(
      challenges[1]!.starterCode,
    )
  })
})

describe('M4 挑战页 · 行为回归护栏', () => {
  it('筛选三档（轨道 / 难度 / 运行方式）仍生效，且筛选后回到第 1 页', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    fireEvent.click(screen.getByRole('button', { name: /更多筛选/ }))
    fireEvent.change(screen.getByLabelText('难度', { selector: 'select' }) as HTMLSelectElement, {
      target: { value: '进阶' },
    })
    expect(screen.getByText('第 1 / 1 页')).toBeTruthy()
    expect(document.querySelectorAll('.stage-card')).toHaveLength(6)
    fireEvent.change(screen.getByLabelText('运行方式', { selector: 'select' }) as HTMLSelectElement, {
      target: { value: 'browser' },
    })
    expect(document.querySelectorAll('.stage-card')).toHaveLength(1)
  })

  it('分页：上一页/下一页禁用态与页码文字仍由逻辑驱动', () => {
    renderView()
    expect((screen.getByRole('button', { name: '上一页' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(document.querySelectorAll('.stage-card')).toHaveLength(1)
    expect(screen.getByText('第 2 / 2 页')).toBeTruthy()
    expect((screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('键盘标签页：方向键切换并移动焦点，Home/End 落到首尾', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    const first = screen.getByRole('tab', { name: '题目' })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: '编写与运行' }).getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '编写与运行' }))
    fireEvent.keyDown(screen.getByRole('tab', { name: '编写与运行' }), { key: 'End' })
    const evidence = screen.getByRole('tab', { name: '提交记录' })
    expect(evidence.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(evidence)
    fireEvent.keyDown(evidence, { key: 'Home' })
    expect(screen.getByRole('tab', { name: '题目' }).getAttribute('aria-selected')).toBe('true')
  })

  it('恢复：往返详情后筛选、页码、视图与草稿都在（检查点/恢复口径的挑战侧）', () => {
    const first = render(
      <ChallengesView
        challenges={challenges}
        progress={{}}
        unitsByStage={{}}
        onOpenUnit={vi.fn()}
        onSubmit={vi.fn()}
        scope="user-m4"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /B 关：Java 核心编程/ }))
    fireEvent.click(screen.getByRole('tab', { name: '编写与运行' }))
    fireEvent.change(screen.getByRole('textbox', { name: /代码编辑器/ }), { target: { value: 'int keep = 1;' } })
    first.unmount()

    render(
      <ChallengesView
        challenges={challenges}
        progress={{}}
        unitsByStage={{}}
        onOpenUnit={vi.fn()}
        onSubmit={vi.fn()}
        scope="user-m4"
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: '编写与运行' }))
    expect((screen.getByRole('textbox', { name: /代码编辑器/ }) as HTMLTextAreaElement).value).toContain('int keep = 1')
    expect(screen.getByRole('heading', { level: 2, name: 'B 关卡验收：Java 核心编程' })).toBeTruthy()
  })

  it('证据提交入口：外部关卡仍走结构化表单，提交后状态为待人工确认', () => {
    const onSubmit = vi.fn()
    render(
      <ChallengesView
        challenges={challenges}
        progress={{}}
        unitsByStage={{}}
        onOpenUnit={vi.fn()}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /A 关：开发环境与基本操作/ }))
    fireEvent.click(screen.getByRole('tab', { name: '提交记录' }))
    fireEvent.change(screen.getByLabelText(/执行环境/), { target: { value: 'Windows 11 + JDK 17' } })
    fireEvent.change(screen.getByLabelText(/执行命令/), { target: { value: 'java -version' } })
    fireEvent.change(screen.getByLabelText(/结果摘要/), { target: { value: '四个工具链版本记录完整，并定位一次构建错误' } })
    fireEvent.change(screen.getByLabelText(/复现日期/), { target: { value: '2026-09-01' } })
    const submit = screen.getByRole('button', { name: /提交证据/ }) as HTMLButtonElement
    expect(submit.disabled).toBe(false)
    expect(document.querySelector('.challenge-zone--draft .challenge-submit')).toBeTruthy()
    fireEvent.click(submit)
    const [, submission] = onSubmit.mock.calls[0]!
    expect(submission.passed).toBe(false)
    expect(submission.tier).toBe('external')
  })

  it('外部关卡的结构化证据完成度写进草稿状态文字', () => {
    renderView()
    openDetail(/A 关：开发环境与基本操作/)
    fireEvent.change(screen.getByLabelText(/执行环境/), { target: { value: 'Windows 11' } })
    // reproducedOn 由 emptyEvidence() 预填今天，所以填完环境后是 2 / 5，不是 1 / 5
    expect(document.querySelector('.challenge-draft-state--evidence')?.textContent).toContain('已填 2 / 5 项')
  })
})

describe('M4 挑战页 · §5.4 可读性与降级', () => {
  it('正文 16px、行高落在 1.6–1.75', () => {
    const root = ruleBody('.challenges-view')
    expect(root).toContain('--cv-body: var(--ds-size-body, 16px)')
    expect(root).toContain('--cv-leading: var(--ds-leading-body, 1.7)')
    expect(root).toContain('font-size: var(--cv-body)')
    expect(root).toContain('line-height: var(--cv-leading)')
    expect(mediaBlock('prefers-reduced-motion: reduce')).not.toBe('')
  })

  it('主要触控目标 ≥44px：卡片操作、标签页、筛选控件、分页、提交都在档内', () => {
    expect(ruleBody('.challenges-view')).toContain('--cv-tap: var(--ds-tap-min, 44px)')
    for (const selector of [
      '.challenges-view .detail-tab',
      '.challenges-view .challenge-back',
      '.challenges-view .challenge-run-button',
      '.challenges-view .challenge-submit.moving-border',
      '.challenges-view .filter-chip',
      '.challenges-view .challenge-filter select',
      '.challenges-view .challenge-pagination .subtle-button',
      '.challenges-view .external-evidence-input',
    ]) {
      expect(ruleBody(selector)).toContain('var(--cv-tap)')
    }
  })

  it('焦点轮廓可见且不取消 outline', () => {
    const focus = ruleBody('.challenges-view :focus-visible')
    expect(focus).toContain('var(--ds-focus-ring, rgba(220, 233, 251, 0.72))')
    expect(focus).toContain('outline-offset: var(--ds-focus-offset, 2px)')
    expect(cssCode).not.toMatch(/outline(-style)?:\s*(none|0)\b/)
  })

  it('长代码行横向滚动而非挤压；长中文标题允许折行不 nowrap', () => {
    const editor = ruleBody('.challenges-view .challenge-editor')
    expect(editor).toContain('overflow-x: auto')
    expect(editor).toContain('white-space: pre')
    const result = ruleBody('.challenges-view .challenge-result')
    expect(result).toContain('overflow-x: auto')
    expect(ruleBody('.challenges-view .challenge-result > span')).toContain('white-space: pre')
    expect(ruleBody('.challenges-view .challenge-grid-empty')).toContain('font-size: var(--cv-body)')
    expect(cssCode).not.toMatch(/text-overflow:\s*ellipsis/)
    expect(cssCode).not.toMatch(/white-space:\s*nowrap/)
  })

  it('320px 最小宽度有专门降级：留白收紧、编号行折行、分页改纵向', () => {
    const block = mediaBlock('max-width: 360px')
    expect(block).toContain('--cv-pad: 12px')
    expect(block).toContain('.challenges-view .stage-card')
    expect(block).toContain('flex-wrap: wrap')
  })

  it('系统 prefers-reduced-motion 与根类 .reduce-motion 都真停（名称归零 + 取消过渡）', () => {
    const system = mediaBlock('prefers-reduced-motion: reduce')
    expect(system).toContain('animation: none !important')
    expect(system).toContain('transition: none !important')
    const scoped = ruleBody(
      '.reduce-motion .challenges-view *, .reduce-motion .challenges-view *::before, .reduce-motion .challenges-view *::after, .challenges-view.reduce-motion *, .challenges-view.reduce-motion *::before, .challenges-view.reduce-motion *::after',
    )
    expect(scoped).toContain('animation: none !important')
    expect(scoped).toContain('transition: none !important')
    // 没有任何 infinite 循环，故不存在「只是变慢」的残留
    expect(cssCode).not.toMatch(/infinite/)
    expect(cssCode.match(/@keyframes/g) ?? []).toEqual([])
  })

  it('!important 只出现在降级块内，其余位置为 0', () => {
    const cut = cssCode.indexOf('@media (prefers-reduced-motion')
    expect(cut).toBeGreaterThan(0)
    expect(cssCode.slice(0, cut)).not.toContain('!important')
    expect((cssCode.match(/!important/g) ?? []).length).toBeLessThanOrEqual(16)
  })
})

describe('M4 挑战页 · 无障碍（axe-core）', () => {
  const axeRules = {
    // jsdom 无真实布局：色彩对比与触控尺寸由上面的 CSS 源码不变式 + 浏览器复核承担
    'color-contrast': { enabled: false },
    'target-size': { enabled: false },
    // 挑战详情是列表的下钻视图，整页只有列表态有 h1；属既有结构，M4 未改判定语义
    'page-has-heading-one': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false },
  }

  it('列表态（含展开的更多筛选）无 axe 违规', async () => {
    const { container } = renderView()
    fireEvent.click(screen.getByRole('button', { name: /更多筛选/ }))
    const results = await axe.run(container, { rules: axeRules })
    expect(results.violations.map((violation) => `${violation.id}: ${violation.description}`)).toEqual([])
  })

  it('详情态（草稿区 + 提交区 + 标签页）无 axe 违规', async () => {
    const { container } = renderView({ progress: submittedRecord })
    fireEvent.click(screen.getByRole('button', { name: /A 关：开发环境与基本操作/ }))
    const results = await axe.run(container, { rules: axeRules })
    expect(results.violations.map((violation) => `${violation.id}: ${violation.description}`)).toEqual([])
  })

  it('aria-controls 收起时不指向不存在的元素（既有悬空 IDREF 已收口）', () => {
    renderView()
    const toggle = screen.getByRole('button', { name: /更多筛选/ })
    expect(toggle.getAttribute('aria-controls')).toBeNull()
    fireEvent.click(toggle)
    const target = toggle.getAttribute('aria-controls')!
    expect(document.getElementById(target)).toBeTruthy()
  })
})
