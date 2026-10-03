import { Activity, CalendarClock, Trophy } from 'lucide-react'
import type { ReactNode } from 'react'
import type { WeeklyStats } from '../utils/analytics'
import './analytics-view.css'

/**
 * F5 学习分析仪表盘：近 7 天（按证据时间），全部指标来自真实学习记录；
 * 复测完成率无样本时显示“样本不足”，学习时长无数据源显示“未统计”。
 *
 * M4 全站统一（01 号方案 §3.4 + geometry.md §2「复习与分析」）：
 * - 三块指标一律用模板 `.ledger` / `.specs` 的**细线表格**表达（真 `<table>` +
 *   `<caption>` + `th[scope]`），层次靠编号 01/02/03 与 1px 发丝线，不靠卡片；
 * - **每个指标必须带真实分母**（§5.2 保留项 + 清单 §7「分母可复现」口径）：没有
 *   分母的只报计数并写明「无分母，不折算百分比」，样本不足时如实显示「样本不足」
 *   与「未统计」，绝不用百分比冒充（`utils/analytics.ts` 的 STAT-01 口径不变）。
 * - 改版前后**逐字保留**的诚实文案：「样本不足：近 7 天还没有复测记录…」、
 *   「未统计」（title=「学习时长统计尚未实现」）、统计周期整句。
 */

type AnalyticsViewProps = {
  stats: WeeklyStats
  streak: number
  checkedInToday: boolean
}

/** 一行指标：数值 + 口径 + 真实分母（分母缺失时如实说明，不折算）。 */
type MetricRow = {
  name: string
  value: string
  /** 派生口径：数据来自哪个字段、按什么规则归窗口 */
  basis: string
  /** 分母；null 表示本机没有可复现的分母，界面因此不显示百分比 */
  denominator: string | null
  /**
   * 下一步动作（01 号方案 §4 的 empty 行：说明为空的原因**和下一步**）。
   * 「样本不足」「未统计」以前只有原因，看完不知道该做什么；这一列只写用户真能做的事，
   * 不承诺本页没有的入口，也不改任何统计口径（STAT-01 判定仍在 `utils/analytics.ts`）。
   */
  action?: string
}

function MetricLedger({
  idx,
  icon,
  title,
  caption,
  rows,
  honestNote,
}: {
  idx: string
  icon: ReactNode
  title: string
  caption: string
  rows: MetricRow[]
  honestNote?: string
}) {
  return (
    <section className="an-block">
      <h2 className="an-block-heading">
        <span className="an-block-idx" aria-hidden>
          {idx}
        </span>
        <span className="an-block-icon" aria-hidden>
          {icon}
        </span>
        <span className="an-block-title">{title}</span>
      </h2>
      {/* 五列台账在 320px 下会把「指标名」挤到 37px（页面不溢出，但一个字一行）——
          与复习中心同一处理：列有可读下限，溢出交给这个可 Tab 到的滚动区。见 `M6` §18.9 */}
      <div className="an-table-scroll" role="region" tabIndex={0} aria-label={`${caption}表格，可横向滚动`}>
      <table className="an-ledger">
        <caption className="an-sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="an-col an-col-num">
              次
            </th>
            <th scope="col" className="an-col">
              指标
            </th>
            <th scope="col" className="an-col an-col-value">
              数值
            </th>
            <th scope="col" className="an-col">
              派生口径
            </th>
            <th scope="col" className="an-col">
              分母
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr className="an-row" key={row.name}>
              <th scope="row" className="an-cell an-cell-num">
                <span className="an-row-idx">{String(index + 1).padStart(2, '0')}</span>
              </th>
              <td className="an-cell an-cell-name">{row.name}</td>
              <td className="an-cell an-cell-value">{row.value}</td>
              <td className="an-cell an-cell-basis">
                {row.basis}
                {row.action && <span className="an-cell-action">{row.action}</span>}
              </td>
              <td className="an-cell an-cell-den">
                {row.denominator ?? <span className="an-no-den">无分母，不折算百分比</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {honestNote && (
        <p className="review-empty an-honest" role="status">
          {honestNote}
        </p>
      )}
    </section>
  )
}

export function AnalyticsView({ stats, streak, checkedInToday }: AnalyticsViewProps) {
  const reviewTotal = stats.reviewsPassed + stats.reviewsFailed
  const period = `${stats.periodStartKey} 至 ${stats.todayKey}`

  const activityRows: MetricRow[] = [
    {
      name: '完成课程单元',
      value: String(stats.lessonsCompleted),
      basis: '按 lessonId 去重，仅计通过证据',
      denominator: `窗口 ${period} 内的课程证据`,
    },
    {
      name: '课程练习次数',
      value: String(stats.lessonPracticeCount),
      basis: '同一单元重复练习分别计数，与上一行是两个口径',
      denominator: `窗口 ${period} 内的课程证据`,
    },
    {
      name: '挑战通过（本机已验证）',
      value: String(stats.challengesPassed),
      basis: '仅认 passed / verified 状态',
      denominator: null,
    },
    {
      name: '挑战通过（旧版迁移口径）',
      value: String(stats.challengesLegacyPassed),
      basis: '记录缺失 status，按迁移语义单列为旧版，不混入上一行',
      denominator: null,
    },
    {
      name: '复测通过',
      value: String(stats.reviewsPassed),
      basis: 'kind=review 且 passed 的证据',
      denominator: `全部复测 ${reviewTotal} 次`,
    },
    {
      name: '复测未通过',
      value: String(stats.reviewsFailed),
      basis: 'kind=review 且未通过的证据',
      denominator: `全部复测 ${reviewTotal} 次`,
    },
  ]

  const rateRows: MetricRow[] = [
    {
      name: '复测完成率',
      value: stats.reviewRate === null ? '样本不足' : `${stats.reviewRate}%`,
      basis: '通过 /（通过 + 未通过），四舍五入到整数百分比',
      denominator: `全部复测 ${reviewTotal} 次（通过 ${stats.reviewsPassed} · 未通过 ${stats.reviewsFailed}）`,
      action:
        stats.reviewRate === null
          ? '下一步：先到复习中心完成一次复测（通过或未通过都算一条记录），这一格才会出现比率。'
          : undefined,
    },
    {
      name: '到期任务完成率',
      value: '未统计',
      basis: '需要计划任务分母；本机没有可复现的历史排期记录（STAT-01 第 4 条）',
      denominator: null,
      action: '下一步：等复习中心的排期按生效节奏累计出可复现的分母；本页不提供手填任务数的入口，也不拿活动次数顶替。',
    },
  ]

  const checkinRows: MetricRow[] = [
    {
      name: '连续打卡天数',
      value: String(streak),
      basis: '从今天往回数连续有打卡记录的日期（countStreak）',
      denominator: null,
    },
    {
      name: '今日打卡状态',
      value: checkedInToday ? '已打卡' : '未打卡',
      basis: '打卡记录按本地日期键判定',
      denominator: `今天 ${stats.todayKey}`,
    },
    {
      name: '学习时长（近 7 天）',
      value: '未统计',
      basis: '没有时长数据源；不追溯编造（STAT-01 第 6 条）',
      denominator: null,
      action: '下一步：本页没有可开启的时长统计，也不拿活动次数折算时长；要跟踪投入时间请用下面「连续打卡」那一档，它是替代口径、不是时长。',
    },
  ]

  return (
    <section className="analytics-view cw-analytics">
      <div className="module-heading">
        <div>
          <p className="eyebrow">
            <span className="eyebrow-dot" />
            学习分析
          </p>
          <h1>学习分析仪表盘</h1>
          <p>
            统计周期：近 7 天（{stats.periodStartKey} 至 {stats.todayKey}，按学习证据时间）。
          </p>
        </div>
      </div>

      <dl className="an-specs">
        <div className="an-spec">
          <dt>窗口</dt>
          <dd>
            {period}（含今天，共 7 个本地日期）
          </dd>
        </div>
        <div className="an-spec">
          <dt>归日口径</dt>
          <dd>证据时间一律按本地日期归日，不把 UTC 日期当本地日期</dd>
        </div>
        <div className="an-spec">
          <dt>数据来源</dt>
          <dd>仅本机学习证据：课程与复测记录、挑战验收记录、打卡记录</dd>
        </div>
      </dl>

      <MetricLedger
        idx="01"
        icon={<Activity size={15} />}
        title="近 7 天学习活动"
        caption={`近 7 天学习活动指标，共 ${activityRows.length} 项，窗口 ${period}`}
        rows={activityRows}
      />

      <MetricLedger
        idx="02"
        icon={<Trophy size={15} />}
        title="复测完成率"
        caption={`复测完成率与到期任务完成率，共 ${rateRows.length} 项，窗口 ${period}`}
        rows={rateRows}
        honestNote={
          stats.reviewRate === null
            ? '样本不足：近 7 天还没有复测记录。完成课程后按计划复测，这里会出现完成率。'
            : `完成率分母为窗口内全部复测证据 ${reviewTotal} 次；到期任务完成率因缺少计划任务分母，仍显示未统计。`
        }
      />

      <MetricLedger
        idx="03"
        icon={<CalendarClock size={15} />}
        title="连续打卡"
        caption={`连续打卡与今日状态，共 ${checkinRows.length} 项，统计到今天 ${stats.todayKey}`}
        rows={checkinRows}
        honestNote="学习时长按 STAT-01 第 6 条保持「未统计」：本机没有时长数据源，不用活动次数推算。"
      />
    </section>
  )
}
