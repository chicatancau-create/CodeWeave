/**
 * 工作台页首（01 号方案 §3.2 主工作台 / §4 目标组件表的 `WorkspaceHeader`）。
 *
 * 自 `learning-workspace-view.tsx` 原样搬来的两块：`.learning-header`（返回按钮、页级 h1 课名、
 * 等级与时长、右侧两个图标动作）与其下的分区锚点导航 `nav.cw-pane-nav`。
 * **只搬运 + 记忆化**：DOM 结构、className、文案、`aria-*` 一字未改。
 *
 * 为什么不连「课程指南」那块内容一起搬：`.lesson-guide` 挂在 `.cw-workspace` 的末尾（原文区之下），
 * 移动它会改 DOM 顺序，所以 `guideOpen` 仍由主编排文件持有，这里只按它画按钮与 `aria-expanded`。
 *
 * 导航只列真实存在的分区（`visiblePanes()` 在上层算好后传下来，锚点不会指向不存在的 id）；
 * 纯锚点跳转，无脚本、无滚动动画，320px 下仍可到达四区（§5.2 末段）。
 */
import { memo } from 'react'
import { ArrowLeft, BookOpen, CircleHelp, Code2 } from 'lucide-react'
import type { WorkspacePane } from './workspace-model'

type WorkspaceHeaderProps = {
  /** 页级 h1 的两段（`{label} · {title}`）：传字符串而不是整个 lesson，父层重渲染时本块可以不跟。 */
  label: string
  title: string
  level: string
  /** 时长那句（`lessonDurationLabel`，utils/lesson-duration.ts 的单一口径）在上层算好。 */
  durationLabel: string
  panes: readonly WorkspacePane[]
  /** 指南开合与两个页级动作：全部是上层 `useCallback` 出来的稳定引用。 */
  guideOpen: boolean
  onToggleGuide: () => void
  /**
   * 代码模式开合（上层 `useState` 的 `codeMode`）。
   * 本组件只画按钮与 `aria-pressed`，**布局的切换在 CSS 里**（`.cw-workspace.is-code-mode`）——
   * 这里不参与决定谁可见，免得同一件事有第二个说法。
   */
  codeMode: boolean
  onToggleCodeMode: () => void
  onBack: () => void
  onHelp: () => void
}

export const WorkspaceHeader = memo(function WorkspaceHeader({
  label,
  title,
  level,
  durationLabel,
  panes,
  guideOpen,
  onToggleGuide,
  codeMode,
  onToggleCodeMode,
  onBack,
  onHelp,
}: WorkspaceHeaderProps) {
  return (
    <>
      <div className="learning-header">
        <button className="back-button" onClick={onBack} aria-label="返回课程列表">
          <ArrowLeft size={16} />
          返回
        </button>
        <div className="learning-title">
          {/* #77：工作台从前没有任何标题元素，页级 h1 一直靠壳层问候语代持——现在课名就是本页的文档标题。 */}
          <h1>
            {label} · {title}
          </h1>
          <span>
            {level} · {durationLabel}
          </span>
        </div>
        <div className="learning-header-actions">
          {/* 代码模式：本页唯一的「换一种摆法」入口。用 `aria-pressed` 而不是 `aria-expanded`
              ——它按下的是一块区域的**布局状态**，不是展开/收起某一段被隐藏的内容
              （隐藏的那几块在代码模式下是整体离场的，不是折叠的）。
              文字按钮而不是图标按钮：这个动作的后果（整页重排）靠一个图标说不清。 */}
          <button
            className={`cw-mode-toggle ${codeMode ? 'is-on' : ''}`}
            onClick={onToggleCodeMode}
            aria-pressed={codeMode}
            aria-label="代码模式：左边写代码，右边看画布"
          >
            <Code2 size={15} />
            {/* 文字包一层 span：≤640px 档把它收进图标（按钮仍带 aria-label，
                读屏拿到的照旧是完整动作名）。包着而不是裸文本节点，才有一个能被
                媒体查询命中的钩子——裸文本节点没法单独隐藏。 */}
            <span>{codeMode ? '退出代码模式' : '代码模式'}</span>
          </button>
          <button
            className={`icon-button ${guideOpen ? 'active' : ''}`}
            onClick={onToggleGuide}
            aria-label="课程指南"
            aria-expanded={guideOpen}
          >
            <BookOpen size={17} />
          </button>
          <button className="icon-button" onClick={onHelp} aria-label="查看学习指南">
            <CircleHelp size={17} />
          </button>
        </div>
      </div>

      {/* 分区入口：细线 + 编号，纯锚点跳转（无脚本、无滚动动画），320px 下仍可到达四区。 */}
      <nav className="cw-pane-nav" aria-label="工作台分区导航">
        <ol>
          {panes.map((pane, index) => (
            <li key={pane.id}>
              <a href={`#${pane.id}`}>
                <span className="cw-pane-no" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                {pane.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </>
  )
})
