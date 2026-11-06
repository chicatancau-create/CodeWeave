import { performance } from 'node:perf_hooks'
import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { resolve } from 'node:path'

const DEFAULT_RUNS = 5

function parseArgs(argv) {
  const options = { runs: DEFAULT_RUNS, executable: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--runs') {
      const value = Number(argv[++index])
      if (!Number.isInteger(value) || value < 3 || value > 30) {
        throw new Error('--runs 必须是 3 到 30 之间的整数')
      }
      options.runs = value
    } else if (argument === '--exe') {
      options.executable = argv[++index]
    } else if (argument === '--help') {
      console.log('用法: node scripts/native-baseline.mjs --exe <codeweave-native.exe> [--runs 5]')
      process.exit(0)
    } else {
      throw new Error(`未知参数: ${argument}`)
    }
  }
  if (!options.executable) throw new Error('必须提供 --exe')
  return options
}

function runSelfTest(executable) {
  return new Promise((resolveResult, reject) => {
    const started = performance.now()
    const child = spawn(executable, ['--self-test'], { windowsHide: true, stdio: 'ignore' })
    const timeout = setTimeout(() => child.kill(), 30_000)
    child.once('error', reject)
    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      resolveResult({ code, signal, elapsedMs: performance.now() - started })
    })
  })
}

function percentile(values, rank) {
  const sorted = [...values].sort((left, right) => left - right)
  const position = Math.min(sorted.length - 1, Math.max(0, Math.ceil(rank * sorted.length) - 1))
  return sorted[position]
}

const options = parseArgs(process.argv.slice(2))
const executable = resolve(options.executable)
await access(executable)
const samples = []
for (let index = 0; index < options.runs; index += 1) {
  const result = await runSelfTest(executable)
  samples.push(result)
  if (result.code !== 0) {
    throw new Error(`第 ${index + 1} 次原生自检失败: code=${result.code}, signal=${result.signal ?? 'none'}`)
  }
}

const durations = samples.map((sample) => sample.elapsedMs)
console.log(JSON.stringify({
  executable,
  runs: options.runs,
  samplesMs: durations.map((value) => Number(value.toFixed(3))),
  p50Ms: Number(percentile(durations, 0.5).toFixed(3)),
  p95Ms: Number(percentile(durations, 0.95).toFixed(3)),
  allExitCodesZero: samples.every((sample) => sample.code === 0),
}, null, 2))
