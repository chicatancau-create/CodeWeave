/**
 * 01 号方案 §2.2「颜色、间距、边框、阴影、动效时长只能从设计令牌读取；页面 CSS 不得大量硬编码同义值」
 * 与 §8「正文约 16px」的机器依据。四条都是**只许收紧**的棘轮，不是快照：
 *
 * 1. 间距阶。2026-09-27 普查的原始形状是 `margin / padding / gap` 上 1226 处硬编码 px、
 *    35 个互不相同的值（9 / 10 / 11 三档各 44 / 211 / 22 次，全是「同一种间距的不同写法」）。
 *    现在这一层收在 `--ds-space-*`（app/src/design/tokens.css §8.5）上，硬编码只允许 0。
 * 2. 微字档。模板那三档（9.5 / 10 / 10.5px）在令牌文件里自述「仅非关键装饰」，但改版前
 *    有 71 处拿它承载中文词——按钮名、禁用条件、导航名、指南正文。必读文字一律走
 *    `--ds-size-control`(13px) 或 `--ds-size-body`(16px)，剩下 17 处是拉丁 / 数字 / 单字的
 *    装饰微字（编号、日期、计数、大写字距标签），列进白名单，新增即红。
 * 3. 色值余量。结构色已全部走令牌，剩下的一次性 alpha 洗色按文件登记余量，只许减不许增。
 * 4. 兜底值一致性。`var(--ds-space-8, 12px)` 会在令牌缺席时悄悄换掉布局，而
 *    「每个 `--ds-*` 消费都带兜底」各页 CSS 已有测试钉住，这里补的是「兜底值得相等」。
 *
 * 每条都自带扫描面断言（seen / used / micro 都有下限）：这类守卫最坏的失效方式不是误报，
 * 而是路径分隔符拼错、正则取空之后**永远绿着什么都没判**。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { webScript } from './layout.mjs'

// 归属：设计令牌与页面 CSS 是网页端自己的纪律（§7.1），原先寄在后端包里靠相对路径读
// `workspace/frontend/**`，属 §5 禁止项。断言一条没改，只是搬回它自己的工程。
const SRC = webScript('src')

function cssFiles(dir) {
  const out = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...cssFiles(p))
    else if (e.endsWith('.css')) out.push(p)
  }
  return out
}

const files = cssFiles(SRC)
expect(files.length).toBeGreaterThanOrEqual(20)
const rel = (f) => relative(SRC, f).split('\\').join('/')
/** 注释里的示例值不是代码：先整段摘掉再判。 */
const code = (f) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const tokens = readFileSync(join(SRC, 'design', 'tokens.css'), 'utf8')

const SPACE_SEG = /(^|[;{}])(\s*)((?:margin|padding|gap|row-gap|column-gap)[a-z-]*)\s*:\s*([^;{}]+);/g
const SPACING_PROP = /^(margin|padding|gap|row-gap|column-gap)(-(inline|block|top|right|bottom|left|start|end))*$/
/** 令牌消费（连兜底一起）折成一个占位符，剩下的 px 才是真硬编码。 */
const TOKEN_CONSUME = /var\(\s*--[a-z0-9-]+\s*(?:,[^)]*)?\)/g
const COLOR_NESTED = /var\((?:[^()]|\([^()]*\))*\)/g
const COLOR_LIT = /rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}\b/g

describe('§2.2 间距只能从设计令牌读取', () => {
  it('margin / padding / gap 上没有任何硬编码 px', () => {
    const bad = []
    let seen = 0
    for (const f of files) {
      const src = code(f)
      for (const m of src.matchAll(SPACE_SEG)) {
        if (!SPACING_PROP.test(m[3])) continue
        seen++
        if (!/-?\d+(?:\.\d+)?px/.test(m[4].replace(TOKEN_CONSUME, '·'))) continue
        bad.push(`${rel(f)}:${src.slice(0, m.index).split('\n').length}  ${m[3]}: ${m[4].trim()}`)
      }
    }
    expect(seen).toBeGreaterThan(900)
    expect(bad).toEqual([])
  })

  it('页面里用到的每一个 --ds-space-* 都在令牌文件里定义了', () => {
    const declared = new Set([...tokens.matchAll(/--ds-space-([a-z0-9]+):/g)].map((m) => m[1]))
    const missing = new Set()
    let used = 0
    for (const f of files) {
      for (const m of code(f).matchAll(/var\(\s*--ds-space-([a-z0-9]+)/g)) {
        used++
        if (!declared.has(m[1])) missing.add(`${rel(f)} → --ds-space-${m[1]}`)
      }
    }
    expect(declared.size).toBeGreaterThanOrEqual(16)
    expect(used).toBeGreaterThan(1000)
    expect([...missing]).toEqual([])
  })

  it('每个间距令牌的兜底值与定义值相等（令牌缺席时外观不得改变）', () => {
    const defined = new Map([...tokens.matchAll(/--ds-space-([a-z0-9]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
    const wrong = []
    for (const f of files) {
      for (const m of code(f).matchAll(/var\(--ds-space-([a-z0-9]+),\s*([^)]+)\)/g)) {
        if (defined.get(m[1]) !== m[2].trim()) wrong.push(`${rel(f)}  --ds-space-${m[1]} 兜底 ${m[2]} ≠ 定义 ${defined.get(m[1])}`)
      }
    }
    expect(wrong).toEqual([])
  })
})

/* 装饰微字白名单：编号 / 日期 / 计数 / 大写字距标签 / 骨架标签 / 单字星期头。
   判据是「读不出来不丢任何可行动信息」，中文词一律不得进这张表。 */
const DECOR_MICRO = new Set([
  'view-skeleton__label', 'variable-dots', 'step-counter', 'console-status',
  'notification-date', 'notification-badge', 'nav-item__index', 'nav-badge',
  'lp-eyebrow', 'lp-block-idx', 'guide-block', 'eyebrow', 'cv-auth__scene-tag',
  'cv-auth__foot', 'cv-auth__eyebrow', 'cv-auth__brand', 'code-footer',
  'calendar-weekdays',
  // 2026-09-29：登录页左栏的三条说明，序号 `01/02/03` 是纯装饰——父级本身就是
  // 一个 `<ol>`，顺序由列表语义给，序号只是把它显式画出来。删掉序号，三条说明
  // 一字不少，所以它不该占正文档。
  'cv-auth__spec-no',
])

describe('§2.2/§8 必读文字不得占用模板的装饰微字档', () => {
  it('没有第二份 10.5px / 10px / 9.5px 字面量（要就用令牌，要就升档）', () => {
    const lit = []
    for (const f of files) {
      code(f).split('\n').forEach((line, i) => {
        if (/font-size:\s*(?:10\.5|10|9\.5)px/.test(line)) lit.push(`${rel(f)}:${i + 1} ${line.trim()}`)
      })
    }
    expect(lit).toEqual([])
  })

  it('装饰微字档只出现在白名单选择器里（棘轮：新增即红）', () => {
    const offenders = []
    let micro = 0
    for (const f of files) {
      if (rel(f).startsWith('design/')) continue
      let sel = ''
      code(f).split('\n').forEach((line, i) => {
        const inline = line.match(/^\s*([^{}]+)\{/)
        if (inline) sel = inline[1].trim()
        else if (line.trim().endsWith('{')) sel = line.trim().replace(/\{.*$/, '')
        if (!/font-size:\s*var\(\s*--ds-size-(?:meta|hud|rail)\b/.test(line)) return
        micro++
        const classes = [...sel.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1])
        if (!classes.length || !classes.every((c) => DECOR_MICRO.has(c))) {
          offenders.push(`${rel(f)}:${i + 1}  ${sel || '(未取到选择器)'}  { ${line.trim()} }`)
        }
      })
    }
    expect(micro).toBeGreaterThan(10)
    expect(offenders).toEqual([])
    expect(DECOR_MICRO.size).toBe(19)
  })
})

/* 色值棘轮（§2.2「颜色只能从设计令牌读取」剩下的那一段）。
   2026-09-27 现跑现计：黑场 / 暖白 / 发丝线 / 语义状态 / 焦点环这些**结构色**已全部走 `--ds-*`
   或 styles.css :root 的别名，余下的是**一次性的 alpha 洗色**——场景点缀在某页当浅底、登录页的
   径向泛光与黑幕渐隐、滚动条与内凹分区的暖白档。同一族色在两处以上重复写的（`.45` 描边一族与
   暖白 0.06 / 0.1 / 0.22 一族，共 29 处）已提成 `--ds-*-edge` / `--ds-wash-*`（tokens.css §4.5）。
   这张表是提完之后的余量，口径与上面几条一致：折掉 var 兜底、跳过自定义属性的定义行
   （定义处就是这些值的出处）。每一格只许减不许增；减到 0 就把那一行删掉，第二条专门盯这件事。 */
const COLOR_CEILING = {
  'styles.css': 44,
}

function colorCountPerFile() {
  const per = new Map()
  for (const f of files) {
    const key = rel(f)
    if (key.startsWith('design/')) continue
    let n = 0
    for (const line of code(f).split('\n')) {
      if (/^\s*--[a-z0-9-]+\s*:/.test(line)) continue
      n += (line.replace(COLOR_NESTED, 'TOK').match(COLOR_LIT) || []).length
    }
    if (n) per.set(key, n)
  }
  return per
}

describe('§2.2 色值字面量只减不增（棘轮）', () => {
  it('每个文件的剩余色值字面量不超过登记的余量', () => {
    const per = colorCountPerFile()
    expect([...per.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(10)
    const over = []
    for (const [file, n] of per) {
      const ceiling = COLOR_CEILING[file]
      if (ceiling === undefined) over.push(`${file}: ${n} 处，但没有登记余量（新页面在写硬编码色值？）`)
      else if (n > ceiling) over.push(`${file}: ${n} > 登记余量 ${ceiling}`)
    }
    expect(over, `新增或回潮的硬编码色值：\n${over.join('\n')}`).toEqual([])
  })

  it('余量降到 0 就删掉那一行（棘轮不许留下可以回潮的空间）', () => {
    const per = colorCountPerFile()
    const dead = Object.keys(COLOR_CEILING).filter((f) => !per.has(f))
    expect(dead.map((f) => `${f} 已经没有硬编码色值，删掉 COLOR_CEILING 里这一行`)).toEqual([])
  })
})
