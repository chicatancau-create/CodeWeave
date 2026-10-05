import { Play, RotateCcw, StepForward } from 'lucide-react'
import type { RunStatus } from '../types/lesson'
import './runtime-controls.css'

type Props = { status: RunStatus; onRun: () => void; onStep: () => void; onReset: () => void }

export function RuntimeControls({ status, onRun, onStep, onReset }: Props) {
  const running = status === 'running'
  // 空闲档从「运行代码」改成「开始运行」：与画布控制条的「下一步」配对，一并是用户
  // 看完成品后的原话（「点击『开始运行』时，中间就会出现最开始的内容」）。暂停档是
  // 「继续运行」——正好与「开始」相对，两个词说的是同一件事的两个时点。
  const label = status === 'completed' ? '再运行一次' : running ? '暂停执行' : status === 'paused' ? '继续运行' : status === 'error' ? '重新检查' : '开始运行'
  return <div className="run-bar"><div className="run-copy"><div className={`run-indicator ${status}`}><span /></div><div><strong>{status === 'completed' ? '运行完成' : status === 'error' ? '需要修改代码' : running ? '正在执行代码…' : status === 'paused' ? '已暂停，可以继续探索' : '准备好运行了吗？'}</strong><span>{status === 'error' ? '修复错误后再次运行' : '点击运行，观察每一步发生了什么'}</span></div></div><div className="run-actions"><button className="reset-button" onClick={onReset}><RotateCcw size={15} /> 重置</button><button className="step-button" onClick={onStep}><StepForward size={16} /> 单步执行</button><button className="run-button" onClick={onRun}><Play size={15} fill="currentColor" /> {label}</button></div></div>
}
