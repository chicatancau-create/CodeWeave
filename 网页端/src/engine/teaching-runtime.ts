import type { ExecutionResult, LanguageId, Lesson, TraceEvent, VariableValue } from '../types/lesson'

const makeVariable = (name: string, value: string, type: string, color: VariableValue['color']): VariableValue => ({ name, value, type, color })
/**
 * 造一个事件。`variables` 在这里**复制一份快照**再挂上去——这是逐拍值能画对的前提。
 *
 * 不复制会怎样：调用方为省事复用同一个数组对象（`for-sum` 的 `variables[0] = …` 原地改写，
 * 再把同一个引用推进每一拍），于是**所有事件读到的都是终值**——`start` 那一拍就报
 * `i=6,total=15`。画布的「这一格刚被改过」与流程图的 `a = 4` 明细都因此永远显示最后一步。
 * 契约本来就是「这一拍的变量快照」，之前只是实现没兑现；在唯一的出口补上，六个模板一次覆盖。
 */
const snapshot = (variables: VariableValue[]): VariableValue[] => variables.map((v) => ({ ...v }))
const event = (id: string, type: TraceEvent['type'], line: number, label: string, detail: string, variables: VariableValue[], nodeId?: string): TraceEvent => ({ id, type, line, label, detail, variables: snapshot(variables), nodeId })

function findLine(lines: string[], pattern: RegExp, fallback = 1): number { const index = lines.findIndex((line) => pattern.test(line)); return index >= 0 ? index + 1 : fallback }
function getNumber(source: string, pattern: RegExp, fallback: number): number { const match = source.match(pattern); return match?.[1] ? Number(match[1]) : fallback }
function checkBrackets(code: string): { line: number; message: string } | undefined {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  const stack: { char: string; line: number }[] = []
  let line = 1
  for (const char of code) { if (char === '\n') line += 1; if ('([{'.includes(char)) stack.push({ char, line }); if (')]}'.includes(char)) { const last = stack.pop(); if (!last || last.char !== pairs[char]) return { line, message: `括号不匹配：这里遇到了 ${char}` } } }
  const last = stack.at(-1)
  return last ? { line: last.line, message: '代码还缺少一个结束括号' } : undefined
}

/**
 * 支持模板登记表（R4 G.3 第 5 条）。
 * 每个模板显式声明：可识别的语法特征、输入语法、输出规则与不支持变体。
 * 运行器只按模板匹配结果输出；无法识别时返回 unsupported，禁止猜测成功。
 */
export type TeachingTemplate = {
  id: string
  /** 模板说明（展示给用户） */
  title: string
  /** 输入语法：模板读取的变量与形式 */
  inputSyntax: string
  /** 输出规则 */
  outputRule: string
  /** 这个模板认领哪几种语言的写法；不在名单里的语言直接跳过。 */
  languages: LanguageId[]
  /** 该模板支持的代码特征（全部命中才算匹配）。判定只看剥掉注释与字符串后的代码栏。 */
  requires: (match: TeachingMatch) => boolean
}

const ALL_LANGUAGES: LanguageId[] = ['python', 'c', 'csharp', 'java', 'javascript']
/** `int a = …` 这种声明只存在于 C 系；Python/JS 里出现的只可能是巧合的子串。 */
const INT_DECLARING: LanguageId[] = ['c', 'csharp', 'java']
const PRINT_TOKEN = /\b(?:print|println|printf|puts|console\.log|writeline)\b/i

export const TEACHING_TEMPLATES: TeachingTemplate[] = [
  {
    id: 'greeting-call',
    title: '函数调用与返回',
    inputSyntax: 'greet("名字")，或变量 name = "名字"',
    outputRule: '输出「你好，<名字>」',
    languages: ALL_LANGUAGES,
    requires: (m) => /\bgreet\s*\(/.test(m.code),
  },
  {
    id: 'greeting-cn',
    title: '中文问候输出',
    inputSyntax: '包含中文问候字面量与 print 输出',
    outputRule: '输出「你好，<name>」',
    languages: ALL_LANGUAGES,
    // 「你好」只可能出现在字符串里，所以这条是唯一读字面量栏的模板。
    requires: (m) => /你好/.test(m.literals) && /\bname\s*=\s*["']/.test(m.code) && PRINT_TOKEN.test(m.code),
  },
  {
    id: 'parity',
    title: '奇偶判断',
    inputSyntax: 'number = <整数>，使用 % 2 取模',
    outputRule: '输出「偶数」或「奇数」',
    languages: ALL_LANGUAGES,
    requires: (m) => /\bnumber\s*=\s*-?\d+/.test(m.code) && /%\s*2\b/.test(m.code),
  },
  {
    id: 'while-loop',
    title: 'while 计数循环',
    inputSyntax: 'count/i = <起始值>，while (count <= <上限>)',
    outputRule: '逐行输出每轮计数值',
    languages: ALL_LANGUAGES,
    requires: (m) => /\b(?:count|i)\s*=\s*-?\d+/.test(m.code) && /\bwhile\b/.test(m.code) && !/\bfor\b/.test(m.code),
  },
  {
    id: 'score-branch',
    title: '成绩及格分支',
    inputSyntax: 'score = <整数>，配合 if 条件',
    outputRule: '输出「通过」或「再试一次」',
    languages: ALL_LANGUAGES,
    requires: (m) => /\bscore\s*=\s*-?\d+/.test(m.code) && /\bif\b/.test(m.code),
  },
  {
    id: 'max-of-two',
    title: '两数取较大值',
    inputSyntax: 'int a = <整数>; int b = <整数>; 配合 if',
    outputRule: '输出较大的整数',
    languages: INT_DECLARING,
    requires: (m) => /\bint\s+a\s*=\s*-?\d+/.test(m.code) && /\bint\s+b\s*=\s*-?\d+/.test(m.code) && /\bif\b/.test(m.code),
  },
  {
    id: 'for-sum',
    title: 'for 循环累加',
    inputSyntax: 'total = <初值>; for (…; i <= <上限>; …) 或 for i in range(a, b)',
    outputRule: '输出累加后的 total',
    languages: ALL_LANGUAGES,
    requires: (m) => /\bfor\b/.test(m.code) && /\btotal\s*=/.test(m.code) && /\btotal\s*(?:\+=|-=|=[^=]*[+-])/.test(m.code) && !/\bwhile\b/.test(m.code),
  },
  {
    id: 'age-increment',
    title: '变量递增',
    inputSyntax: 'age = <整数>，随后输出结果',
    outputRule: '输出 age + 1',
    languages: ALL_LANGUAGES,
    requires: (m) => /\bage\s*=\s*-?\d+/.test(m.code) && PRINT_TOKEN.test(m.code),
  },
]

/** 未识别到任何支持模板时的显式状态（禁止猜测成功）。 */
export const UNSUPPORTED_MESSAGE =
  '教学运行器未识别这段代码的结构：它只支持下方列出的模板。请改用支持模板，或在浏览器沙箱 / 真实环境中运行。'

/**
 * 一段代码同时含两种以上支持模板的结构时的显式拒绝。
 *
 * 起因是 S11 复现的那份 134 行参考实现（练习页 cw-py-loop-range-001-ex1）：
 * 它里面既有 `while` 又有 `for … total`，还有一句 `if a%2==0`，
 * 于是旧实现按登记表顺序认领了第一个命中的 parity，交出 `["偶数"]` —— 而它真跑是 22 行输出。
 * 单模板模拟器对这种多主题程序**无论选中哪个都是错的**，所以这里不选。
 */
export function ambiguousTemplateMessage(candidates: TeachingTemplate[]): string {
  const names = candidates.map((t) => `「${t.title}」`).join('、')
  return `这段代码同时含 ${candidates.length} 种支持模板的结构（${names}）：教学运行器只按单一模板模拟，无法判断该按哪一种输出。请改用浏览器沙箱 / 真实环境运行。`
}

/**
 * 源码拆成两栏：`code` 是剥掉注释与字符串字面量之后的代码（字面量位置留 `""` 占位），
 * `literals` 是所有字面量内容。换行一律保留，否则报错行号会漂。
 *
 * 为什么必须拆：整段子串匹配里，`message` 含 age、`information` 含 for、
 * 注释里一句 while、`printf("%2d")` 里的 %2 都会让模板认领一段它并不认识的代码。
 * 认领的代价不是「多跑一次」而是界面把模板算出来的数当作这段程序的输出——
 * 比认不出（老实说「未识别代码结构」）更糟。
 */
export type TeachingMatch = { code: string; literals: string; language: LanguageId }

function splitSource(source: string, language: LanguageId): TeachingMatch {
  const hashComment = language === 'python'
  const literals: string[] = []
  let code = ''
  let i = 0
  const newlinesOf = (text: string) => '\n'.repeat((text.match(/\n/g) ?? []).length)
  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]
    if (ch === '/' && (next === '/' || next === '*')) {
      if (next === '/') {
        while (i < source.length && source[i] !== '\n') i += 1
      } else {
        i += 2
        const start = i
        while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1
        code += newlinesOf(source.slice(start, i))
        i += 2
      }
      continue
    }
    if (ch === '#' && hashComment) {
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      i += 1
      let text = ''
      while (i < source.length && source[i] !== ch) {
        if (source[i] === '\n') break // 未闭合的引号到此为止，别把整份文件当字符串吞掉
        if (source[i] === '\\') { text += source[i] + (source[i + 1] ?? ''); i += 2; continue }
        text += source[i]
        i += 1
      }
      i += 1
      literals.push(text)
      code += '""' + newlinesOf(text)
      continue
    }
    code += ch
    i += 1
  }
  return { code, literals: literals.join('\n'), language }
}

function unsupportedResult(message = UNSUPPORTED_MESSAGE, label = '未识别代码结构'): ExecutionResult {
  const error = { line: 1, message }
  return {
    events: [event('unsupported', 'error', 1, label, message, [])],
    output: [],
    error,
    tier: 'teaching',
    unsupported: true,
  }
}

/** 全部命中的模板（不只第一个）：诊断与测试都读这个，`detectTemplate` 只在唯一命中时才放行。 */
export function detectTemplates(code: string, language: LanguageId): TeachingTemplate[] {
  const match = splitSource(code, language)
  return TEACHING_TEMPLATES.filter((template) => template.languages.includes(language) && template.requires(match))
}

/**
 * 认出模板 = 恰好命中一条。
 * 命中 0 条是认不出；命中 ≥2 条是「这段程序同时是几种结构」，单模板模拟器选哪一种都必然交出假输出，
 * 所以同样不放行——旧实现按登记表顺序取第一条，把 134 行的多主题参考实现当成了奇偶判断。
 */
export function detectTemplate(code: string, language: LanguageId): TeachingTemplate | undefined {
  const hits = detectTemplates(code, language)
  return hits.length === 1 ? hits[0] : undefined
}

export function simulateProgram(code: string, language: LanguageId, lesson: Lesson): ExecutionResult {
  const bracketError = checkBrackets(splitSource(code, language).code)
  if (bracketError) {
    return { events: [event('error', 'error', bracketError.line, '语法错误', bracketError.message, [])], output: [], error: bracketError, tier: 'teaching' }
  }
  const lines = code.split('\n')
  const hits = detectTemplates(code, language)
  if (hits.length === 0) return unsupportedResult()
  if (hits.length > 1) return unsupportedResult(ambiguousTemplateMessage(hits), '结构不唯一')
  const result = renderTemplate(hits[0]!.id, lines, language, lesson)
  return { ...result, tier: 'teaching' }
}

function renderTemplate(id: string, lines: string[], language: LanguageId, lesson: Lesson): ExecutionResult {
  switch (id) {
    case 'greeting-call':
      return simulateGreeting(lines, lesson)
    case 'greeting-cn':
      return simulateSimpleGreeting(lines)
    case 'parity':
      return simulateCondition(lines, lesson)
    case 'while-loop':
      return simulateWhile(lines, language, lesson)
    case 'score-branch':
      return simulateScore(lines, language, lesson)
    case 'max-of-two':
      return simulateMax(lines, language, lesson)
    case 'for-sum':
      return simulateSum(lines, language, lesson)
    case 'age-increment':
      return simulateAge(lines, language, lesson)
    default:
      return unsupportedResult()
  }
}

function simulateAge(lines: string[], language: LanguageId, _lesson: Lesson): ExecutionResult {
  const code = lines.join('\n')
  const age = getNumber(code, /age\s*=\s*(-?\d+)/i, 18)
  const value = age + 1
  const type = language === 'javascript' ? 'number 数字' : 'int 整数'
  const variables = [makeVariable('age', String(age), type, 'blue'), makeVariable('结果', String(value), type, 'coral')]
  const assignLine = findLine(lines, /age\s*=/i)
  const outputLine = findLine(lines, /print\s*\(|printf|println|writeline|console\.log/i, lines.length)
  const events = [event('start', 'start', 1, '程序开始', '读取 age 的初始值。', variables, 'start'), event('assign', 'assign', assignLine, '声明 age', `age 的值是 ${age}。`, variables, 'init'), event('output', 'output', outputLine, '输出计算结果', `${age} + 1 = ${value}。`, variables, 'output'), event('end', 'end', lines.length, '程序结束', '执行完成，退出码为 0。', variables, 'end')]
  return { events, output: [String(value)] }
}

function simulateSimpleGreeting(lines: string[]): ExecutionResult {
  const code = lines.join('\n')
  const name = code.match(/name\s*=\s*["']([^"']+)["']/i)?.[1] ?? '小明'
  const result = `你好，${name}`
  const variables = [makeVariable('name', name, '文本', 'blue')]
  const outputLine = findLine(lines, /print\s*\(/i, lines.length)
  const events = [event('start', 'start', 1, '程序开始', '读取 name 变量。', variables, 'start'), event('assign', 'assign', 1, '保存名字', `name = "${name}"。`, variables, 'init'), event('output', 'output', outputLine, '输出问候', `程序输出「${result}」。`, variables, 'output'), event('end', 'end', lines.length, '程序结束', '执行完成，退出码为 0。', variables, 'end')]
  return { events, output: [result] }
}

function simulateScore(lines: string[], language: LanguageId, _lesson: Lesson): ExecutionResult {
  const code = lines.join('\n')
  const score = getNumber(code, /score\s*=\s*(-?\d+)/i, 0)
  const passed = score >= 60
  const result = passed ? '通过' : '再试一次'
  const variables = [makeVariable('score', String(score), language === 'javascript' ? 'number 数字' : 'int 整数', 'blue'), makeVariable('result', result, '文本', 'coral')]
  const conditionLine = findLine(lines, /if\s*\(/i, 1)
  const outputLine = findLine(lines, /print\s*\(|printf|println|writeline|console\.log/i, lines.length)
  const events = [event('start', 'start', 1, '程序开始', '读取 score 并准备判断。', variables, 'start'), event('condition', 'condition', conditionLine, '判断是否及格', `score >= 60 的结果是 ${passed}。`, variables, 'condition'), event('branch', 'branch', conditionLine + 1, `进入「${result}」分支`, `条件为 ${passed ? '真' : '假'}。`, variables, 'branch'), event('output', 'output', outputLine, '输出结果', `程序输出「${result}」。`, variables, 'output'), event('end', 'end', lines.length, '程序结束', '执行完成，退出码为 0。', variables, 'end')]
  return { events, output: [result] }
}

function simulateMax(lines: string[], _language: LanguageId, _lesson: Lesson): ExecutionResult {
  const code = lines.join('\n')
  const a = getNumber(code, /int\s+a\s*=\s*(-?\d+)/i, 0)
  const b = getNumber(code, /int\s+b\s*=\s*(-?\d+)/i, 0)
  const value = Math.max(a, b)
  const variables = [makeVariable('a', String(a), 'int 整数', 'blue'), makeVariable('b', String(b), 'int 整数', 'blue'), makeVariable('max', String(value), 'int 整数', 'coral')]
  const conditionLine = findLine(lines, /if\s*\(/i, 1)
  const outputLine = findLine(lines, /println|printf|writeline|console\.log/i, lines.length)
  const events = [event('start', 'start', 1, '程序开始', '读取两个数字。', variables, 'start'), event('condition', 'condition', conditionLine, '比较 a 和 b', `${a} > ${b} 的结果是 ${a > b}。`, variables, 'condition'), event('branch', 'branch', conditionLine + 1, `选择较大值 ${value}`, '条件分支完成。', variables, 'branch'), event('output', 'output', outputLine, '输出最大值', `程序输出 ${value}。`, variables, 'output'), event('end', 'end', lines.length, '程序结束', '执行完成，退出码为 0。', variables, 'end')]
  return { events, output: [String(value)] }
}

function simulateWhile(lines: string[], language: LanguageId, _lesson: Lesson): ExecutionResult {
  const code = lines.join('\n')
  const initial = getNumber(code, /(?:count|i)\s*=\s*(-?\d+)/i, 1)
  const limit = getNumber(code, /(?:<=|<)\s*(-?\d+)/i, 3)
  const descending = /count\s*>\s*0|count--|count\s*-=/i.test(code)
  const values: number[] = []
  if (descending) { for (let current = initial; current > 0 && values.length < 50; current -= 1) values.push(current) } else { for (let current = initial; current <= limit && values.length < 50; current += 1) values.push(current) }
  const type = language === 'javascript' ? 'number 数字' : 'int 整数'
  const variables: VariableValue[] = [makeVariable('count', String(initial), type, 'blue')]
  const loopLine = findLine(lines, /while\s*\(/i, 2)
  const outputLine = findLine(lines, /print\s*\(|printf|println|writeline|console\.log/i, loopLine + 1)
  const events: TraceEvent[] = [event('start', 'start', 1, '程序开始', '准备检查 while 条件。', variables, 'start')]
  values.forEach((value, index) => { variables[0] = makeVariable('count', String(value), type, 'blue'); events.push(event(`while-${index}`, 'loop', loopLine, '进入 while 循环', `第 ${index + 1} 轮，当前值为 ${value}。`, variables, 'condition')); events.push(event(`while-output-${index}`, 'output', outputLine, '输出当前值', `控制台输出 ${value}。`, variables, 'output')) })
  variables[0] = makeVariable('count', String(descending ? 0 : limit + 1), type, 'blue')
  events.push(event('while-end', 'condition', loopLine, '条件为 false', '循环条件不再满足，离开循环。', variables, 'condition'))
  events.push(event('end', 'end', lines.length, '程序结束', '执行完成，退出码为 0。', variables, 'end'))
  return { events, output: values.map(String) }
}

function simulateSum(lines: string[], language: LanguageId, _lesson: Lesson): ExecutionResult {
  const code = lines.join('\n')
  const initial = getNumber(code, /(?:total\s*=|total\s*:\s*\w+\s*=)\s*(-?\d+)/i, 0)
  const start = language === 'python' ? getNumber(code, /range\(\s*(-?\d+)/i, 1) : getNumber(code, /(?:int\s+)?i\s*=\s*(-?\d+)/i, 1)
  const limit = language === 'python' ? getNumber(code, /range\(\s*-?\d+\s*,\s*(-?\d+)/i, 5) - 1 : getNumber(code, /i\s*<=\s*(-?\d+)/i, 5)
  const operation = /total\s*(?:-=|=\s*total\s*-)/.test(code) ? 'subtract' : 'add'
  const initLine = findLine(lines, /total\s*=/i)
  const loopLine = findLine(lines, /for\s*\(|for\s+i\s+in/i, initLine + 1)
  const updateLine = findLine(lines, /total\s*(?:\+=|-=|=\s*total\s*[+-])/i, loopLine + 1)
  const outputLine = findLine(lines, /print\s*\(|printf|println|writeline|console\.log/i, lines.length)
  const variables: [VariableValue, VariableValue] = [makeVariable('i', String(start), language === 'javascript' ? 'number 数字' : 'int 整数', 'blue'), makeVariable('total', String(initial), language === 'javascript' ? 'number 数字' : 'int 整数', 'coral')]
  const events: TraceEvent[] = [event('start', 'start', 1, '程序开始', '进入程序入口，准备执行代码。', variables, 'start'), event('init', 'assign', initLine, '初始化 total', `total 从 0 变成 ${initial}。`, variables, 'init')]
  let total = initial
  for (let current = start; current <= limit; current += 1) {
    variables[0] = { name: variables[0].name, type: variables[0].type, color: variables[0].color, value: String(current) }
    events.push(event(`condition-${current}`, 'condition', loopLine, '检查循环条件', `判断 i <= ${limit}：当前 i = ${current}，结果为 true。`, variables, 'condition'))
    const before = total
    total = operation === 'subtract' ? total - current : total + current
    variables[1] = { name: variables[1].name, type: variables[1].type, color: variables[1].color, value: String(total) }
    events.push(event(`update-${current}`, 'loop', updateLine, '执行循环体', `total ${operation === 'subtract' ? '-' : '+'} ${current}：${before} 变成 ${total}。`, variables, 'update'))
  }
  variables[0] = { name: variables[0].name, type: variables[0].type, color: variables[0].color, value: String(limit + 1) }
  events.push(event('condition-end', 'condition', loopLine, '检查循环条件', `判断 i <= ${limit}：当前 i = ${limit + 1}，结果为 false，离开循环。`, variables, 'condition'))
  events.push(event('output', 'output', outputLine, '输出结果', `程序向控制台输出 ${total}。`, variables, 'output'))
  events.push(event('end', 'end', lines.length, '程序结束', '执行完成，退出码为 0。', variables, 'end'))
  return { events, output: [String(total)] }
}

function simulateCondition(lines: string[], _lesson: Lesson): ExecutionResult {
  const code = lines.join('\n')
  const number = getNumber(code, /number\s*=\s*(-?\d+)/i, 8)
  const even = number % 2 === 0
  const result = even ? '偶数' : '奇数'
  const variables = [makeVariable('number', String(number), '整数', 'blue'), makeVariable('result', result, '文本', 'coral')]
  const conditionLine = findLine(lines, /if\s+/i, 2)
  const resultLine = findLine(lines, /result\s*=/i, 3)
  const outputLine = findLine(lines, /print\s*\(/i, lines.length)
  const events = [event('start', 'start', 1, '程序开始', '读取 number 的初始值。', variables, 'start'), event('condition', 'condition', conditionLine, '判断奇偶', `${number} % 2 == 0 的结果是 ${even}。`, variables, 'condition'), event('branch', 'branch', resultLine, `进入 ${result} 分支`, `条件为 ${even ? '真' : '假'}，result = "${result}"。`, variables, 'branch'), event('output', 'output', outputLine, '输出结果', `程序向控制台输出 ${result}。`, variables, 'output'), event('end', 'end', lines.length, '程序结束', '执行完成，退出码为 0。', variables, 'end')]
  return { events, output: [result] }
}

function simulateGreeting(lines: string[], _lesson: Lesson): ExecutionResult {
  const code = lines.join('\n')
  const name = code.match(/greet\(\s*["']([^"']+)["']\s*\)/i)?.[1] ?? '小明'
  const result = `你好，${name}`
  const variables = [makeVariable('name', name, '文本', 'blue'), makeVariable('result', result, '文本', 'coral')]
  const callLine = findLine(lines, /result\s*=\s*greet/i, lines.length - 1)
  const returnLine = findLine(lines, /return\s+/i, 3)
  const outputLine = findLine(lines, /print\s*\(/i, lines.length)
  const events = [event('start', 'start', 1, '程序开始', '准备调用 greet 函数。', variables, 'start'), event('call', 'line', callLine, '调用 greet()', `把 name = "${name}" 传入函数。`, variables, 'call'), event('return', 'assign', returnLine, '返回 message', `函数返回 "${result}"。`, variables, 'return'), event('output', 'output', outputLine, '输出问候', `程序向控制台输出 ${result}。`, variables, 'output'), event('end', 'end', lines.length, '程序结束', '执行完成，退出码为 0。', variables, 'end')]
  return { events, output: [result] }
}
