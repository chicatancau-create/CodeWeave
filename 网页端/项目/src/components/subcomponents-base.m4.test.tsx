// @vitest-environment jsdom
/**
 * M4 全站统一 · 编辑器 / 控制台 / 变量 / 运行控制 / 流程图 —— **子组件基座**契约测试
 *
 * 背景（为什么这一组断言值得存在）：M3 做学习工作台时把外观限定在页面容器作用域内
 * （learning-workspace-view.css 的 169 条规则全部以 `.cw-workspace` 起头），基座本身
 * 仍散落在 styles.css 的裸类名规则里。本路把基座切到 --ds-* 令牌，于是必须同时证明两件事：
 *
 *   A. 基座自己确实是黑场 + 发丝线 + 三档圆角 + 无泛光 + 无持续动画（§5.1 / §5.3 / §5.4）；
 *   B. 基座改动**没有**把工作台带偏 —— 页面作用域的覆写仍然赢。
 *
 * B 的证法不是「跑一遍看像不像」，而是可机读的层叠审计（第二组）：
 * 实测 dist/assets/index-*.css 里 styles.css 排在全部组件样式**之后**
 * （组件样式占 0–95k，styles.css 的 :root 起于 94879），所以同特异度时 styles.css 赢。
 * 基座因此只在 (c) 档（类型选择器）抬一位、(b) 档（类）与 styles.css 保持相等；
 * 而 `.cw-workspace X` 比 styles.css 的 `X` 恰好多一个类 → 恒高于基座。
 * 这里逐条解析三方（基座 / styles.css / 页面覆写）的同一条选择器，把该关系当成断言而不是注释。
 *
 * jsdom 不做层叠与布局，观感类判定一律走样式表源码文本（与
 * learning-workspace-view.m3.test.tsx、tests/styles.focus.test.mjs 同一口径）；
 * 结构、文案与回调（运行 / 单步 / 重置的调用）用真实渲染核对。
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CodeEditor } from './code-editor'
import { ConsolePanel } from './console-panel'
import { FlowChart, type FlowStep } from './flow-chart'
import { RuntimeControls } from './runtime-controls'
import { VariablePanel } from './variable-panel'
import type { VariableValue } from '../types/lesson'

type NodeFsModule = { readFileSync: (path: string, encoding: 'utf8') => string }
type NodePathModule = { resolve: (...parts: string[]) => string }
type NodeProcessModule = { cwd: () => string }

type SelectorRef = { raw: string; key: string }
type CssRule = { selector: string; selectors: SelectorRef[]; block: string; atRules: string[]; insideKeyframes: boolean }

/** 本路的六个基座文件：五个同名文件 + 两个面板共用的一份外壳。 */
const BASE_FILES = [
  'code-editor.css',
  'panel-shell.css',
  'console-panel.css',
  'variable-panel.css',
  'runtime-controls.css',
  'flow-chart.css',
] as const

const STYLESHEET = 'styles.css'
const WORKSPACE = 'learning-workspace-view.css'

const rawSources = import.meta.glob(
  ['./code-editor.tsx', './console-panel.tsx', './variable-panel.tsx', './runtime-controls.tsx', './flow-chart.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

const cssText = new Map<string, string>()
const cssRules = new Map<string, CssRule[]>()

beforeAll(async () => {
  const fs = await vi.importActual<NodeFsModule>('node:fs')
  const path = await vi.importActual<NodePathModule>('node:path')
  const proc = await vi.importActual<NodeProcessModule>('node:process')
  const root = proc.cwd()
  const targets = [...BASE_FILES.map((file) => [file, `src/components/${file}`] as const), [STYLESHEET, `src/${STYLESHEET}`] as const, [WORKSPACE, `src/components/${WORKSPACE}`] as const]
  for (const [name, relative] of targets) {
    const source = stripComments(fs.readFileSync(path.resolve(root, relative), 'utf8'))
    cssText.set(name, source)
    cssRules.set(name, collectRules(source))
  }
  // 防假通过：三方都确实读到了规则
  expect((cssRules.get(STYLESHEET) ?? []).length).toBeGreaterThan(400)
  expect((cssRules.get(WORKSPACE) ?? []).length).toBeGreaterThan(150)
  for (const file of BASE_FILES) expect((cssRules.get(file) ?? []).length, file).toBeGreaterThan(5)
})

/** 注释里的示例与说明不参与判定（M3 记录 §3 同一口径：只核规则）。 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 扁平收集「选择器 → 声明块」，同时标记 @media / @keyframes 归属。 */
function collectRules(source: string): CssRule[] {
  const collected: CssRule[] = []
  const atStack: string[] = []
  let buffer = ''
  let index = 0
  while (index < source.length) {
    const char = source[index] as string
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
      while (index < source.length && depth > 0) {
        const inner = source[index] as string
        if (inner === '{') depth += 1
        else if (inner === '}') depth -= 1
        index += 1
      }
      collected.push({
        selector: head,
        selectors: head
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
          .map((raw) => ({ raw, key: normalizeSelector(raw) })),
        block: source.slice(start, index - 1),
        atRules: [...atStack],
        insideKeyframes: atStack.includes('@keyframes'),
      })
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
  return collected
}

/**
 * 选择器归一：剥掉类型名前缀（`div.` / `span.` / `section.` / `pre.` / `textarea.` /
 * `button.`）、把 `>` 收成后代、压实空白。归一后三方的「同一条选择器」可比字符串；
 * 特异度仍按**原始**选择器算（归一会把要核对的那一位抹掉）。
 */
function normalizeSelector(selector: string): string {
  return selector
    .replace(/\s*>\s*/g, ' ')
    .replace(/(^|[\s,+(])(?:div|span|section|pre|textarea|button)\./g, '$1.')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 特异度三元组 [id, 类/属性/伪类, 类型/伪元素]，输入是**原始**选择器。 */
function specificity(selector: string): [number, number, number] {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length
  const classes =
    (selector.match(/\.[\w-]+/g) ?? []).length +
    (selector.match(/\[[^\]]*\]/g) ?? []).length +
    (selector.match(/:(?!:)[a-z-]+/gi) ?? []).length
  const types =
    (selector.match(/(?:^|[\s,+(])[a-z][a-z0-9-]*/gi) ?? []).filter((part) => !part.trim().startsWith('*')).length +
    (selector.match(/::[a-z-]+/gi) ?? []).length
  return [ids, classes, types]
}

/** 归一 key → 原始特异度列表；`cwWorkspacePrefix` 为真时只收页面作用域规则并去掉前缀。 */
function specIndexByRuleKey(list: CssRule[], options: { stripWorkspacePrefix?: boolean } = {}): Map<string, [number, number, number][]> {
  const index = new Map<string, [number, number, number][]>()
  for (const rule of list) {
    if (rule.insideKeyframes) continue
    for (const { raw, key } of rule.selectors) {
      if (options.stripWorkspacePrefix) {
        if (!key.startsWith('.cw-workspace ')) continue
        const rest = key.slice('.cw-workspace '.length)
        const bucket = index.get(rest) ?? []
        bucket.push(specificity(raw))
        index.set(rest, bucket)
        continue
      }
      const bucket = index.get(key) ?? []
      bucket.push(specificity(raw))
      index.set(key, bucket)
    }
  }
  return index
}

function rulesOf(file: string): CssRule[] {
  return cssRules.get(file) ?? []
}

/** 减动效两道开关里的规则：只写 none / auto，不参与层叠审计与颜色核对。 */
function isMotionGuard(rule: CssRule): boolean {
  return rule.atRules.includes('@media') || rule.selector.includes('.reduce-motion')
}

function declarationsOf(file: string, key: string): string[] {
  return rulesOf(file)
    .filter((rule) => !rule.insideKeyframes && rule.selectors.some((ref) => ref.key === key))
    .flatMap((rule) => rule.block.split(';').map((decl) => decl.trim()).filter(Boolean))
}

/**
 * 基座改了、而工作台**没有**同名覆写的选择器。逐条注明为什么不会把页面带偏；
 * 新增条目必须同时写理由，否则第 2 组用例会直接失败。
 */
const NEUTRAL_RESTATEMENT: Record<string, string> = {
  '.line-numbers-inner': '与 styles.css 同值（flex column + align-end），行号逐行对齐的前提',
  '.flow-track': '与 styles.css 同值',
  '.flow-step': '与 styles.css 同值',
  '.play-triangle': '与 styles.css 同值：11px 装饰字形，节点自带 aria-label（§5.3 第 6 条）',
  '.editor-actions': '与 styles.css 同值，只多一条 min-width: 0',
  '.variable-name': '与 styles.css 同值',
  '.run-copy div:last-child': '与 styles.css 同值，只多一条 min-width: 0',
}
const DELIBERATE_PAGE_CHANGE: Record<string, string> = {
  '.variable-row.changed': '「本步改过」的标记线由场景色改为固定暖白（§5.1 末段：标识不跟场景）',
  '.run-indicator.idle span': 'idle 档显式化：与默认圆点同为次级文字档（0.52 → 0.56，同族仅加固）',
  '.run-indicator.paused span': 'paused 原先没有状态档（掉回灰），基座补固定 --ds-status-warning',
  '.run-indicator.running': '运行中加一圈零模糊 outline 圆环：语义状态的「固定标识」第二通道（§5.1 形态保留圆环）',
  // EDIT-01 新增：这几条只在「设置项被打开」时才生效，工作台默认档不存在对应 class，
  // 因此不需要页面同名覆写；默认形态仍由上面那批 `.code-editor textarea` / `.code-tokens` 规则守。
  '.code-editor--wrap .code-tokens': '自动换行设置项：只在容器带 --wrap 时折行，默认不出现这条',
  '.code-editor--wrap textarea': '自动换行设置项：输入层与高亮层必须同一套折行规则，否则逐行错位',
  '.editor-keyhint': '页脚键盘模式提示：基座新增的次级文字，工作台无覆写（12px 必读档）',
  '.editor-copy-ok': '复制成功态文字：基座新增，颜色只作第二通道（文字本身已说明结果）',
  '.editor-copy-fail': '复制失败态文字：基座新增，同时加粗，不靠颜色单独表意',
  // EDIT-01 第 6 条：控制台页脚三个一次性动作（清空显示 / 复制输出 / 定位到第 N 行）。
  // 工作台的头部原本只有标题与状态两样东西，没有可覆写的同名规则；外观全部取 --ds-* 令牌，
  // 与工作台同一色系，不会出现「基座把工作台带偏」。
  '.console-actions': '控制台页脚动作容器：基座新增（清空/复制/定位），工作台无同名条目',
  '.console-action': '次级文字动作按钮：视觉 32px 档，命中区由 ::before 撑到 44（§5.4）',
  '.console-action::before': '命中区外扩伪元素：只有 -6px 的透明外扩，不画任何墨',
  '.console-action:hover': '悬停只把次级文字抬到实色，无位移无缩放',
  '.console-action:focus-visible': '焦点环取 --ds-focus-ring 档，与全站同一圈',
}

/* ─────────────── 1. 归属与边界：基座随组件走，不依赖页面作用域 ─────────────── */

describe('M4 子组件基座 · 归属与边界', () => {
  it('五个组件各自 import 自己的基座样式表（壳外复用也带形态）', () => {
    const pairs = [
      ['./code-editor.tsx', "import './code-editor.css'"],
      ['./console-panel.tsx', "import './console-panel.css'"],
      ['./console-panel.tsx', "import './panel-shell.css'"],
      ['./variable-panel.tsx', "import './variable-panel.css'"],
      ['./variable-panel.tsx', "import './panel-shell.css'"],
      ['./runtime-controls.tsx', "import './runtime-controls.css'"],
      ['./flow-chart.tsx', "import './flow-chart.css'"],
    ] as const
    for (const [file, statement] of pairs) {
      expect(rawSources[file], file).toContain(statement)
    }
  })

  it('基座不接管运行判定：五个组件源码里没有执行引擎、沙箱与定时器调用', () => {
    for (const [file, src] of Object.entries(rawSources)) {
      expect(src, file).not.toMatch(/use-execution|executeCode|new Function|setTimeout|setInterval/)
      if (file !== './code-editor.tsx') expect(src, file).not.toMatch(/requestAnimationFrame/)
    }
    // 仅光标恢复与滚动合帧可以调度 RAF，不允许自循环。
    const editor = rawSources['./code-editor.tsx'] ?? ''
    expect(editor).toMatch(/window\.requestAnimationFrame\(\(\)\s*=>/)
    expect(editor.match(/requestAnimationFrame/g)).toHaveLength(2)
    expect(editor).toContain('window.cancelAnimationFrame(scrollFrame.current)')
    expect(editor).not.toMatch(/requestAnimationFrame\(\s*(frame|loop|tick)/)
  })

  it('六个基座文件的全局裸选择器数量 = 0（不碰 :root / html / body / 裸 *）', () => {
    for (const file of BASE_FILES) {
      // 每条规则都要有类锚点；`X *` 这种「锚点之下的后代通配」允许（只用于减动效兜底）
      const unanchored = rulesOf(file)
        .filter((rule) => !rule.insideKeyframes)
        .filter((rule) => !rule.selectors.some((ref) => ref.key.includes('.')))
        .map((rule) => rule.selector)
      expect(unanchored, file).toEqual([])
      const leading = rulesOf(file)
        .filter((rule) => !rule.insideKeyframes)
        .flatMap((rule) => rule.selectors.map((ref) => `${rule.selector} #### ${ref.key}`))
        .filter((entry) => {
          const key = entry.split(' #### ')[1] ?? ''
          return /^(\*|:root|html|body)(\s|[,{]|$)/.test(key)
        })
      expect(leading, `${file}: ${JSON.stringify(leading)}`).toEqual([])
    }
  })
})

/* ───────────────── 2. 层叠审计：页面作用域覆写仍然赢 ───────────────── */

describe('M4 子组件基座 · 与 .cw-workspace 覆写的层叠关系', () => {
  it('基座只抬 (c) 档：与 styles.css 同一条选择器时类档相等、类型档更高', () => {
    const stylesIndex = specIndexByRuleKey(rulesOf(STYLESHEET))
    const violations: string[] = []
    let audited = 0
    for (const file of BASE_FILES) {
      for (const rule of rulesOf(file)) {
        if (rule.insideKeyframes || isMotionGuard(rule)) continue
        for (const { raw, key } of rule.selectors) {
          const shared = stylesIndex.get(key)
          if (!shared) continue
          audited += 1
          const [baseIds, baseClasses, baseTypes] = specificity(raw)
          const ok = shared.some(([, classes, types]) => baseIds === 0 && baseClasses === classes && baseTypes > types)
          if (!ok) violations.push(`${file}: ${raw} 基座(0,${baseClasses},${baseTypes}) 与 styles.css ${JSON.stringify(shared)} 不是「同类档、更高类型档」`)
        }
      }
    }
    expect(violations).toEqual([])
    expect(audited).toBeGreaterThan(35) // 确实在核对与 styles.css 的重叠条目，不是空集
  })

  it('基座覆写的每个元素，工作台都有类档更高的同名规则；没有覆写的只在白名单里', () => {
    const workspaceIndex = specIndexByRuleKey(rulesOf(WORKSPACE), { stripWorkspacePrefix: true })
    const pageVisible: string[] = []
    let mirrored = 0
    for (const file of BASE_FILES) {
      for (const rule of rulesOf(file)) {
        if (rule.insideKeyframes || isMotionGuard(rule)) continue
        for (const { raw, key } of rule.selectors) {
          const mirrors = workspaceIndex.get(key)
          if (mirrors) {
            mirrored += 1
            const base = specificity(raw)
            if (!mirrors.some(([, classes]) => classes > base[1])) {
              pageVisible.push(`${file}: ${raw} 页面覆写类档不高过基座 ${JSON.stringify(mirrors)}`)
            }
            continue
          }
          if (NEUTRAL_RESTATEMENT[key] || DELIBERATE_PAGE_CHANGE[key]) continue
          pageVisible.push(`${file}: ${raw} 既无 .cw-workspace 覆写，也不在白名单里`)
        }
      }
    }
    expect(pageVisible, JSON.stringify(pageVisible)).toEqual([])
    expect(mirrored).toBeGreaterThan(35) // 绝大多数基座条目确实被页面覆写压住
  })
  it('基座的 !important 只在减动效两块，且只写 none / auto（不夹带任何新形态）', () => {
    for (const file of BASE_FILES) {
      const escaped = rulesOf(file)
        .filter((rule) => !rule.insideKeyframes && !isMotionGuard(rule) && rule.block.includes('!important'))
        .map((rule) => rule.selector)
      expect(escaped, file).toEqual([])
      for (const rule of rulesOf(file).filter((item) => isMotionGuard(item) && item.block.includes('!important'))) {
        const flagged = rule.block.split(';').map((decl) => decl.trim()).filter((decl) => decl.includes('!important'))
        expect(flagged.length, file).toBeGreaterThan(0)
        expect(flagged.every((decl) => /^(animation|transition|scroll-behavior):\s*(none|auto)\s*!important$/.test(decl)), file).toBe(true)
      }
    }
  })
})

/* ─────────── 3. §5.4：编辑器字号只读、逐行对齐、长行横向滚动 ─────────── */

describe('M4 子组件基座 · 编辑器字号与对齐', () => {
  it('--editor-font-size / --line-height-editor 在六个基座文件里只被读取，从未被赋值', () => {
    for (const file of BASE_FILES) {
      const text = cssText.get(file) ?? ''
      expect(text, file).not.toMatch(/--editor-font-size\s*:/)
      expect(text, file).not.toMatch(/--line-height-editor\s*:/)
    }
    const editor = cssText.get('code-editor.css') ?? ''
    // 容器 / 行号层 / 高亮层 / 输入层四处必须读同一个变量，缺一处就逐行错位
    expect((editor.match(/var\(--editor-font-size, 13px\)/g) ?? []).length).toBeGreaterThanOrEqual(4)
    expect((editor.match(/var\(--line-height-editor, 1\.55\)/g) ?? []).length).toBeGreaterThanOrEqual(4)
  })

  it('行号层 / 输入层 / 高亮层：字号、行高、字栈同源，左右内边距成对', () => {
    for (const key of ['.code-editor', '.line-numbers', '.code-tokens', '.code-editor textarea']) {
      const decls = declarationsOf('code-editor.css', key)
      expect(decls, key).toContain('font-size: var(--editor-font-size, 13px)')
      expect(decls, key).toContain('line-height: var(--line-height-editor, 1.55)')
      expect(decls.some((decl) => /^font-family:\s*var\(--ds-font-mono/.test(decl)), key).toBe(true)
    }
    const padOf = (decls: string[]) => decls.find((decl) => /^padding:/.test(decl))
    const textarea = padOf(declarationsOf('code-editor.css', '.code-editor textarea'))
    expect(textarea).toBe('padding: 0 var(--ds-space-12, 12px) 0 var(--ds-space-10, 10px)')
    expect(padOf(declarationsOf('code-editor.css', '.code-tokens'))).toBe(textarea) // 逐列对齐
  })

  it('长代码行与 stdout：pre + 不折行 + 横向滚动，且没有 pre-wrap 与隐藏滚动条', () => {
    const byFile: Record<string, string[]> = {
      'code-editor.css': ['.code-editor textarea', '.code-tokens'],
      'console-panel.css': ['.console-body'],
      'variable-panel.css': ['.variable-value'],
    }
    for (const [file, keys] of Object.entries(byFile)) {
      for (const key of keys) {
        const decls = declarationsOf(file, key)
        expect(decls.length, `${file} ${key}`).toBeGreaterThan(0)
        expect(decls, `${file} ${key}`).toContain('white-space: pre')
        if (key !== '.variable-value') {
          expect(decls, `${file} ${key}`).toContain('word-break: normal')
          expect(decls, `${file} ${key}`).toContain('overflow-wrap: normal')
        }
        expect(decls.some((decl) => /^overflow(-x|-y)?:\s*(auto|hidden)/.test(decl)), `${file} ${key}`).toBe(true)
      }
    }
    for (const file of ['code-editor.css', 'console-panel.css', 'variable-panel.css']) {
      const text = cssText.get(file) ?? ''
      if (file === 'code-editor.css') {
        // EDIT-01 把「自动换行」做成了设置项，默认**关**：§5.4 长代码行那一格量的就是关着时的横向滚动。
        // 所以这条不变式收细成「默认规则里不许折行」，而不是「整个文件不许出现 pre-wrap」——
        // 折行只允许出现在容器带 `.code-editor--wrap` 的那两条规则里，下面逐条核对。
        const wrapRules = (cssRules.get(file) ?? []).filter((rule) => rule.selectors.some((s) => s.raw.includes('--wrap')))
        expect(wrapRules.length, '自动换行那组规则不见了（设置项就成了空开关）').toBeGreaterThan(0)
        // 折行规则允许拆成多条（同一条给两层，或再补一条只管的），所以按层核对而不是按条。
        const wrapText = wrapRules.map((rule) => rule.block).join('\n')
        for (const layer of ['textarea', 'pre.code-tokens']) {
          expect(wrapRules.some((rule) => rule.selectors.some((s) => s.raw.includes(layer) && /white-space:\s*pre-wrap/.test(rule.block))),
            `${layer} 那一层没有跟着折行 —— 两层折行规则不一致就会逐行错位`).toBe(true)
        }
        expect(wrapText).toContain('overflow-wrap: anywhere')
        const defaults = (cssRules.get(file) ?? [])
          .filter((rule) => !rule.selectors.some((s) => s.raw.includes('--wrap')))
          .map((rule) => rule.block).join('\n')
        expect(defaults).not.toMatch(/white-space:\s*pre-wrap/)
        expect(defaults).not.toMatch(/word-break:\s*(break-all|break-word)/)
      } else {
        expect(text, file).not.toMatch(/white-space:\s*pre-wrap/)
        expect(text, file).not.toMatch(/word-break:\s*(break-all|break-word)/)
      }
      expect(text, file).not.toMatch(/scrollbar-width:\s*none|::-webkit-scrollbar/) // 滚动条要可见、可定位
    }
  })

  it('当前执行行带高度 = 整数一个行高，且基座不再声明同名规则', () => {
    expect(declarationsOf('code-editor.css', '.code-highlight')).toContain(
      'height: calc(var(--editor-font-size, 13px) * var(--line-height-editor, 1.55))',
    )
    expect(declarationsOf('code-editor.css', '.code-highlight')).toContain('transition: none')
    // 基座那条 `height: calc(... + 4px)` 是死码（div.code-highlight 特异度更高，每条声明都被覆写），
    // 且 4px 会让带子压住下一行 —— 已从 styles.css 删除，这里钉住不许重建。
    expect(declarationsOf(STYLESHEET, '.code-highlight')).toHaveLength(0)
  })

  it('输入区焦点环被基座要回来（styles.css 的 outline: 0 同档且在后会赢）', () => {
    expect(declarationsOf(STYLESHEET, '.code-editor textarea')).toContain('outline: 0')
    const focus = declarationsOf('code-editor.css', '.code-editor textarea:focus-visible')
    expect(focus.some((decl) => /^outline:\s*var\(--ds-focus-ring-width/.test(decl))).toBe(true)
    expect(focus.some((decl) => /0\.72/.test(decl))).toBe(true)
  })
})

/* ───────────────── 4. §5.1 形态：黑场 / 发丝线 / 三档圆角 ───────────────── */

describe('M4 子组件基座 · 形态', () => {
  it('无玻璃、无渐变、无泛光：模糊与渐变函数出现 0 次', () => {
    for (const file of BASE_FILES) {
      const text = cssText.get(file) ?? ''
      expect(text.match(/(?:[a-z-]*blur\(|drop-shadow\()/gi) ?? [], file).toEqual([])
      expect(text, file).not.toMatch(/backdrop-filter:\s*(?:blur|saturate|brightness|contrast|grayscale|invert|sepia|opacity|hue-rotate)/)
      expect(text, file).not.toMatch(/@(repeating-)?(linear|radial|conic)-gradient/)
      expect(text, file).not.toMatch(/var\(--(glass|accent-gradient|glow-)/)
    }
  })

  it('黑场分区 + 1px 发丝线：结构线全部来自 --ds-line-* / --ds-canvas', () => {
    const lineDecl = /^(border|border-(top|right|bottom|left))(-width)?:/
    let lines = 0
    for (const file of BASE_FILES) {
      for (const rule of rulesOf(file).filter((item) => !item.insideKeyframes && !isMotionGuard(item))) {
        for (const decl of rule.block.split(';').map((item) => item.trim())) {
          if (!lineDecl.test(decl)) continue
          if (/:\s*0\b/.test(decl)) continue // 显式「不要边框」也是合规形态
          lines += 1
          // 结构线：发丝线 / 输入边界 / 焦点档；2px 标记线与状态描边允许用场景或状态档
          expect(decl, `${file}: ${decl}`).toMatch(
            /var\(--ds-(line-|field-|focus-|scene-glow-ring|radius-|shape-|shadow-)|2px solid var\(--ds-(scene|status)-|2px solid var\(--ds-text-|inset/,
          )
        }
      }
    }
    expect(lines).toBeGreaterThan(12)
    const canvas = BASE_FILES.filter((file) => (cssText.get(file) ?? '').includes('var(--ds-canvas, #000)'))
    expect(canvas.length).toBeGreaterThanOrEqual(4) // 编辑器 / 面板 / 控制台 / 流程图各自成区
  })

  it('box-shadow 只允许发光令牌、关掉、或零模糊零扩散的标记线', () => {
    // 科技档反转（tokens §4.5）：旧规「全站零投影」在深色画布上无法表达层级，
    // 改为冷色外发光。约束不放松 —— 面板/抬起面消费 --ds-glow-*（含 --ds-shadow-panel，
    // 它在 tokens 里已指向 --ds-glow-panel），状态标记线仍是零模糊零扩散的 inset。
    const allowed =
      /^box-shadow:\s*(none|var\(--ds-(shadow-panel|glow-(near|far|panel|inset)),\s*[^;]+\)|inset \d+px 0 0 [^;]+)$/
    const found: string[] = []
    for (const file of BASE_FILES) {
      const decls = rulesOf(file)
        .filter((rule) => !rule.insideKeyframes && !isMotionGuard(rule))
        .flatMap((rule) => rule.block.split(';').map((item) => item.trim()))
        .filter((item) => /^(-webkit-)?box-shadow\s*:/.test(item))
      for (const decl of decls) {
        found.push(`${file}: ${decl}`)
        expect(allowed.test(decl), `${file}: ${decl}`).toBe(true)
      }
    }
    expect(found.length).toBeGreaterThan(8)
  })

  it('圆角只有模板三档：0 / 50% 圆环 / 100px 药丸', () => {
    const allowed = /^border-radius:\s*(0|var\(--ds-(shape-(none|circle|pill)|radius-(panel|control)),\s*[^;)]+\))$/
    let count = 0
    for (const file of BASE_FILES) {
      const radii = rulesOf(file)
        .filter((rule) => !rule.insideKeyframes && !isMotionGuard(rule))
        .flatMap((rule) => rule.block.split(';').map((item) => item.trim()))
        .filter((item) => /^border-radius\s*:/.test(item))
      for (const decl of radii) {
        expect(allowed.test(decl), `${file}: ${decl}`).toBe(true)
        count += 1
      }
    }
    expect(count).toBeGreaterThan(8)
  })

  it('颜色只走 --ds-*（且带兜底），字面量只剩冷白一族的遮光档', () => {
    for (const file of BASE_FILES) {
      const text = cssText.get(file) ?? ''
      expect(text.match(/var\(--ds-[a-z0-9-]+\)/g) ?? [], file).toEqual([]) // 无兜底的令牌消费
      const stripped = text.replace(/var\(--ds-[a-z0-9-]+,[^)]*\)/g, '')
      expect(stripped.match(/#[0-9a-fA-F]{3,8}/g) ?? [], file).toEqual([]) // 十六进制只能在兜底位上
      for (const literal of stripped.match(/rgba?\([^)]*\)/g) ?? []) {
        // 科技档把暖白 #f4f1ee 换成冷白 #dce9fb：冷色画布上暖白显脏，且同一 α 下
        // 冷白更暗、对比度更低，故 tokens §5 对焦点环与字段边单独重算过。这里跟着换基色，
        // 约束不变 —— 基座文件里的裸色值仍只允许「同一族、只差 α」的一串。
        expect(literal, `${file}: ${literal}`).toMatch(/^rgba?\(220,\s*233,\s*251,\s*0\.\d+\)$/)
      }
    }
  })

  it('语义状态不跟场景：状态标识全部来自 --ds-status-* / --ds-text-*，且同处必有文字', () => {
    const statusSelectors: [string, string][] = [
      ['runtime-controls.css', '.run-indicator.idle span'],
      ['runtime-controls.css', '.run-indicator.running span'],
      ['runtime-controls.css', '.run-indicator.paused span'],
      ['runtime-controls.css', '.run-indicator.completed span'],
      ['runtime-controls.css', '.run-indicator.done span'],
      ['runtime-controls.css', '.run-indicator.error span'],
      ['runtime-controls.css', '.run-indicator.running'],
      ['console-panel.css', '.console-status.error'],
      ['console-panel.css', '.console-error'],
      ['variable-panel.css', '.variable-icon.blue'],
      ['variable-panel.css', '.variable-icon.coral'],
      ['variable-panel.css', '.variable-row.changed'],
      // 2026-09-29 重做竖向步进器：语气标签从节点块自己的类（.flow-node.blue）搬到
      // 「节点 + 语义档」两件套（span.flow-node-kind.tone-*）——语气说的是「这一拍会不会
      // 出事」，与节点形状无关，也就不该挂在节点身份上。
      ['flow-chart.css', '.flow-node-kind.tone-blue'],
      ['flow-chart.css', '.flow-node-kind.tone-yellow'],
      ['flow-chart.css', '.flow-node-kind.tone-coral'],
      ['flow-chart.css', '.flow-node-kind.tone-green'],
    ]
    for (const [file, key] of statusSelectors) {
      const decls = declarationsOf(file, key)
        .filter((decl) => /(color|background|border-color|box-shadow|outline)\s*:/.test(decl))
        .filter((decl) => !/:\s*(none|transparent|0)\b/.test(decl)) // 关掉形态的声明不参与取色核对
      expect(decls.length, `${file} ${key}`).toBeGreaterThan(0)
      for (const decl of decls) {
        // 状态标识不得用场景**色**（--ds-scene-glow-ring 只是环宽档，允许）
        expect(decl, `${file} ${key}`).not.toMatch(/--ds-scene-(active|singularity|nebula|tides|firstlight)|--accent/)
        expect(decl, `${file} ${key}`).toMatch(/--ds-(status|text)-/)
      }
    }
  })

  it('缓动只有 --ds-ease-standard；出现的交互时长落在 150–300ms', () => {
    for (const file of BASE_FILES) {
      const text = cssText.get(file) ?? ''
      for (const easing of text.match(/(cubic-bezier|linear|ease-in-out|ease-out|ease-in|steps)\(/g) ?? []) {
        expect(text.includes(`var(--ds-ease-standard, ${easing}`), `${file}: ${easing}`).toBe(true)
      }
      for (const raw of text.match(/(?:transition|animation):[^;]+/g) ?? []) {
        for (const ms of raw.match(/\b\d+ms\b/g) ?? []) {
          const value = Number.parseInt(ms, 10)
          expect(value, `${file}: ${raw}`).toBeGreaterThanOrEqual(150)
          expect(value, `${file}: ${raw}`).toBeLessThanOrEqual(300)
        }
      }
    }
  })
})

/* ─────────────── 5. §5.3：基座不含持续动画，两路径真停 ─────────────── */

describe('M4 子组件基座 · 动效降级', () => {
  it('六个基座文件都没有 infinite；动画声明要么 none 要么「播放 1 次」', () => {
    for (const file of BASE_FILES) {
      const text = cssText.get(file) ?? ''
      expect(text, file).not.toMatch(/\binfinite\b/)
      const animations = rulesOf(file)
        .filter((rule) => !rule.insideKeyframes && !isMotionGuard(rule))
        .flatMap((rule) => rule.block.split(';').map((item) => item.trim()))
        .filter((item) => /^animation\s*:/.test(item))
      for (const decl of animations) {
        if (/^animation:\s*none\b/.test(decl)) continue
        expect(decl, `${file}: ${decl}`).toMatch(/ 1$/) // 非 none 的必须显式「播放 1 次」
      }
    }
    const keyframes = rulesOf('variable-panel.css').filter((rule) => rule.insideKeyframes)
    expect((cssText.get('variable-panel.css') ?? '').match(/@keyframes\s+[\w-]+/g)).toEqual(['@keyframes cw-variable-flash'])
    expect(keyframes.map((rule) => rule.selector)).toEqual(['from', 'to'])
    expect(keyframes.map((rule) => rule.block).join(';')).not.toMatch(/scale|translate/)
    expect(keyframes[1]?.block).toContain('opacity: 1') // 终态可读（geometry.md §3）
  })

  it('blink 这类继承自 styles.css 的循环动画被基座掐掉：运行中的圆点是静态终态', () => {
    const shared = rulesOf(STYLESHEET).find((rule) => rule.selector.includes('.run-indicator.running span') && rule.block.includes('blink'))
    expect(shared, 'styles.css 的 blink 必须确实存在，否则本条断言没意义').toBeTruthy()
    const running = declarationsOf('runtime-controls.css', '.run-indicator.running span')
    expect(running).toContain('animation: none')
    expect(running.some((decl) => /^background:\s*var\(--ds-status-info/.test(decl))).toBe(true)
    expect(declarationsOf('runtime-controls.css', '.run-indicator span')).toContain('animation: none')
  })

  it('两条降级路径（系统偏好与应用内根类）各自成文，写的是真停止', () => {
    for (const file of BASE_FILES) {
      const text = cssText.get(file) ?? ''
      expect(text, file).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
      expect(text, file).toMatch(/\.reduce-motion\s/)
      expect((text.match(/animation: none !important/g) ?? []).length, file).toBe(2)
      expect((text.match(/transition: none !important/g) ?? []).length, file).toBe(2)
      expect(text, file).not.toMatch(/animation-duration|transition-duration|\*\s*0\.35/) // 放慢不算停止
      const guardStart = text.indexOf('@media (prefers-reduced-motion: reduce)')
      expect(text.slice(0, guardStart), file).not.toContain('!important')
    }
  })
})

/* ─────────────── 6. 组件渲染契约：改版没吃掉结构、文案与回调 ─────────────── */

/**
 * 步进器夹具：节点骨架 + 每一拍的事件。第 1/2 拍已走到（带变量快照），
 * 第 3 拍是「当前」拍，第 4/5 拍还没到（ordinal 缺席 → 渲染成 `--`）。
 */
const flowSteps: FlowStep[] = [
  { id: 'start', label: '开始', kind: 'start', tone: 'purple', line: 1, ordinal: 1, event: { id: 'e1', type: 'start', line: 1, label: '开始执行', detail: '', variables: [], nodeId: 'start' } },
  { id: 'call', label: '调用 add', kind: 'process', tone: 'blue', line: 4, ordinal: 2, event: { id: 'e2', type: 'assign', line: 4, label: 'total = add(1, 2, 3)', detail: '', variables: [{ name: 'total', value: '6', type: 'int', color: 'blue' }], nodeId: 'call' } },
  { id: 'check', label: '是否三参数', kind: 'decision', tone: 'yellow', line: 2, ordinal: 3, event: { id: 'e3', type: 'condition', line: 2, label: 'if nargs == 3', detail: '三个参数都给了', variables: [{ name: 'nargs', value: '3', type: 'int', color: 'blue' }], nodeId: 'check' } },
  { id: 'update', label: '更新计数', kind: 'process', tone: 'green', line: 3 },
  { id: 'end', label: '结束', kind: 'end', tone: 'green' },
]
const variables: VariableValue[] = [
  { name: 'result', value: '5', type: 'int', color: 'blue' },
  { name: 'table', value: '{"k": [1, 2, 3, 4, 5, 6, 7, 8, 9]}', type: 'dict', color: 'coral' },
]

describe('M4 子组件基座 · 渲染契约', () => {
  afterEach(() => cleanup())

  it('CodeEditor：三层齐备，输入与光标位置仍由组件按用户字号计算', async () => {
    const onChange = vi.fn()
    const { container } = render(
      <CodeEditor code={'def add(a, b):\n    return a + b'} language='python' languageLabel='Python' runtime='教学模拟器' activeLine={2} onChange={onChange} />,
    )
    expect(container.querySelectorAll('div.line-numbers span')).toHaveLength(2)
    expect(container.querySelector('div.line-numbers span.active')?.textContent).toBe('02')
    expect(container.querySelector('pre.code-tokens')?.getAttribute('aria-hidden')).toBe('true')
    const highlightStyle = (container.querySelector('div.code-highlight') as HTMLElement).getAttribute('style') ?? ''
    expect(highlightStyle).toContain('var(--editor-font-size)') // 基座不接管用户字号
    expect(highlightStyle).toContain('var(--line-height-editor)')
    const area = container.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.change(area, { target: { value: 'x = 1' } })
    expect(onChange).toHaveBeenLastCalledWith('x = 1')
    expect(container.querySelector('span.editor-actions button')).toBeTruthy()
    // 滚动同步：transform 由组件持有（行号层与高亮层跟随 textarea 滚动）
    fireEvent.scroll(area, { target: { scrollTop: 40, scrollLeft: 12 } })
    await waitFor(() => expect(((container.querySelector('div.line-numbers-inner') as HTMLElement).getAttribute('style') ?? '')).toContain('-40px'))
    expect(((container.querySelector('pre.code-tokens') as HTMLElement).getAttribute('style') ?? '')).toContain('-12px')
  })

  it('RuntimeControls：五种状态都有文字通道，三个按钮的调用不改判定', () => {
    const onRun = vi.fn()
    const onStep = vi.fn()
    const onReset = vi.fn()
    for (const status of ['idle', 'running', 'paused', 'completed', 'error'] as const) {
      const { container, unmount } = render(<RuntimeControls status={status} onRun={onRun} onStep={onStep} onReset={onReset} />)
      expect(container.querySelector(`div.run-indicator.${status}`), status).toBeTruthy()
      expect(container.querySelector('div.run-copy strong')?.textContent, status).not.toBe('')
      unmount()
    }
    const { container } = render(<RuntimeControls status='idle' onRun={onRun} onStep={onStep} onReset={onReset} />)
    fireEvent.click(container.querySelector('button.run-button') as HTMLButtonElement)
    fireEvent.click(container.querySelector('button.step-button') as HTMLButtonElement)
    fireEvent.click(container.querySelector('button.reset-button') as HTMLButtonElement)
    expect([onRun, onStep, onReset].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1])
  })

  it('ConsolePanel：空态 / stdout / 错误三态都带文字（错误不只靠颜色）', () => {
    const empty = render(<ConsolePanel output={[]} />)
    expect(empty.container.querySelector('div.empty-panel')?.textContent).toBe('运行后显示程序输出')
    empty.unmount()
    const ok = render(<ConsolePanel output={['5']} />)
    expect(ok.container.querySelector('div.console-line > span')?.textContent).toBe('›')
    expect(ok.container.querySelector('span.console-status')?.textContent).toBe('stdout')
    ok.unmount()
    const bad = render(<ConsolePanel output={[]} error={{ line: 3, message: '除数为零' }} />)
    expect(bad.container.querySelector('span.console-status')?.textContent).toContain('第 3 行错误')
    expect(bad.container.querySelector('div.console-error')?.textContent).toContain('除数为零')
  })

  it('VariablePanel：步骤计数与变量行都在，长值不被截断成看不见的样子', () => {
    const { container } = render(<VariablePanel variables={variables} eventIndex={1} totalEvents={3} />)
    expect(container.querySelector('span.step-counter')?.textContent).toBe('步骤 2 / 3')
    expect(container.querySelectorAll('div.variable-row.changed')).toHaveLength(2)
    expect(container.querySelector('div.variable-icon.blue')).toBeTruthy()
    expect(container.querySelector('div.variable-icon.coral')).toBeTruthy()
    expect(container.querySelector('div.variable-value')?.textContent).toBe('5')
    cleanup()
    const waiting = render(<VariablePanel variables={[]} eventIndex={0} totalEvents={0} />)
    expect(waiting.container.querySelector('span.step-counter')?.textContent).toBe('等待运行')
    expect(waiting.container.querySelector('div.empty-panel')?.textContent).toBe('运行后显示变量的实时变化')
  })

  it('FlowChart：当前拍三通道可辨（aria-current + is-now + 泛光类），未到的拍不填假数据', () => {
    const { container } = render(
      <FlowChart steps={flowSteps} activeNodeId='check' completedNodeIds={['start', 'call', 'check']} />,
    )
    const steps = Array.from(container.querySelectorAll('li.flow-step'))
    expect(steps).toHaveLength(5)
    // 态：三态互斥，当前拍同时带 aria-current 与 is-now（文字 / 语义通道，不只靠颜色）
    expect(steps[2]?.className).toContain('is-now')
    expect(steps[2]?.getAttribute('aria-current')).toBe('step')
    expect(steps[0]?.className).toContain('is-done')
    expect(steps[4]?.className).toContain('is-todo')
  })

  it('FlowChart：每一拍旁边挂着它那一拍的变量快照；没走到就明说，不填占位值', () => {
    const { container } = render(
      <FlowChart steps={flowSteps} activeNodeId='check' completedNodeIds={['start', 'call', 'check']} />,
    )
    const data = Array.from(container.querySelectorAll('div.flow-data'))
    expect(data).toHaveLength(5)
    // 第 2 拍（索引 1）那一拍的快照：total = 6，类型 int
    const first = data[1]?.querySelector('li')
    expect(first?.querySelector('.flow-data-name')?.textContent).toBe('total')
    expect(first?.querySelector('.flow-data-value')?.textContent).toBe('6')
    expect(first?.querySelector('.flow-data-type')?.textContent).toBe('int')
    // 未到的拍不编造数据
    expect(data[4]?.textContent).toContain('尚未执行到这一拍')
    // 走到但没有变量变化的那一拍，说的是「没有变量变化」而不是空白
    expect(data[0]?.textContent).toContain('这一拍没有变量变化')
  })

  it('FlowChart：序号走 1 起步的两位补零，未到的拍记作 --', () => {
    const { container } = render(
      <FlowChart steps={flowSteps} activeNodeId='check' completedNodeIds={['start', 'call', 'check']} />,
    )
    const nos = Array.from(container.querySelectorAll('span.flow-node-no')).map((n) => n.textContent)
    expect(nos).toEqual(['01', '02', '03', '--', '--'])
  })

  it('FlowChart：源码行号与语义档标签成对出现，供学习者对着编辑器核对', () => {
    const { container } = render(
      <FlowChart steps={flowSteps} activeNodeId='check' completedNodeIds={[]} />,
    )
    expect(container.querySelectorAll('div.flow-node-line')).toHaveLength(4)
    expect(container.querySelector('.flow-node-line-no')?.textContent).toBe('L1')
    const kinds = Array.from(container.querySelectorAll('span.flow-node-kind')).map((k) => k.className)
    expect(kinds[0]).toContain('tone-purple')
    expect(kinds[1]).toContain('tone-blue')
    expect(container.querySelector('span.flow-node-kind.tone-yellow')?.textContent).toBe('注意')
  })
})
