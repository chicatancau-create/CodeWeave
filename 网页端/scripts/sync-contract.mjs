import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const required = [
  'server/contracts/openapi.yaml',
  'server/contracts/errors.yaml',
  'server/contracts/validation-codes.yaml',
  'server/contracts/generated/contract-version.json',
]
const missing = required.filter((file) => !existsSync(join(root, file)))
if (missing.length) {
  console.error(`契约发布物不完整：${missing.join('、')}`)
  process.exit(1)
}
const version = JSON.parse(readFileSync(join(root, 'server/contracts/generated/contract-version.json'), 'utf8'))
console.log(`网页端契约已就绪：${version.contractVersion ?? 'unknown'}`)
