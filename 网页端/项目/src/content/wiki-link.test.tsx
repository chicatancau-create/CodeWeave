// @vitest-environment jsdom
/**
 * 双链跳转（DATA-10 §4「规范主题跳转」）。
 *
 * 用**真实 ContentProvider + 打桩 /api/content/*** 驱动，证明发布判定确实来自
 * 内容快照的 lessons 元数据（而不是前端拼磁盘路径）：
 * - 命中已发布主题：渲染成按钮；宿主给 onNavigate 时交宿主跳转；
 *   宿主没给时通过 Provider 已有的 `loadLessonDetail` 就地展开该主题原文（仍走同一套安全管线）；
 * - 未命中：明确提示「指向未发布/未登记内容」，不给可点元素；
 * - 详情读取失败：给出可读说明，不崩、不静默。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentProvider } from './provider'
import { MarkdownView } from './markdown'
import type { ContentSnapshot, SnapshotExercise, SnapshotLesson } from './types'

const sourcePath = '复习大纲/01-编程语言/Java/Java核心基础.md'

function snapshotLesson(over: Partial<SnapshotLesson> & { contentId: string; title: string }): SnapshotLesson {
  const base: SnapshotLesson = {
    contentId: over.contentId,
    primaryTopicId: `topic-${over.contentId}`,
    title: over.title,
    subject: 'Java',
    language: 'java',
    objective: '目标',
    lessonKind: 'reading',
    stageIds: ['S1'],
    prerequisiteRefs: [],
    exerciseIds: [],
    projectTaskRef: null,
    runEnvironment: 'teaching',
    executionPolicy: 'teaching',
    estimatedMinutes: 20,
    reviewOffsetsDays: null,
    verificationStatus: '外部未复核',
    sourceIds: ['SRC-COURSE-05'],
    status: 'published',
    legacyRefs: [],
    reading: null,
    exerciseCount: 0,
    sourceHash: 'h',
    sourcePath: null,
    sourceHeadingPath: null,
  }
  return { ...base, ...over }
}

const catalogLesson = snapshotLesson({
  contentId: 'cw-java-001',
  title: 'Java 核心基础',
  sourcePath,
  sourceHeadingPath: ['复习大纲', 'Java 核心基础'],
})

const catalog: ContentSnapshot = {
  bundleId: 'bundle-data10',
  schemaVersion: 1,
  buildTime: '2026-09-20T00:00:00.000Z',
  rules: { status: 'current' },
  stages: [],
  milestones: [],
  masteryLevels: [],
  hintLevels: [],
  reviewOffsetsDays: [],
  lessons: [catalogLesson],
  counts: { lessons: 1 },
}

const detailExercises: SnapshotExercise[] = []

const detailLesson = snapshotLesson({
  contentId: 'cw-java-001',
  title: 'Java 核心基础',
  sectionRefs: [{ path: sourcePath, headingPath: ['复习大纲', 'Java 核心基础'] }],
  reading: {
    path: sourcePath,
    headingPath: ['复习大纲', 'Java 核心基础'],
    headings: [{ level: 3, title: '面向对象入门', line: 1 }],
    markdown: ['### 面向对象入门', '', '| 概念 | 关键字 |', '|---|---|', '| 封装 | `private` |', '', '回指 [[C 语言基础]]，以及未发布的 [[不存在的分册]]。'].join('\n'),
    contentHash: 'c1',
    fileHash: 'f1',
    verificationStatus: '外部未复核',
  },
})

const calls: string[] = []

function stubVaultApi(options: { lessonStatus?: number } = {}) {
  return vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => ({ data }) })
      if (url === '/api/content/status') {
        return json({
          state: 'ready',
          vaultConfigured: true,
          vaultReason: null,
          bundleId: catalog.bundleId,
          buildTime: catalog.buildTime,
          publishedAt: catalog.buildTime,
          counts: catalog.counts,
          rulesStatus: 'current',
          stale: false,
          lastError: null,
          lastReport: null,
        })
      }
      if (url === '/api/learning/status') {
        return json({
          bound: false,
          isOwner: false,
          vaultId: null,
          vaultMatches: false,
          publicContent: false,
          contentAccess: { allowed: true, reason: '' },
          progressAccess: false,
          boundAt: null,
          recordCorrupt: false,
          notice: '',
        })
      }
      if (url === '/api/content/catalog') return json(catalog)
      if (url.startsWith('/api/content/lessons/')) {
        if (options.lessonStatus && options.lessonStatus >= 400) {
          return { ok: false, status: options.lessonStatus, json: async () => ({ code: 'not_found', error: '未发布的内容' }) }
        }
        return json({ lesson: detailLesson, exercises: detailExercises, stages: [] })
      }
      return { ok: false, status: 404, json: async () => ({ code: 'not_found', error: `未预置的接口：${url}` }) }
    }) as unknown as typeof fetch,
  )
}

beforeEach(() => {
  calls.length = 0
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('双链命中已发布主题', () => {
  it('渲染成可点击按钮，并且不生成任何 href', async () => {
    stubVaultApi()
    const { container } = render(
      <ContentProvider enabled>
        <MarkdownView markdown={'上一课是 [[Java 核心基础]]。'} />
      </ContentProvider>,
    )
    const button = (await screen.findByRole('button', { name: /打开已发布主题/ })) as HTMLButtonElement
    expect(button.textContent).toBe('Java 核心基础')
    expect(button.getAttribute('type')).toBe('button')
    expect(button.hasAttribute('href')).toBe(false)
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('[href]')).toBeNull()
  })

  it('宿主给了 onNavigate：把跳转交给宿主，不自行拉详情', async () => {
    stubVaultApi()
    const onNavigate = vi.fn()
    render(
      <ContentProvider enabled>
        <MarkdownView markdown={'上一课是 [[复习大纲/01-编程语言/Java/Java核心基础|Java 基础]]。'} onNavigate={onNavigate} />
      </ContentProvider>,
    )
    const button = await screen.findByRole('button', { name: /打开已发布主题/ })
    fireEvent.click(button)
    expect(onNavigate).toHaveBeenCalledWith({ contentId: 'cw-java-001', title: 'Java 核心基础' })
    await waitFor(() => expect(calls).toContain('/api/content/catalog'))
    expect(calls.some((url) => url.startsWith('/api/content/lessons/'))).toBe(false)
  })

  it('宿主没接管：用 Provider 已有的详情能力就地展开原文，表格与双链沿用同一套渲染', async () => {
    stubVaultApi()
    const { container } = render(
      <ContentProvider enabled>
        <MarkdownView markdown={'上一课是 [[Java 核心基础]]。'} />
      </ContentProvider>,
    )
    const button = await screen.findByRole('button', { name: /打开已发布主题/ })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(await screen.findByText('面向对象入门')).toBeTruthy()
    expect(calls.some((url) => url === '/api/content/lessons/cw-java-001')).toBe(true)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    // 展开的正文里：表格仍按表格渲染；未发布回指被明确提示；危险结构没有变成元素
    const preview = document.querySelector('.md-wikilink-card')
    expect(preview?.querySelector('table')?.getAttribute('role')).toBe('table')
    expect(preview?.querySelector('table code')?.textContent).toBe('private')
    expect(preview?.querySelector('.md-wikilink--unresolved')?.textContent).toContain('未发布')
    expect(preview?.querySelectorAll('.md-wikilink--target')).toHaveLength(0)
    expect(container.querySelector('script')).toBeNull()
    // 关闭后回到只显示链接文字
    fireEvent.click(screen.getByRole('button', { name: '关闭该主题的原文预览' }))
    expect(document.querySelector('.md-wikilink-card')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('详情读取失败：给出可读说明，不静默也不崩', async () => {
    stubVaultApi({ lessonStatus: 404 })
    render(
      <ContentProvider enabled>
        <MarkdownView markdown={'上一课是 [[Java 核心基础]]。'} />
      </ContentProvider>,
    )
    const button = await screen.findByRole('button', { name: /打开已发布主题/ })
    fireEvent.click(button)
    expect(await screen.findByText(/详情读取失败/)).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('button', { name: '关闭该主题的原文预览' }), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(button)
  })
})

describe('双链未命中', () => {
  it('快照里没有的主题：明确提示未发布/未登记，且不给可点元素', async () => {
    stubVaultApi()
    const { container } = render(
      <ContentProvider enabled>
        <MarkdownView markdown={'下一课见 [[复习大纲/09-未发布/不存在的分册|未发布分册]]。'} />
      </ContentProvider>,
    )
    await waitFor(() => expect(calls).toContain('/api/content/catalog'))
    await waitFor(() => {
      const hint = container.querySelector('.md-wikilink--unresolved')
      expect(hint?.textContent ?? '').toContain('该引用指向未发布/未登记内容')
    })
    const hint = container.querySelector('.md-wikilink--unresolved')
    expect(hint?.getAttribute('title')).toContain('未发布')
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('[href]')).toBeNull()
  })
})
