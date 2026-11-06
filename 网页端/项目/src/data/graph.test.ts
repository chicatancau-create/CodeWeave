import { describe, expect, it } from 'vitest'
import { curriculumStages } from './curriculum'
import { challenges } from './challenges'
import { lessons } from './lessons'
import { deriveStageLetter, prerequisiteId, validateCurriculumGraph } from './graph'

/**
 * LEARN-01 第 1 条的映射校验器。
 *
 * 两份账分开跑：**错误**是图真的坏了（悬空引用、成环、声称可执行却跑不出来、每阶段不是一关），
 * 必须为空；**棘轮**是 09-13 就写下、至今需要用户裁定归属的两笔老账
 * （课程不写 `content.stageId`；B 阶段下挂着 JavaScript 单元），
 * 只钉住「今天有多少条、从此不许变多」，不假装已经修好。
 */
const report = validateCurriculumGraph({ stages: curriculumStages, challenges, lessons })
const flat = (list: { entity: string; kind: string; detail: string }[]) =>
  list.map((item) => `${item.entity} ${item.kind}：${item.detail}`)

describe('映射校验器 · 现役数据', () => {
  it('整张图没有硬错误（引用有效、无环、每阶段恰好一关、可执行声称真跑得起来）', () => {
    expect(flat(report.errors), JSON.stringify(report.errors, null, 1)).toEqual([])
  })

  it('规模符合大纲：13 阶段 / 13 关 / 课程总数与统计栏一致', () => {
    expect(report.stats.stages).toBe(13)
    expect(report.stats.challenges).toBe(13)
    expect(report.stats.lessons).toBe(lessons.length)
    expect(report.stats.teachingUnits + report.stats.externalUnits).toBeGreaterThanOrEqual(report.stats.lessons)
  })
})

describe('棘轮 · 五笔现状账只许减不许增（每一笔都附「它为什么不算错」）', () => {
  it('① 课程→阶段这条边仍有 20 门是隐式的', () => {
    // 61 门旧内置课程里 41 门由 `unit(..., 'C')` 那个尾参显式写了 content.stageId；
    // 剩下 20 门（更早那批 python / c / csharp / java / javascript 的 loop-sum 一类）没写，
    // 只能由 id 前缀推。这一条钉的是「不再有更多课程把这条边留在隐式状态」。
    expect(report.stageEdgeImplicit).toHaveLength(20)
  })

  it('② 挑战的阶段前置仍写成 stage-a 而不是 A', () => {
    // 能解，但目前只有渲染路径知道怎么解（challenges-view.tsx:715 那句 replace('stage-','')）。
    expect(report.nonCanonicalStageRefs).toHaveLength(15)
  })

  it('③ 先修项仍常写成描述文字而不是课程 id', () => {
    // 「知道什么是变量」这类是文字，不是断链；把它们当引用判会天天误报。
    expect(report.lessonPrerequisiteProse).toHaveLength(34)
  })

  it('④ 缺省 teaching 但运行器认不出来的，是这 9 门', () => {
    // 不算谎报：按运行键时界面会老实给出「未识别代码结构，未产生通过判定」（R4 G.3 第 5 条）。
    // 只有显式 executable:true 又认不出，才升级为错误。
    // 09-29 从 8 门变 9 门：`b3-binary-search` 原先是「认出」的，但那是误认——整段只有一个 `while (left <= right)`，
    // 没有 count/i 计数变量，旧 while-loop 模板拿默认值替它编出 1、2、3 三行输出，而这段代码真跑只印一个 2。
    // 误认本来就不该记在「认出」那一栏，所以这条棘轮是往正确方向动的。
    expect(report.teachingClaimsUnrecognized.map((item) => item.entity)).toEqual([
      'python-types', 'c-04', 'csharp-04', 'java-04', 'javascript-04', 'b1-array-basics', 'b2-bubble-sort', 'b3-binary-search', 'j2-xss-sanitize-sandbox',
    ])
  })

  it('⑤ 阶段与课程语言错配的，仍是审计卡点名的 B 阶段那三门', () => {
    expect(report.stageLanguageMismatch.map((item) => item.entity)).toEqual(['b1-array-basics', 'b2-bubble-sort', 'b3-binary-search'])
  })
})

describe('校验器本身判得动吗（每种错误都造一次反例）', () => {
  const base = () => ({
    stages: curriculumStages.map((stage) => ({ ...stage, prerequisites: [...stage.prerequisites] })),
    challenges: challenges.map((challenge) => ({ ...challenge, prerequisites: [...challenge.prerequisites] })),
    lessons: lessons.map((lesson) => ({ ...lesson, content: { ...lesson.content, prerequisites: [...lesson.content.prerequisites] } })),
  })
  const run = (patch: (input: ReturnType<typeof base>) => void) => {
    const input = base()
    patch(input)
    return validateCurriculumGraph(input).errors.map((item) => item.kind)
  }

  it('阶段前置悬空 / 自引用 / 成环', () => {
    expect(run((i) => { i.stages.find((s) => s.id === 'A')!.prerequisites.push('ZZ') })).toContain('stage-dangling-prerequisite')
    expect(run((i) => { i.stages.find((s) => s.id === 'A')!.prerequisites.push('A') })).toContain('stage-self-prerequisite')
    // A→B 且 B→A：两阶段互为前置，成环必须从任一端都点得出来
    const bothWays = (id: 'A' | 'B') => run((i) => {
      i.stages.find((s) => s.id === 'A')!.prerequisites = ['B']
      i.stages.find((s) => s.id === 'B')!.prerequisites = [id]
    })
    expect(bothWays('A')).toContain('stage-prerequisite-cycle')
    expect(bothWays('B')).toContain('stage-prerequisite-cycle')
  })

  it('能力点为空 / 阶段缺失 / 每阶段关数不为 1', () => {
    expect(run((i) => { i.stages[0]!.topics = [] })).toContain('stage-no-topics')
    expect(run((i) => { i.stages = i.stages.filter((s) => s.id !== 'M') })).toContain('stage-missing')
    expect(run((i) => { i.challenges = i.challenges.filter((c) => c.stageId !== 'D') })).toContain('challenge-per-stage')
    expect(run((i) => { i.challenges.push({ ...i.challenges[0]!, id: 'stage-d-2' }) })).toContain('challenge-per-stage')
  })

  it('runner 与语言不相配 / 教学关起始代码认不出 / 沙箱关起始代码自拦', () => {
    expect(run((i) => {
      const target = i.challenges.find((c) => c.runner === 'javascript-sandbox')!
      target.language = 'java'
    })).toContain('challenge-runner-language')
    expect(run((i) => {
      const target = i.challenges.find((c) => c.runner === 'teaching')!
      target.starterCode = '// 只有注释，没有任何可识别结构'
    })).toContain('challenge-starter-unrecognized')
    expect(run((i) => {
      const target = i.challenges.find((c) => c.runner === 'javascript-sandbox')!
      target.starterCode = 'fetch("https://example.com")'
    })).toContain('challenge-starter-blocked')
  })

  it('课程先修悬空 / 声称可执行却跑不出来 / 外部课却标可自动执行', () => {
    expect(run((i) => { i.lessons[0]!.content.prerequisites = ['no-such-lesson-xyz'] })).toContain('lesson-dangling-prerequisite')
    expect(run((i) => {
      // 只有显式 executable:true 才是谎报；缺省 teaching 认不出只进棘轮，
      // 因为按运行键时界面会老实说「未识别代码结构，未产生通过判定」。
      const target = i.lessons.find((l) => (l.content.runEnvironment ?? 'teaching') === 'teaching')!
      target.code = 'print("这不是运行器支持的子集")'
      target.language = 'python'
      target.executable = true
    })).toContain('lesson-claims-teaching-but-unrecognized')
    expect(run((i) => {
      const target = i.lessons.find((l) => l.content.runEnvironment === 'external')!
      target.executable = true
    })).toContain('lesson-external-executable')
  })

  it('重复 id 会被抓出来（列表去重是静默的，不查就永远看不见）', () => {
    const kinds = run((i) => { i.lessons.push({ ...i.lessons[0]! }) })
    expect(kinds).toContain('lesson-duplicate')
  })
})

describe('两个小工具函数', () => {
  it('先修项取前导 id：`java-algo-c2（C2 循环累加）` → java-algo-c2', () => {
    expect(prerequisiteId('java-algo-c2（C2 循环累加）')).toBe('java-algo-c2')
    expect(prerequisiteId('  b1-array-basics ')).toBe('b1-array-basics')
  })

  it('从 id 推阶段字母：b1-* → B，java-algo-c2 → C，推不出的算没有', () => {
    expect(deriveStageLetter('b1-array-basics')).toBe('B')
    expect(deriveStageLetter('java-algo-c2')).toBe('C')
    expect(deriveStageLetter('cw-java-control-flow-001')).toBeUndefined()
  })
})
