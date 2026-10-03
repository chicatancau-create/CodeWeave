import type { LanguageId } from '../types/lesson'

/**
 * 轻量教学语法高亮 tokenizer（零运行时依赖，纯函数）。
 *
 * 只做词法级着色：关键字、字符串、注释、数字、函数调用。
 * 它不是编译器：不保证语义正确，仅用于可视化辅助；输入层始终是真实 textarea。
 */

export type TokenType = 'keyword' | 'string' | 'comment' | 'number' | 'function' | 'plain'

export type Token = {
  text: string
  type: TokenType
}

const KEYWORDS: Record<LanguageId, string[]> = {
  python: [
    'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'is',
    'import', 'from', 'as', 'class', 'try', 'except', 'finally', 'with', 'pass', 'break',
    'continue', 'lambda', 'global', 'nonlocal', 'raise', 'del', 'yield', 'match', 'case',
    'True', 'False', 'None',
  ],
  javascript: [
    'let', 'const', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch',
    'case', 'default', 'break', 'continue', 'new', 'class', 'extends', 'super', 'import',
    'export', 'from', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'delete',
    'in', 'of', 'void', 'await', 'async', 'yield', 'static', 'get', 'set', 'true', 'false',
    'null', 'undefined',
  ],
  java: [
    'public', 'private', 'protected', 'static', 'final', 'abstract', 'void', 'int', 'long',
    'double', 'float', 'boolean', 'char', 'byte', 'short', 'class', 'interface', 'enum',
    'extends', 'implements', 'new', 'return', 'if', 'else', 'for', 'while', 'do', 'switch',
    'case', 'default', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'throws',
    'import', 'package', 'this', 'super', 'instanceof', 'synchronized', 'true', 'false', 'null',
  ],
  c: [
    'int', 'char', 'float', 'double', 'void', 'long', 'short', 'unsigned', 'signed', 'struct',
    'union', 'enum', 'typedef', 'const', 'static', 'extern', 'register', 'volatile', 'return',
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue',
    'goto', 'sizeof', 'true', 'false',
  ],
  csharp: [
    'using', 'namespace', 'class', 'struct', 'interface', 'enum', 'record', 'public', 'private',
    'protected', 'internal', 'static', 'readonly', 'const', 'sealed', 'abstract', 'virtual',
    'override', 'void', 'int', 'long', 'double', 'float', 'bool', 'char', 'string', 'object',
    'var', 'dynamic', 'new', 'return', 'if', 'else', 'for', 'foreach', 'while', 'do', 'switch',
    'case', 'default', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'this', 'base',
    'in', 'out', 'ref', 'params', 'is', 'as', 'true', 'false', 'null',
  ],
}

/** 关键字按长度降序，保证正则交替优先匹配长词（如 instanceof 先于 in）。 */
function keywordPattern(language: LanguageId): string {
  const words = [...KEYWORDS[language]].sort((a, b) => b.length - a.length)
  return words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
}

/** 各语言词法规则：注释 / 字符串 / 数字 / 关键字 / 函数调用。C 额外支持预处理行。 */
function buildPattern(language: LanguageId): RegExp {
  const comment =
    language === 'python'
      ? '#[^\\n]*'
      : '//[^\\n]*|/\\*[\\s\\S]*?(?:\\*/|(?![\\s\\S]))'
  const string =
    language === 'python'
      ? '"""[\\s\\S]*?(?:"""|(?![\\s\\S]))|\'\'\'[\\s\\S]*?(?:\'\'\'|(?![\\s\\S]))|"(?:[^"\\\\\\n]|\\\\.)*(?:"|$)|\'(?:[^\'\\\\\\n]|\\\\.)*(?:\'|$)'
      : '"(?:[^"\\\\\\n]|\\\\.)*(?:"|$)|\'(?:[^\'\\\\\\n]|\\\\.)*(?:\'|$)'
  const preproc = language === 'c' ? '|^[ \\t]*#[ \\t]*\\w+[^\\n]*' : ''
  const pattern = `(?<comment>${comment})|(?<string>${string})|(?<number>\\b\\d+(?:\\.\\d+)?\\b)|(?<keyword>\\b(?:${keywordPattern(
    language,
  )})\\b${preproc})|(?<function>\\b[A-Za-z_]\\w*(?=\\s*\\())`
  return new RegExp(pattern, 'gm')
}

const patternCache = new Map<LanguageId, RegExp>()

function getPattern(language: LanguageId): RegExp {
  let pattern = patternCache.get(language)
  if (!pattern) {
    pattern = buildPattern(language)
    patternCache.set(language, pattern)
  }
  // exec 与 lastIndex 状态绑定，每次调用使用全新副本状态。
  pattern.lastIndex = 0
  return pattern
}

/** 把源码切分为带类型的 token 序列；相邻普通文本合并为 plain。空代码返回空数组。 */
export function tokenizeCode(code: string, language: LanguageId): Token[] {
  if (!code) return []

  const tokens: Token[] = []
  const pattern = getPattern(language)
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(code)) !== null) {
    // 零宽匹配保护：避免异常输入导致死循环。
    if (match.index === pattern.lastIndex) {
      pattern.lastIndex += 1
      continue
    }
    if (match.index > lastIndex) {
      tokens.push({ text: code.slice(lastIndex, match.index), type: 'plain' })
    }
    const groups = match.groups ?? {}
    const type: TokenType = groups.comment !== undefined
      ? 'comment'
      : groups.string !== undefined
        ? 'string'
        : groups.number !== undefined
          ? 'number'
          : groups.function !== undefined
            ? 'function'
            : 'keyword'
    tokens.push({ text: match[0], type })
    lastIndex = pattern.lastIndex
  }

  if (lastIndex < code.length) {
    tokens.push({ text: code.slice(lastIndex), type: 'plain' })
  }
  return tokens
}
