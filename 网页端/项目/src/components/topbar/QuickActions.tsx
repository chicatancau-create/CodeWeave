/**
 * 快捷动作（01 号方案 §3.2 顶栏构成里唯一缺失的一块：「当前阶段、搜索、快捷动作、通知和账户菜单」）。
 *
 * §3.2 点名了它，界面上此前只有一个孤零零的设置图标按钮。这一组条目**全部来自上层已经存在的
 * 事实与动作**，由 props 注入：本组件不查资料库、不读掌握度记录、不派生任何学习状态，
 * 也不新增数据源（§9 禁止第二套判定口径）。三条事实的来源：
 *  —— 「继续学习」= app.tsx 的 `recommendedLesson`（当前科目里第一个还没有完成证据的课）；
 *  —— 「今日复习 N 项」= `mastery.dueReviews.length`；
 *  —— 「学习指南」= `HelpModal`。这条必须在这里有入口的真实理由：改版前 `onHelp` 只挂在
 *     `LearningWorkspaceView` 上，人不在学习工作台里就没有任何路径能打开指南（§3.2 的缺口）。
 *
 * disabled 行按 §4 的口径写：条件**说出口**（渲染成真实文字 + `aria-describedby`），
 * 不是只把按钮压灰；`disabled` 属性照旧保留，所以也不存在「按了什么都不发生」的按钮。
 *
 * 开合与焦点沿用同一个顶栏里 `AccountMenu`（`topbar/AccountMenu.tsx`）那一份写法：
 * 点击面板外 mousedown 关闭、Esc 关闭并把焦点还给触发按钮、只在 `open` 变化时重绑全局监听。
 * 不引第三方浮层库，也不自造第二套弹层机制。
 *
 * 静态面板：没有任何持续动画（§4 reduced-motion 行）。
 */
import { memo, useEffect, useRef, useState } from 'react'
import { BookOpen, CalendarClock, Play, Zap } from 'lucide-react'
import { useMenuFocus } from '../../hooks/use-menu-focus'

/* ---------------------------- 快捷动作 ------------------------------------ */

export type QuickActionsProps = {
  /**
   * 当前科目里第一个还没有完成证据的那一课（上层派生，本组件不自己算）。
   * 为 null 时「继续学习」这一条渲染成禁用，并把原因写成真实文字。
   */
  recommended: { label: string; title: string } | null
  /** 今日到期复测条数（上层 `mastery.dueReviews.length`）；0 不隐藏这一条，只改成说明文字 */
  dueCount: number
  onContinue: () => void
  onGoReviews: () => void
  onOpenHelp: () => void
}

const PANEL_ID = 'topbar-quick-actions-panel'
const CONTINUE_HINT_ID = 'topbar-quick-actions-continue-hint'
/** `recommended` 为 null 的两种真实情形（app.tsx 里那一行 `find(...) ?? null` 的两侧）。 */
const CONTINUE_DISABLED_REASON = '当前科目里找不到「还没有完成证据」的那一课：要么每一课都已有完成证据，要么资料库尚未连接。'

export const QuickActions = memo(function QuickActions({
  recommended,
  dueCount,
  onContinue,
  onGoReviews,
  onOpenHelp,
}: QuickActionsProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useMenuFocus(open)

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="topbar-quick-actions" ref={wrapRef} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
    }}>
      <button
        ref={triggerRef}
        type="button"
        className="icon-button topbar-quick-actions__trigger"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? PANEL_ID : undefined}
        aria-label="快捷动作"
      >
        <Zap size={17} aria-hidden="true" />
      </button>
      {open && (
        <div ref={menuRef} className="topbar-quick-actions__panel" id={PANEL_ID} role="menu" aria-label="快捷动作">
          <strong>快捷动作</strong>
          <button
            tabIndex={-1}
            role="menuitem"
            type="button"
            className="topbar-quick-actions__item"
            disabled={!recommended}
            aria-describedby={recommended ? undefined : CONTINUE_HINT_ID}
            onClick={() => {
              setOpen(false)
              onContinue()
            }}
          >
            <Play size={14} aria-hidden="true" />
            <span className="topbar-quick-actions__label">继续学习</span>
            {recommended && (
              <span className="topbar-quick-actions__detail">
                {`${recommended.label} · ${recommended.title}`}
              </span>
            )}
          </button>
          {!recommended && (
            <p className="topbar-quick-actions__hint" id={CONTINUE_HINT_ID}>
              {`现在按不了：${CONTINUE_DISABLED_REASON}`}
            </p>
          )}
          <button
            tabIndex={-1}
            role="menuitem"
            type="button"
            className="topbar-quick-actions__item"
            onClick={() => {
              setOpen(false)
              onGoReviews()
            }}
          >
            <CalendarClock size={14} aria-hidden="true" />
            <span className="topbar-quick-actions__label">{`今日复习 ${dueCount} 项`}</span>
            <span className="topbar-quick-actions__detail">
              {dueCount > 0 ? '到期复测排在复习中心，这里不另排一份日程' : '今天没有到期复测'}
            </span>
          </button>
          <button
            tabIndex={-1}
            role="menuitem"
            type="button"
            className="topbar-quick-actions__item"
            onClick={() => {
              setOpen(false)
              triggerRef.current?.focus()
              onOpenHelp()
            }}
          >
            <BookOpen size={14} aria-hidden="true" />
            <span className="topbar-quick-actions__label">学习指南</span>
            <span className="topbar-quick-actions__detail">不在学习工作台时，这里是「如何学习」指南的入口</span>
          </button>
        </div>
      )}
    </div>
  )
})
