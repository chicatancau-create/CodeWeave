/**
 * 回滚入口与二次确认（挂账 #35，01 号方案 §4 的 RollbackDialog / §5「不可逆动作必须二次确认」）。
 *
 * 从 `evidence-writeback-view.tsx` 的 06 区整块原样搬来：回滚回执（含 `rollback_blocked`
 * 的逐条 blockers）、二次确认文案、以及「这一步都还没写 / 已回滚过」时的那句实话。
 * **只搬运与记忆化**：`aria-label="回滚确认"`、`.ewb-rollback-*` / `.ewb-tx-outcome*` /
 * `.ewb-tx-blockers` 类名、文案与 DOM 顺序一字未改（`evidence-writeback-view.ledger.test.tsx`
 * 与 `tools/visual/` 按这些选择器取证）。
 *
 * 两道门槛都在主面板：① 这里出现「确认回滚这一笔」之前必须先点一次「回滚这一笔写回」，
 * 二次确认没完成就不会发出 `POST /api/learning/evidence-rollback`；② 影响范围（三件事）与
 * 救不回来的那部分都写在确认文案里，事务号由所属明细区的 `aria-label` 带出。
 * 本组件不判断能不能回滚以外的任何事，也不假设回滚成功——回执文字只转述服务端给的事实。
 */
import { memo } from 'react'
import { Undo2 } from 'lucide-react'
import type { WritebackTransactionDetail } from '../../content/api'
import {
  appliedSteps,
  canRollback,
  kindLabel,
  type RollbackOutcome,
} from './ledger-model'
import { StateMark } from './StateMark'

type RollbackDialogProps = {
  /** 这一笔事务的明细：回滚入口的有无由它的状态与「确实写过几步」共同决定。 */
  detail: WritebackTransactionDetail
  /** 上一次回滚的回执，按事务留存；null 表示这一笔还没有回滚过。 */
  outcome: RollbackOutcome
  /** 停在「等待确认」的那一笔：主面板用 rollbackConfirmId 比对事务号后给出的布尔值。 */
  confirming: boolean
  rollbackBusy: boolean
  onAskRollback: (operationId: string) => void
  onCancelRollback: () => void
  onConfirmRollback: (operationId: string) => void
}

export const RollbackDialog = memo(function RollbackDialog({
  detail,
  outcome,
  confirming,
  rollbackBusy,
  onAskRollback,
  onCancelRollback,
  onConfirmRollback,
}: RollbackDialogProps) {
  return (
    <>
      {outcome && (
        <div
          className={`ewb-tx-outcome ewb-tx-outcome--${outcome.tone}`}
          role={outcome.tone === 'done' ? 'status' : 'alert'}
        >
          <StateMark
            tone={outcome.tone === 'done' ? 'rolledback' : outcome.tone === 'blocked' ? 'conflict' : 'failed'}
          />
          <span className="ewb-tx-outcome-text">{outcome.text}</span>
          {outcome.blockers && outcome.blockers.length > 0 && (
            <ul className="ewb-tx-blockers">
              {outcome.blockers.map((blocker) => (
                <li key={`${blocker.path}-${blocker.reason}`}>
                  <span className="ewb-blocker-kind">{kindLabel[blocker.kind] ?? blocker.kind}</span>
                  <code className="ewb-blocker-path">{blocker.path}</code>
                  <span className="ewb-blocker-reason">{blocker.reason}</span>
                </li>
              ))}
            </ul>
          )}
          {outcome.tone === 'blocked' && !outcome.blockers && (
            <span className="ewb-tx-outcome-extra">
              服务端这一次没带结构化 blockers，上面就是它给的全部原因——不据此编一份逐条清单。
            </span>
          )}
          <span className="ewb-tx-outcome-extra">
            上表与状态都是这次回滚请求之后重新从服务端读回的，不是界面自己推断的。
          </span>
        </div>
      )}

      {canRollback(detail) ? (
        confirming ? (
          <div className="ewb-rollback" role="group" aria-label="回滚确认">
            <p className="ewb-rollback-lead">确认要回滚这一笔写回吗？回滚会做这三件事：</p>
            <ol className="ewb-rollback-list">
              <li>把已写入、且有备份的步骤，用写入前的备份覆盖回来；</li>
              <li>把这笔事务新建的文件移出资料库——它原本不存在，没有旧内容可还原；</li>
              <li>把这笔事务用到的证据退回「待处理」，可以重新预览再写回。</li>
            </ol>
            <p className="ewb-rollback-limit">
              回滚救不回从来没写到磁盘的步骤：上面标着「未写入」的那些步本来就没有备份，回滚也不会碰它们。
              真要回滚前服务端还会再核一次文件指纹——如果 Obsidian 那边又改过，会拒绝覆盖并转人工合并。
            </p>
            <div className="evidence-actions">
              <button className="primary-action" disabled={rollbackBusy} onClick={() => void onConfirmRollback(detail.operationId)}>
                <Undo2 size={16} aria-hidden="true" /> 确认回滚这一笔
              </button>
              <button className="subtle-button" disabled={rollbackBusy} onClick={() => onCancelRollback()}>
                先不回滚
              </button>
            </div>
          </div>
        ) : (
          <div className="evidence-actions">
            <button className="subtle-button" disabled={rollbackBusy} onClick={() => onAskRollback(detail.operationId)}>
              <Undo2 size={16} aria-hidden="true" /> 回滚这一笔写回
            </button>
          </div>
        )
      ) : (
        <p className="ewb-rollback-none">
          {detail.state === 'rolled_back'
            ? '这一笔已经回滚过，没有可还原的内容了。'
            : appliedSteps(detail) === 0
              ? '这一笔一步都没写入，回滚无从谈起；要重来请直接重新预览。'
              : '这一笔的当前状态不提供回滚入口。'}
        </p>
      )}
    </>
  )
})
