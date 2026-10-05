import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { lazy, Suspense } from 'react'
import {
  Activity,
  BookOpen,
  CalendarCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Flame,
  FolderKanban,
  MoreHorizontal,
  Sparkles,
  Trophy,
} from 'lucide-react'
import { deriveNotifications, visibleNotifications } from './utils/notifications'
import type { SearchTarget } from './utils/search'
import { AuthView } from './components/auth-view'
import { ErrorBoundary } from './components/error-boundary'
import { DesktopLearningHome } from './components/desktop-learning-home'
import { HelpModal, SettingsModal, type AppSettings } from './components/modals'
import { GlobalTopbar } from './components/topbar'
import { computeWeeklyStats, countPassedChallenges } from './utils/analytics'
import { mergeTransientEvents, type NotificationItem } from './utils/notifications'
import { groupReviews, lessonCompletionNote } from './data/mastery'
import { aggregateMasteryByStage } from './utils/mastery-view'
import { useAuth, type AuthUser } from './hooks/use-auth'
import { useChallengeProgress } from './hooks/use-challenge-progress'
import { useCheckin } from './hooks/use-checkin'
import { useDebounce } from './hooks/use-debounce'
import { useExecution } from './hooks/use-execution'
import { useLocalStorage } from './hooks/use-local-storage'
import { useProjects } from './hooks/use-projects'
import { useReducedMotion } from './hooks/use-reduced-motion'
import { useReviewSchedule } from './hooks/use-review-schedule'
import { getChallenges } from './data/challenges'
import { getDefaultLesson } from './data/lessons'
import { ContentProvider, useContent } from './content/provider'
import { ContentSourceBanner } from './components/content-source-view'
import { VaultBindingPanel } from './components/vault-progress-view'
import { type MasteryRecord } from './data/mastery'
import { buildMonthGrid, formatLocalDate, getLocalDateKey } from './utils/date-helpers'
import {
  commitSaveSnapshot,
  createSaveSnapshot,
  getLessonCode,
  readWorkspace,
  saveWorkspace,
  type SaveSnapshot,
} from './utils/lesson-helpers'
import { scopedKey, STORAGE_KEYS } from './utils/constants'
import { buildExportPayload, clearLocalData, type ClearResult } from './utils/local-data'
import { summarizeExternalEvidence } from './utils/external-evidence'
import { completionSourceOf, deriveLessonEvidenceStates, hasCompletionEvidence, holdsCompletion, type LessonEvidenceStates } from './utils/lesson-evidence'
import { useLessonSignals } from './hooks/use-lesson-signals'
import type { LessonCompletionPayload } from './components/learning-workspace-view'
import type {
  AchievementObservation,
  Challenge,
  ChallengeJudgeMode,
  ChallengeProgressStatus,
  ExecutionTier,
  LanguageId,
  Lesson,
} from './types/lesson'
import type { ExternalEvidence } from './utils/external-evidence'

/**
 * 01 号方案 §6 第 1 条「首屏只加载认证、导航和当前主视图」：以下八个区域只在**入口被
 * 真正使用到的那一刻**才下载。判据不是猜哪些页面重要，而是两条实测事实：
 *  - 默认视图是 `path`（`useState<ViewId>('path')`），列表页之外的区域首屏必然不画；
 *  - 主 chunk 改版前 429.15 kB / gzip 138.62 kB，其中挑战、写回、工作台三块占了大头。
 * 静态导入仍保留给首屏就要的东西：AuthView、LearningPathView、GlobalTopbar、Sidebar、
 * 弹层（Settings/Help，点开就晚一帧会被当成故障）、ContentProvider 与各 hooks。
 *
 * `.then((m) => ({ default: m.X }))` 是把具名导出转成 lazy 需要的默认导出形态，
 * 不改动被懒加载模块自身的导出形状（测试与取证脚本仍按具名导入直接 mount 单个视图）。
 */
const ChallengesView = lazy(() => import('./components/challenges-view').then((m) => ({ default: m.ChallengesView })))
const LearningWorkspaceView = lazy(() =>
  import('./components/learning-workspace-view').then((m) => ({ default: m.LearningWorkspaceView })),
)
const ProjectsView = lazy(() => import('./components/projects-view').then((m) => ({ default: m.ProjectsView })))
const ReviewCenterView = lazy(() =>
  import('./components/review-center-view').then((m) => ({ default: m.ReviewCenterView })),
)
const AnalyticsView = lazy(() => import('./components/analytics-view').then((m) => ({ default: m.AnalyticsView })))
const DataPrivacyView = lazy(() =>
  import('./components/data-privacy-view').then((m) => ({ default: m.DataPrivacyView })),
)
const AccountSecurityView = lazy(() =>
  import('./components/account-security-view').then((m) => ({ default: m.AccountSecurityView })),
)
const ProfileView = lazy(() => import('./components/profile-view').then((m) => ({ default: m.ProfileView })))

type ViewId = 'path' | 'workspace' | 'challenges' | 'projects' | 'reviews' | 'analytics' | 'data' | 'profile' | 'security'

const VIEW_META: Record<ViewId, { label: string; breadcrumb: string }> = {
  workspace: { label: '学习工作台', breadcrumb: '课程' },
  path: { label: '学习路径', breadcrumb: '课程' },
  challenges: { label: '实战挑战', breadcrumb: '挑战' },
  projects: { label: '代码草稿', breadcrumb: '项目' },
  profile: { label: '个人中心', breadcrumb: '账户' },
  reviews: { label: '复习中心', breadcrumb: '复习' },
  analytics: { label: '学习分析', breadcrumb: '分析' },
  data: { label: '数据与隐私', breadcrumb: '数据' },
  security: { label: '账户安全', breadcrumb: '账户' },
}

const NAV_ITEMS: { id: ViewId; icon: typeof BookOpen }[] = [
  { id: 'path', icon: BookOpen },
  { id: 'challenges', icon: Trophy },
  { id: 'projects', icon: FolderKanban },
  { id: 'reviews', icon: CalendarCheck },
  { id: 'analytics', icon: Activity },
]

/**
 * §5.2「编号主导航」的编号来源：导航项在 NAV_ITEMS 里的真实序号（01—05）。
 * 必须是渲染进 DOM 的文本，不能用 CSS `counter()` 注入 —— counter 生成的内容会
 * 出现在辅助技术的朗读顺序里，却没有任何语义承载（01 号方案 §5 要求装饰
 * 文字不得进入朗读顺序）。文本化之后它成为导航项名称的一部分，朗读顺序 = DOM 顺序；
 * 真正的装饰（图标、发丝线、状态圆点）另走 aria-hidden / 伪元素，不进朗读树。
 * 编号口径与学习路径的 S0—S9 阶段编号是两回事，互不借用。
 */
const navIndex = (position: number) => String(position + 1).padStart(2, '0')

const CALENDAR_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

/**
 * #49 那道加载门的等待预算（毫秒）。取 §5.4 给 LCP 的同一条预算（2.5s）：
 * 门控最多占用一格性能预算，超了就放弃等待、照常画外壳 —— 本机接口卡死时
 * 用户至少还能看见界面（登出、设置都在壳里），不会永远停在一行加载文字上。
 * 实测三个接口合计 20—30ms（server 日志 status 7ms / learning 3ms / catalog 7ms），
 * 这里是 ~80 倍余量：预算内的正常路径永远是「等到位再画」，CLS 才成立。
 */
const BOOT_WAIT_BUDGET_MS = 2500

function greeting(hour: number): string {
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

/**
 * §5.4「验证加载」所说的加载态：整屏占位，只说在等什么，不画任何依赖数据的东西。
 *
 * 版式复用 `.auth-loading`（styles.css 里既有的一条：满屏、居中、次级文字色、
 * `var(--page)` 黑场），不新增尺寸档也不新增颜色 —— 首屏占位与登录后占位本就该同形。
 */
function BootNotice({ children }: { children: ReactNode }) {
  return (
    <div className="auth-loading" role="status">
      {children}
    </div>
  )
}

/**
 * 01 号方案 §4 状态矩阵里的 loading 行：懒加载区域在 chunk 到达前先占住高度，
 * 「不造成内容落地跳动」。
 *
 * 为什么不是转圈的 spinner：改版前切页是同步的，没有这一段空窗；拆 chunk 之后
 * 本机首访会有一个「什么都没画」的空帧，正文区如果按内容自适应高度，那一帧之后
 * 整页往下顶——正是 §6 要求记录的 CLS 原始 shift。这里给一个与页面结构同形的
 * 骨架（标题条 + 两行正文 + 一块内容面），高度用视口比例而不是猜某个页面的像素：
 * 猜死高度在 375 那一档必然猜不准（与 #49 的结论同源，见上面 contentSettled 注释）。
 *
 * `role="status"` + 文字让读屏器知道「正在载入 X 页」，不只靠形状（00 号方案 §6
 * 「loading 状态有文本或结构提示，不能只靠颜色」）。骨架本身是装饰形状，
 * `aria-hidden` 不进朗读顺序。
 */
function ViewFallback({ view }: { view: ViewId }) {
  return (
    <div className="view-skeleton" role="status">
      <p className="view-skeleton__label">正在载入{VIEW_META[view].label}…</p>
      <div className="view-skeleton__shape" aria-hidden="true">
        <span className="view-skeleton__title" />
        <span className="view-skeleton__line" />
        <span className="view-skeleton__line view-skeleton__line--short" />
        <span className="view-skeleton__panel" />
      </div>
    </div>
  )
}

/** 导出当前账户学习数据（R2-C：显式 schema + 版本 + 类别，不含设备设置与通知）。 */
function exportLocalData(scope?: string): void {
  const payload = buildExportPayload(scope)
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `codeweave-learning-data-${getLocalDateKey()}.json`  // STAT-01：文件名上的日期也是日期键，取本地日不是 UTC 日
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const auth = useAuth()

  if (!auth.checked) {
    return <BootNotice>正在检查登录状态…</BootNotice>
  }

  return (
    <ErrorBoundary>
      {auth.user ? (
        <ContentProvider key={auth.user.id} enabled>
          <WorkspaceShell
            user={auth.user}
            onLogout={auth.handleLogout}
            onUpdateUser={auth.updateUser}
          />
        </ContentProvider>
      ) : (
        <AuthView
          mode={auth.mode}
          error={auth.error}
          busy={auth.busy}
          connectionError={auth.connectionError}
          onModeChange={auth.setMode}
          onSubmit={auth.handleSubmit}
        />
      )}
    </ErrorBoundary>
  )
}

/**
 * 登录后的工作台外壳。以 user.id 作为 key：切换账户时整体重挂载，
 * 所有按账户隔离的本地状态都会重新初始化。
 */
function WorkspaceShell({
  user,
  onLogout,
  onUpdateUser,
}: {
  user: AuthUser
  onLogout: () => void
  onUpdateUser: (updates: Partial<Pick<AuthUser, 'name' | 'bio'>>) => Promise<AuthUser | null>
}) {
  const scope = user.id
  // LINK-05：教材数据统一来自内容快照；旧内置课程以 legacy 标记保留，不做静默替换。
  const content = useContent()
  /**
   * #49 首屏偏移（§5.4 要求 CLS ≤ 0.1）。
   *
   * 冷缓存量不到这个缺陷，热缓存（本地应用的常态：第二次打开）一量就有：JS 比本机
   * 接口先画完，外壳先落地，随后
   *  - `/api/learning/status`（实测 ~70ms）让拥有者面板从「不渲染」变成一整块，
   *  - `/api/content/status` + `/api/content/catalog`（~85ms）让来源状态条从
   *    「旧内置课程」那一版换成「资料库已连接」那一版（两者结构不同、高度不同），
   * 两块都在首屏之上，把已经画出来的欢迎区与阶段列表整段往下推。
   * 实测 spec CLS：1280×720 0.1202 / 390×844 0.2066 —— 超线。
   *
   * 修法是把「等数据」这一段显式画出来：首轮取数结束之前，登录后的一屏只挂加载态。
   * 加载态没有删（§5.4 要求验证加载、空内容、失败三种形态），只是把「先画错的一屏」
   * 换成「先画一句实话」；也没有靠猜高度预留——猜出来的尺寸在 320px 那一档必然猜不准
   * （实测这两块的高度在 293/372/454/479px 之间跳）。冷缓存下本来就是接口先赢，
   * 这个门等于让热缓存回到冷缓存的先后顺序。
   *
   * 门的位置在整壳而不是正文区：侧栏一出现就等价于「数据依赖的内容已画完」这个约定
   * 不能破——app.test.tsx 与 tools/visual 的取证脚本都以 .nav-item 为同步点。
   *
   * 判定只用 Provider 已经暴露的三个事实：`loading` 覆盖整段取数（成功与失败分支都会
   * 复位），而 `status` / `error` 在取数开始前必为 null，所以「不在取数且二者之一已
   * 就位」等价于「首轮已结束」。用渲染期 setState（与本文件「最近访问」同一写法）
   * 把它钉住：之后的 refresh()/重试同步/绑定会再次进入 loading，那时外壳不能被
   * 占位符换掉，否则按一次「重试同步」整个界面就闪没。
   */
  const [contentSettled, setContentSettled] = useState(false)
  if (!contentSettled && !content.loading && (content.status !== null || content.error !== null)) {
    setContentSettled(true)
  }
  // 门必须有上限。`content/api.ts` 的请求不带 AbortSignal，本机服务真挂住时它既不
  // resolve 也不 reject —— 一味等下去就是一行加载文字到天荒地老，而登出、设置这类
  // 自救入口都在壳里。到预算点就放外壳画出来，退化成修 bug 之前的行为：
  // 宁可要一次可见的偏移，也不要一个救不了的死屏。
  useEffect(() => {
    if (contentSettled) return
    const timer = window.setTimeout(() => setContentSettled(true), BOOT_WAIT_BUDGET_MS)
    return () => window.clearTimeout(timer)
  }, [contentSettled])
  const [now, setNow] = useState(() => new Date())
  const [view, setView] = useState<ViewId>('path')
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 关闭弹层后焦点回到触发按钮（键盘可达性，B6）
  const settingsTriggerRef = useRef<HTMLButtonElement>(null)
  // 全局搜索指定聚焦的挑战；最近访问的页面（N1）
  const [focusChallengeId, setFocusChallengeId] = useState<string>()
  const [recentViews, setRecentViews] = useState<{ id: string; label: string }[]>([])
  const [helpOpen, setHelpOpen] = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)

  // 每 30 秒刷新一次时钟，保证跨午夜后“今天”自动更新。
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  // Escape 关闭浮层。
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setCalendarOpen(false)
      setSettingsOpen(false)
      setHelpOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const [settings, setSettings] = useLocalStorage<AppSettings>(STORAGE_KEYS.SETTINGS, {
    notifications: true,
    autosave: true,
    compactMode: false,
    editorFontSize: 13,
    reduceMotion: false,
    editorTabSize: 2,
    editorWordWrap: false,
    editorLineNumbers: true,
  })
  /**
   * DATA-01 第 3 条：通知标题会带课程/项目内容，因此**按账户隔离**。
   * 改版前这里写的是未加后缀的键，而注册表把通知声明为 session 类——
   * 结果是「清除本账户数据」永远清不到真实通知，隐私清单那一行还恒显「从未保存」。
   * 旧的未加后缀键**不迁移也不删除**（归属未知，见 data-privacy-view 的旧数据行与 storage-registry 注释）。
   */
  const [notifState, setNotifState] = useLocalStorage<{ readIds: string[]; clearedDateKey?: string }>(
    scopedKey(STORAGE_KEYS.NOTIFICATIONS, scope),
    { readIds: [] },
  )
  // 瞬时事件（保存失败等）：同样按账户隔离，上限 50 条
  const [notifEvents, setNotifEvents] = useLocalStorage<NotificationItem[]>(
    scopedKey(STORAGE_KEYS.NOTIF_EVENTS, scope),
    [],
  )

  const recordTransientEvent = useCallback(
    (item: NotificationItem) => {
      setNotifEvents((current) => mergeTransientEvents(current, item))
    },
    [setNotifEvents],
  )

  const workspace = useMemo(() => readWorkspace(scope), [scope])
  const [languageId, setLanguageId] = useState<LanguageId>(workspace.languageId ?? 'python')
  /**
   * LINK-07 修复：列表与筛选按**内容科目**分组，不再把 HTML/CSS/Vue/Webpack/Linux
   * 硬塞进五种可执行语言。`languageId` 退化为「当前科目的可执行语言」，
   * 只在真正需要执行时使用。
   */
  const [subjectId, setSubjectId] = useState<string>(() => {
    const saved = workspace.subjectId
    if (saved && content.subjects.some((subject) => subject.id === saved)) return saved
    const savedLesson = workspace.lessonId
      ? content.lessons.find((lesson) => lesson.id === workspace.lessonId)
      : undefined
    if (savedLesson?.subjectId) return savedLesson.subjectId
    return content.subjects[0]?.id ?? 'python'
  })
  const [selectedLessonId, setSelectedLessonId] = useState<string>(() => {
    const saved = workspace.lessonId
    if (saved && content.lessons.some((lesson) => lesson.id === saved)) return saved
    const subject = workspace.subjectId
      ? content.lessons.find((lesson) => lesson.subjectId === workspace.subjectId)
      : undefined
    return subject?.id ?? content.lessons[0]?.id ?? getDefaultLesson().id
  })
  const [activeLesson, setActiveLesson] = useState<Lesson | null>(null)
  const [code, setCode] = useState<string>(() => {
    const lessonId = workspace.lessonId
    const lesson = lessonId ? content.lessons.find((item) => item.id === lessonId) : undefined
    return lesson ? getLessonCode(lesson.id, lesson.code, scope) : ''
  })
  /**
   * #94：资料库单元的起始代码要等详情回来才有。在这之前 `code` 是目录占位的空串，
   * 而保存快照效果对「代码变了」一视同仁——于是这份空占位在 600ms 防抖后被写成该课的草稿，
   * 详情回来后 `getLessonCode` 又优先读那份草稿（'' 不是 nullish，顶不掉），起始代码就再也不出现了，
   * 重载还是空的。这里记下「这一课的详情还在路上」，让快照效果在这段窗口里不出手。
   */
  const detailPendingLessonId = useRef<string | null>(null)
  /** `detailPendingLessonId` 的渲染态镜像（#105）：只有 ref 的话界面不会为这一秒重画。 */
  const [detailPendingId, setDetailPendingId] = useState<string | null>(null)

  const lessons = useMemo(
    () => content.lessons.filter((lesson) => lesson.subjectId === subjectId),
    [content.lessons, subjectId],
  )
  /**
   * 快照到达后自动校正选中项：保存过的课程若已不在列表中（旧课迁移、切语言），
   * 退回到该语言的第一课。用**派生值**而不是 effect 里 setState，避免级联渲染。
   */
  const effectiveLessonId = lessons.some((lesson) => lesson.id === selectedLessonId)
    ? selectedLessonId
    : (lessons[0]?.id ?? selectedLessonId)
  const selectedLesson = lessons.find((lesson) => lesson.id === effectiveLessonId)

  // 科目 / 课程选择持久化到本账户工作区。
  useEffect(() => {
    const current = readWorkspace(scope)
    saveWorkspace({ ...current, languageId, subjectId, lessonId: effectiveLessonId }, scope)
  }, [languageId, subjectId, effectiveLessonId, scope])

  // 跨账户（组件重挂载）时读取课程代码由上面的 useState 初始化完成；
  // 运行中切课需要清理执行状态。
  // §5.3 第 3 条的两条来源任一命中都要停：CSS 那半边由下面的 .reduce-motion 根类与媒体查询
  // 承担，运行播放头是 JS 定时器链，只能显式问它。
  const reducedMotion = useReducedMotion(Boolean(settings.reduceMotion))
  const execution = useExecution(
    code,
    activeLesson?.language ?? 'python',
    activeLesson ?? getDefaultLesson(),
    // 与渲染工作台的条件一致（见下方 `view === 'path' && activeLesson && selectedLesson`）。
    // 以前只看 `activeLesson !== null`，而 activeLesson 切走视图时不会清空，
    // 于是人在别的页面上按 Ctrl+Enter 仍会触发一次运行（审计卡 RUN-01 第 4 条）。
    activeLesson !== null && view === 'path',
    reducedMotion,
  )

  const challenges = useMemo(() => getChallenges(), [])
  const challengeProgress = useChallengeProgress(scope)
  const { verifySubmission, rejectSubmission } = challengeProgress
  const mastery = useReviewSchedule(scope, now)
  const projects = useProjects(scope)
  const checkin = useCheckin(scope, now)

  const debouncedCode = useDebounce(code, 600)
  /**
   * SAVE-01：保存快照在「编辑发生的瞬间」创建，绑定账户、课程、语言、代码与版本号。
   * 此前只对 code 防抖、延迟触发时再读当前 activeLesson，导致「A 改动后立即切到 B」
   * 会把 A 的代码写进 B 的槽位。
   */
  const saveSnapshotRef = useRef<SaveSnapshot | null>(null)
  /** 快照版本号：每次编辑自增，用于判断"当前这份是否已保存"。 */
  const revisionRef = useRef(0)
  /**
   * 界面可见的脏标记。refs 不能参与渲染，因此单独用 state 承载：
   * - currentRevision 随编辑推进
   * - savedRevision 只在写入成功后推进；失败时不推进，界面持续显示"未保存"
   */
  const [currentRevision, setCurrentRevision] = useState(0)
  /** Ctrl/Cmd+S 的真实结果，随下一次编辑清空（SAVE-01 第 4 条要求「给出结果」）。 */
  const [saveFeedback, setSaveFeedback] = useState('')
  const [savedRevision, setSavedRevision] = useState<number | null>(null)

  // 编辑缓冲变化时立即生成新快照（不等待防抖），延迟回调只消费快照。
  /**
   * SAVE-01 第 4 条：`isDirty` 必须对比「最后一次成功保存」——而**打开一课时从存储里读出来的内容
   * 本来就是已保存状态**。改版前每次进课都 `setSavedRevision(null)`，revision 却继续自增，
   * 于是进课那一瞬间恒显「未保存的修改」；自动保存关着时这个假脏标记还永远不会自己消。
   * 这里用一次性标记记下「下一次 revision 来自装载，不是用户敲的」，让成功快照直接对齐它。
   */
  const loadedRevisionPending = useRef(false)
  /** 用户改动编辑器内容：上一条手动保存的结果就过期了，清空它（留着会让人以为还在说这一次）。 */
  const handleCodeChange = (value: string) => {
    setSaveFeedback('')
    setCode(value)
  }

  const setCodeFromStorage = useCallback(
    (value: string | ((current: string) => string)) => {
      loadedRevisionPending.current = true
      setCode(value)
    },
    [setCode],
  )

  useEffect(() => {
    if (!activeLesson) return
    // #94：详情还在路上、代码仍是目录占位的空串——这一刻的「空」不是用户写的，不许存成草稿。
    if (detailPendingLessonId.current === activeLesson.id && code === '') return
    revisionRef.current += 1
    setCurrentRevision(revisionRef.current)
    if (loadedRevisionPending.current) {
      loadedRevisionPending.current = false
      setSavedRevision(revisionRef.current)
    }
    saveSnapshotRef.current = createSaveSnapshot({
      accountScope: scope,
      lessonId: activeLesson.id,
      languageId,
      code,
      revision: revisionRef.current,
    })
  }, [code, activeLesson, languageId, scope])

  useEffect(() => {
    if (!(settings.autosave ?? true)) return
    const snapshot = saveSnapshotRef.current
    if (!snapshot) return
    // 防抖触发时要求快照与当前防抖值一致，避免中间态写入。
    if (snapshot.code !== debouncedCode) return
    // 已成功保存过的同一份内容不重复写入。
    if (savedRevision === snapshot.revision) return
    const saved = commitSaveSnapshot(snapshot)
    if (saved) {
      setSavedRevision(snapshot.revision)
    } else {
      // F2：草稿保存失败进入通知中心（真实事件，按天去重）。
      // 注意 savedRevision 不推进，因此同一内容在下次防抖触发时会重试。
      // STAT-01：日期键一律走 `getLocalDateKey()`——`toISOString().slice(0, 10)` 是 UTC 日，
      // 在 UTC+8 凌晨会整体偏一天；而且这里只取一次时钟，别让 id 与 dateKey 跨午夜分成两天。
      const failedDay = getLocalDateKey()
      recordTransientEvent({
        id: `draft-save-failed:${snapshot.lessonId}:${failedDay}`,
        kind: 'draft-save-failed',
        title: `草稿保存失败：${activeLesson?.title ?? snapshot.lessonId}`,
        dateKey: failedDay,
      })
    }
  }, [debouncedCode, settings.autosave, recordTransientEvent, activeLesson, savedRevision])

  // 手动保存：不论自动保存是否开启都应可用，并给出真实结果。
  const saveNow = useCallback(
    (notify = true): boolean => {
      const snapshot = saveSnapshotRef.current
      if (!snapshot) return false
      const saved = commitSaveSnapshot(snapshot)
      if (saved) {
        setSavedRevision(snapshot.revision)
      } else if (notify) {
        const failedDay = getLocalDateKey()
        recordTransientEvent({
          id: `draft-save-failed:${snapshot.lessonId}:${failedDay}`,
          kind: 'draft-save-failed',
          title: `草稿保存失败：${activeLesson?.title ?? snapshot.lessonId}`,
          dateKey: failedDay,
        })
      }
      return saved
    },
    [activeLesson, recordTransientEvent],
  )

  // Ctrl/Cmd+S 手动保存（不区分自动保存开关）。
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        if (!activeLesson) return
        event.preventDefault()
        // 卡片要求「不论自动保存是否开启都执行当前快照保存并给出结果」，所以这里必须用返回值，
        // 不能像改版前那样 `saveNow()` 一扔了之——成功与失败都得说出口。
        setSaveFeedback(saveNow() ? '已保存到本机' : '保存失败：草稿未写入（详见通知中心）')
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [activeLesson, saveNow])

  /**
   * 详情取数的失败态（01 号方案 §4 的 error 行：可理解原因 + 重试 + 保留输入）。
   *
   * #105 修的是「还没读到」，本条修的是「读失败」——改版前两者都落到同一句
   * 「本单元没有配套代码」上，等于把服务故障说成教材没有内容。失败按 lessonId 存，
   * 只有当前这一课读到的那一条才显示，切课之后上一课的迟到失败不会挂在新课上。
   */
  const [detailFailure, setDetailFailure] = useState<{ lessonId: string; message: string } | null>(null)

  const requestLessonDetail = useCallback(
    (lesson: Lesson) => {
      if (!lesson.contentId) return
      detailPendingLessonId.current = lesson.id
      // 同一个「在路上」要能被界面读到，所以除了 ref（给上面那条草稿守卫同步读），
      // 再 mirror 一份 state 供渲染——只有 ref 的话这一秒界面不会重画，占位也就无从显示。
      setDetailPendingId(lesson.id)
      setDetailFailure(null)
      void content.loadLessonDetail(lesson.contentId).then((result) => {
        if (detailPendingLessonId.current === lesson.id) {
          detailPendingLessonId.current = null
          setDetailPendingId((current) => (current === lesson.id ? null : current))
        }
        if (!result.ok) {
          setDetailFailure({ lessonId: lesson.id, message: result.message })
          return
        }
        const detail = result.lesson
        setActiveLesson((current) => (current && current.id === detail.id ? detail : current))
        // 用户尚未改动时才用资料库 starterCode 覆盖，避免覆盖正在编辑的草稿。
        // SAVE-01 第 4 条：这一覆盖也来自存储，算「已保存」，不许留下假脏标记。
        setCodeFromStorage((currentCode) =>
          currentCode === lesson.code ? getLessonCode(detail.id, detail.code, scope) : currentCode,
        )
      })
    },
    [content, scope, setCodeFromStorage],
  )

  const handleLessonChange = (lesson: Lesson) => {
    // 切课前先把当前待保存内容落盘（快照绑定的是旧课程，不会误写新课程）。
    if (saveSnapshotRef.current && (settings.autosave ?? true)) saveNow(false)
    execution.handleReset()
    setActiveLesson(lesson)
    setLanguageId(lesson.language)
    // 打开课程时同步切换科目，保证返回列表后仍停在同一科目
    if (lesson.subjectId) setSubjectId(lesson.subjectId)
    const defaultCode = lesson.code
    // 新课程的内容来自存储，属于"已知已保存"状态；防抖比较按 revision 进行，
    // 因此把成功版本对齐到即将生成的 revision，避免刚切课就显示"未保存"。
    setSavedRevision(null)
    setCodeFromStorage(getLessonCode(lesson.id, defaultCode, scope))
    setSelectedLessonId(lesson.id)
    setView('path')
    // 资料库条目：详情（主题原文 + 练习契约）按需拉取，失败就地给出原因与重试，不清草稿。
    if (lesson.contentId) requestLessonDetail(lesson)
  }

  const handleSubjectChange = (next: string) => {
    setSubjectId(next)
    const first = content.lessons.find((lesson) => lesson.subjectId === next)
    if (first) {
      setSelectedLessonId(first.id)
      setLanguageId(first.language)
    }
  }

  const closeWorkspace = useCallback(() => {
    // 离开工作台前先把待保存内容按快照落盘，避免编辑丢失。
    saveNow(false)
    execution.handleReset()
    setActiveLesson(null)
  }, [execution, saveNow])

  const handleLessonCompleted = (payload: LessonCompletionPayload) => {
    if (!activeLesson) return
    /** LEARN-01 第 4/5 条：证据写清「谁判的」（文案由 data/mastery 的纯函数单点产生）；旧记录不带来源，读出来按未知处理。 */
    const note = lessonCompletionNote(activeLesson.title, payload.verification, payload.cases)
    /**
     * LEARN-01 第 5a 条：外部真实环境的课把四项结构化证据原样留档在这条完成证据里，
     * 序列化仍走 utils/external-evidence.ts（与挑战页同一个函数），不另起一套格式。
     * `verification` 保持 `self-declared`：环境/命令/摘要写得再齐，本机也没有比对过任何输出，
     * 把它升成 auto-verified 就是谎称验证——证据齐全 ≠ 已验证。
     */
    mastery.markLessonCompleted(
      activeLesson.id,
      payload.externalEvidence ? `${note}\n${summarizeExternalEvidence(payload.externalEvidence)}` : note,
      payload.verification,
    )
  }

  /**
   * R4 人工复核「确认通过」：状态迁移整个交给 `useChallengeProgress.verifySubmission`
   * （它只认 submitted，rejected/passed 一律不动），这里只补一条掌握度证据。
   *
   * 补这条是为了让两条通过路径同口径：本机自动通过早就在 `handleChallengeSubmit` 里
   * 记 `kind:'challenge', passed:true`，人工确认过的外部证据此前什么都不记，
   * 「计入完成数与掌握度」（use-challenge-progress.ts:43）只兑了一半。
   */
  const handleVerifySubmission = (challengeId: string, observation?: AchievementObservation) => {
    const record = challengeProgress.progress[challengeId]
    // 界面只在 status==='submitted' 的记录上画按钮；这里再判一次，迟到/重复点击不会写出第二条证据。
    if (!record || record.status !== 'submitted') return
    verifySubmission(challengeId, observation)
    mastery.recordEvidence(
      challengeId,
      'challenge',
      true,
      '人工复核通过：外部环境提交的证据经人确认后才计入通过（判定来源：人工复核，非本机自动验证）',
    )
  }

  /**
   * R4 人工复核「标记不通过」：同样只走 hook 的 `rejectSubmission`。
   * 这里不写掌握度证据——`handleChallengeSubmit` 对本机判失败的一跑也不写，
   * 不通过的事实由挑战记录自己承载（`status:'rejected'`），记一条 passed:false 反而
   * 会给从没通过过的单元凭空造出一条掌握度记录。
   */
  const handleRejectSubmission = (challengeId: string) => {
    const record = challengeProgress.progress[challengeId]
    if (!record || record.status !== 'submitted') return
    rejectSubmission(challengeId)
  }

  /**
   * LEARN-01 第 4 条：「已练习」由真实跑完的轨迹自动记，「已阅读」由工作台的按钮显式记。
   * 两条都是 `passed:false` 的证据（见 hooks/use-lesson-signals），只作为状态陈述，
   * 不当完成、不推进等级；下面的 `completed` 与「下一推荐」都必须走 `hasCompletionEvidence`，
   * 否则按一次「标记已阅读」就会把整页判成已完成。
   */
  const lessonSignals = useLessonSignals({
    lesson: view === 'path' ? activeLesson : null,
    runStatus: execution.runStatus,
    execution: execution.execution,
    records: mastery.records,
    recordEvidence: mastery.recordEvidence,
  })

  const handleChallengeSubmit = (
    challenge: Challenge,
    submission: {
      output: string[]
      evidence: string
      passed: boolean
      tier: ExecutionTier
      judgeMode?: ChallengeJudgeMode
      externalEvidence?: ExternalEvidence
    },
  ) => {
    // R4：外部环境实验无法在本机验证真实性 → 只能进入「待人工确认」，不自动通过。
    const status: ChallengeProgressStatus = submission.tier === 'external' ? 'submitted' : submission.passed ? 'passed' : 'rejected'
    challengeProgress.applySubmission({
      challengeId: challenge.id,
      status,
      output: submission.output,
      evidence: submission.evidence,
      tier: submission.tier,
      judgeMode: submission.judgeMode,
    })
    // 只有本机可验证的通过才写入掌握度；待人工确认不产生掌握度记录。
    if (status === 'passed') {
      mastery.recordEvidence(challenge.id, 'challenge', true, submission.evidence)
    }
  }

  const handleReview = (record: MasteryRecord, passed: boolean) => {
    mastery.recordEvidence(record.refId, 'review', passed, passed ? '复测通过' : '复测未通过')
  }

  const titles = useMemo(() => {
    const map: Record<string, string> = {}
    for (const lesson of content.lessons) map[lesson.id] = `${lesson.label} · ${lesson.title}`
    for (const challenge of challenges) map[challenge.id] = challenge.title
    return map
  }, [content.lessons, challenges])

  /** 下一推荐单元：当前科目中第一个还没有**完成证据**的课程（只有阅读/练习信号的课仍要推荐） */
  const recommendedLesson = useMemo(() => {
    const list = content.lessons.filter((lesson) => lesson.subjectId === subjectId)
    return list.find((lesson) => !hasCompletionEvidence(mastery.records[lesson.id])) ?? null
  }, [content.lessons, subjectId, mastery.records])

  /** 阶段展示口径：优先新口径 S0—S9；资料库未连接时退回旧 A—M 并明确标注。 */
  const displayStages = content.stages.length > 0 ? content.stages : content.legacyStages
  const stagesAreLegacy = content.stages.length === 0

  /**
   * 掌握度地图：按当前展示口径的阶段聚合（个人中心）。
   * 旧 A—M 单元记录不会自动并入 S0—S9（方案 §4：旧通过不自动变成新阶段通过）。
   */
  const stageMastery = useMemo(
    () =>
      aggregateMasteryByStage(
        mastery.records,
        displayStages,
        new Map(content.lessons.map((lesson) => [lesson.id, lesson.content.stageId])),
      ),
    [mastery.records, displayStages, content.lessons],
  )

  /**
   * LEARN-01 第 4 条：路径行、阶段折算、工作台那行「六种状态」与个人中心的计数，
   * 都从这同一批掌握度记录折出来。只算一次、四处消费，界面上不许出现第二套
   * 「这一课算什么状态」的判断（01 号方案 §9）。
   */
  const lessonStates = useMemo(() => {
    const map: Record<string, LessonEvidenceStates> = {}
    for (const [refId, record] of Object.entries(mastery.records)) {
      map[refId] = deriveLessonEvidenceStates(record)
    }
    return map
  }, [mastery.records])

  /**
   * 课程进度必须从**个人证据**派生：教材不允许自带 78% 之类的静态进度（方案 §7.2）。
   * 口径：该单元按统一完成判据（`holdsCompletion`）成立即 100%，否则 0%——不做插值猜测。
   *
   * 改版前这一行写的是 `record?.evidence.some((e) => e.passed)`：任何一类 passed 证据都算数，
   * 于是一条「复测通过」或「挑战通过」就能把路径行点亮成已完成，而同一课的工作台
   * （走 `hasCompletionEvidence`）与阶段折算（走 `holdsCompletion`）都说没完成——
   * 三个读数、两套口径，正是 §9 禁的那件事。现在四处共用同一个出口。
   */
  const pathLessons = useMemo(
    () =>
      lessons.map((lesson) => ({
        ...lesson,
        progress: holdsCompletion(lessonStates[lesson.id]) ? 100 : 0,
      })),
    [lessons, lessonStates],
  )

  /**
   * 已完成单元数（个人中心）：分母是**现役课程**，判定与路径行、工作台同一处。
   *
   * 改版前这里数的是「留下过 lesson 类 passed 证据的去重 refId」，既不认「延迟复测掌握」
   * 那一态，也会把已经不在现役清单里的旧 id 算进总数——同一句「已完成单元数」在两个页面
   * 对不上。现在按现役课程收口：退休 id 的完成证据仍留在记录里，去向由资料库的
   * legacy map 承接（02 号方案 §2），不靠把它计入现役数来掩盖。
   */
  const completedLessonCount = useMemo(() => {
    let count = 0
    for (const lesson of content.lessons) {
      if (holdsCompletion(lessonStates[lesson.id])) count += 1
    }
    return count
  }, [content.lessons, lessonStates])

  /**
   * 清除当前账户的本机学习数据（R2-C：统一入口，仅账户级 + 会话级，保留设备设置）。
   * DATA-01 第 4 条：删除失败时不得刷新页面掩盖错误——只有全部成功才重载。
   */
  const clearLocalLearningData = (): ClearResult => {
    const result = clearLocalData('account', scope)
    if (result.removed) {
      window.location.reload()
    }
    return result
  }

  /** 每个课程阶段对应的可访问单元（挑战页跳转用） */
  const unitsByStage = useMemo(() => {
    const map: Record<string, { id: string; title: string }[]> = {}
    for (const lesson of content.lessons) {
      const stageId = lesson.content.stageId
      if (!stageId) continue
      map[stageId] = [...(map[stageId] ?? []), { id: lesson.id, title: `${lesson.label} · ${lesson.title}` }]
    }
    return map
  }, [content.lessons])

  const openSettings = () => {
    setSettingsOpen(true)
  }

  // 页面切换：最近访问在渲染期重置（避免 effect 级联渲染），标题在 effect 里更新
  const [lastTrackedView, setLastTrackedView] = useState<ViewId>(view)
  if (lastTrackedView !== view) {
    setLastTrackedView(view)
    setRecentViews((current) =>
      [{ id: view, label: VIEW_META[view].label }, ...current.filter((item) => item.id !== view)].slice(0, 3),
    )
  }
  useEffect(() => {
    // 与顶栏面包屑用同一个闸门（GlobalTopbar 的 contextTitle：`view === 'path' && activeLesson`）。
    // activeLesson 只在 closeWorkspace 里清空，切到别的视图它仍留着——以前无条件拿它做标题，
    // 人已经站在个人中心/学习分析上，浏览器标签还写着上一节课的名字（审计卡 NAV-01）。
    const lessonInView = view === 'path' && activeLesson
    document.title = lessonInView
      ? `${activeLesson.title} · Code Canvas`
      : `Code Canvas · ${VIEW_META[view].label}`
  }, [view, activeLesson])

  // 全局搜索目标：课程 + 挑战 + 项目标题（仅本地学习数据）
  const searchTargets = useMemo<SearchTarget[]>(() => {
    const lessonTargets = content.lessons.map((lesson) => {
      /**
       * 资料库主题名与课程标题常常不同（如「条件分支：让程序做决定」对应主题
       * 「流程控制语句」）。把来源标题链、末级主题名与旧课 id 作为别名，
       * 用户按自己知道的名字也能搜到（方案 §8.2）。
       */
      const heading = lesson.source?.headingPath ?? []
      const aliases = [
        ...heading,
        lesson.exercise?.title ?? '',
        lesson.source?.path.split('/').pop()?.replace(/\.md$/, '') ?? '',
      ].filter((value) => value !== '')
      return {
        id: lesson.id,
        type: 'lesson' as const,
        title: `${lesson.label} · ${lesson.title}`,
        subtitle: lesson.legacy ? `${lesson.languageLabel} · 旧内置课程` : `${lesson.languageLabel} · 资料库`,
        aliases,
      }
    })
    const challengeTargets = challenges.map((challenge) => ({
      id: challenge.id,
      type: 'challenge' as const,
      title: challenge.title,
      subtitle: challenge.track,
    }))
    const projectTargets = projects.projects.map((project) => ({
      id: project.id,
      type: 'project' as const,
      title: project.name,
      subtitle: `${project.files.length} 个文件`,
    }))
    return [...lessonTargets, ...challengeTargets, ...projectTargets]
  }, [content.lessons, challenges, projects.projects])

  // 通知派生（只来自真实学习数据）
  const notifications = useMemo(
    () =>
      visibleNotifications(
        [...notifEvents, ...deriveNotifications({
          dueReviews: mastery.dueReviews,
          titles,
          challengeRecords: challengeProgress.progress,
          challengeTitles: titles,
          streak: checkin.streak,
          checkedInToday: checkin.checkedIn,
          todayKey: checkin.todayKey,
        })],
        notifState.readIds,
        notifState.clearedDateKey,
      ),
    [notifEvents, mastery.dueReviews, titles, challengeProgress.progress, checkin.streak, checkin.checkedIn, checkin.todayKey, notifState],
  )

  // 「减少动效」镜像到 documentElement。原先这个类只挂在 .app-shell 上，而登录页与
  // 加载态在壳外提前 return（App 的两个分支），所以设置项路径压不住它们；页面里
  // 写成 `.reduce-motion .xxx` 的降级规则在壳外也一并失效。挂在根上对所有子树成立。
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', Boolean(settings.reduceMotion))
    return () => document.documentElement.classList.remove('reduce-motion')
  }, [settings.reduceMotion])

  // #49：首轮取数没结束之前不画外壳（见上面 contentSettled 的注释）。整块换掉而不是
  // 只换正文区，是为了让「侧栏已经出现」仍然等价于「数据依赖的内容已经画完」——
  // 取证的 tools/visual 与 app.test.tsx 都以侧栏为同步点，半扇门会把那个约定破掉。
  if (!contentSettled) {
    return <BootNotice>正在读取本机教材与学习状态…</BootNotice>
  }

  const shellClassName = [
    'app-shell',
    'unified-theme',
    // 学习工作台（编辑器 / 长文阅读）挂沉浸式标记：装饰层不挂载（geometry.md §5 裁定 1
    // 「工作台与弹层不挂装饰框」+ §5.3 第 1 条「编辑器和长文阅读默认静态或低动态」）。
    view === 'path' && activeLesson ? 'is-immersive' : '',
    ['profile', 'security', 'data'].includes(view) ? 'is-account' : '',
    settings.compactMode ? 'compact-mode' : '',
    settings.reduceMotion ? 'reduce-motion' : '',
  ]
    .filter(Boolean)
    .join(' ')

  /**
   * §5.2「清楚的当前入口」：编号 + 页面名，供顶栏面包屑消费。
   * 停在 path 但已打开课程时，当前入口是 01 学习路径，页面名取学习工作台。
   */
  const navPosition = NAV_ITEMS.findIndex((item) => item.id === view)
  const currentEntry = {
    index: navPosition >= 0 ? navIndex(navPosition) : undefined,
    label: view === 'path' && activeLesson ? VIEW_META.workspace.label : VIEW_META[view].label,
  }

  const styleWithEditorFont = { '--editor-font-size': `${settings.editorFontSize ?? 13}px` } as CSSProperties

  // STAT-01：挑战完成数使用唯一派生口径，submitted / rejected 不计入“已通过”。
  const { passed: passedChallengeCount, legacy: legacyPassedChallengeCount } = countPassedChallenges(
    challengeProgress.progress,
  )
  const completedCount = passedChallengeCount + legacyPassedChallengeCount
  const remainingChallenges = challenges.length - completedCount

  return (
    <div className={shellClassName} style={styleWithEditorFont}>
      <a className="skip-link" href="#main-content">
        跳到主内容
      </a>
      <Sidebar
        user={user}
        view={view}
        onNavigate={(next) => {
          setView(next)
          setCalendarOpen(false)
        }}
        dueReviewsCount={mastery.dueReviews.length}
        checkin={checkin}
        calendarOpen={calendarOpen}
        onToggleCalendar={() => setCalendarOpen((open) => !open)}
        remainingChallenges={remainingChallenges}
        totalStages={displayStages.length}
      />

      <div className="main-content" id="main-content">
        {/* 装饰层：发丝线取景框，档位 10（geometry.md §5 裁定 1）。空元素 + aria-hidden
            + pointer-events:none，画线全部用伪元素，因此不截获鼠标键盘、也不进辅助技术
            朗读顺序（§5.3 第 6 条）。工作台（.is-immersive）下由 CSS 收起不挂载。 */}
        <div className="shell-decor" aria-hidden="true" />
        <GlobalTopbar
          activeArea={['profile', 'security', 'data'].includes(view) ? 'account' : 'workspace'}
          breadcrumbLabel={VIEW_META[view].breadcrumb}
          currentEntry={currentEntry}
          contextTitle={view === 'path' && activeLesson ? activeLesson.title : undefined}
          settingsTriggerRef={settingsTriggerRef}
          searchTargets={searchTargets}
          recentViews={recentViews}
          notifications={notifications}
          onMarkAllRead={(ids) =>
            setNotifState((current) => ({ ...current, readIds: [...new Set([...current.readIds, ...ids])] }))
          }
          user={user}
          onPickLesson={(lessonId) => {
            const lesson = content.lessons.find((item) => item.id === lessonId)
            if (lesson) handleLessonChange(lesson)
          }}
          onPickChallenge={(challengeId) => {
            setFocusChallengeId(challengeId)
            setView('challenges')
          }}
          onPickProject={(projectId) => {
            projects.setSelectedProjectId(projectId)
            setView('projects')
          }}
          onNavigateView={(viewId) => setView(viewId as ViewId)}
          onOpenSettings={openSettings}
          onNavigateSecurity={() => setView('security')}
          onNavigateData={() => setView('data')}
          onExportData={() => exportLocalData(scope)}
          onLogout={onLogout}
          /* 01 §3.2「快捷动作」的三条都取上层已有的事实与动作：推荐单元、今日到期数、
             帮助弹层——本处不派生任何新的学习状态（§9 禁止第二套判定）。 */
          recommendedLesson={recommendedLesson ? { label: recommendedLesson.label, title: recommendedLesson.title } : null}
          reviewDueCount={mastery.dueReviews.length}
          onContinueLesson={() => {
            if (recommendedLesson) handleLessonChange(recommendedLesson)
          }}
          onGoReviews={() => setView('reviews')}
          onOpenHelp={() => setHelpOpen(true)}
        />

        <main className="content-wrap">
          <ContentSourceBanner />
          <details className="desktop-vault-settings">
            <summary>资料库连接与拥有者设置</summary>
            <VaultBindingPanel />
          </details>
          {/* #77 的裁定：文档的 h1 归**页内标题**，壳层这句是个性化问候，不是页面名字。
              从前它顶着 h1，于是实战挑战 / 复习中心 / 学习分析 / 代码草稿四页同时有两个 h1，
              而学习路径与工作台反过来只能借它当一个 h1。现在八页各自只有一个 h1，
              字号档原样挂在 `.welcome-greeting` 类上（视觉零变化），条件也原样保留
              ——那三页不重复显示问候语是呈现取舍，不再是标题层级的副产品。
              单屏化（2026-09-30）：工作台（`activeLesson`）里这一行改为不挂载。
              它 98px 高，说的是日期与阶段口径，而工作台自己的顶栏已经带着课名，
              学习者在这一屏要的是代码与画布——问候语在这里既不是导航也不是上下文。
              路径页照旧显示（那里的阶段口径正是页面内容）。 */}
          {view === 'path' && !activeLesson && (
            <div className="welcome-row">
              <div>
                <p className="welcome-greeting">
                  {greeting(now.getHours())}，{user.name}
                  {/* 👋 是装饰（问候文字已在名称里），不进朗读顺序（§5.3 第 6 条） */}
                  <span className="wave" aria-hidden="true">
                    👋
                  </span>
                </p>
                <p className="welcome-subtitle">
                  {formatLocalDate(now)} · 学习计划共 {displayStages.length} 个阶段
                  {stagesAreLegacy ? '（资料库未连接，当前为旧 A—M 口径）' : `（${displayStages.map((stage) => stage.id).join('、')}）`}
                </p>
              </div>
              <div className="weekly-progress">
                <div className="progress-ring" role="img" aria-label={`挑战完成度 ${completedCount}/${challenges.length}`}>
                  <span>{challenges.length ? Math.round((completedCount / challenges.length) * 100) : 0}%</span>
                </div>
                <div>
                  <strong>挑战验收</strong>
                  <span>
                    已通过 {completedCount} / {challenges.length} 关
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* 01 号方案 §6 第 1 条：入口懒加载。闸门顺序固定 ErrorBoundary → Suspense → 视图，
              反过来会让 chunk 网络失败绕过边界（React 文档要求 Suspense 在边界内侧）。 */}
          <ErrorBoundary>
            <Suspense fallback={<ViewFallback view={view} />}>
            {view === 'path' && !activeLesson && (
              <DesktopLearningHome
                dueCount={mastery.dueReviews.length}
                onGoReviews={() => setView('reviews')}
                subjectId={subjectId}
                subjects={content.subjects}
                lessons={pathLessons}
                lessonStates={lessonStates}
                /* LEARN-01 第 3 条：阶段能力点与「这一阶段有没有完成证据」按**展示口径**给——
                   资料库未连接时退回旧 A—M 并已在别处标注，这里不另取一份阶段表。 */
                stages={displayStages}
                selectedLessonId={effectiveLessonId}
                recommended={
                  recommendedLesson ? { label: recommendedLesson.label, title: recommendedLesson.title } : null
                }
                onSubjectChange={handleSubjectChange}
                onLessonChange={handleLessonChange}
                onContinue={() => {
                  if (selectedLesson) handleLessonChange(selectedLesson)
                }}
              />
            )}
            {view === 'path' && activeLesson && selectedLesson && (
              <LearningWorkspaceView
                lesson={activeLesson}
                code={code}
                isDirty={savedRevision !== currentRevision}
                saveFeedback={saveFeedback}
                currentEvent={execution.currentEvent}
                runStatus={execution.runStatus}
                eventIndex={execution.eventIndex}
                execution={execution.execution}
                visibleOutput={execution.visibleOutput}
                variables={execution.variables}
                editorTabSize={settings.editorTabSize ?? 2}
                editorWordWrap={settings.editorWordWrap ?? false}
                editorLineNumbers={settings.editorLineNumbers ?? true}
                completed={holdsCompletion(lessonStates[activeLesson.id])}
                completionSource={completionSourceOf(lessonStates[activeLesson.id])}
                evidenceStates={lessonStates[activeLesson.id] ?? null}
                detailPending={detailPendingId === activeLesson.id}
                detailError={detailFailure?.lessonId === activeLesson.id ? detailFailure.message : null}
                onRetryDetail={() => requestLessonDetail(activeLesson)}
                onMarkRead={lessonSignals.markRead}
                readMarked={lessonSignals.readMarked}
                onComplete={handleLessonCompleted}
                onBack={closeWorkspace}
                onHelp={() => setHelpOpen(true)}
                onCodeChange={handleCodeChange}
                onRun={() => void execution.handleRun()}
                onPlay={() => void execution.handlePlay()}
                onStep={() => void execution.handleStep()}
                onSeek={execution.handleSeek}
                onReset={execution.handleReset}
              />
            )}
            {view === 'challenges' && (
              <ChallengesView
                challenges={challenges}
                progress={challengeProgress.progress}
                unitsByStage={unitsByStage}
                focusChallengeId={focusChallengeId}
                scope={scope}
                onOpenUnit={(lessonId) => {
                  const lesson = content.lessons.find((item) => item.id === lessonId)
                  if (lesson) handleLessonChange(lesson)
                }}
                onSubmit={handleChallengeSubmit}
                onVerifySubmission={handleVerifySubmission}
                onRejectSubmission={handleRejectSubmission}
              />
            )}
            {view === 'projects' && (
              <ProjectsView
                projects={projects.projects}
                selectedProjectId={projects.selectedProjectId}
                onCreate={projects.handleCreateProject}
                onSelect={projects.setSelectedProjectId}
                onDelete={projects.handleDeleteProject}
                onDuplicate={projects.handleDuplicateProject}
                onUpdate={projects.handleUpdateProject}
                onSaveCheckpoint={projects.handleSaveCheckpoint}
                onRestoreCheckpoint={projects.handleRestoreCheckpoint}
                persistFailure={projects.persistFailure}
                onRetryPersist={projects.retryPersist}
              />
            )}
            {view === 'analytics' && (
              <AnalyticsView
                stats={computeWeeklyStats({
                  masteryRecords: Object.values(mastery.records),
                  challengeRecords: challengeProgress.progress,
                  todayKey: checkin.todayKey,
                })}
                streak={checkin.streak}
                checkedInToday={checkin.checkedIn}
              />
            )}
            {view === 'data' && (
              <DataPrivacyView
                user={user}
                onExportData={() => exportLocalData(scope)}
                onClearLocalData={clearLocalLearningData}
              />
            )}
            {view === 'reviews' && (
              <ReviewCenterView
                groups={groupReviews(Object.values(mastery.records), checkin.todayKey)}
                titles={titles}
                lessonIds={content.lessons.map((item) => item.id)}
                todayKey={checkin.todayKey}
                onReview={handleReview}
                onSnooze={mastery.snooze}
                onOpenLesson={(lessonId) => {
                  const lesson = content.lessons.find((item) => item.id === lessonId)
                  if (lesson) handleLessonChange(lesson)
                }}
              />
            )}
            {view === 'security' && (
              <AccountSecurityView user={user} onLogout={onLogout} />
            )}
            {view === 'profile' && (
              <ProfileView
                user={user}
                onUpdateUser={onUpdateUser}
                onLogout={onLogout}
                onNavigateReviews={() => setView('reviews')}
                stageMastery={stageMastery}
                completedLessons={completedLessonCount}
                completedChallenges={completedCount}
                dueCount={mastery.dueReviews.length}
                onExportData={() => exportLocalData(scope)}
                onClearLocalData={clearLocalLearningData}
                onNavigateSecurity={() => setView('security')}
              />
            )}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onChange={(updates) => setSettings((current) => ({ ...current, ...updates }))}
          onClose={() => {
            setSettingsOpen(false)
            settingsTriggerRef.current?.focus()
          }}
          onRestoreDefaults={() =>
            setSettings({
              notifications: true,
              autosave: true,
              compactMode: false,
              editorFontSize: 13,
              reduceMotion: false,
              editorTabSize: 2,
              editorWordWrap: false,
              editorLineNumbers: true,
            })
          }
          onExport={() => exportLocalData(scope)}
        />
      )}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  )
}

type SidebarProps = {
  user: AuthUser
  view: ViewId
  onNavigate: (view: ViewId) => void
  dueReviewsCount: number
  checkin: ReturnType<typeof useCheckin>
  calendarOpen: boolean
  onToggleCalendar: () => void
  remainingChallenges: number
  totalStages: number
}

function Sidebar({
  user,
  view,
  onNavigate,
  dueReviewsCount,
  checkin,
  calendarOpen,
  onToggleCalendar,
  remainingChallenges,
  totalStages,
}: SidebarProps) {
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const checkedDates = useMemo(() => new Set(checkin.checkinDates), [checkin.checkinDates])
  const monthGrid = useMemo(() => buildMonthGrid(calendarMonth.year, calendarMonth.month), [calendarMonth])

  const shiftMonth = (delta: number) => {
    setCalendarMonth((current) => {
      const next = new Date(current.year, current.month + delta, 1)
      return { year: next.getFullYear(), month: next.getMonth() }
    })
  }

  return (
    <aside className="sidebar" aria-label="主导航">
      <div className="brand">
        <div className="brand-mark">
          <Sparkles size={16} strokeWidth={2.5} />
        </div>
        <span>
          code<span className="brand-accent">canvas</span>
        </span>
      </div>

      <div className="workspace-switcher">
        <div className="workspace-icon">{user.name.slice(0, 1).toUpperCase()}</div>
        <div className="workspace-copy">
          <strong>{user.name} 的学习区</strong>
          <span>全栈冲刺 · {totalStages} 阶段</span>
        </div>
      </div>

      <p className="nav-label">工作台</p>
      <nav className="main-nav" aria-label="模块导航">
        {NAV_ITEMS.map((item, position) => (
          <button
            key={item.id}
            className={`nav-item ${view === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
            aria-current={view === item.id ? 'page' : undefined}
          >
            {/* 编号是真实 DOM 文本（见 navIndex 注释）：它在按钮名称里、在 DOM 顺序里 */}
            <span className="nav-item__index">{navIndex(position)}</span>
            {/* 图标是装饰：lucide 默认已带 aria-hidden，这里显式写出以免版本变化 */}
            <item.icon size={16} aria-hidden="true" />
            <span>{VIEW_META[item.id].label}</span>
            {item.id === 'challenges' && remainingChallenges > 0 && (
              <span className="nav-badge">
                {remainingChallenges}
                <span className="nav-badge__sr">个挑战待完成</span>
              </span>
            )}
            {item.id === 'reviews' && dueReviewsCount > 0 && (
              <span className="nav-badge">
                {dueReviewsCount}
                <span className="nav-badge__sr">条复习到期</span>
              </span>
            )}
          </button>
        ))}
      </nav>

      <p className="nav-label">
        课程进度 · {totalStages} 阶段
      </p>

      <div className="sidebar-bottom">
        <div className="streak-wrap">
          <button
            className={`streak-card ${checkin.checkedIn ? 'checked-in' : ''}`}
            onClick={checkin.handleCheckin}
            title={checkin.checkedIn ? '今天已打卡' : '点击打卡'}
          >
            <div className="streak-icon">
              <Flame size={14} />
            </div>
            <div>
              <strong>{checkin.checkedIn ? `已打卡 · 连续 ${checkin.streak} 天` : `连续打卡 ${checkin.streak} 天`}</strong>
              <span>{checkin.checkedIn ? '明天继续保持' : '点击卡片完成今日打卡'}</span>
            </div>
          </button>
          <button className="streak-more" onClick={onToggleCalendar} aria-label="查看打卡日历" aria-expanded={calendarOpen}>
            <MoreHorizontal size={15} />
          </button>
          {calendarOpen && (
            <div className="checkin-calendar" role="dialog" aria-label="打卡日历">
              <div className="checkin-calendar-head">
                <button className="icon-button" onClick={() => shiftMonth(-1)} aria-label="上一月">
                  <ChevronLeft size={14} />
                </button>
                <span>
                  {calendarMonth.year} 年 {calendarMonth.month + 1} 月
                </span>
                <button className="icon-button" onClick={() => shiftMonth(1)} aria-label="下一月">
                  <ChevronRight size={14} />
                </button>
              </div>
              <div className="calendar-weekdays">
                {CALENDAR_WEEKDAYS.map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              <div className="calendar-grid">
                {monthGrid.map((dateKey, index) =>
                  dateKey ? (
                    <span
                      key={dateKey}
                      className={`calendar-day ${checkedDates.has(dateKey) ? 'checked' : ''} ${
                        dateKey === checkin.todayKey ? 'today' : ''
                      }`}
                    >
                      {checkedDates.has(dateKey) ? <Check size={10} /> : Number(dateKey.slice(-2))}
                    </span>
                  ) : (
                    <span key={`empty-${index}`} className="calendar-empty" />
                  ),
                )}
              </div>
              <small>累计打卡 {checkin.checkinDates.length} 天 · 日期按本机系统计算</small>
            </div>
          )}
        </div>

        <button
          className="profile"
          onClick={() => onNavigate('profile')}
          title="打开个人中心"
          aria-label="打开个人中心"
        >
          <div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div>
          <div>
            <strong>{user.name}</strong>
          </div>
        </button>
      </div>
    </aside>
  )
}

