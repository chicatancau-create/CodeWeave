/**
 * 账户菜单（01 号方案 §4 组件拆分表里的 `AccountMenu`）。
 *
 * 从 `app/src/components/topbar.tsx` 整块**原样搬来**：`role="menu"` + 五个 `role="menuitem"`
 * 文字入口、头像首字母、`aria-haspopup="menu"`/`aria-expanded`、Esc 关菜单并把焦点还给头像
 * 按钮、点击面板外关闭、点某项先收菜单再执行动作 —— 文案、className、`aria-*`、事件顺序一律未改。
 *
 * 记忆化：`memo` 后菜单自己的开合状态不再牵动搜索行与通知面板重渲染。
 */
import { memo, useEffect, useRef, useState } from 'react'
import { Database, FolderKanban, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import type { AuthUser } from '../../hooks/use-auth'

/* ---------------------------- 账户菜单 ------------------------------------ */

export type AccountMenuProps = {
  user: AuthUser
  onNavigateProfile: () => void
  onNavigateSecurity: () => void
  onNavigateData: () => void
  onExportData: () => void
  onLogout: () => void
}

export const AccountMenu = memo(function AccountMenu({
  user,
  onNavigateProfile,
  onNavigateSecurity,
  onNavigateData,
  onExportData,
  onLogout,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

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
    <div className="account-menu-wrap" ref={wrapRef}>
      <button
        ref={triggerRef}
        className="topbar-avatar"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="账户菜单"
      >
        {user.name.slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="account-menu" role="menu" aria-label="账户操作">
          <strong>{user.name}</strong>
          <span>{user.email ?? user.phone ?? ''}</span>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onNavigateProfile()
            }}
          >
            <UserRound size={14} aria-hidden="true" />
            个人中心
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onNavigateSecurity()
            }}
          >
            <ShieldCheck size={14} aria-hidden="true" />
            账户安全
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onNavigateData()
            }}
          >
            <Database size={14} aria-hidden="true" />
            数据与隐私
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onExportData()
            }}
          >
            <FolderKanban size={14} aria-hidden="true" />
            导出学习数据
          </button>
          <button
            role="menuitem"
            className="logout-button"
            onClick={() => {
              setOpen(false)
              onLogout()
            }}
          >
            <LogOut size={14} aria-hidden="true" />
            退出登录
          </button>
        </div>
      )}
    </div>
  )
})
