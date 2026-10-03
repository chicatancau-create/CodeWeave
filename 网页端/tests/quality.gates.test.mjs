/** Web-only quality gates. Every input is inside this project. */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { webRoot } from './layout.mjs'

const ROOT = webRoot()
const read = (relativePath) => readFileSync(resolve(ROOT, relativePath), 'utf8')

function sourceFiles(directory, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) sourceFiles(full, output)
    else if (/\.(mjs|ts|tsx|js)$/.test(entry.name)) output.push(full)
  }
  return output
}

function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('Web-only project gates', () => {
  it('verify matches the project-owned CI gate list', () => {
    const scripts = JSON.parse(read('package.json')).scripts
    expect(scripts.verify).toBe('npm run audit:boundary && npm run contract:check && npm run typecheck && npm run lint && npm run test:coverage && npm run build && npm run server:check')
    const ci = read('deploy/ci.yml')
    expect([...ci.matchAll(/^\s*run:\s*pnpm run ([a-z:._-]+)\s*$/gm)].map((match) => match[1])).toEqual([
      'audit:boundary', 'contract:check', 'typecheck', 'lint', 'test:coverage', 'build', 'server:check',
    ])
  })

  it('documentation names the real commands and does not invent format', () => {
    const readme = read('README.md')
    expect(readme).toContain('pnpm run verify')
    expect(readme).toContain('smoke')
    expect(readme).not.toMatch(/pnpm (run )?format\b/)
    expect(JSON.parse(read('package.json')).scripts).not.toHaveProperty('format')
  })

  it('the deployment specification owns its viewport matrix', () => {
    const deployment = read('deploy/README.md')
    const matrix = read('tests/viewport-matrix.mjs')
    for (const width of [375, 768, 1280, 1440]) {
      expect(deployment).toContain(String(width))
      expect(matrix).toContain(`width: ${width}`)
    }
  })

  it('contains no runtime source dependency on the other product or an absolute workspace path', () => {
    const files = sourceFiles(join(ROOT, 'src')).concat(sourceFiles(join(ROOT, 'server')))
    const forbidden = /(?:\.\.\/backend|\.\.\/frontend|【本地应用端】_DESKTOP_APP|E:[\\/]CodeWeave)/
    const offenders = files.filter((file) => forbidden.test(withoutComments(readFileSync(file, 'utf8'))))
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
