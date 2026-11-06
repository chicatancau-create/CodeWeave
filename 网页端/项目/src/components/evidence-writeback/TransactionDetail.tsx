/**
 * 单笔事务的逐步明细（06 区展开块，01 号方案 §4 的 TransactionDetail）。
 *
 * 从 `evidence-writeback-view.tsx` 整块原样搬来：这一笔的事实行（状态 / 证据条数 /
 * 服务端结论 / 回滚时间）与逐步明细表——每步「写入哪个文件、实际做了什么、
 * 落盘时间、回滚怎么处置这一步」。挂账 #35 的那句「取代原来固定的『日志已保存，进度待合并』」
 * 就落在这张表上。
 *
 * **只搬运与记忆化**：`role="region"`、`aria-label="写回事务 … 的逐步明细"`、
 * `.ewb-tx-detail` / `.ewb-table--steps` 与列标题顺序一字未改
 * （`evidence-writeback-view.ledger.test.tsx` 逐列断言，取证脚本也按 `.ewb-table--steps` 取数）。
 *
 * 这一块坏了只坏这一块：明细读不回时只有这里给出失败态与「重新读这一笔」，
 * 主面板不退回整页加载态，也不把「没读到」说成「没有步骤」。
 * 回滚入口与二次确认在 `RollbackDialog`，按原来的位置接在表格之后，DOM 顺序不变。
 */
import { memo } from 'react'
import { RefreshCw } from 'lucide-react'
import type { WritebackTransactionDetail } from '../../content/api'
import {
  kindLabel,
  stepOutcomeText,
  rollbackPlanText,
  TX_STATE_TEXT,
  type QueuePhase,
  type RollbackOutcome,
} from './ledger-model'
import { RollbackDialog } from './RollbackDialog'
import { StateMark } from './StateMark'

type TransactionDetailProps = {
  /** 展开的是哪一笔（列表行与明细区共用同一个事务号）。 */
  operationId: string
  /** 服务端读回来的这一笔明细；还没读到时为 null，只呈现加载 / 失败两态。 */
  detail: WritebackTransactionDetail | null
  detailPhase: QueuePhase
  detailFailure: string
  /** 整页的写回忙闲：读明细的重试按钮沿用同一个门槛，不在本组件另起一套。 */
  busy: boolean
  outcome: RollbackOutcome
  confirming: boolean
  rollbackBusy: boolean
  onRetryDetail: (operationId: string) => void
  onAskRollback: (operationId: string) => void
  onCancelRollback: () => void
  onConfirmRollback: (operationId: string) => void
}

export const TransactionDetail = memo(function TransactionDetail({
  operationId,
  detail,
  detailPhase,
  detailFailure,
  busy,
  outcome,
  confirming,
  rollbackBusy,
  onRetryDetail,
  onAskRollback,
  onCancelRollback,
  onConfirmRollback,
}: TransactionDetailProps) {
  return (
    <div className="ewb-tx-detail" role="region" aria-label={`写回事务 ${operationId} 的逐步明细`}>
      {detailPhase === 'loading' && (
        <p className="ewb-state ewb-state--loading">
          <StateMark tone="loading" />
          <span className="ewb-state-text">正在读回这一笔事务的逐步记录…</span>
        </p>
      )}
      {detailPhase === 'failed' && (
        <div className="ewb-state ewb-state--failed">
          <p className="ewb-state-line">
            <StateMark tone="failed" />
            <span className="ewb-state-text">读不回这一笔的明细：{detailFailure}</span>
          </p>
          <div className="evidence-actions">
            <button className="subtle-button" disabled={busy} onClick={() => void onRetryDetail(operationId)}>
              <RefreshCw size={16} aria-hidden="true" /> 重新读这一笔
            </button>
          </div>
        </div>
      )}

      {detail && (
        <>
          <p className="ewb-tx-facts">
            <span className="ewb-meta-key">状态</span>
            <span className="ewb-meta-value">{TX_STATE_TEXT[detail.state] ?? detail.state}</span>
            <span className="ewb-meta-key">证据</span>
            <span className="ewb-meta-value">{detail.evidenceCount} 条</span>
            <span className="ewb-meta-key">服务端结论</span>
            <span className="ewb-meta-value">{detail.message || '服务端没有留下结论说明（这次写回没被中断过，也没报过错）'}</span>
            {detail.rolledBackAt ? (
              <>
                <span className="ewb-meta-key">回滚时间</span>
                <span className="ewb-meta-value">{detail.rolledBackAt}</span>
              </>
            ) : null}
          </p>

          <div className="ewb-scroll" role="group" aria-label="事务逐步明细表（窄视口下可横向滚动）" tabIndex={0}>
            <table className="ewb-table ewb-table--steps">
              <caption className="sr-only">每一步写入哪个文件、实际做了什么、回滚怎么处置</caption>
              <thead>
                <tr>
                  <th scope="col">写入顺序</th>
                  <th scope="col">步骤</th>
                  <th scope="col">文件（库内相对路径）</th>
                  <th scope="col">实际做了什么</th>
                  <th scope="col">落盘时间</th>
                  <th scope="col">回滚怎么处置这一步</th>
                </tr>
              </thead>
              <tbody>
                {detail.targets.map((step, index) => (
                  <tr key={`${detail.operationId}-${step.path}`}>
                    <td className="ewb-td-num">{String(index + 1).padStart(2, '0')}</td>
                    <td>{kindLabel[step.kind] ?? step.kind}</td>
                    <td>
                      <code>{step.path}</code>
                    </td>
                    <td>{stepOutcomeText(step)}</td>
                    <td>{step.appliedAt ?? '—（没落盘就没有时间）'}</td>
                    <td>{rollbackPlanText(step)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <RollbackDialog
            detail={detail}
            outcome={outcome}
            confirming={confirming}
            rollbackBusy={rollbackBusy}
            onAskRollback={onAskRollback}
            onCancelRollback={onCancelRollback}
            onConfirmRollback={onConfirmRollback}
          />
        </>
      )}
    </div>
  )
})
