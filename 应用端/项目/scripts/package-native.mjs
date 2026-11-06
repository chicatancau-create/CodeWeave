import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const exists = async (path) => { try { await lstat(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error } }
const regular = async (path) => {
  const status = await lstat(path)
  if (!status.isFile() || status.isSymbolicLink()) throw new Error(`Expected regular file: ${path}`)
}
const decodeRows = (text, width) => text.split('\n').filter(Boolean).map((line) => {
  const row = line.replace(/\r$/, '').split('\t')
  if (row.length !== width || row.some((x) => !/^(?:[a-fA-F0-9]{2})*$/.test(x))) throw new Error('Malformed content table')
  return row.map((x) => new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(x, 'hex')))
})

export async function validateContent(content) {
  const status = await lstat(content)
  if (!status.isDirectory() || status.isSymbolicLink()) throw new Error('Content root must be a real directory')
  for (const entry of await readdir(content)) {
    if (entry === 'hints') {
      const hints = await lstat(join(content, entry))
      if (!hints.isDirectory() || hints.isSymbolicLink()) throw new Error('Invalid hints directory')
      for (const hint of await readdir(join(content, entry))) await regular(join(content, entry, hint))
    } else await regular(join(content, entry))
  }
  for (const name of ['catalog.v1.tsv', 'exercises.v1.tsv', 'starter-code.v1.tsv', 'metadata.v1.tsv', 'curriculum.v1.json']) await regular(join(content, name))
  const rows = decodeRows(await readFile(join(content, 'catalog.v1.tsv'), 'utf8'), 6)
  const ids = new Set()
  for (const [id, title, state, language, digest, version] of rows) {
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id) || ids.has(id) || !title || !language || state !== 'published' || version !== '1') throw new Error('Invalid catalog record')
    ids.add(id)
    await regular(join(content, `${id}.txt`))
    if (hash(await readFile(join(content, `${id}.txt`))) !== digest) throw new Error(`Body hash mismatch: ${id}`)
  }
  if (!ids.size) throw new Error('Empty native curriculum')
  for (const [name, width] of [['starter-code.v1.tsv', 3], ['metadata.v1.tsv', 6]]) {
    const entries = decodeRows(await readFile(join(content, name), 'utf8'), width)
    const found = new Set(entries.map((entry) => entry[0]))
    if (entries.length !== ids.size || found.size !== ids.size || [...found].some((id) => !ids.has(id))) throw new Error(`Incomplete or duplicate ${name}`)
  }
  await regular(join(content, 'hints.v1.tsv'))
  const hinted = new Set()
  for (const [id, digest] of decodeRows(await readFile(join(content, 'hints.v1.tsv'), 'utf8'), 2)) {
    if (!ids.has(id) || hinted.has(id)) throw new Error('Invalid or duplicate hint ID')
    hinted.add(id)
    if (hash(await readFile(join(content, 'hints', `${id}.txt`))) !== digest) throw new Error(`Hint hash mismatch: ${id}`)
  }
  const expected = new Set(['catalog.v1.tsv', 'exercises.v1.tsv', 'starter-code.v1.tsv', 'metadata.v1.tsv',
    'curriculum.v1.json', 'hints.v1.tsv', 'hints', ...[...ids].map((id) => `${id}.txt`)])
  for (const entry of await readdir(content)) if (!expected.has(entry)) throw new Error(`Unexpected packaged content: ${entry}`)
  for (const hint of await readdir(join(content, 'hints'))) {
    if (!hint.endsWith('.txt') || !hinted.has(hint.slice(0, -4))) throw new Error(`Unexpected packaged hint: ${hint}`)
  }
  return rows.length
}

export async function packageNative({ exe, content = join(root, 'native/content'), output = join(root, 'dist/native') }) {
  if (!exe) throw new Error('Supply --exe with the verified native executable')
  exe = resolve(exe); content = resolve(content); output = resolve(output)
  await regular(exe)
  const bytes = await readFile(exe)
  if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('Not a Windows executable')
  const pe = bytes.readUInt32LE(0x3c)
  if (pe + 26 > bytes.length || bytes.toString('ascii', pe, pe + 4) !== 'PE\u0000\u0000' || bytes.readUInt16LE(pe + 4) !== 0x8664) throw new Error('Expected a Windows x64 PE executable')
  const count = await validateContent(content)
  if (await exists(output)) throw new Error(`Output already exists; choose a new output or archive the old delivery: ${output}`)
  await mkdir(dirname(output), { recursive: true })
  const staging = join(dirname(output), `.${basename(output)}-${process.pid}-${Date.now()}`)
  await mkdir(staging)
  try {
    await writeFile(join(staging, 'CodeWeave.exe'), bytes)
    await cp(content, join(staging, 'content'), { recursive: true, errorOnExist: true, force: false })
    await mkdir(join(staging, 'config'))
    await writeFile(join(staging, 'config/codeweave.config.example.json'), JSON.stringify({ schemaVersion: 1, product: 'CodeWeave', runtime: 'native' }, null, 2) + '\n')
    await cp(join(root, '../../工程文件/LICENSE'), join(staging, 'LICENSE'))
    await writeFile(join(staging, 'README.txt'), 'CodeWeave 原生应用\r\n\r\n双击 CodeWeave.exe。程序本身无需 Node、浏览器、端口或开发服务器。\r\n请保留 content 与 config 目录。各课程的编译器/解释器按课程要求配置。\r\n账户与学习数据保存于用户数据目录，不写入本交付目录。\r\n')
    const manifest = []
    const walk = async (dir) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) await walk(path)
        else manifest.push({ path: relative(staging, path).replaceAll('\\', '/'), sha256: hash(await readFile(path)) })
      }
    }
    await walk(staging)
    await writeFile(join(staging, 'manifest.json'), JSON.stringify({ schemaVersion: 1, architecture: 'x64', contentCount: count, files: manifest }, null, 2) + '\n')
    await rename(staging, output)
    return { output, contentCount: count, executableSha256: hash(bytes) }
  } finally {
    // This private staging directory was created by this invocation only.
    if (await exists(staging)) await rm(staging, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = {}
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = { '--exe': 'exe', '--content': 'content', '--out': 'output' }[process.argv[i]]
    if (!key || !process.argv[i + 1]) throw new Error('Usage: node scripts/package-native.mjs --exe file [--content directory] [--out new-directory]')
    options[key] = process.argv[i + 1]
  }
  console.log(JSON.stringify(await packageNative(options), null, 2))
}
