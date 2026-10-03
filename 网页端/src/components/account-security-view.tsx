import { useState } from 'react'
import { KeyRound, ShieldCheck, ShieldAlert } from 'lucide-react'
import { describeLoginMethod } from '../utils/privacy'
import type { AuthUser } from '../hooks/use-auth'
import './account-domain.css'

/**
 * 账户安全（N2，账户域独立页面）：
 * - 当前登录方式（脱敏）
 * - 修改密码（当前密码 / 新密码 / 确认新密码）
 * - 会话说明（真实策略：内存会话，重启需重新登录；上限 500）
 * - 删除账户：后端未实现，明确显示“尚未开放”，不伪造成功
 *
 * M4 呈现层统一（§5.2「账户、设置、隐私和弹窗」）：与全站同一套字体、细线表单、
 * 按钮与状态标识。**改密的网络调用、判定与文案语义一字未动。**
 */

type AccountSecurityViewProps = {
  user: AuthUser
  onLogout: () => void
}

export function AccountSecurityView({ user, onLogout }: AccountSecurityViewProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const changePassword = async () => {
    setError('')
    setMessage('')
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致')
      return
    }
    setBusy(true)
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) {
        setError(payload.error ?? '修改失败')
        return
      }
      setMessage('密码已修改，其他设备已退出登录')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch {
      setError('网络错误，请确认本地服务已启动')
    } finally {
      setBusy(false)
    }
  }

  const statusText = error || message
  /**
   * 01 号方案 §4 的 disabled 行：改版前这颗按钮只被共享层压到 opacity .5，
   * 界面没说「为什么按不了」。禁用条件本来只有两种（正在提交 / 三项没填齐），
   * 所以两种各写一句实话，并用 aria-describedby 指给读屏。
   */
  const submitDisabled = busy || !currentPassword || !newPassword || !confirmPassword
  const disabledHintId = 'account-password-submit-hint'
  const disabledHint = busy
    ? '现在不能提交：上一次改密请求还没返回，返回后这一档自动恢复可点。'
    : '现在不能提交：当前密码、新密码、确认新密码三项都必须填写。'

  return (
    <section className="security-view cw-account cw-security">
      <div className="module-heading">
        <div>
          <p className="eyebrow">账户域</p>
          <h1>账户安全</h1>
          <p>管理登录凭证与设备会话。</p>
        </div>
        <button className="subtle-button cw-account-btn" onClick={onLogout}>
          退出当前设备
        </button>
      </div>

      <div className="security-layout">
        <section className="security-card">
          <h2 className="security-card-title">
            <ShieldCheck size={14} />
            当前登录方式
          </h2>
          <p className="security-line">{describeLoginMethod(user)}</p>
          <h2 className="security-card-title">
            <KeyRound size={14} />
            会话说明
          </h2>
          <ul className="security-notes cw-account-list">
            <li>登录会话保存在服务内存中：服务重启后所有设备需要重新登录。</li>
            {/* 这句以前写的是「会话有效期 7 天；同一账号最多 500 个会话，超限淘汰最早登录的设备」，
                与 `server.mjs` 的实际行为有三处不符：过期是按最近使用的**滑动**过期（:285-292），
                500 是**整个实例**的上限而非每账号（:306 判的是全局 sessions.size），
                淘汰的是**最久未使用**而非最早登录（:307-310 配 :296-299 的 LRU 重排）。 */}
            <li>
              会话按最近使用滑动过期：连续空闲满 7 天才失效，持续使用不会被强制登出。
            </li>
            <li>
              整个实例同时最多保留 500 个会话（可用环境变量 CODE_CANVAS_MAX_SESSIONS 调整），
              超出时淘汰最久未使用的那个——这是实例级的上限，不是每个账号各 500 个。
            </li>
            <li>修改密码后，除当前设备外的所有会话立即失效。</li>
          </ul>
        </section>

        <section className="security-card">
          <h2 className="security-card-title">修改密码</h2>
          <label className="field-label cw-account-field">
            当前密码
            <input
              type="password"
              value={currentPassword}
              autoComplete="current-password"
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label className="field-label cw-account-field">
            新密码（至少 8 个字符）
            <input
              type="password"
              value={newPassword}
              autoComplete="new-password"
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <label className="field-label cw-account-field">
            确认新密码
            <input
              type="password"
              value={confirmPassword}
              autoComplete="new-password"
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
          {submitDisabled && (
            <p className="cw-account-disabled-hint" id={disabledHintId}>
              {disabledHint}
            </p>
          )}
          <div className="security-form-footer">
            <span
              className={`cw-account-status ${error ? 'security-error cw-account-status--error' : 'security-ok cw-account-status--ok'}`}
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
              onClick={changePassword}
              disabled={submitDisabled}
              aria-disabled={submitDisabled || undefined}
              aria-describedby={submitDisabled ? disabledHintId : undefined}
            >
              {busy ? '提交中…' : '修改密码'}
            </button>
          </div>
        </section>

        <section className="security-card security-danger cw-account-card--danger">
          <h2 className="security-card-title">
            <ShieldAlert size={14} />
            删除账户
          </h2>
          <p className="security-line cw-account-note">
            删除账户将清除服务端账号与全部学习记录，属于不可逆操作。
          </p>
          <p className="security-line security-locked cw-account-note cw-account-note--locked">
            该功能尚未开放。当前版本不提供删除入口，也不会伪造删除成功。
          </p>
        </section>
      </div>
    </section>
  )
}
