import { useCallback, type RefObject } from 'react'
import { CodeXml, Settings, PanelsTopLeft, UserRound } from 'lucide-react'
import type { AuthUser } from '../hooks/use-auth'
import { visibleNotifications } from '../utils/notifications'
import { currentSurface, SURFACE_LABEL } from '../utils/surface'
import type { SearchTarget } from '../utils/search'
import { AccountMenu } from './topbar/AccountMenu'
import { GlobalSearch } from './topbar/GlobalSearch'
import { NotificationCenter } from './topbar/Notifications'
import { QuickActions } from './topbar/QuickActions'

/**
 * N1 顶部全局导航：面包屑 + 全局搜索 + 通知中心 + 设置 + 账户菜单。
 * 只放全局功能，不复制侧边栏的课程导航。
 *
 * §5.2「全局壳与导航」的两条硬要求在这里落地：
 *  —— 清楚的当前入口：面包屑末位是 `编号 + 页面名`，编号是真实 DOM 文本；
 *  —— 装饰不进朗读顺序（§5.3 第 6 条）：分隔斜杠 `/`、图标一律 aria-hidden，
 *     选中指示靠伪元素画；文字信息（当前页名、未读数）保留在名称里。
 */

/**
 * 01 号方案 §4 的顶栏拆分：`GlobalSearch` / `QuickActions` / `Notifications`(NotificationCenter)
 * / `AccountMenu` 四块各自落到 `app/src/components/topbar/` 下的同名文件，本文件只留
 * **壳层编排**（面包屑 + 组装 + 设置按钮 + 焦点归还那道 ref）。对外导出的组件名与
 * 原有 props 一字未改（`app.tsx` 与顶栏测试仍从 `./topbar` 具名导入 `GlobalTopbar`）；
 * 各子组件用 `memo` 包住，交给它们的内联回调在本文件里收成 `useCallback`，
 * 这样一块改状态不再连带重渲染另外三块。
 */

type GlobalTopbarProps = {
  activeArea?: 'workspace' | 'account'
  breadcrumbLabel: string
  /** 当前入口（编号来自 app.tsx 的 NAV_ITEMS 真实序号，非 CSS counter） */
  currentEntry: { index?: string; label: string }
  contextTitle?: string
  /** 设置弹层关闭后焦点回到这个按钮（B6）；由壳层持有并传入 */
  settingsTriggerRef?: RefObject<HTMLButtonElement | null>
  searchTargets: SearchTarget[]
  recentViews: { id: string; label: string }[]
  notifications: ReturnType<typeof visibleNotifications>
  onMarkAllRead: (ids: string[]) => void
  user: AuthUser
  onPickLesson: (lessonId: string) => void
  onPickChallenge: (challengeId: string) => void
  onPickProject: (projectId: string) => void
  onNavigateView: (viewId: string) => void
  onOpenSettings: () => void
  onNavigateSecurity: () => void
  onNavigateData: () => void
  onExportData: () => void
  onLogout: () => void
  /**
   * §3.2「快捷动作」——三条都是上层既有事实与动作，本组件不派生学习状态。
   * 五个 props 视为**一组**：少任一动作回调就不渲染快捷动作按钮（宁可不出现，
   * 也不画一颗按了什么都不发生的按钮）。
   */
  recommendedLesson?: { label: string; title: string } | null
  /** 今日到期复测条数（`mastery.dueReviews.length`） */
  reviewDueCount?: number
  onContinueLesson?: () => void
  onGoReviews?: () => void
  onOpenHelp?: () => void
}

export function GlobalTopbar({
  activeArea = 'workspace',
  breadcrumbLabel,
  currentEntry,
  contextTitle,
  settingsTriggerRef,
  searchTargets,
  recentViews,
  notifications,
  onMarkAllRead,
  user,
  onPickLesson,
  onPickChallenge,
  onPickProject,
  onNavigateView,
  onOpenSettings,
  onNavigateSecurity,
  onNavigateData,
  onExportData,
  onLogout,
  recommendedLesson = null,
  reviewDueCount = 0,
  onContinueLesson,
  onGoReviews,
  onOpenHelp,
}: GlobalTopbarProps) {
  // 交给 memo 子组件的回调一律收成 useCallback：身份稳定，memo 才真的省得下重渲染。
  const closeNotifications = useCallback(
    (closedIds: string[]) => {
      if (closedIds.length > 0) onMarkAllRead(closedIds)
    },
    [onMarkAllRead],
  )
  const navigateToProfile = useCallback(() => onNavigateView('profile'), [onNavigateView])

  const quickActionsWired = Boolean(onContinueLesson && onGoReviews && onOpenHelp)

  return (
    <header className="topbar">
      <button className="desktop-brand" onClick={() => onNavigateView('path')} aria-label="CodeCanvas 工作区首页">
        <span className="desktop-brand-mark"><CodeXml size={20} aria-hidden="true" /></span>
        <span>CodeCanvas</span><small>{SURFACE_LABEL[currentSurface]}</small>
      </button>
      <nav className="desktop-areas" aria-label="应用区域">
        <button aria-current={activeArea === 'workspace' ? 'page' : undefined} onClick={() => onNavigateView('path')}>
          <PanelsTopLeft size={15} aria-hidden="true" />工作区
        </button>
        <button aria-current={activeArea === 'account' ? 'page' : undefined} onClick={() => onNavigateView('profile')}>
          <UserRound size={15} aria-hidden="true" />个人中心
        </button>
      </nav>
      <nav className="breadcrumbs" aria-label="当前位置">
        <span className="breadcrumbs__trail">
          <span className="breadcrumbs__root">Code Canvas</span>
          {/* 分隔符是装饰：显式排除出朗读顺序，避免 AT 念出「Code Canvas 斜杠 挑战」 */}
          <span className="breadcrumbs__sep" aria-hidden="true">
            /
          </span>
          <span className="breadcrumbs__crumb">{breadcrumbLabel}</span>
          {contextTitle && (
            <>
              <span className="breadcrumbs__sep" aria-hidden="true">
                /
              </span>
              <span className="breadcrumbs__crumb">{contextTitle}</span>
            </>
          )}
        </span>
        <span className="breadcrumbs__sep" aria-hidden="true">
          /
        </span>
        <strong className="breadcrumbs__entry">
          {currentEntry.index && <span className="breadcrumbs__index">{currentEntry.index}</span>}
          {currentEntry.label}
        </strong>
      </nav>
      <GlobalSearch
        targets={searchTargets}
        recentViews={recentViews}
        onPickLesson={onPickLesson}
        onPickChallenge={onPickChallenge}
        onPickProject={onPickProject}
        onNavigateRecent={onNavigateView}
      />
      <div className="topbar-actions">
        {quickActionsWired && onContinueLesson && onGoReviews && onOpenHelp && (
          <QuickActions
            recommended={recommendedLesson}
            dueCount={reviewDueCount}
            onContinue={onContinueLesson}
            onGoReviews={onGoReviews}
            onOpenHelp={onOpenHelp}
          />
        )}
        <NotificationCenter
          items={notifications}
          onNavigateView={onNavigateView}
          onClose={closeNotifications}
        />
        <span className="desktop-local"><span aria-hidden="true" />本机工作空间</span>
        <button
          ref={settingsTriggerRef}
          className="icon-button"
          onClick={onOpenSettings}
          aria-label="打开设置"
        >
          <Settings size={17} aria-hidden="true" />
        </button>
        <AccountMenu
          user={user}
          onNavigateProfile={navigateToProfile}
          onNavigateSecurity={onNavigateSecurity}
          onNavigateData={onNavigateData}
          onExportData={onExportData}
          onLogout={onLogout}
        />
      </div>
    </header>
  )
}
