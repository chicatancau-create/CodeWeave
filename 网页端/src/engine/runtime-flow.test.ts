import { describe, expect, it } from 'vitest'
import { deriveRuntimeFlow } from './runtime-flow'

describe('deriveRuntimeFlow', () => {
  it('只为真实执行事件建立去重节点，并按源码识别分支', () => {
    const flow = deriveRuntimeFlow([
      { id: 'a', type: 'line', line: 1, label: 'let n = 1', detail: '', variables: [], nodeId: 'line-1' },
      { id: 'b', type: 'condition', line: 2, label: 'if (n > 0)', detail: '', variables: [], nodeId: 'line-2' },
      { id: 'c', type: 'line', line: 1, label: 'let n = 1', detail: '', variables: [], nodeId: 'line-1' },
    ], 'let n = 1\nif (n > 0) {}')

    expect(flow.map((node) => [node.id, node.kind])).toEqual([
      ['line-1', 'process'],
      ['line-2', 'decision'],
    ])
  })

  it('没有事件时不伪造流程图', () => {
    expect(deriveRuntimeFlow([], 'console.log(1)')).toEqual([])
  })
})
