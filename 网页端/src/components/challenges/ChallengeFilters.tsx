import { memo } from 'react'
import { ChevronDown, ListFilter, RotateCcw, X } from 'lucide-react'
import type { ChallengeFilters as FiltersState, RunnerFilter, SortMode, StatusFilter } from './challenge-model'
import { DEFAULT_FILTERS, DIFFICULTY_ORDER, RUNNER_FILTER_OPTIONS, SORT_OPTIONS, STATUS_FILTER_OPTIONS } from './challenge-model'

/* ----------------------------------------------------------------------------
   筛选栏（CHAL-01）：
   主筛选 = 搜索 / 阶段 / 状态；轨道、难度、运行方式、排序收进「更多筛选」；
   已选筛选用标签显示，可单独移除；dirty 时提供「清除筛选」。
   -------------------------------------------------------------------------- */

type FilterChip = { key: keyof FiltersState; label: string; value: string }

function activeChipsOf(filters: FiltersState): FilterChip[] {
  const chips: FilterChip[] = []
  if (filters.q.trim()) chips.push({ key: 'q', label: '搜索', value: filters.q.trim() })
  if (filters.stage !== 'all') chips.push({ key: 'stage', label: '阶段', value: filters.stage })
  if (filters.track !== 'all') chips.push({ key: 'track', label: '轨道', value: filters.track })
  if (filters.difficulty !== 'all') chips.push({ key: 'difficulty', label: '难度', value: filters.difficulty })
  if (filters.runner !== 'all')
    chips.push({
      key: 'runner',
      label: '运行方式',
      value: RUNNER_FILTER_OPTIONS.find((option) => option.value === filters.runner)?.label ?? filters.runner,
    })
  if (filters.status !== 'all')
    chips.push({
      key: 'status',
      label: '状态',
      value: STATUS_FILTER_OPTIONS.find((option) => option.value === filters.status)?.label ?? filters.status,
    })
  if (filters.sort !== 'stage')
    chips.push({
      key: 'sort',
      label: '排序',
      value: SORT_OPTIONS.find((option) => option.value === filters.sort)?.label ?? filters.sort,
    })
  return chips
}

function ChallengeFiltersBar({
  filters,
  tracks,
  stages,
  moreOpen,
  onToggleMore,
  onChange,
  onReset,
  dirty,
}: {
  filters: FiltersState
  tracks: string[]
  stages: string[]
  moreOpen: boolean
  onToggleMore: () => void
  onChange: (updates: Partial<FiltersState>) => void
  onReset: () => void
  dirty: boolean
}) {
  const chips = activeChipsOf(filters)
  const extraActive = chips.filter((chip) => chip.key !== 'q' && chip.key !== 'stage' && chip.key !== 'status').length

  return (
    <div className="challenge-filters" role="group" aria-label="挑战筛选与排序">
      <span className="challenge-filters-label">
        <ListFilter size={13} />
        筛选
      </span>
      <label className="challenge-filter challenge-filter-search">
        搜索
        <input
          type="search"
          value={filters.q}
          onChange={(event) => onChange({ q: event.target.value })}
          placeholder="标题 / 技术栈 / 说明"
          aria-label="搜索关卡"
        />
      </label>
      <label className="challenge-filter">
        阶段
        <select value={filters.stage} onChange={(event) => onChange({ stage: event.target.value })}>
          <option value="all">全部</option>
          {stages.map((stage) => (
            <option key={stage} value={stage}>
              {stage}
            </option>
          ))}
        </select>
      </label>
      <label className="challenge-filter">
        状态
        <select
          value={filters.status}
          onChange={(event) => onChange({ status: event.target.value as StatusFilter })}
        >
          {STATUS_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="subtle-button challenge-more-toggle"
        aria-expanded={moreOpen}
        // 收起时不挂 aria-controls：指着一个不存在的 id 会被判 aria-valid-attr-value 违规
        aria-controls={moreOpen ? 'challenge-more-filters' : undefined}
        onClick={onToggleMore}
      >
        <ChevronDown size={12} />
        更多筛选{extraActive > 0 ? `（${extraActive}）` : ''}
      </button>

      {moreOpen && (
        <div className="challenge-more-filters" id="challenge-more-filters">
          <label className="challenge-filter">
            轨道
            <select value={filters.track} onChange={(event) => onChange({ track: event.target.value })}>
              <option value="all">全部</option>
              {tracks.map((track) => (
                <option key={track} value={track}>
                  {track}
                </option>
              ))}
            </select>
          </label>
          <label className="challenge-filter">
            难度
            <select value={filters.difficulty} onChange={(event) => onChange({ difficulty: event.target.value })}>
              <option value="all">全部</option>
              {DIFFICULTY_ORDER.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
          <label className="challenge-filter">
            运行方式
            <select
              value={filters.runner}
              onChange={(event) => onChange({ runner: event.target.value as RunnerFilter })}
            >
              {RUNNER_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="challenge-filter">
            排序
            <select value={filters.sort} onChange={(event) => onChange({ sort: event.target.value as SortMode })}>
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {dirty && (
        <div className="challenge-filter-chips">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="filter-chip"
              aria-label={`移除筛选：${chip.label} ${chip.value}`}
              onClick={() => onChange({ [chip.key]: DEFAULT_FILTERS[chip.key] } as Partial<FiltersState>)}
            >
              {chip.label}：{chip.value}
              <X size={10} />
            </button>
          ))}
          <button type="button" className="subtle-button" onClick={onReset}>
            <RotateCcw size={12} />
            清除筛选
          </button>
        </div>
      )}
    </div>
  )
}

export const ChallengeFilters = memo(ChallengeFiltersBar)
