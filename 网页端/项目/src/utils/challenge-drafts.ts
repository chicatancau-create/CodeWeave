/**
 * 挑战草稿与证据的账户级持久化（R2-B，AUD-04）。
 *
 * 存储结构：{ [challengeId]: { code?: string, evidence: string, savedAt: string } }
 * - 统一走 storage.ts 的版本化信封（schemaVersion + savedAt）。
 * - `code` 缺键与 `code === ''` 是两件事：缺键表示「从没动过代码」，读取方回落起始代码；
 *   空串表示「用户把代码删干净了」，必须原样显示。两者一旦混淆，只写证据的人会被塞进一份空草稿，
 *   起始代码随之被顶掉。
 * - 运行结果（ExecutionResult）不持久化：它是瞬时执行产物，切页后必须重新运行，
 *   界面以「切页后需重新运行」明确提示，避免把陈旧结果冒充当前结果。
 */
import { scopedKey, STORAGE_KEYS } from './constants'
import { readLocalData, writeLocalData } from './storage'

export type ChallengeDraft = {
  /** 当前代码草稿；缺键表示从没动过代码（读取方回落起始代码），空串表示用户清空了编辑器 */
  code?: string
  /** 外部关卡完成证据说明 */
  evidence: string
  /** 最近保存时间（ISO 字符串） */
  savedAt: string
}

export type ChallengeDraftMap = Record<string, ChallengeDraft>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 逐条校验：非法条目丢弃，避免损坏对象扩散到组件。 */
function validateDrafts(value: unknown): ChallengeDraftMap | undefined {
  if (!isRecord(value)) return undefined
  const result: ChallengeDraftMap = {}
  for (const [id, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue
    if (typeof entry.code !== 'string' && typeof entry.evidence !== 'string') continue
    const draft: ChallengeDraft = {
      evidence: typeof entry.evidence === 'string' ? entry.evidence : '',
      savedAt: typeof entry.savedAt === 'string' ? entry.savedAt : '',
    }
    // code 非字符串时整个键丢掉，绝不补空串：补出来的空串会被读取方当成「用户清空了代码」
    if (typeof entry.code === 'string') draft.code = entry.code
    result[id] = draft
  }
  return result
}

export function draftsKey(scope: string | undefined): string {
  return scopedKey(STORAGE_KEYS.CODE_DRAFTS, scope)
}

export function readChallengeDrafts(scope?: string): ChallengeDraftMap {
  return readLocalData<ChallengeDraftMap>(draftsKey(scope), validateDrafts) ?? {}
}

export function saveChallengeDrafts(drafts: ChallengeDraftMap, scope?: string): boolean {
  return writeLocalData(draftsKey(scope), drafts)
}
