/**
 * 02 §5 P1.2 第七节「项目任务」的**消费点**门禁（网页端侧）。
 *
 * 归属：原来这半段在后端包的 `tests/content.unit.discipline.test.mjs` 里，用
 * `runtimeConfig().frontendRoot` 拼出网页端工程根再 `existsSync` 两个前端文件——
 * 后端读端侧源码，正是 §5 明令禁止的那一条（而且 `frontendRoot` 字段已随新布局删除）。
 * 资料库侧的判定（`projectTaskRef` 落地判据 + 占位禁入 + 存量账）留在后端，两边各管各的。
 *
 * 为什么这条必须在网页端存在：第七节长期卡住是因为没人说清「它在应用里被谁消费」。
 * 09-29 读代码定下来：`src/content/adapter.ts` 把 `lesson.projectTaskRef ?? 兜底句` 交给
 * `src/components/learning-workspace-view.tsx` 原样渲染，所以**字段**才是消费入口，
 * 正文里多一个 `## 项目任务` 节而字段不写，界面上显示的仍是那句兜底话。
 * 消费点一旦被改名或搬走，后端那条「invalid/landed/none」判定的口径就变成 fiction，
 * 所以这里钉住两个文件的存在与那两句写法。
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { webScript } from './layout.mjs'

/** 消费点清单：路径 + 那句必须还在的实现形态。 */
const CONSUMPTION_POINTS = [
  { file: 'src/content/adapter.ts', pattern: /projectTask:\s*lesson\.projectTaskRef\s*\?\?/ },
  { file: 'src/components/learning-workspace-view.tsx', pattern: /\{unit\.projectTask\}/ },
]

describe('02 §5 P1.2 第七节「项目任务」的消费点仍在网页端原处', () => {
  it('两个消费点文件都在场（改名或搬走要先核实口径再改）', () => {
    const missing = CONSUMPTION_POINTS.map((point) => point.file).filter((file) => !existsSync(webScript(file)))
    expect(missing, `消费点文件被移动或改名了：${missing.join(', ')}`).toEqual([])
  })

  it('两处实现形态与后端判定所用的口径一致（字段是入口，正文节不是）', () => {
    for (const { file, pattern } of CONSUMPTION_POINTS) {
      const source = readFileSync(webScript(file), 'utf8')
      expect(source, `${file} 里找不到那句被后端判定当作消费入口的写法`).toMatch(pattern)
    }
  })

  it('渲染侧不许把兜底句改写成「有任务」的形态（占位禁入的另一半）', () => {
    const adapter = readFileSync(webScript('src/content/adapter.ts'), 'utf8')
    const fallback = /projectTask:\s*lesson\.projectTaskRef\s*\?\?\s*'([^']*)'/.exec(adapter)
    expect(fallback, 'adapter 的兜底句写法变了：后端那条 projectTaskState 的口径要跟着重定').toBeTruthy()
    // 兜底句必须一眼看得出「没有任务」，不许写成看起来像任务的话。
    expect(fallback[1]).toMatch(/暂无|未编排|没有/)
  })
})
