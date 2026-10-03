/**
 * 主题原文区（01 号方案 §4 目标组件表的 `LessonReader`）。
 *
 * 自 `learning-workspace-view.tsx` 原样搬来的**三种形态**，都挂在同一个原文锚点
 * `#cw-pane-reading` 上，逐条分开画，**不压成一句「没有原文」**（§4 的状态矩阵要求
 * loading / error / success 各说各话）：
 * 1. 正常态：资料库原文（`lesson.reading`）走受限 Markdown 管线渲染；
 * 2. 占位态（#105）：详情正在从内容服务读取——先替原文占住高度，并且明说
 *    「还没读到不等于这一课没有原文」（terminal109 量到的是视口 24%—78% 的回流）；
 * 3. 失败态（§4 的 error 行）：这一秒读失败了就说「读取失败 + 原因 + 重试」，
 *    不说「资料库里没有这一节」，重试也不覆盖用户已写的草稿。
 *
 * **只搬运 + 记忆化**：DOM 结构、className（`.reading-pane` / `.cw-reading-pending` /
 * `.cw-reading-error` / `.cw-reading-retry`）、文案、`aria-busy`、`role="alert"`、`id` 一字未改。
 * 三态互斥的判据仍然只看 `reading` / `detailPending` / `detailError` 三个事实，本组件不自存状态。
 */
import { memo } from 'react'
import { RotateCcw } from 'lucide-react'
import type { LessonReading } from '../../types/lesson'
import { MarkdownView } from '../../content/markdown'

type LessonReaderProps = {
  /** 主题原文；`undefined` 表示这一秒还没读到（不等于没有）。 */
  reading?: LessonReading
  /** 详情在路上：与 `detailError` 是两句话，两者互斥。 */
  detailPending: boolean
  detailError: string | null
  /** 失败后的重试动作：没有它就不画按钮（按了没用的按钮是假动作）。 */
  onRetryDetail?: () => void
}

export const LessonReader = memo(function LessonReader({
  reading,
  detailPending,
  detailError,
  onRetryDetail,
}: LessonReaderProps) {
  return (
    <>
      {reading && (
        <div className="reading-pane cw-pane" id="cw-pane-reading">
          <div className="reading-head">
            {/* 页级 h1 之下补一层 h2：原文里的 `##` 渲染成 h3，不补就是 h1 直跳 h3（axe heading-order）。 */}
            <h2 className="cw-pane-title">主题原文</h2>
            <strong>{reading.headingPath.join(' > ')}</strong>
            <em>{reading.verificationStatus}</em>
          </div>
          <MarkdownView markdown={reading.markdown} className="md-view lesson-reading" />
        </div>
      )}
      {/* #105：详情在路上的那一秒——占位区替下「没有配套代码」那句会撤回的话，并先替原文
          占住高度，免得内容落地时把下面的代码区整体推走（terminal109：视口 24%—78% 的回流）。 */}
      {!reading && detailPending && (
        <div className="reading-pane cw-pane cw-reading-pending" id="cw-pane-reading" aria-busy="true">
          <div className="reading-head">
            <h2 className="cw-pane-title">主题原文</h2>
            <span className="cw-reading-pending-text">原文与练习契约正在从内容服务读取</span>
          </div>
          <p className="cw-reading-pending-note">
            还没读到不等于这一课没有原文：详情到达前，本页不给任何「没有」的结论。
          </p>
        </div>
      )}

      {/* 01 号方案 §4 的 error 行：原文没读回来时，如果上层给回了失败原因，就说「读失败 + 原因 + 重试」。
          占位高度沿用 pending 那一档，重试期间不塌（免得内容落地再把代码区整体推走）。 */}
      {!reading && !detailPending && detailError && (
        <div className="reading-pane cw-pane cw-reading-error" id="cw-pane-reading" role="alert">
          <div className="reading-head">
            <h2 className="cw-pane-title">主题原文</h2>
            <span className="cw-reading-error-label">读取失败</span>
          </div>
          <p className="cw-reading-error-reason">{detailError}</p>
          <p className="cw-reading-error-note">
            这一课没有显示原文，是因为上面这次读取失败了，不是因为资料库里没有这一节。
            你已写的草稿不会因重试被覆盖。
          </p>
          {onRetryDetail && (
            <button type="button" className="subtle-button cw-reading-retry" onClick={onRetryDetail}>
              <RotateCcw size={13} aria-hidden="true" />
              重试读取原文
            </button>
          )}
        </div>
      )}
    </>
  )
})
