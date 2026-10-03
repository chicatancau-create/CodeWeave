/**
 * LINK-07 键盘焦点样式不变式。
 *
 * 真实浏览器验收发现：若干组件（`.field-label input`、`.auth-form input`、
 * `.global-search__input`、`.code-textarea`、`.project-code`）用与
 * `input:focus-visible` 相同的优先级写 `outline: 0`，且位置更靠后，
 * 按层叠顺序会把这些控件的焦点轮廓覆盖掉。
 *
 * 修复方式是在样式表末尾追加更高优先级的 `:focus-visible` 规则。
 * 这个测试锁住两条不变式，防止后续有人在文件末尾再加 `outline: 0` 把焦点环吃掉：
 *   1. 末尾的兜底 `:focus-visible` 块存在；
 *   2. 它之后不再出现任何「取消 outline」的声明。
 *
 * 说明：jsdom 不实现 `:focus-visible` 的层叠与匹配，这里只能检查源码层不变式；
 * 真实可见性仍需在**获得系统焦点的窗口**里人工确认（自动化窗口 document.hasFocus()
 * 为 false 时 Chrome 不匹配 :focus-visible，实测即如此）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { webScript } from './layout.mjs'

/**
 * 归属：这条扫的是网页端的 `src/styles.css`（键盘焦点是无障碍纪律，§7.1）。
 * 它原先寄在后端包里，而且用 `resolve(process.cwd(), 'src/styles.css')` 取文件——
 * 那句话只在「vitest 的工作目录恰好是网页端工程根」时成立，后端包自己跑时直接 ENOENT。
 * 现在从网页端工程根定位，不再依赖进程工作目录（断言一条没改）。
 */
const css = readFileSync(webScript('src/styles.css'), 'utf8')

describe('键盘焦点样式不变式', () => {
  it('存在末尾的高优先级 :focus-visible 兜底块', () => {
    expect(css).toContain('html button:focus-visible')
    expect(css).toContain('html textarea:focus-visible')
    expect(css).toContain('[tabindex]:focus-visible')
  })

  it('兜底块之后不再出现取消 outline 的声明', () => {
    const marker = css.lastIndexOf('html button:focus-visible')
    expect(marker).toBeGreaterThan(-1)
    const cancellations = [...css.slice(marker).matchAll(/outline(-style)?:\s*(0|none)/g)]
    expect(cancellations.map((match) => match[0])).toEqual([])
  })

  it('兜底块位于所有组件层 outline:0 之后', () => {
    expect(css.lastIndexOf('html button:focus-visible')).toBeGreaterThan(css.lastIndexOf('outline: 0'))
  })

  /**
   * 「跳到主内容」在窄屏不能被 display:none 掉。
   *
   * 它本来就靠 `top: -56px` 停在屏幕外、`:focus` 才落回 12px——隐藏已经做完了。
   * 再把它列进 `max-width: 760px` 那份 `display: none` 清单（以前确实在里面），
   * 等于把这条链接从 Tab 顺序里整个删掉：窄屏键盘用户按第一下 Tab 什么都拿不到。
   * jsdom 不跑层叠，所以这里锁源码；真机那侧由 §5.4 的整页 Tab 走查覆盖。
   */
  it('skip-link 靠位移隐藏，不出现在任何 display:none 的选择器清单里', () => {
    expect(css).toMatch(/\.skip-link \{[^}]*top: -56px/)
    expect(css).toMatch(/\.skip-link:focus[^{]*\{[^}]*top: 12px/)
    // 先去注释：注释里会照抄历史写法（含 `.skip-link` 那一条），不去掉就是自己咬自己。
    const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const hiddenSelectors = [...declarations.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , block]) => /display:\s*none/.test(block))
      .map(([, head]) => head.trim())
      .filter((head) => /\.skip-link\b/.test(head))
    expect(hiddenSelectors, `skip-link 被 display:none 掉了：${JSON.stringify(hiddenSelectors)}`).toEqual([])
  })
})