import { constants } from 'node:fs'
import { link, mkdir, mkdtemp, open, rmdir, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { ASSET_MAX_BYTES, ASSET_TYPES, assetExtensionOf, isPublishedAssetPath, publishedAssetDirs } from './asset.mjs'
import { ContentError, sha256 } from './markdown.mjs'
import { resolveInsideRoot } from './vault-paths.mjs'

const MAX_BUNDLE_ASSET_BYTES = 50 * 1024 * 1024
const VALID_HASH = /^[a-f0-9]{64}$/

async function boundedRead(file) {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > ASSET_MAX_BYTES) {
      throw new ContentError('invalid_asset', '附件必须是大小不超过 5 MiB 的普通文件')
    }
    const buffer = Buffer.alloc(info.size + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length !== info.size) throw new ContentError('source_changed', '读取期间附件发生变化')
    return buffer.subarray(0, length)
  } finally {
    await handle.close()
  }
}

export async function collectPublishedAssets(root, lessons) {
  const dirs = publishedAssetDirs({ lessons })
  const references = new Set()
  for (const lesson of lessons) {
    const markdown = lesson.reading?.markdown ?? ''
    // 与正文渲染器使用相同的行内图片语法。外链不进入资料库附件清单。
    const visible = markdown.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, '').replace(/`[^`\n]+`/g, '')
    for (const match of visible.matchAll(/!\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
      const path = match[1].trim()
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) continue
      references.add(path)
    }
  }
  const assets = []
  const objects = new Map()
  const problems = []
  let totalBytes = 0
  for (const path of [...references].sort()) {
    try {
      if (path.includes('\\') || /[%#?\x00-\x1f:]/.test(path) || isAbsolute(path) ||
          path.split('/').some((part) => !part || part.startsWith('.')) || !isPublishedAssetPath(path, dirs)) {
        throw new ContentError('invalid_asset', '附件路径不在已发布正文目录内')
      }
      const type = ASSET_TYPES[assetExtensionOf(path)]
      if (!type) throw new ContentError('invalid_asset', '附件类型不在白名单内')
      const target = resolveInsideRoot(root, path)
      const canonical = relative(root, target.abs).replace(/\\/g, '/')
      if (canonical !== target.rel) throw new ContentError('invalid_asset', '附件不能经链接访问其他路径')
      const buffer = await boundedRead(target.abs)
      const hash = sha256(buffer)
      if (!objects.has(hash)) {
        totalBytes += buffer.length
        if (totalBytes > MAX_BUNDLE_ASSET_BYTES) throw new ContentError('invalid_asset', '快照附件合计超过 50 MiB')
        objects.set(hash, buffer)
      }
      assets.push({ path: target.rel, sha256: hash, size: buffer.length, contentType: type.contentType })
    } catch (error) {
      problems.push({ code: error instanceof ContentError ? error.code : 'invalid_asset', path, message: '无法收录正文附件' })
    }
  }
  return { assets, objects, problems }
}

export function createAssetObjects(dataRoot) {
  const directory = join(dataRoot, 'content', 'objects')
  function objectPath(hash) {
    if (typeof hash !== 'string' || !VALID_HASH.test(hash)) throw new Error('无效的附件 SHA-256')
    return join(directory, hash)
  }

  async function read({ sha256: hash, size }) {
    const buffer = await boundedRead(objectPath(hash))
    if (buffer.length !== size || sha256(buffer) !== hash) throw new Error('附件对象校验失败')
    return buffer
  }

  async function add(objects) {
    if (!objects.size) return
    await mkdir(directory, { recursive: true })
    const staging = await mkdtemp(join(directory, '.staging-'))
    try {
      for (const [hash, buffer] of objects) {
        const path = objectPath(hash)
        if (buffer.length > ASSET_MAX_BYTES || sha256(buffer) !== hash) throw new Error('附件候选校验失败')
        const staged = join(staging, hash)
        await writeFile(staged, buffer, { flag: 'wx', flush: true })
        try {
          // 创建独立目录项时不会覆盖已发布对象。已有对象也要校验。
          await link(staged, path)
        } catch (error) {
          if (error?.code !== 'EEXIST') throw error
          await read({ sha256: hash, size: buffer.length })
        } finally {
          await unlink(staged)
        }
      }
    } finally {
      await rmdir(staging)
    }
  }

  return { read, add }
}
