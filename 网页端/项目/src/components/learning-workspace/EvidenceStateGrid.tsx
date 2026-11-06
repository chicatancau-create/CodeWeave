/**
 * 完成入口与本单元证据状态（01 号方案 §4 目标组件表的 `EvidenceStateGrid`）。
 *
 * 自 `learning-workspace-view.tsx` 原样搬来的两块：
 * - `.lesson-complete-row`：已完成那一格（把「谁判的」说出口，三档标签出自
 *   `utils/lesson-evidence.ts` 的同一张表）、未完成那颗按钮（档位文案由 `workspace-model` 折算）、
 *   外部环境课的四个结构化证据字段（清单与校验都出自 `utils/external-evidence.ts`，与挑战页同一份），
 *   以及该题验收点的逐条状态（`.cw-verify-cases`）与「为什么这一格没有判据」（`.cw-verify-none`）；
 * - `.cw-evidence-states`：六种学习状态逐条分开列，每一格带一句「这一条说了谁判的」。
 *
 * **只搬运 + 记忆化**：`.subtle-button`、`.external-evidence-*`、`.cw-evidence-state-*` 等
 * 类名、`id` 前缀、`role="alert"`、全部文案与 DOM 顺序一字未改。
 * 六格的**事实**由上层从掌握度记录折好传下来（`evidenceStates`），本组件既不自存状态、
 * 也不自己看 note 猜——那样才会有「界面打了勾而记录里没有」的平行真相（LEARN-01 第 4 条）。
 * 交上去的完成事实（`payload`）由主编排文件用 `completionPayloadOf()` 现算，这里只负责点这一下。
 */
import { memo } from 'react'
import { BookOpen, Flag, ShieldAlert } from 'lucide-react'
import type { JudgeOutcome } from '../../engine/challenge-judge'
import {
  EXTERNAL_EVIDENCE_ARTIFACT_MAX,
  EXTERNAL_EVIDENCE_FIELDS,
  EXTERNAL_EVIDENCE_FIELD_MAX,
  type EvidenceValidation,
  type ExternalEvidence,
} from '../../utils/external-evidence'
import { LESSON_STATE_ITEMS, NO_LESSON_STATES, type LessonEvidenceStates } from '../../utils/lesson-evidence'

type EvidenceStateGridProps = {
  completed: boolean
  /** 「本单元已完成（谁判的），按复测计划回顾」：上层用 `completedLabelOf()` 算好的字符串。 */
  completedLabel: string
  /** 按钮那句短文案（含禁用原因）：上层用 `pendingLabelOf()` 算好的字符串。 */
  buttonLabel: string
  completeDisabled: boolean
  /** 点这一下：上层已经把「谁判的、中了几条、外部证据」折成 payload，这里不再拼参数。 */
  onComplete: () => void
  /** 外部环境课的结构化证据表单（`lessonId` 只用于字段的 `id` 前缀，与挑战页同形状）。 */
  lessonId: string
  isExternal: boolean
  externalEvidence: ExternalEvidence
  externalCheck: EvidenceValidation | null
  onPatchEvidence: (updates: Partial<ExternalEvidence>) => void
  /** 该题验收点的判定结果（`engine/challenge-judge` 的 `judgeOutput`，本组件不再判一次）。 */
  contractJudge: JudgeOutcome | null
  detailPending: boolean
  canAutoRun: boolean
  /** 六态与「标记已阅读」：全部是上层给的事实与动作。 */
  evidenceStates: LessonEvidenceStates | null
  readMarked: boolean
  onMarkRead?: () => void
}

export const EvidenceStateGrid = memo(function EvidenceStateGrid({
  completed,
  completedLabel,
  buttonLabel,
  completeDisabled,
  onComplete,
  lessonId,
  isExternal,
  externalEvidence,
  externalCheck,
  onPatchEvidence,
  contractJudge,
  detailPending,
  canAutoRun,
  evidenceStates,
  readMarked,
  onMarkRead,
}: EvidenceStateGridProps) {
  const externalIssueFor = (key: keyof ExternalEvidence) => externalCheck?.issues.find((issue) => issue.field === key)

  return (
    <>
      <div className="lesson-complete-row">
        {completed ? (
          <span className="lesson-complete-done">
            <Flag size={13} /> {completedLabel}
          </span>
        ) : (
          <>
            {/* LEARN-01 第 5a 条：外部环境课的完成入口先要四项结构化证据。
                字段清单、校验、序列化都出自 utils/external-evidence.ts（与挑战页同一份），
                这里只负责把它摆进工作台；校验没过按钮就锁着，缺口逐条写在对应字段下面。 */}
            {isExternal ? (
              <div className="external-evidence-form">
                <p className="external-evidence-hint">
                  <ShieldAlert size={13} />
                  外部真实环境的证据只做<strong>完整性</strong>校验：本机验证不了它真实性，
                  所以这一条完成记的是<strong>学习者自行声明</strong>，不会自动升级为已验证。
                </p>
                {EXTERNAL_EVIDENCE_FIELDS.map((field) => {
                  const issue = externalIssueFor(field.key)
                  const inputId = `lesson-evidence-${lessonId}-${field.key}`
                  return (
                    <div key={field.key} className="external-evidence-field">
                      <label className="field-label" htmlFor={inputId}>
                        {field.label}
                        {field.required && <span className="external-evidence-required">必填</span>}
                      </label>
                      {field.key === 'resultSummary' ? (
                        <textarea
                          id={inputId}
                          className={`cw-evidence-textarea ${issue ? 'invalid' : ''}`}
                          value={externalEvidence[field.key] ?? ''}
                          onChange={(event) => onPatchEvidence({ [field.key]: event.target.value })}
                          placeholder={field.placeholder}
                          maxLength={EXTERNAL_EVIDENCE_FIELD_MAX}
                          aria-invalid={Boolean(issue)}
                        />
                      ) : (
                        <input
                          id={inputId}
                          type="text"
                          className={`external-evidence-input ${issue ? 'invalid' : ''}`}
                          value={externalEvidence[field.key] ?? ''}
                          onChange={(event) => onPatchEvidence({ [field.key]: event.target.value })}
                          placeholder={field.placeholder}
                          maxLength={
                            field.key === 'artifactRef' ? EXTERNAL_EVIDENCE_ARTIFACT_MAX : EXTERNAL_EVIDENCE_FIELD_MAX
                          }
                          aria-invalid={Boolean(issue)}
                        />
                      )}
                      {issue && (
                        <span className="external-evidence-error" role="alert">
                          {issue.message}
                        </span>
                      )}
                    </div>
                  )
                })}
                {externalCheck && externalCheck.missingKeywords.length > 0 && (
                  <p className="external-evidence-keywords">
                    建议在结果摘要中覆盖以下验收关键词：
                    {externalCheck.missingKeywords.map((keyword) => (
                      <code key={keyword}>{keyword}</code>
                    ))}
                  </p>
                )}
              </div>
            ) : null}
            <button className="subtle-button" onClick={onComplete} disabled={completeDisabled}>
              <Flag size={13} />
              {buttonLabel}
            </button>
            {contractJudge ? (
              <ul className="cw-verify-cases" aria-label="该题验收点逐条状态">
                {contractJudge.cases.map((item, index) => (
                  <li key={`${item.expected}-${index}`} className={item.matched ? 'is-hit' : 'is-miss'}>
                    <span className="cw-verify-glyph" aria-hidden="true">
                      {item.matched ? '✓' : '×'}
                    </span>
                    <code>{item.expected}</code>
                    {item.reason ? <span className="cw-verify-reason">{item.reason}</span> : null}
                  </li>
                ))}
                {contractJudge.extraLines.length > 0 ? (
                  <li className="is-extra">
                    多印且未被任何验收点用掉的行：{contractJudge.extraLines.join(' / ')}
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="cw-verify-none">
                {detailPending
                  ? '本课的练习契约还在读取：读回来之前不说「没有结构化验收点」，标记完成也先锁住。'
                  : canAutoRun
                    ? '本课没有结构化验收点（题干未给"期望输出"），标记完成记为学习者自行声明，系统不比对输出。'
                    : '外部真实环境练习无法在浏览器里比对输出：四项证据填齐只是放开按钮，标记完成仍记为学习者自行声明。'}
              </p>
            )}
          </>
        )}
      </div>

      {/* ── LEARN-01 第 4 条：六种状态逐条分开列 ────────────────────────────
          六格全部由上层从掌握度证据记录折出来（utils/lesson-evidence.ts），本组件既不自存
          状态也不自己看 note 猜，所以不存在「界面打了勾而记录里没有」的平行真相。
          选中与完成仍是两处独立标识：这里只陈述证据，不碰状态列的图标。

          2026-09-30 单屏化：这一块实测 332px（六格全展开的说明句），是可折叠的**参考**而非
          操作入口——默认收起来只留一行摘要，点一下展开全表。折叠用 `<details>` 而不是受控
          状态：它自带键盘与无障碍语义，收起时内容仍在 DOM 里（事实不因折叠而消失）。 */}
      <details className="cw-evidence-states">
        <summary className="cw-evidence-states-title">
          <span>本单元证据状态</span>
          <span className="cw-evidence-states-count" aria-hidden="true">
            {LESSON_STATE_ITEMS.filter((item) => (evidenceStates ?? NO_LESSON_STATES)[item.key]).length} /{' '}
            {LESSON_STATE_ITEMS.length}
          </span>
        </summary>
        <ul className="cw-evidence-state-list">
          {LESSON_STATE_ITEMS.map((item) => {
            const held = (evidenceStates ?? NO_LESSON_STATES)[item.key]
            return (
              <li key={item.key} className={held ? 'is-held' : 'is-absent'}>
                {/* 双通道：勾/横线符号 + 文字，加上下面的实线与虚线边框，不靠颜色单传 */}
                <span className="cw-evidence-state-glyph" aria-hidden="true">
                  {held ? '✓' : '—'}
                </span>
                <span className="cw-evidence-state-label">{item.label}</span>
                <span className="cw-evidence-state-meaning">{item.meaning}</span>
              </li>
            )
          })}
        </ul>
        {onMarkRead && !readMarked ? (
          <button type="button" className="subtle-button cw-mark-read" onClick={onMarkRead}>
            <BookOpen size={13} aria-hidden="true" />
            标记已阅读
          </button>
        ) : readMarked ? (
          <p className="cw-verify-none">
            已标记阅读：这一条只是阅读痕迹，不是完成证明，也不推进掌握等级。
          </p>
        ) : null}
      </details>
    </>
  )
})
