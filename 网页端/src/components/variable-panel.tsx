import { Variable } from 'lucide-react'
import type { VariableValue } from '../types/lesson'
import './panel-shell.css'
import './variable-panel.css'

type Props = { variables: VariableValue[]; eventIndex: number; totalEvents: number }

export function VariablePanel({ variables, eventIndex, totalEvents }: Props) {
  return <section className="panel variables-panel"><div className="panel-header"><div className="panel-title"><Variable size={15} /> 变量追踪</div><span className="step-counter">{totalEvents ? `步骤 ${eventIndex + 1} / ${totalEvents}` : '等待运行'}</span></div><div className="variable-list">{variables.length ? variables.map((variable) => <div className="variable-row changed" key={variable.name}><div className={`variable-icon ${variable.color}`}><Variable size={15} /></div><div className="variable-name"><strong>{variable.name}</strong><span>{variable.type}</span></div><div className="variable-value">{variable.value}</div><div className="variable-dots">•••</div></div>) : <div className="empty-panel">运行后显示变量的实时变化</div>}</div></section>
}
