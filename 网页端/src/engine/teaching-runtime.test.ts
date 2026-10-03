import { describe, it, expect } from 'vitest'
import { simulateProgram, detectTemplate, detectTemplates, TEACHING_TEMPLATES, UNSUPPORTED_MESSAGE } from './teaching-runtime'
import type { Lesson } from '../types/lesson'

const mockLesson: Lesson = {
  id: 'test-lesson',
  language: 'python',
  languageLabel: 'Python',
  label: '01',
  title: 'Test Lesson',
  description: 'A test lesson',
  duration: '5 min',
  level: '入门',
  progress: 0,
  code: '',
  flow: [],
  insight: '',
  fileName: 'test.py',
  runtime: 'Python 3.11',
  content: {
    objective: '',
    prerequisites: [],
    explanation: [],
    examples: [],
    guidedSteps: [],
    exercise: '',
    variant: '',
    projectTask: '',
    mistakes: [],
    runCommand: '',
    completion: '',
    reviewOffsetsDays: [],
  },
}

describe('teaching-runtime', () => {
  describe('bracket validation', () => {
    it('should detect missing closing bracket', () => {
      const code = 'def greet(name):\n    print("Hello"'
      const result = simulateProgram(code, 'python', mockLesson)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('括号')
    })

    it('should detect mismatched brackets', () => {
      const code = 'values = [1, 2, 3)'
      const result = simulateProgram(code, 'python', mockLesson)
      expect(result.error).toBeDefined()
    })

    it('should pass with correct brackets', () => {
      const code = 'number = 8\nif number % 2 == 0:\n    result = "偶数"\nelse:\n    result = "奇数"\nprint(result)'
      const result = simulateProgram(code, 'python', mockLesson)
      expect(result.error).toBeUndefined()
    })
  })

  describe('conditional simulation', () => {
    it('should simulate even number correctly', () => {
      const code = 'number = 8\nif number % 2 == 0:\n    result = "偶数"\nelse:\n    result = "奇数"\nprint(result)'
      const result = simulateProgram(code, 'python', mockLesson)
      expect(result.output).toEqual(['偶数'])
      expect(result.events).toHaveLength(5)
    })

    it('should simulate odd number correctly', () => {
      const code = 'number = 7\nif number % 2 == 0:\n    result = "偶数"\nelse:\n    result = "奇数"\nprint(result)'
      const result = simulateProgram(code, 'python', mockLesson)
      expect(result.output).toEqual(['奇数'])
    })
  })

  describe('loop simulation', () => {
    it('should simulate while loop', () => {
      const code = 'count = 1\nwhile count <= 3:\n    print(count)\n    count = count + 1'
      const result = simulateProgram(code, 'python', mockLesson)
      expect(result.output).toEqual(['1', '2', '3'])
      expect(result.error).toBeUndefined()
    })

    it('should simulate for loop sum', () => {
      const code = 'total = 0\nfor i in range(1, 6):\n    total = total + i\nprint(total)'
      const result = simulateProgram(code, 'python', mockLesson)
      expect(result.output).toEqual(['15'])
    })
  })

  /* ---------------------------------------------------------------
     R4 G.3 第 5 条：无法识别结构时必须显式返回“未识别”，禁止猜测成功。
     --------------------------------------------------------------- */
  describe('R4：未识别结构不猜测成功', () => {
    it('对无法识别的代码返回 unsupported 与 teaching 等级，且不产生输出', () => {
      const code = 'const answer = computeSomething(data)\nrender(answer)'
      const result = simulateProgram(code, 'javascript', mockLesson)

      expect(result.unsupported).toBe(true)
      expect(result.tier).toBe('teaching')
      expect(result.output).toEqual([])
      expect(result.error?.message).toBe(UNSUPPORTED_MESSAGE)
      expect(result.events[0]?.label).toBe('未识别代码结构')
    })

    it('空代码返回 unsupported，而不是空输出视为成功', () => {
      const result = simulateProgram('', 'python', mockLesson)
      expect(result.unsupported).toBe(true)
      expect(result.output).toEqual([])
    })

    it('注释-only 代码返回 unsupported', () => {
      const result = simulateProgram('// 只是注释\n# 没有语句', 'javascript', mockLesson)
      expect(result.unsupported).toBe(true)
    })

    it('官方样例返回 tier=teaching 且不含 unsupported', () => {
      const code = 'count = 1\nwhile count <= 3:\n    print(count)\n    count = count + 1'
      const result = simulateProgram(code, 'python', mockLesson)
      expect(result.tier).toBe('teaching')
      expect(result.unsupported).toBeUndefined()
    })

    it('括号错误优先于模板识别，返回语法错误', () => {
      const result = simulateProgram('count = 1\nwhile count <= 3:\n    print(count', 'python', mockLesson)
      expect(result.unsupported).toBeUndefined()
      expect(result.error?.message).toContain('括号')
    })
  })

  describe('R4：模板登记表', () => {
    it('每个模板都声明输入语法与输出规则', () => {
      expect(TEACHING_TEMPLATES.length).toBeGreaterThan(0)
      for (const template of TEACHING_TEMPLATES) {
        expect(template.id).toBeTruthy()
        expect(template.title).toBeTruthy()
        expect(template.inputSyntax).toBeTruthy()
        expect(template.outputRule).toBeTruthy()
      }
    })

    it('detectTemplate 对官方样例返回对应模板', () => {
      expect(detectTemplate('total = 0\nfor i in range(1, 6):\n    total = total + i\nprint(total)', 'python')?.id).toBe('for-sum')
      expect(detectTemplate('count = 1\nwhile count <= 3:\n    print(count)', 'python')?.id).toBe('while-loop')
    })

    it('detectTemplate 对任意文本返回 undefined', () => {
      expect(detectTemplate('随便写点什么 random text here', 'python')).toBeUndefined()
    })

    it('每个模板都声明语言名单，名单里的语言都真实存在', () => {
      const known = new Set(['python', 'c', 'csharp', 'java', 'javascript'])
      for (const template of TEACHING_TEMPLATES) {
        expect(template.languages.length).toBeGreaterThan(0)
        for (const language of template.languages) expect(known.has(language)).toBe(true)
      }
    })

    /**
     * 子串匹配的三类巧合，改前都会被认领并交出模板算出来的假输出。
     * 判据只写「认不出」这一侧：认不出是老实的，认错才会把 19 印成这段程序的结果。
     */
    it('标识符、注释、字符串里的巧合不再被认领', () => {
      // message / language 里含着 age，console.log 又在
      expect(detectTemplate('const message = "hi"\nconst language = "Python"\nconsole.log(message)', 'javascript')).toBeUndefined()
      // 注释里写了 for 与 total，代码里一个都没有
      expect(detectTemplate('# 这里不做 for 累加，total 也不出现\nprint("ok")', 'python')).toBeUndefined()
      // %2 只出现在格式串里（printf("%2d")），不是取模
      expect(detectTemplate('int n = 7;\nprintf("%2d", n);\nreturn 0;', 'c')).toBeUndefined()
      // 字符串里写着「你好」，代码里没有输出语句
      expect(detectTemplate('name = "你好"\nprint(name)', 'python')?.id).toBe('greeting-cn')
    })

    it('不在语言名单里的模板跳过：Python 里出现 int a 也只可能是巧合', () => {
      expect(detectTemplate('int a = 3  # 这是注释里的 C 写法\nint b = 5\nif True:\n    print(max(a,b))', 'python')).toBeUndefined()
      expect(detectTemplate('int a = 3;\nint b = 5;\nif (a > b) printf("%d", a);', 'c')?.id).toBe('max-of-two')
    })

    it('拆注释与字符串不改变行号：括号错仍报在原来那一行', () => {
      const code = 'count = 1\n# 说明 "未闭合的引号\nwhile count <= 3:\n    print('
      const result = simulateProgram(code, 'python', mockLesson)
      expect(result.error?.line).toBe(4)
      expect(result.error?.message).toContain('缺少一个结束括号')
    })

    /**
     * S11 复现的那份 134 行 Python 参考实现（练习页 cw-py-loop-range-001-ex1）就是这个形状：
     * while、for…total、`if a % 2 == 0` 三种结构都在里面，旧实现按登记表顺序认领第一个命中的 parity，
     * 交出 `["偶数"]`，而它本机真跑是 22 行。单模板模拟器对多主题程序选哪一种都是假输出。
     */
    it('while 与 for 同时出现时两条循环模板都不认领（互斥）', () => {
      const code = 'count = 1\ntotal = 0\nwhile count <= 3:\n    for i in range(1, 3):\n        total += i\n    print(count)'
      expect(detectTemplates(code, 'python')).toEqual([])
      expect(detectTemplate(code, 'python')).toBeUndefined()
    })

    it('命中两条模板时不选第一个，判「结构不唯一」并点名候选', () => {
      const code = 'age = 18\nscore = 70\nif score > 60:\n    print(age)'
      const hits = detectTemplates(code, 'python')
      expect(hits.map((t) => t.id)).toEqual(['score-branch', 'age-increment'])
      expect(detectTemplate(code, 'python')).toBeUndefined()
      const result = simulateProgram(code, 'python', mockLesson)
      expect(result.unsupported).toBe(true)
      expect(result.output).toEqual([])
      expect(result.error?.message).toContain('同时含 2 种支持模板的结构')
      expect(result.error?.message).toContain('成绩及格分支')
      expect(result.events[0]?.label).toBe('结构不唯一')
    })

    it('detectTemplates 交出全部命中，detectTemplate 只在唯一命中时放行', () => {
      const code = 'age = 18\nconsole.log(age + 1)'
      expect(detectTemplates(code, 'javascript').map((t) => t.id)).toEqual(['age-increment'])
      expect(detectTemplate(code, 'javascript')?.id).toBe('age-increment')
    })
  })

  /**
   * 逐拍变量快照（回归守卫）。
   *
   * 曾经的真缺陷：模板为省事复用同一个 `variables` 数组对象原地改写，再把**同一个引用**
   * 推进每一拍，于是所有事件读到的都是终值——`start` 也说 `i=6,total=15`。画布要显示
   * 「这一格刚被改过」和流程图要显示 `a = 4` 的明细，都依赖这条契约成立。
   */
  describe('逐拍变量快照', () => {
    it('每一拍挂的是自己的快照，事件之间不共享数组对象', () => {
      const code = 'total = 0\nfor i in range(1, 6):\n    total += i\nprint(total)'
      const { events } = simulateProgram(code, 'python', mockLesson)
      expect(events.length).toBeGreaterThan(4)

      for (let i = 1; i < events.length; i++) {
        expect(events[i]!.variables, `第 ${i} 拍与第 ${i - 1} 拍共享了数组对象`).not.toBe(events[i - 1]!.variables)
      }
      // 连格也不许共享：只复制外层数组、里面仍塞着同一个对象，等于没复制。
      // 两拍之间只要有**同名**变量，它们必须是两个对象。
      for (let i = 1; i < events.length; i++) {
        const prev = events[i - 1]!.variables
        for (const v of events[i]!.variables) {
          const twin = prev.find((p) => p.name === v.name)
          if (twin) expect(v, `第 ${i} 拍的 ${v.name} 与上一拍是同一个对象`).not.toBe(twin)
        }
      }
    })

    it('for-sum 的循环变量逐拍前进，而不是一路终值', () => {
      const code = 'total = 0\nfor i in range(1, 6):\n    total += i\nprint(total)'
      const { events } = simulateProgram(code, 'python', mockLesson)
      const iOf = (index: number) => events[index]!.variables.find((v) => v.name === 'i')?.value

      // 首拍是起点值，不是终值——这正是这条守卫存在的理由。
      expect(iOf(0)).toBe('1')
      // 逐拍取出来的 i 不是同一个值：程序在跑，快照在动。
      const everyI = events.map((e) => e.variables.find((v) => v.name === 'i')?.value)
      expect(new Set(everyI).size).toBeGreaterThan(1)
      // 末拍的 i 走到了 6（`range(1, 6)` 跑完），total 累加到 15。
      expect(iOf(events.length - 1)).toBe('6')
      expect(events.at(-1)!.variables.find((v) => v.name === 'total')?.value).toBe('15')
    })
  })
})
