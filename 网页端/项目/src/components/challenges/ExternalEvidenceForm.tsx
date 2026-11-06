import { memo } from 'react'
import { ShieldAlert } from 'lucide-react'
import {
  EXTERNAL_EVIDENCE_ARTIFACT_MAX,
  EXTERNAL_EVIDENCE_FIELDS,
  EXTERNAL_EVIDENCE_FIELD_MAX,
  type EvidenceValidation,
  type ExternalEvidence,
} from '../../utils/external-evidence'

/* ----------------------------------------------------------------------------
   外部证据结构化表单（R4 G.3 第 2 条）：
   必填环境 / 命令 / 结果摘要 / 复现日期；日志引用可选。
   文本长度只是完整性检查的一部分，不再单独作为通过依据。
   -------------------------------------------------------------------------- */

/* 字段清单出自 utils/external-evidence.ts（外部课程表单与本页共用同一份），
   这里只留一个本地别名，免得同一份清单在两个页面各抄一遍。 */
export const EXTERNAL_FIELDS = EXTERNAL_EVIDENCE_FIELDS

function ExternalEvidenceFormView({
  challengeId,
  evidence,
  check,
  onChange,
}: {
  challengeId: string
  evidence: ExternalEvidence
  check: EvidenceValidation | undefined
  onChange: (updates: Partial<ExternalEvidence>) => void
}) {
  const issueFor = (key: keyof ExternalEvidence | 'acceptance') =>
    check?.issues.find((issue) => issue.field === key)

  return (
    <div className="external-evidence-form">
      <p className="external-evidence-hint">
        <ShieldAlert size={13} />
        结构化证据只做完整性校验；本机无法验证真实性，提交后状态为<strong>待人工确认</strong>，不计入已通过。
      </p>

      {EXTERNAL_FIELDS.map((field) => {
        const issue = issueFor(field.key)
        const value = evidence[field.key] ?? ''
        const inputId = `evidence-${challengeId}-${field.key}`
        return (
          <div key={field.key} className="external-evidence-field">
            <label className="field-label" htmlFor={inputId}>
              {field.label}
              {field.required && <span className="external-evidence-required">必填</span>}
            </label>
            {field.key === 'resultSummary' ? (
              <textarea
                id={inputId}
                className={`challenge-evidence ${issue ? 'invalid' : ''}`}
                value={value}
                onChange={(event) => onChange({ [field.key]: event.target.value })}
                placeholder={field.placeholder}
                maxLength={EXTERNAL_EVIDENCE_FIELD_MAX}
                aria-invalid={Boolean(issue)}
              />
            ) : (
              <input
                id={inputId}
                type="text"
                className={`external-evidence-input ${issue ? 'invalid' : ''}`}
                value={value}
                onChange={(event) => onChange({ [field.key]: event.target.value })}
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

      {check && check.missingKeywords.length > 0 && (
        <p className="external-evidence-keywords">
          建议在结果摘要中覆盖以下验收关键词：
          {check.missingKeywords.map((keyword) => (
            <code key={keyword}>{keyword}</code>
          ))}
        </p>
      )}
    </div>
  )
}

export const ExternalEvidenceForm = memo(ExternalEvidenceFormView)
