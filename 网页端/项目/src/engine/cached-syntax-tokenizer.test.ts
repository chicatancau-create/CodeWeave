import { describe, expect, it, vi } from 'vitest'
import type { LanguageId } from '../types/lesson'
import { createCachedTokenizer } from './cached-syntax-tokenizer'
import { tokenizeCode } from './syntax-tokenizer'

const languages: LanguageId[] = ['python', 'javascript', 'java', 'c', 'csharp']

describe('cached-syntax-tokenizer', () => {
  it.each(languages)('%s 的逐行结果与全文 token 类型、文本和边界完全一致', (language) => {
    const cached = createCachedTokenizer()
    const documents = [
      '', '\n', '\n\n', '  \n tail\n',
      'value = 1\nprint(value)\nvalue = 2',
      'if (value >= 2) {\n  call(value);\n}\n',
      'name = "for call(1)"\n// comment 2\n# comment 3',
      'name = "unterminated\nvalue = 2',
      'name = "escaped \\" quote"\nvalue = \'single\'',
      '#include <stdio.h>\nint main() {\n  return 0;\n}',
      'value = 1\r\n// comment\r\nprint(value)\r\n',
      'plain\r\n\r\n tail\r\n',
    ]
    for (const code of documents) {
      expect(cached(code, language), JSON.stringify(code)).toEqual(tokenizeCode(code, language))
    }
  })

  it.each(languages)('%s 的跨行函数前瞻沿用全文解析，包含空行与 CRLF', (language) => {
    const tokenize = vi.fn(tokenizeCode)
    const cached = createCachedTokenizer(tokenize)
    for (const code of ['invoke\n(value)', 'invoke \n \n (value)', 'invoke\r\n  (value)']) {
      expect(cached(code, language)).toEqual(tokenizeCode(code, language))
      expect(tokenize).toHaveBeenLastCalledWith(code, language)
    }
    expect(tokenize).toHaveBeenCalledTimes(3)
  })

  it.each(languages)('%s 的边界片段组合与全文解析一致', (language) => {
    const cached = createCachedTokenizer()
    const fragments = [
      'plain', '', 'call', '(', ')', '1.2', '"quote', "'quote", '"\\',
      '# comment', '// comment', '/*', '*/', '"""', "'''", '\r', ' name ', '\t', '\u2028',
    ]
    for (const first of fragments) {
      for (const last of fragments) {
        const code = `${first}\n${last}`
        expect(cached(code, language), JSON.stringify(code)).toEqual(tokenizeCode(code, language))
      }
    }
  })

  it('大量空行的粘贴保持原文，跨空行的函数前瞻仍回退全文解析', () => {
    const tokenize = vi.fn(tokenizeCode)
    const cached = createCachedTokenizer(tokenize)
    const whitespace = '\n'.repeat(12000)
    const plain = `call${whitespace}value`
    expect(cached(plain, 'javascript')).toEqual(tokenizeCode(plain, 'javascript'))
    expect(tokenize).toHaveBeenCalledTimes(3)
    const call = `call${whitespace}(value)`
    expect(cached(call, 'javascript')).toEqual(tokenizeCode(call, 'javascript'))
    expect(tokenize).toHaveBeenLastCalledWith(call, 'javascript')
  })

  it.each(['javascript', 'java', 'c', 'csharp'] as const)('%s 的块注释不被拆开，包含未闭合输入', (language) => {
    const tokenize = vi.fn(tokenizeCode)
    const cached = createCachedTokenizer(tokenize)
    for (const code of [
      'value = 1\n/* call(2)\nreturn 3 */\nvalue = 4',
      '/* first\r\nsecond',
      '"/* literal */"\nvalue = 2',
    ]) {
      expect(cached(code, language)).toEqual(tokenizeCode(code, language))
      expect(tokenize).toHaveBeenLastCalledWith(code, language)
    }
    expect(tokenize).toHaveBeenCalledTimes(3)
  })

  it('Python 三引号字符串和未闭合字符串沿用全文解析', () => {
    const tokenize = vi.fn(tokenizeCode)
    const cached = createCachedTokenizer(tokenize)
    for (const quote of ['"""', "'''"]) {
      for (const code of [`${quote}\nvalue = 1\n${quote}\nprint(2)`, `${quote}first\r\nsecond`]) {
        expect(cached(code, 'python')).toEqual(tokenizeCode(code, 'python'))
        expect(tokenize).toHaveBeenLastCalledWith(code, 'python')
      }
    }
    expect(tokenize).toHaveBeenCalledTimes(4)
  })

  it('500 行中编辑一行只重新解析该行，插入和删除不会使其余行失效', () => {
    const tokenize = vi.fn(tokenizeCode)
    const cached = createCachedTokenizer(tokenize)
    const lines = Array.from({ length: 500 }, (_, index) => `const value${index} = ${index};`)
    const check = () => {
      const code = lines.join('\n')
      expect(cached(code, 'javascript')).toEqual(tokenizeCode(code, 'javascript'))
    }
    check()
    expect(tokenize).toHaveBeenCalledTimes(500)
    lines[250] = 'const edited = 500;'
    check()
    expect(tokenize).toHaveBeenCalledTimes(501)
    lines.splice(10, 0, 'const inserted = 501;')
    check()
    expect(tokenize).toHaveBeenCalledTimes(502)
    lines.splice(15, 1)
    check()
    expect(tokenize).toHaveBeenCalledTimes(502)
  })

  it('重复行只解析一次；移除的行不会保留在缓存中', () => {
    const tokenize = vi.fn(tokenizeCode)
    const cached = createCachedTokenizer(tokenize)
    cached('let a = 1\nlet a = 1\nlet b = 2', 'javascript')
    expect(tokenize).toHaveBeenCalledTimes(2)
    cached('let b = 2', 'javascript')
    expect(tokenize).toHaveBeenCalledTimes(2)
    cached('let a = 1\nlet b = 2', 'javascript')
    expect(tokenize).toHaveBeenCalledTimes(3)
  })

  it('切换语言、清空文档或回退全文解析都会丢弃旧行缓存', () => {
    const tokenize = vi.fn(tokenizeCode)
    const cached = createCachedTokenizer(tokenize)
    const line = 'let value = 1;'
    for (const language of ['javascript', 'python', 'javascript'] as const) {
      expect(cached(line, language)).toEqual(tokenizeCode(line, language))
    }
    expect(tokenize).toHaveBeenCalledTimes(3)
    expect(cached('', 'javascript')).toEqual([])
    cached(line, 'javascript')
    expect(tokenize).toHaveBeenCalledTimes(4)
    cached('/* comment\nend */', 'javascript')
    cached(line, 'javascript')
    expect(tokenize).toHaveBeenCalledTimes(6)
  })

  it('两个实例互不共享文档缓存', () => {
    const tokenize = vi.fn(tokenizeCode)
    const first = createCachedTokenizer(tokenize)
    const second = createCachedTokenizer(tokenize)
    const code = 'let value = 1;'
    first(code, 'javascript')
    second(code, 'javascript')
    expect(tokenize).toHaveBeenCalledTimes(2)
    first(code, 'javascript')
    expect(tokenize).toHaveBeenCalledTimes(2)
    second('let other = 2;', 'javascript')
    first(code, 'javascript')
    expect(tokenize).toHaveBeenCalledTimes(3)
  })

  it('合并相邻 plain token 时不修改缓存结果或此前返回的 token', () => {
    const tokenize = vi.fn((code: string, language: LanguageId) => {
      const tokens = tokenizeCode(code, language)
      for (const token of tokens) Object.freeze(token)
      Object.freeze(tokens)
      return tokens
    })
    const cached = createCachedTokenizer(tokenize)
    const first = cached('plain\ntail', 'javascript')
    expect(first).toEqual([{ type: 'plain', text: 'plain\ntail' }])
    expect(cached('plain\nchanged', 'javascript')).toEqual(tokenizeCode('plain\nchanged', 'javascript'))
    expect(first).toEqual([{ type: 'plain', text: 'plain\ntail' }])
    first[0]!.text = 'caller changed output'
    expect(cached('plain\ntail', 'javascript')).toEqual(tokenizeCode('plain\ntail', 'javascript'))
  })
})
