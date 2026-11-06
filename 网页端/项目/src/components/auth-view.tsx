import './auth-view.css'

import { AlertTriangle, CodeXml, Eye, EyeOff, LogIn, Pause, Play, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { useLocalStorage } from '../hooks/use-local-storage'
import { STORAGE_KEYS } from '../utils/constants'
import { currentSurface, SURFACE_LABEL } from '../utils/surface'

/** 设备级设置里本页唯一关心的一项：应用内「减少动效」开关（app.tsx L193 同名字段）。 */
type ReduceMotionSetting = { reduceMotion?: boolean }

type AuthMode = 'login' | 'register'
type ContactType = 'email' | 'phone'

type AuthViewProps = {
  mode: AuthMode
  error: string
  busy: boolean
  /**
   * 登录状态检查阶段的连接故障：'unavailable'（服务未启动）与 'bad_response'（响应异常）。
   * 与凭据错误（error）分开显示，避免用户把“服务没开”误判为“密码错了”。
   */
  connectionError?: 'unauthorized' | 'unavailable' | 'bad_response' | 'request_failed' | null
  onModeChange: (mode: AuthMode) => void
  onSubmit: (values: {
    name?: string
    email?: string
    phone?: string
    identifier?: string
    contactType?: ContactType
    password: string
  }) => void
}

const CONNECTION_HINTS: Record<string, string> = {
  unavailable: '无法连接本地服务。请通过 CodeCanvas-OneClick.cmd 或 pnpm run start 启动完整服务后刷新页面。',
  bad_response: '服务返回了异常响应，可能正在升级或未构建前端产物。请运行 pnpm run build 后重启服务。',
  request_failed: '服务暂时无法处理请求，请稍后重试。',
}

/** 密码长度约束：必须与 server.mjs 的 8-128 校验保持一致。 */
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_MAX_LENGTH = 128

/** 提交按钮文案：正常态与忙态都按模式区分，避免“创建账户”误写成“注册”。 */
const SUBMIT_LABEL: Record<AuthMode, { idle: string; busy: string }> = {
  login: { idle: '登录', busy: '正在登录…' },
  register: { idle: '创建账户', busy: '正在创建…' },
}

/** 眉标编号：入口页沿用模板的章节编号表达（index.html L63 `<i class="idx">00</i>`）。 */
const REDUCE_MOTION_CLASS = 'reduce-motion'
const REDUCE_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** 系统「减少动效」偏好。非浏览器环境（node 测试）按“不减少”处理。 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(REDUCE_MOTION_QUERY).matches
}

/**
 * 应用内「减少动效」设置的根类。app.tsx 把 `.reduce-motion` 挂在壳层根节点上，
 * 登录页在它之外（app.tsx L130 直接渲染 AuthView），因此这里读 documentElement/body
 * 两处，并用 MutationObserver 跟随变化；CSS 里同时写了 `.reduce-motion …` 后代选择器，
 * 任一层先落地都能真正停止动画。
 */
function hasReduceMotionClass(): boolean {
  if (typeof document === 'undefined') return false
  return (
    document.documentElement.classList.contains(REDUCE_MOTION_CLASS) ||
    document.body.classList.contains(REDUCE_MOTION_CLASS)
  )
}

/**
 * 场景动效的四条“真停”路径（§5.3.3 / §5.3.4）：系统偏好、应用「减少动效」设置、
 * 用户手动暂停、页面切到后台。命中任一条即 `still`，组件把 `data-motion="still"`
 * 写进 DOM，CSS 侧一律 `animation: none`（移除关键帧），而不是放慢时长。
 * 场景本身是纯 CSS 装饰层，不持有 RAF / 监听器 / GPU 资源，因此不存在需要释放的帧循环。
 */
function useSceneMotion() {
  const [systemReduce, setSystemReduce] = useState(prefersReducedMotion)
  const [classReduce, setClassReduce] = useState(hasReduceMotionClass)
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden')
  const [userPaused, setUserPaused] = useState(false)
  /**
   * 设置里的「减少动效」开关（app.tsx L193 定义、L600 挂 `.reduce-motion` 类）。
   * 登录页渲染在 `.app-shell` 之外，拿不到那个类，因此这里直接读同一条设备级设置；
   * 共享层若把该类提到 documentElement/body，上面的观测会同时生效，两条路径不冲突。
   */
  const [settings] = useLocalStorage<ReduceMotionSetting>(STORAGE_KEYS.SETTINGS, {})
  const settingReduce = settings.reduceMotion === true

  useEffect(() => {
    // jsdom 不实现 matchMedia（真实浏览器与 Edge 全都有）：缺失时按“不减少”处理。
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(REDUCE_MOTION_QUERY)
    const onChange = (event: MediaQueryListEvent) => setSystemReduce(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const observer = new MutationObserver(() => setClassReduce(hasReduceMotionClass()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const toggleUserPaused = useCallback(() => setUserPaused((current) => !current), [])

  return {
    still: systemReduce || classReduce || settingReduce || hidden || userPaused,
    userPaused,
    toggleUserPaused,
  }
}

export function AuthView({ mode, error, busy, connectionError, onModeChange, onSubmit }: AuthViewProps) {
  const [showPassword, setShowPassword] = useState(false)
  // contactType 改为受控状态：选择“手机号”后联系方式输入需同步切换 type/inputMode，
  // 仅靠 FormData 读取无法驱动渲染。
  const [contactType, setContactType] = useState<ContactType>('email')
  const passwordId = useId()
  const contactId = useId()
  /** 忙态禁用说明的锚点：提交按钮与模式切换按钮共用同一句原因（§4 disabled 行）。 */
  const busyHintId = 'auth-busy-disabled-hint'
  const formRef = useRef<HTMLFormElement>(null)
  const { still, userPaused, toggleUserPaused } = useSceneMotion()

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const password = data.get('password') as string

    if (mode === 'register') {
      const name = data.get('name') as string
      const contactValue = data.get('contact') as string
      onSubmit({
        name,
        [contactType]: contactValue,
        contactType,
        password,
      })
    } else {
      const identifier = data.get('identifier') as string
      onSubmit({ identifier, password })
    }
  }

  /**
   * Esc = 退出输入态：明文密码收回、焦点回到第一个输入框。
   * 不清空已填凭据（用户可能只是要看一眼密码），不提交表单，也不向上冒泡，
   * 免得外层弹层把它当成“关闭自己”的信号。
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    setShowPassword(false)
    formRef.current?.querySelector<HTMLElement>('input, select')?.focus()
  }

  const isPhone = contactType === 'phone'
  const connectionHint = !error && connectionError ? CONNECTION_HINTS[connectionError] : undefined
  const noticeId = error ? 'auth-error' : connectionHint ? 'auth-connection' : undefined

  return (
    <div className="cv-auth" data-motion={still ? 'still' : 'live'}>
      {/* 宇宙场景位：纯装饰。aria-hidden + pointer-events:none，
          不进辅助技术阅读顺序、不截获鼠标与键盘（§5.3.6），也永不阻断表单（§5.3.2）。
          2026-09-29：从右栏搬到**左栏**，与品牌/标题合成一整块「观测台」——
          原来的排法是左栏只有三行字、星球孤零零挂在右栏表单背后，左右都空。
          元素本身一个没动（2 个 ring / glow / horizon / orbit / tag 的钩子全在），
          只换了它所在的轨道（CSS 里 `grid-column` / `grid-row`）。 */}
      <div className="cv-auth__scene" aria-hidden="true">
        <span className="cv-auth__scene-glow" />
        <span className="cv-auth__scene-horizon" />
        <span className="cv-auth__scene-ring" />
        <span className="cv-auth__scene-ring cv-auth__scene-ring--far" />
        <span className="cv-auth__scene-orbit" />
        <svg className="cv-auth__orbits" viewBox="0 0 1000 900" fill="none">
          <g transform="translate(450 460)">
            <ellipse rx="430" ry="280" transform="rotate(-18)" />
            <ellipse rx="330" ry="210" transform="rotate(28)" />
            <ellipse rx="210" ry="140" transform="rotate(-8)" />
            <ellipse rx="560" ry="360" transform="rotate(12)" strokeDasharray="4 9" />
            <circle cx="-275" cy="-161" r="4" />
            <circle cx="243" cy="137" r="3" />
            <circle cx="-12" cy="-139" r="3" />
          </g>
          {[[70, 140], [215, 295], [670, 182], [800, 675], [130, 640], [582, 740], [405, 93], [754, 377]].map(([x, y]) => (
            <circle key={`${x}-${y}`} className="cv-auth__star" cx={x} cy={y} r="1.5" />
          ))}
        </svg>
        <span className="cv-auth__scene-tag">CODECANVAS · LOCAL WORKSPACE</span>
      </div>

      {/* ── 左栏：品牌 + 展示标题 + 说明。
             整栏没有可聚焦元素，所以 Tab 顺序与改版前完全一致 ── */}
      <section className="cv-auth__content" aria-label="工作台介绍">
        <p className="cv-auth__brand">
          <span className="cv-auth__brand-ring"><CodeXml size={22} aria-hidden="true" /></span>
          <span>
            code<span className="cv-auth__brand-accent">canvas</span>
          </span>
          <span className="cv-auth__brand-badge">{SURFACE_LABEL[currentSurface]}</span>
        </p>

        {/* 展示标题：字重 200、负字距、多行中文用 1.15 行高（§5.1 表「展示标题」行）。
            本页唯一的 h1 在左栏，右栏不再另立标题（#77 裁定：h1 归页面主题）。 */}
        <p className="cv-auth__scene-caption">// YOUR PERSONAL CODING UNIVERSE</p>
        <p className="cv-auth__hero">瞬时唤醒<br /><span>你的代码宇宙</span></p>
        <h1 className="cv-auth__title">{mode === 'login' ? '登录你的工作区' : '创建学习账户'}</h1>
        <p className="cv-auth__lead">
          {mode === 'login'
            ? '使用邮箱或手机号登录。'
            : '用邮箱或手机号注册，开始你的编程学习之旅。'}
        </p>
        <div className="cv-auth__hero-footer"><span>LOCAL FIRST</span><span>代码 · 思考 · 成长</span></div>
      </section>

      {/* 宇宙播放/暂停按钮：放在左列，作为 scene 的兄弟。
          不放进 scene 里面（scene 要求零 focusable 后代），也不放进 content
          （content 的 aria-label="工作台介绍" 不覆盖控件）。 */}
      <div className="cv-auth__scene-controls">
        <button
          type="button"
          className="cv-auth__scene-btn"
          onClick={toggleUserPaused}
          aria-pressed={userPaused}
          aria-label={userPaused ? '播放背景动画' : '暂停背景动画'}
        >
          {userPaused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
        </button>
      </div>

      {/* ── 右栏：登录动作本身。眉标 + 表单 + 切换 + 页脚 ── */}
      <section className="cv-auth__panel" aria-label={mode === 'login' ? '登录' : '注册'}>
        <header className="cv-auth__panel-header">
          <p className="cv-auth__eyebrow"><span className="cv-auth__eyebrow-index">▪</span> CODECANVAS CORE ACCESS</p>
          <h2>{mode === 'login' ? '接入工作区' : '开启学习旅程'}</h2>
          <span className="cv-auth__gateway">{mode === 'login' ? 'PASSWORD ACCESS' : 'CREATE ACCOUNT'}</span>
        </header>

        <form
          ref={formRef}
          className="cv-auth__form"
          aria-busy={busy}
          onSubmit={handleSubmit}
          onKeyDown={handleKeyDown}
        >
          {mode === 'register' && (
            <>
              <label className="cv-auth__field">
                <span className="cv-auth__field-label">昵称</span>
                <input
                  className="cv-auth__input"
                  name="name"
                  type="text"
                  placeholder="你的昵称"
                  minLength={2}
                  maxLength={40}
                  required
                  autoComplete="name"
                />
              </label>
              <label className="cv-auth__field cv-auth__field--select">
                <span className="cv-auth__field-label">联系方式</span>
                <select
                  className="cv-auth__select"
                  name="contactType"
                  value={contactType}
                  onChange={(event) => setContactType(event.target.value as ContactType)}
                  required
                >
                  <option value="email">邮箱</option>
                  <option value="phone">手机号</option>
                </select>
              </label>
              <label className="cv-auth__field" htmlFor={contactId}>
                <span className="cv-auth__field-label">{isPhone ? '手机号' : '邮箱'}</span>
                <input
                  className="cv-auth__input"
                  id={contactId}
                  name="contact"
                  type={isPhone ? 'tel' : 'email'}
                  inputMode={isPhone ? 'tel' : 'email'}
                  placeholder={isPhone ? '13800138000' : 'your@email.com'}
                  required
                  autoComplete={isPhone ? 'tel' : 'email'}
                />
              </label>
            </>
          )}
          {mode === 'login' && (
            <label className="cv-auth__field">
              <span className="cv-auth__field-label">邮箱或手机号</span>
              <input
                className="cv-auth__input"
                name="identifier"
                type="text"
                placeholder="your@email.com 或 13800138000"
                required
                autoComplete="username"
              />
            </label>
          )}
          <label className="cv-auth__field" htmlFor={passwordId}>
            <span className="cv-auth__field-label">密码</span>
            <span className="cv-auth__password">
              <input
                className="cv-auth__input"
                id={passwordId}
                name="password"
                type={showPassword ? 'text' : 'password'}
                placeholder={`至少 ${PASSWORD_MIN_LENGTH} 个字符`}
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
                required
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                aria-describedby={noticeId}
              />
              {/* LOGIN-01 第 6 条：动作标签随状态改字（显示↔隐藏）又同时挂 aria-pressed，
                  按下后会被读成「显示密码，已按下」——名字说要做的动作与状态自相矛盾。
                  改为稳定名称 + 按压态，动作提示留在 title 里给目视用户。 */}
              <button
                type="button"
                className="cv-auth__toggle"
                onClick={() => setShowPassword((current) => !current)}
                aria-label="密码可见性"
                aria-pressed={showPassword}
                title={showPassword ? '隐藏密码' : '显示密码'}
              >
                {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
              </button>
            </span>
          </label>
          {error && (
            <div className="cv-auth__notice auth-error" id="auth-error" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
          {!error && connectionHint && (
            <div className="cv-auth__notice auth-error" id="auth-connection" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{connectionHint}</span>
            </div>
          )}
          {/* 细线主按钮：黑场 + 发丝线 + 药丸，无渐变、无泛光（§5.1 表「形态」行） */}
          {/* §4 disabled 行：改版前忙态只把整颗按钮压到 opacity .56，界面没说为什么按不了。
              条件只有一条（上一次请求还没返回），所以直接写成一句可见的话，
              并同时给提交按钮与模式切换按钮用 aria-describedby 指过来。 */}
          {busy && (
            <p className="cv-auth__disabled-hint" id={busyHintId} role="status">
              现在不能提交，也不能切换登录 / 注册：上一次的请求还没返回，返回后这两处自动恢复可点。
            </p>
          )}
          <button
            type="submit"
            className="auth-submit cv-auth__submit"
            disabled={busy}
            aria-disabled={busy || undefined}
            aria-describedby={busy ? busyHintId : undefined}
            data-busy={busy ? 'true' : undefined}
          >
            <LogIn size={16} aria-hidden="true" />
            <span>{busy ? SUBMIT_LABEL[mode].busy : SUBMIT_LABEL[mode].idle}</span>
          </button>
        </form>

        <div className="cv-auth__switch">
          {mode === 'login' ? '还没有账户？' : '已经有账户了？'}
          <button
            type="button"
            className="cv-auth__link"
            disabled={busy}
            aria-disabled={busy || undefined}
            aria-describedby={busy ? busyHintId : undefined}
            onClick={() => onModeChange(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? '注册新账户' : '返回登录'}
          </button>
        </div>

        <p className="cv-auth__foot">
          <span><ShieldCheck size={13} aria-hidden="true" /> 本地账户 · 独立学习空间</span>
          <span>密码 {PASSWORD_MIN_LENGTH}–{PASSWORD_MAX_LENGTH} 位</span>
        </p>
      </section>
    </div>
  )
}
