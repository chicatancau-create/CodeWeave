/**
 * 写回前的差异预览（04 区，01 号方案 §4 的 EvidencePreview）。
 *
 * 从 `evidence-writeback-view.tsx` 整块原样搬来：写入目标清单 / 日志追加行 /
 * 进度逐字段差异 / 被阻止的掌握提升 / 免责说明 / 确认勾选与写入入口。
 * **只搬运与记忆化**：判定口径、文案、`aria-*`、`role`、`data-*`、DOM 顺序一律不动，
 * 取证脚本（`tools/visual/visual-states.mjs` 的 `[aria-label*="差异预览"]` 一组探针）
 * 与 `.ewb-*` 细线表样式都按这些选择器同步。
 *
 * 这一区不写盘：`onCommit` 仍由主编排文件带着**预览给出的真实指纹**去提交（挂账⑤），
 * 本组件不自行决定能不能写——能不能写由「勾选确认 + 拥有者 + 非 busy」三件都在 props 里。
 */
import { memo } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { WritebackPreview, WritebackTarget } from '../../content/types'
import { kindLabel, targetState, type ExpectedHashes, type IndexPreview, type ProgressPreview } from './ledger-model'
import { StateMark } from './StateMark'
import { EwbDisabledHint, ewbDisabledProps } from './DisabledNote'

type EvidencePreviewProps = {
  /** 这一次预览的结果；为 null 时主面板不挂载本组件（与拆分前的 `{preview && …}` 同一道门槛）。 */
  preview: WritebackPreview
  /** 写回顺序与「未预览不写入」的门槛由主面板持有，这里只如实呈现与转达动作。 */
  busy: boolean
  confirmed: boolean
  isOwner: boolean
  onConfirmChange: (checked: boolean) => void
  /** 确认写入：把 operationId 与**这一批目标指纹**交回主面板提交（不在这里改指纹口径）。 */
  onCommit: (operationId: string, expectedHashes: ExpectedHashes) => void
}

export const EvidencePreview = memo(function EvidencePreview({
  preview,
  busy,
  confirmed,
  isOwner,
  onConfirmChange,
  onCommit,
}: EvidencePreviewProps) {
  const logTarget = preview.targets.find((target) => target.kind === 'log') ?? null
  const progressTarget = preview.targets.find((target) => target.kind === 'progress') ?? null
  const indexTarget = preview.targets.find((target) => target.kind === 'index') ?? null
  const progressPreview = (progressTarget?.preview as ProgressPreview | undefined) ?? undefined
  const indexPreview = (indexTarget?.preview as IndexPreview | undefined) ?? undefined
  /** 日志小节按行呈现为「追加行」，逐行带文字前缀；截断口径与改造前一致。 */
  const logLines = logTarget ? String(logTarget.preview).slice(0, 4000).split('\n') : []
  /*
   * 01 号方案 §4 的 disabled 行：这颗「确认写入」原先只在按不动时把自己压淡，
   * 三种原因（正在写 / 没勾确认 / 当前账户不是拥有者）在界面上是同一种灰。
   * 条件逐条写成真实文字；不挂 role=status——本页的播报权属于写入结果那一行。
   */
  const commitBlockers: string[] = []
  if (busy) commitBlockers.push('上一次写入请求还没返回')
  if (!confirmed) commitBlockers.push('还没勾「我已核对以上将写入的内容」')
  if (!isOwner) commitBlockers.push('当前账户不是资料库拥有者，写盘这一动作只认拥有者')

  return (
    <div className="evidence-preview ewb-preview" role="region" aria-label="差异预览（只读，尚未写盘）">
      <div className="ewb-head-row">
        <span className="ewb-num" aria-hidden="true">
          04
        </span>
        <h4 className="vault-progress-subtitle">预览（尚未写入任何文件）</h4>
        <StateMark tone="pending" />
      </div>

      <h5 className="evidence-subtitle">写入目标（指纹用于判断第三方改动）</h5>
      <div className="ewb-scroll" role="group" aria-label="写回目标清单（窄视口下可横向滚动）" tabIndex={0}>
        <table className="ewb-table ewb-table--targets">
          <caption className="sr-only">写回目标清单</caption>
          <thead>
            <tr>
              <th scope="col">序</th>
              <th scope="col">目标</th>
              <th scope="col">文件</th>
              <th scope="col">当前状态</th>
            </tr>
          </thead>
          <tbody>
            {preview.targets.map((target: WritebackTarget, index: number) => (
              <tr key={target.path}>
                <td className="ewb-td-num">{String(index + 1).padStart(2, '0')}</td>
                <td>{kindLabel[target.kind] ?? target.kind}</td>
                <td>
                  <code>{target.path}</code>
                </td>
                <td>{targetState(target)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {logTarget && (
        <>
          <h5 className="evidence-subtitle">将追加到日志的小节</h5>
          <div className="ewb-diff" role="group" aria-label="日志追加差异">
            <p className="ewb-diff-legend">
              <span className="ewb-sign ewb-sign--plus">+</span>
              <span className="ewb-diff-legend-text">新增行（整段追加，不覆盖日志已有内容）</span>
            </p>
            <div className="ewb-diff-body" role="group" aria-label="日志追加行（可横向滚动）" tabIndex={0}>
              {logLines.map((line, index) => (
                <div className="ewb-diff-line" key={`${index}-${line.slice(0, 24)}`}>
                  <span className="ewb-sign ewb-sign--plus">+</span>
                  <span className="ewb-diff-text">{line === '' ? ' ' : line}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {progressPreview && (
        <>
          <h5 className="evidence-subtitle">进度追踪的逐字段变更</h5>
          {progressPreview.edits.length === 0 ? (
            <p className="vault-progress-notice">进度追踪无需变更（日期未推进或字段已一致）。</p>
          ) : (
            <div
              className="ewb-scroll"
              role="group"
              aria-label="进度追踪逐字段差异（窄视口下可横向滚动）"
              tabIndex={0}
            >
              <table className="ewb-table ewb-table--diff">
                <caption className="sr-only">进度追踪逐字段变更</caption>
                <thead>
                  <tr>
                    <th scope="col">变更字段</th>
                    <th scope="col">写入前</th>
                    <th scope="col">写入后</th>
                  </tr>
                </thead>
                <tbody>
                  {progressPreview.edits.map((edit) => (
                    <tr key={edit.field}>
                      <td>
                        <strong>{edit.field}</strong>
                      </td>
                      <td>
                        <span className="ewb-sign ewb-sign--minus">旧 −</span>
                        <span className="evidence-before">{edit.before}</span>
                      </td>
                      <td>
                        <span className="ewb-sign ewb-sign--plus">新 +</span>
                        <span className="evidence-after">{edit.after}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {progressPreview.masteryBlocked.length > 0 && (
            <>
              <h5 className="evidence-subtitle">被阻止的掌握提升</h5>
              <ul className="evidence-blocked">
                {progressPreview.masteryBlocked.map((item) => (
                  <li key={`${item.skill}-${item.level}`}>
                    <StateMark tone="notice" />
                    <span className="ewb-li-text">
                      已阻止提升「{item.skill}」到 {item.level}：{item.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {indexPreview && (
        <p className="ewb-index-note">
          <span className="ewb-index-key">总计划索引</span>
          <span className="ewb-index-value">
            {indexPreview.changed ? `将新增一行 ${indexPreview.line}` : indexPreview.reason ?? '无需变更'}
          </span>
        </p>
      )}

      <ul className="evidence-notices">
        {preview.notices.map((notice) => (
          <li key={notice}>{notice}</li>
        ))}
      </ul>

      <label className="vault-binding-toggle ewb-confirm">
        <input type="checkbox" checked={confirmed} onChange={(event) => onConfirmChange(event.target.checked)} />
        我已核对以上将写入的内容，确认写入资料库
      </label>
      <div className="evidence-actions">
        <button
          className="primary-action"
          disabled={commitBlockers.length > 0}
          {...ewbDisabledProps(commitBlockers.length > 0, 'ewb-commit-disabled-hint')}
          onClick={() =>
            void onCommit(
              preview.operationId,
              Object.fromEntries(preview.targets.map((target) => [target.path, target.expectedHash])),
            )
          }
        >
          {busy ? <LoaderCircle className="ewb-icon-spin" size={16} aria-hidden="true" /> : null}
          {busy ? '写入中…' : '确认写入'}
        </button>
        <EwbDisabledHint id="ewb-commit-disabled-hint" reasons={commitBlockers} />
      </div>
      <p className="ewb-opid">
        <span className="ewb-opid-key">operationId</span>
        <code className="ewb-opid-value">{preview.operationId}</code>
      </p>
    </div>
  )
})
