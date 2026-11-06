import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const forbidden = /(?:\.\.\/(?:backend|desktop|frontend)|【本地应用端】_DESKTOP_APP|E:[\\/]CodeWeave)/

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) walk(full, files)
    else if (/\.(mjs|js|ts|tsx|json|yaml|yml)$/.test(entry.name)) files.push(full)
  }
  return files
}

const roots = ['src', 'server', 'server/service'].map((name) => join(root, name)).filter((dir) => existsSync(dir))
const offenders = walk(root).filter((file) => roots.some((dir) => file.startsWith(`${dir}${sep}`)) && forbidden.test(stripComments(readFileSync(file, 'utf8'))))
if (offenders.length) {
  console.error(`网页端存在跨项目源码路径：\n${offenders.join('\n')}`)
  process.exit(1)
}

for (const path of ['server/contracts/openapi.yaml', 'server/service/server.mjs', 'dist/index.html']) {
  if (!existsSync(join(root, path))) throw new Error(`网页端缺少独立发布输入：${path}`)
}

const symlinkRoots = ['src', 'server/service', 'dist'].map((name) => join(root, name)).filter((dir) => existsSync(dir))
const symlinks = symlinkRoots.flatMap((dir) => walk(dir)).filter((file) => lstatSync(file).isSymbolicLink())
if (symlinks.length) throw new Error(`网页端发布树不接受符号链接：${symlinks.join(', ')}`)
if (existsSync(join(root, 'dist'))) {
  const releaseForbidden = walk(join(root, 'dist')).filter((file) => {
    const relativePath = relative(join(root, 'dist'), file)
    return /\.(exe|msi)$/i.test(file) || /(?:^|[\\/])(electron|desktop|node_modules|data)(?:[\\/]|$)/i.test(relativePath)
  })
  if (releaseForbidden.length) throw new Error(`网页端 dist 包含桌面端或运行数据：${releaseForbidden.join(', ')}`)
}
console.log('Web boundary audit passed: no cross-project source path or symlink')
