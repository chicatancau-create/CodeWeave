/**
 * 状态标识（§5.1 末段）：图形 + 文字双通道，写回页每一处状态都用它，不各自画一套。
 * 从 `evidence-writeback-view.tsx` 原样搬来（01 号方案 §4 拆分），DOM 与类名一字未改；
 * 四个子组件与主编排文件共用，因此包一层 memo（`tone` 是原始值，比对即够）。
 */
import { memo } from 'react'
import { STATE_MARK, type StateTone } from './ledger-model'

export const StateMark = memo(function StateMark({ tone }: { tone: StateTone }) {
  const { Icon, label } = STATE_MARK[tone]
  return (
    <span className={`ewb-mark ewb-mark--${tone}`}>
      <Icon className="ewb-mark-icon" size={16} aria-hidden="true" />
      <span className="ewb-mark-text">{label}</span>
    </span>
  )
})
