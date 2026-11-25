import { expect, test } from 'vitest'
import fixtures from '../server/contracts/unified-learning.fixture.json' with { type: 'json' }
import { compileLegacyAliases, createContentReferenceResolver, resolveCanonicalContentId } from '../server/service/server/content/identity.mjs'

const legacyId = fixtures.sourceBoundDraft.contentRef.contentId
const lessons = [{ contentId: 'new-unit', legacyRefs: [legacyId] }]
const exact = { legacyId, newContentId: 'new-unit', relation: 'exact', reviewStatus: 'reviewed' }

test('only reviewed exact aliases change the canonical course identifier', () => {
  for (const [relation, reviewStatus] of [['exact', 'pending'], ['partial', 'reviewed'], ['split', 'reviewed'], ['merge', 'reviewed']]) {
    const result = compileLegacyAliases({ entries: [{ ...exact, relation, reviewStatus }] }, lessons)
    expect(result.problems).toEqual([])
    expect(result.legacyAliases).toEqual({})
    expect(resolveCanonicalContentId({ lessons, ...result }, legacyId)).toBe(legacyId)
  }
  const result = compileLegacyAliases({ entries: [exact] }, lessons)
  expect(result.problems).toEqual([])
  expect(resolveCanonicalContentId({ lessons, ...result }, legacyId)).toBe('new-unit')
  expect(compileLegacyAliases({ entries: [exact] }, [{ ...lessons[0], legacyRefs: [] }]).problems).toHaveLength(1)
})

test('an older outbox resolves with its source alias after a later bundle changes the mapping', async () => {
  const { contentRef } = fixtures.sourceBoundDraft
  const original = { vaultId: contentRef.vaultId, lessons, ...compileLegacyAliases({ entries: [exact] }, lessons) }
  const modified = {
    vaultId: contentRef.vaultId,
    lessons: [{ contentId: 'later-unit', legacyRefs: [legacyId] }],
    legacyAliases: { [legacyId]: 'later-unit' },
    aliasVersion: 'later-alias-version',
  }
  const resolver = createContentReferenceResolver({
    readBundle: async (id) => ({ bundle: id === contentRef.bundleId ? original : id === 'later' ? modified : null }),
  })
  const scope = { vaultId: contentRef.vaultId }
  expect(await resolver(scope, { ...contentRef, aliasVersion: original.aliasVersion })).toEqual({ canonicalContentId: 'new-unit' })
  expect(await resolver(scope, { ...contentRef, bundleId: 'later', aliasVersion: original.aliasVersion }))
    .toEqual({ conflict: 'alias_source_mismatch' })
  expect(await resolver(scope, { ...contentRef, bundleId: 'retired' })).toEqual({ conflict: 'content_bundle_unavailable' })
})
