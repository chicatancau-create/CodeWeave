import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const forbidden = /(?:\.\.\/(?:frontend|backend)|【网页端】_WEB_CLIENT|E:[\\/]CodeWeave[\\/]workspace)/

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`桌面端源码不接受符号链接：${full}`)
    if (entry.isDirectory()) walk(full, files)
    else if (/\.(mjs|js|cpp|h|hpp|json|cmake)$/.test(entry.name)) files.push(full)
  }
  return files
}

const roots = ['src', 'native/src'].map((name) => join(root, name)).filter((dir) => existsSync(dir))
const offenders = roots.flatMap((directory) => walk(directory)).filter((file) => forbidden.test(stripComments(readFileSync(file, 'utf8'))))
if (offenders.length) {
  console.error(`桌面端存在网页/后端源码路径：\n${offenders.join('\n')}`)
  process.exit(1)
}

if (!existsSync(join(root, 'native', 'CMakeLists.txt'))) throw new Error('缺少原生 CMake 工程')
const symlinkRoots = ['src', 'native/src'].map((name) => join(root, name)).filter((dir) => existsSync(dir))
const symlinks = symlinkRoots.flatMap((dir) => walk(dir)).filter((file) => lstatSync(file).isSymbolicLink())
if (symlinks.length) throw new Error(`桌面端源码不接受符号链接：${symlinks.join(', ')}`)
console.log('Desktop boundary audit passed: native source is independent of Web/backend source')
