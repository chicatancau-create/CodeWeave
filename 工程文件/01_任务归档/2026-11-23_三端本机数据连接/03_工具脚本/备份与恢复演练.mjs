import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

const repository = resolve(import.meta.dirname, '..', '..', '..', '..')
const workspace = join(repository, '工作区')
const web = join(repository, '网页端', '项目')
const expanded = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
const stamp = expanded.replace(/-/g, '').replace(' ', '_').replace(/:/g, '')
const backup = join('G:/数据备份', `CodeWeave_本机连接_${stamp}`)
const restore = await mkdtemp(join(tmpdir(), 'codeweave-restore-test-'))
const legacy = join(workspace, 'data', 'runtime', 'desktop')
const unified = join(workspace, 'data', 'runtime', 'unified-local')
const vault = join(workspace, '全栈工程师学习资料库')
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browserData = join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data')
const stats = []

const hooks = registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context) } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND' || !context.parentURL?.startsWith(pathToFileURL(web).href) || !specifier.startsWith('.')) throw error
      return next(`${specifier}.ts`, context)
    }
  },
})
const { buildExportPayload } = await import(pathToFileURL(join(web, 'src', 'utils', 'local-data.ts')).href)
hooks.deregister()

async function hash(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}
async function copyIfPresent(source, dest, required = false) {
  try { await stat(source) } catch (error) {
    if (error.code !== 'ENOENT' || required) throw error
    stats.push({ category: dest, presence: 'absent' })
    return
  }
  const target = join(backup, dest)
  await mkdir(dirname(target), { recursive: true })
  await cp(source, target, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true })
  stats.push({ category: dest, presence: 'backed_up' })
}
async function getFiles(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isFile()) files.push(path)
    else if (entry.isDirectory()) files.push(...await getFiles(path))
    else throw new Error('备份对象内检测到链接或非普通文件')
  }
  return files.sort()
}

async function browserExports(accountId) {
  const { chromium } = await import('file:///D:/DevCache/CodeWeave-Browser-Smoke/node_modules/playwright-core/index.mjs')
  const profiles = (await readdir(browserData, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^(Default|Profile \d+)$/.test(entry.name))
  for (const entry of profiles) {
    const source = join(browserData, entry.name, 'Local Storage', 'leveldb')
    let files
    try { files = (await readdir(source, { withFileTypes: true })).filter((item) => item.isFile() && /(?:^CURRENT$|^MANIFEST-\d+$|^\d+\.(?:log|ldb|sst)$)/.test(item.name)) }
    catch (error) { if (error.code === 'ENOENT') continue; throw error }
    if (!files.some((item) => item.name === 'CURRENT')) continue
    const profileCopy = await mkdtemp(join(restore, 'chrome-'))
    const copy = join(profileCopy, 'Default', 'Local Storage', 'leveldb')
    await mkdir(copy, { recursive: true })
    const observed = new Map()
    for (const file of files) {
      const filename = join(source, file.name)
      observed.set(filename, await hash(filename))
      await cp(filename, join(copy, file.name), { errorOnExist: true, force: false })
      assert.equal(await hash(join(copy, file.name)), observed.get(filename), 'Chrome 存储快照在复制过程中发生变化')
    }
    for (const [path, expected] of observed) assert.equal(await hash(path), expected, 'Chrome 存储复制前后哈希不同')
    const context = await chromium.launchPersistentContext(profileCopy, { executablePath: chrome, headless: true, args: ['--disable-background-networking', '--no-first-run'] })
    try {
      await context.route('**/*', (route) => route.fulfill({ status: 200, body: '<!doctype html><title>CodeWeave storage export</title>', contentType: 'text/html' }))
      const page = context.pages()[0] ?? await context.newPage()
      for (const host of ['127.0.0.1', 'localhost']) {
        const origin = `http://${host}:4173`
        await page.goto(origin)
        const items = new Map(await page.evaluate(() => Object.entries(localStorage)))
        Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
          length: items.size, key: (index) => [...items.keys()][index] ?? null, getItem: (key) => items.get(key) ?? null,
        } })
        let payload
        try { payload = buildExportPayload(accountId) } finally { Reflect.deleteProperty(globalThis, 'localStorage') }
        if (Object.keys(payload.data).length) {
          const directory = join(backup, 'web-registered-exports')
          await mkdir(directory, { recursive: true })
          await writeFile(join(directory, `${entry.name}-${host}.json`), JSON.stringify(payload, null, 2) + '\n', { flag: 'wx' })
        }
        stats.push({ category: 'web owner registered export', profile: entry.name, host, keys: Object.keys(payload.data).length })
      }
    } finally { await context.close() }
  }
}

try {
  await mkdir(backup)
  const accounts = JSON.parse((await readFile(join(legacy, 'users.json'), 'utf8')).replace(/^\uFEFF/, ''))
  assert(Array.isArray(accounts) && accounts.length === 1 && accounts[0]?.id, '正式旧运行根不能唯一确定 owner')
  await browserExports(accounts[0].id)
  await copyIfPresent(legacy, 'legacy-designated-runtime', true)
  await copyIfPresent(join(web, 'server', 'data', 'runtime'), 'legacy-web-default-runtime')
  await copyIfPresent(unified, 'unified-local-before')
  await copyIfPresent(join(process.env.LOCALAPPDATA, 'CodeWeave'), 'qt-local-profile')
  for (const path of ['CodeWeave/content-manifest.json', 'CodeWeave/同步报告/同步记录.json']) {
    await copyIfPresent(join(vault, path), `vault-publish-metadata/${path}`, path.endsWith('content-manifest.json'))
  }
  const manifest = []
  for (const file of await getFiles(backup)) {
    manifest.push({ path: relative(backup, file).replaceAll('\\', '/'), sha256: await hash(file), bytes: (await stat(file)).size })
  }
  await writeFile(join(backup, 'SHA-256.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  const restored = join(restore, 'recovered')
  await cp(backup, restored, { recursive: true, errorOnExist: true, force: false })
  const replay = JSON.parse(await readFile(join(restored, 'SHA-256.json'), 'utf8'))
  for (const entry of replay) assert.equal(await hash(join(restored, entry.path)), entry.sha256, '恢复副本 SHA-256 不一致')
  const restoredAccounts = JSON.parse((await readFile(join(restored, 'legacy-designated-runtime', 'users.json'), 'utf8')).replace(/^\uFEFF/, ''))
  assert.deepEqual(restoredAccounts, accounts, '恢复的旧账户不能被读取')
  for (const entry of replay.filter((item) => item.path.endsWith('.sqlite'))) {
    const db = new DatabaseSync(join(restored, entry.path), { readOnly: true })
    try { assert.equal(Object.values(db.prepare('PRAGMA integrity_check').get())[0], 'ok') } finally { db.close() }
  }
  const output = { backup, sha256Manifest: join(backup, 'SHA-256.json'), verifiedFiles: replay.length, recovered: true, stats }
  await writeFile(join(backup, 'restore-verification.json'), JSON.stringify(output, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify(output))
} finally {
  if (dirname(restore) === resolve(tmpdir()) && basename(restore).startsWith('codeweave-restore-test-')) await rm(restore, { recursive: true, force: true, maxRetries: 2 })
}
