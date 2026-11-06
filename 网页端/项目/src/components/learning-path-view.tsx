/**
 * 学习路径页 · M3 视觉竖切（01 号方案 §3.3「学习路径和内容」）
 *
 * 形态依据：`staging/style-pack/source/css/site.css` 的 `.ledger`(L363-L381)、
 * `.specs`(L286-L305)、`.rail`(L135-L182) 段落；值一律经 `src/design/tokens.css`
 * 的 `--ds-*` 令牌消费，并写死兜底值（令牌尚未由 main.tsx 引入时外观一致）。
 * 造型为「黑场 + 发丝线 + 编号」：无玻璃卡、无渐变按钮、无泛光（§5.1 形态行）。
 *
 * 业务行为保持不变（props 契约与 `app.tsx` L696-L709 调用点一致，未新增字段）：
 * - 前置关系：单元先备清单读 `lesson.content.prerequisites`，只展示不改判定口径。
 * - 继续学习：已选单元 + `onContinue`，仍由 app.tsx 决定进入哪个单元。
 * - 阅读单元：`lesson.reading` 或 `lesson.level === '阅读'` 时显式标识，
 *   原文位置（path + headingPath + 核验状态）照旧展示。
 *
 * 数据边界（§4.1 / §5.1）：不为排版改数据层、不造假数据。
 * 现有数据支撑不了的信息（S0—S9 的阶段名称与检查点未随本视图下发）只在
 * 页脚说明「未接收该数据」，不凭空补名；能由现有字段判定的缺失才作为缺口标识。
 */
import type { Lesson } from '../types/lesson'
import type { SubjectOption } from '../content/adapter'
import type { CurriculumStage } from '../data/curriculum'
import type { LessonEvidenceStates } from '../utils/lesson-evidence'
import { heldLessonStates, holdsCompletion } from '../utils/lesson-evidence'
import { lessonDurationLabel } from '../utils/lesson-duration'
import './learning-path-view.css'

export type LearningPathViewProps = {
  /** 当前内容科目（不是可执行语言：HTML/CSS/Vue/构建工具各自成组） */
  subjectId: string
  /** 科目选项，由内容快照汇总（不写死语言列表） */
  subjects: SubjectOption[]
  lessons: Lesson[]
  /**
   * LEARN-01 第 4 条：每个单元的六种学习状态（已阅读 / 已练习 / 已提交证据 / 自评通过 /
   * 自动验证通过 / 延迟复测掌握）。由上层从掌握度证据记录折出来（`deriveLessonEvidenceStates`），
   * 本视图只列**成立的那几项**，不自己判、也不因为缺了这项就编一个状态。
   */
  lessonStates?: Record<string, LessonEvidenceStates>
  /**
   * LEARN-01 第 3 条「显示未掌握能力」：阶段的能力点原文（验收 checkpoint 与交付物）
   * 由上层把展示口径的那一份阶段表递下来（`content.stages` 或旧 A—M）。
   * 缺省时这一块的说明会写「资料库没给」，不编内容。
   */
  stages?: CurriculumStage[]
  selectedLessonId: string
  /** 下一推荐单元（第一个未完成的课程单元），空表示暂无推荐 */
  recommended?: { label: string; title: string } | null
  onSubjectChange: (subjectId: string) => void
  onLessonChange: (lesson: Lesson) => void
  onContinue: () => void
}

/** 未并入 S0—S9 的单元归入此带；键只用于分组，不参与展示文案。 */
const UNNUMBERED_KEY = '__unnumbered__'
/** 新口径编号阶段（资料库 stageIds 的第一项，形如 S0…S9）。 */
const NUMBERED_STAGE = /^S\d$/

type MarkKind = 'vault' | 'legacy' | 'unknown' | 'reading' | 'external' | 'gap' | 'signal'

/**
 * 一条标识 = 固定字符徽记 + 中文说明。
 * 徽记对辅助技术隐藏（`aria-hidden`），语义完全由文字承载；视觉上另有边框
 * 样式差异（实线/虚线/点线），因此不依赖颜色表意（§5.1 末段）。
 */
type Mark = { kind: MarkKind; glyph: string; text: string }

type StageGroup = {
  key: string
  /** 展示用阶段号；未并入带用 '—' */
  title: string
  numbered: boolean
  lessons: Lesson[]
}

/** 单元所属阶段键：优先新口径 stageId，退回课程编号 label（旧内置为 A1/01 等）。 */
function stageKeyOf(lesson: Lesson): string {
  const raw = lesson.content?.stageId ?? lesson.label
  return typeof raw === 'string' ? raw.trim() : ''
}

function isNumberedStage(key: string): boolean {
  return NUMBERED_STAGE.test(key)
}

/**
 * 按 S0—S9 编号阶段分组，保留 app.tsx 下发的单元顺序（不重排业务次序）。
 * 已出现阶段号之间没有单元的阶段也建一行，作为「阶段缺口」如实说明。
 */
function stageGroups(lessons: Lesson[]): StageGroup[] {
  const buckets = new Map<string, Lesson[]>()
  const unnumbered: Lesson[] = []
  for (const lesson of lessons) {
    const key = stageKeyOf(lesson)
    if (isNumberedStage(key)) {
      const list = buckets.get(key)
      if (list) list.push(lesson)
      else buckets.set(key, [lesson])
      continue
    }
    unnumbered.push(lesson)
  }
  const keys = [...buckets.keys()].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
  const groups: StageGroup[] = []
  const firstKey = keys[0]
  const lastKey = keys[keys.length - 1]
  if (firstKey && lastKey) {
    const first = Number(firstKey.slice(1))
    const last = Number(lastKey.slice(1))
    for (let n = first; n <= last; n += 1) {
      const key = `S${n}`
      groups.push({ key, title: key, numbered: true, lessons: buckets.get(key) ?? [] })
    }
  }
  if (unnumbered.length > 0) {
    groups.push({ key: UNNUMBERED_KEY, title: '—', numbered: false, lessons: unnumbered })
  }
  return groups
}

/** 来源标识：三态互斥，只用已存在的 contentId / legacy 字段判定。 */
function sourceMarkOf(lesson: Lesson): Mark {
  if (lesson.contentId) return { kind: 'vault', glyph: '库', text: '资料库正式内容' }
  if (lesson.legacy) return { kind: 'legacy', glyph: '旧', text: '旧内置课程 · 未迁入资料库' }
  return { kind: 'unknown', glyph: '未', text: '来源未标注' }
}

/** 阅读与运行环境标识（现有字段，不推断）。 */
function runtimeMarksOf(lesson: Lesson): Mark[] {
  const marks: Mark[] = []
  if (lesson.reading) marks.push({ kind: 'reading', glyph: '读', text: '阅读单元 · 主题原文可读' })
  else if (lesson.level === '阅读') marks.push({ kind: 'reading', glyph: '读', text: '阅读单元 · 原文在主题页' })
  if (lesson.executable === false) {
    marks.push({ kind: 'external', glyph: '外', text: '本页不可自动执行 · 需外部环境与人工证据' })
  }
  return marks
}

/**
 * 缺口标识：只登记现有字段能证实的缺失，且文案唯一可辨（不并列同类歧义措辞）。
 * 空先备清单不算缺口（首单元本就无先备），阶段名称缺失在页脚统一说明。
 */
function gapMarksOf(lesson: Lesson, numbered: boolean): Mark[] {
  const marks: Mark[] = []
  if (lesson.contentId && !lesson.source?.path) marks.push({ kind: 'gap', glyph: '缺', text: '来源未定位（缺 sourcePath）' })
  if (lesson.source?.path && !lesson.source.verificationStatus) {
    marks.push({ kind: 'gap', glyph: '缺', text: '核验状态未记录' })
  }
  if (lesson.contentId && !lesson.exercise) marks.push({ kind: 'gap', glyph: '缺', text: '无练习契约（已登记于同步报告）' })
  if (!numbered) marks.push({ kind: 'gap', glyph: '缺', text: '未并入 S0—S9 编号阶段' })
  return marks
}

/** 缺口单元计数：与逐条标识同一口径，来源未标注也计入，避免页眉数字与清单不一致。 */
function hasAnyGap(lesson: Lesson): boolean {
  if (sourceMarkOf(lesson).kind === 'unknown') return true
  return gapMarksOf(lesson, isNumberedStage(stageKeyOf(lesson))).length > 0
}

function marksOf(lesson: Lesson, numbered: boolean): Mark[] {
  return [sourceMarkOf(lesson), ...runtimeMarksOf(lesson), ...gapMarksOf(lesson, numbered)]
}

/** 进度只有 0/100 两个事实值（app.tsx 由个人证据派生），文案如实、不插值。 */
function progressLabel(progress: number): string {
  if (progress >= 100) return '已完成'
  if (progress > 0) return '进行中'
  return '未开始'
}

function clampedProgress(progress: number): number {
  if (typeof progress !== 'number' || Number.isNaN(progress)) return 0
  return Math.max(0, Math.min(100, Math.round(progress)))
}

function ordinalOf(index: number): string {
  return String(index + 1).padStart(2, '0')
}

/**
 * 学习状态标识（LEARN-01 第 4 条）：只登记记录里已经成立的状态，一条都不自行推断。
 * 「已阅读 / 已练习」不是完成——完成由右侧状态列（有没有通过证据）单独说，两者不互相顶替。
 */
function stateMarksOf(states: LessonEvidenceStates | undefined): Mark[] {
  if (!states) return []
  return heldLessonStates(states).map((item) => ({ kind: 'signal', glyph: '✓', text: item.label }))
}

function MarkList({ marks, className = 'lp-marks' }: { marks: Mark[]; className?: string }) {
  return (
    <span className={className}>
      {marks.map((mark) => (
        <span key={`${mark.kind}-${mark.text}`} className={`lp-mark lp-mark--${mark.kind}`} data-lp-mark={mark.kind}>
          <span className="lp-mark-glyph" aria-hidden="true">
            {mark.glyph}
          </span>
          <span className="lp-mark-text">{mark.text}</span>
        </span>
      ))}
    </span>
  )
}

/** 来源定位行：原文路径 + 标题路径 + 核验状态，全部为现有字段。 */
function SourceLine({ lesson }: { lesson: Lesson }) {
  const source = lesson.source
  if (!source?.path) return null
  const heading = source.headingPath.length > 0 ? source.headingPath.join(' > ') : ''
  return (
    <span className="lp-row-source">
      <span className="lp-row-source-key">原文位置</span>
      <span className="lp-row-source-path">{source.path}</span>
      {heading ? <span className="lp-row-source-heading">{` › ${heading}`}</span> : null}
      {source.verificationStatus ? (
        <span className="lp-row-source-status">{` · 核验：${source.verificationStatus}`}</span>
      ) : null}
    </span>
  )
}

function LessonRow({
  lesson,
  index,
  numbered,
  groupTitle,
  isSelected,
  states,
  onSelect,
}: {
  lesson: Lesson
  index: number
  numbered: boolean
  groupTitle: string
  isSelected: boolean
  /** 这一课的六种学习状态里成立的那几项（无记录时不给，界面就不显示状态行） */
  states?: LessonEvidenceStates
  onSelect: () => void
}) {
  const progress = clampedProgress(lesson.progress)
  const prerequisites = lesson.content?.prerequisites ?? []
  const signals = stateMarksOf(states)
  const code = lesson.label && lesson.label !== groupTitle && lesson.label !== '—' ? lesson.label : ''
  return (
    <tr className={`lp-row${isSelected ? ' is-selected' : ''}`} data-lesson-id={lesson.id}>
      <th scope="row" className="lp-cell-num">
        <span className="lp-row-idx">{ordinalOf(index)}</span>
        {code ? <span className="lp-row-code">{code}</span> : null}
      </th>
      <td className="lp-cell-main">
        <button type="button" className="lp-row-btn" aria-pressed={isSelected} onClick={onSelect}>
          <span className="lp-row-head">
            <span className="lp-row-title">{lesson.title}</span>
            {isSelected ? (
              <span className="lp-mark lp-mark--selected" data-lp-mark="selected">
                <span className="lp-mark-glyph" aria-hidden="true">
                  ✦
                </span>
                <span className="lp-mark-text">已选</span>
              </span>
            ) : null}
          </span>
          {lesson.description ? <span className="lp-row-desc">{lesson.description}</span> : null}
          <span className="lp-row-meta">
            {lesson.level ? <span className="lp-meta-item">{lesson.level}</span> : null}
            <span className="lp-meta-item">{lessonDurationLabel(lesson)}</span>
            {lesson.languageLabel ? <span className="lp-meta-item">{lesson.languageLabel}</span> : null}
          </span>
          {signals.length > 0 ? (
            <span className="lp-row-states">
              <span className="lp-row-states-key">证据</span>
              <MarkList marks={signals} className="lp-marks lp-marks--states" />
            </span>
          ) : null}
          <MarkList marks={marksOf(lesson, numbered)} />
          <SourceLine lesson={lesson} />
          {prerequisites.length > 0 ? (
            <span className="lp-row-prereq">
              <span className="lp-row-prereq-key">先备</span>
              <span className="lp-row-prereq-value">{prerequisites.join('；')}</span>
            </span>
          ) : null}
        </button>
      </td>
      <td className="lp-cell-status">
        <span className="lp-status-text">{progressLabel(progress)}</span>
        <span className="lp-status-bar" aria-hidden="true">
          <span className="lp-status-fill" style={{ width: `${progress}%` }} />
        </span>
        <span className="lp-status-percent">{`${progress}%`}</span>
      </td>
    </tr>
  )
}

export function LearningPathView({
  subjectId,
  subjects,
  lessons,
  lessonStates,
  stages,
  selectedLessonId,
  recommended,
  onSubjectChange,
  onLessonChange,
  onContinue,
}: LearningPathViewProps) {
  const selectedLesson = lessons.find((l) => l.id === selectedLessonId)
  const currentSubject = subjects.find((s) => s.id === subjectId)
  const groups = stageGroups(lessons)
  const numberedGroups = groups.filter((g) => g.numbered)
  const stageGaps = numberedGroups.filter((g) => g.lessons.length === 0)
  const unitGaps = lessons.filter(hasAnyGap).length

  return (
    <section className="lp-view" data-lp-view="learning-path" aria-label="学习路径页">
      <header className="lp-head">
        <p className="lp-eyebrow">
          <span className="lp-eyebrow-idx">PATH</span>
          <span className="lp-eyebrow-rule" aria-hidden="true" />
          交互式学习路径
        </p>
        {/* #77：路径页的文档标题归这一句（从前是 h2，页级 h1 由壳层问候语代持）。
            字号档挂在 `.lp-title` 类上，换标签不动视觉。 */}
        <h1 className="lp-title">选择科目和课程</h1>
        <p className="lp-lead">
          每个课程会可视化展示代码执行的每一步，帮助你理解程序的运行过程。清单按资料库的 S0—S9
          编号阶段排列，来源与缺口逐条标明。
        </p>
        <dl className="lp-specs">
          <div className="lp-spec">
            <dt>当前科目</dt>
            <dd>{currentSubject ? currentSubject.label : subjectId}</dd>
          </div>
          <div className="lp-spec">
            <dt>课程单元</dt>
            <dd>{`${lessons.length} 个`}</dd>
          </div>
          <div className="lp-spec">
            <dt>编号阶段</dt>
            <dd>{`${Math.max(0, numberedGroups.length - stageGaps.length)} / 10 个已发布`}</dd>
          </div>
          <div className="lp-spec">
            <dt>缺口</dt>
            <dd>{`${unitGaps} 个单元 · ${stageGaps.length} 处阶段缺口`}</dd>
          </div>
          <div className="lp-spec">
            <dt>下一推荐</dt>
            <dd>{recommended ? `${recommended.label} · ${recommended.title}` : '暂无（当前科目单元均已有完成证据）'}</dd>
          </div>
        </dl>
      </header>

      <section className="lp-block" aria-labelledby="lp-subjects-heading">
        <h2 className="lp-block-heading" id="lp-subjects-heading">
          <span className="lp-block-idx" aria-hidden="true">
            01
          </span>
          科目
          <span className="lp-block-note">{`${subjects.length} 个可选`}</span>
        </h2>
        <ul className="lp-subjects">
          {subjects.map((subject, index) => (
            <li key={subject.id}>
              <button
                type="button"
                className="lp-subject"
                onClick={() => onSubjectChange(subject.id)}
                aria-pressed={subjectId === subject.id}
              >
                <span className="lp-subject-idx" aria-hidden="true">
                  {ordinalOf(index)}
                </span>
                <span className="lp-subject-code" aria-hidden="true">
                  {subject.short}
                </span>
                <span className="lp-subject-body">
                  <span className="lp-subject-label">{subject.label}</span>
                  <span className="lp-subject-meta">
                    <span className="lp-meta-item">{`${subject.lessonCount} 个单元`}</span>
                    <span className="lp-meta-item">{subject.hasVaultContent ? '含资料库正式内容' : '未含资料库内容'}</span>
                    {subject.executable ? null : <span className="lp-meta-item">不可自动执行</span>}
                  </span>
                </span>
                {subjectId === subject.id ? (
                  <span className="lp-mark lp-mark--selected" data-lp-mark="selected">
                    <span className="lp-mark-glyph" aria-hidden="true">
                      ✦
                    </span>
                    <span className="lp-mark-text">当前</span>
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="lp-block lp-stages" aria-labelledby="lp-stages-heading">
        <h2 className="lp-block-heading" id="lp-stages-heading">
          <span className="lp-block-idx" aria-hidden="true">
            02
          </span>
          课程清单 · S0—S9 编号阶段
          <span className="lp-block-note">{`${groups.length} 组`}</span>
        </h2>

        {lessons.length === 0 ? (
          <p className="lp-empty">
            该科目当前没有已发布内容。资料库连通后新增的主题会出现在这里；未发布的主题不会自动补位。
          </p>
        ) : (
          groups.map((group) => {
            const headingId = `lp-stage-${group.key}`
            const groupLabel = group.numbered ? `${group.title} 阶段` : '未并入编号阶段'
            /**
             * LEARN-01 第 3 条「显示未掌握能力」：能力点原文取自上层那份阶段表，
             * 「有没有证据」只按**单元级完成证据**折算（holdsCompletion：自评通过 / 自动验证通过 /
             * 延迟复测掌握三者之一）。阅读与练习痕迹不算掌握，交付物也没有任何一项被本机比对过，
             * 所以这一折算只报到阶段级，不逐条打勾。
             */
            const stage = stages?.find((item) => item.id === group.key)
            const evidenced = group.lessons.filter((item) => holdsCompletion(lessonStates?.[item.id])).length
            return (
              <div className={`lp-stage${group.numbered ? ' is-numbered' : ' is-unnumbered'}`} key={group.key}>
                <div className="lp-stage-rail" aria-hidden="true">
                  <span className="lp-stage-num">{group.title}</span>
                  <span className="lp-stage-hair" />
                </div>
                <div className="lp-stage-body">
                  <h3 className="lp-stage-heading" id={headingId}>
                    <span className="lp-stage-heading-num">{groupLabel}</span>
                    <span className="lp-stage-heading-count">
                      {group.lessons.length > 0 ? `${group.lessons.length} 个单元` : '本阶段无已发布单元'}
                    </span>
                  </h3>
                  {group.numbered ? (
                    <div className="lp-stage-competence">
                      <p className="lp-stage-competence-line">
                        <span className="lp-stage-competence-key">阶段验收</span>
                        <span className="lp-stage-competence-text">
                          {stage?.checkpoint ?? (stages ? '资料库这一阶段没写验收点' : '阶段表未载入，能力点无从显示')}
                        </span>
                      </p>
                      {/* 这一行要装一个 ul，所以它是 div 不是 p：`<p>` 里放块级列表会被浏览器
                          就地补一个结束标签，DOM 与 React 虚拟树随即对不上（React 会当场警告）。 */}
                      <div className="lp-stage-competence-line">
                        <span className="lp-stage-competence-key">交付物</span>
                        {(stage?.deliverables ?? []).length > 0 ? (
                          <ul className="lp-stage-deliverables">
                            {(stage?.deliverables ?? []).map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="lp-stage-competence-text">
                            {stage ? '资料库这一阶段没写交付物' : '无从显示：上层没递阶段表'}
                          </span>
                        )}
                      </div>
                      {group.lessons.length > 0 ? (
                        <p className="lp-stage-competence-line">
                          <span className="lp-stage-competence-key">完成证据</span>
                          <span className="lp-stage-competence-text">
                            {`${evidenced}/${group.lessons.length} 个单元有完成证据`}
                            {evidenced === 0
                              ? '——本阶段按「未掌握」读：已阅读与已练习只是痕迹，不算掌握。'
                              : '。折算只到阶段级：交付物本身没有一项被本机比对过，所以这里不逐条打勾。'}
                          </span>
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {group.lessons.length === 0 ? (
                    <p className="lp-stage-gap">
                      <MarkList marks={[{ kind: 'gap', glyph: '缺', text: '阶段缺口' }]} />
                      <span className="lp-stage-gap-text">
                        {`本科目在 ${group.title} 没有已发布单元；未发布的主题不会自动补位，也不以相邻主题顶替。`}
                      </span>
                    </p>
                  ) : (
                    /* #95（承 #88 / #89 的同一做法）：窄屏下「课程单元」列实测 113px≈7.5 字/行，
                       页面不溢出但长中文课名被切成一行一字——列给地板，多出来的宽度交给这个可 Tab 到的滚动区。 */
                    <div
                      className="lp-table-scroll"
                      role="region"
                      tabIndex={0}
                      aria-label={`${groupLabel}课程清单表格，可横向滚动`}
                    >
                      <table className="lp-ledger">
                        <caption className="lp-sr-only">
                          {group.numbered
                            ? `${group.title} 阶段课程清单，共 ${group.lessons.length} 个单元`
                            : `未并入 S0—S9 编号阶段的课程清单，共 ${group.lessons.length} 个单元`}
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col" className="lp-col-num">
                              次
                            </th>
                            <th scope="col">课程单元</th>
                            <th scope="col" className="lp-col-status">
                              状态
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.lessons.map((lesson, index) => (
                            <LessonRow
                              key={lesson.id}
                              lesson={lesson}
                              index={index}
                              numbered={group.numbered}
                              groupTitle={group.title}
                              isSelected={lesson.id === selectedLessonId}
                              states={lessonStates?.[lesson.id]}
                              onSelect={() => onLessonChange(lesson)}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}

        <p className="lp-footnote">
          阶段名称、检查点与达标条件属于资料库阶段清单（S0—S9），当前视图未接收该数据，因此只显示编号与真实计数；
          缺口标识仅登记现有字段可证实的缺失，不代表资料库判定该主题不存在。旧口径单元不会自动并入新阶段。
        </p>
      </section>

      {selectedLesson ? (
        <div className="lp-continue" aria-labelledby="lp-continue-heading">
          <p className="lp-eyebrow">
            <span className="lp-eyebrow-idx">GO</span>
            已选单元
          </p>
          <h2 className="lp-continue-title" id="lp-continue-heading">
            {selectedLesson.title}
          </h2>
          <p className="lp-continue-desc">{selectedLesson.description}</p>
          <button type="button" className="lp-cta" onClick={onContinue}>
            进入学习
            <span className="lp-cta-arrow" aria-hidden="true">
              →
            </span>
          </button>
        </div>
      ) : null}
    </section>
  )
}
