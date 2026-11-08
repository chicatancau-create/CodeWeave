import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const stage = {};
runInNewContext(readFileSync(new URL('../qml/components/ExecutionStage.js', import.meta.url), 'utf8')
  .replace(/^\.pragma library\r?\n/, ''), stage);
const plain = value => JSON.parse(JSON.stringify(value));
const started = { kind: 'started', label: '开始执行', sequence: 1 };
const step = (sequence, sourceLine, variables) => ({
  kind: 'source_step', phase: 'line', label: `第 ${sourceLine} 行`, sequence, sourceLine, variables,
});
const events = [started, step(2, 1, { total: '7' }),
  { kind: 'output', label: '输出', sequence: 3, payload: '7\n' },
  step(4, 2, { total: '15', i: '1' }), step(5, 1, { total: '16' }),
  { kind: 'completed', label: '执行完成', sequence: 6 }];

test('empty and invalid selections do not invent nodes, variables or output', () => {
  for (const index of [-1, 0, 1, 1.5, NaN]) {
    const frame = stage.frameAt([], index);
    assert.equal(frame.nodes.length, 0);
    assert.equal(frame.cells.length, 0);
    assert.equal(frame.output, '');
  }
  assert.equal(stage.frameAt(events, events.length).nodes.length, 0);
  const skeleton = stage.skeleton([{ id: 'check', label: '判定', kind: 'decision', line: 4 },
    { id: 'print', label: '打印', kind: 'output' }]);
  assert.equal(skeleton.nodes[0].state, 'todo');
  assert.equal(skeleton.nodes[0].ordinal, null);
  assert.equal(skeleton.nodes[0].cells.length, 0);
  assert.equal(skeleton.currentId, '');
  assert.equal(skeleton.edges[0].state, 'idle');
});

test('rewinding is idempotent and cannot expose future values or paths', () => {
  const first = plain(stage.frameAt(events, 1));
  assert.equal(first.nodes.length, 2);
  assert.equal(first.cells[0].value, '7');
  assert.equal(first.output, '');
  assert.equal(first.returnCount, 0);
  stage.frameAt(events, 5);
  assert.deepEqual(plain(stage.frameAt(events, 1)), first);
  assert.equal(events[1].variables.total, '7');
});

test('real repeated line visits produce a return edge and one current pointer', () => {
  const frame = stage.frameAt(events, 4);
  assert.equal(frame.nodes.length, 4);
  assert.equal(frame.currentId, 'line:1');
  assert.equal(frame.nodes.filter(node => node.state === 'now').length, 1);
  assert.equal(frame.nodes.find(node => node.id === 'line:1').visits, 2);
  assert.equal(frame.returnCount, 1);
  assert.equal(frame.edges.filter(edge => edge.back && edge.state === 'active').length, 1);
  assert.equal(frame.nodes.find(node => node.id === 'line:1').lastEventIndex, 4);
  const repeated = stage.frameAt([started, step(2, 1, {}), step(3, 1, {})], 2);
  assert.ok(repeated.edges.some(edge => edge.from === edge.to && edge.back));
});

test('variables compare source snapshots across output and retain the latest snapshot at termination', () => {
  const frame = stage.frameAt(events, 3);
  assert.deepEqual(plain(frame.cells), [{ name: 'total', value: '15', born: false, changed: true },
    { name: 'i', value: '1', born: true, changed: false }]);
  const complete = stage.frameAt(events, 5);
  assert.equal(complete.snapshotLine, 1);
  assert.equal(complete.snapshotIndex, 4);
  assert.equal(complete.cells[0].value, '16');
  assert.equal(complete.output, '7\n');
  assert.equal(complete.nodes.at(-1).kind, 'end');
  assert.equal(stage.frameAt([started], 0).cells.length, 0);
});

test('empty snapshots remove old bindings and unusual variable names stay data', () => {
  const values = JSON.parse('{"__proto__":"7","<b>total</b>":"<img>"}');
  const frame = stage.frameAt([started, step(2, 1, values), step(3, 2, {})], 2);
  assert.equal(frame.cells.length, 0);
  const unusual = stage.frameAt([started, step(2, 1, values)], 1);
  assert.equal(unusual.cells[0].name, '__proto__');
  assert.equal(unusual.cells[1].value, '<img>');
  assert.equal({}.polluted, undefined);
});

test('layout preserves fixed readable node sizes with scrolling on narrow viewports', () => {
  const frame = stage.frameAt(events, 5);
  for (const width of [160, 240, 440, 900]) {
    const geometry = stage.layout(frame, width);
    for (const node of geometry.nodes) {
      assert.ok(node.x >= 0 && node.y >= 0);
      assert.ok(node.x + 156 <= geometry.width);
      assert.ok(node.y + 112 <= geometry.height);
    }
  }
  const narrow = stage.layout(frame, 240);
  assert.equal(narrow.nodes[0].x, narrow.nodes[1].x);
  assert.ok(narrow.nodes[1].y >= narrow.nodes[0].y + 112);
});

test('failure, cancellation and exception snapshots retain actual state without inventing success', () => {
  for (const kind of ['failed', 'cancelled']) {
    const last = { kind, sequence: 3, label: kind, payload: kind === 'failed' ? 'process_exit_nonzero' : '' };
    const frame = stage.frameAt([started, { ...step(2, 1, { total: '7' }), phase: 'exception' }, last], 2);
    assert.equal(frame.nodes[1].failed, true);
    assert.equal(frame.nodes[2].kind, 'end');
    assert.equal(frame.nodes[2].label, kind);
    assert.equal(frame.nodes[2].failed, kind === 'failed');
    assert.equal(frame.cells[0].value, '7');
    assert.equal(frame.output, '');
  }
});

test('cancelling after output keeps observed output and variables when rewound or terminated', () => {
  const trace = [...events.slice(0, 3), { kind: 'cancelled', sequence: 4, label: '已取消' }];
  const frame = stage.frameAt(trace, 3);
  assert.equal(frame.nodes.at(-1).label, '已取消');
  assert.equal(frame.nodes.at(-1).failed, false);
  assert.equal(frame.nodes.filter(node => node.state === 'now').length, 1);
  assert.equal(frame.cells[0].value, '7');
  assert.equal(frame.output, '7\n');
  assert.equal(stage.frameAt(trace, 1).output, '');
  assert.equal(stage.frameAt(trace, 1).nodes.length, 2);
});

test('failure before any source snapshot exposes only the actual terminal diagnostic', () => {
  const trace = [started, { kind: 'failed', sequence: 2, label: '执行失败', payload: 'execution_timeout' }];
  const frame = stage.frameAt(trace, 1);
  assert.equal(frame.nodes.length, 2);
  assert.equal(frame.nodes.at(-1).failed, true);
  assert.equal(frame.nodes.at(-1).detail, 'execution_timeout');
  assert.equal(frame.currentId, 'event:2');
  assert.equal(frame.cells.length, 0);
  assert.equal(frame.snapshotIndex, -1);
  assert.equal(frame.output, '');
});
