/**
 * 内容来源状态与来源详情（LINK-05 / §8.2 来源详情）。
 *
 * 显示原则：
 * - 状态用通俗文案，不在常规页面暴露资料库绝对路径；
 * - 「外部未复核」等核验状态原样保留，不能显示成已验证；
 * - 未连接/未登录时明确说明当前显示的是旧内置课程，避免被当成资料库内容。
 *
 * M4 全站统一（01 号方案 §3.4 数据与来源）：
 * 来源区按 **规范主题 / 原文位置 / 核验状态 / 同步时间 / 正式事实** 五块分区，
 * 每块一行、由 1px 发丝线分开（模板 `.specs` 的 dt/dd 细线键值，geometry.md §2）。
 * 核验状态与正式事实**只转述资料库侧口径**：本文件不出现任何把「外部未复核」
 * 提升为「已核实」的映射；语义标识用「固定字符徽记 + 文字」双通道，不跟场景色。
 */
import { AlertTriangle, Database, RefreshCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { MarkdownView } from '../content/markdown'
import { useContent, useOptionalContent } from '../content/provider'
import { legacyStageLabel } from '../content/adapter'
import type { Lesson } from '../types/lesson'
import './content-source-view.css'

function stateText(state: string, vaultConfigured: boolean, vaultReason: string | null): string {
  switch (state) {
    case 'ready':
      return '资料库已连接'
    case 'scanning':
      return '正在扫描资料库'
    case 'validating':
      return '正在校验内容'
    case 'stale':
      return '资料库暂不可用，正在使用上次成功快照'
    case 'invalid':
      return '上次同步未通过校验，仍使用上一个有效快照'
    case 'unavailable':
      return vaultReason === 'missing'
        ? '未找到资料库目录'
        : vaultConfigured
          ? '资料库暂不可用'
          : '尚未配置资料库'
    default:
      return '资料库未连接'
  }
}

/** 五块分区的 dt/dd 数据；`value` 为空时由调用方给出如实的「未记录」，不猜测。 */
type SourceField = { key: string; label: string; value: string; mark?: ReactNode }

function SourceSpecs({ fields, className }: { fields: SourceField[]; className: string }) {
  return (
    <dl className={className}>
      {fields.map((field) => (
        <div className="cs-spec" key={field.key} data-cs-field={field.key}>
          <dt>{field.label}</dt>
          <dd>
            {field.mark}
            {field.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** 页面顶部的来源状态条：只说明事实，不做“已同步/已验证”的过度承诺。 */
export function ContentSourceBanner() {
  const content = useContent()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  /** 全页只挂一条来源状态条（app.tsx），所以禁用说明用一个稳定 id 即可。 */
  const busyHintId = 'content-source-busy-hint'

  const stateLine = stateText(content.state, Boolean(content.status?.vaultConfigured), content.status?.vaultReason ?? null)

  if (content.sourceKind === 'vault' && content.state === 'ready' && !content.error) {
    const fields: SourceField[] = [
      {
        key: 'topic',
        label: '规范主题',
        value: '资料库正式内容（按主题 ID 定位，标题改名不改变身份）',
      },
      {
        key: 'source',
        label: '原文位置',
        value: '按单元「来源」区的分册与章节定位；本页不显示资料库绝对路径',
      },
      {
        key: 'verification',
        label: '核验状态',
        value: `${stateLine}（逐单元核验状态见来源详情，不折算）`,
        mark: (
          <span className="cs-mark cs-mark--verified" data-cs-mark="verified">
            <span className="cs-mark-glyph" aria-hidden>
              接
            </span>
            <span className="cs-mark-text">{stateLine}</span>
          </span>
        ),
      },
      {
        key: 'sync',
        label: '同步时间',
        value: content.buildTime ? `快照构建于 ${new Date(content.buildTime).toLocaleString()}` : '快照构建时间未记录',
      },
      {
        key: 'facts',
        label: '正式事实',
        value: `快照 ${content.bundleId?.slice(0, 8) ?? '—'} · ${content.counts ? `正式内容 ${content.counts.lessons ?? 0} 条` : '计数未提供'}`,
      },
    ]
    return (
      <div className="content-source-banner cw-source ok" role="status">
        <span className="cs-banner-lead">
          <Database size={14} aria-hidden />
          {stateLine}
        </span>
        <details className="cs-facts">
          <summary className="cs-facts-summary">来源事实明细（5 项）</summary>
          <SourceSpecs fields={fields} className="cs-specs cs-specs--inline" />
        </details>
      </div>
    )
  }

  const handleSync = async () => {
    setBusy(true)
    const result = await content.sync()
    setMessage(result.message)
    setBusy(false)
  }

  /*
   * 01 号方案 §4 的 loading 行：改版前「正在读」直接落进下面那一版告警，说的是
   * 「当前显示的是旧内置课程」—— 读取中不等于旧课程，这句话在取数期间是错的。
   * 这一档只报「正在读什么」，五块分区照挂（结构同形，落地时不顶开正文），
   * 并且**不判断**当前显示的是哪一套内容。
   */
  if (content.loading || content.state === 'scanning' || content.state === 'validating') {
    const loadingFields: SourceField[] = [
      { key: 'topic', label: '规范主题', value: `资料库内容读取中（${stateLine}）` },
      { key: 'source', label: '原文位置', value: '未记录：读取完成前不给出分册与章节' },
      {
        key: 'verification',
        label: '核验状态',
        value: '读取中：本轮没有核验结论，不沿用上一轮的措辞',
        mark: (
          <span className="cs-mark cs-mark--unverified" data-cs-mark="loading">
            <span className="cs-mark-glyph" aria-hidden>
              读
            </span>
            <span className="cs-mark-text">读取中</span>
          </span>
        ),
      },
      {
        key: 'sync',
        label: '同步时间',
        value: content.buildTime
          ? `上一轮成功快照构建于 ${new Date(content.buildTime).toLocaleString()}；本次读取尚未完成`
          : '尚无成功快照记录',
      },
      {
        key: 'facts',
        label: '正式事实',
        value: '无：读取完成前不给任何来源结论，也不用 0 或猜测值占位',
      },
    ]
    return (
      <div className="content-source-banner loading cw-source" role="status" aria-busy="true" data-cs-banner="loading">
        <span className="cs-banner-lead">
          <Database size={14} aria-hidden />
          {stateLine}：正在读取教材目录，读取完成前不宣布当前显示的是哪一套内容。
        </span>
        <SourceSpecs fields={loadingFields} className="cs-specs cs-specs--inline" />
        <div className="view-skeleton__shape" aria-hidden="true">
          <span className="view-skeleton__line" />
          <span className="view-skeleton__line view-skeleton__line--short" />
        </div>
      </div>
    )
  }

  const warnFields: SourceField[] = [
    {
      key: 'topic',
      label: '规范主题',
      value: content.sourceKind === 'vault' ? '资料库主题（本次未能读取）' : '旧内置课程主题（未迁入资料库）',
    },
    { key: 'source', label: '原文位置', value: '旧 A—M 阶段口径展示，不对应资料库分册' },
    {
      key: 'verification',
      label: '核验状态',
      value: `${stateLine}：未经资料库侧核验，不显示为已核实`,
      mark: (
        <span className="cs-mark cs-mark--unverified" data-cs-mark="unverified">
          <span className="cs-mark-glyph" aria-hidden>
            待
          </span>
          <span className="cs-mark-text">{stateLine}</span>
        </span>
      ),
    },
    { key: 'sync', label: '同步时间', value: '最近一次成功同步未记录' },
    { key: 'facts', label: '正式事实', value: '当前内容不作为正式事实计入资料库统计' },
  ]

  return (
    <div className="content-source-banner warn cw-source" role="status">
      <span className="cs-banner-lead">
        <AlertTriangle size={14} aria-hidden />
        当前显示的是<strong>旧内置课程</strong>（未迁移到资料库），阶段按旧 A—M 口径展示。
        {content.error ? ` 原因：${content.error}` : ''}
        {message ? ` ${message}` : ''}
      </span>
      <details className="cs-facts">
        <summary className="cs-facts-summary">来源事实明细（5 项）</summary>
        <SourceSpecs fields={warnFields} className="cs-specs cs-specs--inline" />
      </details>
      {busy && (
        <p className="cs-disabled-hint" id={busyHintId} role="status">
          现在按不了：上一次「重试同步」还没返回，返回后这一档自动恢复可点。
        </p>
      )}
      <button
        className="subtle-button cs-btn"
        onClick={() => void handleSync()}
        disabled={busy}
        aria-disabled={busy || undefined}
        aria-describedby={busy ? busyHintId : undefined}
      >
        <RefreshCw size={13} aria-hidden />
        {busy ? '同步中…' : '重试同步'}
      </button>
    </div>
  )
}

/** 来源详情：完整分册标题、章节、材料性质、核验状态；不自动打开任意协议。 */
export function LessonSourceDetail({ lesson }: { lesson: Lesson }) {
  const [open, setOpen] = useState(false)
  /** Provider 之外也允许渲染（正文双链、独立预览）：拿不到就如实说拿不到。 */
  const content = useOptionalContent()
  if (!lesson.source || !lesson.source.path) return null
  const heading = lesson.source.headingPath.join(' > ')
  const verified = lesson.source.verificationStatus === '库内已存在'

  const fields: SourceField[] = [
    {
      key: 'topic',
      label: '规范主题',
      value: lesson.contentId
        ? `主题 ID ${lesson.contentId}${lesson.subject ? ` · 科目 ${lesson.subject}` : ''}`
        : lesson.legacy
          ? '旧内置课程：没有主题 ID，不并入资料库主题口径'
          : '未标注主题 ID',
    },
    {
      key: 'source',
      label: '原文位置',
      value: `${lesson.source.path}${heading ? `#${heading}` : ''}`,
    },
    {
      key: 'verification',
      label: '核验状态',
      value: `${lesson.source.verificationStatus}（资料库侧登记口径，本界面不改强、不折算）`,
      mark: (
        <span
          className={`cs-mark cs-mark--${verified ? 'verified' : 'unverified'}`}
          data-cs-mark={verified ? 'verified' : 'unverified'}
        >
          <span className="cs-mark-glyph" aria-hidden>
            {verified ? '存' : '外'}
          </span>
          <span className="cs-mark-text">{lesson.source.verificationStatus}</span>
        </span>
      ),
    },
    {
      key: 'sync',
      label: '同步时间',
      value: content?.buildTime
        ? `当前快照 ${content.bundleId?.slice(0, 8) ?? '—'} · 构建于 ${new Date(content.buildTime).toLocaleString()}`
        : '本组件未取到快照构建时间；见顶部来源状态条',
    },
    {
      key: 'facts',
      label: '正式事实',
      value: lesson.legacy
        ? '旧内置课程：不作为资料库正式事实'
        : '资料库快照内的正式内容（只读投影，写回需另行确认）',
    },
  ]

  return (
    <section className="lesson-source cw-source" aria-label="课程来源">
      <div className="lesson-source-head">
        <span>来源</span>
        <strong>{lesson.source.path.split('/').pop()}</strong>
        {lesson.legacy ? <em className="tag-legacy">旧内置课程</em> : <em className="tag-vault">资料库</em>}
        <em className={`tag-verification ${verified ? 'ok' : 'warn'}`}>{lesson.source.verificationStatus}</em>
      </div>

      <SourceSpecs fields={fields} className="cs-specs" />

      {lesson.source.sourceIds.length > 0 && (
        <p className="lesson-source-ids cs-meta">来源编号：{lesson.source.sourceIds.join('、')}</p>
      )}
      {lesson.content.stageId && lesson.legacy && (
        <p className="lesson-source-ids cs-meta">旧阶段口径：{legacyStageLabel(lesson.content.stageId)}（不计入 S0—S9）</p>
      )}
      <p className="cs-note">
        原文为资料库正文；本页只展示与定位，不改变任何核验结论。
        {lesson.source.contentHash ? ` 原文指纹 ${lesson.source.contentHash.slice(0, 8)}。` : ' 本单元未提供原文指纹。'}
      </p>
      <div className="lesson-source-actions">
        <button className="subtle-button cs-btn" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {open ? '收起原文' : '查看主题原文'}
        </button>
      </div>
      {open && lesson.reading && <MarkdownView markdown={lesson.reading.markdown} className="md-view lesson-reading" />}
    </section>
  )
}
