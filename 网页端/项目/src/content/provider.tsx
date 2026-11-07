/**
 * 内容 Provider（LINK-05）：全应用唯一的教材数据入口。
 *
 * 行为约定：
 * - 已登录时才拉取资料库内容；未登录/未连接时进入**显式**的 legacy 回退，
 *   由 `sourceKind` 告诉界面「当前显示的是旧内置课程」，不允许静默替换。
 * - 目录（摘要）随 Provider 加载；详情（原文 + 练习）按需拉取并缓存。
 * - API 失败不清除任何本地草稿：本模块只读，不写 localStorage。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CurriculumStage } from '../data/curriculum'
import type { Lesson } from '../types/lesson'
import { adaptCatalog, adaptFallback, collectSubjects, snapshotDetailToLesson, type SubjectOption } from './adapter'
import {
  bindVaultOwner,
  commitWriteback,
  exportEvidenceMarkdown,
  fetchCatalog,
  fetchEvidenceQueue,
  fetchLearningStatus,
  fetchLesson,
  fetchStatus,
  fetchVaultProgress,
  previewWriteback,
  removeEvidence as removeEvidenceRequest,
  setContentVisibility,
  stageEvidence as stageEvidenceRequest,
  triggerSync,
  unbindVaultOwner,
} from './api'
import type { ApiResult } from './api'
import type {
  ContentSnapshot,
  ContentSourceKind,
  ContentState,
  ContentStatusResponse,
  EvidenceExportResult,
  EvidenceInput,
  EvidenceQueue,
  LearningStatus,
  VaultProgress,
  WritebackCommitResult,
  WritebackPreview,
} from './types'

/**
 * 单课详情（主题原文 + 练习契约）的取数结果。
 * 失败时把服务端原因与 HTTP 状态一起交回调用方，由就地的那块区域显示与重试。
 */
export type LessonDetailResult =
  | { ok: true; lesson: Lesson }
  | { ok: false; message: string; status: number }

/**
 * 正式进度投影的取数结果，形状与 `LessonDetailResult` 一致（原因与 HTTP 状态按次回调用方）。
 *
 * 改版前它把失败压成 `null` 并把原因塞进全局 `error`，于是界面只剩一句话可说：
 * 「正式进度暂不可用（未绑定、未授权或进度追踪不可读）」——三因合一，而且真实 HTTP 码被抹掉，
 * 「读不到」被说成「没有」。服务端这三档是分开的（`server.mjs` 的 /api/learning/vault-progress）：
 * 403 无权限、409 拥有者未绑定、其余 503 读取失败，只有最后一档可以重试。
 */
export type VaultProgressResult =
  | { ok: true; progress: VaultProgress }
  | { ok: false; message: string; status: number }

export type ContentContextValue = {
  /** vault=资料库正式内容；legacy-fallback=旧内置课程（未连接/未登录）；none=还没有任何内容 */
  sourceKind: ContentSourceKind
  state: ContentState
  /** 当前快照版本；切换课程时用它固定同一份内容 */
  bundleId: string | null
  buildTime: string | null
  counts: Record<string, number> | null
  status: ContentStatusResponse | null
  /** 正式内容 + 旧内置课程；旧课程带 legacy 标记 */
  lessons: Lesson[]
  /** 内容科目选项（不是可执行语言）：HTML/CSS/Vue/构建工具等各自成组 */
  subjects: SubjectOption[]
  /** 新口径阶段 S0—S9；规则待审核或未连接时为空 */
  stages: CurriculumStage[]
  legacyStages: CurriculumStage[]
  error: string | null
  loading: boolean
  refresh: () => Promise<void>
  /**
   * 拉取课程详情（含主题原文与练习契约）。
   *
   * 改版前失败返回 `null` 并把原因塞进全局 `error`：调用方（工作台、wiki 链接）只能显示
   * 「没有原文」，而「读取失败」和「这一课真的没有原文」是两句话——01 号方案 §4 的 error 行
   * 要求「可理解原因、重试、保留输入」，全局 error 又会让来源条把单课失败说成整包故障。
   * 现在把结果与原因按次返回给调用方，由就地的那块区域陈述。
   */
  loadLessonDetail: (contentId: string) => Promise<LessonDetailResult>
  sync: (options?: { dryRun?: boolean }) => Promise<{ ok: boolean; message: string }>
  /** LINK-08：拥有者绑定与教材可见范围（不含进度内容） */
  learningStatus: LearningStatus | null
  /** 显式把当前账户设为资料库拥有者（用户主动操作，不做自动猜测） */
  bindOwner: () => Promise<{ ok: boolean; message: string }>
  unbindOwner: () => Promise<{ ok: boolean; message: string }>
  setVisibility: (publicContent: boolean) => Promise<{ ok: boolean; message: string }>
  /** 正式进度投影：仅拥有者；失败按次带回原因与 HTTP 状态，界面分档陈述、不给猜测值 */
  loadVaultProgress: () => Promise<VaultProgressResult>
  // --- LINK-09 确认式写回 ---
  /** 本账户的暂存证据队列（pending / synced），只落应用数据 */
  evidenceQueue: EvidenceQueue | null
  loadEvidenceQueue: () => Promise<EvidenceQueue | null>
  /** 步骤 1：暂存证据（不改资料库） */
  stageEvidence: (input: EvidenceInput) => Promise<{ ok: boolean; message: string }>
  removeEvidence: (evidenceId: string) => Promise<{ ok: boolean; message: string }>
  /** 步骤 2：预览（只读，返回将写入的内容与差异） */
  previewEvidence: (evidenceIds: string[], masteryUpdates?: { skill: string; level: string }[]) => Promise<ApiResult<WritebackPreview>>
  /** 步骤 3：确认后提交（按日志 → 进度 → 索引写入） */
  commitEvidence: (operationId: string, expectedHashes: Record<string, string | null>) => Promise<ApiResult<WritebackCommitResult>>
  /** 未写回或离线时导出待保存 Markdown */
  exportEvidence: (evidenceIds?: string[]) => Promise<ApiResult<EvidenceExportResult>>
}

const ContentContext = createContext<ContentContextValue | null>(null)
/**
 * 导出容器本身：正文侧的双链需要「带内容目录的局部 Provider」来注入快照目录
 * （渲染测试与宿主自建局部目录都用它；读取一律走 useContent / useOptionalContent）。
 */
export const ContentProviderHost = ContentContext

export function useContent(): ContentContextValue {
  const value = useContext(ContentContext)
  if (!value) throw new Error('useContent 必须在 ContentProvider 内使用')
  return value
}

/**
 * 可选读取：教材正文里的双链需要判定「目标是否已发布」，
 * 但正文组件允许在 Provider 之外渲染（例如未连接内容时的旧课程视图）。
 * 因此这里不抛错，返回 null 由调用方退化为「无法判定发布状态」的提示。
 */
export function useOptionalContent(): ContentContextValue | null {
  return useContext(ContentContext)
}

export function ContentProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ContentSnapshot | null>(null)
  const [status, setStatus] = useState<ContentStatusResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<ContentState>('unconfigured')
  const [loading, setLoading] = useState(false)
  const [learningStatus, setLearningStatus] = useState<LearningStatus | null>(null)
  /** 重新加载令牌：refresh() 只推进令牌，真正的加载在 effect 里执行并带取消保护。 */
  const [reloadToken, setReloadToken] = useState(0)
  const detailCache = useRef(new Map<string, Lesson>())
  const progressCache = useRef<VaultProgress | null>(null)

  /**
   * 首次加载与手动刷新共用同一段逻辑。
   * 第一步就是 await（外部系统 I/O），因此 effect 体内不会同步 setState，
   * 也不会出现「渲染期间调用远程接口」的 cascading render 问题。
   */
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const run = async () => {
      if (!enabled) {
        if (cancelled) return
        setSnapshot(null)
        setStatus(null)
        setState('unconfigured')
        setError(null)
        setLoading(false)
        return
      }
      setLoading(true)
      const statusResult = await fetchStatus(controller.signal)
      if (cancelled) return
      if (!statusResult.ok) {
        setStatus(null)
        setState(statusResult.code === 'unauthorized' ? 'unavailable' : 'error')
        setError(statusResult.message)
        setLoading(false)
        return
      }
      setStatus(statusResult.data)
      setState(statusResult.data.state)
      // 绑定状态与教材目录互不依赖，并行请求缩短首屏等待；两者共享本次加载的取消信号。
      const [learningResult, catalogResult] = await Promise.all([
        fetchLearningStatus(controller.signal),
        fetchCatalog(controller.signal),
      ])
      if (cancelled) return
      setLearningStatus(learningResult.ok ? learningResult.data : null)
      if (!catalogResult.ok) {
        setSnapshot(null)
        setError(catalogResult.message)
        setLoading(false)
        return
      }
      setSnapshot(catalogResult.data)
      detailCache.current.clear()
      progressCache.current = null
      setError(null)
      setLoading(false)
    }
    void run()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [enabled, reloadToken])

  const refresh = useCallback(async () => {
    setReloadToken((token) => token + 1)
  }, [])

  const adapted = useMemo(() => (snapshot ? adaptCatalog(snapshot) : adaptFallback()), [snapshot])
  const subjects = useMemo(() => collectSubjects(adapted.lessons), [adapted.lessons])

  const sourceKind: ContentSourceKind = useMemo(() => {
    if (snapshot) return 'vault'
    return adapted.lessons.length > 0 ? 'legacy-fallback' : 'none'
  }, [snapshot, adapted.lessons.length])

  const loadLessonDetail = useCallback(
    async (contentId: string): Promise<LessonDetailResult> => {
      const cached = detailCache.current.get(contentId)
      if (cached) return { ok: true, lesson: cached }
      const result = await fetchLesson(contentId)
      if (!result.ok) {
        // 原因按次交回调用方，不再塞进全局 error：单课读取失败不等于整个教材包坏了。
        return { ok: false, message: result.message, status: result.status }
      }
      const lesson = snapshotDetailToLesson(result.data.lesson, result.data.exercises)
      detailCache.current.set(contentId, lesson)
      return { ok: true, lesson }
    },
    [],
  )

  const sync = useCallback(
    async (options?: { dryRun?: boolean }) => {
      const result = await triggerSync(options)
      if (!result.ok) return { ok: false, message: result.message }
      await refresh()
      return {
        ok: true,
        message: result.data.reused ? '已有同步任务在进行，已复用同一个任务' : options?.dryRun ? '校验通过（未发布）' : '同步任务已提交',
      }
    },
    [refresh],
  )

  /** 绑定类操作：成功后统一刷新绑定状态与课程包（教材准入可能随之变化）。 */
  const runBindingAction = useCallback(
    async (action: () => Promise<ApiResult<unknown>>, successMessage: string) => {
      const result = await action()
      if (!result.ok) return { ok: false, message: result.message }
      await refresh()
      return { ok: true, message: successMessage }
    },
    [refresh],
  )

  const bindOwner = useCallback(
    () => runBindingAction(() => bindVaultOwner(), '已把当前账户设为资料库拥有者'),
    [runBindingAction],
  )
  const unbindOwner = useCallback(
    () => runBindingAction(() => unbindVaultOwner(), '已解除拥有者绑定'),
    [runBindingAction],
  )
  const setVisibility = useCallback(
    (publicContent: boolean) =>
      runBindingAction(
        () => setContentVisibility(publicContent),
        publicContent ? '已放开教材给其他登录账户（正式进度仍仅拥有者可见）' : '教材已恢复为仅拥有者可见',
      ),
    [runBindingAction],
  )

  const loadVaultProgress = useCallback(async (): Promise<VaultProgressResult> => {
    if (progressCache.current) return { ok: true, progress: progressCache.current }
    const result = await fetchVaultProgress()
    if (!result.ok) {
      // 原因与 HTTP 状态按次回调用方，不再塞进全局 error：
      // 「未绑定（409）」「无权限（403）」「读不到（503）」是三句话，只有最后一档该给重试。
      return { ok: false, message: result.message, status: result.status }
    }
    progressCache.current = result.data
    return { ok: true, progress: result.data }
  }, [])

  // ---------------------------------------------------------------------------
  // LINK-09：确认式写回。暂存/预览/提交都只通过同源 API，
  // 界面不持有任何磁盘路径；提交成功后刷新队列以反映真实状态。
  // ---------------------------------------------------------------------------
  const [evidenceQueue, setEvidenceQueue] = useState<EvidenceQueue | null>(null)

  const loadEvidenceQueue = useCallback(async (): Promise<EvidenceQueue | null> => {
    const result = await fetchEvidenceQueue()
    if (!result.ok) return null
    setEvidenceQueue(result.data)
    return result.data
  }, [])

  const stageEvidence = useCallback(
    async (input: EvidenceInput) => {
      const result = await stageEvidenceRequest(input)
      if (!result.ok) return { ok: false, message: result.message }
      await loadEvidenceQueue()
      return { ok: true, message: '已暂存为待写回证据（pending）：尚未修改资料库任何文件' }
    },
    [loadEvidenceQueue],
  )

  const removeEvidence = useCallback(
    async (evidenceId: string) => {
      const result = await removeEvidenceRequest(evidenceId)
      if (!result.ok) return { ok: false, message: result.message }
      await loadEvidenceQueue()
      return { ok: true, message: '已删除该暂存证据' }
    },
    [loadEvidenceQueue],
  )

  const previewEvidence = useCallback(
    (evidenceIds: string[], masteryUpdates?: { skill: string; level: string }[]) =>
      previewWriteback({ evidenceIds, masteryUpdates }),
    [],
  )

  const commitEvidence = useCallback(
    async (operationId: string, expectedHashes: Record<string, string | null>) => {
      const result = await commitWriteback({ operationId, expectedHashes })
      if (result.ok) {
        // 写入会改变正式进度与队列状态：让后续读取拿到最新内容，而不是旧缓存。
        progressCache.current = null
        await loadEvidenceQueue()
      }
      return result
    },
    [loadEvidenceQueue],
  )

  const exportEvidence = useCallback((evidenceIds?: string[]) => exportEvidenceMarkdown(evidenceIds), [])

  const value = useMemo<ContentContextValue>(
    () => ({
      sourceKind,
      state,
      bundleId: snapshot?.bundleId ?? null,
      buildTime: snapshot?.buildTime ?? null,
      counts: snapshot?.counts ?? null,
      status,
      lessons: adapted.lessons,
      subjects,
      stages: adapted.stages,
      legacyStages: adapted.legacyStages,
      error,
      loading,
      refresh,
      loadLessonDetail,
      sync,
      learningStatus,
      bindOwner,
      unbindOwner,
      setVisibility,
      loadVaultProgress,
      evidenceQueue,
      loadEvidenceQueue,
      stageEvidence,
      removeEvidence,
      previewEvidence,
      commitEvidence,
      exportEvidence,
    }),
    [
      sourceKind,
      state,
      snapshot,
      status,
      adapted,
      subjects,
      error,
      loading,
      refresh,
      loadLessonDetail,
      sync,
      learningStatus,
      bindOwner,
      unbindOwner,
      setVisibility,
      loadVaultProgress,
      evidenceQueue,
      loadEvidenceQueue,
      stageEvidence,
      removeEvidence,
      previewEvidence,
      commitEvidence,
      exportEvidence,
    ],
  )

  return <ContentContext.Provider value={value}>{children}</ContentContext.Provider>
}
