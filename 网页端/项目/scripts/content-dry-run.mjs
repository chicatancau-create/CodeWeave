#!/usr/bin/env node
/**
 * 资料库内容 dry-run：只扫描、编译和校验，不发布快照、不写清单、不留同步记录。
 *
 * 用法：
 *   node scripts/content-dry-run.mjs --vault <资料库根> [--output <报告路径>]
 *   CODEWEAVE_VAULT_ROOT=<资料库根> node scripts/content-dry-run.mjs
 *
 * 该入口复用服务端 createContentService().sync({ dryRun: true })，因此和
 * 网页端「重试同步」走同一条编译、规则、来源、主题索引与交叉引用校验链。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createContentService } from '../server/service/server/content/index.mjs'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const vaultRoot = argument('--vault') ?? process.env.CODEWEAVE_VAULT_ROOT
if (!vaultRoot) {
  console.error('缺少资料库根：传 --vault <目录> 或设置 CODEWEAVE_VAULT_ROOT')
  process.exit(2)
}

const output = argument('--output')
const service = createContentService({
  // dry-run 不发布，dataRoot 只用于快照读取；进程级临时路径避免碰真实运行数据。
  dataRoot: join(tmpdir(), `codeweave-content-dry-run-${process.pid}`),
  vaultRoot: resolve(vaultRoot),
})
const { job, reused } = await service.sync({ dryRun: true })
await job.promise

const summary = {
  dryRun: true,
  reused,
  status: job.status,
  published: job.published,
  error: job.error,
  report: job.report,
}
const text = `${JSON.stringify(summary, null, 2)}\n`
if (output) {
  const path = resolve(output)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, 'utf8')
}
process.stdout.write(text)
process.exit(job.status === 'ready' && !job.error ? 0 : 1)
