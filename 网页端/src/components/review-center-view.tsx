import { useState } from 'react'
import { CalendarClock, BookOpen, AlarmClock, Check, X } from 'lucide-react'
import type { MasteryRecord } from '../data/mastery'
import {
  MAX_MASTERY_LEVEL,
  describeReviewPlan,
  masteryLevelName,
  reviewPlanCadence,
  snoozeTargetKey,
  type ReviewPlan,
} from '../data/mastery'
import { useReviewPlanResolver } from '../hooks/use-review-schedule'
import { useOptionalContent } from '../content/provider'
import './review-center-view.css'

/**
 * F1 复习中心（独立页）：逾期 / 今日到期 / 未来 7 天三组，
 * 每项支持 开始复测（通过/未通过）、稍后提醒（顺延明天）、查看原课程。
 * 空状态说明下一次复测日期。数据全部来自 useReviewSchedule 的真实记录。
 *
 * M4 全站统一（01 号方案 §3.4 复习页 + geometry.md §2「复习与分析」）：
 * - 三组一律用模板 `.ledger` 的**细线表格**表达（真 `<table>` + `<caption>` +
 *   `th[scope]`），层次靠编号 01/02/03 与 1px 发丝线，不靠卡片、不靠颜色；
 * - 到期分组、复测计划节点、掌握等级各自成列，语义状态「固定字符徽记 + 文字」
 *   双通道（§5.1 末段）；边框样式（点线/实线/虚线）承担第三重非颜色区分；
 * - #33 之后本页**不再自带任何节点数字面量**：节奏文案一律由 `useReviewPlanResolver()`
 *   解析出的生效计划派生（本单元覆盖 → 资料库发布规则 → 本机兜底），分母就是那一行的
 *   节点数。改版前这里写死过一份五档节点表，另附一句「两套口径各自表述、界面不做合并」的
 *   免责说明——口径统一到发布规则之后，那种说明已无凭据，删除。
 */

type Tone = 'overdue' | 'today' | 'upcoming'

type ReviewCenterViewProps = {
  groups: {
    overdue: MasteryRecord[]
    today: MasteryRecord[]
    upcoming: MasteryRecord[]
    next: { dateKey: string; record: MasteryRecord } | null
  }
  titles: Record<string, string>
  /**
   * 现在真实存在的课程单元 id。**「这是不是一门课」只能由数据判定**：
   * 改版前用 `tone !== 'overdue' && !refId.startsWith('stage-')` 猜，
   * 于是逾期一组的每一条都拿不到「查看原课程」（REVIEW-01 第 2 条）。
   */
  lessonIds: readonly string[]
  /** 本机今天（dateKey）。稍后提醒要把**实际落到的那一天**写出来，不能只说「明天」。 */
  todayKey: string
  onReview: (record: MasteryRecord, passed: boolean) => void
  onSnooze: (refId: string) => void
  onOpenLesson: (lessonId: string) => void
}

/**
 * 三组的编号、名称与语义标识。**文案与改版前逐字一致**，只是换成分组表格的骨架。
 * `glyph` 是固定字符徽记（读屏隐藏），`label` 是承载信息的文字通道。
 * `hint` 由生效计划派生（#33）：分组说明里的节奏与分母不许再手写一遍。
 */
const TONE_META: Record<Tone, { idx: string; title: string; hint: (plan: ReviewPlan) => string; glyph: string; label: string }> = {
  overdue: {
    idx: '01',
    title: '逾期',
    hint: () => '超过计划日期仍未复测，优先处理',
    glyph: '逾',
    label: '已逾期',
  },
  today: {
    idx: '02',
    title: '今日到期',
    hint: (plan) => `按 ${reviewPlanCadence(plan)}计划今天应复测`,
    glyph: '今',
    label: '今日到期',
  },
  upcoming: {
    idx: '03',
    title: '未来 7 天',
    hint: () => '即将到期的复测',
    glyph: '未',
    label: '未来 7 天内',
  },
}

/** 语义状态：固定字符徽记 + 文字，双通道，不依赖颜色（§5.1 末段）。 */
function StatusMark({ tone }: { tone: Tone }) {
  const meta = TONE_META[tone]
  return (
    <span className={`rv-mark rv-mark--${tone}`} data-rv-mark={tone}>
      <span className="rv-mark-glyph" aria-hidden>
        {meta.glyph}
      </span>
      <span className="rv-mark-text">{meta.label}</span>
    </span>
  )
}

function ReviewRow({
  record,
  title,
  tone,
  order,
  isLesson,
  snoozeToKey,
  plan,
  defaultPlan,
  onReview,
  onSnooze,
  onOpenLesson,
}: {
  record: MasteryRecord
  title: string
  tone: Tone
  order: number
  isLesson: boolean
  snoozeToKey: string
  /** 这一行**实际按哪一份计划**排期（分母 = plan.offsets.length，#33 裁定 4） */
  plan: ReviewPlan
  /** 页面级默认计划：本单元覆盖时要把默认也说出来，不许悄悄换掉节奏 */
  defaultPlan: ReviewPlan
  onReview: (record: MasteryRecord, passed: boolean) => void
  onSnooze: (refId: string) => void
  onOpenLesson: (lessonId: string) => void
}) {
  const [testing, setTesting] = useState(false)
  const dueLabel = record.reviewDueKey ?? ''
  const nodeTotal = plan.offsets.length
  const nodeNow = Math.min(record.reviewStep + 1, nodeTotal)
  const overrideNote =
    plan.source === 'unit' && defaultPlan.offsets.join('/') !== plan.offsets.join('/')
      ? `（默认是${reviewPlanCadence(defaultPlan)}，共 ${defaultPlan.offsets.length} 个节点）`
      : ''

  const finishReview = (passed: boolean) => {
    onReview(record, passed)
    // 记完就退出答题态：留在 通过/未通过 两枚按钮上，人已经不在「正在答」这件事里了。
    setTesting(false)
  }

  return (
    <tr className="rv-row" data-tone={tone} data-ref-id={record.refId}>
      <th scope="row" className="rv-cell rv-cell-num">
        <span className="rv-row-idx">{String(order).padStart(2, '0')}</span>
      </th>
      <td className="rv-cell rv-cell-item">
        <span className="rv-item-title">{title}</span>
        <span className="rv-item-ref">标识 {record.refId}</span>
      </td>
      <td className="rv-cell rv-cell-mastery">
        <span className="rv-mastery-level">
          {masteryLevelName(record.level)}
        </span>
        <span className="rv-mastery-note">
          等级 {record.level} / {MAX_MASTERY_LEVEL} · 证据 {record.evidence.length} 条
        </span>
      </td>
      <td className="rv-cell rv-cell-plan">
        <span className="rv-plan-due">计划复测 {dueLabel || '未安排'}</span>
        <span className="rv-plan-note">
          复测节点 {nodeNow} / {nodeTotal}（{describeReviewPlan(plan)}）{overrideNote}
        </span>
        {record.lastFailReason ? <span className="rv-plan-fail">上次未通过：{record.lastFailReason}</span> : null}
      </td>
      <td className="rv-cell rv-cell-status">
        <StatusMark tone={tone} />
        <span className="rv-status-date">{dueLabel}</span>
      </td>
      <td className="rv-cell rv-cell-actions">
        <div className="rv-actions">
          {testing ? (
            <>
              <button className="subtle-button rv-btn" onClick={() => finishReview(false)}>
                <X size={14} aria-hidden />
                未通过
              </button>
              <button className="primary-action rv-btn" onClick={() => finishReview(true)}>
                <Check size={14} aria-hidden />
                通过
              </button>
            </>
          ) : (
            <button className="primary-action rv-btn" onClick={() => setTesting(true)}>
              开始自评回顾
            </button>
          )}
          {/* 顺延日期由 `snoozeTargetKey` 算——和 mastery 里真正写入的那一条是同一个函数，
              所以界面说的日期不可能与实际写入的不一致（REVIEW-01 第 4 条）。 */}
          <button
            className="subtle-button rv-btn"
            onClick={() => onSnooze(record.refId)}
            title={`顺延到 ${snoozeToKey}`}
          >
            <AlarmClock size={14} aria-hidden />
            稍后提醒
            <span className="rv-snooze-date">到 {snoozeToKey}</span>
          </button>
          {isLesson && (
            <button
              className="subtle-button rv-btn"
              onClick={() => onOpenLesson(record.refId)}
              title="打开原课程工作台"
            >
              <BookOpen size={14} aria-hidden />
              查看原课程
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

export function ReviewCenterView({ groups, titles, lessonIds, todayKey, onReview, onSnooze, onOpenLesson }: ReviewCenterViewProps) {
  const { planFor, defaultPlan } = useReviewPlanResolver()
  /** 排期节奏的**来源**要等 Provider 把教材目录读回来，所以本页跟着它有一档 loading / error。 */
  const content = useOptionalContent()
  /**
   * 两档互斥：正在读取时只说「正在读」（此时上一轮的失败还挂在 error 上，不代表本轮结果）；
   * 读取结束仍带 error 才说「读不到 + 可重试」。Provider 缺席（未接内容服务的用法）时为 null，
   * 整块不出现——不造空转的骨架。
   */
  const asyncState: 'loading' | 'error' | null =
    !content || defaultPlan.source !== 'fallback'
      ? null
      : content.loading
        ? 'loading'
        : content.error
          ? 'error'
          : null
  const sections: { key: Tone; rows: MasteryRecord[] }[] = [
    { key: 'overdue', rows: groups.overdue },
    { key: 'today', rows: groups.today },
    { key: 'upcoming', rows: groups.upcoming },
  ]

  const total = groups.overdue.length + groups.today.length
  const scheduled = total + groups.upcoming.length
  const lessonSet = new Set(lessonIds)

  return (
    <section className="review-center cw-review">
      <div className="module-heading">
        <div>
          <p className="eyebrow">
            <span className="eyebrow-dot" />
            复习中心
          </p>
          <h1>延迟复测</h1>
          {/*
            节奏与分母都由生效计划派生（#33 裁定 4）：本页不再出现手写的节点串。
            读不到发布规则时（未连接内容服务）就地承认这是本机排期，并说明标准那一档多什么——
            改版前这里是一段「两套口径各自表述、界面不做合并」的免责说明，口径统一后已无凭据。
          */}
          <p className="rv-plan-summary">
            {describeReviewPlan(defaultPlan)}——按这份节奏回顾已学内容；未通过的复测会降低掌握等级并重新安排。
            {defaultPlan.source === 'fallback'
              ? '当前没有读到资料库发布规则（内容服务未连接或尚无可用快照），上面是未接入发布规则时的本机排期；读到目录后会自动改按发布规则的节点排期，默认节奏比这里多一档「学习当天」。'
              : ''}
          </p>
        </div>
        <div className="challenge-stats">
          <span>
            待复测 {total} 项 · 未来 7 天 {groups.upcoming.length} 项
          </span>
        </div>
      </div>

      {/*
        01 号方案 §4 的 loading / error 两行（排期口径的来源，不是排期判定）：
        复测节点表有三个来源（本单元覆盖 → 资料库发布规则 → 本机兜底），中间那一档要等教材目录
        读回来才有。改版前这一段没有任何形态——「正在读」与「读失败」都说成「按本机排期」，
        用户看不出这是临时的、也找不到重试。这里只陈述来源与下一步，
        `useReviewPlanResolver` 与 `data/mastery` 的判定一字未动（§9 纪律）。
      */}
      {asyncState && (
        <div
          className={`rv-async rv-empty${asyncState === 'error' ? ' rv-async--failed' : ''}`}
          role={asyncState === 'error' ? 'alert' : 'status'}
          data-rv-async={asyncState}
          aria-busy={asyncState === 'loading' || undefined}
        >
          <p>
            {asyncState === 'loading'
              ? '正在读取资料库发布规则：这一档是临时的，读到节点表之后本页自动改按发布规则排期，在此之前按本机兜底节奏。'
              : `读不到资料库发布规则：${content?.error}。本页仍按本机兜底节奏排期，已排好的复测节点不受影响；可以重试读取。`}
          </p>
          {asyncState === 'loading' ? (
            <div className="view-skeleton__shape" aria-hidden="true">
              <span className="view-skeleton__line" />
              <span className="view-skeleton__line view-skeleton__line--short" />
            </div>
          ) : (
            <button className="subtle-button rv-btn" onClick={() => void content?.refresh()}>
              重试读取发布规则
            </button>
          )}
        </div>
      )}

      {/*
        空态先看 `groups.next` 再说「没有计划」（REVIEW-01 第 3 条）：
        `next` 是**任何**比今天晚的排期，而上一步的判据只看 7 天窗口里有没有条目——
        于是一门排在第 14 天的课会让页面写「当前没有任何计划的复测」，远期任务被说成不存在。
      */}
      {total === 0 && groups.upcoming.length === 0 && !groups.next && (
        <div className="review-center-empty rv-empty" role="status">
          <CalendarClock size={24} aria-hidden />
          <p>当前没有任何计划的复测。完成课程单元后会自动按计划安排。</p>
        </div>
      )}

      {total === 0 && groups.next && (
        <div className="review-center-empty rv-empty" role="status">
          <CalendarClock size={24} aria-hidden />
          <p>
            今天没有到期的复测。下一次：{groups.next.dateKey}（
            {titles[groups.next.record.refId] ?? groups.next.record.refId}）
          </p>
        </div>
      )}

      {sections.map((section) =>
        section.rows.length === 0 ? null : (
          <section className="rv-block" key={section.key} data-tone={section.key}>
            <h2 className="rv-block-heading">
              <span className="rv-block-idx" aria-hidden>
                {TONE_META[section.key].idx}
              </span>
              <span className="rv-block-title">{TONE_META[section.key].title}</span>
              <StatusMark tone={section.key} />
              <span className="rv-block-note">
                {TONE_META[section.key].hint(defaultPlan)} · {section.rows.length} / {scheduled} 项
              </span>
            </h2>
            {/*
              六列台账在 320px 下放不进 231px 的内容宽：实测会把「复习项」等四列压到 24px
              （一个字一行），再把整张表顶出页面 41px。所以窄屏让它**在区域内横向滚动**，
              而不是继续挤压列宽——§5.4 要的是「不撑破页面」且「画得能看」，两条都要。
              滚动区必须可 Tab 到并带名字，否则键盘用户进不去这个容器（WCAG 2.1.1）。
            */}
            <div className="rv-table-scroll" role="region" tabIndex={0} aria-label={`${TONE_META[section.key].title}复习清单表格，可横向滚动`}>
            <table className="rv-ledger">
              <caption className="rv-sr-only">
                {TONE_META[section.key].title}复习清单，共 {section.rows.length} 项（{TONE_META[section.key].hint(defaultPlan)}）
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="rv-col rv-col-num">
                    次
                  </th>
                  <th scope="col" className="rv-col">
                    复习项
                  </th>
                  <th scope="col" className="rv-col">
                    掌握等级
                  </th>
                  <th scope="col" className="rv-col">
                    复测计划
                  </th>
                  <th scope="col" className="rv-col rv-col-status">
                    到期状态
                  </th>
                  <th scope="col" className="rv-col">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((record, index) => (
                  <ReviewRow
                    key={record.refId}
                    record={record}
                    title={titles[record.refId] ?? record.refId}
                    tone={section.key}
                    order={index + 1}
                    isLesson={lessonSet.has(record.refId)}
                    snoozeToKey={snoozeTargetKey(record, todayKey)}
                    plan={planFor(record.refId)}
                    defaultPlan={defaultPlan}
                    onReview={onReview}
                    onSnooze={onSnooze}
                    onOpenLesson={onOpenLesson}
                  />
                ))}
              </tbody>
            </table>
            </div>
          </section>
        ),
      )}

      {scheduled > 0 && (
        <p className="rv-footnote">
          本页只列 reviewDueKey 已安排的记录：逾期 {groups.overdue.length} 项、今日 {groups.today.length} 项、未来 7 天{' '}
          {groups.upcoming.length} 项，合计 {scheduled} 项；没有到期安排的记录不计入任何分母。
        </p>
      )}
    </section>
  )
}
