/**
 * 双链目标解析与放行判定（DATA-10 §4「双链指向合法课程/主题或提示未发布」）。
 *
 * 候选集由**内容快照**适配出的 Lesson 提供（走 adapter，确保字段口径与真实
 * Provider 一致）；这里断言两件事：
 * 1. 已发布目标能定位到 contentId（标题 / 库内相对路径 / 别名 / contentId / 章节锚点）；
 * 2. 未发布、不唯一、以及危险与越界目标一律不给跳转，并且给出可读理由。
 */
import { describe, expect, it } from 'vitest'
import { snapshotSummaryToLesson } from './adapter'
import type { SnapshotLesson } from './types'
import {
  buildWikiLinkIndex,
  publishedWikiLinkCandidates,
  rejectReasonFor,
  resolveWikiLink,
  splitWikiLink,
} from './wikilink'
import type { WikiLinkCandidate } from './wikilink'

function summary(over: Partial<SnapshotLesson> & { contentId: string }): SnapshotLesson {
  const base: SnapshotLesson = {
    contentId: over.contentId,
    primaryTopicId: `topic-${over.contentId}`,
    title: over.title ?? over.contentId,
    subject: 'C',
    language: 'c',
    objective: '',
    lessonKind: 'reading',
    stageIds: [],
    prerequisiteRefs: [],
    exerciseIds: [],
    projectTaskRef: null,
    runEnvironment: 'teaching',
    executionPolicy: 'teaching',
    estimatedMinutes: null,
    reviewOffsetsDays: null,
    verificationStatus: '外部未复核',
    sourceIds: [],
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

/** 三篇已发布主题（形状取自真实目录摘要：只有标题与库内相对路径，没有磁盘路径）。 */
const lessons = [
  summary({
    contentId: 'cw-c-001',
    title: 'C 语言基础',
    sourcePath: '复习大纲/01-编程语言/C/C语言基础.md',
    sourceHeadingPath: ['复习大纲', 'C 语言基础'],
  }),
  summary({
    contentId: 'cw-java-001',
    title: 'Java 核心基础',
    sourcePath: '复习大纲/01-编程语言/Java/Java核心基础.md',
    sourceHeadingPath: ['复习大纲', 'Java 核心基础'],
  }),
  summary({
    contentId: 'cw-c-002',
    title: 'C 语言基础',
    subject: 'C++',
    sourcePath: '复习大纲/08-C++与数据结构算法/C 语言基础.md',
    sourceHeadingPath: ['复习大纲', 'C++', 'C 语言基础'],
  }),
].map(snapshotSummaryToLesson)

const candidates = publishedWikiLinkCandidates(lessons)
const index = buildWikiLinkIndex(candidates)

function resolve(raw: string) {
  return resolveWikiLink(raw, index)
}

describe('双链候选集只来自内容快照', () => {
  it('收录 contentId / 标题 / 库内相对路径 / 标题链，且不含任何磁盘路径', () => {
    expect(candidates.map((item) => item.contentId)).toEqual(['cw-c-001', 'cw-java-001', 'cw-c-002'])
    const first: WikiLinkCandidate | undefined = candidates[0]
    expect(first?.sourcePath).toBe('复习大纲/01-编程语言/C/C语言基础.md')
    expect(first?.headingPath).toEqual(['复习大纲', 'C 语言基础'])
    for (const candidate of candidates) {
      expect(candidate.sourcePath).not.toMatch(/^[A-Za-z]:[\\/]/)
      expect(candidate.sourcePath).not.toContain('..')
    }
  })

  it('旧内置课程（legacy，无 contentId）不进入候选集', () => {
    const legacyOnly = publishedWikiLinkCandidates([{ contentId: undefined, legacy: true } as never])
    expect(legacyOnly).toEqual([])
  })
})

describe('双链命中已发布内容', () => {
  it('按标题命中：[[Java 核心基础]]', () => {
    const result = resolve('Java 核心基础')
    expect(result.kind).toBe('resolved')
    expect(result.kind === 'resolved' && result.contentId).toBe('cw-java-001')
  })

  it('按库内相对路径命中，并支持 .md 后缀；只写文件名也能定位（Obsidian 口径）', () => {
    expect(resolve('复习大纲/01-编程语言/C/C语言基础.md')).toMatchObject({ contentId: 'cw-c-001' })
    expect(resolve('复习大纲/01-编程语言/C/C语言基础')).toMatchObject({ kind: 'resolved', contentId: 'cw-c-001' })
    expect(resolve('Java核心基础')).toMatchObject({ kind: 'resolved', contentId: 'cw-java-001' })
  })

  it('别名与转义别名（表格里的 `\\|`）：显示别名，跳转仍指向目标', () => {
    expect(splitWikiLink('复习大纲/01-编程语言/C/C语言基础\\|C 语言基础')).toEqual({
      target: '复习大纲/01-编程语言/C/C语言基础',
      display: 'C 语言基础',
    })
    expect(resolve('复习大纲/01-编程语言/C/C语言基础\\|C 语言基础')).toMatchObject({
      kind: 'resolved',
      contentId: 'cw-c-001',
      display: 'C 语言基础',
    })
  })

  it('无别名时显示路径末段（不是整条长路径）', () => {
    expect(resolve('复习大纲/01-编程语言/Java/Java核心基础')).toMatchObject({ display: 'Java核心基础' })
  })

  it('按 contentId 直接命中；章节锚点必须在已发布标题链里', () => {
    expect(resolve('cw-java-001')).toMatchObject({ kind: 'resolved', contentId: 'cw-java-001' })
    expect(resolve('Java 核心基础#复习大纲 > Java 核心基础')).toMatchObject({ kind: 'resolved', contentId: 'cw-java-001' })
    expect(resolve('Java 核心基础#从未发布的章节')).toMatchObject({
      kind: 'unresolved',
      reason: '该引用指向未发布/未登记内容（章节锚点未发布）',
    })
  })

  it('同名目标不唯一时不自动择一，提示用完整路径定位', () => {
    const ambiguous = resolve('C 语言基础')
    expect(ambiguous).toMatchObject({ kind: 'unresolved' })
    expect(ambiguous.kind === 'unresolved' && ambiguous.reason).toContain('不唯一')
    // 完整路径仍可精确定位
    expect(resolve('复习大纲/08-C++与数据结构算法/C 语言基础')).toMatchObject({ kind: 'resolved', contentId: 'cw-c-002' })
  })
})

describe('未发布与未连接', () => {
  it('快照里没有的主题明确提示未发布，而不是给出死链', () => {
    const result = resolve('复习大纲/09-尚不存在的分册/未发布主题')
    expect(result).toMatchObject({ kind: 'unresolved', reason: '该引用指向未发布/未登记内容' })
    expect(result.tooltip).toContain('未发布')
  })

  it('候选集为空（未连接资料库）时判定为无法确认，而不是当作已发布', () => {
    const empty = buildWikiLinkIndex([])
    expect(resolveWikiLink('C 语言基础', empty)).toMatchObject({ kind: 'unresolved', reason: '未连接内容快照' })
  })
})

describe('危险与越界目标一律拒绝', () => {
  const dangerous: [string, string][] = [
    ['javascript:alert(1)', '协议'],
    ['data:text/html,<h1>x</h1>', '协议'],
    ['vbscript:msgbox(1)', '协议'],
    ['https://evil.example/教材.md', '协议'],
    ['file:///C:/Windows/win.ini', '协议'],
    ['C:/Windows/win.ini', '盘符'],
    ['/etc/passwd', '绝对路径'],
    ['\\\\server\\share\\x.md', '网络路径'],
    ['../../outside.md', '越界'],
    ['复习大纲/../../outside.md', '越界'],
    ['%2e%2e/%2e%2e/outside.md', '编码越界'],
    ['<script>alert(1)</script>', 'HTML 片段'],
    ['imgs<img onerror=alert(1)>', 'HTML 片段'],
    ['含\u0000空字符', '控制字符'],
    ['   ', '空目标'],
  ]

  for (const [target, label] of dangerous) {
    it(`拒绝 ${label}：[[${target.slice(0, 24)}]]`, () => {
      expect(rejectReasonFor(target), target).not.toBeNull()
      const result = resolve(target)
      expect(result.kind, target).toBe('rejected')
      expect(result.tooltip, target).not.toContain('undefined')
    })
  }

  it('换行/零宽拼出来的 javascript: 也被拒绝（判定前清不可见字符）', () => {
    expect(resolve('java\nscript:alert(1)')).toMatchObject({ kind: 'rejected' })
    expect(resolve('java\u200bscript:alert(1)')).toMatchObject({ kind: 'rejected' })
  })

  it('超长目标拒绝，避免把整段正文当路径处理', () => {
    expect(resolve(`复习大纲/${'x'.repeat(400)}`)).toMatchObject({ kind: 'rejected' })
  })

  it('被拒绝的目标不产生 contentId（前端不猜磁盘路径）', () => {
    for (const [target] of dangerous) {
      const result = resolve(target)
      expect('contentId' in result === false, target).toBe(true)
    }
  })
})
