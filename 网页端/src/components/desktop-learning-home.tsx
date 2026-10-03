import { useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Braces, CheckCircle2, ChevronRight, FileCode2, Layers3, ListTree, RotateCcw, Terminal } from 'lucide-react'
import { LearningPathView, type LearningPathViewProps } from './learning-path-view'
import { holdsCompletion } from '../utils/lesson-evidence'

type Props = LearningPathViewProps & { dueCount: number; onGoReviews: () => void }

/** Desktop overview consumes the same catalog and evidence as the detailed stage ledger. */
export function DesktopLearningHome({ dueCount, onGoReviews, ...props }: Props) {
  const [showDetails, setShowDetails] = useState(false)
  const [filter, setFilter] = useState<'all' | 'pending' | 'complete'>('all')
  const subject = props.subjects.find((item) => item.id === props.subjectId)
  const selected = props.lessons.find((item) => item.id === props.selectedLessonId) ?? props.lessons[0]
  const complete = props.lessons.filter((item) => holdsCompletion(props.lessonStates?.[item.id]))
  const visible = props.lessons.filter((item) => filter === 'all' || holdsCompletion(props.lessonStates?.[item.id]) === (filter === 'complete'))

  if (showDetails) return (
    <section className="desktop-catalog-details">
      <button className="subtle-button" onClick={() => setShowDetails(false)}><ArrowLeft size={15} />返回工作区概览</button>
      <LearningPathView {...props} />
    </section>
  )

  return (
    <section className="desktop-learning-home" aria-label="学习路径页">
      <div className="desktop-subjects" role="group" aria-label="选择学习科目">
        {props.subjects.map((item) => (
          <button key={item.id} aria-pressed={item.id === props.subjectId} onClick={() => props.onSubjectChange(item.id)}>
            <span className="subject-symbol" aria-hidden="true">{item.short}</span>
            <span>{item.label}</span><small>{item.lessonCount}</small>
          </button>
        ))}
      </div>
      <div className="desktop-learning-columns">
        <div className="desktop-learning-primary">
          <header className="desktop-section-heading">
            <div><p className="desktop-eyebrow"><span /> LEARNING PATH</p><h1 className="desktop-page-title">你的学习路径</h1></div>
            <button className="desktop-text-button" onClick={() => setShowDetails(true)}><ListTree size={15} />阶段与来源明细<ChevronRight size={14} /></button>
          </header>
          {selected ? (
            <article className="desktop-course-hero">
              <div className="desktop-course-copy">
                <div className="desktop-course-badges"><span><Layers3 size={13} />{subject?.label ?? props.subjectId}</span><span>{selected.reading ? '阅读与理解' : '交互式课程'}</span></div>
                <h2>{selected.title}</h2>
                <p>{selected.description || '从理解概念开始，在工作台中阅读、练习与验证。'}</p>
                <div className="desktop-hero-bottom">
                  <button className="primary-action" onClick={() => props.onLessonChange(selected)}>进入学习<ArrowRight size={16} /></button>
                  <span>{complete.length} / {props.lessons.length} 个单元已有完成证据</span>
                </div>
              </div>
              <div className="desktop-course-art" aria-hidden="true"><div className="course-orbit" /><div className="course-orbit second" /><div className="course-art-core"><Braces size={49} strokeWidth={1.3} /></div><span className="art-tag tag-top">&lt;learn /&gt;</span><span className="art-tag tag-bottom">build. understand.</span></div>
            </article>
          ) : <div className="empty-state"><BookOpen /><h2>当前科目暂无课程</h2><p>切换科目，或从顶部资料库状态条同步内容。</p></div>}
          <div className="desktop-course-toolbar"><h2><FileCode2 size={17} />课程单元 <span>{props.lessons.length}</span></h2><div role="group" aria-label="筛选课程状态">{([['all', '全部'], ['pending', '待学习'], ['complete', '已完成']] as const).map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div></div>
          <div className="desktop-course-grid">
            {visible.map((lesson, index) => {
              const done = holdsCompletion(props.lessonStates?.[lesson.id])
              return <button className="desktop-unit-card" key={lesson.id} onClick={() => props.onLessonChange(lesson)}>
                <span className="desktop-unit-top"><span className="desktop-unit-number">{String(index + 1).padStart(2, '0')}</span><span className={done ? 'unit-state done' : 'unit-state'}>{done ? <CheckCircle2 size={12} /> : <span className="unit-dot" />}{done ? '已有完成证据' : '待学习'}</span></span>
                <strong>{lesson.title}</strong><span className="desktop-unit-desc">{lesson.description || '打开课程查看内容、练习与来源。'}</span>
                <span className="desktop-unit-bottom"><span>{lesson.level} · {lesson.reading ? '阅读单元' : lesson.languageLabel}</span><ArrowRight size={15} /></span>
              </button>
            })}
          </div>
          {!visible.length && props.lessons.length > 0 && <p className="desktop-empty-filter">此筛选下暂无课程。切换到“全部”查看学习内容。</p>}
        </div>
        <aside className="desktop-learning-rail" aria-label="学习辅助信息">
          <section className="desktop-rail-panel"><h2><Terminal size={16} />代码速览<span className="desktop-small-tag">{selected?.languageLabel ?? 'CODE'}</span></h2><div className="desktop-snippet"><div><span /><span /><span /><small>{selected?.title ?? '选择课程'}</small></div>{selected?.code ? <pre><code>{selected.code.split('\n').slice(0, 13).join('\n')}</code></pre> : <div className="desktop-snippet-empty"><Braces size={30} /><p>先理解，再动手。</p><span>进入课程查看完整讲解与配套代码。</span></div>}</div><p className="desktop-rail-note">代码执行、单步追踪与变量观察在课程工作台中进行。</p></section>
          <section className="desktop-rail-panel"><h2><RotateCcw size={16} />今日计划</h2><div className="desktop-plan-row"><span className="plan-icon"><BookOpen size={16} /></span><div><strong>继续一个学习单元</strong><span>{selected?.title ?? '从科目列表开始'}</span></div></div><button className="desktop-plan-row" onClick={onGoReviews}><span className="plan-icon"><RotateCcw size={16} /></span><div><strong>复习已学知识</strong><span>{dueCount ? `${dueCount} 项复习已到期` : '暂无到期复习，保持学习节奏'}</span></div><ChevronRight size={14} /></button><div className="desktop-plan-progress"><span>当前科目完成证据</span><strong>{complete.length}/{props.lessons.length}</strong><progress max={props.lessons.length || 1} value={complete.length} aria-label="当前科目完成证据" /></div></section>
          <div className="desktop-note"><span>LEARN BY DOING</span><p>让抽象的代码，<br />变成看得见的思考。</p><small>阅读、练习和掌握分别记录。</small></div>
        </aside>
      </div>
    </section>
  )
}
