/**
 * R4：外部环境挑战证据的结构化模型与校验。
 *
 * 背景（审计发现）：外部关卡原先以“证据文本长度 ≥ 40 字”作为通过条件，
 * 任意满足长度的随机文本都能进入“已通过”。本模块用结构化证据替换长度门槛：
 *
 *   - 必填：执行环境、执行命令、结果摘要、复现日期
 *   - 可选：日志/截图引用、补充说明
 *   - 必须在结果摘要中覆盖关卡的每个验收点关键词（匹配度校验）
 *   - 拒绝疑似隐私/凭据字段
 *
 * 重要边界：本模块只做**完整性**校验，不能验证外部证据的真实性。
 * 因此提交后的状态是 `submitted`（待人工确认），而不是自动 `passed`。
 */
import type { Challenge } from '../types/lesson'
import { getLocalDateKey } from './date-helpers'
import { scopedKey, STORAGE_KEYS } from './constants'
import { readLocalData, writeLocalData } from './storage'

/** 结构化外部证据（持久化前会剔除首尾空白） */
export type ExternalEvidence = {
  /** 执行环境：操作系统 / 运行时 / 工具链版本等 */
  environment: string
  /** 实际执行的命令 */
  command: string
  /** 结果摘要：需要覆盖关卡验收点 */
  resultSummary: string
  /** 日志或截图引用（路径、URL 或片段位置） */
  artifactRef?: string
  /** 复现日期（YYYY-MM-DD） */
  reproducedOn: string
}

export const EXTERNAL_EVIDENCE_MIN = 20
export const EXTERNAL_EVIDENCE_MAX = 2000
export const EXTERNAL_EVIDENCE_FIELD_MAX = 600
export const EXTERNAL_EVIDENCE_ARTIFACT_MAX = 300

/** 危险/隐私字段模式：一旦命中即拒绝，避免把凭据写进本地存储。 */
const SENSITIVE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: '私钥内容' },
  { re: /\b(?:password|passwd|pwd)\s*[:=]\s*\S+/i, label: '密码' },
  { re: /\b(?:api[_-]?key|apikey|access[_-]?token|secret[_-]?key|client[_-]?secret)\s*[:=]\s*\S+/i, label: 'API Key / Token' },
  { re: /\bauthorization\s*:\s*bearer\s+\S+/i, label: 'Bearer Token' },
  { re: /\b(?:cookie|set-cookie)\s*:\s*\S+/i, label: 'Cookie' },
  { re: /\b(?:mysql|postgres(?:ql)?|mongodb|redis):\/\/[^\s@]*:[^\s@]*@/i, label: '带密码的连接串' },
]

export type EvidenceFieldIssue = { field: keyof ExternalEvidence | 'acceptance'; message: string }

/**
 * 结构化证据的字段清单（标签 / 占位提示 / 是否必填）。
 *
 * 挑战页与学习工作台的外部课程表单**共用这一份**：字段名与校验规则都出自本模块，
 * 清单再抄一遍就会出现「一处改了另一处没改」的字段漂移，所以只写一次。
 * 顺序即界面顺序；`reproducedOn` 排最后（进表单时由 `emptyEvidence` 预填今天）。
 */
export const EXTERNAL_EVIDENCE_FIELDS: {
  key: keyof ExternalEvidence
  label: string
  placeholder: string
  required: boolean
}[] = [
  {
    key: 'environment',
    label: '执行环境',
    placeholder: '例如：Windows 11 + JDK 17.0.9 + Maven 3.9.6',
    required: true,
  },
  {
    key: 'command',
    label: '执行命令',
    placeholder: '例如：mvn -v / npm run build',
    required: true,
  },
  {
    key: 'resultSummary',
    label: '结果摘要',
    placeholder: '写清与验收点对应的实际结果，例如：构建成功，产物包含 3 个文件，体积 128KB',
    required: true,
  },
  {
    key: 'artifactRef',
    label: '日志 / 截图引用',
    placeholder: '可选：记录文件路径、提交哈希或截图位置',
    required: false,
  },
  {
    key: 'reproducedOn',
    label: '复现日期',
    placeholder: 'YYYY-MM-DD',
    required: true,
  },
]

export type EvidenceValidation = {
  /** 结构完整性是否通过（必填齐全 + 未命中隐私字段 + 关键词匹配） */
  valid: boolean
  /** 逐项问题，供 UI 显示 */
  issues: EvidenceFieldIssue[]
  /** 未在结果摘要中出现的关键词（匹配度诊断） */
  missingKeywords: string[]
}

/** 从验收点提取关键词（去标点/空白，长度 >= 2 的片段）。 */
export function acceptanceKeywords(challenge: Pick<Challenge, 'targetOutput' | 'evidence'>): string[] {
  const raw = [...challenge.targetOutput, ...challenge.evidence].join(' ')
  return [
    ...new Set(
      raw
        .split(/[\s，。、；：！？,.;:!?/|（）()【】[\]“”"'`]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && !/^[\d.]+$/.test(token)),
    ),
  ]
}

/**
 * 关键词命中判定（宽松匹配）：
 * - 完整包含关键词，或
 * - 关键词的字符有较高比例（>= 0.6）出现在摘要中（容忍用词变化与语序调整）。
 *
 * 设计取舍：这个匹配只用于「是否提到了验收点」，不是语义理解。
 * 判定偏宽是为了避免把合法的等价表述误判为未覆盖；代价是它不能防止
 * 蓄意凑字，因此**不能作为通过依据**——外部证据仍然只进入 submitted。
 */
const HIT_RATIO = 0.6

function keywordHit(summary: string, keyword: string): boolean {
  const target = normalized(keyword)
  if (target.length === 0) return true
  if (summary.includes(target)) return true
  const chars = [...new Set(target.split(''))]
  if (chars.length === 0) return true
  const hit = chars.filter((char) => summary.includes(char)).length
  return hit / chars.length >= HIT_RATIO
}

function normalized(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase()
}

function findSensitive(text: string): string | undefined {
  for (const { re, label } of SENSITIVE_PATTERNS) {
    if (re.test(text)) return label
  }
  return undefined
}

export function emptyEvidence(todayKey: string): ExternalEvidence {
  return { environment: '', command: '', resultSummary: '', artifactRef: '', reproducedOn: todayKey }
}

/**
 * 校验结构化外部证据。
 * 注意：`valid === true` 只表示“材料完整”，**不代表证据真实**。
 */
export function validateExternalEvidence(
  evidence: ExternalEvidence,
  challenge: Pick<Challenge, 'targetOutput' | 'evidence'>,
): EvidenceValidation {
  const issues: EvidenceFieldIssue[] = []
  const fields: { key: keyof ExternalEvidence; label: string; required: boolean }[] = [
    { key: 'environment', label: '执行环境', required: true },
    { key: 'command', label: '执行命令', required: true },
    { key: 'resultSummary', label: '结果摘要', required: true },
    { key: 'artifactRef', label: '日志 / 截图引用', required: false },
    { key: 'reproducedOn', label: '复现日期', required: true },
  ]

  let total = 0
  for (const { key, label, required } of fields) {
    const value = (evidence[key] ?? '').trim()
    const max = key === 'artifactRef' ? EXTERNAL_EVIDENCE_ARTIFACT_MAX : EXTERNAL_EVIDENCE_FIELD_MAX
    total += value.length
    if (required && value.length === 0) {
      issues.push({ field: key, message: `${label}不能为空。` })
      continue
    }
    if (value.length > max) {
      issues.push({ field: key, message: `${label}超过 ${max} 字符上限。` })
    }
    const sensitive = findSensitive(value)
    if (sensitive) {
      issues.push({ field: key, message: `${label}疑似包含${sensitive}，请先脱敏。` })
    }
  }

  if (total < EXTERNAL_EVIDENCE_MIN) {
    issues.push({ field: 'resultSummary', message: `全部字段合计至少需要 ${EXTERNAL_EVIDENCE_MIN} 个字符。` })
  }
  if (total > EXTERNAL_EVIDENCE_MAX) {
    issues.push({ field: 'resultSummary', message: `全部字段合计超过 ${EXTERNAL_EVIDENCE_MAX} 字符上限。` })
  }

  const date = evidence.reproducedOn.trim()
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    issues.push({ field: 'reproducedOn', message: '复现日期需为 YYYY-MM-DD 格式。' })
  } else if (date) {
    const parsed = new Date(`${date}T00:00:00Z`)
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      issues.push({ field: 'reproducedOn', message: '复现日期不是有效日期。' })
    } else if (date > getLocalDateKey()) {
      issues.push({ field: 'reproducedOn', message: '复现日期不能晚于今天。' })
    }
  }

  // 匹配度：结果摘要需至少覆盖 1 个验收关键词。关键词仅作“是否提到”的诊断，
  // 不构成真实性验证，因此这里只要求“提到过”，不要求全部命中。
  const summary = normalized(evidence.resultSummary)
  const keywords = acceptanceKeywords(challenge)
  const missingKeywords = summary
    ? keywords.filter((keyword) => !keywordHit(summary, keyword)).slice(0, 8)
    : keywords.slice(0, 8)
  if (summary && keywords.length > 0 && missingKeywords.length === keywords.length) {
    issues.push({
      field: 'acceptance',
      message: '结果摘要没有提到本关的任何验收点，请写明与验收点对应的实际结果。',
    })
  }

  return { valid: issues.length === 0, issues, missingKeywords: summary ? missingKeywords : [] }
}

/** 序列化为提交用的可读文本（保留结构，便于进度记录与导出）。 */
export function summarizeExternalEvidence(evidence: ExternalEvidence): string {
  const lines = [
    `执行环境：${evidence.environment.trim()}`,
    `执行命令：${evidence.command.trim()}`,
    `结果摘要：${evidence.resultSummary.trim()}`,
    `复现日期：${evidence.reproducedOn.trim()}`,
  ]
  const artifact = (evidence.artifactRef ?? '').trim()
  if (artifact) lines.push(`日志/截图：${artifact}`)
  return lines.join('\n')
}

/* --------------------------------------------------------------------------
   账户作用域持久化（与挑战草稿同构，走版本化信封）
   -------------------------------------------------------------------------- */

export type ExternalEvidenceMap = Record<string, ExternalEvidence>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 逐条校验：非法条目丢弃，避免损坏对象扩散到组件。 */
function validateEvidenceMap(value: unknown): ExternalEvidenceMap | undefined {
  if (!isRecord(value)) return undefined
  const result: ExternalEvidenceMap = {}
  for (const [id, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue
    const text = (key: string) => (typeof entry[key] === 'string' ? (entry[key] as string) : '')
    result[id] = {
      environment: text('environment'),
      command: text('command'),
      resultSummary: text('resultSummary'),
      artifactRef: text('artifactRef'),
      reproducedOn: text('reproducedOn'),
    }
  }
  return result
}

export function externalEvidenceKey(scope: string | undefined): string {
  return scopedKey(STORAGE_KEYS.EXTERNAL_EVIDENCE, scope)
}

export function readExternalEvidence(scope?: string): ExternalEvidenceMap {
  return readLocalData<ExternalEvidenceMap>(externalEvidenceKey(scope), validateEvidenceMap) ?? {}
}

export function saveExternalEvidence(map: ExternalEvidenceMap, scope?: string): boolean {
  return writeLocalData(externalEvidenceKey(scope), map)
}
