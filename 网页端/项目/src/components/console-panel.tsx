import { useEffect, useRef, useState } from 'react'
import { Copy, Eraser, LocateFixed, Terminal } from 'lucide-react'
import './panel-shell.css'
import './console-panel.css'

type Props = {
  output: string[]
  error?: { line: number; message: string }
  /**
   * EDIT-01 第 6 条：把「定位到出错那一行」交给上层——光标与滚动住在编辑器里，
   * 控制台只知道第几行。不提供该回调时（本单元没有代码）按钮不出现。
   */
  onLocateError?: (line: number) => void
}

/**
 * 控制台输出。三件事在本组件里，不外溢：
 * ① 显示的是**当前这一次运行的快照**（`output` 变了就重新起算）；
 * ② 「清空」只清这里的显示，运行结果与提交证据都不归它管（审计卡明写「清输出不删除提交证据」）；
 * ③ 复制的成功/失败写在**按钮自己的名字**上——焦点还停在按钮上，改名即被朗读，
 *    不再新增一个 `role="status"`（工作台里已经有一条，两条活区会互相抢播报）。
 */
export function ConsolePanel({ output, error, onLocateError }: Props) {
  const [hiddenCount, setHiddenCount] = useState(0)
  const [copyResult, setCopyResult] = useState<'idle' | 'ok' | 'fail'>('idle')
  const lastOutputRef = useRef<string[] | undefined>(undefined)

  useEffect(() => {
    if (lastOutputRef.current === output) return
    lastOutputRef.current = output
    // 新输出到达（重新运行、逐帧推进）：清空的范围不跨运行保留，短了就归零
    setHiddenCount((current) => (current > output.length ? 0 : current))
  }, [output])

  const shown = hiddenCount > 0 ? output.slice(hiddenCount) : output
  const copyLabel =
    copyResult === 'ok' ? '已复制到剪贴板' : copyResult === 'fail' ? '复制失败，请手动选择后按 Ctrl+C' : '复制输出'

  const handleCopy = async () => {
    const snapshot = shown.join('\n')
    const clipboard = navigator.clipboard
    if (!clipboard) {
      setCopyResult('fail')
      return
    }
    try {
      await clipboard.writeText(snapshot)
      setCopyResult('ok')
    } catch {
      setCopyResult('fail')
    }
  }

  return <section className="panel console-panel"><div className="panel-header"><div className="panel-title"><Terminal size={15} /> 控制台输出</div><span className={`console-status ${error ? 'error' : ''}`}>{error ? `第 ${error.line} 行错误` : 'stdout'}</span><div className="console-actions">{error && onLocateError && <button type="button" className="console-action" onClick={() => onLocateError(error.line)}><LocateFixed size={12} /> 定位到第 {error.line} 行</button>}{shown.length > 0 && <button type="button" className="console-action" onClick={handleCopy}><Copy size={12} /> {copyLabel}</button>}{hiddenCount === 0 && output.length > 0 && <button type="button" className="console-action" onClick={() => { setHiddenCount(output.length); setCopyResult('idle') }}><Eraser size={12} /> 清空显示</button>}</div></div><div className="console-body">{error ? <div className="console-error">✕ {error.message}</div> : shown.length ? shown.map((line, index) => <div className="console-line" key={`${line}-${index}`}><span>›</span>{line}</div>) : <div className="empty-panel">{hiddenCount > 0 ? '显示已清空：本次运行的记录与提交证据都不在这里，不受影响。重新运行或推进一帧即恢复。' : '运行后显示程序输出'}</div>}</div></section>
}
