/**
 * 一句说明「为什么现在按不动」（01 号方案 §4 的 disabled 行：说明禁用条件，不能只降低透明度）。
 *
 * 改版前共享层 `styles.css` 的 `.subtle-button:disabled / .primary-action:disabled` 只有
 * `opacity:.5`：按钮名字被压到读不出，界面也从没说什么条件下才解禁。写回页有三颗按钮会
 * 因不同原因禁用（正在提交 / 没勾选项 / 当前账户不是拥有者 / 没确认预览），原来全都只
 * 表现为「变淡」——三种不同的事实压成同一种灰就是假信息。
 *
 * 形态与账户域（account-security-view / profile-view）、资料库绑定面板一致：
 * `disabled` 属性照旧保留（真的点不动），另加一句**渲染出来的真实文字**，
 * 用 `aria-describedby` 从按钮指过来。刻意不挂 `role="status"`：条件说明是静态文字，
 * 同一屏的播报权属于结果那一行（写入结果 / 失败原因），多一个活区域只会互相抢播报。
 */
export type EwbDisabledHintProps = {
  id: string
  /** 未满足的条件文案；空数组代表「现在能点」，那时整块不渲染 */
  reasons: string[]
}

export function EwbDisabledHint({ id, reasons }: EwbDisabledHintProps) {
  if (reasons.length === 0) return null
  return (
    <p className="ewb-disabled-hint" id={id}>
      <span className="ewb-disabled-hint-lead">现在按不了：</span>
      {reasons.map((reason, index) => (
        <span key={reason} className="ewb-disabled-hint-line">
          {index > 0 ? <span aria-hidden="true">；</span> : null}
          {reason}
        </span>
      ))}
    </p>
  )
}

/**
 * 按钮该带的可访问性属性：禁用时把说明指过去；可点时**什么都不加**——
 * 留一个恒为 false 的 `aria-disabled` 或空的 `aria-describedby` 都是给读屏添噪声。
 */
export function ewbDisabledProps(disabled: boolean, hintId: string) {
  return disabled ? { 'aria-disabled': true as const, 'aria-describedby': hintId } : {}
}
