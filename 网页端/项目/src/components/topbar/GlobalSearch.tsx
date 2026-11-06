/**
 * 全局搜索（01 号方案 §4 组件拆分表里的 `GlobalSearch`）。
 *
 * 从 `app/src/components/topbar.tsx` 整块**原样搬来**：DOM 结构、className、文案、
 * `aria-*`、`id="global-search-list"`、`/` 快捷键与 ↑↓/Enter/Esc 的事件顺序一律未改；
 * 搬动过程中原有中文注释逐行跟着代码走（那些注释是审计留痕，不是可丢的样板话）。
 *
 * 记忆化：搜索自己的三段状态（query / open / activeIndex）本来就关在本组件里，
 * 拆分后用 `memo` 包住，通知面板、账户菜单、快捷动作改状态时不再连带重渲染结果行。
 */
import { memo, useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { filterTargets, type SearchTarget } from '../../utils/search'

/* ------------------------------ 全局搜索 ---------------------------------- */

export type GlobalSearchProps = {
  targets: SearchTarget[]
  recentViews: { id: string; label: string }[]
  onPickLesson: (lessonId: string) => void
  onPickChallenge: (challengeId: string) => void
  onPickProject: (projectId: string) => void
  onNavigateRecent: (viewId: string) => void
}

export const GlobalSearch = memo(function GlobalSearch({
  targets,
  recentViews,
  onPickLesson,
  onPickChallenge,
  onPickProject,
  onNavigateRecent,
}: GlobalSearchProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listId = 'global-search-list'

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const typing =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
      if (event.key === '/' && !typing) {
        event.preventDefault()
        setOpen(true)
        inputRef.current?.focus()
      }
    }
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [])

  const results = filterTargets(targets, query)
  const showRecent = query.trim() === ''
  const rows: { key: string; typeLabel: string; label: string; sub: string; activate: () => void }[] = showRecent
    ? recentViews.map((item) => ({
        key: `recent-${item.id}`,
        typeLabel: '最近',
        label: item.label,
        sub: '最近访问的页面',
        activate: () => onNavigateRecent(item.id),
      }))
    : results.map((result) => ({
        key: `${result.type}-${result.id}`,
        typeLabel: result.type === 'lesson' ? '课程' : result.type === 'challenge' ? '挑战' : '项目',
        label: result.title,
        // 命中别名时说明「为什么匹配」：资料库主题名与课程标题常常不同
        sub: result.matchedIn === 'alias' && result.matchedAlias
          ? `${result.subtitle} · 匹配主题「${result.matchedAlias}」`
          : result.subtitle,
        activate: () => {
          if (result.type === 'lesson') {
            onPickLesson(result.id)
            return
          }
          if (result.type === 'challenge') {
            onPickChallenge(result.id)
            return
          }
          onPickProject(result.id)
        },
      }))

  const activateRow = (index: number) => {
    const row = rows[index]
    if (!row) return
    row.activate()
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }

  const handleInputKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      // 先把焦点要住、再收面板：输入框的 onFocus 写着 setOpen(true)（见 :247），
      // 顺序反过来就是「Esc 关掉 → focus 事件又打开」，焦点还照样掉回 body。
      // 原先这里是 blur()，浏览器实测 Esc 之后焦点落在 body，而同一个顶栏里
      // 通知面板与账户菜单（:311 / :409）都会把焦点还给触发控件 —— 三处统一成「焦点留在原控件」。
      inputRef.current?.focus()
      setOpen(false)
      return
    }
    if (!open || rows.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % rows.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => (current - 1 + rows.length) % rows.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      activateRow(activeIndex)
    }
  }

  /**
   * 键盘离开搜索区就收面板。面板是 `onFocus` 打开的，而关闭此前只有三条路：Esc、
   * 点面板外（mousedown）、选中一条结果——**Tab 走出去不在其中**。于是纯键盘用户
   * 只要 Tab 过搜索框，listbox 就一直挂在页面上盖住内容，直到他用一次鼠标。
   * 01 号方案 §5「弹层焦点进出正确」要的就是这一条；实测出处是 terminal113 的
   * writeback「绑定 + 有数据」200% 那一格：整页 Tab 只走了 3 站就判「绕回一圈」，
   * stop-0 截图上正挂着上一格留下的搜索面板。
   * `relatedTarget` 是焦点要去的那个节点；还在本区内（输入框 ↔ 结果行之间移动）不收。
   */
  const handleWrapBlur = (event: React.FocusEvent) => {
    const next = event.relatedTarget as Node | null
    if (wrapRef.current && !wrapRef.current.contains(next)) setOpen(false)
  }

  return (
    <div className="global-search" ref={wrapRef} onBlur={handleWrapBlur}>
      <Search size={14} className="global-search__icon" aria-hidden="true" />
      <input
        ref={inputRef}
        className="global-search__input"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && rows[activeIndex] ? `gs-row-${activeIndex}` : undefined}
        aria-label="全局搜索课程、挑战与项目"
        aria-keyshortcuts="/"  /* 与下方 useEffect 里注册的 / 聚焦搜索同一通道 */
        placeholder="搜索课程 / 挑战 / 项目"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
          setActiveIndex(0)
        }}
        onKeyDown={handleInputKeyDown}
      />
      {open && (
        <div className="global-search__panel" role="listbox" id={listId} aria-label="搜索结果">
          {rows.length === 0 && !showRecent && (
            <div className="global-search__empty">
              没有匹配的结果
              <button className="subtle-button" onClick={() => setQuery('')}>
                清除搜索
              </button>
            </div>
          )}
          {rows.map((row, index) => (
            <button
              key={row.key}
              id={`gs-row-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`global-search__row ${index === activeIndex ? 'active' : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => activateRow(index)}
            >
              <span className="global-search__type">{row.typeLabel}</span>
              <span className="global-search__label">{row.label}</span>
              <span className="global-search__sub">{row.sub}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
