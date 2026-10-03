/**
 * 事务账本（06 区，挂账 #35；01 号方案 §4 的 WritebackLedger）。
 *
 * 从 `evidence-writeback-view.tsx` 整块原样搬来：账本读数、加载 / 失败 / 重读失败 /
 * 空态 / 被截断 / 读不出来的六种说法，以及每一行的「哪一次、走到哪一步、几条证据」。
 * 条目来自 `GET /api/learning/evidence-transactions`——磁盘上的事务记录而不是 React 状态，
 * 所以刷新界面后「刚才那次写回做了什么」仍然问得出。
 *
 * **只搬运与记忆化**：`aria-label="写回事务账本"`、`.ewb-tx-*` 类名、文案与 DOM 顺序一字未改。
 * 取证闸门依赖的 01 / 03 两区仍在主面板，本区不改它们的行类名与行数
 * （`tools/visual/visual-states.mjs` 数 `[aria-label="已同步记录"] .ewb-row--synced`）。
 *
 * 「读不到」与「没有」是两件事：`ledgerPhase` 说这一次读怎么样了，
 * `ledger` 说手上最可信的一份记录是什么，重读失败既不退回加载态也不清空列表。
 * 展开一笔的逐步明细与回滚入口交给 `TransactionDetail`，位置与层级不变。
 */
import { memo } from 'react'
import { History, RefreshCw } from 'lucide-react'
import type { WritebackTransactionDetail, WritebackTransactionList } from '../../content/api'
import {
  ledgerMeta,
  ledgerTone,
  type QueuePhase,
  type RollbackOutcome,
} from './ledger-model'
import { TransactionDetail } from './TransactionDetail'
import { StateMark } from './StateMark'

type WritebackLedgerProps = {
  /** 服务端账本；null 表示这一次还没读回来（不等于没有事务）。 */
  ledger: WritebackTransactionList | null
  ledgerPhase: QueuePhase
  ledgerFailure: { code: string; reason: string } | null
  /** 同一时刻只展开一笔事务的明细：逐步清单与回滚入口都挂在它下面。 */
  openTxId: string | null
  detail: WritebackTransactionDetail | null
  detailPhase: QueuePhase
  detailFailure: string
  busy: boolean
  rollbackConfirmId: string | null
  rollbackBusy: boolean
  rollbackOutcome: RollbackOutcome
  onRefreshLedger: () => Promise<void>
  onToggleTransaction: (operationId: string) => void
  onRetryDetail: (operationId: string) => void
  onAskRollback: (operationId: string) => void
  onCancelRollback: () => void
  onConfirmRollback: (operationId: string) => void
}

export const WritebackLedger = memo(function WritebackLedger({
  ledger,
  ledgerPhase,
  ledgerFailure,
  openTxId,
  detail,
  detailPhase,
  detailFailure,
  busy,
  rollbackConfirmId,
  rollbackBusy,
  rollbackOutcome,
  onRefreshLedger,
  onToggleTransaction,
  onRetryDetail,
  onAskRollback,
  onCancelRollback,
  onConfirmRollback,
}: WritebackLedgerProps) {
  const ledgerRows = ledger?.transactions ?? []
  const ledgerLoading = ledger === null && ledgerPhase === 'loading'
  const ledgerFailed = ledger === null && ledgerPhase === 'failed'
  /** 被 TRANSACTION_LIST_CAP 截掉的那几笔：如实报数量，不把这一列当成全部历史。 */
  const ledgerHiddenCount = ledger ? Math.max(0, ledger.total - ledger.transactions.length) : 0

  return (
    <section className="ewb-zone ewb-zone--ledger" aria-label="写回事务账本">
      <h5 className="ewb-zone-head">
        <span className="ewb-num" aria-hidden="true">
          06
        </span>
        <span className="ewb-zone-title">事务账本 · 服务端留下的写回记录（刷新后仍可核对）</span>
      </h5>

      <p className="ewb-tx-summary">
        {ledger === null
          ? ledgerPhase === 'failed'
            ? '条数未定：这一次没读回来'
            : '正在读取，条数未定'
          : `服务端共 ${ledger.total} 笔事务，这里列出最近 ${ledger.transactions.length} 笔（一次最多 ${ledger.capped} 笔）`}
        <button className="subtle-button" disabled={ledgerPhase === 'loading'} onClick={() => void onRefreshLedger()}>
          <RefreshCw size={16} aria-hidden="true" /> 重新读取事务账本
        </button>
      </p>

      {ledgerLoading && (
        <div className="ewb-state ewb-state--loading" aria-label="事务账本加载中">
          <p className="ewb-state-line">
            <StateMark tone="loading" />
            <span className="ewb-state-text">正在读取写回事务记录…</span>
          </p>
          <p className="ewb-skeleton" aria-hidden="true">
            <span className="ewb-skeleton-bar" />
            <span className="ewb-skeleton-bar" />
          </p>
        </div>
      )}

      {ledgerFailed && (
        <div className="ewb-state ewb-state--failed" aria-label="事务账本读取失败">
          <p className="ewb-state-line">
            <StateMark tone="failed" />
            <span className="ewb-state-text">
              读取写回事务记录失败：{ledgerFailure?.reason || '服务端未给出原因'}（错误码 {ledgerFailure?.code || 'unknown'}）
            </span>
          </p>
          <p className="ewb-state-text">这里不会被说成「还没有写回事务」：读不到不等于一笔都没有，磁盘上的记录也没因此消失。</p>
        </div>
      )}

      {/* 已经读到过、这一次重读失败：不退回加载态、不清空列表，只标出「这一次没读回来」。 */}
      {ledger !== null && ledgerPhase === 'failed' && (
        <p className="ewb-tx-reread">
          <StateMark tone="failed" />
          <span className="ewb-tx-reread-text">
            账本重读失败：{ledgerFailure?.reason || '服务端未给出原因'}（错误码 {ledgerFailure?.code || 'unknown'}）。
            下面仍是上一次读到的记录，未清空，也不代表这次读取成功。
          </span>
        </p>
      )}

      {ledger !== null && ledgerRows.length === 0 && (
        <p className="ewb-state ewb-state--empty">
          <StateMark tone="empty" />
          <span className="ewb-state-text">
            服务端还没有留下这笔账户的写回事务记录。至少预览过一次，才会在这里出现可核对的事务。
          </span>
        </p>
      )}

      {ledger !== null && ledgerHiddenCount > 0 && (
        <p className="ewb-tx-note">
        另有 {ledgerHiddenCount} 笔更早的事务没有列在这里（账本单次最多 {ledger.capped} 笔）。
          它们没有消失：知道 operationId 时仍可逐笔读回。
        </p>
      )}

      {ledger !== null && ledger.unreadable > 0 && (
        <p className="ewb-tx-note">
          另有 {ledger.unreadable} 条事务记录读不出来（记录损坏等），已从这一列里跳过——
          它们不会被当成「不存在」，请按数据目录里的事务文件人工核对。
        </p>
      )}

      {ledgerRows.length > 0 && (
        <ul className="ewb-tx-list">
          {ledgerRows.map((item) => {
            const opened = openTxId === item.operationId
            const shown = opened && detail && detail.operationId === item.operationId ? detail : null
            const outcome = rollbackOutcome && rollbackOutcome.operationId === item.operationId ? rollbackOutcome : null
            return (
              <li className="ewb-tx-item" key={item.operationId}>
                <div className="ewb-tx-row">
                  <span className="ewb-row-static">
                    <StateMark tone={ledgerTone(item)} />
                    <span className="ewb-tx-topic">{item.topic || '（这条事务没记主题）'}</span>
                    <small>{ledgerMeta(item)}</small>
                  </span>
                  <button className="subtle-button" aria-expanded={opened} onClick={() => onToggleTransaction(item.operationId)}>
                    <History size={16} aria-hidden="true" />
                    {opened ? '收起逐步明细' : '查看这一笔做了什么'}
                  </button>
                </div>

                {opened && (
                  <TransactionDetail
                    operationId={item.operationId}
                    detail={shown}
                    detailPhase={detailPhase}
                    detailFailure={detailFailure}
                    busy={busy}
                    outcome={outcome}
                    confirming={rollbackConfirmId === item.operationId}
                    rollbackBusy={rollbackBusy}
                    onRetryDetail={onRetryDetail}
                    onAskRollback={onAskRollback}
                    onCancelRollback={onCancelRollback}
                    onConfirmRollback={onConfirmRollback}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
})
