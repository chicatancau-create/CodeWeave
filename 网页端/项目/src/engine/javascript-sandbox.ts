import type { ExecutionResult, Lesson, TraceEvent, VariableValue } from '../types/lesson'
import { EXECUTION_SETTINGS } from '../utils/constants'

const maxOutputLines = EXECUTION_SETTINGS.MAX_OUTPUT_LINES
const maxExecutionMs = EXECUTION_SETTINGS.MAX_EXECUTION_MS

/**
 * 主线程正则黑名单：仅作为**用户提示与早期拦截**，不是安全边界（R4 G.3 第 4 条）。
 * 真正的执行隔离依赖 Worker（无 DOM、无同源存储、可终止）与超时上限。
 * 该列表无法覆盖字符串拼接、动态属性等构造形式，UI 不得据此宣称“绝对安全”。
 */
const ADVISORY_PATTERNS: RegExp[] = [
  /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|importScripts)\b/i,
  // 只拦截 eval/Function 的“调用形式”（动态执行代码）；function 关键字声明合法
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\b(?:WebAssembly|indexedDB|serviceWorker|caches)\b/i,
  /\b(?:globalThis|self|location|navigator|document|window|postMessage)\b/i,
  /\b(?:require|process|child_process|Deno|Bun)\b/i,
  /\bthis\b/i,
]

type WorkerMessage =
  | { type: 'output'; value: string }
  | { type: 'trace'; line: number; label: string; variables: VariableValue[] }
  | { type: 'done' }
  | { type: 'error'; message: string; line?: number }

const makeEvent = (id: string, type: TraceEvent['type'], line: number, label: string, detail: string, variables: VariableValue[], nodeId?: string): TraceEvent => ({ id, type, line, label, detail, variables, nodeId })

export function validateJavaScriptSandbox(code: string): { line: number; message: string } | undefined {
  const lines = code.split('\n')
  for (const pattern of ADVISORY_PATTERNS) {
    const line = lines.findIndex((sourceLine) => pattern.test(sourceLine))
    if (line >= 0) return { line: line + 1, message: '教学沙箱禁止访问网络、页面、系统和动态代码能力（提示性检查）。' }
  }
  return undefined
}

/**
 * 生成 Worker 脚本正文：用户代码作为**脚本自身的一行**交给浏览器编译，不在运行时求值。
 *
 * 为什么要改掉 `new Function`：完整 Node 服务发的 CSP 里 `script-src 'self' blob:` 不含
 * `'unsafe-eval'`，而 CSP 会传给 blob Worker 作用域。旧写法先建好 Worker、再把代码 postMessage
 * 进去 `new Function` 编译，于是**每一次真实运行都被 CSP 拦死**（2026-09-23 在真浏览器里第一次
 * 点 D 关「运行检查」即报 “Evaluating a string as JavaScript violates … script-src 'self' blob:”）。
 * 单测里 Worker 是 mock、jsdom 没有 CSP，所以这道拦截至被发现前从未进入过任何断言。
 *
 * 改法只搬「代码在哪一段文本里编译」，不搬隔离面：仍然是 `new Worker(blob:)`，
 * 仍然无 DOM、无同源存储、可 terminate，超时与输出上限一字不变；CSP 一个字都不放宽，
 * 也不需要 `unsafe-eval`——副作用是用户代码里的 `new Function` / `eval` 现在被 CSP 真正挡住，
 * 不再只靠下面那份提示性黑名单。
 */
function buildWorkerScript(code: string): { source: string; codeLineOffset: number; lineMap: number[] } {
  const identifiers = [...new Set([
    ...[...code.matchAll(/\b(?:let|const|var)\s+([A-Za-z_$][\w$]*)/g)].map((match) => match[1]!),
    ...[...code.matchAll(/\bfunction\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g)].flatMap((match) =>
      match[1]!.split(',').map((item) => item.trim()).filter((item) => /^[A-Za-z_$][\w$]*$/.test(item)),
    ),
    ...[...code.matchAll(/\b(?:for|catch)\s*\(\s*(?:let|const|var)\s+([A-Za-z_$][\w$]*)/g)].map((match) => match[1]!),
  ])]
  const variableEntries = identifiers.map((name) => `__cwGet(${JSON.stringify(name)}, () => ${name})`).join(',')
  const sourceLines = code.split('\n')
  const traceLineEntries = sourceLines.map((sourceLine, index) => {
    const line = index + 1
    const trimmed = sourceLine.trim()
    // Do not inject into a multiline literal or call. Inserting a statement before the
    // closing bracket is invalid JavaScript (and was the source of the original syntax regression).
    const before = sourceLines.slice(0, index).join('\n')
    const bracketDepth = (before.match(/\[|\(/g)?.length ?? 0) - (before.match(/\]|\)/g)?.length ?? 0)
    const after = `${before}\n${sourceLine}`
    const afterDepth = (after.match(/\[|\(/g)?.length ?? 0) - (after.match(/\]|\)/g)?.length ?? 0)
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('}') || /^else\b/.test(trimmed) || /^case\b/.test(trimmed) || /^default\b/.test(trimmed) || bracketDepth > 0 || afterDepth > 0) return sourceLine
    const label = JSON.stringify(trimmed.slice(0, 160))
    const trace = `__cwTrace(${line}, ${label}, [${variableEntries}]);`
    return `${sourceLine}\n${trace}`
  })
  const traceLines = traceLineEntries.join('\n')
  const prefix = [
    '"use strict";',
    `const __cwLimit = ${maxOutputLines};`,
    'const __cwCodeOffset = __CW_OFFSET__;',
    'const __cwLineMap = __CW_LINE_MAP__;',
    'const __cwSelfUrl = String(self.location.href);',
    'const __cwLines = [];',
    'const __cwWrite = (value) => {',
    `  if (__cwLines.length >= __cwLimit) throw new Error('输出超过 ${maxOutputLines} 行上限');`,
    '  __cwLines.push(String(value));',
    "  self.postMessage({ type: 'output', value: String(value) });",
    '};',
    'const __cwConsole = {',
    '  log: (...values) => __cwWrite(values.join(" ")),',
    '  info: (...values) => __cwWrite(values.join(" ")),',
    '  warn: (...values) => __cwWrite(values.join(" ")),',
    '  error: (...values) => __cwWrite(values.join(" ")),',
    '};',
    'const __cwGet = (name, read) => {',
    '  try {',
    '    const value = read();',
    '    const type = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;',
    '    const printable = typeof value === "string" ? value : type === "undefined" ? "undefined" : (() => { try { return JSON.stringify(value); } catch { return String(value); } })();',
    '    return { name, value: String(printable), type, color: type === "number" || type === "boolean" ? "blue" : "coral" };',
    '  } catch { return null; }',
    '};',
    'const __cwTrace = (line, label, variables) => {',
    '  self.postMessage({ type: "trace", line, label, variables: variables.filter(Boolean) });',
    '};',
    'const __cwLineFromFrame = (frame) => {',
    '  const tail = frame.split(__cwSelfUrl).pop() || "";',
    '  let digits = "";',
    '  for (const ch of tail) {',
    "    if (ch >= '0' && ch <= '9') digits += ch;",
    '    else if (digits) break;',
    '  }',
    '  if (!digits) return undefined;',
    '  const generated = Number(digits);',
    '  return __cwLineMap[generated] || Math.max(1, generated - __cwCodeOffset);',
    '};',
    'const __cwLineFromStack = (stack) => {',
    "  for (const frame of String(stack || '').split('\\n')) {",
    '    if (frame.includes(__cwSelfUrl)) return __cwLineFromFrame(frame);',
    '  }',
    '  return undefined;',
    '};',
    'const __cwEntry = function (console) {',
  ]
  const suffix = [
    '};',
    'try {',
    '  __cwEntry(__cwConsole);',
    "  self.postMessage({ type: 'done' });",
    '} catch (error) {',
    '  const message = error instanceof Error ? error.message : String(error);',
    '  const line = error instanceof Error ? __cwLineFromStack(error.stack) : undefined;',
    "  self.postMessage({ type: 'error', message, line });",
    '}',
    '',
  ]
  // 用户代码第 1 行落在 prefix.length + 1；lineMap 把插入追踪行折回编辑器行号。
  const codeLineOffset = prefix.length
  const lineMap: number[] = [0, ...prefix.map(() => 0)]
  sourceLines.forEach((sourceLine, index) => {
    lineMap.push(index + 1)
    if (traceLineEntries[index]!.includes('\n__cwTrace(')) lineMap.push(index + 1)
  })
  lineMap.push(...suffix.map(() => 0))
  const source = `${prefix.join('\n')}\n${traceLines}\n${suffix.join('\n')}`
    .replace('__CW_OFFSET__', String(codeLineOffset))
    .replace('__CW_LINE_MAP__', JSON.stringify(lineMap))
  return { source, codeLineOffset, lineMap }
}

/** 无 Worker 环境的明确降级：不伪装成真实执行。 */
function fallbackResult(): ExecutionResult {
  const error = { line: 1, message: '当前环境不支持浏览器 Worker，教学沙箱无法真实执行代码；请在完整浏览器环境运行，或使用教学运行器课程。' }
  const variables: VariableValue[] = []
  const events: TraceEvent[] = [makeEvent('error', 'error', error.line, '无法启动沙箱', error.message, variables)]
  return { events, output: [], error, tier: 'worker' }
}

function flowNodeForLine(lesson: Lesson, line: number, type: TraceEvent['type'] = 'line'): string | undefined {
  if (type === 'output') return lesson.flow.find((node) => node.kind === 'output')?.id ?? `line-${line}`
  if (type === 'start') return lesson.flow.find((node) => node.kind === 'start')?.id ?? 'start'
  if (type === 'end') return lesson.flow.find((node) => node.kind === 'end')?.id ?? 'end'
  return lesson.flow.find((node) => node.line === line)?.id ?? `line-${line}`
}

export function executeJavaScript(code: string, lesson: Lesson): Promise<ExecutionResult> {
  const rejected = validateJavaScriptSandbox(code)
  if (rejected) {
    return Promise.resolve({ events: [makeEvent('error', 'error', rejected.line, '安全拦截', rejected.message, [])], output: [], error: rejected, tier: 'worker' })
  }
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
    return Promise.resolve(fallbackResult())
  }

  return new Promise((resolve) => {
    const lines = code.split('\n')
    const variables: VariableValue[] = []
    const events: TraceEvent[] = [makeEvent('start', 'start', 1, '程序开始', '在隔离的 JavaScript Worker 中运行。', variables, 'start')]
    const output: string[] = []
    const { source, codeLineOffset } = buildWorkerScript(code)
    const objectUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    const worker = new Worker(objectUrl)
    let settled = false
    const finish = (result: ExecutionResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      worker.terminate()
      URL.revokeObjectURL(objectUrl)
      resolve(result)
    }
    const timeout = setTimeout(() => {
      const error = { line: 1, message: `运行超过 ${maxExecutionMs}ms，已自动停止，可能存在无限循环。` }
      events.push(makeEvent('timeout', 'error', error.line, '执行超时', error.message, variables))
      finish({ events, output, error, tier: 'worker' })
    }, maxExecutionMs)
    worker.onmessage = (message: MessageEvent<WorkerMessage>) => {
      const data = message.data
      if (data.type === 'trace') {
        variables.splice(0, variables.length, ...data.variables.map((variable) => ({ ...variable })))
        events.push(makeEvent(`trace-${events.length}`, 'line', data.line, data.label, `执行第 ${data.line} 行。`, data.variables, flowNodeForLine(lesson, data.line)))
      }
      if (data.type === 'output') {
        output.push(data.value)
        events.push(makeEvent(`output-${output.length}`, 'output', lines.length, '输出结果', `控制台输出：${data.value}`, variables, flowNodeForLine(lesson, lines.length, 'output')))
      }
      if (data.type === 'error') {
        // 行号由 Worker 脚本自己按前缀偏移折算，主线程不再从消息文本里猜。
        const line = data.line ?? 1
        const error = { line, message: data.message }
        events.push(makeEvent('error', 'error', line, '运行错误', data.message, variables))
        finish({ events, output, error, tier: 'worker' })
      }
      if (data.type === 'done') {
        events.push(makeEvent('end', 'end', lines.length, '程序结束', 'JavaScript Worker 执行完成。', variables, flowNodeForLine(lesson, lines.length, 'end')))
        finish({ events, output, tier: 'worker' })
      }
    }
    worker.onerror = (error: ErrorEvent) => {
      // 走到这里的是**脚本没能开始执行**那一类：语法错误、脚本被 CSP 拒绝、blob 取不到。
      // 浏览器报的是 Worker 脚本自己的行号，减掉前缀才是编辑器里的行号。
      // 代码没闭合时浏览器会把错算到紧跟其后的闭合行上（实测：1 行代码报第 2 行、
      // 3 行代码报第 4 行），折回来越过用户最后一行就收到最后一行，别指到用户看不见的行去。
      const mapped = typeof error.lineno === 'number' && error.lineno > codeLineOffset ? error.lineno - codeLineOffset : 1
      const result = { line: Math.min(Math.max(1, mapped), Math.max(1, lines.length)), message: error.message || 'JavaScript 沙箱发生未知错误。' }
      events.push(makeEvent('error', 'error', result.line, '运行错误', result.message, variables))
      finish({ events, output, error: result, tier: 'worker' })
    }
  })
}
