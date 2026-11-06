/**
 * LEARN-01 第 1 条：课程→阶段→能力点→挑战→项目→复习的映射校验。
 *
 * 这一条要的从来不是「再写一套 content-check」，而是把**分散在各批测试里的零断言**
 * 收成一个能一次跑完整张图的校验器：`lessons.test.ts` 那 20 多条是按批次追加的
 * （「阶段 A 至少 3 个单元」「J2 在沙箱可执行」…），谁都没横向看过整张图，
 * 于是 09-13 写下这张卡时说的那句「lessons.ts 仍有『阶段 B：数组与基础算法（JavaScript）』
 * 批次说明」挂到今天——它挂着的不是断言缺失，而是**没有人把这条边当图来看**。
 *
 * 六条边在代码里的真实形状（这就是为什么这里分三档，而不是一律报错）：
 * - 阶段→阶段：`CurriculumStage.prerequisites`，显式，可直接判引用有效与无环。
 * - 挑战→阶段：`Challenge.stageId` 与 `Challenge.prerequisites`，显式（13 关由 `curriculumStages.map` 生成，天然 1:1，但 1:1 也要有人钉住）。
 * - 课程→阶段：`LessonUnit.stageId` **字段存在但旧内置课程一条都没写**（lessons.ts 里 `stageId:` 出现 0 次），
 *   这条边目前只活在 `const stageBUnits` 这种变量名与注释里。所以这里把它分成两档：
 *   显式声明缺失记 `stage_edge_implicit`（现状 44 条，**只许减不许增**），不记错误。
 * - 能力点：阶段的 `topics` 是展示用的技能点清单，没有独立 id，别处不引用 → 只判非空。
 * - 项目→课程：`Project` 是用户自己建的数据（`use-projects`），本库不预置项目，也没有 lesson 引用字段 → 无这条边可校。
 * - 复习→课程：复习记录的 `refId` 指向课程或挑战，**校验在 `use-review-schedule` 一侧按当时数据判**，
 *   静态数据里没有这条边。
 */
import { detectTemplate, simulateProgram } from '../engine/teaching-runtime'
import { validateJavaScriptSandbox } from '../engine/javascript-sandbox'
import type { Challenge, Lesson } from '../types/lesson'
import type { CurriculumStage } from './curriculum'

export type GraphIssue = { kind: string; entity: string; detail: string }

export type GraphReport = {
  errors: GraphIssue[]
  /** 现状钉数：只许减不许增，见 graph.test.ts 的那条棘轮 */
  stageEdgeImplicit: GraphIssue[]
  /** 阶段前置写成 `stage-a` 而非 `A`：这条边目前只有渲染路径会解（challenges-view.tsx:715） */
  nonCanonicalStageRefs: GraphIssue[]
  /** 语言与该阶段挑战不同（卡片点名的「阶段与课程错配」） */
  stageLanguageMismatch: GraphIssue[]
  /** 先修项写成描述文字（「知道什么是变量」）而不是课程 id：旧内置课程的历史写法 */
  lessonPrerequisiteProse: GraphIssue[]
  /** 缺省 teaching 但运行器认不出：界面会老实报「未识别代码结构」，所以不算谎报，只钉条数 */
  teachingClaimsUnrecognized: GraphIssue[]
  stats: { stages: number; challenges: number; lessons: number; teachingUnits: number; externalUnits: number }
}

const STAGE_LETTERS = 'ABCDEFGHIJKLM'

/** 从课程 id 里保守地推出阶段字母：`b1-array-basics` → B、`java-algo-c2` → C；推不出就算没有。 */
export function deriveStageLetter(id: string): string | undefined {
  const bare = /^[a-z]+-[a-z]+-([a-m])\d/.exec(id) ?? /^[a-z]+-([a-m])\d/.exec(id) ?? /^([a-m])\d/.exec(id)
  const letter = bare?.[1]?.toUpperCase()
  return letter && STAGE_LETTERS.includes(letter) ? letter : undefined
}

/** `content.prerequisites` 里混着说明文字：`java-algo-c2（C2 循环累加）` 只取前导 id。 */
export function prerequisiteId(entry: string): string {
  return /^[A-Za-z0-9-]+/.exec(entry.trim())?.[0] ?? entry.trim()
}

/**
 * 阶段引用的两种写法：`A`（大纲里的规范 id）与 `stage-a`（挑战的前置字段实际用的那种）。
 *
 * 这不是洁癖：`challenges-view.tsx:715` 显示前置时写的是
 * `challenge.prerequisites.map((id) => id.replace('stage-', '').toUpperCase())`——
 * **这条边目前只有渲染路径知道怎么解**。校验器把同一个归一化收进来自检，
 * 并把「用的是非规范写法」单列成棘轮（改数据的 id 形态属映射迁移，要走审计卡第 2 条的旧→新映射，
 * 不在这一轮偷偷做）。
 */
export function normalizeStageRef(ref: string): string {
  return ref.replace(/^stage-/i, '').toUpperCase()
}

/** 这条先修项像是在指一节课（形如 java-loop-sum 的小写连字符 id），还是一句描述文字。 */
export function looksLikeLessonId(entry: string): boolean {
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(entry.trim())
}

/** 该引用是否已经写成规范形态（大写字母本身，不带 `stage-` 前缀、不带大小写混写）。 */
export function isCanonicalStageRef(ref: string): boolean {
  return /^[A-M]$/.test(ref)
}

function cyclePath(stageId: string, edges: Map<string, string[]>, seen: Set<string>, stack: string[]): string[] | undefined {
  if (stack.includes(stageId)) return [...stack.slice(stack.indexOf(stageId)), stageId]
  if (seen.has(stageId)) return undefined
  seen.add(stageId)
  stack.push(stageId)
  for (const next of edges.get(stageId) ?? []) {
    const found = cyclePath(next, edges, seen, stack)
    if (found) return found
  }
  stack.pop()
  return undefined
}

export function validateCurriculumGraph(input: {
  stages: CurriculumStage[]
  challenges: Challenge[]
  lessons: Lesson[]
}): GraphReport {
  const { stages, challenges, lessons } = input
  const errors: GraphIssue[] = []
  const stageEdgeImplicit: GraphIssue[] = []
  const nonCanonicalStageRefs: GraphIssue[] = []
  const lessonPrerequisiteProse: GraphIssue[] = []
  const teachingClaimsUnrecognized: GraphIssue[] = []
  const stageLanguageMismatch: GraphIssue[] = []
  const add = (kind: string, entity: string, detail: string) => errors.push({ kind, entity, detail })

  /* ── 阶段：唯一、A—M 齐、能力点与验收非空、前置引用有效且无环 ───────────── */
  const stageIds = new Set<string>()
  for (const stage of stages) {
    if (stageIds.has(stage.id)) add('stage-duplicate', stage.id, '阶段 id 重复')
    stageIds.add(stage.id)
    if (!stage.title.trim()) add('stage-empty-title', stage.id, '阶段没有标题')
    if (stage.topics.length === 0) add('stage-no-topics', stage.id, '能力点（topics）为空：这条阶段无法说明自己要覆盖什么')
    if (!stage.checkpoint.trim()) add('stage-no-checkpoint', stage.id, '阶段验收（checkpoint）为空')
  }
  const expected = [...STAGE_LETTERS]
  for (const letter of expected) {
    if (!stageIds.has(letter)) add('stage-missing', letter, `大纲要求 A—M 十三阶段，缺少 ${letter}`)
  }
  const edges = new Map<string, string[]>(stages.map((stage) => [stage.id, stage.prerequisites]))
  for (const stage of stages) {
    for (const pre of stage.prerequisites) {
      if (pre === stage.id) add('stage-self-prerequisite', stage.id, '前置里写了自己')
      else if (!stageIds.has(pre)) add('stage-dangling-prerequisite', stage.id, `前置阶段 ${pre} 不存在`)
    }
    const cycle = cyclePath(stage.id, edges, new Set(), [])
    if (cycle && cycle[0] === cycle[cycle.length - 1] && cycle[0] === stage.id) {
      add('stage-prerequisite-cycle', stage.id, `前置成环：${cycle.join(' → ')}`)
    }
  }

  /* ── 挑战：每关一题、引用有效、runner 与语言及真实执行环境相配 ───────────── */
  const byStage = new Map<string, Challenge[]>()
  for (const challenge of challenges) {
    if (!stageIds.has(challenge.stageId)) add('challenge-dangling-stage', challenge.id, `stageId ${challenge.stageId} 不在大纲里`)
    byStage.set(challenge.stageId, [...(byStage.get(challenge.stageId) ?? []), challenge])
    for (const pre of challenge.prerequisites) {
      const canonical = normalizeStageRef(pre)
      if (!stageIds.has(canonical)) add('challenge-dangling-prerequisite', challenge.id, `前置 ${pre} 归一化成 ${canonical} 之后仍不是存在的阶段`)
      else if (!isCanonicalStageRef(pre)) {
        nonCanonicalStageRefs.push({ kind: 'non-canonical-stage-ref', entity: challenge.id, detail: `前置写成 ${pre}，规范 id 是 ${canonical}` })
      }
    }
    switch (challenge.runner) {
      case 'javascript-sandbox':
        if (challenge.language !== 'javascript') {
          add('challenge-runner-language', challenge.id, `runner=javascript-sandbox 但语言是 ${challenge.language}：浏览器沙箱只跑 JS`)
        } else if (validateJavaScriptSandbox(challenge.starterCode)) {
          add('challenge-starter-blocked', challenge.id, '起始代码被沙箱自己的提示性检查拦下，这关一点就报错')
        }
        break
      case 'teaching': {
        const template = detectTemplate(challenge.starterCode, challenge.language)
        if (!template) add('challenge-starter-unrecognized', challenge.id, '教学运行器认不出起始代码结构：这关永远只会报「未识别代码结构」')
        else {
          const lesson = lessons.find((item) => item.id === 'challenge-runner')
          const result = simulateProgram(challenge.starterCode, challenge.language, lesson ?? lessons[0]!)
          if (result.unsupported) add('challenge-starter-unsupported', challenge.id, `模板 ${template.id} 认出了结构但整段跑不出来`)
          if (result.error) add('challenge-starter-error', challenge.id, `起始代码自带运行错误：第 ${result.error.line} 行 ${result.error.message}`)
        }
        break
      }
      case 'external':
        // 外部关卡的「真实环境」声明不可校验，但**不得**同时声称可自动执行。
        if (challenge.targetOutput.length === 0) add('challenge-no-target', challenge.id, '外部关卡没有验收点')
        break
    }
  }
  for (const stageId of stageIds) {
    const count = byStage.get(stageId)?.length ?? 0
    if (count !== 1) add('challenge-per-stage', stageId, `该阶段有 ${count} 关（大纲要求每阶段恰好一关）`)
  }

  /* ── 课程：id 唯一、先修引用有效、runEnvironment 的声称与真实执行能力相配 ── */
  // 先一次扫完再判引用：先修项可以指向列表里靠后的课程，边收集边判会把
  // 「m1 依赖 j3」这种正常写法误报成悬空（第一版就踩在这里）。
  const lessonIds = new Set(lessons.map((lesson) => lesson.id))
  const seenIds = new Set<string>()
  for (const lesson of lessons) {
    if (seenIds.has(lesson.id)) add('lesson-duplicate', lesson.id, '课程 id 重复（列表按 Map 去重时会静默吞掉后一条）')
    seenIds.add(lesson.id)
    const unit = lesson.content
    for (const entry of unit.prerequisites) {
      const ref = prerequisiteId(entry)
      if (!ref) add('lesson-empty-prerequisite', lesson.id, '先修项是空串')
      else if (looksLikeLessonId(entry)) {
        if (!lessonIds.has(ref) && !stageIds.has(normalizeStageRef(ref))) {
          add('lesson-dangling-prerequisite', lesson.id, `先修项 ${entry} 指向不存在的课程或阶段`)
        }
      } else {
        lessonPrerequisiteProse.push({ kind: 'lesson-prerequisite-prose', entity: lesson.id, detail: `先修项写成了描述文字：${entry}` })
      }
    }
    const environment = unit.runEnvironment ?? 'teaching'
    if (environment === 'teaching') {
      const recognized = detectTemplate(lesson.code, lesson.language)
      if (!recognized) {
        // 显式 executable:true 是「这页能自动跑」的声称，认不出就是谎报；
        // 只是没写 runEnvironment 的旧课程不算谎报——按了运行键界面会老实说「未识别代码结构」。
        if (lesson.executable === true) add('lesson-claims-teaching-but-unrecognized', lesson.id, 'executable:true 但教学运行器认不出这段代码')
        else teachingClaimsUnrecognized.push({ kind: 'teaching-claim-unrecognized', entity: lesson.id, detail: '缺省 teaching，但运行器认不出这段代码（按运行键会得「未识别代码结构」）' })
      }
      else {
        const result = simulateProgram(lesson.code, lesson.language, lesson)
        if (result.unsupported) add('lesson-claims-teaching-but-unsupported', lesson.id, '声称教学运行器可执行，真跑却返回「未识别代码结构」')
        if (result.error) add('lesson-claims-teaching-but-errors', lesson.id, `声称可执行却自带错误：第 ${result.error.line} 行 ${result.error.message}`)
      }
    } else if (environment === 'external') {
      if (lesson.executable === true) add('lesson-external-executable', lesson.id, '外部环境实验却把 executable 设成 true：本页会伪造运行结果')
    } else {
      add('lesson-unknown-environment', lesson.id, `未知 runEnvironment：${String(environment)}`)
    }

    /* 课程→阶段这条边：显式声明缺失是**现状**，语言错配也是现状，两样都走棘轮而不是错误，
       否则门禁会因为一条 09-13 就写下、需要用户裁定归属的老账而常红。 */
    const derived = unit.stageId ?? deriveStageLetter(lesson.id)
    if (!unit.stageId) {
      stageEdgeImplicit.push({ kind: 'stage-edge-implicit', entity: lesson.id, detail: derived ? `阶段只能由 id 推出（${derived}）；content.stageId 未写` : '推不出阶段，且 content.stageId 未写' })
    }
    const stage = unit.stageId ?? derived
    const challenge = stage ? challenges.find((item) => item.stageId === stage) : undefined
    if (challenge && challenge.language !== lesson.language) {
      stageLanguageMismatch.push({
        kind: 'stage-language-mismatch',
        entity: lesson.id,
        detail: `课程语言 ${lesson.language}，而 ${stage} 阶段验收关的语言是 ${challenge.language}`,
      })
    }
  }

  return {
    errors,
    stageEdgeImplicit,
    nonCanonicalStageRefs,
    lessonPrerequisiteProse,
    teachingClaimsUnrecognized,
    stageLanguageMismatch,
    stats: {
      stages: stages.length,
      challenges: challenges.length,
      lessons: lessons.length,
      teachingUnits: lessons.filter((lesson) => (lesson.content.runEnvironment ?? 'teaching') === 'teaching').length,
      externalUnits: lessons.filter((lesson) => lesson.content.runEnvironment === 'external').length,
    },
  }
}
