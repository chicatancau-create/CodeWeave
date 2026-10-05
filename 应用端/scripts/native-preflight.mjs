import { readdir, stat } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'

const KNOWN_FILES = new Map([
  ['users.json', 'account-source'],
  ['content-manifest.json', 'content-manifest'],
  ['progress.md', 'progress-source'],
  ['学习进度.md', 'progress-source'],
  ['desktop-settings.json', 'settings'],
  ['codeweave.config.example.json', 'configuration-template'],
  ['.server.lock', 'legacy-runtime-lock-do-not-migrate'],
])
const MAX_ENTRIES = 10_000
const MAX_DIRECTORIES = 10_000

function parseRoot(argv) {
  const rootIndex = argv.indexOf('--root')
  if (rootIndex === -1 || !argv[rootIndex + 1]) {
    throw new Error('必须提供只读扫描根目录: --root <path>')
  }
  if (argv.some((argument) => argument === '--write' || argument === '--commit')) {
    throw new Error('预检工具只支持只读模式，不接受写入参数')
  }
  return resolve(argv[rootIndex + 1])
}

async function scanDirectory(root) {
  const queue = [root]
  const files = []
  let directories = 0
  while (queue.length > 0) {
    const current = queue.pop()
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = resolve(current, entry.name)
      if (entry.isDirectory()) {
        directories += 1
        if (directories > MAX_DIRECTORIES) throw new Error(`目录数量超过 ${MAX_DIRECTORIES}，停止预检`)
        queue.push(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      const metadata = await stat(fullPath)
      files.push({
        relativePath: relative(root, fullPath).split(sep).join('/'),
        bytes: metadata.size,
        modifiedAt: metadata.mtime.toISOString(),
        kind: KNOWN_FILES.get(entry.name) ?? 'unclassified',
      })
      if (files.length > MAX_ENTRIES) throw new Error(`文件数量超过 ${MAX_ENTRIES}，停止预检`)
    }
  }
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  return { directories, files }
}

const root = parseRoot(process.argv.slice(2))
const scan = await scanDirectory(root)
const counts = Object.fromEntries([...new Set(scan.files.map((file) => file.kind))]
  .sort()
  .map((kind) => [kind, scan.files.filter((file) => file.kind === kind).length]))

console.log(JSON.stringify({
  mode: 'read-only-dry-run',
  root,
  directories: scan.directories,
  files: scan.files.length,
  kinds: counts,
  filesByMetadata: scan.files,
  contentRead: false,
  writesPerformed: false,
  migrationCommitted: false,
  warnings: scan.files.filter((file) => file.kind === 'unclassified').length > 0
    ? ['存在未分类文件，需要 A2 逐项确认格式后才能迁移']
    : [],
}, null, 2))
