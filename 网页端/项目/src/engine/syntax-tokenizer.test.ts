import { describe, expect, it } from 'vitest'
import { tokenizeCode, type Token } from './syntax-tokenizer'

const types = (tokens: Token[]) => tokens.map((token) => token.type)
const texts = (tokens: Token[]) => tokens.map((token) => token.text)
const joined = (tokens: Token[]) => texts(tokens).join('')

describe('syntax-tokenizer', () => {
  it('空代码返回空数组且不崩溃', () => {
    expect(tokenizeCode('', 'python')).toEqual([])
  })

  it('重建拼接结果与输入完全一致（python 多行）', () => {
    const code = 'total = 0\nfor i in range(1, 6):\n    total = total + i\nprint(total)'
    const tokens = tokenizeCode(code, 'python')
    expect(joined(tokens)).toBe(code)
  })

  it('字符串中的关键字与函数样式不被误高亮', () => {
    const tokens = tokenizeCode('label = "for i in range(3)"', 'python')
    const stringToken = tokens.find((token) => token.type === 'string')
    expect(stringToken?.text).toContain('for i in range(3)')
    // 引号之外不得出现 keyword / function
    const outside = tokens.filter((token) => token.type === 'keyword' || token.type === 'function')
    expect(outside).toEqual([])
  })

  it('注释中的代码不再着色（python #）', () => {
    const tokens = tokenizeCode('total = 0  # for x in y: def fake()', 'python')
    const comment = tokens.find((token) => token.type === 'comment')
    expect(comment?.text).toBe('# for x in y: def fake()')
    expect(types(tokens)).not.toContain('function')
  })

  it('注释中的代码不再着色（c 风格 //）', () => {
    const tokens = tokenizeCode('int a = 1; // const x = "s"', 'java')
    const comment = tokens.find((token) => token.type === 'comment')
    expect(comment?.text).toBe('// const x = "s"')
    expect(types(tokens).filter((type) => type === 'string')).toEqual([])
  })

  it('多行块注释整体为单个 comment（java）', () => {
    const code = '/* int a = 1;\n   for (int i = 0; i < n; i++) {\n   } */\nint b = 2;'
    const tokens = tokenizeCode(code, 'java')
    const comments = tokens.filter((token) => token.type === 'comment')
    expect(comments).toHaveLength(1)
    expect(comments[0]?.text).toContain('for (int i = 0')
    // 块注释之后的关键字仍然着色
    expect(tokens.filter((token) => token.text === 'int' && token.type === 'keyword')).toHaveLength(1)
  })

  it('python 三引号字符串跨行整体为 string', () => {
    const code = '"""\nfor x in y:\ndef fake():\n"""\nprint("done")'
    const tokens = tokenizeCode(code, 'python')
    const comments = tokens.filter((token) => token.type === 'comment')
    expect(comments).toEqual([])
    const strings = tokens.filter((token) => token.type === 'string')
    // docstring + "done" 共两个字符串 token
    expect(strings).toHaveLength(2)
    expect(strings[0]?.text).toContain('for x in y')
    expect(tokens.filter((token) => token.text === 'print' && token.type === 'function')).toHaveLength(1)
  })

  it('函数调用着色、关键字优先于函数（if ( 不算函数）', () => {
    const tokens = tokenizeCode('if (score >= 60) {\n  System.out.println(score);\n}', 'java')
    expect(types(tokens)).toContain('function')
    expect(tokens.find((token) => token.text === 'if')?.type).toBe('keyword')
    expect(tokens.find((token) => token.text === 'println')?.type).toBe('function')
  })

  it('数字（整数与小数）着色', () => {
    const tokens = tokenizeCode('let x = 1.5;\nlet y = 42;', 'javascript')
    const numbers = texts(tokens.filter((token) => token.type === 'number'))
    expect(numbers).toEqual(['1.5', '42'])
  })

  it('C 预处理行按关键字着色且 <stdio.h> 不误判为字符串', () => {
    const tokens = tokenizeCode('#include <stdio.h>\nint main() { return 0; }', 'c')
    const preproc = tokens.find((token) => token.text.startsWith('#include'))
    expect(preproc?.type).toBe('keyword')
    expect(types(tokens)).not.toContain('string')
  })

  it('长关键字先于短关键字匹配（instanceof / in）', () => {
    const tokens = tokenizeCode('if (a instanceof b) { }', 'javascript')
    const inToken = tokens.find((token) => token.text === 'in')
    expect(inToken).toBeUndefined()
    expect(tokens.find((token) => token.text === 'instanceof')?.type).toBe('keyword')
  })

  it('未闭合字符串到行尾安全截断，不影响下一行', () => {
    const code = 'x = "未闭合\ny = 2'
    const tokens = tokenizeCode(code, 'python')
    expect(joined(tokens)).toBe(code)
    const strings = tokens.filter((token) => token.type === 'string')
    expect(strings).toHaveLength(1)
    expect(strings[0]?.text).not.toContain('y = 2')
    expect(tokens.find((token) => token.text === '2')?.type).toBe('number')
  })
})
