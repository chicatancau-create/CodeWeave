import type { LanguageId } from '../types/lesson'
import { tokenizeCode, type Token } from './syntax-tokenizer'

function needsWholeDocument(code: string, language: LanguageId): boolean {
  // 这些词法结构可以跨越换行，交给原 tokenizer 保持完整 token 边界。
  const multilineLiteral = language === 'python'
    ? code.includes('"""') || code.includes("'''")
    : code.includes('/*')
  // 前段不跨 LF，避免两段空白匹配在大量空行上反复回溯。
  return multilineLiteral || /\b[A-Za-z_]\w*[^\S\n]*\n\s*\(/.test(code)
}

function appendToken(output: Token[], token: Token): void {
  const previous = output.at(-1)
  if (previous?.type === 'plain' && token.type === 'plain') previous.text += token.text
  else output.push({ ...token })
}

/** 每个编辑器单独创建；仅缓存当前文档、当前语言仍然存在的行。 */
export function createCachedTokenizer(tokenize = tokenizeCode): typeof tokenizeCode {
  let cachedLanguage: LanguageId | null = null
  let cachedLines = new Map<string, Token[]>()

  return (code, language) => {
    if (language !== cachedLanguage) {
      cachedLines.clear()
      cachedLanguage = language
    }
    if (!code || needsWholeDocument(code, language)) {
      cachedLines.clear()
      return code ? tokenize(code, language) : []
    }

    const nextLines = new Map<string, Token[]>()
    const output: Token[] = []
    const lines = code.split('\n')
    for (const [index, line] of lines.entries()) {
      const tokens = nextLines.get(line) ?? cachedLines.get(line) ?? tokenize(line, language)
      nextLines.set(line, tokens)
      if (index > 0) appendToken(output, { type: 'plain', text: '\n' })
      // appendToken 只修改输出副本，缓存行的 tokens 始终保持不变。
      for (const token of tokens) appendToken(output, token)
    }
    cachedLines = nextLines
    return output
  }
}
