// @vitest-environment jsdom
/**
 * M3 视觉竖切 · 学习工作台契约测试（01 号方案 §3.2 主工作台 + §2.2 动效与降级 + §8 验收清单）
 *
 * 四组断言，各自对应本轮任务的一个硬要求：
 * 1. 业务行为：编辑 / 保存态 / 运行 / 单步回放与结果 / 来源查看 / 标记完成 / 返回，改版后仍成立；
 * 2. 分栏结构：阅读 · 代码 · 变量 · 控制台四区都有锚点，导航只列真实存在的分区（320px 靠锚点可达）；
 * 3. 持续资源审计（§5.3.3/.4）：先把本页与复用子组件的**源码字节**逐个扫一遍，
 *    再用运行时探针证明「挂载—交互—卸载」期间没有 RAF 循环、没有 canvas/getContext、
 *    没有 setInterval，且注册过的原生监听器成对摘除。**没有**持续资源时如实断言为 0，
 *    不为凑要求虚构渲染器或 GPU 抽象（本页确实没有 WebGPU 路径，见 §5.3.2 结论）。
 * 4. CSS 不变式：jsdom 不做层叠与布局，故按样式表源码文本核对（与
 *    tests/styles.focus.test.mjs 同一口径）：无全局裸选择器、无泛光与玻璃、
 *    编辑器字号只消费 --editor-font-size 且永不赋值、reduce-motion 两道开关真停止。
 *
 * 断言风格与项目现有 jsdom 测试一致：直接读 DOM 结构与文本，不依赖 jest-dom 匹配器。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { LearningWorkspaceView } from './learning-workspace-view'
import type { ExecutionResult, Lesson, TraceEvent, VariableValue } from '../types/lesson'

/**
 * 组件源码字节走 Vite 的 `?raw` glob：项目没有安装 @types/node，直接
 * `import 'node:fs'` 会让 `tsc -b` 报错；`import.meta.url` 在 jsdom 环境里也不是
 * file 协议，fileURLToPath 会抛错。（样式表文本另走读盘，见下方 beforeAll。）
 */
const rawSources = import.meta.glob(
  [
    './learning-workspace-view.tsx',
    './code-editor.tsx',
    './console-panel.tsx',
    './variable-panel.tsx',
    './runtime-controls.tsx',
    './flow-chart.tsx',
    './content-source-view.tsx',
    '../content/markdown.tsx',
    '../content/markdown-body.ts',
    '../content/wiki-link.tsx',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

/* ────────────────────────────── 夹具 ────────────────────────────── */

const LONG_LINE = '    return a + b  # 这一行故意写得很长，用来验证代码行是横向滚动而不是被挤压折行'

const baseLesson = (overrides: Partial<Lesson> = {}): Lesson =>
  ({
    id: 'vault-py-func',
    language: 'python',
    languageLabel: 'Python',
    label: 'S1',
    title: '函数与返回值',
    description: '写出带返回值的函数',
    duration: '20 min',
    level: '入门',
    progress: 0,
    code: `def add(a, b):\n${LONG_LINE}\n\nprint(add(2, 3))`,
    flow: [
      { id: 'start', label: '开始', kind: 'start', tone: 'purple' },
      { id: 'call', label: '调用 add', kind: 'process', tone: 'blue', line: 4 },
      { id: 'check', label: '是否三参数', kind: 'decision', tone: 'yellow', line: 2 },
      { id: 'end', label: '结束', kind: 'end', tone: 'green' },
    ],
    insight: '返回值是函数与外部世界之间唯一的合法出口。',
    fileName: 'add.py',
    runtime: '教学模拟器 · Python 子集',
    contentId: 'topic-py-func',
    subject: 'Python',
    subjectId: 'python',
    legacy: false,
    executable: true,
    source: {
      path: '资料库/Python/函数.md',
      headingPath: ['函数', '返回值'],
      verificationStatus: '外部未复核',
      sourceIds: ['py-func-01'],
    },
    reading: {
      markdown: '## 返回值\n\n函数用 `return` 把结果交回调用方。\n\n- 有返回值才能继续参与计算\n- 打印不等于返回\n\n' + '```python\ndef sub(a, b):\n    return a - b\n```\n\n> 先想清楚要交回什么，再决定参数。',
      path: '资料库/Python/函数.md',
      headingPath: ['函数', '返回值'],
      verificationStatus: '外部未复核',
      headings: [{ level: 2, title: '返回值', line: 1 }],
    },
    acceptance: { rubric: [], evidenceChecklist: [], testCases: ['add(2, 3) == 5'], hints: ['检查是否写了 return'] },
    content: {
      objective: '写出并调用一个带返回值的函数',
      prerequisites: ['变量与类型'],
      explanation: ['def 定义函数体'],
      examples: [{ good: 'return a + b', bad: 'print(a + b)', why: '返回值可继续参与计算' }],
      guidedSteps: ['定义 add', '调用并打印'],
      exercise: '实现 sub(a, b) 返回差',
      variant: '让 add 支持三个参数',
      projectTask: '把计算器函数整理成模块',
      mistakes: ['忘记 return'],
      runCommand: 'python add.py',
      completion: '输出 5',
      reviewOffsetsDays: [1, 7],
      stageId: 'S1',
      estimatedMinutes: 20,
    },
    ...overrides,
  }) as Lesson

const startEvent: TraceEvent = { id: 'e1', type: 'start', line: 1, label: '开始', detail: '', variables: [], nodeId: 'start' }
const callEvent: TraceEvent = { id: 'e2', type: 'line', line: 4, label: '调用 add', detail: '', variables: [], nodeId: 'call' }
const returnEvent: TraceEvent = { id: 'e3', type: 'assign', line: 2, label: '返回和', detail: '', variables: [], nodeId: 'check' }

const events: TraceEvent[] = [startEvent, callEvent, returnEvent]

const executionResult = (overrides: Partial<ExecutionResult> = {}): ExecutionResult =>
  ({ events, output: ['5'], tier: 'teaching', ...overrides }) as ExecutionResult

const variables: VariableValue[] = [
  { name: 'result', value: '5', type: 'int', color: 'blue' },
  { name: 'table', value: '{"k": [1, 2, 3, 4, 5, 6, 7, 8, 9]}', type: 'dict', color: 'coral' },
]

function renderWorkspace(overrides: Partial<Parameters<typeof LearningWorkspaceView>[0]> = {}) {
  const props = {
    lesson: baseLesson(),
    code: baseLesson().code,
    isDirty: false,
    currentEvent: callEvent,
    runStatus: 'running' as const,
    eventIndex: 1,
    execution: executionResult(),
    visibleOutput: ['5'],
    variables,
    completed: false,
    onComplete: vi.fn(),
    onBack: vi.fn(),
    onHelp: vi.fn(),
    onCodeChange: vi.fn(),
    onRun: vi.fn(),
    // 画布那枚「播放」的回调（2026-10-04 从 `onRun` 拆出来）：`onRun` 是运行条的
    // 「开始运行」——第一下只落到第一拍；`onPlay` 是第一下直接放到底。两者不是同一件事，
    // 视图受控，桩必须在这里就位。
    onPlay: vi.fn(),
    onStep: vi.fn(),
    // 画布「上一步」的跳转入口（`use-execution.ts` 的 `handleSeek`）：视图是受控的，
    // 没有人可能往下传，所以这个桩必须在这里就位，不能靠 `...overrides` 补。
    onSeek: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  }
  const view = render(<LearningWorkspaceView {...props} />)
  return { ...view, props }
}

/* ──────────────────── 持续资源运行时探针（§5.3.4） ─────────────────── */

type NativeListenerTarget = {
  addEventListener: (type: string, handler: unknown, options?: unknown) => void
  removeEventListener: (type: string, handler: unknown, options?: unknown) => void
}

/** 记录 window/document 上「本探针开始后」注册的原生监听器，用于验证卸载时成对摘除。 */
function trackNativeListeners(target: Window | Document) {
  const t = target as unknown as NativeListenerTarget
  const originalAdd = t.addEventListener.bind(target) as NativeListenerTarget['addEventListener']
  const originalRemove = t.removeEventListener.bind(target) as NativeListenerTarget['removeEventListener']
  const live = new Map<unknown, Set<string>>()
  t.addEventListener = (type, handler, options) => {
    const types = live.get(handler) ?? new Set<string>()
    types.add(type)
    live.set(handler, types)
    originalAdd(type, handler, options)
  }
  t.removeEventListener = (type, handler, options) => {
    const types = live.get(handler)
    if (types) {
      types.delete(type)
      if (types.size === 0) live.delete(handler)
    }
    originalRemove(type, handler, options)
  }
  return {
    live: () => live.size,
    restore: () => {
      t.addEventListener = originalAdd
      t.removeEventListener = originalRemove
    },
  }
}

/* ────────────────────── CSS 源码解析（源码文本核对） ────────────────── */

/**
 * 只有样式表需要按字节读盘：vitest 的 `css: false` 会把 .css 模块（连 `?raw`/`?inline`
 * 一起）替换成空串，模块图里拿不到样式文本。项目没装 @types/node，所以这里用
 * `vi.importActual` 取 node 模块并自带最小签名，`tsc -b` 不会因为裸 `import 'node:fs'` 报错。
 */
type NodeFsModule = { readFileSync: (path: string, encoding: 'utf8') => string }
type NodePathModule = { resolve: (...parts: string[]) => string }
type NodeProcessModule = { cwd: () => string }

type CssRule = { selector: string; insideKeyframes: boolean; block: string }

let cssText = ''
let cssCode = ''
let baseCssCode = ''
let cssRules: CssRule[] = []
let styleRules: CssRule[] = []

beforeAll(async () => {
  const fs = await vi.importActual<NodeFsModule>('node:fs')
  const path = await vi.importActual<NodePathModule>('node:path')
  const proc = await vi.importActual<NodeProcessModule>('node:process')
  cssText = fs.readFileSync(path.resolve(proc.cwd(), 'src/components/learning-workspace-view.css'), 'utf8')
  /** 注释里的示例与说明不参与判定（01 号方案 §2.2：不照抄注释，只核规则）。 */
  cssCode = cssText.replace(/\/\*[\s\S]*?\*\//g, '')
  baseCssCode = fs
    .readFileSync(path.resolve(proc.cwd(), 'src/components/flow-chart.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  cssRules = collectRules(cssCode)
  styleRules = cssRules.filter((rule) => !rule.insideKeyframes)
})

/** 扁平收集「选择器 → 声明块」，同时标记 @keyframes / @media 归属。 */
function collectRules(css: string): CssRule[] {
  const rules: CssRule[] = []
  const atStack: string[] = []
  let buffer = ''
  let index = 0
  while (index < css.length) {
    const char = css[index] as string
    if (char === '{') {
      const head = buffer.trim()
      buffer = ''
      index += 1
      if (head.startsWith('@')) {
        atStack.push((head.split(/\s+/)[0] as string) ?? head)
        continue
      }
      let depth = 1
      const start = index
      while (index < css.length && depth > 0) {
        const inner = css[index] as string
        if (inner === '{') depth += 1
        else if (inner === '}') depth -= 1
        index += 1
      }
      rules.push({ selector: head, insideKeyframes: atStack.includes('@keyframes'), block: css.slice(start, index - 1) })
      continue
    }
    if (char === '}') {
      atStack.pop()
      buffer = ''
      index += 1
      continue
    }
    buffer += char
    index += 1
  }
  return rules
}

function blockOf(selector: string): string {
  const rule = styleRules.find((item) =>
    item.selector
      .split(',')
      .map((part) => part.trim())
      .includes(selector),
  )
  return rule ? rule.block : ''
}

/** 读组件源码字节：审计持续资源用，不看注释推断。 */
function sourceOf(key: string): string {
  const text = rawSources[key]
  if (text === undefined) throw new Error(`源码未被打进测试：${key}`)
  return text
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/* ──────────────────────── 1. 分栏骨架（§5.2） ──────────────────────── */

describe('M3 学习工作台 · 黑场分栏四区骨架', () => {
  it('阅读 / 代码 / 变量 / 控制台四区都有独立锚点', () => {
    const { container } = renderWorkspace()
    for (const id of ['cw-pane-reading', 'cw-pane-code', 'cw-pane-variables', 'cw-pane-console']) {
      expect(container.querySelector(`#${id}`)).toBeTruthy()
    }
    // 四区各自成块：阅读区带原文头，代码区带编辑器，变量/控制台带 panel 头
    expect(container.querySelector('#cw-pane-reading .reading-head')).toBeTruthy()
    expect(container.querySelector('#cw-pane-code textarea')).toBeTruthy()
    expect(container.querySelector('#cw-pane-variables .variables-panel')).toBeTruthy()
    expect(container.querySelector('#cw-pane-console .console-panel')).toBeTruthy()
  })

  it('分区导航只列真实存在的分区，且每个 href 都有对应锚点', () => {
    const { container } = renderWorkspace()
    const nav = container.querySelector('nav.cw-pane-nav')
    expect(nav?.getAttribute('aria-label')).toBe('工作台分区导航')
    const links = Array.from(nav?.querySelectorAll('a') ?? [])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#cw-pane-reading',
      '#cw-pane-code',
      '#cw-pane-variables',
      '#cw-pane-console',
    ])
    for (const link of links) {
      const id = (link.getAttribute('href') ?? '').slice(1)
      expect(container.querySelector(`#${id}`)).toBeTruthy()
    }
    expect(nav?.textContent).toContain('01')
    expect(nav?.textContent).toContain('04')
  })

  it('无代码单元不留下死锚点：导航只剩阅读 + 变量 + 控制台', () => {
    const { container } = renderWorkspace({ lesson: baseLesson({ code: '', reading: undefined }) })
    const links = Array.from(container.querySelectorAll('nav.cw-pane-nav a'))
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['#cw-pane-variables', '#cw-pane-console'])
    expect(container.querySelector('#cw-pane-code')).toBeNull()
    expect(container.querySelector('#cw-pane-reading')).toBeNull()
  })

  it('返回路径与帮助入口始终在页首（手机上不照搬模板隐藏轨道文字）', () => {
    const { props } = renderWorkspace()
    fireEvent.click(screen.getByRole('button', { name: '返回课程列表' }))
    expect(props.onBack).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '查看学习指南' }))
    expect(props.onHelp).toHaveBeenCalledTimes(1)
  })

  it('执行流程只在 lesson.flow 有数据时出现，不拿空数组画假节点', () => {
    const { container } = renderWorkspace({ lesson: baseLesson({ flow: [] }) })
    expect(container.querySelector('.flow-chart')).toBeNull()
    const withFlow = renderWorkspace()
    expect(withFlow.container.querySelectorAll('.flow-node')).toHaveLength(4)
  })
})

/* ──────────────────── 2. 保留的业务行为（§5.2 右列） ─────────────────── */

describe('M3 学习工作台 · 业务行为不丢失', () => {
  it('编辑：输入与 Tab 缩进都上抛新代码（编辑器行为不变）', () => {
    const { container, props } = renderWorkspace()
    const area = container.querySelector('textarea') as HTMLTextAreaElement
    expect(area.value).toBe(props.code)
    fireEvent.change(area, { target: { value: 'x = 1' } })
    expect(props.onCodeChange).toHaveBeenCalledWith('x = 1')

    area.focus()
    area.setSelectionRange(2, 2)
    fireEvent.keyDown(area, { key: 'Tab' })
    const inserted = vi.mocked(props.onCodeChange).mock.calls.at(-1)?.[0] as string
    expect(inserted.length).toBe(props.code.length + 2)
    expect(inserted.startsWith('de  f ')).toBe(true)
  })

  it('保存态：未保存时同时出现在文件名行与保存提示里，已保存时不显示', () => {
    const dirty = renderWorkspace({ isDirty: true })
    expect(dirty.container.textContent).toContain('未保存的修改')
    expect(dirty.container.textContent).toContain('Ctrl')
    expect(dirty.container.textContent).toContain('保存草稿')
    const clean = renderWorkspace({ isDirty: false })
    expect(clean.container.textContent).not.toContain('未保存的修改')
  })

  it('运行 / 单步 / 重置：三个入口分别上抛对应回调', () => {
    const { props } = renderWorkspace({ runStatus: 'idle' })
    fireEvent.click(screen.getByRole('button', { name: /开始运行/ }))
    expect(props.onRun).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /单步执行/ }))
    expect(props.onStep).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /重置/ }))
    expect(props.onReset).toHaveBeenCalledTimes(1)
  })

  it('单步回放与结果：当前行号、流程当前节点、变量表、stdout 全部跟随事件游标', () => {
    const { container } = renderWorkspace({ currentEvent: returnEvent, eventIndex: 2 })
    const active = container.querySelector('.line-numbers span.active')
    expect(active?.textContent).toBe('02')
    // 2026-09-29 重做竖向步进器：当前拍是 `li.flow-step.is-now`（带 aria-current），
    // 走过的拍是 `.is-done`——「visited / current」那套节点自己的类已随旧横排一并退役。
    expect(container.querySelector('li.flow-step.is-now .flow-node')?.textContent).toContain('是否三参数')
    // 游标停在第 3 拍：前两拍 is-done，当前那一拍单独是 is-now（旧写法把当前也算进
    // `visited`，两者相加仍是走到的 3 拍——现在分开了，「现在在哪」与「走过哪些」不再混为一谈）。
    expect(container.querySelectorAll('li.flow-step.is-done')).toHaveLength(2)
    expect(container.querySelectorAll('li.flow-step.is-now')).toHaveLength(1)
    expect(container.querySelectorAll('li.flow-step.is-done, li.flow-step.is-now')).toHaveLength(3)
    expect(container.querySelector('.variables-panel')?.textContent).toContain('result')
    expect(container.querySelector('.variables-panel')?.textContent).toContain('步骤 3 / 3')
    expect(container.querySelector('.console-body')?.textContent).toContain('5')
    expect(container.querySelector('.code-highlight')).toBeTruthy()
  })

  it('运行态文案与状态色点仍然表达状态（不再依赖闪烁动画）', () => {
    const running = renderWorkspace({ runStatus: 'running' })
    expect(running.container.querySelector('.run-indicator.running')).toBeTruthy()
    expect(running.container.textContent).toContain('正在执行代码')
    const done = renderWorkspace({ runStatus: 'completed' })
    expect(done.container.querySelector('.run-indicator.completed')).toBeTruthy()
    expect(done.container.querySelector('.run-button')?.textContent).toContain('再运行一次')
  })

  it('错误结果：控制台显示行号与原文，不静默', () => {
    const { container } = renderWorkspace({
      runStatus: 'error',
      execution: executionResult({ error: { line: 4, message: 'NameError: c 未定义' } }),
    })
    expect(container.querySelector('.console-status')?.textContent).toContain('第 4 行错误')
    expect(container.querySelector('.console-error')?.textContent).toContain('NameError')
    expect(container.querySelector('.run-indicator.error')).toBeTruthy()
  })

  it('执行等级不可信时显式说明（role=status），通过判定不被冒充', () => {
    const { container } = renderWorkspace({ execution: executionResult({ unsupported: true }) })
    // 本页有两个 role=status（这一条执行等级说明 + 代码区头部的保存结果），断言要认元素不是认数量
    const note = container.querySelector('.workspace-tier-note')
    expect(note?.textContent).toContain('教学模拟')
    expect(container.querySelector('.subtle-button')?.hasAttribute('disabled')).toBe(true)
  })

  it('外部环境实验：不给运行按钮，四项结构化证据填齐之前完成入口是锁着的', () => {
    const { container, props } = renderWorkspace({
      lesson: baseLesson({ content: { ...baseLesson().content, runEnvironment: 'external' } }),
      runStatus: 'idle',
    })
    expect(container.querySelector('.run-bar')).toBeNull()
    expect(container.textContent).toContain('外部环境实验')
    const button = container.querySelector('.subtle-button') as HTMLButtonElement
    // LEARN-01 第 5a 条改的就是这里：从前这个按钮空手也能点，点下去就记一条「完成」，
    // 什么材料都不收。现在四项不齐它就不放开。
    expect(button.disabled).toBe(true)
    expect(button.textContent).toContain('补齐外部证据后可标记完成')
    fireEvent.click(button)
    expect(props.onComplete).not.toHaveBeenCalled()

    const fill = (key: string, value: string) =>
      fireEvent.change(container.querySelector(`#lesson-evidence-vault-py-func-${key}`) as HTMLInputElement, { target: { value } })
    fill('environment', 'Windows 11 + JDK 17.0.9 + Maven 3.9.6')
    fill('command', 'mvn -q package')
    expect((container.querySelector('.subtle-button') as HTMLButtonElement).disabled, '还差结果摘要与日期').toBe(true)
    fill('resultSummary', '构建成功，控制台输出 5，与验收点一致')

    const ready = container.querySelector('.subtle-button') as HTMLButtonElement
    expect(ready.disabled).toBe(false)
    expect(ready.textContent).toContain('已完成真实环境练习')
    fireEvent.click(ready)
    expect(props.onComplete).toHaveBeenCalledTimes(1)
    const payload = (
      props.onComplete as unknown as {
        mock: { calls: [[{ verification: string; externalEvidence?: Record<string, string> }]] }
      }
    ).mock.calls[0][0]
    expect(payload.verification, '证据填齐也只是声明完整，不是本机验证过').toBe('self-declared')
    const evidence = payload.externalEvidence as { environment: string; command: string; resultSummary: string; reproducedOn: string }
    expect(evidence.environment).toContain('JDK 17')
    expect(evidence.resultSummary).toContain('输出 5')
    expect(evidence.reproducedOn, '复现日期由 emptyEvidence 预填今天').toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('外部证据表单复用挑战页那一份隐私校验，命中即锁住并逐条说明', () => {
    const { container, props } = renderWorkspace({
      lesson: baseLesson({ content: { ...baseLesson().content, runEnvironment: 'external' } }),
      runStatus: 'idle',
    })
    const fill = (key: string, value: string) =>
      fireEvent.change(container.querySelector(`#lesson-evidence-vault-py-func-${key}`) as HTMLInputElement, { target: { value } })
    fill('environment', 'password: hunter2')
    fill('command', 'java -version')
    fill('resultSummary', '输出一行版本号，本机 JDK 17 可用')
    const error = container.querySelector('.external-evidence-error')
    expect(error?.textContent, '隐私字段要指名是哪一项').toContain('脱敏')
    expect(container.querySelector('[aria-invalid="true"]')).toBeTruthy()
    expect((container.querySelector('.subtle-button') as HTMLButtonElement).disabled).toBe(true)
    expect(props.onComplete).not.toHaveBeenCalled()
  })

  it('纯阅读单元：没有代码就没有编辑器，完成仍按证据清单确认', () => {
    const { container, props } = renderWorkspace({ lesson: baseLesson({ code: '' }), runStatus: 'idle' })
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.textContent).toContain('本单元没有配套代码')
    fireEvent.click(container.querySelector('.subtle-button') as HTMLButtonElement)
    expect(props.onComplete).toHaveBeenCalledTimes(1)
  })

  it('运行成功后才允许标记完成；已完成时显示复测口径', () => {
    const idle = renderWorkspace({ runStatus: 'idle' })
    const complete = () => idle.container.querySelector('.lesson-complete-row .subtle-button') as HTMLButtonElement
    expect(complete().disabled).toBe(true)
    fireEvent.click(complete())
    expect(idle.props.onComplete).not.toHaveBeenCalled()

    const ok = renderWorkspace({ completed: true })
    expect(ok.container.textContent).toContain('本单元已完成，按复测计划回顾')
    expect(ok.container.querySelector('.lesson-complete-row .subtle-button')).toBeNull()
  })

  /**
   * LEARN-01 第 5 条：本地练习的「完成」要按**这一题**的验收点判，不是「跑起来没报错」。
   * 改版前资料库 12 道练习都带 `expectedOutput` 却没有任何消费者；判题复用 CHAL-02 的
   * `exact-lines`，所以这里同时钉住「子串形状不算过」与「屏幕上没有的行不算过」。
   */
  describe('LEARN-01 第 5 条 · 该题验收点判定完成', () => {
    const contract = (expectedOutput: string[]) => ({
      exerciseId: 'vault-py-func-ex1',
      title: '实现 sub(a, b) 并打印差',
      prompt: '打印两数之差',
      starterCode: 'print(sub(2, 3))',
      starterLanguage: 'python',
      expectedOutput,
      executionPolicy: 'teaching',
    }) as const

    it('验收点整行命中才可点，交上去的证据写「自动验证通过」与命中数', () => {
      const { container, props } = renderWorkspace({ lesson: baseLesson({ exercise: contract(['5']) }), runStatus: 'completed' })
      const button = container.querySelector('.lesson-complete-row .subtle-button') as HTMLButtonElement
      expect(button.disabled).toBe(false)
      expect(button.textContent).toContain('标记完成（自动验证）')
      fireEvent.click(button)
      expect(props.onComplete).toHaveBeenCalledWith({ verification: 'auto-verified', cases: { matched: 1, total: 1 } })
      expect(container.querySelectorAll('.cw-verify-cases li.is-hit')).toHaveLength(1)
    })

    it('输出 115 不能满足期望 15（与 CHAL-02 同一口径），按钮锁住且点名差在哪', () => {
      const { container, props } = renderWorkspace({
        lesson: baseLesson({ exercise: contract(['15']) }),
        visibleOutput: ['115'],
        runStatus: 'completed',
      })
      const button = container.querySelector('.lesson-complete-row .subtle-button') as HTMLButtonElement
      expect(button.disabled).toBe(true)
      fireEvent.click(button)
      expect(props.onComplete).not.toHaveBeenCalled()
      const miss = container.querySelector('.cw-verify-cases li.is-miss')
      expect(miss?.textContent).toContain('15')
      expect(miss?.textContent).toContain('只有包含它的输出行「115」')
      expect(container.querySelector('.cw-verify-cases li.is-extra')?.textContent).toContain('115')
    })

    it('只命中一条时报 1/2 并锁住，多印与缺行都不藏', () => {
      const { container, props } = renderWorkspace({
        lesson: baseLesson({ exercise: contract(['5', '6']) }),
        visibleOutput: ['5', '7'],
        runStatus: 'completed',
      })
      const button = container.querySelector('.lesson-complete-row .subtle-button') as HTMLButtonElement
      expect(button.textContent).toContain('1/2 未全中')
      expect(button.disabled).toBe(true)
      fireEvent.click(button)
      expect(props.onComplete).not.toHaveBeenCalled()
      expect(container.querySelectorAll('.cw-verify-cases li.is-hit')).toHaveLength(1)
      expect(container.querySelectorAll('.cw-verify-cases li.is-miss')).toHaveLength(1)
      expect(container.querySelector('.cw-verify-cases li.is-extra')?.textContent).toContain('7')
    })

    it('跑完又把步进拉回去时屏幕上没有输出——这一条也不算验证过', () => {
      const { container, props } = renderWorkspace({
        lesson: baseLesson({ exercise: contract(['5']) }),
        visibleOutput: [],
        runStatus: 'completed',
      })
      const button = container.querySelector('.lesson-complete-row .subtle-button') as HTMLButtonElement
      expect(button.disabled).toBe(true)
      fireEvent.click(button)
      expect(props.onComplete).not.toHaveBeenCalled()
    })

    it('没有结构化验收点的课仍可标完成，但写的是自行声明且明说系统没比对', () => {
      const { container, props } = renderWorkspace({ runStatus: 'completed' })
      expect(container.querySelector('.cw-verify-cases')).toBeNull()
      expect(container.textContent).toContain('本课没有结构化验收点')
      expect(container.textContent).toContain('系统不比对输出')
      const button = container.querySelector('.lesson-complete-row .subtle-button') as HTMLButtonElement
      // 没有判据可依时按钮不许自称「自动验证」——这一条是写探针时抓到自己写错的形状
      expect(button.textContent).toContain('自行声明')
      expect(button.textContent).not.toContain('自动验证')
      fireEvent.click(button)
      expect(props.onComplete).toHaveBeenCalledWith({ verification: 'self-declared', cases: null })
    })

    it('已完成那一格把三种来源分开显示，旧记录不带来源就不追认', () => {
      const verified = renderWorkspace({ completed: true, completionSource: 'auto-verified' })
      expect(verified.container.textContent).toContain('本单元已完成（该题验收点自动比对通过）')
      const declared = renderWorkspace({ completed: true, completionSource: 'self-declared' })
      expect(declared.container.textContent).toContain('学习者自行声明，系统未比对输出')
      // §9 收口新增可见的一档：复测判过掌握、但本课没留下逐题验收记录。
      // 这句不许升成「本机自动比对过」（02 号方案 §4：复测是掌握，不是机器验证过交付物）。
      const reviewed = renderWorkspace({ completed: true, completionSource: 'review-mastered' })
      expect(reviewed.container.textContent).toContain('本单元已完成（到期复测判为掌握')
      expect(reviewed.container.textContent).not.toContain('自动比对通过')
      const unknown = renderWorkspace({ completed: true })
      expect(unknown.container.textContent).not.toContain('自动比对')
      expect(unknown.container.textContent).toContain('本单元已完成，按复测计划回顾')
    })

    it('Ctrl/Cmd+S 的真实结果落在代码区头部那句话里（成功与失败说的是两句话）', () => {
      const ok = renderWorkspace({ saveFeedback: '已保存到本机' })
      const hint = ok.container.querySelector('.cw-save-hint')
      expect(hint?.getAttribute('role')).toBe('status')
      expect(hint?.textContent).toContain('已保存到本机')
      const bad = renderWorkspace({ saveFeedback: '保存失败：草稿未写入（详见通知中心）' })
      expect(bad.container.querySelector('.cw-save-hint')?.textContent).toContain('保存失败')
      // 没有结果可说时那句话退回脏标记本身，不留着上一句的文案误导人
      const idle = renderWorkspace({ saveFeedback: '', isDirty: true })
      expect(idle.container.querySelector('.cw-save-hint')?.textContent).toContain('有未保存修改')
    })

    it('两个新块必须能折行：共享层那一行是 nowrap flex，子项不给 min-width:0 就顶破页面', () => {
      // 真机量到过：长句子作 flex 子项不缩，320 档整页溢出 180px（#55 同一形状的第二例）
      expect(cssCode).toMatch(/\.cw-workspace \.lesson-complete-row\s*\{[^}]*flex-wrap:\s*wrap/)
      expect(cssCode).toMatch(
        /\.cw-workspace \.cw-verify-cases,\s*\.cw-workspace \.cw-verify-none\s*\{[^}]*min-width:\s*0/,
      )
      expect(cssCode).toMatch(/\.cw-workspace \.cw-verify-cases code\s*\{[^}]*overflow-wrap:\s*anywhere/)
      // 按钮带 UA 的 nowrap，文案一长照样顶破页面——这一条把「允许折行」钉住
      expect(cssCode).toMatch(
        /\.cw-workspace \.lesson-complete-row \.subtle-button\s*\{[^}]*white-space:\s*normal/,
      )
    })
  })

  it('来源查看：来源三态标签 + 展开后渲染主题原文（走受限 Markdown 管线）', () => {
    const { container } = renderWorkspace()
    const source = container.querySelector('.lesson-source')
    expect(source?.textContent).toContain('外部未复核')
    expect(source?.textContent).toContain('资料库')
    expect(source?.querySelector('.md-view')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '查看主题原文' }))
    const body = source?.querySelector('.md-view')
    expect(body?.querySelector('h3')?.textContent).toBe('返回值')
    expect(body?.textContent).toContain('把结果交回调用方')
    expect(body?.querySelector('.md-code')?.textContent).toContain('def sub(a, b):')
  })

  it('课程指南：图标按钮切换，aria-expanded 与内容同步', () => {
    const { container } = renderWorkspace()
    const toggle = screen.getByRole('button', { name: '课程指南' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('.lesson-guide')).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const guide = container.querySelector('.lesson-guide')
    expect(guide?.textContent).toContain('忘记 return')
    expect(guide?.textContent).toContain('把计算器函数整理成模块')
    fireEvent.click(toggle)
    expect(container.querySelector('.lesson-guide')).toBeNull()
  })

  it('关键理解仍然呈现（不被分栏改版吃掉）', () => {
    const { container } = renderWorkspace()
    expect(container.querySelector('.lesson-insight p')?.textContent).toContain('唯一的合法出口')
  })
})

/* ─────────────── 3. 持续资源审计：源码字节 + 运行时探针（§5.3.3/.4） ─────────────── */

/* ──────────── LEARN-01 第 4 条：本单元证据状态与「已阅读」 ──────────── */

describe('M3 学习工作台 · 本单元证据状态', () => {
  it('六格逐条列出，勾与文字双通道；上层没传状态时全部按「未成立」读', () => {
    const { container } = renderWorkspace()
    const list = container.querySelector('.cw-evidence-state-list')
    expect(list?.querySelectorAll('li').length).toBe(6)
    expect(container.querySelectorAll('.cw-evidence-state-glyph')).toHaveLength(6)
    expect(container.textContent).toContain('已阅读')
    expect(container.textContent).toContain('延迟复测掌握')
    expect(container.querySelectorAll('li.is-held').length, '没有记录就不许有勾').toBe(0)
    // 每一格还带一句「这一条说了谁判的」，不让人把痕迹读成掌握
    expect(container.textContent).toContain('不是完成证明')
    expect(container.textContent).toContain('系统未比对输出')
  })

  it('传进来的状态照原样点亮，本组件不自己看 note 猜', () => {
    const { container } = renderWorkspace({
      evidenceStates: {
        read: true,
        practiced: false,
        submittedEvidence: false,
        selfDeclaredPassed: false,
        autoVerifiedPassed: false,
        reviewMastered: false,
      },
    })
    expect(container.querySelectorAll('li.is-held').length).toBe(1)
    expect(container.querySelector('li.is-held')?.textContent).toContain('已阅读')
    expect(container.querySelector('li.is-absent')?.textContent).toContain('已练习')
  })

  it('「标记已阅读」只在给了回调且没标记过时出现；标记之后换成一句说明', () => {
    const onMarkRead = vi.fn()
    const { container } = renderWorkspace({ onMarkRead })
    const button = container.querySelector<HTMLButtonElement>('.cw-mark-read')
    expect(button).toBeTruthy()
    fireEvent.click(button as HTMLButtonElement)
    expect(onMarkRead).toHaveBeenCalledTimes(1)
    cleanup()

    const marked = renderWorkspace({ onMarkRead, readMarked: true })
    expect(marked.container.querySelector('.cw-mark-read'), '重复标记只会多出同样一条信号，那是假数据').toBeNull()
    expect(marked.container.textContent).toContain('已标记阅读')
    cleanup()

    const noWiring = renderWorkspace({})
    expect(noWiring.container.querySelector('.cw-mark-read'), '上层没接回调时不画一个按了没用的按钮').toBeNull()
  })
})

/* ─────────── #105：详情在路上的那一秒不许说「没有」 ─────────── */

describe('M3 学习工作台 · 详情加载中的那一秒', () => {
  /** 目录级占位形状：没有原文、code 是空串（`loadLessonDetail` 还没回来）。 */
  const pendingLesson = () => baseLesson({ code: '', reading: undefined })

  it('不说「没有配套代码」也不说「没有验收点」，完成按钮锁住并写明原因', () => {
    const { container } = renderWorkspace({ lesson: pendingLesson(), detailPending: true, runStatus: 'idle' })
    // 整页找字符串会被占位文案里那句引用话术自己撞上，所以判**下结论的那两个元素**：
    // 结论分支根本没渲染，占位分支在说「还在读」。
    const claim = container.querySelector('.lesson-code-area .workspace-external-note, .workspace-external-note')
    expect(claim?.textContent).toContain('代码与练习契约还在路上')
    expect(claim?.textContent).not.toContain('本单元没有配套代码：')
    const verifyLine = container.querySelector('.cw-verify-none')
    expect(verifyLine?.textContent).toContain('本课的练习契约还在读取')
    expect(verifyLine?.textContent).not.toContain('本课没有结构化验收点（')
    const block = container.querySelector('.cw-reading-pending')
    expect(block?.getAttribute('aria-busy')).toBe('true')
    expect(block?.textContent).toContain('原文与练习契约正在从内容服务读取')
    const button = container.querySelector('.lesson-complete-row .subtle-button') as HTMLButtonElement
    expect(button.disabled, '还没看过这一题的验收点就不该能记完成').toBe(true)
    expect(button.textContent).toContain('详情读取中，暂不可标记')
  })

  it('分区导航在这一秒就已经列出「阅读」锚点（下面整列跳位的真正来源）', () => {
    const { container } = renderWorkspace({ lesson: pendingLesson(), detailPending: true, runStatus: 'idle' })
    const links = Array.from(container.querySelectorAll('nav.cw-pane-nav a')).map((a) => a.getAttribute('href'))
    expect(links).toContain('#cw-pane-reading')
    expect(container.querySelector('#cw-pane-reading')).toBeTruthy()
  })

  it('不是加载中的纯阅读课，照旧明说没有配套代码（这条守卫不许被占位分支吞掉）', () => {
    const { container } = renderWorkspace({ lesson: pendingLesson(), detailPending: false, runStatus: 'idle' })
    expect(container.textContent).toContain('本单元没有配套代码')
    expect(container.querySelector('.cw-reading-pending')).toBeNull()
    const button = container.querySelector('.lesson-complete-row .subtle-button') as HTMLButtonElement
    expect(button.disabled, '没有契约可判的旧内置课仍可标完成，但记的是自行声明').toBe(false)
  })

  it('详情落地后占位与锁全部退场，原有说明与按钮回到现役口径', () => {
    const { container } = renderWorkspace({ lesson: baseLesson(), detailPending: false, runStatus: 'idle' })
    expect(container.querySelector('.cw-reading-pending')).toBeNull()
    expect(container.textContent).toContain('主题原文')
  })

  /**
   * 01 号方案 §4 的 error 行：「读失败」与「教材没有」是两句话。
   * 改版前这两条都掉进同一句「本单元没有配套代码」，等于把服务故障说成教材缺内容。
   */
  it('读取失败：说原因、给重试，不下「没有配套代码」的结论', () => {
    const onRetryDetail = vi.fn()
    const { container } = renderWorkspace({
      lesson: pendingLesson(),
      detailPending: false,
      detailError: '内容服务返回 500：快照读取失败',
      onRetryDetail,
    })
    const block = container.querySelector('.cw-reading-error')
    expect(block, '失败态必须挂在原文区').toBeTruthy()
    expect(block?.getAttribute('role'), '失败要播报，不能只换一行灰字').toBe('alert')
    expect(container.querySelector('.cw-reading-error-reason')?.textContent).toContain('内容服务返回 500')
    expect(container.querySelector('.cw-reading-error-note')?.textContent).toContain('不是因为资料库里没有这一节')
    const claim = container.querySelector('.workspace-external-note')
    expect(claim?.textContent, '失败时不许下「本单元没有配套代码」的结论').not.toContain('本单元没有配套代码：')
    expect(claim?.textContent).toContain('代码与练习契约没有读回来')
    expect(container.querySelector('.cw-reading-pending'), '失败不是加载中，两种形态互斥').toBeNull()
    const retry = container.querySelector('.cw-reading-retry') as HTMLButtonElement
    expect(retry).toBeTruthy()
    fireEvent.click(retry)
    expect(onRetryDetail, '重试必须真的接上动作').toHaveBeenCalledOnce()
    const links = Array.from(container.querySelectorAll('nav.cw-pane-nav a')).map((a) => a.getAttribute('href'))
    expect(links, '失败区仍是原文锚点的目标，导航不能指空').toContain('#cw-pane-reading')
  })

  it('失败态没有重试回调时只说原因，不画一个按了没用的按钮', () => {
    const { container } = renderWorkspace({ lesson: pendingLesson(), detailPending: false, detailError: '网络中断' })
    expect(container.querySelector('.cw-reading-error-reason')?.textContent).toContain('网络中断')
    expect(container.querySelector('.cw-reading-retry'), '画一个按不动的按钮就是假动作').toBeNull()
  })
})

describe('M3 学习工作台 · 持续资源审计', () => {
  /** 本页渲染树里会出现的全部源码文件（含多处复用的子组件），键与 glob 一致。 */
  const pageFiles = [
    './learning-workspace-view.tsx',
    './code-editor.tsx',
    './console-panel.tsx',
    './variable-panel.tsx',
    './runtime-controls.tsx',
    './flow-chart.tsx',
    './content-source-view.tsx',
    '../content/markdown.tsx',
    '../content/markdown-body.ts',
    '../content/wiki-link.tsx',
  ]

  it('这些文件里没有任何 canvas / WebGL / WebGPU 入口（§5.3.2 无需降级层，实测为 0）', () => {
    for (const file of pageFiles) {
      const src = sourceOf(file)
      expect(src, file).not.toMatch(/getContext\s*\(|OffscreenCanvas|<canvas|createElement\(\s*['"]canvas|navigator\.gpu|WebGL|WebGPU|import\(\s*['"].*gpu/)
      expect(src, file).not.toMatch(/setInterval\s*\(/)
    }
  })

  it('原生监听器全部成对摘除（注册次数 === 摘除次数）', () => {
    const report: Record<string, [number, number]> = {}
    for (const file of pageFiles) {
      const src = sourceOf(file)
      report[file] = [
        (src.match(/\.addEventListener\s*\(/g) ?? []).length,
        (src.match(/\.removeEventListener\s*\(/g) ?? []).length,
      ]
    }
    // 已实测到的注册点：code-editor 的 window keydown（Tab 缩进）、wiki-link 的 Esc 关闭
    expect(report['./code-editor.tsx']).toEqual([1, 1])
    expect(report['../content/wiki-link.tsx']).toEqual([1, 1])
    for (const [file, [added, removed]] of Object.entries(report)) {
      expect(added, file).toBe(removed)
    }
  })

  it('requestAnimationFrame 只用于编辑器光标恢复和滚动合帧，无持续循环且有取消', () => {
    const total = pageFiles.reduce((sum, file) => sum + ((sourceOf(file).match(/requestAnimationFrame/g) ?? []).length), 0)
    expect(total).toBe(2)
    const editor = sourceOf('./code-editor.tsx')
    expect(editor).toMatch(/window\.requestAnimationFrame\(\(\)\s*=>/)
    expect(editor).not.toMatch(/requestAnimationFrame\(\s*(frame|loop|tick)/)
    expect(editor).not.toMatch(/\bloop\b\s*\(/)
    expect(editor).toContain('window.cancelAnimationFrame(scrollFrame.current)')
    expect(editor).toContain('if (scrollFrame.current !== null) return')
  })

  it('本页无 XSS 出口：不用 dangerouslySetInnerHTML / innerHTML', () => {
    expect(sourceOf('./learning-workspace-view.tsx')).not.toMatch(/dangerouslySetInnerHTML|innerHTML/)
  })

  it('挂载—运行—单步—改代码—展开原文—卸载：探针看不到任何持续资源，监听器回到基线', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    const interval = vi.spyOn(window, 'setInterval')
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    const windowProbe = trackNativeListeners(window)
    const documentProbe = trackNativeListeners(document)

    const { container, props } = renderWorkspace({ runStatus: 'idle' })
    expect(windowProbe.live()).toBeGreaterThanOrEqual(1) // 编辑器的全局 keydown（Tab 缩进）
    // document 上可能挂着 React 19 为受控 textarea 注册的 selectionchange 追踪器：
    // 那是框架自身的资源，不属于本页，因此只要求「卸载后回到基线」，见下面的断言。

    fireEvent.click(screen.getByRole('button', { name: /单步执行/ }))
    fireEvent.click(screen.getByRole('button', { name: /开始运行/ }))
    fireEvent.change(container.querySelector('textarea') as HTMLTextAreaElement, { target: { value: 'x = 1' } })
    fireEvent.click(screen.getByRole('button', { name: '查看主题原文' }))
    fireEvent.click(screen.getByRole('button', { name: '课程指南' }))
    expect(props.onStep).toHaveBeenCalledTimes(1)

    expect(container.querySelectorAll('canvas')).toHaveLength(0)
    expect(raf).not.toHaveBeenCalled()
    expect(interval).not.toHaveBeenCalled()
    expect(getContext).not.toHaveBeenCalled()

    cleanup()
    // 卸载后回到基线：本页与子组件都没有留下监听器、帧回调或定时器
    expect(windowProbe.live()).toBe(0)
    expect(documentProbe.live()).toBe(0)
    expect(raf).not.toHaveBeenCalled()

    windowProbe.restore()
    documentProbe.restore()
  })
})

/* ─────────────── 4. CSS 不变式：§5.1 形态 / §5.3 / §5.4 ─────────────── */

describe('M3 学习工作台 · CSS 源码不变式', () => {
  it('解析器确实读到了规则（防止下面的断言在空集上假通过）', () => {
    expect(styleRules.length).toBeGreaterThan(60)
    expect(blockOf('.cw-workspace')).not.toBe('')
  })

  it('全局裸选择器数量 = 0：每条选择器都限定在 .cw-workspace 之下', () => {
    const bare = styleRules
      .flatMap((rule) => rule.selector.split(',').map((part) => part.trim()))
      .filter((selector) => selector !== '' && !selector.includes('.cw-workspace'))
    expect(bare).toEqual([])
  })

  it('#77 换标签没洗掉排版：h2 标题条必须与同头 span 吃同一份 label 规则', () => {
    const parts = (rule: CssRule) => rule.selector.split(',').map((part) => part.trim())
    const spanRule = styleRules.find((rule) => parts(rule).includes('.cw-workspace .reading-head span'))
    expect(spanRule, 'label 组规则找不到了').toBeTruthy()
    expect(
      parts(spanRule as CssRule).includes('.cw-workspace .reading-head .cw-pane-title'),
      'cw-pane-title 没在 label 组里：下面那条独立规则是三个 class，会盖过这组的字号/字重/字距/颜色',
    ).toBe(true)
    const own = styleRules.find((rule) => parts(rule).length === 1 && parts(rule)[0] === '.cw-workspace .reading-head .cw-pane-title')
    expect(own, '归零 UA 边距的独立规则找不到了').toBeTruthy()
    expect(
      (own as CssRule).block,
      '独立规则里只许写 margin：这里的 font / color / letter-spacing 会赢过 label 组，等于悄悄改视觉档',
    ).not.toMatch(/(^|[^-\w])(font|color|letter-spacing)\s*:/)
  })

  it('不声明 :root / html / body，也不覆写别人页面的类（只在容器内生效）', () => {
    const selectors = styleRules.map((rule) => rule.selector)
    expect(selectors.some((selector) => /(^|,)\s*(:root|html|body|\*)\b/.test(selector))).toBe(false)
    // 复用的子组件类名（挑战页/项目页也在用）一律带容器前缀
    for (const shared of ['.code-editor', '.panel', '.console-panel', '.variables-panel', '.run-bar', '.flow-chart']) {
      expect(selectors.filter((selector) => selector.includes(shared)).every((selector) => selector.startsWith('.cw-workspace'))).toBe(true)
    }
  })

  it('不赋值编辑器字号相关变量：用户设置的字号不会被本页盖掉（§5.4）', () => {
    expect(cssCode).not.toMatch(/--editor-font-size\s*:/)
    expect(cssCode).not.toMatch(/--line-height-editor\s*:/)
    for (const selector of [
      '.cw-workspace .code-editor',
      '.cw-workspace .code-editor textarea',
      '.cw-workspace .code-tokens',
      '.cw-workspace .line-numbers',
    ]) {
      const block = blockOf(selector)
      expect(block, selector).not.toBe('')
      expect(block, selector).toContain('var(--editor-font-size, 13px)')
      expect(block, selector).toMatch(/font-size:\s*var\(--editor-font-size, 13px\)/)
      expect(block, selector).not.toMatch(/font-size:\s*\d/)
    }
  })

  it('长代码行横向滚动而不是折行挤压', () => {
    const area = blockOf('.cw-workspace .code-editor textarea')
    expect(area).toContain('white-space: pre')
    expect(area).toContain('word-break: normal')
    expect(area).toContain('overflow-wrap: normal')
    expect(area).toContain('overflow-x: auto')
    expect(blockOf('.cw-workspace .code-tokens')).toContain('white-space: pre')
    expect(blockOf('.cw-workspace .console-body')).toContain('white-space: pre')
    expect(blockOf('.cw-workspace .console-body')).toContain('overflow: auto')
    expect(blockOf('.cw-workspace .reading-pane .md-view .md-code')).toContain('white-space: pre')
    expect(cssCode).not.toMatch(/white-space:\s*pre-wrap/)
    expect(cssCode).not.toMatch(/scrollbar-width:\s*none|::-webkit-scrollbar/)
  })

  it('阅读区正文 ~16px、行高落在 1.6–1.75（§5.4）', () => {
    const root = blockOf('.cw-workspace')
    expect(root).toContain('--cw-body: var(--ds-size-body, 16px)')
    const leading = /--cw-leading:\s*var\(--ds-leading-body,\s*([\d.]+)\)/.exec(root)?.[1]
    expect(Number(leading)).toBeGreaterThanOrEqual(1.6)
    expect(Number(leading)).toBeLessThanOrEqual(1.75)
    const reading = blockOf('.cw-workspace .reading-pane .md-view')
    expect(reading).toContain('font-size: var(--cw-body)')
    expect(reading).toContain('line-height: var(--cw-leading)')
    expect(reading).toContain('font-family: var(--cw-ui)') // 长文用中文 UI 栈，不是等宽
  })

  it('字号地板：本页没有低于自设 --cw-label 的字面量，也不把基座 flow-node 的 §5.4 裁定压回去', () => {
    const floor = Number(/--cw-label:\s*(\d+(?:\.\d+)?)px/.exec(blockOf('.cw-workspace'))?.[1])
    expect(floor).toBeGreaterThanOrEqual(12)
    const small = [...cssCode.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)]
      .map((match) => Number(match[1]))
      .filter((px) => px < floor)
    expect(small, `低于 --cw-label ${floor}px 的字面量字号：${small.join(', ')}`).toEqual([])
    // 字号上了令牌之后，只看字面量会漏：`font-size: var(--ds-size-meta, 10.5px)` 没有 px 字面量
    // 却照样是 10.5px。所以令牌消费的兜底值一起纳入地板核对（兜底值本身另有守卫保证与定义相等）。
    const viaToken = [...cssCode.matchAll(/font-size:\s*var\(--ds-size-[a-z]+,\s*(\d+(?:\.\d+)?)px\)/g)]
      .map((match) => Number(match[1]))
      .filter((px) => px < floor)
    expect(viaToken, `低于 --cw-label ${floor}px 的令牌档：${viaToken.join(', ')}`).toEqual([])
    // 节点标签字号只在基座说一次（13px，§5.4「节点标签是必读文字」）。本页曾以
    // .cw-workspace .flow-node 把它压回 11px，因该文件从没钉过字号地板断言而存活——M4 死规则第 2 条。
    // 2026-09-29 重做竖向步进器：13px 的 §5.4 裁定从节点块的 `div.flow-node` 挪到
    // 「这一拍做了什么」那一行文字上（`span.flow-node-label`）——节点块现在只带等宽字栈，
    // 字号归真正承载标签的那个元素，裁定本身没动。
    expect(blockOf('.cw-workspace .flow-node')).not.toMatch(/font-size/)
    expect(baseCssCode).toMatch(/div\.flow-node\s*\{[^}]*font-family:/)
    expect(baseCssCode).toMatch(
      /span\.flow-node-label\s*\{[^}]*font-size:\s*(?:13px|var\(--ds-size-control,\s*13px\))/,
    )
  })

  it('形态：黑场 + 1px 发丝线 + 遮光层；无玻璃卡、渐变按钮与泛光（§5.1）', () => {
    const declarations = styleRules.flatMap((rule) => rule.block.split(';').map((decl) => decl.trim()))
    const shadows = declarations.filter((decl) => /^(-webkit-)?box-shadow\s*:/.test(decl))
    const filters = declarations.filter((decl) => /^(-webkit-)?(backdrop-)?filter\s*:/.test(decl))
    expect(shadows.length).toBeGreaterThan(6) // styles.css 的玻璃投影/泛光确实在被覆写
    expect(filters.length).toBeGreaterThan(3) // backdrop-filter: blur(14px) 的玻璃层确实在被取消
    // 玻璃：只允许出现「关掉」这一种写法；泛光改走 --cw-glow-*（科技档反转，tokens §4.5）。
    // 约束不放松 —— 不允许裸投影字面量，也不允许任何模糊函数。
    expect(filters.every((decl) => /:\s*none$/.test(decl))).toBe(true)
    // --cw-glow-line 是当前执行行的零模糊自发光（本质是 1px 实线，不是投影），
    // 因此它允许在这份「形态」断言里出现；其余仍只允许三档泛光或关掉。
    for (const decl of shadows) {
      expect(/:\s*(none|var\(--(cw|ds)-glow-(near|panel|inset|line)(,\s*[^;]+)?\))$/.test(decl), decl).toBe(true)
    }
    expect(cssCode).not.toMatch(/blur\(|drop-shadow\(/)
    expect(cssCode).not.toMatch(/@(repeating-)?(linear|radial|conic)-gradient/)
    expect(blockOf('.cw-workspace')).toContain('--cw-canvas: var(--ds-canvas, #000)')
    expect(blockOf('.cw-workspace .cw-pane')).toContain('background: var(--cw-canvas)')
    expect(blockOf('.cw-workspace .cw-pane')).toContain('border: var(--cw-line-width) solid var(--cw-line)')
    expect(cssCode).toContain('--cw-scrim: rgb(14, 14, 15)')
    expect(blockOf('.cw-workspace .code-editor')).toContain('background: var(--cw-scrim)')
    // 圆角只允许模板三档（0 / 50% 圆环 / 100px 药丸）与 --ds-radius-panel 的 0，不出现自造圆角卡片
    const radii = declarations.filter((decl) => /^border-radius\s*:/.test(decl))
    const allowedRadius = /^border-radius:\s*(0|var\(--ds-(shape-(none|circle|pill)|radius-(panel|control)),\s*[^;)]+\))$/
    expect(radii.length).toBeGreaterThan(10)
    expect(radii.filter((decl) => !allowedRadius.test(decl))).toEqual([])
  })

  it('场景在工作台内固定：--ds-scene-active 只被引用一次，不做逐帧变色（§5.1）', () => {
    expect((cssCode.match(/var\(--ds-scene-active/g) ?? []).length).toBe(1)
    expect(cssCode).toContain('--cw-scene: var(--ds-scene-active, var(--ds-scene-singularity, rgb(34, 211, 238)))')
    // 语义状态色与场景色分家，且不参与任何动画
    for (const token of ['--ds-status-success', '--ds-status-warning', '--ds-status-danger', '--ds-status-info']) {
      expect(cssCode).toContain(token)
    }
  })

  it('每个 --ds-* 令牌消费都带兜底值，且本页不 import 令牌文件（共享层负责接入）', () => {
    expect(cssCode.match(/var\(--ds-[a-z0-9-]+\)/g) ?? []).toEqual([])
    const tsx = sourceOf('./learning-workspace-view.tsx')
    expect(tsx).toContain("import './learning-workspace-view.css'")
    expect(tsx).not.toMatch(/design\/tokens\.css/)
  })

  it('本页不引入任何 @keyframes 与无限动画（§5.3.1 静态环境）', () => {
    expect(cssCode).not.toMatch(/@keyframes/)
    expect(cssCode).not.toMatch(/\binfinite\b/)
    expect(cssRules.filter((rule) => rule.insideKeyframes)).toEqual([])
    const animations = styleRules.flatMap((rule) => rule.block.split(';')).filter((decl) => /^\s*animation\s*:/.test(decl))
    expect(animations.length).toBeGreaterThan(1)
    expect(animations.every((decl) => /:\s*none\b/.test(decl.trim()))).toBe(true)
  })

  it('减动效两道开关都是「真正停止」：系统偏好与 .reduce-motion 都写 animation/transition: none', () => {
    const guardStart = cssCode.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(guardStart).toBeGreaterThan(-1)
    const guards = cssCode.slice(guardStart)
    expect(guards).toContain('@media (prefers-reduced-motion: reduce)')
    expect(guards).toContain('.reduce-motion .cw-workspace')
    expect((guards.match(/animation: none !important/g) ?? []).length).toBe(2)
    expect((guards.match(/transition: none !important/g) ?? []).length).toBe(2)
    expect((guards.match(/scroll-behavior: auto !important/g) ?? []).length).toBe(2)
    // 放慢式（模板原实现：时间 ×0.35 / 只改 duration）不算停止，这里一律禁止
    expect(guards).not.toMatch(/animation-duration|transition-duration|\*?\s*0\.35|scale\(/)
    // !important 只允许出现在这两道减动效开关里
    expect(cssCode.slice(0, guardStart)).not.toContain('!important')
  })

  it('焦点与触控目标：暖白焦点环（模板 0.14 细线只有 1.32:1，不能承担焦点）+ 44px', () => {
    expect(cssCode).toContain('--cw-tap: var(--ds-tap-min, 44px)')
    expect(cssCode).toContain('min-height: var(--cw-tap)')
    expect(blockOf('.cw-workspace')).toContain('--cw-focus: var(--ds-focus-ring, rgba(220, 233, 251, 0.72))')
    expect(blockOf('.cw-workspace')).toContain('--cw-focus-off: var(--ds-focus-offset, 2px)')
    const focus = blockOf('.cw-workspace :focus-visible')
    expect(focus).toContain('outline: var(--cw-focus-w) solid var(--cw-focus)')
    expect(focus).toContain('outline-offset: var(--cw-focus-off)')
    expect(cssCode).not.toMatch(/outline(-style)?:\s*(none|0)\s*[;!]/)
    // §5.4 命中区复测（#51）钉住的三条：分区导航链接、顶栏药丸、运行控制条。
    // 这一档原本只有 `padding: 10px 14px`（20px 行盒 + 20 = 40 高），浏览器实测
    // 就是 40，不达 44；改为「min-height 走令牌 + 上下各 12px」后正好 44。
    const paneNavA = blockOf('.cw-workspace .cw-pane-nav a')
    expect(paneNavA).toContain('padding: var(--ds-space-12, 12px) var(--ds-space-14, 14px)')
    expect(paneNavA).toContain('min-height: var(--cw-tap)')
    // 顶栏与运行控制条以前写死 40px，而本文件末的 ≤760px 媒体查询又把同一批控件
    // 抬回 var(--cw-tap)：40 是桌面漏档，不是设计决定，三处选择器一律回到令牌。
    for (const sel of [
      '.cw-workspace .back-button',
      '.cw-workspace .reset-button',
      '.cw-workspace .step-button',
      '.cw-workspace .run-button',
      '.cw-workspace .subtle-button',
    ]) {
      expect(blockOf(sel), sel).toContain('min-height: var(--cw-tap)')
    }
    expect(cssCode).not.toMatch(/min-height:\s*40px/)
    // 「复制」是状态条上的次级文字按钮，撑盒子会把 34px 的 code-footer 顶到 60，
    // 因此它走本库既有的伪元素档：视觉 28px 不动，::before 外扩 ±8px 补到 44 高。
    expect(blockOf('.cw-workspace .editor-actions button')).toContain('position: relative')
    const copyHit = blockOf('.cw-workspace .editor-actions button::before')
    expect(copyHit).toContain("content: ''")
    expect(copyHit).toContain('position: absolute')
    expect(copyHit).toContain('inset: -8px -6px')
  })

  it('#58 长课名在 320px 不许被挤成一字一行：标题的 flex basis 是 auto 而不是 0%', () => {
    // 基座 styles.css:934 写的是 `flex: 1`（= basis 0%）。在**可换行**的 flex 容器里，
    // basis 0% 等于「永远算放得下」，flex-wrap 于是永不触发，标题只能吃同行剩下的宽度。
    // 长文本补测（report-states-final2 → injectedTitle['workspace@320x844']）量到
    // 盒宽 24px、110 字排成 69.5 行；改 basis auto 后同一格是 226px / 6 行。
    expect(blockOf('.cw-workspace .learning-title')).toMatch(/flex:\s*1 1 auto/)
    expect(blockOf('.cw-workspace .learning-header')).toContain('flex-wrap: wrap')
  })

  it('响应式：移动优先单列，两列只出现在 min-width 断点里；320px 有专门降级', () => {
    expect(blockOf('.cw-workspace .learning-view')).toContain('grid-template-columns: minmax(0, 1fr)')
    const firstMinWidth = cssCode.indexOf('@media (min-width:')
    expect(cssCode.slice(0, firstMinWidth)).not.toContain('1.25fr')
    expect(cssCode).toMatch(/@media \(min-width: 1081px\)/)
    expect(cssCode).toMatch(/@media \(max-width: 760px\)/)
    expect(cssCode).toMatch(/@media \(max-width: 380px\)/)
    expect(blockOf('.cw-workspace')).toContain('min-width: 0')
  })

  it('对比度纪律：三级色（0.34，实测 2.69:1）只用于纯装饰点，不承载文字信息', () => {
    const faintUsers = styleRules.filter((rule) => rule.block.includes('var(--cw-fg-faint)')).map((rule) => rule.selector)
    expect(faintUsers).toEqual(['.cw-workspace .variable-dots'])
  })
})

/* ─────────────────────────── 5. 无障碍结构 ─────────────────────────── */

describe('M3 学习工作台 · 无障碍（axe-core）', () => {
  it('四区 + 导航 + 运行控制 + 来源结构无 axe 违规', async () => {
    const { container } = renderWorkspace({ isDirty: true, completed: true })
    const results = await axe.run(container, {
      rules: {
        // jsdom 无真实布局：色彩对比与触控尺寸由上面的 CSS 源码不变式与浏览器复核承担
        'color-contrast': { enabled: false },
        'target-size': { enabled: false },
      },
    })
    expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.html.slice(0, 60)).join(' | ')}`)).toEqual([])
  })

  it('分区有可读名字，导航是 nav 地标，装饰序号对读屏隐藏', () => {
    const { container } = renderWorkspace()
    expect(container.querySelector('section.workspace')?.getAttribute('aria-label')).toBe('阅读与代码区')
    expect(container.querySelector('section.right-panels')?.getAttribute('aria-label')).toBe('运行观察区')
    expect(container.querySelector('div.cw-pane-nav')).toBeNull()
    expect(container.querySelector('nav.cw-pane-nav')).toBeTruthy()
    const decorative = container.querySelectorAll('.cw-pane-no')
    expect(decorative.length).toBe(4)
    for (const node of Array.from(decorative)) expect(node.getAttribute('aria-hidden')).toBe('true')
  })
})
