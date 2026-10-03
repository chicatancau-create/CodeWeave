/**
 * 通知中心（01 号方案 §4 组件拆分表里的 `Notifications`）。
 *
 * 从 `app/src/components/topbar.tsx` 整块**原样搬来**：触发按钮的无障碍名称仍带真实未读数、
 * 徽标封顶 9+、面板 `role="region"`、关闭时把可见项上报为已读、Esc 关面板并把焦点还给触发
 * 按钮、点击面板外同一套口径 —— 文案、className、`aria-*`、事件顺序一律未改，中文注释跟着走。
 *
 * 记忆化：`open` 是本组件内部状态，`memo` 后「打开通知面板」不再牵动搜索行与账户菜单重渲染。
 */
import { memo, useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { visibleNotifications } from '../../utils/notifications'

/* ---------------------------- 通知中心 ------------------------------------ */

export type NotificationCenterProps = {
  items: ReturnType<typeof visibleNotifications>
  onNavigateView: (viewId: string) => void
  /** 面板关闭时上报可见项（调用方标记已读） */
  onClose: (visibleIds: string[]) => void
}

export const NotificationCenter = memo(function NotificationCenter({
  items,
  onNavigateView,
  onClose,
}: NotificationCenterProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeAndMark = () => {
    setOpen(false)
    onClose(items.map((item) => item.id))
  }

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        if (open) closeAndMark()
        else setOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        closeAndMark()
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
    // 只在 open 变化时重绑：否则每次渲染都会注销并重新注册一对全局监听。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const KIND_LABELS: Record<string, string> = {
    'review-due': '复测',
    'challenge-passed': '挑战',
    'checkin-milestone': '打卡',
  }

  return (
    <div className="notification-wrap" ref={wrapRef}>
      <button
        ref={triggerRef}
        className="icon-button notification-trigger"
        onClick={() => (open ? closeAndMark() : setOpen(true))}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={items.length > 0 ? `通知中心（${items.length} 条未读）` : '通知中心（无未读）'}
      >
        <Bell size={17} aria-hidden="true" />
        {items.length > 0 && (
          <span className="notification-badge">
            {Math.min(items.length, 9)}
            {items.length > 9 ? '+' : ''}
          </span>
        )}
      </button>
      {open && (
        <div className="notification-panel" role="region" aria-label="通知列表">
          <div className="notification-panel-head">
            <strong>通知</strong>
            <span>{items.length} 条未读</span>
          </div>
          {items.length === 0 ? (
            <p className="notification-empty">暂无新通知。复测到期、挑战通过和打卡里程碑会出现在这里。</p>
          ) : (
            <ul className="notification-list">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    className="notification-item"
                    onClick={() => {
                      closeAndMark()
                      onNavigateView(item.kind === 'challenge-passed' ? 'challenges' : 'reviews')
                    }}
                  >
                    <span className={`notification-kind kind-${item.kind}`}>{KIND_LABELS[item.kind] ?? '通知'}</span>
                    <span className="notification-title">{item.title}</span>
                    <span className="notification-date">{item.dateKey}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
})
