import './challenges-view.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, FlaskConical, Play } from 'lucide-react'
import type {
  AchievementObservation,
  Challenge,
  ChallengeJudgeMode,
  ChallengeRecord,
  ExecutionResult,
  ExecutionTier,
} from '../types/lesson'
import { EXECUTION_TIER_LABEL, tierOfRunner } from '../types/lesson'
import { executeJavaScript } from '../engine/javascript-sandbox'
import { simulateProgram } from '../engine/teaching-runtime'
import { DEFAULT_JUDGE_MODE, judgeOutput, type JudgeOutcome } from '../engine/challenge-judge'
import { countPassedChallenges } from '../utils/analytics'
import { readChallengeDrafts, saveChallengeDrafts, type ChallengeDraftMap } from '../utils/challenge-drafts'
import { getLocalDateKey } from '../utils/date-helpers'
import {
  emptyEvidence,
  readExternalEvidence,
  saveExternalEvidence,
  summarizeExternalEvidence,
  validateExternalEvidence,
  type ExternalEvidence,
} from '../utils/external-evidence'
import { ChallengeDetail } from './challenges/ChallengeDetail'
import { ChallengeFilters } from './challenges/ChallengeFilters'
import { ChallengeGrid, ChallengePagination, type ChallengeRow } from './challenges/ChallengeGrid'
import { ChallengeOverview } from './challenges/ChallengeOverview'
import {
  buildSequence,
  cardStatus,
  DEFAULT_FILTERS,
  describeCodeDraft,
  describeEvidenceDraft,
  DIFFICULTY_ORDER,
  LANGUAGE_EXTENSIONS,
  loadFilters,
  loadViewState,
  makeRunnerLesson,
  matchesQuery,
  padOrdinal,
  PAGE_SIZE,
  RUNNER_LABELS,
  saveFilters,
  saveViewState,
  STATUS_LABEL,
  STATUS_RANK,
  type ChallengeFilters as ChallengeFiltersValue,
  type ViewMode,
} from './challenges/challenge-model'

type ChallengesViewProps = {
  challenges: Challenge[]
  progress: Record<string, ChallengeRecord>
  /** 阶段 id → 对应课程单元（可跳转） */
  unitsByStage: Record<string, { id: string; title: string }[]>
  onOpenUnit: (lessonId: string) => void
  /** 全局搜索等外部入口指定要聚焦的关卡 id（变化时选中） */
  focusChallengeId?: string
  /** 提交验证：运行代码并比对目标输出，全部满足才算通过 */
  onSubmit: (challenge: Challenge, submission: { output: string[]; evidence: string; passed: boolean; tier: ExecutionTier; judgeMode?: ChallengeJudgeMode; externalEvidence?: ExternalEvidence }) => void
  /**
   * R4 人工复核（LEARN-01 第 4 条：状态机里的 `verified` / `rejected` 不能只活在测试里）。
   * 两个动作都是 `useChallengeProgress` 的既有函数本身 —— 状态迁移只在那一处，本组件不自己改记录。
   * 缺省时（调用方没有复核能力）这两个按钮不画：画一个按了没用的按钮是假动作。
   */
  onVerifySubmission?: (challengeId: string, observation?: AchievementObservation) => void
  onRejectSubmission?: (challengeId: string) => void
  /** 账户作用域：草稿与证据按账户隔离（未提供时退化为 guest） */
  scope?: string
}

/** 阶段没有关联单元时的稳定空数组：每次渲染新建会让详情面板的 memo 形同虚设。 */
const NO_UNITS: { id: string; title: string }[] = []

export function ChallengesView({ challenges, progress, unitsByStage, onOpenUnit, focusChallengeId, onSubmit, onVerifySubmission, onRejectSubmission, scope }: ChallengesViewProps) {
  // CHAL-01：视图模式 + 选中题 + 页码（恢复自 sessionStorage，重挂载/刷新后回到原位置）。
  const [initialView] = useState(() => loadViewState(challenges))
  const [mode, setMode] = useState<ViewMode>(initialView.mode)
  const [selectedId, setSelectedId] = useState<string>(initialView.selectedId || (challenges[0]?.id ?? ''))
  const [page, setPage] = useState(initialView.page)
  const [notice, setNotice] = useState<string | null>(null)
  // R2-B：草稿与证据按账户作用域持久化（code + evidence），运行结果仍为会话内瞬时状态。
  const [drafts, setDrafts] = useState<ChallengeDraftMap>(() => readChallengeDrafts(scope))
  // R4：外部证据使用结构化字段，同样按账户作用域持久化。
  const [externalDrafts, setExternalDrafts] = useState<Record<string, ExternalEvidence>>(() => readExternalEvidence(scope))
  const [runResults, setRunResults] = useState<Record<string, ExecutionResult>>({})
  const [hintOpen, setHintOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [filters, setFilters] = useState<ChallengeFiltersValue>(loadFilters)
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false)
  const previousScope = useRef(scope)

  // CHAL-01：详情返回列表时的焦点与滚动恢复。
  // 焦点恢复记录关卡 id 而不是元素引用——列表在详情模式下被卸载，元素会脱离文档。
  const savedScrollRef = useRef(0)
  const lastCardIdRef = useRef<string | null>(null)
  const restoreListRef = useRef(false)
  const backRef = useRef<HTMLButtonElement | null>(null)
  // RUN-01 遗留（挑战侧）：运行令牌防止切题后迟到的旧结果写回状态。
  const runTokenRef = useRef(0)

  // 账户切换：重新加载该作用域的草稿与外部证据，并清空会话内运行结果（避免串号）。
  useEffect(() => {
    if (previousScope.current === scope) return
    previousScope.current = scope
    setDrafts(readChallengeDrafts(scope))
    setExternalDrafts(readExternalEvidence(scope))
    setRunResults({})
  }, [scope])

  // 外部入口（全局搜索）指定聚焦关卡：渲染期重置（避免 effect 级联渲染）。
  // 失效 id 停留在列表并提示，不默认跳到第一关。
  const [lastFocusId, setLastFocusId] = useState<string | undefined>(undefined)
  if (lastFocusId !== focusChallengeId) {
    setLastFocusId(focusChallengeId)
    if (focusChallengeId) {
      const target = challenges.find((challenge) => challenge.id === focusChallengeId)
      if (target) {
        setSelectedId(target.id)
        setMode('detail')
        setNotice(null)
      } else {
        setMode('list')
        setNotice(`未找到指定的挑战（${focusChallengeId}），请从列表重新选择。`)
      }
    }
  }

  useEffect(() => {
    saveFilters(filters)
  }, [filters])

  useEffect(() => {
    saveViewState({ mode, selectedId, page })
  }, [mode, selectedId, page])

  // 进入详情：焦点移到「返回列表」，屏幕阅读器能感知视图切换。
  useEffect(() => {
    if (mode === 'detail') backRef.current?.focus()
  }, [mode, selectedId])

  // 返回列表：焦点回到进入时的卡片，滚动位置回到进入前的位置。
  useEffect(() => {
    if (mode !== 'list' || !restoreListRef.current) return
    restoreListRef.current = false
    const card = lastCardIdRef.current
      ? document.querySelector<HTMLButtonElement>(`.stage-card[data-challenge-id="${lastCardIdRef.current}"]`)
      : null
    card?.focus()
    window.scrollTo(0, savedScrollRef.current)
  }, [mode])

  // STAT-01：完成数与待确认数共用唯一派生口径（与个人中心、学习分析一致）。
  const { passed: passedCount, legacy: legacyPassedCount, pendingVerify: pendingVerifyCount } =
    countPassedChallenges(progress)
  const completedCount = passedCount + legacyPassedCount
  const tracks = useMemo(() => [...new Set(challenges.map((challenge) => challenge.track))], [challenges])
  const stages = useMemo(() => [...new Set(challenges.map((challenge) => challenge.stageId))], [challenges])
  // §5.2 编号列表：序号取自数据原始顺序（A—M），是关卡身份的一部分，不随筛选/排序漂移。
  const sequenceById = useMemo(() => buildSequence(challenges), [challenges])
  const totalOrdinal = padOrdinal(challenges.length)

  const sessionStatusOf = useCallback(
    (challenge: Challenge): 'ran' | 'unsupported' | undefined => {
      const result = runResults[challenge.id]
      if (!result) return undefined
      return result.unsupported ? 'unsupported' : 'ran'
    },
    [runResults],
  )

  const statusOf = useCallback(
    (challenge: Challenge) => cardStatus(challenge, progress[challenge.id], sessionStatusOf(challenge)),
    [progress, sessionStatusOf],
  )

  const visibleChallenges = useMemo(() => {
    const filtered = challenges.filter((challenge) => {
      if (!matchesQuery(challenge, filters.q)) return false
      if (filters.stage !== 'all' && challenge.stageId !== filters.stage) return false
      if (filters.track !== 'all' && challenge.track !== filters.track) return false
      if (filters.difficulty !== 'all' && challenge.difficulty !== filters.difficulty) return false
      if (filters.runner === 'browser' && challenge.runner !== 'javascript-sandbox') return false
      if (filters.runner === 'teaching' && challenge.runner !== 'teaching') return false
      if (filters.runner === 'external' && challenge.runner !== 'external') return false
      if (filters.status !== 'all') {
        const status = statusOf(challenge)
        if (filters.status === 'passed' && status !== 'passed') return false
        if (filters.status === 'pending' && status !== 'pending-verify') return false
        if (filters.status === 'not-started' && !(status === 'not-started' || status === 'external-pending')) return false
        if (filters.status === 'ran' && !(status === 'ready-to-submit' || status === 'unsupported')) return false
      }
      return true
    })
    if (filters.sort === 'difficulty') {
      filtered.sort(
        (a, b) =>
          DIFFICULTY_ORDER.indexOf(a.difficulty) - DIFFICULTY_ORDER.indexOf(b.difficulty) ||
          a.stageId.localeCompare(b.stageId),
      )
    } else if (filters.sort === 'status') {
      filtered.sort(
        (a, b) =>
          STATUS_RANK[cardStatus(a, progress[a.id], sessionStatusOf(a))] -
            STATUS_RANK[cardStatus(b, progress[b.id], sessionStatusOf(b))] ||
          a.stageId.localeCompare(b.stageId),
      )
    }
    return filtered
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenges, progress, runResults, filters])

  const selectedChallenge = useMemo(
    () => challenges.find((challenge) => challenge.id === selectedId) ?? challenges[0],
    [challenges, selectedId],
  )

  const updateFilter = useCallback((updates: Partial<ChallengeFiltersValue>) => {
    setFilters((current) => ({ ...current, ...updates }))
    // CHAL-01：筛选（含搜索）改变后回到第一页。
    setPage(1)
  }, [])
  const resetFilters = useCallback(() => updateFilter(DEFAULT_FILTERS), [updateFilter])
  const toggleMoreFilters = useCallback(() => setMoreFiltersOpen((open) => !open), [])
  const toggleHint = useCallback(() => setHintOpen((open) => !open), [])
  const filtersDirty = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS)

  const pageCount = Math.max(1, Math.ceil(visibleChallenges.length / PAGE_SIZE))
  // CHAL-01：当前页因筛选收窄变空时，回退到最后一个有效页。
  const currentPage = Math.min(page, pageCount)
  const pagedChallenges = useMemo(
    () => visibleChallenges.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [visibleChallenges, currentPage],
  )
  // 卡片要的派生数据在父层一次算好：拆出去的网格组件不再收内联函数 props，
  // 筛选/详情/提交状态互不牵连（01 §4 的拆分理由）。
  const gridRows = useMemo<ChallengeRow[]>(
    () =>
      pagedChallenges.map((challenge) => ({
        challenge,
        sequence: sequenceById.get(challenge.id) ?? '——',
        status: statusOf(challenge),
        hasActivity:
          Boolean(progress[challenge.id]) ||
          (drafts[challenge.id]?.code !== undefined && drafts[challenge.id]!.code !== challenge.starterCode),
        draftFlag: drafts[challenge.id] ? '本机草稿' : '',
      })),
    [pagedChallenges, sequenceById, statusOf, progress, drafts],
  )

  /**
   * 放弃当前这一跑的结论：换令牌（迟到的结果不再写回）+ 立刻收掉 busy。
   *
   * 改版前两处导航只做 `runTokenRef.current += 1`，而 `handleRun` 的 finally 写的是
   * `if (token === runTokenRef.current) setBusy(false)` —— 令牌已被导航换掉，条件永远不成立，
   * busy 就停在 true：运行途中点「返回列表」或切到别的关卡，之后**每一关**的
   * 「运行检查」都是禁用态并写着「运行中…」，要等整页重挂才恢复。
   * 迟到的结果依然不写回（那条语义保留），但这一跑不再拥有那个按钮 —— 所以导航处显式收尾。
   */
  const abandonRun = useCallback(() => {
    runTokenRef.current += 1
    setBusy(false)
  }, [])

  const openChallenge = useCallback((challenge: Challenge) => {
    abandonRun()
    lastCardIdRef.current = challenge.id
    savedScrollRef.current = window.scrollY
    setSelectedId(challenge.id)
    setMode('detail')
    setHintOpen(false)
    setNotice(null)
  }, [abandonRun])

  const backToList = () => {
    abandonRun()
    restoreListRef.current = true
    setMode('list')
  }

  /** 单一更新入口：同时写内存与账户作用域存储，避免陈旧快照覆盖。 */
  const patchDraft = useCallback(
    (challengeId: string, updates: Partial<{ code: string; evidence: string }>) => {
      setDrafts((current) => {
        // 基底不得凭空补 code：只改证据时补一个空串，读取方就会把它当成「用户清空了代码」，起始代码被顶掉
        const base = current[challengeId] ?? { evidence: '', savedAt: '' }
        const next = {
          ...current,
          [challengeId]: { ...base, ...updates, savedAt: new Date().toISOString() },
        }
        saveChallengeDrafts(next, scope)
        return next
      })
    },
    [scope],
  )

  /** 外部证据：整体替换单关证据（避免陈旧快照覆盖）。 */
  const patchExternalEvidence = useCallback(
    (challengeId: string, updates: Partial<ExternalEvidence>) => {
      setExternalDrafts((current) => {
        // STAT-01：`reproducedOn` 是日期键，UTC 切片在 UTC+8 凌晨会偏一天；本地归日一律走 date-helpers。
        const today = getLocalDateKey()
        const base = current[challengeId] ?? emptyEvidence(today)
        const next = { ...current, [challengeId]: { ...base, ...updates } }
        saveExternalEvidence(next, scope)
        return next
      })
    },
    [scope],
  )

  const updateDraft = useCallback(
    (code: string) => {
      if (!selectedChallenge) return
      patchDraft(selectedChallenge.id, { code })
      // 代码变更即失效上一次运行结果：避免把旧结果当作新代码的验证结论。
      setRunResults((current) => {
        if (!(selectedChallenge.id in current)) return current
        const next = { ...current }
        delete next[selectedChallenge.id]
        return next
      })
    },
    [selectedChallenge, patchDraft],
  )

  const updateEvidence = useCallback(
    (note: string) => {
      if (!selectedChallenge) return
      patchDraft(selectedChallenge.id, { evidence: note })
    },
    [selectedChallenge, patchDraft],
  )

  const handleExternalEvidenceChange = useCallback(
    (updates: Partial<ExternalEvidence>) => {
      if (!selectedChallenge) return
      patchExternalEvidence(selectedChallenge.id, updates)
    },
    [selectedChallenge, patchExternalEvidence],
  )

  const handleRun = useCallback(async () => {
    if (!selectedChallenge || selectedChallenge.runner === 'external') return
    const token = ++runTokenRef.current
    setBusy(true)
    try {
      const code = drafts[selectedChallenge.id]?.code ?? selectedChallenge.starterCode
      const tier = tierOfRunner(selectedChallenge.runner)
      const runnerLesson = makeRunnerLesson(
        selectedChallenge.language,
        RUNNER_LABELS[selectedChallenge.runner],
        `challenge.${LANGUAGE_EXTENSIONS[selectedChallenge.language]}`,
      )
      const raw =
        selectedChallenge.runner === 'javascript-sandbox'
          ? await executeJavaScript(code, runnerLesson)
          : simulateProgram(code, selectedChallenge.language, runnerLesson)
      // 运行期间切换/返回使令牌失效：迟到结果不写回，busy 由当前有效请求负责。
      if (token !== runTokenRef.current) return
      // 执行等级由运行方式决定，不随运行器自述变化（禁止隐式提升可信度）。
      setRunResults((current) => ({ ...current, [selectedChallenge.id]: { ...raw, tier } }))
    } finally {
      if (token === runTokenRef.current) setBusy(false)
    }
  }, [selectedChallenge, drafts])

  const runResult = selectedChallenge ? runResults[selectedChallenge.id] : undefined
  const evidenceNote = selectedChallenge ? (drafts[selectedChallenge.id]?.evidence ?? '') : ''
  const isExternalSelected = selectedChallenge?.runner === 'external'
  // 兜底空证据按 memo 固定住（原来每渲染新建一个对象，详情面板的 memo 会被它击穿）；
  // 日期口径不变：仍是渲染时现取的本机日期键。
  const externalEvidence = useMemo(
    () =>
      selectedChallenge
        ? (externalDrafts[selectedChallenge.id] ?? emptyEvidence(getLocalDateKey()))
        : emptyEvidence(''),
    [selectedChallenge, externalDrafts],
  )
  const externalCheck = useMemo(
    () => (selectedChallenge && isExternalSelected ? validateExternalEvidence(externalEvidence, selectedChallenge) : undefined),
    [selectedChallenge, isExternalSelected, externalEvidence],
  )

  /* CHAL-02：判定不再是一句 `output.some(line => line.includes(expected))`。
     子串包含会把验收点 `1` 判成被输出 `10` 满足，也不看重复次数与多印的行——那是假通过。
     口径由引擎 challenge-judge.ts 承担（默认精确整行、一行只用一次），这里只做映射：
     未运行 / 运行报错 / 运行等级不可信（external、unsupported）一律不给出判定结果。 */
  const judge = useMemo<JudgeOutcome | undefined>(() => {
    if (!selectedChallenge || !runResult) return undefined
    if (runResult.error || runResult.unsupported) return undefined
    if (runResult.tier !== 'worker' && runResult.tier !== 'teaching') return undefined
    return judgeOutput(
      selectedChallenge.targetOutput,
      runResult.output,
      selectedChallenge.judgeMode ?? DEFAULT_JUDGE_MODE,
    )
  }, [runResult, selectedChallenge])

  const outputMatches = Boolean(judge?.passed)

  const canSubmit = selectedChallenge
    ? isExternalSelected
      ? Boolean(externalCheck?.valid)
      : outputMatches && evidenceNote.trim().length > 0
    : false

  const handleSubmit = useCallback(() => {
    if (!selectedChallenge || !canSubmit) return
    const tier = tierOfRunner(selectedChallenge.runner)
    const output = runResult?.output ?? []
    if (isExternalSelected) {
      onSubmit(selectedChallenge, {
        output,
        evidence: summarizeExternalEvidence(externalEvidence),
        // 外部证据无法在本机验证真实性：只标记“已提交”，不能自动通过。
        passed: false,
        tier,
        externalEvidence,
      })
      // 提交后清空结构化证据（已随提交留档）；日期保留方便同日复现。
      patchExternalEvidence(selectedChallenge.id, { environment: '', command: '', resultSummary: '', artifactRef: '' })
      return
    }
    onSubmit(selectedChallenge, {
      output,
      evidence: evidenceNote.trim(),
      passed: outputMatches,
      tier,
      // CHAL-02 第 7 条：记录留下判定所用的口径，日后口径再变也能解释这条记录当时怎么来的。
      judgeMode: judge?.mode ?? selectedChallenge.judgeMode ?? DEFAULT_JUDGE_MODE,
    })
    // 提交后清空证据（已随提交留档）与运行结果；代码草稿保留供继续修改。
    patchDraft(selectedChallenge.id, { evidence: '' })
    setRunResults((current) => {
      const next = { ...current }
      delete next[selectedChallenge.id]
      return next
    })
  }, [
    selectedChallenge,
    canSubmit,
    runResult,
    isExternalSelected,
    onSubmit,
    externalEvidence,
    patchExternalEvidence,
    evidenceNote,
    outputMatches,
    judge,
    patchDraft,
  ])

  return (
    <section className="challenges-view">
      {mode === 'list' ? (
        <>
          <ChallengeOverview
            total={challenges.length}
            completed={completedCount}
            pendingVerify={pendingVerifyCount}
            filteredCount={visibleChallenges.length}
          />

          {notice && (
            <p className="challenge-notice" role="status">
              {notice}
            </p>
          )}

          <ChallengeFilters
            filters={filters}
            tracks={tracks}
            stages={stages}
            moreOpen={moreFiltersOpen}
            onToggleMore={toggleMoreFilters}
            onChange={updateFilter}
            onReset={resetFilters}
            dirty={filtersDirty}
          />

          <ChallengeGrid
            rows={gridRows}
            selectedId={selectedChallenge?.id ?? ''}
            onSelect={openChallenge}
            filtersDirty={filtersDirty}
            hasQuery={filters.q.trim().length > 0}
            query={filters.q.trim()}
            onResetFilters={resetFilters}
          />

          <ChallengePagination page={currentPage} pageCount={pageCount} onChange={setPage} />
        </>
      ) : (
        selectedChallenge && (
          <section className="challenge-detail-view" aria-label={`挑战详情：${selectedChallenge.title}`}>
            <header className="challenge-detail-head">
              <button ref={backRef} type="button" className="subtle-button challenge-back" onClick={backToList}>
                <ArrowLeft size={13} />
                返回列表
              </button>
              <div className="challenge-detail-heading">
                <p className="challenge-detail-no">
                  <span className="challenge-detail-no-index">{sequenceById.get(selectedChallenge.id) ?? '——'}</span>
                  <span className="challenge-detail-no-total">/ {totalOrdinal} 关</span>
                  <span className="challenge-detail-no-stage">阶段 {selectedChallenge.stageId}</span>
                </p>
                <div className="challenge-detail-heading-meta">
                  <span className={`difficulty ${selectedChallenge.difficulty}`}>{selectedChallenge.difficulty}</span>
                  <span className={`stage-status status-${statusOf(selectedChallenge)}`}>
                    {STATUS_LABEL[statusOf(selectedChallenge)]}
                  </span>
                  <span className={`execution-tier tier-${tierOfRunner(selectedChallenge.runner)}`} role="note">
                    {EXECUTION_TIER_LABEL[tierOfRunner(selectedChallenge.runner)]}
                  </span>
                </div>
                <h2>{selectedChallenge.title}</h2>
                <p>{selectedChallenge.description}</p>
                <div className="challenge-meta">
                  <span>
                    {isExternalSelected ? <FlaskConical size={12} /> : <Play size={12} />}{' '}
                    {RUNNER_LABELS[selectedChallenge.runner]}
                  </span>
                  <span>{selectedChallenge.track}</span>
                  {selectedChallenge.prerequisites.length > 0 && (
                    <span>
                      前置：{selectedChallenge.prerequisites.map((id) => id.replace('stage-', '').toUpperCase()).join('、')}
                    </span>
                  )}
                </div>
              </div>
            </header>

            <ChallengeDetail
              challenge={selectedChallenge}
              sequence={sequenceById.get(selectedChallenge.id) ?? '——'}
              total={totalOrdinal}
              record={progress[selectedChallenge.id]}
              units={unitsByStage[selectedChallenge.stageId] ?? NO_UNITS}
              onOpenUnit={onOpenUnit}
              draft={drafts[selectedChallenge.id]?.code ?? selectedChallenge.starterCode}
              draftCodeState={describeCodeDraft(drafts[selectedChallenge.id])}
              draftEvidenceState={describeEvidenceDraft(evidenceNote)}
              onDraftChange={updateDraft}
              runResult={runResult}
              outputMatches={outputMatches}
              judge={judge}
              busy={busy}
              onRun={handleRun}
              evidence={evidenceNote}
              onEvidenceChange={updateEvidence}
              externalEvidence={externalEvidence}
              externalCheck={externalCheck}
              onExternalEvidenceChange={handleExternalEvidenceChange}
              hintOpen={hintOpen}
              onToggleHint={toggleHint}
              canSubmit={canSubmit}
              onSubmit={handleSubmit}
              onVerifySubmission={onVerifySubmission}
              onRejectSubmission={onRejectSubmission}
            />
          </section>
        )
      )}
    </section>
  )
}
