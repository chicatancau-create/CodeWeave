import { useState } from 'react'
import { BarChart3, Database, LogOut, Save, ShieldCheck, UserRound, Fingerprint, Terminal } from 'lucide-react'
import { masteryLevelName, type MasteryLevel } from '../data/mastery'
import { VaultProgressCard } from './vault-progress-view'
import { EvidenceWritebackPanel } from './evidence-writeback-view'
import type { StageMasteryRow } from '../utils/mastery-view'
import type { AuthUser } from '../hooks/use-auth'
import type { ClearResult } from '../utils/local-data'
import './account-domain.css'
import './profile-view.css'

type ProfileViewProps = {
  user: AuthUser
  /** 单一账户更新入口（复用 useAuth.updateUser，避免重复 PATCH 实现） */
  onUpdateUser: (updates: Partial<Pick<AuthUser, 'name' | 'bio'>>) => Promise<AuthUser | null>
  onLogout: () => void
  /** 进入复习中心 */
  onNavigateReviews: () => void
  /** 掌握度地图（按 A—M 阶段聚合） */
  stageMastery: StageMasteryRow[]
  /** 学习概览计数（只展示真实统计，无数据的项显示“未统计”） */
  completedLessons: number
  completedChallenges: number
  dueCount: number
  onExportData: () => void
  onClearLocalData: () => ClearResult
  onNavigateSecurity: () => void
}

function getContact(user: AuthUser): string {
  return user.email ?? user.phone ?? '未设置联系方式'
}

/**
 * 个人中心（账户域）。M4 只统一呈现层（§5.2「账户、设置、隐私和弹窗」）：
 * 保存资料、导出、按范围清除、跳转的调用与判定都不改；
 * 本页嵌着别人的面板（VaultProgressCard / EvidenceWritebackPanel），
 * 因此样式只走 `.cw-account-*` 自有类名，不用全局类名作右端主语。
 */
export function ProfileView({
  user,
  onUpdateUser,
  onLogout,
  onNavigateReviews,
  stageMastery,
  completedLessons,
  completedChallenges,
  dueCount,
  onExportData,
  onClearLocalData,
  onNavigateSecurity,
}: ProfileViewProps) {
  const [name, setName] = useState(user.name)
  const [bio, setBio] = useState(user.bio)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  /** 按范围清除的结果说明：部分失败必须留字面提示，不得静默当作成功。 */
  const [clearError, setClearError] = useState('')

  const save = async () => {
    setBusy(true)
    setError('')
    setMessage('')

    try {
      const updated = await onUpdateUser({ name, bio })
      if (updated) {
        setName(updated.name)
        setBio(updated.bio)
        setMessage('个人信息已保存')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const clearLocalLearningData = () => {
    if (!window.confirm('确定清除本机学习数据吗？只清当前账户的学习记录与会话状态，账户资料与设备级偏好不受影响，操作不可撤销。')) return
    const result = onClearLocalData()
    // DATA-01 第 4 条：只有全部成功才由调用方重载；
    // 失败时在此如实说明，不得静默当作成功。
    setClearError(
      result.removed
        ? ''
        : `清除未完成：${result.failedKeys.length} 项数据删除失败，已保留未删除的数据。请重试或检查浏览器存储权限。`,
    )
  }

  const statusText = error || message
  /** §4 disabled 行：保存按钮在忙态下被共享层压成半透明，界面从没说为什么；这一句就是原因。 */
  const saveHintId = 'profile-save-disabled-hint'

  return (
    <section className="profile-view cw-account cw-profile">
      <div className="cw-profile-connection"><span><span className="cw-profile-dot" /> 个人空间</span><span>LOCAL ACCOUNT / 学习数据与资料库</span><span>CodeCanvas Desktop</span></div>
      <div className="cw-profile-layout">
        <aside className="cw-profile-sidebar" aria-label="个人档案与账户操作">
        <section className="profile-card cw-profile-identity">
          <div className="profile-card-top">
            <div className="profile-large-avatar" aria-hidden="true">
              {user.name.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <h2>{user.name}</h2>
              <p>{getContact(user)}</p>
            </div>
          </div>
          <p className="cw-profile-member"><Fingerprint size={13} aria-hidden="true" /> 本地学习账户</p>
          <div className="profile-meta">
            <span>加入时间</span>
            <strong>{new Date(user.createdAt).toLocaleDateString('zh-CN')}</strong>
          </div>
          <p className="cw-profile-bio">{user.bio || '记录思考，持续构建。你的下一步进步，从这里开始。'}</p>
          <div className="cw-profile-local"><Terminal size={14} aria-hidden="true" /><span>CodeCanvas Desktop</span><span>LOCAL</span></div>
        </section>

      {/* ④ 账户操作 */}
      <section className="profile-overview-card cw-account-card cw-profile-operations">
        <h3 className="security-card-title cw-account-title">
          <Database size={14} />
          账户操作
        </h3>
        <div className="account-actions cw-account-actions">
          <button className="subtle-button cw-account-btn" onClick={onNavigateSecurity}>
            <ShieldCheck size={14} />
            修改密码 / 账户安全
          </button>
          <button className="subtle-button cw-account-btn" onClick={onExportData}>
            <Database size={14} />
            导出学习数据（JSON）
          </button>
          <button className="danger-button cw-account-btn cw-account-btn--danger" onClick={clearLocalLearningData}>
            清除本机学习数据
          </button>
          <button className="subtle-button logout-button cw-account-btn" onClick={onLogout}>
            <LogOut size={14} />
            退出登录
          </button>
        </div>
        {clearError ? (
          <span className="cw-account-status cw-account-status--error" role="alert">
            <span className="cw-account-status-glyph" aria-hidden="true">
              ×
            </span>
            <span className="cw-account-status-text">{clearError}</span>
          </span>
        ) : null}
      </section>
        </aside>
        <div className="cw-profile-main">
      <div className="module-heading">
        <div>
          <p className="eyebrow">PERSONAL WORKSPACE / 账户域</p>
          <h1>个人中心</h1>
          <p>管理你的学习空间，让每一步成长都有迹可循。</p>
        </div>
        <button className="subtle-button cw-account-btn" onClick={onNavigateSecurity}>
          <ShieldCheck size={14} />
          账户安全
        </button>
      </div>

      {/* ② 学习概览（只展示真实统计） */}
      <section className="profile-overview-card cw-account-card cw-profile-overview">
        <h3 className="security-card-title cw-account-title">
          <BarChart3 size={14} />
          学习概览
        </h3>
        <button className="subtle-button cw-account-btn" onClick={onNavigateReviews}>
          去复习中心
        </button>
        <div className="overview-stats">
          <div className="overview-stat">
            <strong>{completedLessons}</strong>
            <span>已完成单元</span>
          </div>
          <div className="overview-stat">
            <strong>{completedChallenges}</strong>
            <span>挑战通过</span>
          </div>
          <div className="overview-stat">
            <strong>{dueCount}</strong>
            <span>今日待复测</span>
          </div>
          <div className="overview-stat">
            <strong title="学习时长统计尚未实现">未统计</strong>
            <span>学习时长</span>
          </div>
        </div>
      </section>

          <div className="cw-profile-panels">
            <div className="cw-profile-panel-column">
        <section className="profile-form cw-profile-edit">
          <h2 className="cw-profile-panel-title"><UserRound size={15} aria-hidden="true" /> 编辑个人资料</h2>
          <label className="field-label cw-account-field">
            昵称
            <input value={name} minLength={2} maxLength={40} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field-label cw-account-field">
            个人简介
            <textarea value={bio} maxLength={160} onChange={(e) => setBio(e.target.value)} />
          </label>
          {busy && (
            <p className="cw-account-disabled-hint" id={saveHintId}>
              现在不能保存：上一次保存还没返回，返回后这一档自动恢复可点。
            </p>
          )}
          <div className="profile-form-footer">
            <span
              className={`cw-account-status ${error ? 'error cw-account-status--error' : 'cw-account-status--ok'}`}
              role={error ? 'alert' : 'status'}
            >
              {statusText ? (
                <>
                  <span className="cw-account-status-glyph" aria-hidden="true">
                    {error ? '×' : '✓'}
                  </span>
                  <span className="cw-account-status-text">{statusText}</span>
                </>
              ) : null}
            </span>
            <button
              className="primary-action cw-account-btn"
              onClick={save}
              disabled={busy}
              aria-disabled={busy || undefined}
              aria-describedby={busy ? saveHintId : undefined}
            >
              {busy ? '保存中…' : '保存修改'} <Save size={14} />
            </button>
          </div>
        </section>
      {/* ③ 掌握度地图（A—M 阶段 × 0—6 级 × 证据数） */}
      <section className="profile-overview-card cw-account-card cw-profile-mastery">
        <h3 className="security-card-title cw-account-title">
          <UserRound size={14} />
          掌握度地图（阶段 · 0—6 级）
        </h3>
        {stageMastery.length === 0 && <p className="cw-profile-empty">完成首次练习后，这里会呈现各阶段的掌握度与学习证据。</p>}
        <ul className="mastery-map">
          {stageMastery.map((row) => (
            <li key={row.stageId}>
              <span className="mastery-map-stage">{row.stageId}</span>
              <span className="mastery-map-title" title={row.title}>{row.title}</span>
              <div className="mastery-bar" role="img" aria-label={`${row.stageId} 阶段掌握等级 ${row.level}（共 6 级），证据 ${row.evidenceCount} 条`}>
                <span style={{ width: `${(row.level / 6) * 100}%` }} />
              </div>
              <small className="mastery-map-level">{masteryLevelName(row.level as MasteryLevel)}</small>
              <small className="mastery-map-count">证据 {row.evidenceCount}</small>
            </li>
          ))}
        </ul>
      </section>

            </div>
            <div className="cw-profile-panel-column cw-profile-library" aria-label="资料库与学习证据">
              <VaultProgressCard />
              <EvidenceWritebackPanel />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
