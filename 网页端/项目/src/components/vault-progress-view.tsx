/**
 * LINK-08 学习事实界面：拥有者绑定 + 正式进度只读投影。
 *
 * 展示原则（方案 §10.1）：
 * - 绑定必须由用户**显式点击**确认；界面不提示「根据昵称自动识别」这类做法。
 * - 正式进度只在拥有者这里显示；其他账户看到的是明确的未授权说明，不是空白或 0。
 * - 不确定必须保持不确定：`无法确认`、`0—1 级` 原样显示，不折算成整数。
 * - 解析不了的块显示原文 + 「结构待适配」，不显示猜测值。
 * - 环境核验日期与学习证据日期分开显示，不推导「环境齐全 = 阶段通过」。
 *
 * M4 全站统一（01 号方案 §3.4 数据页 + 02 号方案 §4 正式学习事实规则）：
 * 两个界面都按 **规范主题 / 原文位置 / 核验状态 / 同步时间 / 正式事实** 五块分区
 * （模板 `.specs` 细线键值，geometry.md §2），正式事实再用 `.ledger` 细线表格
 * （真 `<table>` + `<caption>` + `th[scope]`）表达，层次靠编号与发丝线，不靠卡片。
 * 权限语义未改动：`status.isOwner === false` 仍然在渲染任何进度**之前**返回，
 * 只读接口 `loadVaultProgress()` 也不会在非拥有者分支被调用之外的地方消费。
 *
 * 01 号方案 §4 状态矩阵（本轮补齐的两档）：绑定面板与进度卡片的 **loading** 挂同形占位
 * （取数中不 `return null`，读不到说「读不到」并给重试），**error** 按未绑定 / 无权限 /
 * 读取失败三档分开陈述且只有最后一档给重试，**disabled** 一句说明禁用条件的真实文字 +
 * `aria-disabled`，不再只靠共享层那条 `opacity:.5`。
 */
import { AlertTriangle, Database, Link2, RefreshCw, ShieldCheck, Unlink } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useContent } from '../content/provider'
import type { LearningStatus, MasteryLevel, VaultProgress } from '../content/types'
import './vault-progress-view.css'

const NOT_ESTIMATED = '本机历史活动不算作资料库掌握等级'

/** 五块分区的 dt/dd 数据；取不到的值一律显示「未记录」，不做推测。 */
type SourceField = { key: string; label: string; value: string; mark?: ReactNode }

function SourceSpecs({ fields, className }: { fields: SourceField[]; className: string }) {
  return (
    <dl className={className}>
      {fields.map((field) => (
        <div className="vp-spec" key={field.key} data-vp-field={field.key}>
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

/** 固定字符徽记 + 文字：语义状态不靠颜色单独表达（§5.1 末段）。 */
function StateMark({ tone, glyph, text }: { tone: 'ok' | 'warn' | 'unknown'; glyph: string; text: string }) {
  return (
    <span className={`vp-mark vp-mark--${tone}`} data-vp-mark={tone}>
      <span className="vp-mark-glyph" aria-hidden>
        {glyph}
      </span>
      <span className="vp-mark-text">{text}</span>
    </span>
  )
}

function levelText(level: MasteryLevel): string {
  return level.label
}

function levelTone(level: MasteryLevel): 'ok' | 'warn' | 'unknown' {
  if (level.kind === 'numeric') return 'ok'
  if (level.kind === 'range') return 'warn'
  return 'unknown'
}

/** 等级徽记的固定字符：数值档实心框、区间档虚线框、无法确认点线框（都不靠颜色）。 */
function levelGlyph(level: MasteryLevel): string {
  if (level.kind === 'numeric') return '定'
  if (level.kind === 'range') return '区'
  return '疑'
}

/** 资料库状态条上的绑定向导：未绑定时提供显式绑定入口。 */
export function VaultBindingPanel() {
  const content = useContent()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const status = content.learningStatus

  /** 禁用条件的说明文字（01 号方案 §4 disabled 行）：绑定动作进行中，三个控件都不可再用。 */
  const busyHintId = 'vault-binding-busy-hint'
  const busyHint = (
    <p className="vp-disabled-hint" id={busyHintId} role="status">
      现在不能再用：上一步绑定操作还没返回。返回后这一档自动恢复可点。
    </p>
  )

  /*
   * 01 号方案 §4 的 loading / error 两行：改版前这里是 `return null`，绑定面板在
   * 首轮读取（以及超出启动预算后的续读）期间整块塌陷，落地时把下面的问候区与阶段
   * 列表整段往上顶。现在取数中挂同形占位（自带文字 + 细线骨架，高度由 CSS 的 min-height 兜住），
   * 读不到则说「读不到」并给重试——**不把读不到说成「尚未绑定」**。
   */
  if (!status) {
    if (content.loading) {
      return (
        <div
          className="vault-binding cw-vault"
          role="group"
          aria-label="资料库拥有者绑定"
          aria-busy="true"
          data-vp-panel="loading"
        >
          <div className="vault-binding-head">
            <Link2 size={14} aria-hidden />
            <strong>正在读取资料库绑定状态…</strong>
          </div>
          <p className="vault-progress-empty vp-empty" role="status">
            绑定状态要读一次本机账户与资料库的对应关系；读取期间不显示推测出来的绑定结论，也不把这一块撤掉。
          </p>
          <div className="view-skeleton__shape" aria-hidden="true">
            <span className="view-skeleton__line" />
            <span className="view-skeleton__line view-skeleton__line--short" />
            <span className="view-skeleton__panel" />
          </div>
        </div>
      )
    }
    return (
      <div className="vault-binding cw-vault" role="group" aria-label="资料库拥有者绑定" data-vp-panel="error">
        <div className="vault-binding-head">
          <AlertTriangle size={14} aria-hidden />
          <strong>读不到资料库绑定状态</strong>
        </div>
        <p className="vault-progress-empty vp-empty" role="status">
          {`状态接口这一次没有返回绑定记录${content.error ? `：${content.error}` : '（内容服务未连接，或该项读取失败）'}。` +
            '这里不说「尚未绑定」——没读到和没有是两件事；也不会用猜测值替代。'}
        </p>
        <button className="subtle-button vp-btn" onClick={() => void content.refresh()}>
          <RefreshCw size={12} aria-hidden /> 重试读取绑定状态
        </button>
      </div>
    )
  }

  const run = async (action: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(true)
    const result = await action()
    setMessage(result.message)
    setBusy(false)
  }

  if (!status.bound) {
    return (
      <div className="vault-binding cw-vault" role="group" aria-label="资料库拥有者绑定">
        <div className="vault-binding-head">
          <Link2 size={14} aria-hidden />
          <strong>资料库拥有者尚未绑定</strong>
          <StateMark tone="unknown" glyph="待" text="未绑定" />
        </div>
        <p className="vp-lead">
          当前教材对已登录账户开放，但<strong>正式进度（当前阶段、掌握矩阵、下一步）不对任何账户开放</strong>。
          绑定后只有你选择的那个账户能看到正式进度；其他账户仍可看教材（可在绑定后放开或收紧）。
        </p>
        <details className="vp-facts">
          <summary className="vp-facts-summary">来源事实明细（5 项）</summary>
          <SourceSpecs
            className="vp-specs"
            fields={[
              { key: 'topic', label: '规范主题', value: '资料库拥有者绑定（本机账户 ↔ 资料库账户）' },
              { key: 'source', label: '原文位置', value: '绑定记录保存在应用数据目录，不写入资料库' },
              {
                key: 'verification',
                label: '核验状态',
                value: '尚未绑定：无法核验本机账户与资料库拥有者的对应关系',
                mark: <StateMark tone="unknown" glyph='待' text='未核验' />,
              },
              { key: 'sync', label: '同步时间', value: '未记录' },
              { key: 'facts', label: '正式事实', value: '正式进度不对任何账户开放（含本账户）' },
            ]}
          />
        </details>
        {busy && busyHint}
        <button
          className="primary-action vp-btn"
          disabled={busy}
          aria-disabled={busy || undefined}
          aria-describedby={busy ? busyHintId : undefined}
          onClick={() => void run(content.bindOwner)}
        >
          {busy ? '绑定中…' : '将当前账户设为资料库拥有者'}
        </button>
        {message && <small className="vault-binding-message vp-message">{message}</small>}
      </div>
    )
  }

  const boundFields: SourceField[] = [
    {
      key: 'topic',
      label: '规范主题',
      value: status.vaultId ? `资料库 ${status.vaultId} 的正式学习事实` : '资料库标识未记录',
    },
    {
      key: 'source',
      label: '原文位置',
      value: '正式进度来自资料库进度追踪文件与学习日志；本面板不显示绝对路径',
    },
    {
      key: 'verification',
      label: '核验状态',
      value: status.vaultMatches
        ? '当前连接的资料库与绑定记录一致'
        : '当前连接的资料库与绑定记录不一致（换过资料库）',
      mark: (
        <StateMark
          tone={status.vaultMatches ? 'ok' : 'warn'}
          glyph={status.vaultMatches ? '符' : '异'}
          text={status.vaultMatches ? '同库一致' : '不同库'}
        />
      ),
    },
    { key: 'sync', label: '同步时间', value: status.boundAt ? `绑定于 ${new Date(status.boundAt).toLocaleString()}` : '绑定时间未记录' },
    {
      key: 'facts',
      label: '正式事实',
      value: status.progressAccess
        ? '仅拥有者本人可读；本面板不写回、不改动任何等级'
        : '非拥有者：正式进度与学习日志不可读',
    },
  ]

  return (
    <div className="vault-binding cw-vault" role="group" aria-label="资料库拥有者绑定">
      <div className="vault-binding-head">
        <ShieldCheck size={14} aria-hidden />
        <strong>{status.isOwner ? '你是本资料库的拥有者' : '资料库已绑定拥有者'}</strong>
        <em className={`tag-verification ${status.isOwner ? 'ok' : 'warn'}`}>{status.isOwner ? '可读正式进度' : '看不到正式进度'}</em>
      </div>
      <p className="vp-lead">{status.notice}</p>
      {!status.vaultMatches && (
        <p className="vault-binding-warn vp-warn">
          <AlertTriangle size={13} aria-hidden /> 当前连接的资料库与绑定记录不是同一个（换过资料库）；正式进度不会跨库串用，请确认后再继续。
        </p>
      )}
      <details className="vp-facts">
        <summary className="vp-facts-summary">来源事实明细（5 项）</summary>
        <SourceSpecs fields={boundFields} className="vp-specs" />
      </details>
      {status.isOwner && (
        <div className="vault-binding-actions">
          {busy && busyHint}
          <label className="vault-binding-toggle vp-toggle">
            <input
              type="checkbox"
              checked={status.publicContent}
              disabled={busy}
              aria-disabled={busy || undefined}
              aria-describedby={busy ? busyHintId : undefined}
              onChange={(event) => void run(() => content.setVisibility(event.target.checked))}
            />
            允许其他已登录账户查看教材（正式进度始终仅拥有者可见）
          </label>
          <button
            className="subtle-button vp-btn"
            disabled={busy}
            aria-disabled={busy || undefined}
            aria-describedby={busy ? busyHintId : undefined}
            onClick={() => void run(content.unbindOwner)}
          >
            <Unlink size={12} aria-hidden /> 解除绑定
          </button>
        </div>
      )}
      {message && <small className="vault-binding-message vp-message">{message}</small>}
    </div>
  )
}

/** 解析结论都不等同于知识正确性核验：这条尾巴对四种状态一致适用。 */
const PARSE_SUFFIX = '；结构解析结论不等同于知识正确性核验'

/** 正式进度追踪的解析结论：只描述结构是否解析成功，不写成「已核实」。 */
function parseStatusText(progress: VaultProgress): string {
  switch (progress.status) {
    case 'ok':
      return `结构已解析（资料库侧文件口径）${PARSE_SUFFIX}`
    case 'partial':
      return `部分解析：${progress.unparsed.length} 处结构待适配，按原文展示${PARSE_SUFFIX}`
    case 'structure_unsupported':
      return `结构待适配：解析器未覆盖该文件结构，全部按原文展示${PARSE_SUFFIX}`
    default:
      return `进度追踪缺失：没有可展示的正式事实${PARSE_SUFFIX}`
  }
}

/** 快照里确实存在的三项（原文没有的项不占位、不补 0）。 */
function snapshotItems(progress: VaultProgress) {
  return [progress.snapshot.currentStage, progress.snapshot.stagePassable, progress.snapshot.mainBlocker].filter(
    (item): item is NonNullable<typeof item> => Boolean(item),
  )
}

/**
 * 「正式进度读不到」按原因分开陈述（01 号方案 §4 error 行）。
 *
 * 改版前是一句「正式进度暂不可用（未绑定、未授权或进度追踪不可读）」，三因合一：
 * 用户看完不知道自己该绑库、该换账户还是该点重试。HTTP 档位与服务端一致
 * （`server.mjs` 的 /api/learning/vault-progress：`forbidden` → 403、`owner_unbound` → 409、其余 → 503），
 * 只有读取失败那一档给重试按钮——未绑定要在上方面板显式点绑定，无权限重试也不会多出一个拥有者。
 * 本函数只做陈述，不判断「某一课/某一关算不算完成」（那套口径在 `utils/lesson-evidence.ts`，01 号方案 §9）。
 */
function unavailableNotice(
  status: LearningStatus | null,
  failure: { message: string; status: number } | null,
): { text: string; retryable: boolean } {
  if (status && !status.bound) {
    return {
      text: '未绑定：资料库拥有者还没绑定，正式进度不对任何账户开放。下一步：在上方「资料库拥有者绑定」面板里显式点一次绑定。',
      retryable: false,
    }
  }
  if (failure?.status === 403) {
    return {
      text: `无权限：进度追踪只对资料库拥有者返回内容（HTTP 403：${failure.message}）。本页下方显示的都是本机历史活动，不是资料库事实。`,
      retryable: false,
    }
  }
  if (failure?.status === 409) {
    return {
      text: `未绑定：服务端那边的拥有者绑定记录缺失或与当前资料库不符（HTTP 409：${failure.message}）。下一步：在上方绑定面板重新绑定。`,
      retryable: false,
    }
  }
  return {
    text: `读取失败：${failure?.message || '进度追踪接口没有返回内容'}${failure ? `（HTTP ${failure.status}）` : ''}。这是「读不到」，不是「没有进度」。`,
    retryable: true,
  }
}

/** 正式事实 · 快照：ledger 细线表格，编号 + 发丝线分层。 */
function SnapshotLedger({ items }: { items: ReturnType<typeof snapshotItems> }) {
  return (
    <table className="vp-ledger">
      <caption className="vp-sr-only">正式进度快照（原文口径），共 {items.length} 项</caption>
      <thead>
        <tr>
          <th scope="col" className="vp-col vp-col-num">
            次
          </th>
          <th scope="col" className="vp-col">
            事实项
          </th>
          <th scope="col" className="vp-col">
            原文值
          </th>
          <th scope="col" className="vp-col">
            证据
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, index) => (
          <tr key={item.label}>
            <th scope="row" className="vp-cell vp-cell-num">
              <span className="vp-row-idx">{String(index + 1).padStart(2, '0')}</span>
            </th>
            <td className="vp-cell">{item.label}</td>
            <td className="vp-cell vp-cell-value">{item.value || '原文未填写'}</td>
            <td className="vp-cell vp-cell-evidence">{item.evidence || '原文未填写'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** 个人中心的「资料库正式进度（只读）」卡片。 */
export function VaultProgressCard() {
  const content = useContent()
  const [progress, setProgress] = useState<VaultProgress | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  /** 失败原因按次留下（01 号方案 §4 error 行）：HTTP 状态决定这一档能不能重试。 */
  const [failure, setFailure] = useState<{ message: string; status: number } | null>(null)

  const load = useCallback(async () => {
    setState('loading')
    const result = await content.loadVaultProgress()
    if (result.ok) {
      setProgress(result.progress)
      setFailure(null)
      setState('ready')
      return
    }
    setProgress(null)
    setFailure({ message: result.message, status: result.status })
    setState('unavailable')
  }, [content])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await Promise.resolve()
      if (cancelled) return
      await load()
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  const status = content.learningStatus
  const unavailable = unavailableNotice(status, failure)
  if (status && !status.isOwner) {
    return (
      <section className="profile-overview-card cw-vault" aria-label="资料库正式进度">
        <h3 className="security-card-title">
          <Database size={14} aria-hidden /> 资料库正式进度（只读）
        </h3>
        <p className="vault-progress-empty vp-empty" role="status">
          {status.bound
            ? '未授权：正式进度与学习日志只对资料库拥有者可见。本页下方显示的都是本机历史活动，不是资料库事实。'
            : '资料库拥有者尚未绑定，正式进度暂不对任何账户开放。'}
        </p>
        <SourceSpecs
          className="vp-specs"
          fields={[
            { key: 'topic', label: '规范主题', value: '资料库正式进度（对当前账户不可见）' },
            { key: 'source', label: '原文位置', value: '未授权：不返回资料库文件路径与指纹' },
            {
              key: 'verification',
              label: '核验状态',
              value: '未授权：不显示任何核验结论',
              mark: <StateMark tone="unknown" glyph='拒' text='未授权' />,
            },
            { key: 'sync', label: '同步时间', value: '未授权：不显示同步时间' },
            { key: 'facts', label: '正式事实', value: '无：本卡片不使用 0 或猜测值占位' },
          ]}
        />
      </section>
    )
  }

  return (
    <section className="profile-overview-card cw-vault" aria-label="资料库正式进度">
      <h3 className="security-card-title">
        <Database size={14} aria-hidden /> 资料库正式进度（只读）
      </h3>

      {state === 'loading' && (
        <div className="vp-loading" data-vp-card="loading">
          <p className="vault-progress-empty vp-empty" role="status">
            正在读取进度追踪…读取期间不显示推测值，这一块保持占位不塌陷。
          </p>
          <div className="view-skeleton__shape" aria-hidden="true">
            <span className="view-skeleton__line" />
            <span className="view-skeleton__line view-skeleton__line--short" />
            <span className="view-skeleton__panel" />
          </div>
        </div>
      )}

      {state === 'unavailable' && (
        <div className="vp-loading" data-vp-card="unavailable">
          <p className="vault-progress-empty vp-empty" role="status">
            {unavailable.text}这里不会用 0 级或猜测值替代。
          </p>
          {unavailable.retryable && (
            <div className="vp-actions">
              <button className="subtle-button vp-btn" onClick={() => void load()}>
                <RefreshCw size={12} aria-hidden /> 重试读取进度
              </button>
            </div>
          )}
        </div>
      )}

      {state === 'ready' && progress && (
        <>
          <SourceSpecs
            className="vp-specs"
            fields={[
              {
                key: 'topic',
                label: '规范主题',
                value: progress.snapshot.currentStage
                  ? `${progress.snapshot.currentStage.value || '原文未填写'}（正式进度追踪文件的当前阶段口径）`
                  : '进度追踪文件未填写当前阶段',
              },
              {
                key: 'source',
                label: '原文位置',
                value: `来源：${progress.source.path} · 文件指纹 ${progress.source.fileHash.slice(0, 8)}`,
              },
              {
                key: 'verification',
                label: '核验状态',
                value: parseStatusText(progress),
                mark: (
                  <StateMark
                    tone={progress.status === 'ok' ? 'ok' : progress.status === 'partial' ? 'warn' : 'unknown'}
                    glyph={progress.status === 'ok' ? '解' : progress.status === 'partial' ? '部' : '待'}
                    text={
                      progress.status === 'ok'
                        ? '结构已解析'
                        : progress.status === 'partial'
                          ? '部分待适配'
                          : '结构待适配'
                    }
                  />
                ),
              },
              {
                key: 'sync',
                label: '同步时间',
                value: `解析于 ${progress.source.parsedAt || '未记录'}`,
              },
              { key: 'facts', label: '正式事实', value: progress.readOnlyNotice },
            ]}
          />

          {progress.header && (
            <SourceSpecs
              className="vp-specs vp-specs--dates"
              fields={[
                { key: 'structure', label: '结构维护', value: progress.header.structureUpdatedOn ?? '未记录' },
                { key: 'env', label: '环境核验', value: progress.header.environmentVerifiedOn ?? '未记录' },
                { key: 'evidence', label: '最近学习证据', value: progress.header.latestEvidenceOn ?? '未记录' },
              ]}
            />
          )}
          <p className="vp-note">
            环境核验与最近学习证据是两件不同的事实：环境齐全不代表阶段通过，本界面不由二者推导任何结论。
          </p>

          {progress.status !== 'ok' && (
            <div className="vault-progress-warn vp-warn-band" role="status">
              <AlertTriangle size={13} aria-hidden />
              <span>
                进度追踪有 {progress.unparsed.length} 处结构待适配；这些块按原文展示，不推断数值。
              </span>
            </div>
          )}

          <SnapshotLedger items={snapshotItems(progress)} />

          <h4 className="vault-progress-subtitle vp-subtitle">
            <span className="vp-subtitle-idx" aria-hidden>
              02
            </span>
            掌握矩阵（原文口径，不折算）
          </h4>
          <table className="vp-ledger">
            <caption className="vp-sr-only">
              掌握矩阵：共 {progress.mastery.rows.length} 项技能，等级按资料库原文口径显示，不折算为整数
            </caption>
            <thead>
              <tr>
                <th scope="col" className="vp-col vp-col-num">
                  次
                </th>
                <th scope="col" className="vp-col">
                  技能
                </th>
                <th scope="col" className="vp-col vp-col-level">
                  等级（原文）
                </th>
                <th scope="col" className="vp-col vp-col-state">
                  状态
                </th>
                <th scope="col" className="vp-col">
                  证据
                </th>
              </tr>
            </thead>
            <tbody>
              {progress.mastery.rows.map((row, index) => (
                <tr key={row.skill}>
                  <th scope="row" className="vp-cell vp-cell-num">
                    <span className="vp-row-idx">{String(index + 1).padStart(2, '0')}</span>
                  </th>
                  <td className="vp-cell">{row.skill}</td>
                  <td className="vp-cell vp-cell-value">{levelText(row.level)}</td>
                  <td className="vp-cell">
                    <StateMark tone={levelTone(row.level)} glyph={levelGlyph(row.level)} text={levelText(row.level)} />
                    {row.status ? <span className="vp-cell-note">{row.status}</span> : null}
                  </td>
                  <td className="vp-cell vp-cell-evidence">{row.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {progress.mastery.note && <p className="vault-progress-notice vp-note">{progress.mastery.note.replace(/^>\s?/, '')}</p>}

          <h4 className="vault-progress-subtitle vp-subtitle">
            <span className="vp-subtitle-idx" aria-hidden>
              03
            </span>
            下一步行动（原文顺序）
          </h4>
          <table className="vp-ledger">
            <caption className="vp-sr-only">
              下一步行动：共 {progress.nextActions.rows.length} 项，按资料库原文顺序列出，不重新排序
            </caption>
            <thead>
              <tr>
                <th scope="col" className="vp-col vp-col-num">
                  序
                </th>
                <th scope="col" className="vp-col">
                  行动（原文）
                </th>
                <th scope="col" className="vp-col">
                  产出
                </th>
                <th scope="col" className="vp-col vp-col-state">
                  完成状态
                </th>
              </tr>
            </thead>
            <tbody>
              {progress.nextActions.rows.map((row) => (
                <tr key={`${row.order}-${row.action}`} className={row.done ? 'vp-row-done' : undefined}>
                  <th scope="row" className="vp-cell vp-cell-num">
                    <span className="vp-row-idx">{row.order}</span>
                  </th>
                  <td className="vp-cell vp-cell-value">{row.action || row.actionRaw}</td>
                  <td className="vp-cell vp-cell-evidence">{row.deliverable || '原文未填写'}</td>
                  <td className="vp-cell">
                    <StateMark tone={row.done ? 'ok' : 'warn'} glyph={row.done ? '已' : '未'} text={row.done ? '原文标为已完成' : '原文未标完成'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {progress.unparsed.length > 0 && (
            <details className="vault-unparsed vp-unparsed">
              <summary>结构待适配的原文（{progress.unparsed.length}）</summary>
              <ul>
                {progress.unparsed.map((item) => (
                  <li key={`${item.key}-${item.reason}`}>
                    <strong>{item.key}</strong>：{item.reason}
                    {item.raw && <pre>{item.raw}</pre>}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <p className="vault-progress-notice vp-note">
            {NOT_ESTIMATED}；本卡片只读，不提供写回，也不因导入或阅读而提升任何等级。
          </p>
        </>
      )}
    </section>
  )
}
