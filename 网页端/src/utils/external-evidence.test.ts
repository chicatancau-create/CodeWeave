// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  acceptanceKeywords,
  emptyEvidence,
  externalEvidenceKey,
  readExternalEvidence,
  saveExternalEvidence,
  summarizeExternalEvidence,
  validateExternalEvidence,
  EXTERNAL_EVIDENCE_FIELD_MAX,
  type ExternalEvidence,
} from './external-evidence'
import type { Challenge } from '../types/lesson'

const challenge: Pick<Challenge, 'targetOutput' | 'evidence'> = {
  targetOutput: ['独立启动项目并定位一次构建错误'],
  evidence: ['四个工具链的版本输出记录', '一次构建报错的完整日志', '错误原因与修复步骤说明'],
}

const valid = (overrides: Partial<ExternalEvidence> = {}): ExternalEvidence => ({
  environment: 'Windows 11 + JDK 17.0.9 + Maven 3.9.6',
  command: 'mvn -v',
  resultSummary: '四个工具链版本输出记录已保存，定位到一次构建错误并修复：原因是 Maven 版本不匹配',
  artifactRef: 'logs/env-check.txt',
  reproducedOn: '2026-09-01',
  ...overrides,
})

beforeEach(() => {
  localStorage.clear()
})

describe('R4 外部证据：结构校验', () => {
  it('完整证据通过校验，但只代表材料完整', () => {
    const result = validateExternalEvidence(valid(), challenge)
    expect(result.issues).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('缺少必填字段时不通过', () => {
    const result = validateExternalEvidence(valid({ environment: '', command: '   ' }), challenge)
    expect(result.valid).toBe(false)
    const fields = result.issues.map((issue) => issue.field)
    expect(fields).toContain('environment')
    expect(fields).toContain('command')
  })

  it('日志/截图引用为可选字段', () => {
    const result = validateExternalEvidence(valid({ artifactRef: '' }), challenge)
    expect(result.valid).toBe(true)
  })

  it('超过字段长度上限时不通过', () => {
    const result = validateExternalEvidence(
      valid({ resultSummary: 'x'.repeat(EXTERNAL_EVIDENCE_FIELD_MAX + 1) }),
      challenge,
    )
    expect(result.valid).toBe(false)
    expect(result.issues.some((issue) => issue.field === 'resultSummary')).toBe(true)
  })

  it('拒绝疑似密码、API Key、私钥等隐私字段', () => {
    expect(validateExternalEvidence(valid({ command: 'mysql -u root password=abc123' }), challenge).valid).toBe(false)
    expect(validateExternalEvidence(valid({ command: 'curl -H "Authorization: Bearer sk-abc"' }), challenge).valid).toBe(
      false,
    )
    expect(
      validateExternalEvidence(valid({ artifactRef: '-----BEGIN RSA PRIVATE KEY-----' }), challenge).valid,
    ).toBe(false)
    expect(
      validateExternalEvidence(valid({ command: 'psql postgres://user:pass@localhost/db' }), challenge).valid,
    ).toBe(false)
  })

  it('复现日期必须是有效且不晚于今天的 YYYY-MM-DD', () => {
    expect(validateExternalEvidence(valid({ reproducedOn: '2026/09/01' }), challenge).valid).toBe(false)
    expect(validateExternalEvidence(valid({ reproducedOn: '2026-02-30' }), challenge).valid).toBe(false)
    expect(validateExternalEvidence(valid({ reproducedOn: '2099-01-01' }), challenge).valid).toBe(false)
    expect(validateExternalEvidence(valid({ reproducedOn: '2026-09-01' }), challenge).valid).toBe(true)
  })

  it('结果摘要完全未覆盖验收关键词时给出匹配度问题', () => {
    const result = validateExternalEvidence(
      valid({ resultSummary: '完成了相关工作，详细内容见附件说明文档' }),
      challenge,
    )
    expect(result.valid).toBe(false)
    expect(result.issues.some((issue) => issue.field === 'acceptance')).toBe(true)
    expect(result.missingKeywords.length).toBeGreaterThan(0)
  })

  it('结果摘要覆盖部分验收关键词即可通过（不做全部匹配）', () => {
    const result = validateExternalEvidence(
      valid({ resultSummary: '已保存工具链的版本输出记录，并附上构建错误日志与修复说明' }),
      challenge,
    )
    expect(result.valid).toBe(true)
  })

  it('acceptanceKeywords 提取去重且过滤纯数字', () => {
    const keywords = acceptanceKeywords(challenge)
    expect(keywords.length).toBeGreaterThan(0)
    expect(new Set(keywords).size).toBe(keywords.length)
    expect(keywords.every((keyword) => keyword.length >= 2)).toBe(true)
  })
})

describe('R4 外部证据：序列化与持久化', () => {
  it('summarizeExternalEvidence 保留结构化字段', () => {
    const text = summarizeExternalEvidence(valid())
    expect(text).toContain('执行环境：Windows 11')
    expect(text).toContain('执行命令：mvn -v')
    expect(text).toContain('复现日期：2026-09-01')
    expect(text).toContain('日志/截图：logs/env-check.txt')
  })

  it('空引用不输出日志行', () => {
    const text = summarizeExternalEvidence(valid({ artifactRef: '' }))
    expect(text).not.toContain('日志/截图')
  })

  it('按账户作用域读写，互不可见', () => {
    saveExternalEvidence({ 'stage-a': valid() }, 'user-a')
    expect(localStorage.getItem(externalEvidenceKey('user-a'))).not.toBeNull()
    expect(readExternalEvidence('user-b')).toEqual({})
    expect(readExternalEvidence('user-a')['stage-a']?.environment).toContain('Windows')
  })

  it('存储损坏时返回空对象，不抛出', () => {
    localStorage.setItem(externalEvidenceKey('user-1'), '{broken json')
    expect(readExternalEvidence('user-1')).toEqual({})
  })

  it('非法条目被逐条丢弃', () => {
    saveExternalEvidence({ 'stage-a': valid() }, 'user-1')
    const raw = JSON.parse(localStorage.getItem(externalEvidenceKey('user-1'))!) as {
      data: Record<string, unknown>
    }
    raw.data['stage-b'] = { environment: 42, command: null }
    raw.data['stage-c'] = 'not-an-object'
    localStorage.setItem(externalEvidenceKey('user-1'), JSON.stringify(raw))
    const loaded = readExternalEvidence('user-1')
    expect(Object.keys(loaded)).toEqual(['stage-a', 'stage-b'])
    expect(loaded['stage-b']?.environment).toBe('')
  })

  it('emptyEvidence 使用给定日期且各字段为空', () => {
    const blank = emptyEvidence('2026-09-13')
    expect(blank.reproducedOn).toBe('2026-09-13')
    expect(blank.environment).toBe('')
    expect(blank.artifactRef).toBe('')
  })
})
