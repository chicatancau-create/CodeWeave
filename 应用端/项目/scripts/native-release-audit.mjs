import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const native = join(root, 'native')
const sourceRoots = [join(native, 'src')]
const forbidden = /(?:Electron|electron|Chromium|WebView|backend-runtime|127\.0\.0\.1|localhost|createServer|listen\s*\(|pnpm)/i
const allowedExtensions = /\.(cpp|hpp|h|cmake)$/i

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, files)
    else files.push(full)
  }
  return files
}

if (!existsSync(join(native, 'CMakeLists.txt'))) throw new Error('缺少 native/CMakeLists.txt')
const sourceFiles = sourceRoots.flatMap((dir) => walk(dir)).filter((file) => allowedExtensions.test(file))
const offenders = []
for (const file of sourceFiles) {
  if (/(?:native_tests|test_process_tool)\.(?:cpp|hpp|h)$/i.test(file)) continue
  const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  if (forbidden.test(source)) offenders.push(relative(root, file))
  if (lstatSync(file).isSymbolicLink()) offenders.push(`${relative(root, file)} (symbolic link)`)
}
if (offenders.length) throw new Error(`原生发布源码命中旧运行时或符号链接：\n${offenders.join('\n')}`)

const buildDir = process.argv[2] ? resolve(process.argv[2]) : null
if (buildDir) {
  const executable = join(buildDir, 'codeweave-native.exe')
  if (!existsSync(executable)) throw new Error(`构建目录缺少原生 EXE：${executable}`)
  const buildFiles = walk(buildDir).filter((file) => !file.includes(`${sep}CMakeFiles${sep}`))
  const leaked = buildFiles.filter((file) => /(?:renderer|backend-runtime|electron|chromium|node_modules)/i.test(file))
  if (leaked.length) throw new Error(`原生候选构建目录包含旧运行时产物：\n${leaked.map((file) => relative(root, file)).join('\n')}`)
  const testArtifacts = buildFiles.filter((file) =>
    /(?:codeweave-native-tests|codeweave-cpp-runner|CTestTestfile\.cmake|DartConfiguration\.tcl)/i.test(file))
  if (testArtifacts.length) {
    throw new Error(`原生发布候选包含测试产物，请使用 BUILD_TESTING=OFF：\n${testArtifacts.map((file) => relative(root, file)).join('\n')}`)
  }
}
console.log(`Native release boundary audit passed: ${sourceFiles.length} source files checked${buildDir ? ' and candidate build checked' : ''}`)
