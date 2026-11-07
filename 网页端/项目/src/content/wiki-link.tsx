/**
 * 双链组件（DATA-10）：把 `[[目标|别名]]` 从「只显示文字」升级为
 * **可跳转到已发布主题**，未发布/危险目标明确提示而不是静默死链。
 *
 * 跳转复用内容 Provider 已有的能力（`loadLessonDetail`：按 contentId 取详情），
 * 不新造路由、不写 URL、不拼磁盘路径：
 * - 宿主传了 `onNavigate` → 交给宿主（例如在工作台里打开该课）；
 * - 宿主未接管 → 就地打开「已发布主题预览卡」，正文沿用同一套受限渲染管线
 *   （见 markdown-body.ts）。预览卡用 portal 挂到 body：正文段落里的链接
 *   是行内位置，卡片含块级内容，留在段落内会产生非法 DOM 结构。
 * - 目标未发布/不唯一/未连接快照 → `md-wikilink--unresolved`，可见提示；
 * - 目标含脚本协议、绝对路径、`..` 越界等 → `md-wikilink--rejected`，只作为文本呈现。
 *
 * 输出全部是 React 文本节点与自有元素：不含 dangerouslySetInnerHTML，
 * 不生成任何 href（因此不存在 javascript:/data: 之类的可点链接）。
 * 本轮不允许改 styles.css，新元素用最小内联样式保证可读。
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Lesson } from '../types/lesson'
import { MarkdownBodyContext, MAX_MARKDOWN_DEPTH, type MarkdownRenderer } from './markdown-body'
import { useOptionalContent } from './provider'
import { buildWikiLinkIndex, publishedWikiLinkCandidates, resolveWikiLink } from './wikilink'
import type { MarkdownNavigateHandler } from './markdown'

type PreviewState = 'closed' | 'loading' | 'ready' | 'empty' | 'error'

const LINK_BUTTON_STYLE = { padding: 0, textAlign: 'inherit' as const }
const FLAG_STYLE = { marginLeft: 4, color: 'var(--muted)', fontSize: '0.85em' }
const CARD_STYLE = {
  position: 'fixed' as const,
  right: 16,
  bottom: 16,
  width: 'min(520px, calc(100vw - 32px))',
  maxHeight: '65vh',
  overflowY: 'auto' as const,
  zIndex: 55,
  padding: '12px 14px',
  border: '1px solid var(--line-strong)',
  borderRadius: 'var(--radius)',
  background: 'var(--panel)',
  boxShadow: 'var(--glow-soft)',
}
const CARD_HEAD_STYLE = { display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }
const CARD_SOURCE_STYLE = { display: 'block', marginTop: 4, color: 'var(--faint)', fontSize: '11px' }

export function WikiLink({
  raw,
  depth = 0,
  onNavigate,
}: {
  raw: string
  /** 当前嵌套层级：达到上限后不再继续套娃打开预览卡 */
  depth?: number
  onNavigate?: MarkdownNavigateHandler
}) {
  const content = useOptionalContent()
  const renderBody = useContext(MarkdownBodyContext) as MarkdownRenderer | null
  const [preview, setPreview] = useState<PreviewState>('closed')
  const [target, setTarget] = useState<Lesson | null>(null)
  /** 详情读取失败时服务端给回的原因（01 号方案 §4：error 要能读懂原因，不只是一句「失败」）。 */
  const [detailMessage, setDetailMessage] = useState<string | null>(null)
  const closeButton = useRef<HTMLButtonElement | null>(null)
  const triggerButton = useRef<HTMLButtonElement | null>(null)
  const requestVersion = useRef(0)

  // 候选集只来自内容快照（lessons 元数据）：不访问磁盘，也不猜未发布文件
  const decision = useMemo(
    () => resolveWikiLink(raw, buildWikiLinkIndex(publishedWikiLinkCandidates(content?.lessons ?? []))),
    [raw, content?.lessons],
  )

  const open = useCallback(async () => {
    if (decision.kind !== 'resolved') return
    if (onNavigate) {
      onNavigate({ contentId: decision.contentId, title: decision.title })
      return
    }
    const version = ++requestVersion.current
    setPreview('loading')
    // 详情取数现在把失败原因按次交回（content/provider.tsx 的 LessonDetailResult），
    // 这里把它显示出来：01 号方案 §4 的 error 行要求「可理解原因」，只说「读取失败」不够。
    const result = content ? await content.loadLessonDetail(decision.contentId) : null
    if (version !== requestVersion.current) return
    if (!result) {
      setDetailMessage('内容服务尚未连接（教材包未就绪）。')
      setPreview('error')
      return
    }
    if (!result.ok) {
      setDetailMessage(result.message)
      setPreview('error')
      return
    }
    setDetailMessage(null)
    setTarget(result.lesson)
    setPreview(result.lesson.reading?.markdown ? 'ready' : 'empty')
  }, [content, decision, onNavigate])

  const close = useCallback(() => {
    requestVersion.current += 1
    setPreview('closed')
    triggerButton.current?.focus()
  }, [])

  useEffect(() => () => { requestVersion.current += 1 }, [])

  const previewOpen = preview !== 'closed'
  useEffect(() => {
    if (!previewOpen) return
    closeButton.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [previewOpen, close])

  const flag = (text: string) => (
    <span className="md-wikilink-flag" style={FLAG_STYLE}>
      {text}
    </span>
  )

  if (decision.kind === 'rejected') {
    return (
      <span className="md-wikilink md-wikilink--rejected" role="note" title={decision.tooltip}>
        {decision.display}
        {flag(`（已拒绝：${decision.reason}）`)}
      </span>
    )
  }

  if (decision.kind === 'unresolved') {
    return (
      <span className="md-wikilink md-wikilink--unresolved" role="note" title={decision.tooltip}>
        {decision.display}
        {flag(`（${decision.reason}）`)}
      </span>
    )
  }

  // 就地展开有层级上限；宿主接管跳转时不受该限制
  if (!onNavigate && depth >= MAX_MARKDOWN_DEPTH) {
    return (
      <span className="md-wikilink md-wikilink--target-nested" role="note" title={`嵌套层级已达上限（${MAX_MARKDOWN_DEPTH}）`}>
        {decision.display}
        {flag(`（已达 ${MAX_MARKDOWN_DEPTH} 层，请关闭预览卡或从课程列表进入）`)}
      </span>
    )
  }

  const expanded = preview !== 'closed' && !onNavigate
  const button = (
    <button
      ref={triggerButton}
      type="button"
      className="md-wikilink md-wikilink--target"
      style={LINK_BUTTON_STYLE}
      title={decision.tooltip}
      aria-label={decision.tooltip}
      aria-expanded={expanded}
      onClick={() => void open()}
    >
      {decision.display}
    </button>
  )

  if (!expanded) return <span className="md-wikilink-host">{button}</span>

  return (
    <span className="md-wikilink-host">
      {button}
      {createPortal(
        <div className="md-wikilink-card" role="dialog" aria-modal="false" aria-label={`已发布主题：${decision.title}`} style={CARD_STYLE}>
          <div className="md-wikilink-card-head" style={CARD_HEAD_STYLE}>
            <span className="md-wikilink-card-title">{decision.title}</span>
            <button
              ref={closeButton}
              type="button"
              className="md-wikilink-card-close"
              style={LINK_BUTTON_STYLE}
              aria-label="关闭该主题的原文预览"
              onClick={close}
            >
              关闭
            </button>
          </div>
          {preview === 'loading' ? <span className="md-wikilink-card-note">正在读取该主题的已发布原文…</span> : null}
          {preview === 'error' ? (
            <span className="md-wikilink-card-note">
              该主题详情读取失败{detailMessage ? `：${detailMessage}` : ''}（快照可能已更新），请稍后重试或在课程列表中打开。
            </span>
          ) : null}
          {preview === 'empty' ? <span className="md-wikilink-card-note">该主题已发布，但快照里没有可显示的正文。</span> : null}
          {preview === 'ready' && target?.reading?.markdown ? (
            renderBody ? (
              renderBody(target.reading.markdown)
            ) : (
              <span className="md-wikilink-card-note">正文需在教材视图内渲染（缺少安全渲染上下文）。</span>
            )
          ) : null}
          {target?.source?.path ? <span className="md-wikilink-card-source" style={CARD_SOURCE_STYLE}>来源：{target.source.path}</span> : null}
        </div>,
        document.body,
      )}
    </span>
  )
}
