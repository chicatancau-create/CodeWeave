import { memo } from 'react'
import { Check, ChevronLeft, ChevronRight, ClipboardCheck, FlaskConical, RotateCcw, ShieldAlert, SquareDashed } from 'lucide-react'
import type { Challenge } from '../../types/lesson'
import type { CardStatus } from './challenge-model'
import { RUNNER_SHORT, STATUS_LABEL, shortTitle } from './challenge-model'

/* ----------------------------------------------------------------------------
   关卡编号列表（CHAL-01 / §5.2）：
   每一行 = 序号 + 阶段徽标 + 状态 + 短标题 + 摘要 + 难度 / 执行环境 / 轨道 + 主操作。
   结构用 `<ol role="list">` + `<li>`，序号是**真实文本**（见 buildSequence）。
   形态：轻边界信息区 —— 1px 发丝线分行，不用玻璃卡、渐变与泛光。
   -------------------------------------------------------------------------- */

/** 一张卡片需要的全部数据：派生口径在父组件算好，这里只负责画。 */
export type ChallengeRow = {
  challenge: Challenge
  sequence: string
  status: CardStatus
  hasActivity: boolean
  draftFlag: string
}

function ChallengeStageGrid({
  rows,
  selectedId,
  onSelect,
  filtersDirty,
  hasQuery,
  query,
  onResetFilters,
}: {
  rows: ChallengeRow[]
  selectedId: string
  onSelect: (challenge: Challenge) => void
  filtersDirty: boolean
  hasQuery: boolean
  query: string
  onResetFilters: () => void
}) {
  if (rows.length === 0) {
    /*
       01 号方案 §4 的 empty 行：说清「为什么是空的」**和下一步**。
       改版前只有一句「暂无可用的挑战数据。」，没有动作；而这一支在没开任何筛选时也会
       走到「当前筛选没有匹配的关卡」——那是假原因（清单本身是空的，不是被筛掉的）。
       两种情况分开陈述，动作分别给：筛掉了就一键清除筛选，本来就没有就指向教材那一侧。
       -------------------------------------------------------------------- */
    return (
      <div className="challenge-grid-empty" role="status">
        <FlaskConical size={22} aria-hidden="true" />
        <p>
          {hasQuery
            ? `筛选开着，但没有关卡匹配「${query}」。`
            : filtersDirty
              ? '当前筛选条件下一个关卡都不匹配。'
              : '教材目录里没有带挑战的单元：清单本身是空的，不是被筛掉的。'}
        </p>
        <p className="challenge-grid-empty-next">
          {filtersDirty
            ? '下一步：清掉筛选条件再看一次全部关卡。'
            : '下一步：等教材同步完成后重进本页；也可以先到学习路径选一节课。'}
        </p>
        {filtersDirty && (
          <button className="subtle-button" onClick={onResetFilters}>
            <RotateCcw size={12} aria-hidden="true" />
            清除筛选
          </button>
        )}
      </div>
    )
  }

  return (
    <ol className="challenge-grid" role="list" aria-label="挑战关卡编号列表">
      {rows.map((row) => (
        <ChallengeStageCard
          key={row.challenge.id}
          challenge={row.challenge}
          sequence={row.sequence}
          status={row.status}
          hasActivity={row.hasActivity}
          draftFlag={row.draftFlag}
          selected={row.challenge.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </ol>
  )
}

function ChallengeStageCardView({
  challenge,
  sequence,
  status,
  hasActivity,
  draftFlag,
  selected,
  onSelect,
}: {
  challenge: Challenge
  sequence: string
  status: CardStatus
  hasActivity: boolean
  draftFlag: string
  selected: boolean
  onSelect: (challenge: Challenge) => void
}) {
  const action = hasActivity ? '继续挑战' : '开始挑战'
  return (
    <li className="challenge-list-item">
      <button
        type="button"
        className={`stage-card status-${status} ${status} ${selected ? 'selected' : ''}`}
        data-challenge-id={challenge.id}
        aria-pressed={selected}
        aria-label={`${sequence} · ${challenge.stageId} 关：${shortTitle(challenge.title)}，${STATUS_LABEL[status]}，难度 ${challenge.difficulty}，${action}${draftFlag ? `，${draftFlag}` : ''}`}
        onClick={() => onSelect(challenge)}
      >
        <span className="stage-card-top">
          <span className="stage-card-lead">
            <span className="stage-card-no">{sequence}</span>
            <span className="stage-badge">{challenge.stageId}</span>
          </span>
          <span className={`stage-status status-${status}`}>
            {status === 'passed' && <Check size={11} strokeWidth={3} />}
            {status === 'pending-verify' && <ClipboardCheck size={11} strokeWidth={3} />}
            {status === 'unsupported' && <ShieldAlert size={11} strokeWidth={3} />}
            {STATUS_LABEL[status]}
          </span>
        </span>
        <strong className="stage-title">{shortTitle(challenge.title)}</strong>
        <span className="stage-card-summary">{challenge.description}</span>
        <span className="stage-card-meta">
          <span className={`difficulty ${challenge.difficulty}`}>{challenge.difficulty}</span>
          <span className="stage-runner">{RUNNER_SHORT[challenge.runner]}</span>
          <span className="stage-track">{challenge.track}</span>
          {/* 草稿与提交两条通道分开陈述：左边是「本机未提交」，右边是已提交后的状态 */}
          {draftFlag && (
            <span className="stage-card-draft">
              <SquareDashed size={11} aria-hidden="true" />
              {draftFlag}
            </span>
          )}
          <span className="stage-card-action">{action}</span>
        </span>
      </button>
    </li>
  )
}

/* ----------------------------------------------------------------------------
   分页（CHAL-01）：页面大小 12；导航提供上一页 / 当前页 / 下一页。
   -------------------------------------------------------------------------- */

function ChallengePaginationBar({
  page,
  pageCount,
  onChange,
}: {
  page: number
  pageCount: number
  onChange: (page: number) => void
}) {
  return (
    <nav className="challenge-pagination" aria-label="挑战分页">
      <button
        type="button"
        className="subtle-button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
      >
        <ChevronLeft size={12} />
        上一页
      </button>
      <span className="challenge-pagination-status" aria-live="polite">
        第 {page} / {pageCount} 页
      </span>
      <button
        type="button"
        className="subtle-button"
        onClick={() => onChange(page + 1)}
        disabled={page >= pageCount}
      >
        下一页
        <ChevronRight size={12} />
      </button>
    </nav>
  )
}

export const ChallengeGrid = memo(ChallengeStageGrid)
/** 单卡也 memo：只有这张卡自己的序号 / 状态 / 草稿标记变了才重画。 */
export const ChallengeStageCard = memo(ChallengeStageCardView)
export const ChallengePagination = memo(ChallengePaginationBar)
