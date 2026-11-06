import { Component, useState, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, Copy, RefreshCcw, RotateCw } from 'lucide-react'
import './error-boundary.css'

type ErrorBoundaryProps = {
  children: ReactNode
  fallback?: (error: Error, reset: () => void) => ReactNode
}

type ErrorBoundaryState = {
  hasError: boolean
  error: Error | null
  /** React 给出的组件栈：让「哪个组件树出的问题」可复制、可上报（§11.2 明确错误） */
  componentStack: string | null
  /** 出错时刻，供复制件里定位用 */
  occurredAt: string | null
}

/** 堆栈文本上限：足够定位，又不至于把剪贴板与页面撑爆。 */
const STACK_LIMIT = 4000

function truncate(text: string): string {
  if (text.length <= STACK_LIMIT) return text
  return `${text.slice(0, STACK_LIMIT)}\n…（已截断，共 ${text.length} 个字符）`
}

/**
 * 复制用的纯文本报告。§11.2「缺失/损坏/断连 → 有明确错误、有效旧快照或恢复入口」
 * 要求错误信息可核对，所以这里给的是**原始事实**：类型、消息、堆栈、组件栈、时间，
 * 不做美化也不改写。
 */
export function buildErrorReport(error: Error, componentStack: string | null, occurredAt: string | null): string {
  const lines = [
    'CodeWeave 错误边界捕获到的异常',
    `发生时间：${occurredAt || '未记录'}`,
    `错误类型：${error.name || 'Error'}`,
    `错误消息：${error.message || '（该异常没有提供消息文本）'}`,
    '',
    '调用堆栈：',
    truncate(error.stack ?? '（无堆栈信息）'),
  ]
  if (componentStack) {
    lines.push('', '组件栈（React）：', truncate(componentStack))
  }
  return lines.join('\n')
}

/** 显示用时间：中文本地格式；复制件里保留 ISO，便于跨端对齐日志。 */
function formatOccurred(iso: string | null): string {
  if (!iso) return '未记录'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN')
}

/**
 * 复制到剪贴板：优先异步 Clipboard API，浏览器未开放时退回临时只读文本域 +
 * execCommand。返回值如实反映是否真的复制成功——失败时界面会改为提示手动选取，
 * 不会显示「已复制」。
 */
async function copyToClipboard(text: string): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text)
      return true
    } catch {
      /* 继续走兜底通道 */
    }
  }
  if (typeof document === 'undefined') return false
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '-1000px'
  document.body.appendChild(area)
  area.select()
  let ok: boolean
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(area)
  return ok
}

type CopyState = 'idle' | 'copied' | 'failed'

function DefaultErrorScreen({ error, componentStack, occurredAt, onReset }: {
  error: Error
  componentStack: string | null
  occurredAt: string | null
  onReset: () => void
}) {
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const report = buildErrorReport(error, componentStack, occurredAt)

  const copy = async () => {
    setCopyState('idle')
    setCopyState((await copyToClipboard(report)) ? 'copied' : 'failed')
  }

  const retry = () => {
    setCopyState('idle')
    onReset()
  }

  return (
    <div className="error-boundary cw-error" role="alert" aria-labelledby="cw-error-title">
      <div className="error-boundary-content cw-error-panel">
        <p className="cw-error-eyebrow">
          <AlertTriangle className="error-icon cw-error-mark" size={16} aria-hidden="true" />
          错误边界 · 已拦截
        </p>
        <h2 id="cw-error-title" className="cw-error-title">
          这一屏没能显示出来
        </h2>
        <p className="cw-error-lede">
          异常被组件树拦下，只影响这一块区域；页面其余部分与导航仍可使用。下面依次是：出了什么事、你的数据现在怎么样、下一步做什么。
        </p>

        <section className="cw-error-block" aria-label="错误详情">
          <h2 className="cw-error-block-title">
            <span className="cw-error-step" aria-hidden="true">01</span>
            出了什么错
          </h2>
          <p className="cw-error-facts">
            <span className="cw-error-kv">
              <span className="cw-error-key">错误类型</span>
              <code className="cw-error-value">{error.name || 'Error'}</code>
            </span>
            {occurredAt ? (
              <span className="cw-error-kv">
                <span className="cw-error-key">发生时间</span>
                <span className="cw-error-value">{formatOccurred(occurredAt)}</span>
              </span>
            ) : null}
          </p>
          <pre className="error-message cw-error-message">{error.message || '（该异常没有提供消息文本）'}</pre>
          <details className="cw-error-details">
            <summary>展开调用堆栈与组件栈</summary>
            <pre className="cw-error-stack">{truncate(error.stack ?? '（无堆栈信息）')}</pre>
            {componentStack ? <pre className="cw-error-stack">{truncate(componentStack)}</pre> : null}
          </details>
          <div className="cw-error-copy">
            <button className="subtle-button cw-error-btn" onClick={() => void copy()}>
              <Copy size={14} />
              复制错误详情
            </button>
            <span className={`cw-error-copy-state cw-error-copy-state--${copyState}`} role="status">
              {copyState === 'copied'
                ? '已复制到剪贴板，可直接粘贴给维护者。'
                : copyState === 'failed'
                  ? '复制失败：当前浏览器没有开放剪贴板权限。请展开上面的堆栈，长按选中文本后手动复制。'
                  : '复制件包含错误类型、消息、堆栈与组件栈，未做任何改写。'}
            </span>
          </div>
        </section>

        <section className="cw-error-block" aria-label="数据现状">
          <h2 className="cw-error-block-title">
            <span className="cw-error-step" aria-hidden="true">02</span>
            你的数据现在怎么样
          </h2>
          <ul className="cw-error-list">
            <li>错误边界只接管渲染，不写入、不回滚、不清空任何存储：本机学习记录与服务端账户数据都保持出错前的状态。</li>
            <li>因此这里不会用空数据覆盖你已经存在的进度；看不到的内容并没有消失，只是这一块没有渲染出来。</li>
            <li>如果你怀疑数据本身有问题（而不是显示问题），先到「数据与隐私 → 导出学习数据（JSON）」留一份当前快照，再决定下一步。</li>
          </ul>
        </section>

        <section className="cw-error-block" aria-label="下一步">
          <h2 className="cw-error-block-title">
            <span className="cw-error-step" aria-hidden="true">03</span>
            下一步做什么
          </h2>
          <ul className="cw-error-list">
            <li>先「重新尝试」：只重新挂载这一块区域，代价最小。</li>
            <li>仍然出错就「重新载入页面」：会重跑一次前端，不会改动任何数据。</li>
            <li>怀疑本地服务异常时，用一键启动器重启服务；账户数据与资料内容都在磁盘上，不受前端重载影响。</li>
            <li>反复在同一处出错，请把上面复制的错误详情连同样例步骤一起反馈；恢复入口在「数据与隐私 → 从导出文件恢复」。</li>
          </ul>
          <div className="cw-error-actions">
            <button className="primary-action cw-error-btn" onClick={retry}>
              <RefreshCcw size={14} />
              重新尝试
            </button>
            <button className="subtle-button cw-error-btn" onClick={() => window.location.reload()}>
              <RotateCw size={14} />
              重新载入页面
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

/**
 * 错误边界（§5.2「账户、设置、隐私和弹窗」把错误态并入同一体系 + §11.2 最后一条）。
 *
 * 呈现要求：错误信息可读、可复制、指明下一步，不得只留一个「出错了」；
 * 语义状态用固定标识 + 文字（颜色只是第三重提示），且不跟随场景点缀色。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, componentStack: null, occurredAt: null }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error, occurredAt: new Date().toISOString() }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    // 组件栈只在 componentDidCatch 里拿得到，补进状态以便用户复制上报（§11.2 明确错误）
    this.setState({ componentStack: errorInfo.componentStack ?? null })
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, componentStack: null, occurredAt: null })
  }

  override render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleReset)
      }

      return (
        <DefaultErrorScreen
          error={this.state.error}
          componentStack={this.state.componentStack}
          occurredAt={this.state.occurredAt}
          onReset={this.handleReset}
        />
      )
    }

    return this.props.children
  }
}
