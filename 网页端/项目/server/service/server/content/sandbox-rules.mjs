/**
 * JavaScript 教学沙箱的提示性检查（**后端副本**，契约源见 `contracts/sandbox-rules.json`）。
 *
 * 为什么后端要自己有一份：`tests/content.unit.discipline.test.mjs` 要拿教材资料库里的每一个 JS
 * 代码块过一遍这道检查——一道题的参考实现只要有一行被拦，学习者在应用内一行都跑不了。
 * 分离方案 §2 的耦合表把「后端测试直接 import `../../frontend/src/…`」列为必须消除的耦合，
 * §5 又只允许「不含业务状态的格式定义」跨边界共享，所以清单从网页端执行引擎抽成契约数据，
 * 后端按契约实现，两端各留可核对的副本：
 *   - 后端：本文件 + `tests/content.sandbox.contract.test.mjs`（逐例复现判据行为）；
 *   - 网页端：`【网页端】_WEB_CLIENT/tests/contract.copies.test.mjs`（把它的 `src/engine/javascript-sandbox.ts`
 *     与本契约逐项比对，清单漂了就红）。
 *
 * 语义红线（照契约 `match` 一节，逐字对应原实现，不许改宽也不许改窄）：
 * 1. **按行、按字面量**：先按 `\n` 切行，把每一行的原始文本直接喂给 `RegExp.test`——不 trim、
 *    不剥注释、不做 AST、不解析字符串拼接；
 * 2. **按 patterns 的书写顺序**取第一个命中的模式，报告那一行的 1 基行号；顺序变了，报告的行号就变了；
 * 3. 模式**一律不带 `g`**：带 `g` 的共享 RegExp 会把 `lastIndex` 留在上一次匹配上，
 *    下一条行会被同一次调用跳过（原实现就是这个原因才全部只用 `i`）。加载契约时就校验，不符直接抛。
 *
 * 它是提示性检查，不是安全边界（R4 G.3 第 4 条）：字符串拼接与动态属性访问都不在拦截面内，
 * 真正的隔离是 Worker（无 DOM、无同源存储、可 terminate）与超时上限。UI 不得据它宣称「绝对安全」。
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** 契约文件是本包的共享数据，不在 `service/` 里：从本模块上溯三层到包根。 */
export const SANDBOX_CONTRACT_PATH = join(resolve(import.meta.dirname, '..', '..', '..'), 'contracts', 'sandbox-rules.json')
export const SANDBOX_CONTRACT_SCHEMA_VERSION = 1

function loadRules() {
  const raw = JSON.parse(readFileSync(SANDBOX_CONTRACT_PATH, 'utf8'))
  if (raw.schemaVersion !== SANDBOX_CONTRACT_SCHEMA_VERSION) {
    throw new Error(`沙箱契约 schemaVersion=${raw.schemaVersion}，本副本只认 ${SANDBOX_CONTRACT_SCHEMA_VERSION}`)
  }
  if (typeof raw.message !== 'string' || raw.message.trim() === '') {
    throw new Error('沙箱契约缺少拦截文案 message：报给学习者的话不许在副本里各写一份')
  }
  if (raw.match?.unit !== 'line' || raw.match?.lineSplitter !== '\n') {
    throw new Error('沙箱契约的匹配单位必须是「按行 + 以 \\n 切分」：改成别的口径就不是那份提示性检查了')
  }
  if (raw.security?.advisoryOnly !== true) {
    throw new Error('沙箱契约必须写明它是提示性检查而不是安全边界（R4 G.3 第 4 条）')
  }
  const forbidden = new Set(raw.match?.forbiddenFlags ?? [])
  const patterns = Array.isArray(raw.patterns) ? raw.patterns : []
  if (patterns.length === 0) throw new Error('沙箱契约的 patterns 是空的：判据会一直绿着放行全部代码')
  const compiled = patterns.map((rule, index) => {
    if (typeof rule?.id !== 'string' || rule.id.trim() === '') throw new Error(`沙箱契约第 ${index + 1} 条模式缺少 id`)
    if (typeof rule.source !== 'string' || rule.source === '') throw new Error(`沙箱契约模式 ${rule.id} 缺少 source`)
    if (typeof rule.flags !== 'string') throw new Error(`沙箱契约模式 ${rule.id} 的 flags 必须是字符串（可以为空串）`)
    for (const flag of rule.flags) {
      if (forbidden.has(flag)) throw new Error(`沙箱契约模式 ${rule.id} 带被禁止的 flag「${flag}」：共享 RegExp 会残留 lastIndex`)
    }
    try {
      // 每条一个**新** RegExp 实例：即使 flags 合法，跨调用复用同一实例也是不必要的状态。
      return { id: rule.id, regexp: new RegExp(rule.source, rule.flags) }
    } catch (error) {
      throw new Error(`沙箱契约模式 ${rule.id} 的正则无法编译：${error.message}`)
    }
  })
  return {
    message: raw.message,
    contractSource: raw.contractSource,
    advisoryOnly: raw.security.advisoryOnly === true,
    knownBypass: Array.isArray(raw.security.knownBypass) ? raw.security.knownBypass : [],
    lineSplitter: raw.match.lineSplitter,
    patterns: compiled,
  }
}

export const SANDBOX_RULES = loadRules()

/** 与网页端 `ADVISORY_PATTERNS` 同序、同源、同 flags 的清单（只读，供核对与诊断用）。 */
export const ADVISORY_PATTERNS = Object.freeze(SANDBOX_RULES.patterns.map((pattern) => pattern.id))

/**
 * 一份待进沙箱的代码是否会被提示性检查拦下。
 *
 * @param {string} code 代码块原文
 * @returns {{ line: number, message: string } | undefined} 命中给 1 基行号与固定文案；干净代码返回 `undefined`
 */
export function validateJavaScriptSandbox(code) {
  const lines = String(code ?? '').split(SANDBOX_RULES.lineSplitter)
  for (const { regexp } of SANDBOX_RULES.patterns) {
    const line = lines.findIndex((sourceLine) => regexp.test(sourceLine))
    if (line >= 0) return { line: line + 1, message: SANDBOX_RULES.message }
  }
  return undefined
}
