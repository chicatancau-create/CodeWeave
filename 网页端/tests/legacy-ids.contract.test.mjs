/**
 * LINK-06 的另一半：**冻结的旧实体清单 == 网页端真实导出**。
 *
 * 背景（分离方案 §2 耦合表第三条 / §5 边界规则）：后端包里的 `tests/legacy-map.coverage.test.mjs`
 * 以前直接 `import { lessons, challenges } from '../../frontend/src/data/…'`。现在它改读
 * `contracts/legacy-ids.json`（脱敏的 id 冻结清单，§5 允许跨边界共享的第 3 类 fixture），
 * 那么「这份清单还是不是网页端实际导出的那一批」就必须有人在**网页端这一侧**当场核对——
 * 就是本文件。少了这条，冻结清单会变成一份「谁都不再对照」的陈旧副本，后端那条覆盖门禁会绿着骗人。
 *
 * 后端那条（要资料库映射的 100% 去向）留在后端包：资料库是后端持有的数据，§7.1 明确禁止网页端读它。
 *
 * 重新生成清单：在后端包根执行 `node scripts/contract-legacy-ids.mjs`（它会打印条数）。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { contract, importWebScript, webScript } from './layout.mjs'

const frozen = JSON.parse(readFileSync(contract('legacy-ids.json'), 'utf8'))
const { lessons } = await importWebScript('src/data/lessons.ts')
const { challenges } = await importWebScript('src/data/challenges.ts')

describe('LINK-06 · 冻结的旧实体清单与网页端实际导出一致', () => {
  it('旧课程 id 逐条相同、顺序相同', () => {
    const actual = lessons.map((lesson) => lesson.id)
    expect(actual, '旧课程 id 与 contracts/legacy-ids.json 不一致：增删/改名后要在后端包根重跑 node scripts/contract-legacy-ids.mjs').toEqual(frozen.lessons)
  })

  it('旧挑战 id 逐条相同、顺序相同', () => {
    const actual = challenges.map((challenge) => challenge.id)
    expect(actual, '旧挑战 id 与 contracts/legacy-ids.json 不一致：重跑 node scripts/contract-legacy-ids.mjs').toEqual(frozen.challenges)
  })

  it('清单里的 counts 与实际导出条数一致，且合起来正是后端覆盖门禁的分母', () => {
    expect(frozen.counts).toEqual({
      lessons: lessons.length,
      challenges: challenges.length,
      total: lessons.length + challenges.length,
    })
    // 后端 `tests/legacy-map.coverage.test.mjs` 用 `[...lessons, ...challenges]` 当分母，顺序在这里钉死。
    expect([...frozen.lessons, ...frozen.challenges]).toHaveLength(frozen.counts.total)
  })

  it('源文件指纹与清单登记的一致（改了数据文件却没重跑脚本也会红在这里）', () => {
    const sha = (relativeFromWebRoot) => createHash('sha256').update(readFileSync(webScript(relativeFromWebRoot))).digest('hex')
    expect(frozen.sources.length, '契约没登记任何源文件指纹').toBe(2)
    for (const source of frozen.sources) {
      // 指纹按文件名落到本工程的 `src/data/<文件>`：契约里的 path 在阶段 C 前后分别是
      // `frontend/src/data/…` 与 `【网页端】_WEB_CLIENT/src/data/…`，两处都归一到同一个消费点。
      const name = source.path.split('/').pop()
      expect(source.path, `契约登记的源文件路径不在 src/data 下：${source.path}`).toMatch(/src\/data\/[\w-]+\.ts$/)
      const actual = sha(`src/data/${name}`)
      expect(actual, `${name} 已改动但清单没重新生成：跑 node scripts/contract-legacy-ids.mjs`).toBe(source.sha256)
      expect(source.exportedCount).toBe(source.path.includes('challenges') ? challenges.length : lessons.length)
    }
  })

  it('清单是脱敏 fixture：本侧只比对 id，绝不把题干正文写进契约', () => {
    const entities = JSON.stringify({ lessons: frozen.lessons, challenges: frozen.challenges })
    for (const id of [...frozen.lessons, ...frozen.challenges]) expect(id, id).toMatch(/^[\w.-]{1,64}$/)
    expect(entities).not.toMatch(/```|https?:/)
    // 网页端导出的实体对象里有正文，但那些正文一个字都不许出现在契约里。
    const sampleBody = String(lessons.find((lesson) => lesson.units?.length)?.units?.[0]?.content ?? lessons[0]?.title ?? '')
    if (sampleBody.length > 24) expect(entities).not.toContain(sampleBody.slice(0, 24))
  })
})
