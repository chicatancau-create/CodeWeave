/**
 * 契约「副本 == 契约源」的**网页端那一半**（分离方案 §5 允许跨边界共享的两份格式定义）。
 *
 * 后端包不再用相对路径 import 网页端源码来做核心断言（§2 耦合表第 3 条），改读
 * `contracts/sandbox-rules.json` 与 `contracts/asset-whitelist.json`。那么「网页端那份实现
 * 还是不是契约说的那份」就必须在网页端这一侧当场核——就是本文件。
 * 服务端那一半在本项目 `server/service/` 的契约与服务测试中维护。
 * 与 `.../tests/content.asset.test.mjs`：两侧各自对齐契约，就等于两侧互相等价，
 * 而且不需要任何一端读另一端的源码。
 *
 * 本文件只读两类东西：网页端自己的源码（同侧，合法）与后端的 `contracts/*.json`
 * （§5 明确允许两端只读消费的共享契约）。**不 import 后端 `service/**` 的运行时代码。**
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { contract, importWebScript, webScript } from './layout.mjs'

const sandboxContract = JSON.parse(readFileSync(contract('sandbox-rules.json'), 'utf8'))
const assetContract = JSON.parse(readFileSync(contract('asset-whitelist.json'), 'utf8'))

const sandboxSource = readFileSync(webScript('src/engine/javascript-sandbox.ts'), 'utf8')
const wikilinkSource = readFileSync(webScript('src/content/wikilink.ts'), 'utf8')

/** 从 `const ADVISORY_PATTERNS: RegExp[] = [ … ]` 里按书写顺序取出 `/源码/flags` 对。 */
function patternsFromSource(source) {
  const block = /const ADVISORY_PATTERNS:\s*RegExp\[\]\s*=\s*\[([\s\S]*?)\n\]/.exec(source)
  expect(block, '读不到 ADVISORY_PATTERNS 数组：那份清单的写法变了，契约核对会静默空转').toBeTruthy()
  const codeOnly = (block?.[1] ?? '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
  const found = [...codeOnly.matchAll(/\/(.+?)\/([a-z]*)/g)].map((match) => ({ source: match[1], flags: match[2] }))
  expect(found.length, '一条模式都没取到：本条等于没判').toBeGreaterThan(0)
  return found
}

/** 从 `export const X = [...] as const` 里按书写顺序取字符串数组。 */
function stringArrayFromSource(source, exportName) {
  const block = new RegExp(`export const ${exportName}[^=]*=\\s*\\[([^\\]]*)\\]`, 'm').exec(source)
  expect(block, `读不到 ${exportName}：白名单常量的写法变了，契约核对会静默空转`).toBeTruthy()
  const items = [...(block?.[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1])
  expect(items.length, `${exportName} 一个元素都没取到`).toBeGreaterThan(0)
  return items
}

describe('沙箱清单：网页端实现 == contracts/sandbox-rules.json', () => {
  const actual = patternsFromSource(sandboxSource)
  const declared = sandboxContract.patterns

  it('模式的数量、顺序、正则源码与 flags 逐条相同（改一边不改另一边会红）', () => {
    expect(actual.map((pattern) => pattern.source), '正则源码或顺序与契约不一致').toEqual(declared.map((pattern) => pattern.source))
    expect(actual.map((pattern) => pattern.flags), 'flags 与契约不一致：i 决定大小写，g 会残留 lastIndex').toEqual(
      declared.map((pattern) => pattern.flags),
    )
    for (const pattern of actual) expect(pattern.flags, `模式 /${pattern.source}/ 带了 g`).not.toContain('g')
  })

  it('判据形状还在那里：按行切、按行 findIndex、返回 1 基行号与契约文案', async () => {
    const { validateJavaScriptSandbox } = await importWebScript('src/engine/javascript-sandbox.ts')
    expect(sandboxSource).toMatch(/code\.split\('\\n'\)/)
    expect(sandboxSource).toMatch(/lines\.findIndex\(\(sourceLine\)\s*=>\s*pattern\.test\(sourceLine\)\)/)
    const shape = /return\s*\{\s*line:\s*line \+ 1,\s*message:\s*'([^']+)'/.exec(sandboxSource)
    expect(shape, '拦截返回的形状（1 基行号 + 固定文案）变了：契约的 match 一节要跟着核实').toBeTruthy()
    expect(shape[1], '网页端实现里的拦截文案与契约不是同一句').toBe(sandboxContract.message)

    // 行为对齐：同一批样本，网页端实现与契约文案必须给出同样的判定。
    const samples = [
      'fetch("https://api.example.com")',
      'eval("alert(1)")',
      'window.location = "/"',
      'console.log("Hello")',
      'let x = 5; let y = x + 3; console.log(y);',
      'function add(a, b) { return a + b; }',
      'const f = new Function("return 1");',
      'const k = ["fe", "tch"].join(""); void k',
      'importScripts("https://evil.com/x.js")',
      'new WebSocket("wss://evil.com")',
      'indexedDB.open("x")',
      'const a = 1\nconsole.log(this)\nwindow.title',
    ]
    for (const sample of samples) {
      const rejected = validateJavaScriptSandbox(sample)
      if (!rejected) continue
      expect(rejected.message, sample).toBe(sandboxContract.message)
    }
  })

  it('清单里每一条能力都真的拦得住网页端实现（契约不是装饰品）', async () => {
    const { validateJavaScriptSandbox } = await importWebScript('src/engine/javascript-sandbox.ts')
    const probes = {
      'network-apis': 'fetch("/x")',
      'eval-call': 'eval("1")',
      'function-constructor-call': 'new Function("return 1")',
      'storage-and-worker-apis': 'indexedDB.open("x")',
      'page-and-host-globals': 'window.top',
      'module-and-runtime-apis': 'require("fs")',
      'this-binding': 'const t = this',
    }
    for (const [id, sample] of Object.entries(probes)) {
      expect(declared.map((pattern) => pattern.id), `契约里缺模式 ${id}`).toContain(id)
      expect(validateJavaScriptSandbox(sample), `${id} 在网页端实现里没被拦`).toBeTruthy()
    }
  })
})

/**
 * 从源码里取出 `ASSET_ALLOWED_EXTENSIONS` 的实际成员：它是一个 spread 组合
 * （`[...ASSET_IMAGE_EXTENSIONS, ...ASSET_DOCUMENT_EXTENSIONS, ...ASSET_TEXT_EXTENSIONS]`），
 * 所以「成员」= 那三档常量的并集，顺序按 spread 的书写顺序。
 */
function allowedExtensionsFromSource(source) {
  const block = /export const ASSET_ALLOWED_EXTENSIONS:\s*readonly string\[\]\s*=\s*\[([\s\S]*?)\n\]/.exec(source)
  expect(block, '读不到 ASSET_ALLOWED_EXTENSIONS：全集常量的写法变了').toBeTruthy()
  const parts = [...(block?.[1] ?? '').matchAll(/\.\.\.([A-Z_]+)/g)].map((match) => match[1])
  expect(parts.length, 'ASSET_ALLOWED_EXTENSIONS 不再是三档常量的 spread 组合：核对口径要跟着改').toBe(3)
  const nameOf = { ASSET_IMAGE_EXTENSIONS: 'image', ASSET_DOCUMENT_EXTENSIONS: 'document', ASSET_TEXT_EXTENSIONS: 'text' }
  expect(parts.map((name) => nameOf[name]), '全集的组合顺序与契约类别顺序不一致').toEqual(
    assetContract.categories.map((category) => category.id),
  )
  return parts.flatMap((name) => stringArrayFromSource(source, name))
}

describe('附件白名单：网页端实现 == contracts/asset-whitelist.json', () => {
  const contractCategory = (id) => assetContract.categories.find((category) => category.id === id)?.extensions ?? []

  it('位图 / 文档 / 文本三档扩展名逐条相同（含顺序），全集等于三档并集', () => {
    expect(stringArrayFromSource(wikilinkSource, 'ASSET_IMAGE_EXTENSIONS'), '位图档与契约不一致').toEqual(contractCategory('image'))
    expect(stringArrayFromSource(wikilinkSource, 'ASSET_DOCUMENT_EXTENSIONS'), '文档档与契约不一致').toEqual(contractCategory('document'))
    expect(stringArrayFromSource(wikilinkSource, 'ASSET_TEXT_EXTENSIONS'), '文本档与契约不一致').toEqual(contractCategory('text'))
    expect(allowedExtensionsFromSource(wikilinkSource)).toEqual([
      ...contractCategory('image'),
      ...contractCategory('document'),
      ...contractCategory('text'),
    ])
  })

  it('接口路径与两条理由文案同源', async () => {
    const { ASSET_ENDPOINT, resolveImageAttachment } = await importWebScript('src/content/wikilink.ts')
    expect(ASSET_ENDPOINT).toBe(assetContract.endpoint)
    expect(assetContract.neverOpened.extensions).toContain('svg')
    const allowed = allowedExtensionsFromSource(wikilinkSource)
    for (const ext of assetContract.neverOpened.extensions) {
      expect(allowed, `${ext} 竟然在白名单里`).not.toContain(ext)
      expect(resolveImageAttachment(`复习大纲/a.${ext}`).kind, `${ext} 竟然被内嵌显示`).toBe('text')
    }
    expect(resolveImageAttachment('复习大纲/a.pdf').kind).toBe('text')
    expect(resolveImageAttachment('复习大纲/a.txt').kind).toBe('text')
    expect(resolveImageAttachment('复习大纲/a.png')).toMatchObject({ kind: 'image', src: `${ASSET_ENDPOINT}?path=${encodeURIComponent('复习大纲/a.png')}` })
  })

  it('路径合法性那套规则：理由文案与求值顺序都取自契约', () => {
    const declared = assetContract.pathRules.rules.map((rule) => rule.reason)
    for (const reason of declared) {
      // 契约里写的每一句拒绝理由，必须原样出现在网页端实现中（改文案不许只改一边）。
      const numeric = reason.replace('{maxTargetLength}', String(assetContract.pathRules.maxTargetLength))
      const templated = reason.replace('{maxTargetLength}', '${MAX_TARGET_LENGTH}')
      expect(
        wikilinkSource.includes(numeric) || wikilinkSource.includes(templated),
        `网页端实现里找不到这句理由（模板串与插值后的成品都不在）：${reason}`,
      ).toBe(true)
    }
    expect(wikilinkSource).toMatch(/MAX_TARGET_LENGTH = 300/)
    expect(assetContract.pathRules.maxTargetLength).toBe(300)
  })
})
