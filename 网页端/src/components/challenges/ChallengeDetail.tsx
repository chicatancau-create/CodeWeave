import { memo, useRef, useState } from 'react'
import {
  BookOpenCheck,
  Check,
  CircleHelp,
  ClipboardCheck,
  Lightbulb,
  Play,
  ShieldAlert,
  SquareDashed,
  Trophy,
  X,
} from 'lucide-react'
import type {
  AchievementObservation,
  Challenge,
  ChallengeRecord,
  ExecutionResult,
} from '../../types/lesson'
import { EXECUTION_TIER_LABEL, tierOfRunner } from '../../types/lesson'
import { judgeModeShortLabel, type JudgeOutcome } from '../../engine/challenge-judge'
import type { EvidenceValidation, ExternalEvidence } from '../../utils/external-evidence'
import { MovingBorderButton } from '../moving-border'
import { LANGUAGE_EXTENSIONS, RUNNER_LABELS, submissionPhase } from './challenge-model'
import { EXTERNAL_FIELDS, ExternalEvidenceForm } from './ExternalEvidenceForm'
import { SubmissionHistory } from './SubmissionHistory'

/* ----------------------------------------------------------------------------
   详情面板（CHAL-01）：内容分区 = 题目 / 编写与运行 / 提交记录。
   手机用标签页；桌面（≥1024px）由 CSS 展开为双栏，全部分区可见。
   草稿、运行结果、证据都保存在父组件（按 challenge.id），切换标签不丢失。
   ---------------------------------------------------------------------------- */

type DetailTab = 'overview' | 'lab' | 'evidence'

const DETAIL_TABS: { id: DetailTab; label: string; panelClass: string }[] = [
  { id: 'overview', label: '题目', panelClass: 'detail-tabpanel--overview' },
  { id: 'lab', label: '编写与运行', panelClass: 'detail-tabpanel--lab' },
  { id: 'evidence', label: '提交记录', panelClass: 'detail-tabpanel--evidence' },
]

function ChallengeDetailPanel({
  challenge,
  sequence,
  total,
  record,
  units,
  onOpenUnit,
  draft,
  draftCodeState,
  draftEvidenceState,
  onDraftChange,
  runResult,
  outputMatches,
  judge,
  busy,
  onRun,
  evidence,
  onEvidenceChange,
  externalEvidence,
  externalCheck,
  onExternalEvidenceChange,
  hintOpen,
  onToggleHint,
  canSubmit,
  onSubmit,
  onVerifySubmission,
  onRejectSubmission,
}: {
  challenge: Challenge
  sequence: string
  total: string
  record: ChallengeRecord | undefined
  units: { id: string; title: string }[]
  onOpenUnit: (lessonId: string) => void
  draft: string
  draftCodeState: string
  draftEvidenceState: string
  onDraftChange: (code: string) => void
  runResult: ExecutionResult | undefined
  outputMatches: boolean
  /** CHAL-02：逐条判定结果，未运行时为 undefined（不渲染判定明细，也不给通过结论） */
  judge: JudgeOutcome | undefined
  busy: boolean
  onRun: () => void
  evidence: string
  onEvidenceChange: (note: string) => void
  externalEvidence: ExternalEvidence
  externalCheck: EvidenceValidation | undefined
  onExternalEvidenceChange: (updates: Partial<ExternalEvidence>) => void
  hintOpen: boolean
  onToggleHint: () => void
  canSubmit: boolean
  onSubmit: () => void
  /** R4 人工复核：由上层把 hook 的 verifySubmission / rejectSubmission 原样递进来（未接上时不画按钮） */
  onVerifySubmission: ((challengeId: string, observation?: AchievementObservation) => void) | undefined
  onRejectSubmission: ((challengeId: string) => void) | undefined
}) {
  const isExternal = challenge.runner === 'external'
  const [tab, setTab] = useState<DetailTab>('overview')
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  const focusTab = (index: number) => {
    const next = (index + DETAIL_TABS.length) % DETAIL_TABS.length
    const nextTab = DETAIL_TABS[next]
    if (!nextTab) return
    setTab(nextTab.id)
    tabRefs.current[next]?.focus()
  }

  const handleTabKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      focusTab(index + 1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusTab(index - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusTab(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusTab(DETAIL_TABS.length - 1)
    }
  }

  const tierBadge = (
    <span className={`execution-tier tier-${tierOfRunner(challenge.runner)}`} role="note">
      {EXECUTION_TIER_LABEL[tierOfRunner(challenge.runner)]}
    </span>
  )

  /* 区 01 的提交按钮与区 02 的记录状态共用同一份派生口径（submissionPhase）。 */
  const { showSubmitAction } = submissionPhase(record)
  // 外部关卡的结构化证据：草稿完成度按**已填字段数**陈述，不改 validate 判定口径。
  const externalFilled = EXTERNAL_FIELDS.filter((field) => (externalEvidence[field.key] ?? '').trim().length > 0).length

  const runResultBlock = runResult && (
    <div className={`challenge-result ${outputMatches ? 'passed' : runResult.unsupported ? 'unsupported' : 'failed'}`}>
      <strong>
        {runResult.unsupported ? (
          <>
            <ShieldAlert size={12} /> 未识别代码结构，未产生通过判定
          </>
        ) : outputMatches ? (
          <>
            <Check size={12} /> 输出与验收点一致
          </>
        ) : (
          <>
            <X size={12} /> 输出与验收点不一致
          </>
        )}
      </strong>
      {tierBadge}
      {runResult.error ? (
        <span>
          {runResult.unsupported ? '' : `第 ${runResult.error.line} 行：`}
          {runResult.error.message}
        </span>
      ) : (
        runResult.output.map((line, index) => <span key={`${line}-${index}`}>› {line}</span>)
      )}
      {/* CHAL-02 第 3 条：逐条报告而非一个总分——哪条命中、命中到哪一行、没命中差在哪、
          多印了哪些没被用掉的行，全部就地陈述。判定明细是文字，不靠图标颜色单独承载。 */}
      {judge && !runResult.error && (
        <>
          <span className="judge-mode">{judgeModeShortLabel(judge.mode)}</span>
          <ul className="judge-cases">
            {judge.cases.map((item, index) => (
              <li key={index} className={item.matched ? 'hit' : 'miss'}>
                <span className="judge-verdict">{item.matched ? '命中' : '未命中'}</span>
                <code className="judge-expected">{item.expected}</code>
                <span className="judge-detail">{item.matched ? `＝ ${item.actual}` : item.reason}</span>
              </li>
            ))}
            {judge.extraLines.length > 0 && (
              <li className="extra">
                <span className="judge-verdict">未匹配</span>
                <span className="judge-detail">
                  多印了 {judge.extraLines.length} 行没被任何验收点用掉：{judge.extraLines.join(' ⏎ ')}
                </span>
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  )

  // 手机：仅显示激活面板；桌面（≥1024px）：CSS 展开为双栏，三个面板全部可见。
  // 用 class 而非 hidden 属性，避免桌面布局下辅助技术忽略未激活面板。
  const panelProps = (id: DetailTab) => ({
    className: `detail-tabpanel ${DETAIL_TABS.find((item) => item.id === id)!.panelClass} ${tab === id ? 'active' : ''}`,
    role: 'tabpanel' as const,
    id: `panel-${id}-${challenge.id}`,
    'aria-labelledby': `tab-${id}-${challenge.id}`,
  })

  return (
    <div className="challenge-detail">
      <div className="detail-tabs" role="tablist" aria-label="挑战详情分区">
        {DETAIL_TABS.map((item, index) => (
          <button
            key={item.id}
            ref={(el) => {
              tabRefs.current[index] = el
            }}
            role="tab"
            id={`tab-${item.id}-${challenge.id}`}
            aria-selected={tab === item.id}
            aria-controls={`panel-${item.id}-${challenge.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            className={`detail-tab ${tab === item.id ? 'active' : ''}`}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div {...panelProps('overview')}>
        <div className="detail-block">
          <h3 className="detail-block-title">目标输出（运行结果需逐条覆盖）</h3>
          <div className="target-output">
            {/* 用下标作 key：验收点允许重复（「同样一行要印两次」正是本栏要考的），
                用文本作 key 会把重复项撞成一堆重复 key 警告。 */}
            {challenge.targetOutput.map((target, index) => {
              const item = judge?.cases[index]
              return (
                <code key={index} className={item ? (item.matched ? 'hit' : 'miss') : ''}>
                  {target}
                </code>
              )
            })}
          </div>
        </div>
        <div className="detail-block">
          <h3 className="detail-block-title">证据清单（提交前请逐项确认）</h3>
          <ul className="detail-evidence-list">
            {challenge.evidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="detail-block">
          <h3 className="detail-block-title">技术栈与说明</h3>
          <div className="challenge-meta">
            <span>{challenge.stack.join(' / ')}</span>
          </div>
          <p className="challenge-explanation">{challenge.explanation}</p>
        </div>
        {units.length > 0 && (
          <div className="challenge-units">
            <span>关联课程单元</span>
            <div>
              {units.map((unit) => (
                <button key={unit.id} className="subtle-button" onClick={() => onOpenUnit(unit.id)}>
                  <BookOpenCheck size={12} />
                  {unit.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div {...panelProps('lab')}>
        {isExternal ? (
          <div className="challenge-external-note">
            <p>
              本关卡需要真实环境（{challenge.stack.join('、')}）。本页面不会伪造真实运行结果。
            </p>
            <p>
              请在本地完成后，到「提交记录」页填写结构化证据：执行环境、执行命令、结果摘要与复现日期。
              提交后状态为<strong>待人工确认</strong>，系统不会自动判定为通过。
            </p>
          </div>
        ) : (
          <>
            <div className="challenge-editor-wrap">
              <div className="terminal-chrome">
                <span className="terminal-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="terminal-title">
                  solution.{LANGUAGE_EXTENSIONS[challenge.language]} — {RUNNER_LABELS[challenge.runner]}
                </span>
                <span className="terminal-index">
                  第 {sequence} / {total} 关
                </span>
              </div>
              <label className="field-label">
                你的代码
                <textarea
                  className="challenge-editor"
                  value={draft}
                  onChange={(event) => onDraftChange(event.target.value)}
                  spellCheck="false"
                  aria-label={`${challenge.title} 代码编辑器`}
                />
              </label>
              <button className="subtle-button challenge-run-button" onClick={onRun} disabled={busy}>
                <Play size={12} aria-hidden="true" />
                {busy ? '运行中…' : '运行检查'}
              </button>
            </div>
            {/* 草稿态就地声明：编辑器里的内容只是本机草稿，未提交前不影响进度 */}
            <p className="challenge-draft-state challenge-draft-state--code">
              <SquareDashed size={13} aria-hidden="true" />
              <span className="challenge-draft-state-label">代码草稿</span>
              <span>{draftCodeState}</span>
            </p>
            {runResultBlock}
          </>
        )}
      </div>

      <div {...panelProps('evidence')}>
        {!isExternal && runResultBlock}

        {/* ── 区 01 本地草稿：未提交，只在本机 ───────────────────────────── */}
        <section className="challenge-zone challenge-zone--draft" aria-label="本地草稿（尚未提交）">
          <header className="challenge-zone-head">
            <span className="challenge-zone-no" aria-hidden="true">
              01
            </span>
            <h3 className="challenge-zone-title">本地草稿</h3>
            <span className="challenge-zone-scope">未提交 · 只存在这台设备上，改写它不影响学习进度</span>
          </header>

          {isExternal ? (
            <ExternalEvidenceForm
              challengeId={challenge.id}
              evidence={externalEvidence}
              check={externalCheck}
              onChange={onExternalEvidenceChange}
            />
          ) : (
            <label className="field-label">
              完成证据说明
              <textarea
                className="challenge-evidence"
                value={evidence}
                onChange={(event) => onEvidenceChange(event.target.value)}
                placeholder="描述你完成了什么、留下了哪些证据（运行输出、截图位置、排错记录…）"
                maxLength={400}
              />
            </label>
          )}

          <p className="challenge-draft-state challenge-draft-state--evidence">
            <SquareDashed size={13} aria-hidden="true" />
            <span className="challenge-draft-state-label">证据草稿</span>
            <span>
              {isExternal
                ? `结构化证据已填 ${externalFilled} / ${EXTERNAL_FIELDS.length} 项，未提交前不写入进度记录`
                : draftEvidenceState}
            </span>
          </p>

          {hintOpen && (
            <div className="hint-box">
              <Lightbulb size={14} aria-hidden="true" />
              <span>{challenge.hint}</span>
            </div>
          )}

          <div className="challenge-actions">
            <button className="subtle-button" onClick={onToggleHint}>
              <CircleHelp size={14} aria-hidden="true" />
              {hintOpen ? '收起提示' : '查看提示'}
            </button>
            {showSubmitAction && (
              <MovingBorderButton
                className="challenge-submit"
                beam={canSubmit}
                onClick={onSubmit}
                disabled={!canSubmit}
              >
                {isExternal ? <ClipboardCheck size={14} aria-hidden="true" /> : <Trophy size={14} aria-hidden="true" />}
                {isExternal ? '提交证据（待人工确认）' : '提交答案'}
              </MovingBorderButton>
            )}
          </div>
        </section>

        {/* ── 区 02 已提交记录：已写入进度，不随编辑器改变 ─────────────────── */}
        <SubmissionHistory
          challengeId={challenge.id}
          record={record}
          onVerifySubmission={onVerifySubmission}
          onRejectSubmission={onRejectSubmission}
        />
      </div>
    </div>
  )
}

export const ChallengeDetail = memo(ChallengeDetailPanel)
