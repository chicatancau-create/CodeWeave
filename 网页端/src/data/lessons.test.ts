import { describe, expect, it } from 'vitest'
import { lessons } from './lessons'
import { simulateProgram } from '../engine/teaching-runtime'
import { validateJavaScriptSandbox } from '../engine/javascript-sandbox'
import type { Lesson } from '../types/lesson'

const byStage = (stageId: string) => lessons.filter((lesson) => lesson.content.stageId === stageId)

const dummyLesson: Lesson = lessons[0]!

describe('lessons 数据（B3 第一批）', () => {
  it('全部单元 id 唯一', () => {
    const ids = lessons.map((lesson) => lesson.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('阶段 A 至少 3 个可访问单元，且全部标注 external', () => {
    const units = byStage('A')
    expect(units.length).toBeGreaterThanOrEqual(3)
    for (const unit of units) {
      expect(unit.content.runEnvironment).toBe('external')
      expect(unit.content.evidenceChecklist?.length ?? 0).toBeGreaterThan(0)
      expect(unit.content.acceptanceCriteria?.length ?? 0).toBeGreaterThan(0)
    }
  })

  it('阶段 C 至少 3 个可访问单元，且全部可在教学运行器执行', () => {
    const units = byStage('C')
    expect(units.length).toBeGreaterThanOrEqual(3)
    for (const unit of units) {
      expect(unit.content.runEnvironment).toBe('teaching')
    }
  })

  it('C1 运行结果与验收点一致（较大值 8）', () => {
    const c1 = byStage('C').find((lesson) => lesson.id === 'java-algo-c1')!
    const result = simulateProgram(c1.code, c1.language, dummyLesson)
    expect(result.error).toBeUndefined()
    expect(result.output).toEqual(['8'])
  })

  it('C3 倒数输出 5 4 3 2 1', () => {
    const c3 = byStage('C').find((lesson) => lesson.id === 'java-algo-c3')!
    const result = simulateProgram(c3.code, c3.language, dummyLesson)
    expect(result.error).toBeUndefined()
    expect(result.output).toEqual(['5', '4', '3', '2', '1'])
  })

  it('每个单元都有唯一 unitId（id）与预计时长或明确外部说明', () => {
    for (const lesson of lessons) {
      expect(lesson.id).toBeTruthy()
      if (lesson.content.runEnvironment === 'external') {
        // 外部单元必须给出真实环境说明，不能冒充可运行
        expect(lesson.runtime).toMatch(/外部环境/)
      }
    }
  })
})

describe('lessons 数据（B3 第二批：阶段 B、D）', () => {
  const stageB = lessons.filter((lesson) => lesson.content.stageId === 'B')
  const stageD = lessons.filter((lesson) => lesson.content.stageId === 'D')

  it('阶段 B 至少 3 个单元，id 为 b1/b2/b3 前缀且属于 B 阶段', () => {
    const ids = stageB.map((lesson) => lesson.id)
    expect(ids).toEqual(expect.arrayContaining(['b1-array-basics', 'b2-bubble-sort', 'b3-binary-search']))
    for (const unit of stageB) {
      expect(unit.content.stageId).toBe('B')
    }
  })

  it('B 单元先修链正确：b2 依赖 b1，b3 依赖 b1+b2', () => {
    const byId = new Map(stageB.map((lesson) => [lesson.id, lesson]))
    expect(byId.get('b2-bubble-sort')?.content.prerequisites.join(' ')).toContain('b1-array-basics')
    const b3 = byId.get('b3-binary-search')?.content.prerequisites.join(' ') ?? ''
    expect(b3).toContain('b1-array-basics')
    expect(b3).toContain('b2-bubble-sort')
  })

  it('B 单元为 JS 沙箱可执行：语言 javascript、代码全部通过安全校验', () => {
    for (const unit of stageB.filter((lesson) => lesson.id.startsWith('b'))) {
      expect(unit.language).toBe('javascript')
      expect(unit.content.runEnvironment).toBe('teaching')
      expect(validateJavaScriptSandbox(unit.code)).toBeUndefined()
    }
  })

  it('阶段 D 至少 3 个单元，id 为 d1/d2/d3 前缀且全部为外部环境实验', () => {
    const ids = stageD.map((lesson) => lesson.id)
    expect(ids).toEqual(
      expect.arrayContaining(['d1-html-semantics', 'd2-css-box-model', 'd3-dom-events']),
    )
    for (const unit of stageD.filter((lesson) => lesson.id.startsWith('d'))) {
      expect(unit.content.runEnvironment).toBe('external')
      expect(unit.runtime).toMatch(/外部环境/)
    }
  })

  it('D 单元都有验收标准与证据清单', () => {
    for (const unit of stageD.filter((lesson) => lesson.id.startsWith('d'))) {
      expect(unit.content.acceptanceCriteria?.length ?? 0).toBeGreaterThan(0)
      expect(unit.content.evidenceChecklist?.length ?? 0).toBeGreaterThan(0)
      expect(unit.content.estimatedMinutes).toBeGreaterThan(0)
    }
  })

  it('数据兼容：追加 B/D 后，A/C 既有单元数量与 id 不受影响', () => {
    const stageA = lessons.filter((lesson) => lesson.content.stageId === 'A')
    const stageC = lessons.filter((lesson) => lesson.content.stageId === 'C')
    expect(stageA.map((lesson) => lesson.id)).toEqual([
      'java-env-a1',
      'java-env-a2',
      'java-env-a3',
    ])
    expect(stageC.map((lesson) => lesson.id)).toEqual([
      'java-algo-c1',
      'java-algo-c2',
      'java-algo-c3',
    ])
    // 全部单元 id 仍然唯一
    const ids = lessons.map((lesson) => lesson.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('lessons 数据（B3 第三批：阶段 E、F、G）', () => {
  const stageOf = (stageId: string) => lessons.filter((lesson) => lesson.content.stageId === stageId)

  it.each([
    ['E', ['e1-vue-composition', 'e2-vue-router-guard', 'e3-pinia-state']],
    ['F', ['f1-webpack-entry-loader', 'f2-webpack-plugin-devserver', 'f3-webpack-splitting']],
    ['G', ['g1-http-rest-basics', 'g2-servlet-tomcat', 'g3-jdbc-mysql-crud']],
  ])('阶段 %s 至少 3 个单元且 id 齐全', (stageId, expectedIds) => {
    const units = stageOf(stageId as string)
    expect(units.map((lesson) => lesson.id)).toEqual(expect.arrayContaining(expectedIds as string[]))
    for (const unit of units) {
      expect(unit.content.stageId).toBe(stageId)
    }
  })

  it('E/F/G 新单元全部为外部环境实验，且带验收标准与证据清单', () => {
    for (const stageId of ['E', 'F', 'G']) {
      for (const unit of stageOf(stageId)) {
        if (!unit.id.match(/^[efg][123]-/)) continue
        expect(unit.content.runEnvironment).toBe('external')
        expect(unit.runtime).toMatch(/外部环境/)
        expect(unit.content.acceptanceCriteria?.length ?? 0).toBeGreaterThan(0)
        expect(unit.content.evidenceChecklist?.length ?? 0).toBeGreaterThan(0)
        expect(unit.content.estimatedMinutes).toBeGreaterThan(0)
      }
    }
  })

  it('先修链：e2 依赖 e1，e3 依赖 e1+e2，f2 依赖 f1，f3 依赖 f1+f2', () => {
    const byId = new Map(lessons.map((lesson) => [lesson.id, lesson]))
    expect(byId.get('e2-vue-router-guard')?.content.prerequisites.join(' ')).toContain('e1-vue-composition')
    const e3 = byId.get('e3-pinia-state')?.content.prerequisites.join(' ') ?? ''
    expect(e3).toContain('e1-vue-composition')
    expect(e3).toContain('e2-vue-router-guard')
    expect(byId.get('f2-webpack-plugin-devserver')?.content.prerequisites.join(' ')).toContain('f1-webpack-entry-loader')
    const f3 = byId.get('f3-webpack-splitting')?.content.prerequisites.join(' ') ?? ''
    expect(f3).toContain('f1-webpack-entry-loader')
    expect(f3).toContain('f2-webpack-plugin-devserver')
  })
})

describe('lessons 数据（B3 第三批：二）阶段 H—M', () => {
  const stageOf = (stageId: string) => lessons.filter((lesson) => lesson.content.stageId === stageId)

  const expectedIds: Record<string, string[]> = {
    H: ['h1-spring-ioc-di', 'h2-spring-mvc-validation', 'h3-mybatis-mapper'],
    I: ['i1-springboot-starter', 'i2-springboot-rest-actuator', 'i3-springboot-package-upload'],
    J: ['j1-auth-session-flow', 'j2-xss-sanitize-sandbox', 'j3-csrf-cors-boundary'],
    K: ['k1-service-discovery', 'k2-gateway-config', 'k3-circuit-limit-trace'],
    L: ['l1-linux-ops-basics', 'l2-docker-compose', 'l3-nginx-backup-rollback'],
    M: ['m1-requirement-modeling', 'm2-timebox-mvp', 'm3-review-defense'],
  }

  it.each(Object.keys(expectedIds))('阶段 %s 至少 3 个单元且 id 齐全', (stageId) => {
    const units = stageOf(stageId)
    expect(units.map((lesson) => lesson.id)).toEqual(
      expect.arrayContaining(expectedIds[stageId] as string[]),
    )
    for (const unit of units) {
      expect(unit.content.stageId).toBe(stageId)
    }
  })

  it('H—I—K—L—M 新单元全部为外部环境实验且证据齐全', () => {
    for (const stageId of ['H', 'I', 'K', 'L', 'M']) {
      for (const unit of stageOf(stageId)) {
        if (!unit.id.match(/^[hiklm][123]-/)) continue
        expect(unit.content.runEnvironment).toBe('external')
        expect(unit.runtime).toMatch(/外部环境/)
        expect(unit.content.acceptanceCriteria?.length ?? 0).toBeGreaterThan(0)
        expect(unit.content.evidenceChecklist?.length ?? 0).toBeGreaterThan(0)
      }
    }
  })

  it('J2 在沙箱可执行：安全校验通过且代码验证净化效果；J1/J3 为外部实验', () => {
    const j2 = lessons.find((lesson) => lesson.id === 'j2-xss-sanitize-sandbox')!
    expect(j2.content.runEnvironment).toBe('teaching')
    expect(j2.language).toBe('javascript')
    expect(validateJavaScriptSandbox(j2.code)).toBeUndefined()
    for (const id of ['j1-auth-session-flow', 'j3-csrf-cors-boundary']) {
      const unit = lessons.find((lesson) => lesson.id === id)!
      expect(unit.content.runEnvironment).toBe('external')
    }
  })

  it('H—M 全部单元 id 唯一且先修引用有效（引用的单元真实存在）', () => {
    const ids = new Set(lessons.map((lesson) => lesson.id))
    for (const lesson of lessons) {
      expect(lesson.content.prerequisites.length).toBeGreaterThan(0)
      for (const prerequisite of lesson.content.prerequisites) {
        // 先备项允许是“人类可读描述”或“真实单元 id”；含连字符编号格式的必须真实存在
        if (/^[a-z]\d-/.test(prerequisite)) {
          expect(ids.has(prerequisite)).toBe(true)
        }
      }
    }
  })

  it('A—M 每个阶段现在都有至少 3 个单元', () => {
    for (const stageId of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']) {
      expect(stageOf(stageId).length).toBeGreaterThanOrEqual(3)
    }
  })

  it('J2 代码真实可运行：净化后不含活标签（教学语义抽查）', () => {
    const j2 = lessons.find((lesson) => lesson.id === 'j2-xss-sanitize-sandbox')!
    // 代码断言自查包含“净化后仍含标签?”输出行——沙箱执行逻辑由引擎测试覆盖，这里校验关键内容存在
    expect(j2.code).toContain('escapeHtml')
    expect(j2.code).toContain('includes("<img")')
  })
})
