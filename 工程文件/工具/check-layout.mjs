import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const allowedRoot = new Set(['网页端', '移动端', '应用端', '工程文件', '工作区', '.git', '.gitignore', '.gitattributes', 'AGENTS.md', '.claude', '.local'])
for (const entry of readdirSync(root)) assert(allowedRoot.has(entry), `根目录禁止新增散落内容：${entry}`)
for (const product of ['网页端', '移动端', '应用端']) {
  const base = resolve(root, product)
  const allowed = new Set(['项目', '工程文件', `启动${product}.lnk`, ...(product === '应用端' ? ['开发环境', '构建产物'] : [])])
  const entries = readdirSync(base, { withFileTypes: true })
  for (const entry of entries) assert(allowed.has(entry.name), `${product} 外层不允许：${entry.name}`)
  const files = entries.filter((entry) => !entry.isDirectory())
  assert.equal(files.length, 1, `${product} 外层必须恰好一个启动链接；先运行初始化本机入口.ps1`)
  assert.equal(files[0].name, `启动${product}.lnk`)
  assert(existsSync(resolve(base, '项目')), `${product} 缺少项目目录`)
  assert(existsSync(resolve(base, '工程文件')), `${product} 缺少工程文件目录`)
}
const oldPaths = ['G:/CodeWeave-prep', 'G:/CodeWeave-qt', 'G:/app-native-ascii']
if (root.toLowerCase() === resolve('G:/CodeWeave').toLowerCase()) {
  for (const path of oldPaths) assert(!existsSync(path), `禁止在外部恢复旧目录：${path}`)
}
for (const [alias, target] of [['app', '应用端/项目'], ['prep', '应用端/开发环境/CodeWeave-prep'], ['qt', '应用端/构建产物/qt']]) {
  assert.equal(realpathSync(resolve(root, '.local', alias)), realpathSync(resolve(root, target)))
}
assert(readFileSync(resolve(root, 'AGENTS.md'), 'utf8').includes('最外层只允许一个启动链接'))
console.log('Layout passed: three products, one shortcut each, internal tooling, no external project copies.')
