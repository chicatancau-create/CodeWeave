import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

const executable = resolve(process.argv[2] ?? 'native/build-g1-msvc-release/codeweave-native.exe')
const bytes = await readFile(executable)
const file = await stat(executable)
const hash = createHash('sha256').update(bytes).digest('hex')

function runObjdump(target) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('objdump.exe', ['-p', target], { windowsHide: true })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('error', reject)
    child.on('close', (code) => code === 0
      ? resolvePromise(output)
      : reject(new Error('objdump exit ' + code + ': ' + output.trim())))
  })
}

let temporaryDirectory
let dump
try {
  dump = await runObjdump(executable)
} catch (error) {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'codeweave-native-report-'))
  const temporaryExecutable = join(temporaryDirectory, basename(executable))
  await copyFile(executable, temporaryExecutable)
  dump = await runObjdump(temporaryExecutable)
} finally {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
}

const imports = [...dump.matchAll(/DLL Name:\s+([^\r\n]+)/g)].map((match) => match[1].trim())
const subsystem = dump.match(/Subsystem\s+[^\r\n]*\(([^)]+)\)/)?.[1] ?? 'unknown'
console.log(JSON.stringify({ executable, size: file.size, sha256: hash, subsystem, imports }, null, 2))
