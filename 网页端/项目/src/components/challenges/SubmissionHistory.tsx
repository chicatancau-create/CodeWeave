import { memo, useState } from 'react'
import { Check, CircleDashed, ClipboardCheck, Trophy, X } from 'lucide-react'
import type { AchievementObservation, ChallengeRecord } from '../../types/lesson'
import { EXECUTION_TIER_LABEL } from '../../types/lesson'
import { judgeModeLabel } from '../../engine/challenge-judge'
import { OBSERVATION_OPTIONS, submissionPhase } from './challenge-model'

type SubmissionHistoryProps = {
  challengeId: string
  record: ChallengeRecord | undefined
  /** R4 人工复核：由上层把 hook 的 verifySubmission / rejectSubmission 原样递进来（未接上时不画按钮） */
  onVerifySubmission: ((challengeId: string, observation?: AchievementObservation) => void) | undefined
  onRejectSubmission: ((challengeId: string) => void) | undefined
}

function SubmissionHistoryPanel({
  challengeId,
  record,
  onVerifySubmission,
  onRejectSubmission,
}: SubmissionHistoryProps) {
  const { passedRecord, submittedRecord } = submissionPhase(record)

  /**
   * 人工复核时可选的学习状态标注。面板在详情视图里会换题复用（全局搜索直接改选中关卡），
   * 所以按题切换时清掉——把上一题的标注带给下一题就是假证据。
   */
  const [observation, setObservation] = useState<AchievementObservation | ''>('')
  const [observedChallengeId, setObservedChallengeId] = useState(challengeId)
  if (observedChallengeId !== challengeId) {
    setObservedChallengeId(challengeId)
    setObservation('')
  }

  return (
    <section className="challenge-zone challenge-zone--submitted" aria-label="已提交记录">
      <header className="challenge-zone-head">
        <span className="challenge-zone-no" aria-hidden="true">
          02
        </span>
        <h3 className="challenge-zone-title">已提交记录</h3>
        <span className="challenge-zone-scope">已写入学习进度 · 不随上面的草稿改变</span>
      </header>

      {passedRecord && record ? (
        <p className="challenge-done-note">
          <Trophy size={12} aria-hidden="true" />
          <span className="challenge-mark-label">已通过</span>
          <span>已于 {new Date(record.completedAt).toLocaleDateString('zh-CN')} 通过</span>
        </p>
      ) : submittedRecord && record ? (
        <p className="challenge-pending-note" role="status">
          <ClipboardCheck size={12} aria-hidden="true" />
          <span className="challenge-mark-label">待确认</span>
          <span>已于 {new Date(record.completedAt).toLocaleDateString('zh-CN')} 提交，待人工确认（未计入已通过）</span>
        </p>
      ) : record ? (
        <p className="challenge-submitted-none">
          <CircleDashed size={12} aria-hidden="true" />
          <span className="challenge-mark-label">未通过</span>
          <span>该关卡留有记录，但未计入已通过；可继续修改草稿后重新提交。</span>
        </p>
      ) : (
        <p className="challenge-submitted-none">
          <CircleDashed size={12} aria-hidden="true" />
          <span className="challenge-mark-label">无记录</span>
          <span>尚无提交记录 —— 上方草稿提交后才会出现在这里。</span>
        </p>
      )}

      {/* R4 人工复核入口（LEARN-01 第 4 条）：`submitted` 这一档从前只有一行说明文字，
          全站没有任何地方能把它推到 verified / rejected —— 状态机齐、界面缺牙。
          两个按钮直接调上层的 hook 函数，本组件不自己改记录；没接上回调时整行不画。 */}
      {submittedRecord && record && onVerifySubmission && onRejectSubmission ? (
        <div className="challenge-actions challenge-verify-actions">
          <p className="challenge-verify-note">
            人工复核改的就是这条记录的状态：确认后计入「已通过」，标记不通过则退回未通过。
            两者都由人判定，系统不会因此声称已验证过外部结果。
          </p>
          <label className="field-label" htmlFor={`observation-${challengeId}`}>
            学习状态标注（可选，不参与通过判定）
            <select
              id={`observation-${challengeId}`}
              className="challenge-verify-select"
              value={observation}
              onChange={(event) => setObservation(event.target.value as AchievementObservation | '')}
            >
              <option value="">不标注</option>
              {OBSERVATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="subtle-button"
            onClick={() => onVerifySubmission(challengeId, observation === '' ? undefined : observation)}
          >
            <Check size={12} aria-hidden="true" />
            确认通过（人工复核）
          </button>
          <button type="button" className="subtle-button" onClick={() => onRejectSubmission(challengeId)}>
            <X size={12} aria-hidden="true" />
            标记不通过
          </button>
        </div>
      ) : null}

      {record?.evidence ? (
        <p className="challenge-submitted-evidence">
          <span className="challenge-submitted-evidence-label">提交内容摘要</span>
          <span className="challenge-submitted-evidence-text">{record.evidence}</span>
        </p>
      ) : null}
      {record ? (
        <p className="challenge-submitted-meta">
          执行等级：{record.tier ? EXECUTION_TIER_LABEL[record.tier] : '未记录'} · 记录时间：
          {new Date(record.completedAt).toLocaleDateString('zh-CN')}
        </p>
      ) : null}
      {/* CHAL-02 第 7 条：改版前的记录没有口径字段，界面如实说明当时怎么判的，
          不清零也不升级可信度。外部关卡的记录不经输出判定，因此不显示这一行。 */}
      {record && record.tier !== 'external' ? (
        <p className="challenge-submitted-meta">判定口径：{judgeModeLabel(record.judgeMode)}</p>
      ) : null}
    </section>
  )
}

export const SubmissionHistory = memo(SubmissionHistoryPanel)
