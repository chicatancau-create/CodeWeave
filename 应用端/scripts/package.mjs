/**
 * 桌面端打包（分离方案 §9 阶段 D：打包只消费 renderer artifact 与 backend runtime artifact）。
 *
 * 与旧实现的两处实质差别：
 *   1. 不再 `cpSync(workspace/frontend/dist)` 与 `cpSync(workspace/backend/…)` ——那两条就是
 *      §5 禁止的「以兄弟工程源码目录作为生产打包输入」。现在两个产物的位置**必须由调用方显式给出**，
 *      缺任何一个都当场报错并说明该跑哪条发布命令；
 *   2. 交付拷贝不再默认写到工作区外。默认只落在本包 `build/`，要覆盖外层那份 exe 必须显式
 *      `--deliver <目录>`（阶段 E 的启动器负责决定何时交付）。
 *
 * 产物白名单审计保留并加强：命中 `data|vault|.env|node_modules|users.json|.local.` 即拒绝，
 * 符号链接一律拒绝，`renderer/` 与 `backend/` 之外不许有第三个顶层条目。
 *
 * 用法：
 *   node scripts/package.mjs --renderer <网页端 dist> --runtime <后端 runtime 产物>
 *        [--skip-build] [--deliver <目录>] [--dry-run]
 * 退出码：0 成功；1 输入不可用或审计拒绝；2 用法错误。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const desktopRoot = resolve(import.meta.dirname, '..')
const stage = join(desktopRoot, 'stage')
const stageRoot = join(stage, 'runtime')

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`)
  const value = i >= 0 ? process.argv[i + 1] : undefined
  return value && !value.startsWith('--') ? value : fallback
}

const dryRun = process.argv.includes('--dry-run')
const rendererArg = arg('renderer')
const runtimeArg = arg('runtime')
const deliverArg = arg('deliver')
const skipBuild = process.argv.includes('--skip-build')
// 只建暂存区并出审计结论，不拉 electron-builder：给门禁与 CI 用（§10.1 打包审计那条）。真出 exe 去掉这个旗标。
const stageOnly = process.argv.includes('--stage-only')

if (!rendererArg || !runtimeArg) {
  console.error(
    'FAIL: 必须显式给出两个发布产物：\n'
      + '  --renderer  <【网页端】_WEB_CLIENT 构建出的 dist 目录>\n'
      + '  --runtime   <【后端数据服务】_BACKEND_DATA 发布出的 runtime 目录（含 backend/ 与 config/）>\n'
      + '打包脚本刻意不去猜兄弟工程的源码路径（分离方案 §5）。',
  )
  process.exit(2)
}

const rendererDir = resolve(rendererArg)
const backendRuntime = resolve(runtimeArg)
const rendererIndex = join(rendererDir, 'index.html')
if (!existsSync(rendererIndex)) {
  console.error(`FAIL: 网页端产物缺 index.html：${rendererDir}\n先在网页端跑 corepack pnpm build。`)
  process.exit(1)
}
for (const rel of ['server.mjs', join('server', 'config.mjs'), join('server', 'instance.mjs')]) {
  if (!existsSync(join(backendRuntime, 'backend', rel))) {
    console.error(`FAIL: 后端运行时产物缺 backend/${rel}：${backendRuntime}\n先在后端包跑发布命令（见其 README）。`)
    process.exit(1)
  }
}
if (!existsSync(join(backendRuntime, 'config', 'codeweave.config.example.json'))) {
  console.error(`FAIL: 后端运行时产物缺 config/codeweave.config.example.json（工程根标记），服务在其中无法定位配置：${backendRuntime}`)
  process.exit(1)
}

// 构建网页端产物：只在调用方没给 --skip-build 时做，且**在网页端自己的目录里**跑它自己的脚本，
// 不是把它的源码拷过来拼。产物目录由网页端构建完成后回报。
if (!skipBuild) {
  const webRoot = resolve(rendererDir, '..')
  const manifest = JSON.parse(readFileSync(join(webRoot, 'package.json'), 'utf8'))
  if (manifest?.name !== 'codeweave-web-client') {
    console.error(`FAIL: --renderer 的上一级不是网页端工程 manifest（读到的是 ${manifest?.name ?? '无'}）。加 --skip-build 用现成产物。`)
    process.exit(1)
  }
  const result = spawnSync('corepack', ['pnpm', 'run', 'build'], { cwd: webRoot, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const plan = [
  { from: rendererDir, to: join(stageRoot, 'renderer'), label: 'renderer artifact' },
  { from: join(backendRuntime, 'backend'), to: join(stageRoot, 'backend'), label: 'backend runtime', skip: (name) => name.endsWith('.test.mjs') },
  { from: join(backendRuntime, 'config'), to: join(stageRoot, 'config'), label: 'config example + schema' },
]

if (!dryRun) {
  // 这个目录归本脚本独占：先校验再清，绝不递归删到源码树、数据目录或用户工作区。
  if (resolve(stage) !== join(desktopRoot, 'stage')) throw new Error('拒绝清理非预期打包目录。')
  rmSync(stage, { recursive: true, force: true })
}
for (const step of plan) {
  const target = step.to
  if (dryRun) {
    console.log(`dry-run: ${step.label} ${step.from} -> ${relative(desktopRoot, target)}`)
    continue
  }
  mkdirSync(dirname(target), { recursive: true })
  cpSync(step.from, target, {
    recursive: true,
    filter: (source) => !(step.skip && step.skip(source.split(/[\\/]/).at(-1))),
  })
}

function auditDirectory(directory) {
  const findings = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name)
    const local = relative(stageRoot, file).replaceAll('\\', '/')
    if (/(^|\/)(data|vault|\.env|node_modules|coverage|dist)(\/|$)|users\.json|\.local\.|\.log$|\.tmp$|server\.lock/i.test(local)) {
      throw new Error(`打包白名单拒绝私有或多余文件：${local}`)
    }
    if (entry.isSymbolicLink()) throw new Error(`打包不接受符号链接：${local}`)
    if (entry.isDirectory()) findings.push(...auditDirectory(file))
    else findings.push(local)
  }
  return findings
}

let audit = []
if (!dryRun) {
  audit = auditDirectory(stageRoot)
  const topLevel = readdirSync(stageRoot)
  const unexpected = topLevel.filter((name) => !['renderer', 'backend', 'config'].includes(name))
  if (unexpected.length) throw new Error(`打包目录里出现第三个顶层条目：${unexpected.join('、')}`)
}

const output = join(desktopRoot, 'build')
if (stageOnly && !dryRun) {
  console.log(`暂存区已就绪并通过审计：${relative(desktopRoot, join(stageRoot))}（--stage-only，未出 exe）`)
  process.exit(0)
}
if (!dryRun) {
  // 用包名而不是拼 node_modules 内部路径：pnpm 的 node_modules 是符号链接树，内部文件名不属于公开接口。
  const { build, Arch, Platform } = await import('electron-builder')
  // 默认 portable（交付的就是那个单文件 exe）。`--target dir` 只解包成 win-unpacked，
  // 不需要 electron-builder 的 nsis/winCodeSign 载荷，可在离线环境验证「产物装配」这一半。
  const target = arg('target') ?? 'portable'
  await build({
    projectDir: desktopRoot,
    targets: Platform.WINDOWS.createTarget(target, Arch.x64),
    publish: 'never',
  })
  const source = join(output, 'CodeWeave.exe')
  if (!existsSync(source)) throw new Error('打包没有生成 CodeWeave.exe。')
  if (deliverArg) {
    const deliverDir = resolve(deliverArg)
    if (deliverDir === desktopRoot || deliverDir.startsWith(desktopRoot + '/') || deliverDir.startsWith(desktopRoot + '\\')) {
      throw new Error('--deliver 不能指向本包内部，交付目录应在工作区之外（阶段 E 由启动器决定）。')
    }
    mkdirSync(deliverDir, { recursive: true })
    cpSync(source, join(deliverDir, 'CodeWeave.exe'))
    console.log(`已交付：${join(deliverDir, 'CodeWeave.exe')}`)
  }
  console.log(`桌面产物：${source}`)
}
console.log(dryRun
  ? '审计：dry-run 未执行（真跑去掉 --dry-run；只看审计用 --stage-only）'
  : `审计通过：${audit.length} 个文件，白名单只有 renderer + backend runtime + config example`)
console.log(`应用版本：${JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')).version}`)
