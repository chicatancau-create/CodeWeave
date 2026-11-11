import { X, Lightbulb, Settings2, Trash2, Download } from 'lucide-react'
import { clearLocalData } from '../utils/local-data'
import { useEscapeToClose, useModalFocusTrap } from '../hooks/use-modal-focus'
import './modals.css'

export type AppSettings = {
  notifications?: boolean
  compactMode?: boolean
  autosave?: boolean
  editorFontSize?: number
  reduceMotion?: boolean
  /** EDIT-01：一次 Tab 进/退几格。只有 2 / 4 两档，默认 2 与基座 CSS 的 `tab-size` 一致。 */
  editorTabSize?: number
  /** EDIT-01：编辑器自动换行。默认关——§5.4「长代码行」量的就是关着时的横向滚动。 */
  editorWordWrap?: boolean
  /** EDIT-01：行号层开关。关掉只是不画，一个字符都不改文本。 */
  editorLineNumbers?: boolean
}

type SettingsModalProps = {
  settings: AppSettings
  onChange: (updates: Partial<AppSettings>) => void
  onClose: () => void
  /** 导出本机学习数据为 JSON 文件 */
  onExport: () => void
  /** 恢复默认偏好 */
  onRestoreDefaults: () => void
}

/**
 * 设置弹窗（R6 + §5.2「账户、设置、隐私和弹窗」）。
 *
 * 交互契约一条都不能掉（由 modals.test.tsx 与 modals.m4.test.tsx 共同守住）：
 * - role="dialog" + aria-modal + aria-labelledby
 * - 打开时初始焦点落在 [data-autofocus]（关闭按钮），Tab 在弹窗内循环
 * - Escape 关闭、点遮罩关闭、点弹窗内部不关闭
 * - 关闭后焦点归还触发元素（use-modal-focus 的 cleanup）
 * - 破坏性操作先确认；确认后走统一入口 clearLocalData('all')
 *
 * M4 只做呈现层统一：黑场遮罩 + 1px 发丝线边界 + 同一字体/按钮/表单/焦点体系，
 * 类名保留原有的全局钩子，另加 `.cw-modal*` 前缀供 components/modals.css 作用域覆写。
 */
export function SettingsModal({ settings, onChange, onClose, onExport, onRestoreDefaults }: SettingsModalProps) {
  const dialogRef = useModalFocusTrap<HTMLElement>()
  useEscapeToClose(onClose)

  const handleClearLocalData = () => {
    if (!window.confirm('确定清除本机全部学习数据吗？账户资料不会受到影响，但本机所有账户的进度、草稿、打卡与偏好都会被删除。')) return
    // 统一入口（R2-C）：'all' 与数据隐私中心的说明保持同一范围定义。
    clearLocalData('all')
    window.location.reload()
  }

  return (
    <div className="modal-backdrop cw-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={dialogRef}
        className="settings-modal cw-modal cw-modal--settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header cw-modal-head">
          <div>
            <p className="eyebrow cw-modal-eyebrow">工作台偏好</p>
            <h2 id="settings-title" className="cw-modal-title">
              设置
            </h2>
          </div>
          <button className="icon-button cw-modal-close" aria-label="关闭设置" data-autofocus onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="settings-section cw-modal-section">
          <h3 className="settings-section-head cw-modal-section-head">
            学习体验
            <button className="subtle-button" onClick={onRestoreDefaults}>
              恢复默认
            </button>
          </h3>
          <label className="setting-row cw-modal-row">
            <span className="cw-modal-row-text">
              <strong>学习提醒</strong>
              <small>在本机保留学习提醒状态</small>
            </span>
            <input
              type="checkbox"
              checked={settings.notifications ?? true}
              onChange={(e) => onChange({ notifications: e.target.checked })}
            />
          </label>
          <label className="setting-row cw-modal-row">
            <span className="cw-modal-row-text">
              <strong>编辑器自动保存</strong>
              <small>修改课程代码时自动保存到本机（关闭后可用 Ctrl+S 手动保存）</small>
            </span>
            <input
              type="checkbox"
              checked={settings.autosave ?? true}
              onChange={(e) => onChange({ autosave: e.target.checked })}
            />
          </label>
          <label className="setting-row cw-modal-row">
            <span className="cw-modal-row-text">
              <strong>紧凑工作区</strong>
              <small>减少面板间距，显示更多代码内容</small>
            </span>
            <input
              type="checkbox"
              checked={settings.compactMode ?? false}
              onChange={(e) => onChange({ compactMode: e.target.checked })}
            />
          </label>
          <label className="setting-row cw-modal-row">
            <span className="cw-modal-row-text">
              <strong>减弱动画</strong>
              <small>关闭过渡与闪烁动画，保持静态界面</small>
            </span>
            <input
              type="checkbox"
              checked={settings.reduceMotion ?? false}
              onChange={(e) => onChange({ reduceMotion: e.target.checked })}
            />
          </label>
          <label className="setting-row cw-modal-row">
            <span className="cw-modal-row-text">
              <strong>编辑器字号</strong>
              <small>调整代码编辑区的字体大小</small>
            </span>
            <select
              className="setting-select cw-modal-select"
              value={String(settings.editorFontSize ?? 13)}
              onChange={(e) => onChange({ editorFontSize: Number(e.target.value) })}
            >
              {[12, 13, 14, 15, 16, 18].map((size) => (
                <option key={size} value={size}>
                  {size} px
                </option>
              ))}
            </select>
          </label>
          {/* EDIT-01：Tab 宽度 / 自动换行 / 行号三项都是「设了就真生效」的编辑器行为，
              判据与生效链路分别由 code-editor 的测试与 §5.4 的编辑器字号那一格守着。 */}
          <label className="setting-row cw-modal-row">
            <span className="cw-modal-row-text">
              <strong>Tab 缩进宽度</strong>
              <small>按 Tab / Shift+Tab 一次进或退几格；复制的行号与对齐也按这个走</small>
            </span>
            <select
              className="setting-select cw-modal-select"
              aria-label="Tab 缩进宽度"
              value={String(settings.editorTabSize ?? 2)}
              onChange={(e) => onChange({ editorTabSize: Number(e.target.value) })}
            >
              {[2, 4].map((size) => (
                <option key={size} value={size}>
                  {size} 格
                </option>
              ))}
            </select>
          </label>
          <label className="setting-row cw-modal-row">
            <span className="cw-modal-row-text">
              <strong>代码自动换行</strong>
              <small>开着长行折进本栏；关着长行走横向滚动条（默认）</small>
            </span>
            <input
              type="checkbox"
              checked={settings.editorWordWrap ?? false}
              onChange={(e) => onChange({ editorWordWrap: e.target.checked })}
            />
          </label>
          <label className="setting-row cw-modal-row">
            <span className="cw-modal-row-text">
              <strong>显示行号</strong>
              <small>关掉只是不画左栏那一列，代码文本一个字都不变</small>
            </span>
            <input
              type="checkbox"
              checked={settings.editorLineNumbers ?? true}
              onChange={(e) => onChange({ editorLineNumbers: e.target.checked })}
            />
          </label>
        </div>

        <div className="settings-section cw-modal-section">
          <h3 className="cw-modal-section-head">数据管理</h3>
          <div className="settings-data-row cw-modal-row">
            <div>
              <strong>导出本机学习数据</strong>
              <small>把课程进度、挑战记录、打卡和掌握度导出为 JSON 文件</small>
            </div>
            <button className="subtle-button" onClick={onExport}>
              <Download size={14} />
              导出
            </button>
          </div>
          <div className="settings-data-row cw-modal-row">
            <div>
              <strong>清除本机学习数据</strong>
              <small>删除所有账户的课程进度、项目草稿和挑战记录，不影响账户资料</small>
            </div>
            <button className="danger-button" onClick={handleClearLocalData}>
              <Trash2 size={14} />
              清除数据
            </button>
          </div>
        </div>

        <p className="modal-note cw-modal-note">当前使用统一深色护眼工作台；护眼指舒适对比与可调字号，不构成医疗建议。</p>
      </section>
    </div>
  )
}

type HelpModalProps = {
  onClose: () => void
}

export function HelpModal({ onClose }: HelpModalProps) {
  const dialogRef = useModalFocusTrap<HTMLElement>()
  useEscapeToClose(onClose)

  return (
    <div className="modal-backdrop cw-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={dialogRef}
        className="help-modal cw-modal cw-modal--help"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header cw-modal-head">
          <div>
            <p className="eyebrow cw-modal-eyebrow">使用指南</p>
            <h2 id="help-title" className="cw-modal-title">
              如何学习
            </h2>
          </div>
          <button className="icon-button cw-modal-close" aria-label="关闭帮助" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="help-content cw-modal-body">
          <div className="help-section cw-modal-help">
            <Lightbulb size={16} />
            <div>
              <h3>可视化执行</h3>
              <p>运行后，流程图和变量面板会根据当前运行器实际提供的数据展示；未采集到的事件或变量不会补造。</p>
            </div>
          </div>

          <div className="help-section cw-modal-help">
            <Settings2 size={16} />
            <div>
              <h3>按十步学习法推进</h3>
              <p>每个单元包含讲解、例子/反例、跟做、独立题、变式题和项目任务；运行成功后可标记完成，系统会按 1/3/7/14/30 天安排复测。</p>
            </div>
          </div>

          <div className="help-section cw-modal-help">
            <Lightbulb size={16} />
            <div>
              <h3>真实与模拟的边界</h3>
              <p>教学运行器只支持子集语法；浏览器沙箱真实执行纯 JavaScript；标注“外部环境实验”的关卡需要在真实环境完成后提交证据。</p>
            </div>
          </div>
        </div>

        <button className="primary-action cw-modal-cta" data-autofocus onClick={onClose}>
          知道了
        </button>
      </section>
    </div>
  )
}
