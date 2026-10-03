/**
 * 桌面主进程的本机服务编排（分离方案 §7.2）。
 *
 * 保留原有安全姿态：单实例、窗口导航只允许本机 loopback origin、外链只走 https 且交给系统浏览器、
 * renderer 无 Node integration / 有 contextIsolation / sandbox、webview 一律拒绝、端口冲突硬失败而不是
 * 静默换端口（换端口就等于换一份浏览器存储，学习记录会分裂）。
 *
 * 换掉的是「从哪里找代码」：不再 `resolve(__dirname, '../..')` 拼兄弟工程源码，
 * 而是只消费两个发布产物目录（见 `src/runtime/artifacts.mjs`）。
 */
import { app, BrowserWindow, dialog, Menu, nativeTheme, session, shell, utilityProcess } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { findWorkspace, isAllowedNavigation, isExternalWebUrl, matchesBuild, parseOptions, probeHealth, readDesktopSettings } from '../runtime/runtime.mjs'
import { resolveBackendRuntime, resolveRendererArtifact, desktopRuntimeEnv } from '../runtime/artifacts.mjs'

app.setName('CodeWeave')
app.setAppUserModelId('com.codeweave.desktop')
const profileOverride = process.env.CODEWEAVE_DESKTOP_PROFILE
if (profileOverride) app.setPath('userData', resolve(profileOverride))
const userData = app.getPath('userData')
const settingsFile = join(userData, 'desktop-settings.json')
let window = null
let worker = null
let workerPid = null
let workerExit = null
let runtime = null
let shuttingDown = false
let shutdownComplete = false

function record(event, detail = {}) {
  mkdirSync(userData, { recursive: true })
  appendFileSync(join(userData, 'desktop.log'), `${JSON.stringify({ time: new Date().toISOString(), event, ...detail })}\n`)
}

async function chooseWorkspace() {
  const result = await dialog.showOpenDialog({ title: '选择 CodeWeave 工作目录', properties: ['openDirectory'] })
  if (result.canceled) return null
  findWorkspace({ explicit: result.filePaths[0] })
  mkdirSync(userData, { recursive: true })
  writeFileSync(settingsFile, JSON.stringify({ workspace: result.filePaths[0] }, null, 2))
  return result.filePaths[0]
}

function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [
      { label: '选择工作目录…', click: () => chooseWorkspace().then((picked) => { if (picked) { app.relaunch(); app.quit() } }).catch(reportError) },
      { label: '打开运行数据目录', click: async () => { if (runtime) await shell.openPath(runtime.dataDir) } },
      { type: 'separator' }, { label: '退出', role: 'quit' },
    ] },
    { label: '编辑', submenu: [{ label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' }] },
    { label: '视图', submenu: [{ label: '重新加载', role: 'reload' }, { label: '实际大小', role: 'resetZoom' }, { label: '放大', role: 'zoomIn' }, { label: '缩小', role: 'zoomOut' }, { type: 'separator' }, { label: '全屏', role: 'togglefullscreen' }] },
    { label: '帮助', submenu: [{ label: '关于 CodeWeave', click: () => dialog.showMessageBox({ type: 'info', title: 'CodeWeave', message: `CodeWeave ${app.getVersion()}`, detail: 'Windows 桌面版。学习数据保存在本机；移动 EXE 不会自动携带账户或资料库。' }) }] },
  ]))
}

function reportError(error) {
  record('error', { message: error.message })
  dialog.showErrorBox('CodeWeave', error.message)
}

async function prepareRuntime() {
  const options = parseOptions(process.argv)
  const backendRuntime = resolveBackendRuntime({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  })
  const rendererArtifact = resolveRendererArtifact({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  })
  const { resolveRuntimePaths } = await import(pathToFileURL(join(backendRuntime, 'backend', 'server', 'config.mjs')).href)
  const { instanceIdentity } = await import(pathToFileURL(join(backendRuntime, 'backend', 'server', 'instance.mjs')).href)

  const settings = readDesktopSettings(settingsFile)
  let workspace = findWorkspace({
    explicit: options.workspace || process.env.CODEWEAVE_DESKTOP_WORKSPACE,
    saved: settings.workspace,
    packaged: app.isPackaged,
    sourceRoot: backendRuntime,
    portableDirectory: process.env.PORTABLE_EXECUTABLE_DIR,
    executable: app.getPath('exe'),
    cwd: process.cwd(),
  })
  // §9 阶段 D：找不到有效工作区必须明确报错，不再退回 `userData/workspace` 静默新建一份数据根
  // ——那等于让用户以为还在用原来那份账户与学习记录。
  if (!workspace) {
    const picked = await chooseWorkspace()
    if (!picked) throw new Error('没有选择 CodeWeave 工作目录，桌面端不会自行创建一个空数据根。请重新打开并在「文件 → 选择工作目录」里指定。')
    workspace = picked
  }

  const selected = resolveRuntimePaths({
    startDir: join(backendRuntime, 'backend', 'server'),
    env: desktopRuntimeEnv({
      backendRuntime,
      rendererArtifact,
      // Desktop runtime data is deliberately separate from the workspace root and
      // from the browser service's runtime data. The workspace remains the source
      // of the selected knowledge vault, but accounts, sessions, progress and
      // locks belong to this desktop profile only.
      dataWorkspace: join(workspace, 'data', 'runtime', 'desktop'),
      vaultRoot: join(workspace, 'data', 'knowledge', 'vault'),
      port: options.port,
      base: process.env,
    }),
  })
  if (selected.conflicts.length) throw new Error(selected.conflicts.map((conflict) => conflict.message).join('\n'))
  mkdirSync(selected.dataDir, { recursive: true })
  // A desktop profile owns its runtime directory. If an earlier crashed process
  // left a lock, the backend's own live-PID check decides whether it is safe to
  // reuse; do not silently select another port or data root.
  return {
    ...selected,
    backendRuntime,
    rendererArtifact,
    workspace,
    contentMissing: !existsSync(selected.vaultRoot),
    expected: instanceIdentity({ dataDir: selected.dataDir, distDir: rendererArtifact }),
    env: desktopRuntimeEnv({
      backendRuntime,
      rendererArtifact,
      dataWorkspace: selected.dataDir,
      vaultRoot: selected.vaultRoot,
      port: selected.port,
      base: process.env,
    }),
  }
}

async function startBackend() {
  const existing = await probeHealth(runtime.origin)
  if (existing) {
    if (!matchesBuild(existing, runtime.expected)) throw new Error(`端口 ${runtime.port} 已由其他实例或旧版本使用。请关闭原服务再打开 CodeWeave；桌面版不会自动换端口，以免学习记录切换到另一份浏览器存储。`)
    record('backend-reused', { origin: runtime.origin })
    return
  }
  let exited = false
  let errorOutput = ''
  worker = utilityProcess.fork(join(import.meta.dirname, '..', 'runtime', 'server-worker.mjs'), [join(runtime.backendRuntime, 'backend/server.mjs'), String(process.pid)], {
    cwd: runtime.backendRuntime,
    env: { ...process.env, ...runtime.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    serviceName: 'CodeWeave local service',
  })
  worker.on('spawn', () => { workerPid = worker.pid })
  worker.stdout?.on('data', () => {})
  worker.stderr?.on('data', (buffer) => { errorOutput += buffer.toString() })
  workerExit = new Promise((done) => worker.once('exit', (code) => { exited = true; done(code) }))

  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const health = await probeHealth(runtime.origin)
    if (health && matchesBuild(health, runtime.expected)) {
      record('backend-ready', { origin: runtime.origin, pid: workerPid })
      return
    }
    if (exited) break
    await new Promise((sleep) => setTimeout(sleep, 200))
  }
  const detail = errorOutput.trim() ? `\n服务输出：${errorOutput.trim().slice(0, 400)}` : ''
  throw new Error(`本机服务未能就绪（${runtime.origin}）。${detail}`)
}

async function openWindow() {
  nativeTheme.themeSource = 'dark'
  const localSession = session.fromPartition(`persist:workspace-${runtime.expected.instanceId}`)
  localSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  localSession.setPermissionCheckHandler(() => false)
  window = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1080, minHeight: 720,
    title: 'CodeWeave', backgroundColor: '#071018', show: false,
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, session: localSession },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalWebUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, runtime.origin)) event.preventDefault()
  })
  window.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedNavigation(url, runtime.origin)) event.preventDefault()
  })
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.on('page-title-updated', (event) => event.preventDefault())
  window.once('ready-to-show', () => window?.show())
  window.on('closed', () => { window = null })
  const rendererUrl = new URL(`${runtime.origin}/`)
  // The renderer must consume the exact origin selected by the local backend;
  // it is forbidden to guess a port because that can point at another instance.
  rendererUrl.searchParams.set('apiOrigin', runtime.origin)
  await window.loadURL(rendererUrl.href)
  record('window-ready', { origin: runtime.origin, contentMissing: runtime.contentMissing, packaged: app.isPackaged })
  if (runtime.contentMissing) {
    await dialog.showMessageBox(window, {
      type: 'info', title: '资料库尚未连接', message: 'CodeWeave 已就绪，尚未找到学习资料库。',
      detail: '账户与设置会保存在本机用户目录。按 Alt 打开“文件 → 选择工作目录”，连接已有 CodeWeave workspace；不会自动创建、迁移或覆盖你的资料库。',
    })
  }
}

async function stopBackend() {
  if (!worker) return
  worker.postMessage({ type: 'shutdown' })
  let timer
  const exited = await Promise.race([workerExit.then(() => true), new Promise((resolveTimeout) => { timer = setTimeout(() => resolveTimeout(false), 4500) })])
  clearTimeout(timer)
  if (!exited) {
    worker.kill()
    await workerExit
  }
  // Only remove a lock still owned by the child this app created.
  const lock = join(runtime.dataDir, '.server.lock')
  if (workerPid && existsSync(lock) && readFileSync(lock, 'utf8').trim() === String(workerPid)) unlinkSync(lock)
  worker = null
}

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) app.quit()
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', (event) => {
    if (shutdownComplete) return
    event.preventDefault()
    if (shuttingDown) return
    shuttingDown = true
    stopBackend().catch((error) => record('shutdown-error', { message: error.message })).finally(() => {
      shutdownComplete = true
      app.quit()
    })
  })
  app.whenReady().then(async () => {
    installMenu()
    runtime = await prepareRuntime()
    await startBackend()
    await openWindow()
  }).catch((error) => { reportError(error); app.quit() })
}
