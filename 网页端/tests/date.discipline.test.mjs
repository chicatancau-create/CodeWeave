/**
 * STAT-01 第 1 条的门禁：**日期键的算法全仓只能有一份**。
 *
 * 卡片点名的形状是「拿 `toISOString().slice(0, 10)` 当本地日期用」——那是 UTC 日，
 * 在 UTC+8 的凌晨会整体偏一天；另有一种是手写 `getFullYear()` + `pad(getMonth()+1)` 拼键，
 * 属于第二套实现，读的人无法判断它按哪个时区归日。本轮之前这两种在 `app.tsx`、
 * `challenges-view.tsx`、`evidence-writeback-view.tsx` 里都还在（`date-helpers.ts` 的注释
 * 早就写着「统一走本地归日」，注释在而调用点没跟上，正是这类漂移能活十年的原因）。
 *
 * 所以这里不测行为（行为由 `src/utils/date-helpers.test.ts` 管），而是**扫源码**：
 * 出现新写法就红，白名单只留给两处有明确理由的老用法。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { webScript } from './layout.mjs'

// 归属：本条扫的是**网页端源码**（§7.1 网页端职责），原先寄在后端包的 tests/ 里，
// 靠 `tests/layout.mjs` 的 `app/` 映射去读 `workspace/frontend/**`——那正是 §5 禁止的
// 「后端测试通过相对路径读取端侧源码来完成核心断言」。断言一条没改，只是搬回它自己的工程。
const SRC = webScript('src')

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

/** 去掉注释：门禁要看的是真代码，不是解释为什么不能这么写的注释。 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const files = sourceFiles(SRC).map((full) => ({
  path: relative(join(SRC, '..'), full).split(sep).join('/'),
  code: stripComments(readFileSync(full, 'utf8')),
}))

/** 唯一实现所在，以及一处「拿 UTC 往返校验用户填的日历日是否存在」的合法用法。 */
const UTC_SLICE_ALLOW = ['src/utils/date-helpers.ts', 'src/utils/external-evidence.ts']

describe('STAT-01 · 日期键只许一份实现', () => {
  it('扫到源码文件（防空跑）', () => {
    expect(files.length).toBeGreaterThan(60)
  })

  it('除白名单外没有任何地方用 toISOString().slice(0, 10) 造日期键', () => {
    const offenders = files
      .filter((f) => !UTC_SLICE_ALLOW.includes(f.path) && f.code.includes('toISOString().slice(0, 10)'))
      .map((f) => f.path)
    expect(offenders, `这些地方把 UTC 日当本地日用：${offenders.join(', ')}`).toEqual([])
  })

  it('除 date-helpers 外没有第二处手拼 YYYY-MM-DD（getMonth + 补零）', () => {
    const pattern = /getMonth\(\)[\s\S]{0,120}padStart\(2/
    const offenders = files
      .filter((f) => f.path !== 'src/utils/date-helpers.ts' && pattern.test(f.code))
      .map((f) => f.path)
    expect(offenders, `这些地方在自建日期键：${offenders.join(', ')}`).toEqual([])
  })

  it('本轮修过的三个调用点确实改成走统一函数（防回退）', () => {
    // 路径复核（01 §4 把 challenges-view.tsx 拆成 challenges/ 多个文件时做过一次）：
    // 拆分只搬走了展示组件与纯函数，两处 `getLocalDateKey()` 一个在改证据草稿的状态更新里、
    // 一个在详情用的兜底证据里，都归属编排组件，所以仍留在 src/components/challenges-view.tsx。
    // 换路径时改这份清单，别把断言删掉；新拆出去的目录由下面那条单独盯，不许长出第二套归日。
    for (const path of ['src/app.tsx', 'src/components/challenges-view.tsx', 'src/components/evidence-writeback-view.tsx']) {
      const found = files.find((f) => f.path === path)
      expect(found, `找不到 ${path}`).toBeTruthy()
      expect(found.code, `${path} 该 import getLocalDateKey`).toMatch(/import\s*\{[^}]*getLocalDateKey[^}]*\}\s*from\s*'\.\.?\/utils\/date-helpers'/)
    }
  })

  /**
   * 组件拆分（01 §4）带来的新面：`src/components/challenges/` 里的每个文件都不许
   * 自己拼日期键 —— 要么走统一函数，要么根本不碰日期。按目录扫，不按文件名列，
   * 以后再拆出别的子文件也自动落进这条闸里。
   */
  it('拆出去的 challenges/ 子文件里没有自建日期键，引到日期就必须走统一函数', () => {
    const split = files.filter((f) => f.path.startsWith('src/components/challenges/'))
    expect(split.length, 'challenges/ 目录该有拆出来的文件（防空跑）').toBeGreaterThan(3)
    for (const file of split) {
      const importsDateHelpers = /from\s*'\.\.\/\.\.\/utils\/date-helpers'/.test(file.code)
      const usesDateKey = /\bgetLocalDateKey\s*\(/.test(file.code)
      expect(usesDateKey && !importsDateHelpers, `${file.path} 自建了日期键却没走 date-helpers`).toBe(false)
      expect(file.code, `${file.path} 不许出现 UTC 切片`).not.toMatch(/toISOString\(\)\.slice\(\s*0\s*,\s*10\s*\)/)
    }
  })
})
