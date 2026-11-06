/**
 * 受限 Markdown 正文的**递归渲染出口**（DATA-10）。
 *
 * 双链展开面板需要在正文里继续走同一套安全渲染管线，但 `wiki-link.tsx` 直接
 * import `markdown.tsx` 会形成模块环（markdown → wiki-link → markdown）。
 * 因此把「渲染函数」放进这个独立 context：`markdown.tsx` 负责 provide，
 * `wiki-link.tsx` 只消费。没有 provider 时返回 null，双链面板退化为提示文案。
 */
import { createContext } from 'react'
import type { ReactNode } from 'react'

export type MarkdownRenderer = (markdown: string) => ReactNode

export const MarkdownBodyContext = createContext<MarkdownRenderer | null>(null)

/** 正文渲染的最大嵌套层级：防止自引用双链被无限展开。 */
export const MAX_MARKDOWN_DEPTH = 2
