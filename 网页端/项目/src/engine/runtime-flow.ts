import type { FlowNode, TraceEvent } from '../types/lesson'

const sourceLine = (code: string, line: number): string => code.split('\n')[line - 1]?.trim() ?? ''

function nodeForEvent(event: TraceEvent, code: string): FlowNode | null {
  if (!event.nodeId) return null
  const text = sourceLine(code, event.line)
  if (event.type === 'start') return { id: event.nodeId, label: event.label, kind: 'start', tone: 'purple', line: event.line }
  if (event.type === 'end') return { id: event.nodeId, label: event.label, kind: 'end', tone: 'green', line: event.line }
  if (event.type === 'output') return { id: event.nodeId, label: event.label, kind: 'output', tone: 'coral', line: event.line }
  if (event.type === 'condition' || /^(if|else if|while|for|switch)\b/.test(text)) {
    return { id: event.nodeId, label: event.label, kind: 'decision', tone: 'yellow', line: event.line }
  }
  if (event.type === 'error') return { id: event.nodeId, label: event.label, kind: 'process', tone: 'coral', line: event.line }
  return { id: event.nodeId, label: event.label, kind: 'process', tone: 'blue', line: event.line }
}

/** Derive only nodes backed by events produced during this execution. */
export function deriveRuntimeFlow(events: TraceEvent[], code: string): FlowNode[] {
  const nodes = new Map<string, FlowNode>()
  for (const event of events) {
    const node = nodeForEvent(event, code)
    if (node && !nodes.has(node.id)) nodes.set(node.id, node)
  }
  return [...nodes.values()]
}
