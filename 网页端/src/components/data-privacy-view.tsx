import { Activity, AlertCircle, CheckCircle2, Database, Download, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import type { AuthUser } from '../hooks/use-auth'
import { scopedKey } from '../utils/constants'
import {
  applyImport,
  previewImport,
  type ImportDecision,
  type ImportPreview,
  type ImportResult,
  type ImportStatus,
} from '../utils/local-data'
import type { ClearResult } from '../utils/local-data'
import { readSavedAtState } from '../utils/storage'
import { STORAGE_REGISTRY } from '../utils/storage-registry'
import './account-domain.css'

/**
 * F4 数据与隐私中心（账户域）：展示各类学习数据的存储位置与最后保存时间；
 * 导出文件只包含学习记录与代码草稿（localStorage 中的 code-canvas.* 键），
 * 认证凭据（users.json）是服务端文件，不在导出范围内。
 *
 * 恢复走「先预览、后确认」：预览给出 scope / 版本 / 逐项状态，默认不覆盖目标已有记录，
 * 跨账户与未注册键在界面上就不允许勾选（§6.2、DATA-09）。
 *
 * M4 呈现层统一（§5.2 末行）：与账户/设置同一套字体、细线表单、按钮与状态标识。
 * previewImport / applyImport / onClearLocalData 的调用与判定语义一字未动；
 * 「部分失败不得显示成功」由 cw-privacy-clear-state 区域承担（原先是 window.alert，
 * 关掉就查无实据，留字面状态更诚实也更可测）。
 */

type DataPrivacyViewProps = {
  user: AuthUser
  onExportData: () => void
  onClearLocalData: () => ClearResult
}

/**
 * DATA-01 第 1/2/3 条：这张清单**由存储注册表生成**，不再手写第三份类别列表。
 * 改版前这里是手写的 `BASE_LABELS`：缺「外部环境实验证据」与「通知事件记录」两类，
 * 且对所有键（含设备级的偏好设置）都加账户后缀——于是那一行永远显示「从未保存」。
 * 现在按描述符的 scope 决定读哪个键、位置那一列怎么写，时间戳读不到也不谎称「从未保存」。
 */
function savedAtText(key: string): string {
  const reading = readSavedAtState(key)
  if (reading.state === 'saved') return new Date(reading.iso).toLocaleString('zh-CN')
  if (reading.state === 'no-timestamp') return '旧版数据，保存时间未知'
  if (reading.state === 'unreadable') return '数据在但读不出来（时间未知）'
  return '未写入过'
}

type LedgerRow = { label: string; location: string; savedAt: string; key: string }

function registryRows(scope: string): LedgerRow[] {
  const rows: LedgerRow[] = []
  for (const descriptor of STORAGE_REGISTRY) {
    const accountBound = descriptor.scope === 'account' || descriptor.scope === 'session'
    const key = accountBound ? scopedKey(descriptor.baseKey, scope) : descriptor.baseKey
    rows.push({
      key: descriptor.baseKey,
      label: descriptor.label,
      location: accountBound ? '本机浏览器（localStorage，按账户隔离）' : '本机浏览器（localStorage，设备级，与本账户无关）',
      savedAt: savedAtText(key),
    })
    if (!accountBound) continue
    // 旧的未加后缀键：归属未知，既没迁移也没删除，所以必须在这张表里看得见（第 3 条）。
    const legacy = readSavedAtState(descriptor.baseKey)
    if (legacy.state !== 'absent') {
      rows.push({
        key: `${descriptor.baseKey}!legacy`,
        label: `${descriptor.label}（旧版未隔离数据）`,
        location: '本机浏览器（localStorage，键未带账户后缀，归属未知）',
        savedAt: legacy.state === 'saved' ? `已有数据（未逐条核对）· ${savedAtText(descriptor.baseKey)}` : '已有数据（未逐条核对）',
      })
    }
  }
  return rows
}

export function DataPrivacyView({ user, onExportData, onClearLocalData }: DataPrivacyViewProps) {
  const scope = user.id
  const [clearResult, setClearResult] = useState<ClearResult | null>(null)
  const rows = registryRows(scope)
  /** 确认框里的类别数量由注册表现算，不另写一个常量（写死的那个数字一定会过期）。 */
  const accountBoundCount = STORAGE_REGISTRY.filter(
    (descriptor) => descriptor.scope === 'account' || descriptor.scope === 'session',
  ).length

  const clearScopedLocalData = () => {
    if (
      !window.confirm(
        `确定清除本机学习数据吗？只清当前账户的学习记录与会话状态（注册表里 ${accountBoundCount} 类），` +
          '账户资料与设备级偏好不受影响，旧版未加账户后缀的键也不会被本次操作删除，操作不可撤销。',
      )
    )
      return
    // 部分失败不得显示成功：如实留下未删除的项数与下一步（§5.2「按范围清除」）。
    setClearResult(onClearLocalData())
  }
  const clearError = clearResult && !clearResult.removed
    ? `清除未完成：${clearResult.failedKeys.length} 项数据删除失败，已保留未删除的数据。请重试或检查浏览器存储权限。`
    : ''
  const clearOk = clearResult && clearResult.removed
    ? `已清除 ${clearResult.keys.length} 个键、涉及 ${clearResult.categories} 类数据。设备级偏好与旧版未隔离键未纳入本次范围。`
    : ''

  return (
    <section className="data-privacy-view cw-account cw-privacy">
      <div className="module-heading">
        <div>
          <p className="eyebrow">账户域</p>
          <h1>数据与隐私</h1>
          <p>学习数据全部保存在本机；导出文件只含学习记录与代码草稿，不含认证凭据。</p>
        </div>
        <button className="primary-action cw-account-btn" onClick={onExportData}>
          <Download size={14} />
          导出学习数据（JSON）
        </button>
      </div>

      <section className="profile-overview-card cw-account-card">
        <h2 className="security-card-title cw-account-title">
          <Database size={14} />
          数据类别与存储位置
        </h2>
        <div className="cw-privacy-scroll">
          <table className="data-table cw-account-table">
            <caption className="cw-account-caption">各类学习数据的存储位置与最后保存时间</caption>
            <thead>
              <tr>
                <th scope="col">数据类别</th>
                <th scope="col">存储位置</th>
                <th scope="col">最后保存</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td data-ca-meta="1">{row.location}</td>
                  {/* #95：时间戳是原子值，320 档实测这一列 97px 会把它折成约 3 行 */}
                  <td data-ca-meta="1" className="cw-ca-time">{row.savedAt}</td>
                </tr>
              ))}
              <tr>
                <td>账户资料（昵称 / 联系方式 / 密码哈希）</td>
                <td data-ca-meta="1">本地服务 data/users.json（密码为 scrypt 哈希，不参与导出）</td>
                <td data-ca-meta="1">由服务端在写入时管理</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <ImportPanel scope={scope} />

      <section className="profile-overview-card cw-account-card">
        <h2 className="security-card-title cw-account-title">
          <Activity size={14} />
          隐私边界
        </h2>
        <ul className="security-notes cw-account-list">
          <li>学习数据按账户 ID 作用域隔离：同一浏览器不同账号互不可见。</li>
          <li>
            这是<strong>应用级分区</strong>，不是对本机管理员或开发者工具的加密保护——
            能访问本机浏览器存储的人仍可看到这些数据。
          </li>
          <li>导出 JSON 只包含当前账户的学习数据，带 schema 与版本标识，不含登录 Cookie、密码哈希与设备设置。</li>
          <li>
            导出会对 <code>password</code>、<code>token</code> 等<strong>字段名</strong>做过滤，
            但这不等于对内容做密钥检测：你自己写进代码、笔记或实验证据里的敏感内容不会被识别，
            分享导出文件前请自行检查。
          </li>
          <li>清除本机学习数据只移除当前账户的学习记录与会话状态，设备级偏好（工作台设置）保留，操作不可撤销。若部分数据删除失败，界面会如实说明而不会显示成功。</li>
        </ul>
        <div className="account-actions cw-account-actions">
          <button className="danger-button cw-account-btn cw-account-btn--danger" onClick={clearScopedLocalData}>
            清除本机学习数据
          </button>
        </div>
        {clearError ? (
          <div className="cw-account-status cw-account-status--error" role="alert">
            <AlertCircle size={14} aria-hidden="true" />
            <span className="cw-account-status-text">{clearError}</span>
          </div>
        ) : null}
        {/* DATA-01 第 4 条：成功也要把「动了多少键、涉及几类」说出口，而不是只让按钮消失。 */}
        {clearOk ? (
          <div className="cw-account-status cw-account-status--ok" role="status">
            <CheckCircle2 size={14} aria-hidden="true" />
            <span className="cw-account-status-text">{clearOk}</span>
          </div>
        ) : null}
      </section>
    </section>
  )
}

const STATUS_LABELS: Record<ImportStatus, string> = {
  new: '空位可恢复',
  conflict: '目标已有不同内容',
  identical: '内容相同',
  'cross-scope': '属于其他账户',
  rejected: '被拒绝',
}

/** 只有「空位」与「冲突」可由用户决定；其余是数据层硬性不写，界面上也不给勾。 */
const DECIDABLE: ImportStatus[] = ['new', 'conflict']

function ImportPanel({ scope }: { scope: string }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [payload, setPayload] = useState<unknown>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [decisions, setDecisions] = useState<Record<string, ImportDecision>>({})
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')

  function reset(): void {
    setPreview(null)
    setPayload(null)
    setDecisions({})
    setError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  async function onPick(file: File | undefined): Promise<void> {
    reset()
    setResult(null)
    if (!file) return
    let parsed: unknown
    try {
      parsed = JSON.parse(await file.text())
    } catch (cause) {
      setError(`文件读不了或不是合法 JSON：${cause instanceof Error ? cause.message : String(cause)}`)
      return
    }
    const next = previewImport(parsed, scope)
    setPayload(parsed)
    setPreview(next)
    setDecisions(Object.fromEntries(next.items.map((item) => [item.key, item.decision])))
    if (!next.ok) setError(next.errors.join('；') || '预览未通过')
  }

  function confirmImport(): void {
    if (!preview?.ok) return
    const next = applyImport(payload, scope, decisions)
    setResult(next)
    reset()
  }

  const chosen = preview?.items.filter((item) => decisions[item.key] === 'import') ?? []

  return (
    <section className="profile-overview-card cw-account-card">
      <h2 className="security-card-title cw-account-title">
        <Upload size={14} /> 从导出文件恢复
      </h2>
      <p className="cw-account-note">预览不写任何数据，也不会替你决定：默认只填目标位置尚无数据的条目，已有数据的要靠你逐项勾选才会替换；不属于本账户的键与未注册的键不给勾选、也不会写入。</p>
      <label className="field-label cw-account-field" htmlFor="learning-data-import-file">
        选择导出的 JSON 文件
        <input
          id="learning-data-import-file"
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={(event) => void onPick(event.target.files?.[0])}
        />
      </label>
      {error ? (
        <div className="auth-error cw-privacy-import-state" role="alert">
          {error}
        </div>
      ) : null}
      {preview?.ok ? (
        <>
          <p className="cw-account-status cw-account-status--notice" role="status">
            来源账户 {preview.source?.scope}（格式版本 {preview.source?.version}，导出时间 {preview.source?.exportedAt || '未记录'}）；
            本次将写入 {chosen.length} 项 / 文件内共 {preview.items.length} 项。
          </p>
          <div className="cw-privacy-scroll">
            <table className="data-table cw-account-table">
              <caption className="cw-account-caption">导出文件逐项预览：目标状态、大小与本次处理</caption>
              <thead>
                <tr>
                  <th scope="col">数据类别</th>
                  <th scope="col">目标状态</th>
                  <th scope="col">大小</th>
                  <th scope="col">本次处理</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.map((item) => (
                  <tr key={item.key}>
                    <td>{item.label}</td>
                    <td data-ca-meta="1">
                      {STATUS_LABELS[item.status]}
                      {item.reason ? `（${item.reason}）` : ''}
                    </td>
                    <td data-ca-meta="1">{item.bytes} B</td>
                    <td>
                      {DECIDABLE.includes(item.status) ? (
                        <label>
                          <input
                            type="checkbox"
                            checked={decisions[item.key] === 'import'}
                            onChange={(event) =>
                              setDecisions((current) => ({
                                ...current,
                                [item.key]: event.target.checked ? 'import' : 'skip',
                              }))
                            }
                          />
                          {item.status === 'conflict' ? '覆盖现有记录' : '恢复'}
                        </label>
                      ) : (
                        <span>不写入</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="account-actions cw-account-actions">
            <button className="primary-action cw-account-btn" onClick={confirmImport}>
              确认导入（{chosen.length} 项）
            </button>
            <button className="subtle-button cw-account-btn" onClick={reset}>
              取消
            </button>
          </div>
        </>
      ) : null}
      {result ? (
        <div className="cw-privacy-result" role="status">
          <p className={`cw-account-status ${result.failed.length ? 'cw-account-status--error' : 'cw-account-status--ok'}`}>
            {result.failed.length ? (
              <AlertCircle size={14} aria-hidden="true" />
            ) : (
              <CheckCircle2 size={14} aria-hidden="true" />
            )}
            <span className="cw-account-status-text">
              已写入 {result.applied.length} 项，跳过 {result.skipped.length} 项，失败 {result.failed.length} 项。
              {result.rolledBack ? ' 写入过程中出现失败，本次写入的键已全部恢复原值。' : ''}
            </span>
          </p>
          {result.unresolved.length ? (
            <div className="auth-error cw-privacy-import-state">
              有 {result.unresolved.length} 项恢复不回去，需要手工核对：{result.unresolved.map((item) => item.key).join('、')}
            </div>
          ) : null}
          {result.applied.length ? (
            <div className="account-actions cw-account-actions">
              <button className="primary-action cw-account-btn" onClick={() => window.location.reload()}>
                重新载入以查看恢复结果
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
