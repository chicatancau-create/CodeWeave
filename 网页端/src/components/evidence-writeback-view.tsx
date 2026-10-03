/**
 * 学习证据写回界面（LINK-09，02 号方案 §7 写回）。
 *
 * 交互顺序与文案严格对应方案：
 * 1. 暂存证据 → 明确写着「尚未修改资料库任何文件」；
 * 2. 预览 → 展示将写入的日志小节与进度逐字段差异，**不写盘**；
 * 3. 用户勾选确认后才提交；冲突时展示逐字段差异，不按时间戳覆盖；
 * 4. 部分成功如实显示「日志已保存，进度待合并」并提供重试；
 * 5. 未写回或离线可导出待保存 Markdown，导出不等于已同步。
 *
 * M3 视觉竖切（§5.2「证据回写」）只改呈现，不改判定：
 * - 细线差异预览：目标清单 / 日志追加 / 进度逐字段 / 冲突逐字段一律走 ledger·specs 式
 *   1px 发丝线表（模板 site.css L287-L307、L361-L379），黑场无卡片无投影（§5.1 形态行）；
 * - 「待处理 / 部分成功 / 已同步」拆成三个独立区块，条目级也用同一套状态标识；
 * - 语义状态 = 固定图标 + 文字双通道（§5.1 末段），颜色取 --ds-status-*，
 *   永不与 --ds-scene-active 场景点缀联动；
 *
 * 本单（M3 复核挂账 ②③④⑤）改的是判定，不改呈现口径：
 * - ② 队列读取按 加载中 / 读取失败（带原因 + 重试）/ 空 / 有数据 四态如实分开，
 *   读取结果改由本面板直接取 `loadEvidenceQueueState()`：Provider 的
 *   `loadEvidenceQueue()` 把失败压成 `null`，带不出原因（§11.2「缺失/损坏/断连」行）；
 * - ③ 提交冲突后旧预览的指纹已失效，必须撤下预览区，不允许失效预览与冲突块并存；
 * - ④ 冲突未重新预览前，页面上不再同时存在「确认写入」入口（消除误点）；
 * - ⑤ 部分成功的重试沿用本次预览的**真实指纹**，不通过关闭校验把流程走通。
 *
 * 挂账 #35（本单）：把服务端早就有的**事务回读与回滚**接进界面。
 * - 新增 06「事务账本」区：条目来自 `GET /api/learning/evidence-transactions`，
 *   是磁盘上的事务记录而不是 React 状态——刷新界面后「刚才那次写回做了什么」仍然问得出；
 * - 「部分成功的事务」横幅因此不再只活在这次会话里：本页没有指纹时，用
 *   `GET /api/learning/evidence-transaction/:operationId` 取回**该笔事务自己的**预览基线指纹
 *   再重试补齐（仍然带真实指纹，不是传 `{}` 关掉校验）；
 * - 每笔事务的逐步明细说明「计划写入什么 / 实际做了什么 / 回滚怎么处置这一步」，
 *   取代原来那句固定的「日志已保存，进度待合并」；
 * - 回滚有显式确认步骤，把「用备份覆盖、本次新建的文件会被移除、写之前失败的那些步骤救不回来」
 *   三件事说明白；`rollback_blocked` 的 409 与逐条 blockers 原样呈现，不吞掉，
 *   回滚后一律以服务端读回的状态为准，不假设成功。
 * - 边界：01 / 03 两区的行数与文案都不动（11 步取证闸门依赖它们），新区一律用新的
 *   aria-label 与 `.ewb-tx-*` / `.ewb-rollback-*` 类名。
 *
 * M4 拆分（01 号方案 §4「把只读账本和危险写回动作隔离」）——本轮只搬运 + 记忆化，不改判定：
 * - 04 差异预览 → `./evidence-writeback/EvidencePreview`；
 * - 06 事务账本 → `./evidence-writeback/WritebackLedger`，其展开的逐步明细 →
 *   `./evidence-writeback/TransactionDetail`，回滚入口与二次确认 →
 *   `./evidence-writeback/RollbackDialog`；
 * - 状态标识（图形 + 文字双通道）与账本折算的纯函数、常量 →
 *   `./evidence-writeback/StateMark` 与 `./evidence-writeback/ledger-model`；
 * - 取数、提交、重试与回滚的**调用序仍然只在本文件**：子组件只拿到事实与动作，
 *   自己不发请求、也不改任何判定口径。
 */
import { Download, FileText, RefreshCw, Send, Trash2, UploadCloud } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchWritebackTransaction,
  loadEvidenceQueueState,
  loadWritebackLedgerState,
  readRollbackBlockers,
  rollbackWriteback,
} from '../content/api'
import type {
  WritebackTransactionDetail,
  WritebackTransactionList,
  WritebackTransactionSummary,
} from '../content/api'
import { useContent } from '../content/provider'
import { getLocalDateKey } from '../utils/date-helpers'
import type {
  EvidenceHintLevel,
  EvidenceInput,
  EvidenceQueue,
  EvidenceRanBy,
  FieldDiff,
  WritebackConflictDetails,
  WritebackPreview,
} from '../content/types'
import { EvidencePreview } from './evidence-writeback/EvidencePreview'
import { WritebackLedger } from './evidence-writeback/WritebackLedger'
import { evidenceMeta, isResumable, recordTone } from './evidence-writeback/ledger-model'
import type {
  ExpectedHashes,
  PartialTransaction,
  QueuePhase,
  RollbackOutcome,
} from './evidence-writeback/ledger-model'
import { StateMark } from './evidence-writeback/StateMark'
import { EwbDisabledHint, ewbDisabledProps } from './evidence-writeback/DisabledNote'
import './evidence-writeback-view.css'

const HINT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '未使用或未记录' },
  { value: 'L1', label: 'L1 方向提示' },
  { value: 'L2', label: 'L2 思路提示' },
  { value: 'L3', label: 'L3 关键步骤（不构成独立证据）' },
  { value: 'L4', label: 'L4 对照答案（不构成独立证据）' },
]

const RAN_BY_OPTIONS: { value: EvidenceRanBy; label: string }[] = [
  { value: 'learner', label: '学习者本人' },
  { value: 'ai_assistant', label: 'AI 助手' },
  { value: 'unknown', label: '未说明' },
]

/** STAT-01：日期键的算法只许有一份，这里只做转发——原来这套 pad 拼法是第二套实现。 */
function todayLocal(): string {
  return getLocalDateKey()
}

const toLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

export function EvidenceWritebackPanel() {
  const content = useContent()
  const status = content.learningStatus

  const [form, setForm] = useState({
    at: todayLocal(),
    topic: '',
    stage: '',
    contentId: '',
    exerciseId: '',
    expected: '',
    actual: '',
    artifacts: '',
    unfinished: '',
    ranBy: 'learner' as EvidenceRanBy,
    independent: true,
    hintLevel: '' as '' | 'L1' | 'L2' | 'L3' | 'L4',
  })
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<WritebackPreview | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [conflict, setConflict] = useState<WritebackConflictDetails | null>(null)
  const [partial, setPartial] = useState<PartialTransaction | null>(null)

  /**
   * 队列读取的三档判定（挂账②）：`queuePhase` 表达「这一次读怎么样了」，
   * `queue` 表达「手上最可信的一份数据是什么」。二者分开，重读时不清空已有数据，
   * 失败也就不会被界面显示成「没有待写回证据」。
   */
  const [queue, setQueue] = useState<EvidenceQueue | null>(null)
  const [queuePhase, setQueuePhase] = useState<QueuePhase>('loading')
  const [queueFailure, setQueueFailure] = useState<{ code: string; reason: string } | null>(null)
  /** 是否已经成功读到过：决定后台重读要不要把界面退回加载态（只有首次读才退回）。 */
  const hasQueueRef = useRef(false)

  // -------------------------------------------------------------------------
  // 事务账本（挂账 #35）：事实来源是服务端磁盘上的事务记录，不是 React 状态。
  // 界面刷新后「刚才那次写回做了什么、还差哪一步、能不能回滚」都要还能答上来。
  // 判定口径与上面的队列一致：`ledgerPhase` 说「这一次读怎么样了」，
  // `ledger` 说「手上最可信的一份记录是什么」，读失败绝不写成「没有写回事务」。
  // -------------------------------------------------------------------------
  const [ledger, setLedger] = useState<WritebackTransactionList | null>(null)
  const [ledgerPhase, setLedgerPhase] = useState<QueuePhase>('loading')
  const [ledgerFailure, setLedgerFailure] = useState<{ code: string; reason: string } | null>(null)
  const hasLedgerRef = useRef(false)

  /** 同一时刻只展开一笔事务的明细：逐步清单与回滚入口都挂在它下面。 */
  const [openTxId, setOpenTxId] = useState<string | null>(null)
  const [detail, setDetail] = useState<WritebackTransactionDetail | null>(null)
  const [detailPhase, setDetailPhase] = useState<QueuePhase>('loading')
  const [detailFailure, setDetailFailure] = useState('')
  /** 停在「等待确认」的那笔事务：没有这一步确认就不会发出回滚请求。 */
  const [rollbackConfirmId, setRollbackConfirmId] = useState<string | null>(null)
  const [rollbackBusy, setRollbackBusy] = useState(false)
  /** 上一次回滚的回执，按事务留存；文字只转述服务端给的事实，不下「一定修好了」的结论。 */
  const [rollbackOutcome, setRollbackOutcome] = useState<RollbackOutcome>(null)

  const isOwner = status?.isOwner === true

  /*
   * 01 号方案 §4 的 disabled 行：三颗按钮原先只被共享层压到 opacity .5，界面从没说
   * 「按不动的条件是什么、做什么才解禁」。条件在这里列成清单，一句句渲染成真实文字，
   * 再用 aria-describedby 绑到按钮上；条件不同时**不合并成一句笼统的「请稍后」**。
   * 说明文字不挂 role=status：本页的播报权属于写入结果那一行（见 ewb-result 那几条断言）。
   */
  const stageBlockers: string[] = []
  if (busy) stageBlockers.push('上一次写盘还没返回')
  if (!form.topic.trim()) stageBlockers.push('先填这条证据的主题名，暂存才知道要落到哪一页')

  const previewBlockers: string[] = []
  if (busy) previewBlockers.push('上一次请求还没返回')
  if (selected.length === 0) previewBlockers.push('上面还没勾出要写回的条目（当前 0 项）')
  if (!isOwner) previewBlockers.push('写回资料库只有拥有者能做，当前账户不是拥有者——导出待保存 Markdown 那一颗仍然可用')

  const stageDisabled = stageBlockers.length > 0
  const previewDisabled = previewBlockers.length > 0

  const refreshQueue = useCallback(async () => {
    if (!hasQueueRef.current) {
      setQueuePhase('loading')
      setQueueFailure(null)
    }
    const loaded = await loadEvidenceQueueState()
    if (loaded.status === 'ready') {
      hasQueueRef.current = true
      setQueue(loaded.queue)
      setQueueFailure(null)
      setQueuePhase('ready')
      setSelected(loaded.queue.pending.map((record) => record.evidenceId))
      return
    }
    setQueueFailure({ code: loaded.code, reason: loaded.reason })
    setQueuePhase('failed')
    if (!hasQueueRef.current) setSelected([])
  }, [])

  const refreshLedger = useCallback(async () => {
    if (!hasLedgerRef.current) setLedgerPhase('loading')
    const loaded = await loadWritebackLedgerState()
    if (loaded.status === 'ready') {
      hasLedgerRef.current = true
      setLedger(loaded.ledger)
      setLedgerFailure(null)
      setLedgerPhase('ready')
      return
    }
    // 重读失败时不清 ledger：下面仍是上一次读到的记录（与队列同一口径）。
    setLedgerFailure({ code: loaded.code, reason: loaded.reason })
    setLedgerPhase('failed')
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await Promise.resolve()
      if (cancelled || !status) return
      await refreshQueue()
      // 事务端点只对拥有者开放：非拥有者不请求，也就不会把 403 显示成「没有写回事务」。
      if (status.isOwner === true) await refreshLedger()
    })()
    return () => {
      cancelled = true
    }
  }, [status, refreshQueue, refreshLedger])

  const toggle = (evidenceId: string) => {
    setSelected((current) =>
      current.includes(evidenceId) ? current.filter((id) => id !== evidenceId) : [...current, evidenceId],
    )
  }

  const stage = async () => {
    setBusy(true)
    setError('')
    setMessage('')
    const input: EvidenceInput = {
      at: form.at,
      topic: form.topic.trim(),
      stage: form.stage.trim() || null,
      contentId: form.contentId.trim() || null,
      exerciseId: form.exerciseId.trim() || null,
      bundleId: content.bundleId,
      expected: form.expected.trim(),
      actual: form.actual.trim(),
      ranBy: form.ranBy,
      independent: form.ranBy === 'learner' && form.independent,
      hintLevel: (form.hintLevel || null) as EvidenceHintLevel,
      artifacts: toLines(form.artifacts),
      unfinished: toLines(form.unfinished),
      notes: '',
    }
    const result = await content.stageEvidence(input)
    if (!result.ok) {
      setBusy(false)
      setError(result.message)
      return
    }
    setMessage(result.message)
    setForm((current) => ({ ...current, topic: '', expected: '', actual: '', artifacts: '', unfinished: '' }))
    // 暂存只落应用数据；队列显示由本面板自己再读一次
    // （挂账②后界面不再消费 Provider 的队列副本）。
    await refreshQueue()
    setBusy(false)
  }

  const runPreview = async () => {
    setBusy(true)
    setError('')
    setMessage('')
    setPreview(null)
    setConflict(null)
    setPartial(null)
    setConfirmed(false)
    const result = await content.previewEvidence(selected)
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      if (result.code === 'sync_conflict' || result.code === 'progress_pending') {
        setConflict((result.details as WritebackConflictDetails) ?? null)
      }
      return
    }
    setPreview(result.data)
  }

  /**
   * 提交与重试的唯一出口（原 `runCommit`，逐行未改）：改成 useCallback 是为了交给
   * memo 化的预览区，调用序与判据不变。
   */
  const runCommit = useCallback(
    async (
      operationId: string,
      expectedHashes: ExpectedHashes,
      hashSource: PartialTransaction['source'] = 'preview',
    ) => {
      setBusy(true)
      setError('')
      const result = await content.commitEvidence(operationId, expectedHashes)
      setBusy(false)
      if (!result.ok) {
        const details = (result.details as WritebackConflictDetails | undefined) ?? null
        // 事务半完成：日志已落盘，保留 operationId **与本次预览的真实指纹**等待补齐（挂账⑤）。
        if (result.code === 'progress_pending' || details?.logSaved) {
          setConflict(null)
          setPartial({ operationId, message: result.message, expectedHashes, source: hashSource })
          setPreview(null)
          setConfirmed(false)
          // 账本同步重读：横幅从此有服务端这一份事实兜着，刷新也不会再丢掉（挂账 #35）。
          await Promise.all([refreshQueue(), refreshLedger()])
          return
        }
        // 冲突或预览已过期：旧预览的指纹在写入后不再代表当前文件，
        // 必须连预览一起撤下，否则失效预览与冲突块并存，
        // 页面上还会留下一个不能再用的「确认写入」（挂账③④）。
        if (result.code === 'sync_conflict' || result.code === 'stale_preview') {
          setPreview(null)
          setConfirmed(false)
          setPartial(null)
          // 只有服务端确实给出逐字段差异，才宣称「检测到第三方改动」；
          // stale_preview 只说明页面基于旧预览，不能冒充冲突。
          setConflict(details && Array.isArray(details.files) && details.files.length > 0 ? details : null)
          setError(result.message)
          return
        }
        // 与指纹无关的失败（格式非法、断连等）：写入没有开始，预览仍然有效。
        setConflict(null)
        setError(result.message)
        return
      }
      setMessage('已写入并复核：学习日志 → 进度追踪 → 总计划日志索引，全部成功。')
      setPreview(null)
      setConflict(null)
      setPartial(null)
      setConfirmed(false)
      // 成功之后账本必须跟着翻页：02 区还在不在，判据是服务端还有没有未补齐的事务，
      // 不是界面上那条 React 状态（取证闸门 ⑥ 就是钉这一条）。
      await Promise.all([refreshQueue(), refreshLedger()])
    },
    [content, refreshQueue, refreshLedger],
  )

  /**
   * 取一笔事务的逐步明细（GET /api/learning/evidence-transaction/:operationId）。
   * 失败只影响这一块：写清楚读不回什么，不把整页退回加载态，也不把「没读到」说成「没有步骤」。
   */
  const loadDetail = useCallback(async (operationId: string) => {
    setDetailPhase('loading')
    setDetail(null)
    setDetailFailure('')
    const loaded = await fetchWritebackTransaction(operationId)
    if (!loaded.ok) {
      setDetailPhase('failed')
      setDetailFailure(`${loaded.message}（错误码 ${loaded.code}）`)
      return
    }
    setDetail(loaded.data)
    setDetailPhase('ready')
  }, [])

  /** 展开 / 收起一笔事务的逐步明细。收起只是回到账本列表，不改动任何数据。 */
  const toggleTransaction = useCallback(
    (operationId: string) => {
      setRollbackConfirmId(null)
      if (openTxId === operationId) {
        setOpenTxId(null)
        setDetail(null)
        setDetailPhase('loading')
        setDetailFailure('')
        return
      }
      setOpenTxId(operationId)
      void loadDetail(operationId)
    },
    [openTxId, loadDetail],
  )

  /**
   * 「重试补齐」的统一入口（挂账⑤ + #35）。
   * 本页还留着那次预览的指纹时就直接用它；界面重新载入后手上没有指纹副本，
   * 就从服务端**这笔事务自己的**记录里取回同一批预览基线再提交。
   * 两条路都带真实指纹——传 `{}` 等于让服务端跳过这道校验，本面板不接受那种写法。
   */
  const retryPartial = async (operationId: string, hashes: ExpectedHashes | null, source: PartialTransaction['source']) => {
    if (hashes && Object.keys(hashes).length > 0) {
      await runCommit(operationId, hashes, source)
      return
    }
    setBusy(true)
    setError('')
    const loaded = await fetchWritebackTransaction(operationId)
    setBusy(false)
    if (!loaded.ok) {
      setError(`取不回这笔事务的预览基线，未能重试：${loaded.message}`)
      return
    }
    const stored: ExpectedHashes = Object.fromEntries(loaded.data.targets.map((step) => [step.path, step.expectedHash]))
    if (Object.keys(stored).length === 0) {
      setError('这笔事务没有留下任何目标指纹，无法带校验重试；请重新预览后再提交。')
      return
    }
    setPartial({ operationId, message: loaded.data.message, expectedHashes: stored, source: 'record' })
    await runCommit(operationId, stored, 'record')
  }

  /**
   * 回滚（挂账 #35）：确认后按真实事务发 POST /api/learning/evidence-rollback，
   * 回来后一律以服务端读回的状态为准——成功要重读，被挡更要重读，绝不假设成功。
   * `rollback_blocked` 的 409 与逐条 blockers 原样呈现，不吞掉。
   */
  const runRollback = useCallback(
    async (operationId: string) => {
      setRollbackConfirmId(null)
      setRollbackBusy(true)
      setRollbackOutcome(null)
      const result = await rollbackWriteback(operationId)
      if (!result.ok) {
        const blocked = result.code === 'rollback_blocked'
        setRollbackOutcome({
          operationId,
          tone: blocked ? 'blocked' : 'failed',
          text: result.message,
          blockers: blocked ? readRollbackBlockers(result.details) : null,
        })
        setRollbackBusy(false)
        // 被挡住时事务仍是原状态：把服务端当前的说法读回来，不让界面停在旧结论上。
        await Promise.all([refreshLedger(), loadDetail(operationId)])
        return
      }
      const restored = result.data.targets.filter((step) => step.action === 'restored').length
      const removed = result.data.targets.filter((step) => step.action === 'removed').length
      setRollbackOutcome({
        operationId,
        tone: 'done',
        text: result.data.idempotent
          ? '服务端记录显示这笔事务此前已回滚，本次没有再改动任何文件。'
          : `服务端已还原 ${restored} 个文件、移出本次新建的 ${removed} 个；下面的状态是回滚后重新读回来的。`,
        blockers: null,
      })
      setRollbackBusy(false)
      await Promise.all([refreshLedger(), refreshQueue(), loadDetail(operationId)])
    },
    [refreshLedger, refreshQueue, loadDetail],
  )

  /** 预览区的确认勾选：状态仍然只在本面板，子组件只转达用户的勾选结果。 */
  const handleConfirmChange = useCallback((checked: boolean) => {
    setConfirmed(checked)
  }, [])

  /** 交给 memo 子组件的四个动作全部在此固化身份；调用序与判据不变（M4 拆分说明）。 */
  const commitPreview = useCallback(
    (operationId: string, expectedHashes: ExpectedHashes) => {
      void runCommit(operationId, expectedHashes)
    },
    [runCommit],
  )
  const askRollback = useCallback((operationId: string) => {
    setRollbackConfirmId(operationId)
  }, [])
  const cancelRollback = useCallback(() => {
    setRollbackConfirmId(null)
  }, [])
  const confirmRollback = useCallback(
    (operationId: string) => {
      void runRollback(operationId)
    },
    [runRollback],
  )

  const exportPending = async () => {
    setBusy(true)
    setError('')
    const result = await content.exportEvidence(selected.length > 0 ? selected : undefined)
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    const blob = new Blob([result.data.markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `codeWeave-待保存证据-${todayLocal()}.md`
    link.click()
    URL.revokeObjectURL(url)
    setMessage('已导出待保存 Markdown（导出不等于已同步；只有实际写入并复核后才显示已同步）')
  }

  const pendingRecords = queue?.pending ?? []
  const syncedRecords = queue?.synced ?? []
  /** 尚未读到任何数据时，才由 queuePhase 决定显示加载态还是失败态（挂账②）。 */
  const queueLoading = queue === null && queuePhase === 'loading'
  const queueFailed = queue === null && queuePhase === 'failed'

  // -------------------------------------------------------------------------
  // 事务账本的派生读数（挂账 #35）
  // -------------------------------------------------------------------------
  /**
   * 服务端账本里「确实只写了一部分、还等补齐」的那笔事务。列表本身就是新→旧，
   * 所以 `find` 拿到的就是最近一笔；一步都没写的 partial 不算（那是冲突，见 ledgerTone）。
   */
  const serverPartial = ledger?.transactions.find(isResumable) ?? null
  /**
   * 02 区说哪一笔：本页这次中断优先（它还带着那次预览的上下文），
   * 否则说服务端读回来的那笔——这就是「刷新后横幅不再消失」的全部机制。
   */
  const shownPartial: PartialTransaction | WritebackTransactionSummary | null = partial ?? serverPartial
  /** 本页手上有没有指纹：null 表示只有服务端记录，重试时才去把基线读回来。 */
  const partialHashes = partial ? partial.expectedHashes : null

  // 与绑定面板一致：绑定状态未知（未登录 / 还没加载）时不渲染，
  // 避免先闪一句「当前账户不是拥有者」这种可能不成立的判断。
  // M4 拆分说明：这一句从各 handler 之前挪到了全部钩子之后——`runCommit` / `loadDetail` /
  // `toggleTransaction` / `runRollback` 为了交给 memo 子组件改成了 useCallback，
  // 钩子不能落在提前 return 之后。渲染结果与改前逐字节一致：status 为空仍然整块不渲染。
  if (!status) return null

  return (
    <section className="profile-overview-card evidence-writeback" aria-label="学习证据写回">
      <header className="ewb-head">
        <h3 className="security-card-title ewb-title">
          <UploadCloud className="ewb-title-icon" size={16} aria-hidden="true" /> 学习证据写回（确认式）
        </h3>
        <p className="vault-progress-notice ewb-lede">
          顺序固定：<strong>学习日志 → 进度追踪 → 总计划日志索引</strong>。未预览、未确认就不会写入；
          导入、阅读或 AI 运行都不会自动提升掌握等级。
        </p>
        {!isOwner && (
          <p className="ewb-banner ewb-banner--notice" role="status">
            <StateMark tone="notice" />
            <span className="ewb-banner-body">
              当前账户不是资料库拥有者：可以暂存与导出自己的证据，但不能写入资料库正式记录。
            </span>
          </p>
        )}
      </header>

      <div className="evidence-form-block ewb-step">
        <details>
          <summary>
            <FileText size={16} aria-hidden="true" /> ① 暂存一条证据（只落应用数据，不改资料库）
            <StateMark tone="pending" />
          </summary>
          <div className="evidence-form">
            <label className="field-label">
              学习日期
              <input type="date" value={form.at} onChange={(event) => setForm({ ...form, at: event.target.value })} />
            </label>
            <label className="field-label">
              学习主题
              <input
                value={form.topic}
                maxLength={60}
                placeholder="例如 Java Hello World"
                onChange={(event) => setForm({ ...form, topic: event.target.value })}
              />
            </label>
            <label className="field-label">
              所属阶段
              <input value={form.stage} placeholder="S0" onChange={(event) => setForm({ ...form, stage: event.target.value })} />
            </label>
            <label className="field-label">
              内容 ID
              <input value={form.contentId} onChange={(event) => setForm({ ...form, contentId: event.target.value })} />
            </label>
            <label className="field-label">
              练习 ID
              <input value={form.exerciseId} onChange={(event) => setForm({ ...form, exerciseId: event.target.value })} />
            </label>
            <label className="field-label">
              运行者
              <select
                value={form.ranBy}
                onChange={(event) => setForm({ ...form, ranBy: event.target.value as EvidenceRanBy })}
              >
                {RAN_BY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              提示等级
              <select
                value={form.hintLevel}
                onChange={(event) => setForm({ ...form, hintLevel: event.target.value as typeof form.hintLevel })}
              >
                {HINT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="vault-binding-toggle evidence-independent">
              <input
                type="checkbox"
                checked={form.independent}
                disabled={form.ranBy !== 'learner' || form.hintLevel === 'L3' || form.hintLevel === 'L4'}
                onChange={(event) => setForm({ ...form, independent: event.target.checked })}
              />
              由我独立完成（AI 运行、L3/L4 提示下不可勾选）
            </label>
            <label className="field-label evidence-wide">
              预期结果
              <textarea value={form.expected} onChange={(event) => setForm({ ...form, expected: event.target.value })} />
            </label>
            <label className="field-label evidence-wide">
              实际结果
              <textarea value={form.actual} onChange={(event) => setForm({ ...form, actual: event.target.value })} />
            </label>
            <label className="field-label evidence-wide">
              产物引用（每行一条）
              <textarea value={form.artifacts} onChange={(event) => setForm({ ...form, artifacts: event.target.value })} />
            </label>
            <label className="field-label evidence-wide">
              未完成项（每行一条）
              <textarea value={form.unfinished} onChange={(event) => setForm({ ...form, unfinished: event.target.value })} />
            </label>
            <div className="evidence-actions">
              <button
                className="primary-action"
                disabled={stageDisabled}
                onClick={() => void stage()}
                {...ewbDisabledProps(stageDisabled, 'ewb-stage-disabled-hint')}
              >
                {busy ? '处理中…' : '暂存证据'}
              </button>
              <EwbDisabledHint id="ewb-stage-disabled-hint" reasons={stageBlockers} />
            </div>
          </div>
        </details>
      </div>

      {/* ③ 三类状态明确分开：待处理 / 部分成功 / 已同步（§5.2「证据回写」行） */}
      <div className="evidence-queue ewb-states">
        <h4 className="ewb-ledger-total">
          ② 队列总账（
          {queue === null
            ? queuePhase === 'failed'
              ? '读取失败，计数不可用'
              : '正在读取，计数未定'
            : `${queue.pending.length} 条暂存 / ${queue.synced.length} 条已同步`}
          ）
        </h4>

        <section className="ewb-zone ewb-zone--pending" aria-label="待处理队列">
          <h5 className="ewb-zone-head">
            <span className="ewb-num" aria-hidden="true">
              01
            </span>
            <StateMark tone="pending" />
            <span className="ewb-zone-title">待处理 · 尚未写入资料库任何文件</span>
          </h5>

          {/* 挂账②的另一半：**重读**失败也不能被吞掉。已经读到过数据时不退回加载态、
              更不把列表清空，只单独标出「这一次没读回来」，并给出同一个重试入口。 */}
          {queue !== null && queuePhase === 'failed' && (
            <p className="ewb-banner ewb-banner--bad" role="status">
              <StateMark tone="failed" />
              <span className="ewb-banner-body">
                队列重读失败：{queueFailure?.reason || '服务端未给出原因'}（错误码 {queueFailure?.code || 'unknown'}）。
                下面仍是上一次成功读到的条目，未清空，也不代表这次读取成功。
                <button className="subtle-button" disabled={busy} onClick={() => void refreshQueue()}>
                  <RefreshCw size={16} aria-hidden="true" /> 重新读取队列
                </button>
              </span>
            </p>
          )}

          {/* 挂账②已修：读取失败不再借加载态的外观。四态各自成文——
              加载中（这一次读还没回来）/ 读取失败（带原因与重试入口）/ 空 / 有数据。
              失败态绝不说成「没有待写回证据」（§11.2「缺失/损坏/断连」：不空数据覆盖）。 */}
          {queueLoading && (
            <div className="ewb-state ewb-state--loading" aria-label="队列加载中">
              <p className="ewb-state-line">
                <StateMark tone="loading" />
                <span className="ewb-state-text">正在读取暂存证据…</span>
              </p>
              <p className="ewb-skeleton" aria-hidden="true">
                <span className="ewb-skeleton-bar" />
                <span className="ewb-skeleton-bar" />
              </p>
            </div>
          )}

          {queueFailed && (
            <div className="ewb-state ewb-state--failed" aria-label="队列读取失败">
              <p className="ewb-state-line">
                <StateMark tone="failed" />
                <span className="ewb-state-text">
                  读取暂存证据失败：{queueFailure?.reason || '服务端未给出原因'}（错误码 {queueFailure?.code || 'unknown'}）
                </span>
              </p>
              <p className="ewb-state-text">
                这里不会被说成「队列为空」：读不到不等于没有条目，暂存的证据也没有因此消失。
              </p>
              <div className="evidence-actions">
                <button className="subtle-button" disabled={busy} onClick={() => void refreshQueue()}>
                  <RefreshCw size={16} aria-hidden="true" /> 重新读取队列
                </button>
              </div>
            </div>
          )}

          {queue !== null && pendingRecords.length === 0 && (
            <p className="ewb-state ewb-state--empty">
              <StateMark tone="empty" />
              <span className="ewb-state-text vault-progress-empty">没有待写回证据。暂存只是本机保存，不会自动写进资料库。</span>
            </p>
          )}

          {queue !== null && pendingRecords.length > 0 && (
            <ul className="evidence-list">
              {pendingRecords.map((record) => (
                <li key={record.evidenceId} className={`ewb-row ewb-row--${record.state}`}>
                  <label>
                    <StateMark tone={recordTone(record)} />
                    <input
                      type="checkbox"
                      checked={selected.includes(record.evidenceId)}
                      onChange={() => toggle(record.evidenceId)}
                    />
                    <span className="evidence-topic">{record.topic}</span>
                    <small>{evidenceMeta(record)}</small>
                  </label>
                  <button
                    className="subtle-button"
                    disabled={busy}
                    onClick={() => void content.removeEvidence(record.evidenceId).then(() => refreshQueue())}
                  >
                    <Trash2 size={16} aria-hidden="true" /> 删除
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="evidence-actions">
            <button
              className="subtle-button"
              disabled={previewDisabled}
              onClick={() => void runPreview()}
              {...ewbDisabledProps(previewDisabled, 'ewb-preview-disabled-hint')}
            >
              <Send size={16} aria-hidden="true" /> ③ 预览将写入的内容
            </button>
            <EwbDisabledHint id="ewb-preview-disabled-hint" reasons={previewBlockers} />
            <button className="subtle-button" disabled={busy} onClick={() => void exportPending()}>
              <Download size={16} aria-hidden="true" /> 导出待保存 Markdown
            </button>
          </div>
        </section>

        {/* 部分成功（挂账⑤ + #35）：这一区说的事实有两个来源——优先说本页这次中断，
            本页没有上下文时（刷新过、或另一个标签页）说服务端账本里最近一笔待补齐的事务。 */}
        {(partial || serverPartial) && (
          <section className="ewb-zone ewb-zone--partial" aria-label="部分成功的事务">
            <h5 className="ewb-zone-head">
              <span className="ewb-num" aria-hidden="true">
                02
              </span>
              <StateMark tone="partial" />
              <span className="ewb-zone-title">部分成功 · 已写入的步骤不会重复追加</span>
            </h5>
            <p className="ewb-banner ewb-banner--partial" role="status">
              <span className="ewb-banner-body">
                {shownPartial?.message} 事务已保留：可点击重试补齐（已写入的步骤不会重复追加）。
                {partial ? null : '这条横幅读自服务端的事务记录：刷新界面它也还在，不再只活在这一次会话里。'}
              </span>
            </p>
            <p className="ewb-opid">
              <span className="ewb-opid-key">operationId</span>
              <code className="ewb-opid-value">{shownPartial?.operationId}</code>
            </p>
            {/* 挂账⑤：重试带的是**真实指纹**，不通过传空对象关掉校验把流程走通。
                指纹数量如实写出来，用户能看出补齐请求仍然受第三方改动保护。 */}
            <p className="ewb-opid">
              <span className="ewb-opid-key">重试沿用的目标指纹</span>
              <code className="ewb-opid-value">
                {partial ? Object.keys(partial.expectedHashes).length : (serverPartial?.targets.length ?? 0)} 项
              </code>
              <span className="ewb-opid-key">校验不关闭</span>
            </p>
            {/* 指纹是哪一代的必须写在界面上：本页预览给的那一批，与「重新载入后从这笔
                事务自己的记录里读回来的同一批基线」不是一回事，说清楚用户才知道在据哪一次核对补齐。 */}
            <p className="ewb-opid">
              <span className="ewb-opid-key">指纹来源</span>
              <span className="ewb-opid-value">
                {partial
                  ? partial.source === 'record'
                    ? '服务端事务记录（界面重新载入后读回的同一批基线）'
                    : '本次预览'
                  : '点「重试补齐」时从服务端这笔事务的记录里读回'}
              </span>
            </p>
            <div className="evidence-actions">
              <button
                className="subtle-button"
                /* 本页确实带着这次预览的指纹、而指纹为空（目标清单是空的）时不给盲写入口；
                   只有服务端记录可读时（重新载入后）照常可点——重试前先把它自己的基线读回来。 */
                disabled={busy || (partial !== null && Object.keys(partial.expectedHashes).length === 0)}
                onClick={() => void retryPartial(shownPartial?.operationId ?? '', partialHashes, partial?.source ?? 'preview')}
              >
                <RefreshCw size={16} aria-hidden="true" /> 重试补齐
              </button>
            </div>
          </section>
        )}

        <section className="ewb-zone ewb-zone--synced" aria-label="已同步记录">
          <h5 className="ewb-zone-head">
            <span className="ewb-num" aria-hidden="true">
              03
            </span>
            <StateMark tone="synced" />
            <span className="ewb-zone-title">已同步 · 写入资料库并复核完成</span>
          </h5>
          {queueLoading && (
            <p className="ewb-state ewb-state--loading">
              <StateMark tone="loading" />
              <span className="ewb-state-text">正在读取已同步记录…</span>
            </p>
          )}
          {queueFailed && (
            <p className="ewb-state ewb-state--failed">
              <StateMark tone="failed" />
              <span className="ewb-state-text">已同步记录同样没读到：与上方一起重试，不把「读不到」写成「还没有」。</span>
            </p>
          )}
          {queue !== null && syncedRecords.length === 0 && (
            <p className="ewb-state ewb-state--empty">
              <StateMark tone="empty" />
              <span className="ewb-state-text">还没有已同步的证据。只有实际写入并复核后才算已同步。</span>
            </p>
          )}
          {queue !== null && syncedRecords.length > 0 && (
            <ul className="evidence-list">
              {syncedRecords.map((record) => (
                <li key={record.evidenceId} className={`ewb-row ewb-row--${record.state}`}>
                  <span className="ewb-row-static">
                    <StateMark tone={recordTone(record)} />
                    <span className="evidence-topic">{record.topic}</span>
                    <small>{evidenceMeta(record)}</small>
                  </span>
                  <small className="ewb-synced-meta">
                    <span className="ewb-meta-key">复核时间</span>
                    <span className="ewb-meta-value">{record.syncedAt ?? '—'}</span>
                    <span className="ewb-meta-key">日志落点</span>
                    <code className="ewb-meta-value">{record.logPath ?? '—'}</code>
                    {record.operationId ? (
                      <>
                        <span className="ewb-meta-key">operationId</span>
                        <code className="ewb-meta-value">{record.operationId}</code>
                      </>
                    ) : null}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {message && (
        <p className="ewb-banner ewb-banner--ok" role="status">
          <StateMark tone="result" />
          <span className="ewb-banner-body">{message}</span>
        </p>
      )}
      {error && (
        <p className="ewb-banner ewb-banner--bad" role="status">
          <StateMark tone="failed" />
          <span className="ewb-banner-body">{error}</span>
        </p>
      )}

      {preview && (
        <EvidencePreview
          preview={preview}
          busy={busy}
          confirmed={confirmed}
          isOwner={isOwner}
          onConfirmChange={handleConfirmChange}
          onCommit={commitPreview}
        />
      )}

      {conflict && (
        <div className="evidence-conflict ewb-conflict" role="alert">
          <div className="ewb-head-row">
            <span className="ewb-num" aria-hidden="true">
              05
            </span>
            <h4 className="vault-progress-subtitle">检测到第三方改动，未覆盖任何内容</h4>
            <StateMark tone="conflict" />
          </div>
          <p className="vault-progress-notice">
            以文件指纹判断冲突，<strong>不按修改时间决胜</strong>。请重新预览，或先在 Obsidian 中人工合并后再提交。
          </p>
          {conflict.files?.map((file) => (
            <div className="ewb-conflict-file" key={file.path}>
              <p className="ewb-conflict-path">
                <code>{file.path}</code>
              </p>
              <div
                className="ewb-scroll"
                role="group"
                aria-label="冲突字段逐值对照（窄视口下可横向滚动）"
                tabIndex={0}
              >
                <table className="ewb-table ewb-table--diff">
                  <thead>
                    <tr>
                      <th scope="col">冲突字段</th>
                      <th scope="col">预览时的值</th>
                      <th scope="col">当前文件的值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {file.fieldDiffs.map((diff: FieldDiff) => (
                      <tr key={`${file.path}-${diff.field}`}>
                        <td>
                          <strong>{diff.field}</strong>
                        </td>
                        <td>
                          <span className="ewb-sign ewb-sign--minus">旧 −</span>
                          <span className="evidence-before">{diff.previewed ?? '—'}</span>
                        </td>
                        <td>
                          <span className="ewb-sign ewb-sign--plus">新 +</span>
                          <span className="evidence-after">{diff.current ?? '—'}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <div className="evidence-actions">
            <button className="subtle-button" disabled={busy} onClick={() => void runPreview()}>
              <RefreshCw size={16} aria-hidden="true" /> 重新预览
            </button>
          </div>
        </div>
      )}

      {/* 06 事务账本（挂账 #35）：这一区的内容全部读自服务端事务记录，不依赖本次会话的
          React 状态——刷新界面后「刚才那次写回做了什么、能不能回滚」仍然问得出。
          取证闸门依赖的 01 / 03 两区行数与文案在此一律不动，新区用独立 aria-label。
          M4 拆分（01 号方案 §4）后这一区的 JSX 住在 `./evidence-writeback/WritebackLedger`，
          「只有拥有者才挂载」这道门槛仍然写在这里。 */}
      {isOwner && (
        <WritebackLedger
          ledger={ledger}
          ledgerPhase={ledgerPhase}
          ledgerFailure={ledgerFailure}
          openTxId={openTxId}
          detail={detail}
          detailPhase={detailPhase}
          detailFailure={detailFailure}
          busy={busy}
          rollbackConfirmId={rollbackConfirmId}
          rollbackBusy={rollbackBusy}
          rollbackOutcome={rollbackOutcome}
          onRefreshLedger={refreshLedger}
          onToggleTransaction={toggleTransaction}
          onRetryDetail={loadDetail}
          onAskRollback={askRollback}
          onCancelRollback={cancelRollback}
          onConfirmRollback={confirmRollback}
        />
      )}

      {message && !error && !preview && !partial && (
        <p className="ewb-final-note">
          <StateMark tone="result" />
          <span className="ewb-state-text">只有实际写入并复核后才算已同步。</span>
        </p>
      )}
    </section>
  )
}
