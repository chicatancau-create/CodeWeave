// @vitest-environment jsdom
/**
 * M3 视觉竖切 · 学习路径页契约测试（01 号方案 §3.3 学习路径 + §2.2 令牌 + §2.2 动效降级 + §8 验收清单）
 *
 * 覆盖三件事：
 * 1. 改版后业务行为仍然成立：前置关系、继续学习、阅读单元、来源与缺口标识；
 * 2. 无障碍结构：清单是真表格（caption / th scope）、标识不只靠颜色、控件有名字；
 * 3. 视觉不变式以 CSS 源码文本锁定（jsdom 不做层叠与布局，故按规则文本核对，
 *    与 tests/styles.focus.test.mjs 同一手法）。
 *
 * 断言风格与项目现有 jsdom 测试一致：直接读 DOM 结构与文本，不依赖 jest-dom 匹配器。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LearningPathView } from './learning-path-view'
import type { Lesson } from '../types/lesson'
import type { CurriculumStage } from '../data/curriculum'
import type { LessonEvidenceStates } from '../utils/lesson-evidence'

/**
 * 组件样式表原文。
 *
 * vitest 默认不处理 CSS（`test.css` 为 false），`?raw` / `?inline` 都会被替换成空模块，
 * 所以视觉不变式只能从磁盘读原文核对 —— 与 tests/styles.focus.test.mjs 读 src/styles.css
 * 同一手法。本仓库未安装 @types/node：用变量说明符做动态 import（局部类型收窄），
 * 并只用 `import.meta.dirname` 拼路径，不引入 `process` 等未声明全局、也不静态 import node:path。
 * 下方 length 断言是防空模块的守卫：一旦读不到原文，全部 CSS 断言会立刻失败而不是假绿。
 */
const fsSpecifier: string = 'node:fs'
const { readFileSync } = (await import(fsSpecifier)) as {
  readFileSync: (path: string, encoding: 'utf8') => string
}
const moduleDir = (import.meta as unknown as { dirname?: string }).dirname ?? '.'
const cssPath = `${moduleDir}/learning-path-view.css`
const cssText = readFileSync(cssPath, 'utf8')

/** 去掉注释后的纯声明文本：否定断言（不得出现泛光/渐变/取消 outline）只看真实声明。 */
const cssCode = cssText.replace(/\/\*[\s\S]*?\*\//g, '')

/** 取某个选择器（规范化空白后精确匹配）的声明体；找不到返回空串。 */
function declarationBlock(selector: string): string {
  const wanted = selector.replace(/\s+/g, ' ').trim()
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null = pattern.exec(cssText)
  while (match) {
    const rawSelector = match[1] ?? ''
    const body = match[2] ?? ''
    const selectorText = rawSelector.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').trim()
    if (selectorText === wanted) return body
    match = pattern.exec(cssText)
  }
  return ''
}

/** 取 @media 查询的内部文本（支持嵌套花括号）。 */
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

const baseLesson = (overrides: Partial<Lesson> = {}): Lesson =>
  ({
    id: 'vault-s0-1',
    language: 'java',
    languageLabel: 'Java',
    label: 'S0',
    title: '开发环境清点',
    description: '把工具链逐个清点并留下版本记录',
    duration: '45 min',
    level: '入门',
    progress: 0,
    code: '',
    flow: [],
    insight: '',
    fileName: 'env-checklist.txt',
    runtime: '外部环境 · 终端',
    contentId: 'topic-java-env',
    subject: 'Java',
    subjectId: 'java',
    legacy: false,
    executable: true,
    source: {
      path: '资料库/Java/环境.md',
      headingPath: ['Java', '环境'],
      verificationStatus: '已核验',
      sourceIds: ['src-1'],
    },
    exercise: {
      exerciseId: 'ex-1',
      title: '清点练习',
      prompt: '记录版本',
      starterCode: '',
      starterLanguage: 'java',
      expectedOutput: [],
      executionPolicy: 'teaching',
    },
    content: {
      objective: '清点工具链',
      prerequisites: ['JDK 安装', 'PATH 配置'],
      explanation: [],
      examples: [],
      guidedSteps: [],
      exercise: '',
      variant: '',
      projectTask: '',
      mistakes: [],
      runCommand: '教学运行器',
      completion: '',
      reviewOffsetsDays: [],
      stageId: 'S0',
      estimatedMinutes: 45,
    },
    ...overrides,
  }) as Lesson

/** 换阶段的浅拷贝：只动 stageId / label，其余字段照抄。 */
function lessonAtStage(overrides: Partial<Lesson> & { stage: string }): Lesson {
  const { stage, ...rest } = overrides
  return baseLesson({
    ...rest,
    label: stage,
    content: { ...baseLesson().content, stageId: stage },
  })
}

const javaSubject = {
  id: 'java',
  label: 'Java',
  short: 'JA',
  color: 'orange',
  lessonCount: 2,
  hasVaultContent: true,
  executable: true,
}

function renderView(lessons: Lesson[], overrides: Partial<Parameters<typeof LearningPathView>[0]> = {}) {
  const props = {
    subjectId: 'java',
    subjects: [javaSubject],
    lessons,
    selectedLessonId: lessons[0]?.id ?? '',
    recommended: { label: 'S0', title: '开发环境清点' },
    onSubjectChange: vi.fn(),
    onLessonChange: vi.fn(),
    onContinue: vi.fn(),
    ...overrides,
  }
  render(<LearningPathView {...props} />)
  return props
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('M3 学习路径 · S0—S9 编号阶段骨架', () => {
  it('按编号阶段建组，组标题含阶段号与单元计数', () => {
    renderView([baseLesson(), lessonAtStage({ id: 'vault-s2-1', stage: 'S2', title: '变式单元' })])
    // #77：h1 归页内标题之后阶段标题降了一级（原 h4）——这里跟着改，不是放宽：
    // 下面那条 queryByRole 也在同一批里改，改完它仍会真的去找 h3，找空才算过。
    const s0 = screen.getByRole('heading', { level: 3, name: /S0 阶段/ })
    const s2 = screen.getByRole('heading', { level: 3, name: /S2 阶段/ })
    expect(s0.textContent).toContain('1 个单元')
    expect(s2.textContent).toContain('1 个单元')
  })

  it('编号区间内没有单元的阶段如实标为阶段缺口，不拿相邻主题顶替', () => {
    renderView([baseLesson(), lessonAtStage({ id: 'vault-s2-1', stage: 'S2', title: '变式单元' })])
    const gapHeading = screen.getByRole('heading', { level: 3, name: /S1 阶段/ })
    expect(gapHeading.textContent).toContain('本阶段无已发布单元')
    expect(screen.getByText('阶段缺口')).toBeTruthy()
    expect(screen.getByText(/本科目在 S1 没有已发布单元/)).toBeTruthy()
  })

  it('旧口径与未标阶段归入「未并入编号阶段」带，不冒充 S0—S9', () => {
    renderView([
      baseLesson({
        id: 'java-env-a1',
        label: 'A1',
        contentId: undefined,
        source: undefined,
        content: { ...baseLesson().content, stageId: undefined },
      }),
    ])
    expect(screen.getByRole('heading', { level: 3, name: /未并入编号阶段/ })).toBeTruthy()
    expect(screen.getByText('未并入 S0—S9 编号阶段')).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 3, name: /S0 阶段/ })).toBeNull()
  })

  it('科目为空时保留原有空态说明，不显示阶段骨架', () => {
    renderView([])
    expect(screen.getByText(/该科目当前没有已发布内容/)).toBeTruthy()
    expect(document.querySelectorAll('table.lp-ledger')).toHaveLength(0)
  })
})

describe('M3 学习路径 · 清单表格语义（表头/行）', () => {
  it('#77 换层级没有把版心推开：四类标题的上下边距都显式钉死，不再吃 UA 默认档', async () => {
    // terminal108 量到路径页文档高度因换标签涨了 51px——字号没动，但 UA 给 h1/h2/h3/h4 的
    // 上下边距各不相同，换标签就等于换间距。钉成 em 之后与标签脱钩，这条守卫防它被改回去。
    const fsSpecifier: string = 'node:fs'
    const { readFileSync } = (await import(fsSpecifier)) as { readFileSync: (p: string, enc: string) => string }
    const css = readFileSync('./src/components/learning-path-view.css', 'utf8')
    const NL = String.fromCharCode(10)
    // 同一个选择器可以出现多次（钉边距那条单独成块），全部拼起来再判：
    // 只取第一处会读到原来那条没有 margin 的规则，守卫看着在跑其实量错了地方。
    const blockOf = (sel: string) => {
      const blocks: string[] = []
      for (let at = css.indexOf(NL + sel + ' {'); at >= 0; at = css.indexOf(NL + sel + ' {', at + 1)) {
        blocks.push(css.slice(at, css.indexOf('}', at)))
      }
      if (!blocks.length) throw new Error(`找不到 ${sel} 的规则块`)
      return blocks.join(NL)
    }
    expect(blockOf('.lp-title')).toMatch(/margin-top:\s*\.83em/)
    expect(blockOf('.lp-block-heading')).toMatch(/margin:\s*1em 0/)
    expect(blockOf('.lp-stage-heading')).toMatch(/margin:\s*1\.33em 0/)
    expect(blockOf('.lp-continue-title')).toMatch(/margin:\s*1em 0/)
  })

  it('每阶段一张细线表格：sr-only caption + 列表头 + 行表头', () => {
    renderView([baseLesson(), baseLesson({ id: 'vault-s0-2', title: '第二个单元' })])
    const table = document.querySelector('table.lp-ledger')
    expect(table).toBeTruthy()
    const caption = table?.querySelector('caption')
    expect(caption?.textContent).toBe('S0 阶段课程清单，共 2 个单元')
    expect(caption?.className).toContain('lp-sr-only')
    const colHeaders = [...(table?.querySelectorAll('thead th[scope="col"]') ?? [])]
    expect(colHeaders.map((th) => th.textContent)).toEqual(['次', '课程单元', '状态'])
    const rowHeaders = [...(table?.querySelectorAll('tbody th[scope="row"]') ?? [])]
    expect(rowHeaders).toHaveLength(2)
    expect(rowHeaders[0]?.textContent).toContain('01')
    expect(table?.querySelectorAll('tbody tr')).toHaveLength(2)
  })

  it('#95 每张台账住在可 Tab 到、有名字的横向滚动区里（列地板靠它吃溢出，不靠压字）', () => {
    renderView([baseLesson(), baseLesson({ id: 'vault-s0-2', title: '第二个单元' })])
    const tables = [...document.querySelectorAll<HTMLTableElement>('table.lp-ledger')]
    expect(tables).toHaveLength(1)
    for (const table of tables) {
      const wrap = table.parentElement
      expect(wrap?.className).toBe('lp-table-scroll')
      expect(wrap?.getAttribute('role')).toBe('region')
      expect(wrap?.getAttribute('tabindex')).toBe('0')
      expect(wrap?.getAttribute('aria-label')).toContain('可横向滚动')
    }
    // 滚动区是包的表格那一层，不是包整块阶段区——否则标题与缺口说明也会被推走
    expect(tables[0]?.parentElement?.parentElement?.className).toContain('lp-stage-body')
  })

  it('未标阶段的旧口径单元仍以同一表格结构列出，行表头保留旧编号', () => {
    renderView([
      baseLesson({
        id: 'java-env-a1',
        title: '旧内置单元',
        label: 'A1',
        contentId: undefined,
        legacy: true,
        source: undefined,
        content: { ...baseLesson().content, stageId: undefined },
      }),
    ])
    const rowHeader = document.querySelector('tbody th[scope="row"]')
    expect(rowHeader?.textContent).toContain('A1')
    expect(document.querySelector('caption')?.textContent).toContain('未并入 S0—S9 编号阶段的课程清单')
  })
})

describe('M3 学习路径 · 保留的业务行为', () => {
  it('前置关系：单元先备清单来自 content.prerequisites 并成行展示', () => {
    renderView([baseLesson()])
    const prereq = screen.getByText('JDK 安装；PATH 配置')
    expect(prereq).toBeTruthy()
    expect(prereq.closest('.lp-row-prereq')?.textContent).toContain('先备')
  })

  it('前置关系：无先备数据时不编造，整行不出现先备', () => {
    renderView([baseLesson({ content: { ...baseLesson().content, prerequisites: [] } })])
    expect(document.querySelector('.lp-row-prereq')).toBeNull()
  })

  it('继续学习：已选单元成块出现，进入学习按钮调用 onContinue', () => {
    const props = renderView([baseLesson()])
    // #77：继续区块的标题随层级序列从 h3 升到 h2（页级 h1 之下的第二层）。
    expect(screen.getByRole('heading', { level: 2, name: '开发环境清点' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /进入学习/ }))
    expect(props.onContinue).toHaveBeenCalledTimes(1)
  })

  it('继续学习：未选中单元时不出现继续区块', () => {
    renderView([baseLesson()], { selectedLessonId: 'none' })
    expect(screen.queryByRole('button', { name: /进入学习/ })).toBeNull()
  })

  it('课程行仍通过 onLessonChange 上抛整个 lesson 对象（选中语义不变）', () => {
    const lesson = baseLesson()
    const props = renderView([lesson])
    fireEvent.click(screen.getByRole('button', { name: /开发环境清点/ }))
    expect(props.onLessonChange).toHaveBeenCalledTimes(1)
    expect(props.onLessonChange).toHaveBeenCalledWith(lesson)
  })

  it('已选行标记为 aria-pressed 与文字「已选」，不只靠底色', () => {
    renderView([baseLesson(), baseLesson({ id: 'vault-s0-2', title: '第二个单元' })])
    const selected = document.querySelector('.lp-row.is-selected [aria-pressed="true"]')
    expect(selected?.textContent).toContain('已选')
    expect(document.querySelector('.lp-row:not(.is-selected) [aria-pressed="true"]')).toBeNull()
  })

  it('阅读单元：带主题原文时标为阅读单元，并给出原文位置与核验状态', () => {
    renderView([
      baseLesson({
        id: 'vault-s0-read',
        level: '阅读',
        reading: {
          markdown: '# 原文',
          path: '资料库/Java/并发模型.md',
          headingPath: ['Java', '并发模型'],
          verificationStatus: '待核验',
          headings: [],
        },
        source: {
          path: '资料库/Java/并发模型.md',
          headingPath: ['Java', '并发模型'],
          verificationStatus: '待核验',
          sourceIds: ['src-9'],
        },
      }),
    ])
    expect(screen.getByText('阅读单元 · 主题原文可读')).toBeTruthy()
    expect(screen.getByText('资料库/Java/并发模型.md')).toBeTruthy()
    expect(screen.getByText(/› Java > 并发模型/)).toBeTruthy()
    expect(screen.getByText(/· 核验：待核验/)).toBeTruthy()
  })

  it('科目切换：点击科目上抛 subjectId，当前项 aria-pressed=true', () => {
    const props = renderView([baseLesson()], {
      subjects: [
        javaSubject,
        { ...javaSubject, id: 'python', label: 'Python', short: 'PY', hasVaultContent: false, executable: false },
      ],
    })
    const python = screen.getByRole('button', { name: /Python/ })
    expect(python.getAttribute('aria-pressed')).toBe('false')
    expect(python.textContent).toContain('不可自动执行')
    fireEvent.click(python)
    expect(props.onSubjectChange).toHaveBeenCalledWith('python')
    const pressed = [...document.querySelectorAll('.lp-subject[aria-pressed="true"]')]
    expect(pressed).toHaveLength(1)
    expect(pressed[0]?.textContent).toContain('Java')
  })

  it('时长口径不重复渲染：预计时长整页只出现一次（保住 R2-E getByText 契约）', () => {
    renderView([baseLesson()])
    expect(screen.getAllByText(/预计 45 分钟/)).toHaveLength(1)
    expect(screen.queryByText('45 min')).toBeNull()
  })
})

describe('M3 学习路径 · 来源与缺口标识', () => {
  it('来源三态：资料库正式内容 / 旧内置课程 / 来源未标注', () => {
    renderView([
      baseLesson(),
      baseLesson({
        id: 'legacy-1',
        title: '旧内置单元',
        contentId: undefined,
        legacy: true,
        source: undefined,
        exercise: undefined,
      }),
      baseLesson({
        id: 'unknown-1',
        title: '未标来源单元',
        contentId: undefined,
        legacy: undefined,
        source: undefined,
        exercise: undefined,
      }),
    ])
    expect(screen.getByText('资料库正式内容')).toBeTruthy()
    expect(screen.getByText('旧内置课程 · 未迁入资料库')).toBeTruthy()
    expect(screen.getByText('来源未标注')).toBeTruthy()
  })

  it('缺口只登记现有字段可证实的缺失：缺练习契约时标注，齐备时不标', () => {
    renderView([baseLesson(), baseLesson({ id: 'vault-s0-2', title: '缺练习的单元', exercise: undefined })])
    expect(screen.getAllByText('无练习契约（已登记于同步报告）')).toHaveLength(1)
    expect(document.querySelector('[data-lesson-id="vault-s0-2"]')?.textContent).toContain('无练习契约')
    expect(document.querySelector('[data-lesson-id="vault-s0-1"]')?.textContent).not.toContain('无练习契约')
  })

  it('页眉 specs 的计数与逐条标识同口径，不另算一套', () => {
    renderView([baseLesson(), baseLesson({ id: 'vault-s0-2', title: '缺练习的单元', exercise: undefined })])
    expect(screen.getByText('2 个')).toBeTruthy()
    expect(screen.getByText('1 / 10 个已发布')).toBeTruthy()
    expect(screen.getByText('1 个单元 · 0 处阶段缺口')).toBeTruthy()
  })

  it('标识不依赖颜色：每条标识都有固定字符徽记 + 中文说明，徽记对读屏隐藏', () => {
    renderView([baseLesson(), baseLesson({ id: 'vault-s0-2', title: '缺练习的单元', exercise: undefined })])
    const marks = [...document.querySelectorAll<HTMLElement>('.lp-mark')]
    expect(marks.length).toBeGreaterThan(1)
    for (const mark of marks) {
      const glyph = mark.querySelector('.lp-mark-glyph')
      const text = mark.querySelector('.lp-mark-text')
      expect(glyph?.getAttribute('aria-hidden')).toBe('true')
      expect((text?.textContent ?? '').length).toBeGreaterThan(1)
      expect(mark.getAttribute('data-lp-mark')).toBeTruthy()
    }
  })

  it('缺口标识另有边框样式与点线下划线差异，不仅靠颜色区分', () => {
    expect(declarationBlock('.lp-mark--gap')).toContain('border-style: dotted')
    expect(declarationBlock('.lp-mark--vault')).toContain('border-style: solid')
    expect(declarationBlock('.lp-mark--legacy')).toContain('border-style: dashed')
    expect(declarationBlock('.lp-mark--gap .lp-mark-text')).toContain('text-decoration-style: dotted')
  })
})

describe('M3 学习路径 · CSS 视觉不变式（源码文本核对）', () => {
  it('正文约 16px、行高落在 1.6–1.75，长中文标题不 nowrap', () => {
    expect(cssText.length).toBeGreaterThan(4000)
    expect(declarationBlock('.lp-view')).toContain('--lp-body: var(--ds-size-body, 16px)')
    expect(declarationBlock('.lp-view')).toContain('--lp-leading: var(--ds-leading-body, 1.7)')
    expect(cssCode.match(/white-space: nowrap/g)?.length ?? 0).toBeLessThanOrEqual(1)
    expect(declarationBlock('.lp-view :is(h2, h3, h4, p, span, td, th, dd, dt, li, button)')).toContain(
      'overflow-wrap: anywhere',
    )
  })

  it('触控目标 ≥44px 且焦点轮廓可见（不写 outline:none）', () => {
    expect(declarationBlock('.lp-view')).toContain('--lp-tap: var(--ds-tap-min, 44px)')
    expect(declarationBlock('.lp-subject')).toContain('min-height: var(--lp-tap)')
    expect(declarationBlock('.lp-row-btn')).toContain('min-height: var(--lp-tap)')
    expect(declarationBlock('.lp-cta')).toContain('min-height: var(--lp-tap)')
    expect(declarationBlock('.lp-view :focus-visible')).toContain('var(--ds-focus-ring, rgba(220, 233, 251, 0.72))')
    expect(cssCode).not.toMatch(/outline(-style)?:\s*(none|0)/)
  })

  it('320px 最小宽度有专门降级规则', () => {
    expect(mediaBlock('max-width: 399px')).toContain('padding-left: var(--ds-space-10, 10px)')
    expect(cssCode).toContain('min-width: 0')
  })

  it('#95 课程单元列的地板真的过 120px，且多出来的宽度交给可聚焦的横向滚动区', () => {
    // 320 档普查实测这一列 113px≈7.5 字/行：页面不溢出，但长中文课名被切成一字一行
    const narrow = mediaBlock('max-width: 399px')
    expect(narrow).toMatch(/\.lp-ledger\s*\{[^}]*min-width:\s*3[0-9]{2}px/)
    expect(narrow).toMatch(/\.lp-cell-main\s*\{[^}]*min-width:\s*1[0-9]em/)
    // 地板用 em 写，就要把「换算基数」一起钉住：窄档正文 15px ⇒ 12em = 180px ≥ 120px
    expect(narrow).toMatch(/--lp-body:\s*15px/)
    const scroll = declarationBlock('.lp-table-scroll')
    expect(scroll).toContain('min-width: 0')
    expect(scroll).toMatch(/overflow-x:\s*auto/)
    expect(declarationBlock('.lp-table-scroll:focus-visible')).toContain('var(--ds-focus-ring')
  })

  it('形态：黑场 + 发丝线 + 冷色发光，无玻璃卡与渐变，圆角只有令牌两档', () => {
    // 科技档反转（tokens §4.5）：深色画布上黑投影等于没有，层级改由冷色外发光承担。
    // 约束不放松 —— box-shadow 仍不许出现裸字面量，每条只走 --lp-glow-* 别名。
    const shadows = [...cssCode.matchAll(/box-shadow:\s*([^;]+)/g)].map((m) => m[1]!.trim())
    expect(shadows.length).toBeGreaterThan(0)
    for (const value of shadows) {
      expect(/^var\(--lp-glow-(near|panel|inset)\)$/.test(value), `未走发光令牌：${value}`).toBe(true)
    }
    expect(cssCode).not.toMatch(/backdrop-filter|linear-gradient|radial-gradient|conic-gradient|text-shadow/)
    expect(cssCode).not.toMatch(/border-radius:\s*[0-9]/)
    expect(cssCode).not.toContain('!important')
    expect(declarationBlock('.lp-view')).toContain('background: var(--lp-canvas)')
    expect(cssText).toContain('var(--ds-radius-panel, 0)')
    expect(cssText).toContain('var(--ds-shape-pill, 100px)')
  })

  it('每个 --ds-* 令牌消费都带兜底值', () => {
    expect(cssCode.match(/var\(--ds-[a-z0-9-]+\)/g) ?? []).toEqual([])
  })

  it('持续动画被系统偏好与 .reduce-motion 两道开关真正停止', () => {
    const system = mediaBlock('prefers-reduced-motion: reduce')
    expect(system).toContain('.lp-eyebrow-rule::after')
    expect(system.match(/animation: none/g)?.length).toBeGreaterThanOrEqual(2)
    expect(declarationBlock('.reduce-motion .lp-view .lp-eyebrow-rule::after')).toContain('animation: none')
    expect(
      declarationBlock('.reduce-motion .lp-view *, .reduce-motion .lp-view *::before, .reduce-motion .lp-view *::after'),
    ).toContain('animation: none')
  })
})

describe('M3 学习路径 · 无障碍（axe-core）', () => {
  it('编号阶段 + 表格 + 按钮结构无 axe 违规', async () => {
    const { container } = render(
      <LearningPathView
        subjectId="java"
        subjects={[javaSubject, { ...javaSubject, id: 'python', label: 'Python', short: 'PY', executable: false }]}
        lessons={[
          baseLesson(),
          lessonAtStage({ id: 'vault-s2-1', stage: 'S2', title: '变式单元' }),
          baseLesson({
            id: 'java-env-a1',
            title: '旧内置单元',
            label: 'A1',
            contentId: undefined,
            legacy: true,
            source: undefined,
            content: { ...baseLesson().content, stageId: undefined },
          }),
        ]}
        selectedLessonId="vault-s0-1"
        recommended={null}
        onSubjectChange={vi.fn()}
        onLessonChange={vi.fn()}
        onContinue={vi.fn()}
      />,
    )
    const results = await axe.run(container, {
      rules: {
        // jsdom 无真实布局：色彩对比与触控尺寸由上面的 CSS 源码不变式与浏览器复核承担
        'color-contrast': { enabled: false },
        'target-size': { enabled: false },
      },
    })
    expect(results.violations.map((violation) => violation.id)).toEqual([])
  })
})

/* ────────────── 阶段能力点与「未掌握」（LEARN-01 第 3 条） ────────────── */

describe('M3 学习路径 · 阶段能力点与未掌握', () => {
  const stageS0: CurriculumStage = {
    id: 'S0',
    title: '环境核验',
    track: '通用',
    summary: '把工具链清点成一份可核对的记录',
    topics: [],
    checkpoint: '能独立跑通一次环境清点并记录版本',
    deliverables: ['环境清单表', '版本记录'],
    prerequisites: [],
    externalTools: [],
  }
  const states = (overrides: Partial<LessonEvidenceStates> = {}): LessonEvidenceStates => ({
    read: false,
    practiced: false,
    submittedEvidence: false,
    selfDeclaredPassed: false,
    autoVerifiedPassed: false,
    reviewMastered: false,
    ...overrides,
  })
  const block = () => document.querySelector('.lp-stage-competence')

  it('资料库写的阶段验收与交付物真的摆上路径（此前除校验器外零渲染点）', () => {
    renderView([baseLesson()], { stages: [stageS0] })
    expect(block()?.textContent).toContain('能独立跑通一次环境清点并记录版本')
    expect(Array.from(block()?.querySelectorAll('.lp-stage-deliverables li') ?? []).map((li) => li.textContent)).toEqual([
      '环境清单表',
      '版本记录',
    ])
  })

  it('一条完成证据都没有时按「未掌握」读；只有阅读与练习痕迹不算掌握', () => {
    renderView([baseLesson()], { stages: [stageS0], lessonStates: { 'vault-s0-1': states({ read: true, practiced: true }) } })
    expect(block()?.textContent).toContain('0/1 个单元有完成证据')
    expect(block()?.textContent).toContain('未掌握')
  })

  it('自评通过就不再报未掌握，但交付物依旧不逐条打勾（本机没比对过它们）', () => {
    renderView([baseLesson()], { stages: [stageS0], lessonStates: { 'vault-s0-1': states({ selfDeclaredPassed: true }) } })
    const text = block()?.textContent ?? ''
    expect(text).toContain('1/1 个单元有完成证据')
    expect(text).not.toContain('未掌握')
    expect(text).toContain('不逐条打勾')
    expect(block()?.querySelectorAll('input[type=checkbox]').length).toBe(0)
    expect(Array.from(block()?.querySelectorAll('.lp-stage-deliverables li') ?? []).every((li) => !/[✓×]/.test(li.textContent || ''))).toBe(true)
  })

  it('上层没递阶段表时如实说「无从显示」，不编一份能力点出来', () => {
    renderView([baseLesson()])
    expect(block()?.textContent).toContain('阶段表未载入，能力点无从显示')
    expect(block()?.textContent).toContain('无从显示：上层没递阶段表')
  })

  it('空阶段只报缺口，不拿「0/0 个单元」冒充一次判断', () => {
    renderView([baseLesson(), lessonAtStage({ id: 'vault-s2-1', stage: 'S2' })], { stages: [stageS0] })
    const blocks = Array.from(document.querySelectorAll('.lp-stage-competence'))
    expect(blocks.length).toBe(3) // S0 / S1 / S2 都各有一块
    const s1 = blocks[1] as Element
    expect(s1.textContent).toContain('资料库这一阶段没写验收点')
    expect(s1.textContent).not.toContain('个单元有完成证据')
    expect((blocks[0] as Element).textContent).toContain('0/1 个单元有完成证据')
  })
})
