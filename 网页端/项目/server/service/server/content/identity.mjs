import legacyCourseIds from '../../../contracts/legacy-course-ids.json' with { type: 'json' }
import { sha256, stableStringify } from './markdown.mjs'

const legacyIds = new Set(legacyCourseIds)
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/

export function compileLegacyAliases(mapping, lessons) {
  const aliases = new Map()
  const canonical = new Map(lessons.map((lesson) => [lesson.contentId, lesson]))
  const targets = new Set()
  const problems = []
  for (const entry of Array.isArray(mapping?.entries) ? mapping.entries : []) {
    if (entry.relation !== 'exact' || entry.reviewStatus !== 'reviewed') continue
    const target = canonical.get(entry.newContentId)
    if (!target || !legacyIds.has(entry.legacyId) || canonical.has(entry.legacyId) || legacyIds.has(target.contentId) ||
        aliases.has(entry.legacyId) || targets.has(target.contentId) || !target.legacyRefs?.includes(entry.legacyId)) {
      problems.push({ code: 'invalid_exact_alias', message: '精确映射与旧课目录或发布教学单元不一致' })
      continue
    }
    aliases.set(entry.legacyId, target.contentId)
    targets.add(target.contentId)
  }
  const legacyAliases = Object.fromEntries([...aliases].sort(([left], [right]) => left.localeCompare(right)))
  return { legacyAliases, aliasVersion: sha256(stableStringify({ mapping, legacyAliases })), problems }
}

export function resolveCanonicalContentId(bundle, id) {
  if (typeof id !== 'string' || !ID.test(id)) return null
  if (bundle?.lessons?.some((lesson) => lesson.contentId === id)) return id
  if (!legacyIds.has(id)) return null
  const aliases = bundle?.legacyAliases ?? {}
  return Object.hasOwn(aliases, id) ? aliases[id] : id
}

export function createContentReferenceResolver(store) {
  return async ({ vaultId }, reference) => {
    if (reference === undefined || reference === null) return { canonicalContentId: null }
    if (reference.vaultId !== vaultId || typeof reference.contentId !== 'string' || !ID.test(reference.contentId)) {
      return { conflict: 'content_reference_invalid' }
    }
    const legacy = legacyIds.has(reference.contentId)
    if (legacy && (!reference.bundleId || !reference.aliasVersion)) return { conflict: 'alias_source_required' }
    const result = await store.readBundle(reference.bundleId)
    if (!result.bundle || result.bundle.vaultId !== vaultId) return { conflict: 'content_bundle_unavailable' }
    if (legacy && result.bundle.aliasVersion !== reference.aliasVersion) return { conflict: 'alias_source_mismatch' }
    const canonicalContentId = resolveCanonicalContentId(result.bundle, reference.contentId)
    return canonicalContentId ? { canonicalContentId } : { conflict: 'content_reference_unresolved' }
  }
}
