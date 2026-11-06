import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
for (const rel of ['settings.gradle.kts','build.gradle.kts','mobile-app/build.gradle.kts','mobile-core/CMakeLists.txt']) {
  if (!existsSync(resolve(root, rel))) throw new Error(`missing mobile boundary file: ${rel}`)
}
console.log('Mobile boundary audit passed')
