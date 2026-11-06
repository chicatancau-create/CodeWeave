/**
 * 运行时路径与端口解析（03 号方案 §3 启动器和路径规则）。
 *
 * 优先级：调用方显式参数（CLI）> 环境变量 > `config/codeweave.local.json` > 工程相对默认。
 * 工程相对默认指向三层布局（`data/knowledge/vault`、`data/runtime/data`）：生产代码里不再写死
 * 迁移前那台机器上的资料库绝对路径，本机真实位置只存在于本机配置。
 * 配置里的相对路径一律以工程根为基准解析；绝对路径原样接受。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

export const CONFIG_SCHEMA_VERSION = 1
export const CONFIG_FILE_REL = 'config/codeweave.local.json'
/** 版本化示例配置同时充当工程根标记：找到它才算进入本项目根目录。 */
export const ROOT_MARKER_REL = 'config/codeweave.config.example.json'

export const DEFAULT_HOST = '127.0.0.1'
export const DEFAULT_PORT = 4173

export class ConfigError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ConfigError'
    this.code = code
  }
}

/** 目录存在且是目录。 */
function isDirectory(absPath) {
  try {
    return statSync(absPath).isDirectory()
  } catch {
    return false
  }
}

/**
 * 从给定目录逐级上溯找工程根。后端位于 `workspace/backend`，前端位于 `workspace/frontend`，
 * 数据位于 `workspace/data`，所以必须上溯而不是取父目录。
 */
export function findProjectRoot(startDir, env = process.env) {
  const override = String(env.CODEWEAVE_PROJECT_ROOT ?? '').trim()
  if (override) {
    const abs = resolve(override)
    if (!isDirectory(abs)) {
      throw new ConfigError('project_root_missing', `CODEWEAVE_PROJECT_ROOT 指向的目录不存在：${abs}`)
    }
    return abs
  }
  let dir = resolve(startDir)
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(dir, ROOT_MARKER_REL))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  throw new ConfigError(
    'project_root_not_found',
    `未能从 ${resolve(startDir)} 定位工程根（缺少 ${ROOT_MARKER_REL}）。请用 CODEWEAVE_PROJECT_ROOT 指明工程根。`,
  )
}

/** 配置文件可写注释键（`_` 前缀），解析时忽略；键名非法时报错而不是静默接受。 */
const KNOWN_KEYS = new Set(['schemaVersion', 'vaultRoot', 'dataDir', 'port', 'staticDir'])

function readConfigFile(projectRoot, file) {
  const abs = file ? resolve(file) : join(projectRoot, CONFIG_FILE_REL)
  if (!existsSync(abs)) {
    if (file) throw new ConfigError('config_file_missing', `指定的配置文件不存在：${abs}`)
    return { file: null, values: {} }
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(abs, 'utf8'))
  } catch (error) {
    throw new ConfigError('config_invalid_json', `配置文件不是合法 JSON：${abs}（${error.message}）`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigError('config_invalid_shape', `配置文件顶层必须是对象：${abs}`)
  }
  const version = parsed.schemaVersion ?? CONFIG_SCHEMA_VERSION
  if (version !== CONFIG_SCHEMA_VERSION) {
    throw new ConfigError('config_unsupported_version', `配置文件 schemaVersion=${version} 无法读取（本版本支持 ${CONFIG_SCHEMA_VERSION}）：${abs}`)
  }
  for (const key of Object.keys(parsed)) {
    if (!key.startsWith('_') && !KNOWN_KEYS.has(key)) {
      throw new ConfigError('config_unknown_key', `配置文件含未知键 ${key}：${abs}`)
    }
  }
  return { file: abs, values: parsed }
}

/** 配置/环境里的路径值：相对路径以工程根为基准。 */
function toAbsolutePath(projectRoot, value, key) {
  const text = String(value ?? '').trim()
  if (!text) {
    throw new ConfigError('config_invalid_value', `${key} 不能为空`)
  }
  return isAbsolute(text) ? resolve(text) : resolve(projectRoot, text)
}

function toPort(value, key) {
  const text = String(value ?? '').trim()
  const port = Number(text)
  if (!/^\d+$/.test(text) || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ConfigError('config_invalid_port', `${key} 不是合法端口号：${value}`)
  }
  return port
}

/**
 * 解析运行时路径与端口。返回 `{ projectRoot, vaultRoot, dataDir, logsDir, backupsDir, locksDir, port, origin, sources, conflicts }`。
 *
 * `startDir` 默认取本模块所在目录再上溯，这样无论从哪个工作目录调用 CLI，
 * 解析出的都是同一份工程根。
 *
 * `sources` 记录每一项来自 `cli` / `env` / `config` / `default`，供启动器与诊断如实呈现「现在用的是哪一份路径」。
 * `conflicts` 不为空时调用方必须停下来问人，不能自行猜测（§7.2 禁止用默认值覆盖真实数据位置）。
 */
export function resolveRuntimePaths({
  startDir = import.meta.dirname,
  env = process.env,
  configFile,
  vaultRoot,
  dataDir,
  port,
  staticDir,
} = {}) {
  const projectRoot = findProjectRoot(startDir, env)
  const { file, values } = readConfigFile(projectRoot, configFile)

  const sources = {}
  function pick(explicit, envName, configName, fallback, normalize) {
    if (explicit !== undefined && explicit !== null && String(explicit).trim() !== '') {
      sources[configName] = 'cli'
      return normalize(explicit, `--${configName}`)
    }
    const fromEnv = env[envName]
    if (fromEnv !== undefined && String(fromEnv).trim() !== '') {
      sources[configName] = 'env'
      return normalize(fromEnv, envName)
    }
    if (values[configName] !== undefined) {
      sources[configName] = 'config'
      return normalize(values[configName], `${CONFIG_FILE_REL}#${configName}`)
    }
    sources[configName] = 'default'
    return fallback()
  }

  const resolvedVaultRoot = pick(
    vaultRoot,
    'CODEWEAVE_VAULT_ROOT',
    'vaultRoot',
    () => join(projectRoot, 'data', 'vault'),
    (v) => toAbsolutePath(projectRoot, v, 'vaultRoot'),
  )
  const resolvedDataDir = pick(
    dataDir,
    'CODE_CANVAS_DATA_DIR',
    'dataDir',
    () => join(projectRoot, 'data', 'runtime'),
    (v) => toAbsolutePath(projectRoot, v, 'dataDir'),
  )
  const resolvedPort = pick(port, 'PORT', 'port', () => DEFAULT_PORT, (v) => toPort(v, 'port'))
  // 网页端交付的是**构建产物**，不是源码目录：默认落在本包 `data/web-client/`，由启动器在发布
  // 步骤里放进去。这里不认 `frontend/dist` 那类兄弟工程相对路径（分离方案 §5 禁止项）。
  const resolvedStaticDir = pick(
    staticDir,
    'CODEWEAVE_STATIC_DIR',
    'staticDir',
    () => join(projectRoot, 'data', 'web-client'),
    (v) => toAbsolutePath(projectRoot, v, 'staticDir'),
  )

  const dataRoot = join(projectRoot, 'data')
  const result = {
    projectRoot,
    /** 后端根：`server.mjs` 与服务端模块所在位置（`<工程根>/service`）。 */
    appRoot: resolve(import.meta.dirname, '..'),
    /** 要同源服务的网页端构建产物目录（发布物，不是另一端源码）。 */
    staticDir: resolvedStaticDir,
    configFile: file,
    vaultRoot: resolvedVaultRoot,
    dataDir: resolvedDataDir,
    logsDir: join(dataRoot, 'logs'),
    backupsDir: join(dataRoot, 'backups'),
    locksDir: join(dataRoot, 'locks'),
    port: resolvedPort,
    host: DEFAULT_HOST,
    origin: `http://${DEFAULT_HOST}:${resolvedPort}`,
    sources,
    conflicts: [],
  }

  // §6.1「源内容失效 / 资料库缺失」仍可打开，但**数据目录**指错会让服务对着空目录初始化，
  // 用户看到的是「账户没了」。旧位置还在时明确报冲突，交给人决定，不静默换根。
  if (sources.dataDir !== 'env' && sources.dataDir !== 'cli') {
    const legacyDir = join(projectRoot, 'data')
    const legacyHasAccounts = existsSync(join(legacyDir, 'users.json'))
    const targetHasAccounts = existsSync(join(resolvedDataDir, 'users.json'))
    if (legacyHasAccounts && !targetHasAccounts && relative(legacyDir, resolvedDataDir) !== '') {
      result.conflicts.push({
        code: 'data_dir_has_predecessor',
        message:
          `当前数据目录 ${resolvedDataDir} 来自${sources.dataDir === 'config' ? '配置文件' : '工程相对默认'}且尚无 users.json，` +
          `而 ${legacyDir} 仍持有账户数据。请把配置指向旧目录，或先完成数据迁移再切换，不要空目录启动。`,
      })
    }
  }
  return result
}

/**
 * 进程级默认配置（懒加载缓存）：服务与 CLI 未显式传参时共用这一份。
 * 缓存跟着 CODEWEAVE_PROJECT_ROOT 走——换根就是换项目，不能继续用旧缓存。
 * 需要另一套解析结果时用 `resolveRuntimePaths({ startDir, env, configFile })`，它不写缓存。
 */
let cachedConfig = null
let cachedRootOverride = null
export function runtimeConfig() {
  const rootOverride = process.env.CODEWEAVE_PROJECT_ROOT ?? ''
  if (!cachedConfig || cachedRootOverride !== rootOverride) {
    cachedConfig = resolveRuntimePaths({ startDir: import.meta.dirname })
    cachedRootOverride = rootOverride
  }
  return cachedConfig
}

/** 供 CLI 与诊断打印的一行来源说明。 */
export function describeSources(config) {
  const item = (key, value) => `${key}=${value}（${config.sources[key] ?? 'default'}）`
  return [
    item('vaultRoot', config.vaultRoot),
    item('dataDir', config.dataDir),
    item('port', String(config.port)),
  ].join('  ')
}
