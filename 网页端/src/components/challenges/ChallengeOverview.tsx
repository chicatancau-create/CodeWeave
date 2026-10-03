import { memo } from 'react'

/* ----------------------------------------------------------------------------
   顶部概览：总进度（带 aria 数值）+ 筛选后数量
   -------------------------------------------------------------------------- */

function ChallengeOverviewBase({
  total,
  completed,
  pendingVerify = 0,
  filteredCount,
}: {
  total: number
  completed: number
  pendingVerify?: number
  filteredCount: number
}) {
  const percent = total ? Math.round((completed / total) * 100) : 0
  return (
    <div className="module-heading challenge-overview">
      <div>
        <p className="eyebrow">
          <span className="eyebrow-dot" />
          实战挑战
        </p>
        <h1>挑战关卡</h1>
        <p>通过实际问题检验学习效果，每个关卡独立验收。</p>
      </div>
      <div className="challenge-overview-stats">
        <div
          className="challenge-progress"
          role="progressbar"
          aria-label="挑战完成进度"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={completed}
          aria-valuetext={`已完成 ${completed} / ${total} 关`}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
        <span className="challenge-overview-text">
          已完成 {completed} / {total} · 筛选后 {filteredCount} 关
          {pendingVerify > 0 && ` · 待人工确认 ${pendingVerify} 关`}
        </span>
      </div>
    </div>
  )
}

export const ChallengeOverview = memo(ChallengeOverviewBase)
