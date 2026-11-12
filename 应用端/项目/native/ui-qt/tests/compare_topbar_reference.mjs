import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const [qtPath, webPath] = process.argv.slice(2);
assert(qtPath && webPath, 'Expected Qt and Web topbar report paths');
const [qt, web] = await Promise.all([
  readFile(qtPath, 'utf8').then(JSON.parse),
  readFile(webPath, 'utf8').then(JSON.parse),
]);
const catalogText = await readFile(new URL('../../content/catalog.v1.tsv', import.meta.url), 'utf8');

const decodeHexField = (value, label) => {
  assert.match(value, /^(?:[0-9a-f]{2})+$/i, `Invalid hex field: ${label}`);
  return Buffer.from(value, 'hex').toString('utf8');
};
const catalogRows = catalogText.trimEnd().split(/\r?\n/).map((line, index) => {
  const fields = line.split('\t');
  assert.equal(fields.length, 6, `Unexpected catalog column count at row ${index + 1}`);
  return {
    id: decodeHexField(fields[0], `catalog row ${index + 1} id`),
    status: decodeHexField(fields[2], `catalog row ${index + 1} status`),
  };
});
const publishedCatalogIds = catalogRows.filter(row => row.status === 'published').map(row => row.id);
assert.equal(new Set(publishedCatalogIds).size, publishedCatalogIds.length, 'Duplicate published catalog IDs');

assert.equal(qt.diagnostic, 'passed');
assert.deepEqual(qt.qmlWarnings, []);
assert.equal(qt.sidebarGeometry?.viewport, '1100x720');
assert.equal(qt.sidebarGeometry?.windowWidth, 1100);
assert.equal(qt.sidebarGeometry?.windowHeight, 720);
assert.equal(qt.sidebarGeometry?.sidebarVisible, true);
assert.equal(qt.sidebarGeometry?.passed, true);
assert.ok(Math.abs(qt.sidebarGeometry.contentY - qt.sidebarGeometry.expectedTopMargin) <= 0.5);
assert.equal(web.passed, true);
assert.deepEqual(web.errors, []);
assert.equal(qt.referenceAccount, true);
assert.equal(qt.accountName, web.reference.accountName);
assert.equal(qt.accountContact, web.reference.email);
assert.equal(qt.selectedLesson.id, web.reference.documentId);

const sorted = values => [...values].sort();
assert.equal(qt.lessonCount, qt.lessonIds.length);
assert.equal(web.reference.lessonCount, web.reference.lessonIds.length);
assert.equal(new Set(qt.lessonIds).size, qt.lessonIds.length, 'Duplicate Qt UI lesson IDs');
assert.equal(new Set(web.reference.lessonIds).size, web.reference.lessonIds.length, 'Duplicate Web lesson IDs');
const qtWebLessonIds = qt.lessonIds.filter(id => web.reference.lessonIds.includes(id));
const publishedCatalogIdSet = new Set(publishedCatalogIds);
const qtCatalogLessonIds = qt.lessonIds.filter(id => publishedCatalogIdSet.has(id));
const webCatalogLessonIds = web.reference.lessonIds.filter(id => publishedCatalogIdSet.has(id));
assert.deepEqual(sorted(qt.lessonIds), sorted(web.reference.lessonIds));
assert.equal(qtCatalogLessonIds.length, qt.lessonIds.length, 'Qt UI lesson missing from native catalog');
assert.equal(webCatalogLessonIds.length, web.reference.lessonIds.length, 'Web lesson missing from native catalog');
assert.deepEqual(sorted(qt.filteredLessonIds), sorted(web.reference.filteredLessonIds));
assert.deepEqual(sorted(qt.filteredLessonIds), sorted([
  'python-condition', 'python-function', 'python-loop-sum',
  'python-output', 'python-types', 'python-while',
]));

const codeHash = createHash('sha256').update(qt.selectedLesson.code).digest('hex');
assert.equal(codeHash, web.reference.sourceCodeSha256);
console.log(JSON.stringify({
  passed: true,
  counts: {
    nativePublishedCatalogRows: publishedCatalogIds.length,
    qtUiCurriculumLessons: qt.lessonIds.length,
    webRuntimeLessons: web.reference.lessonIds.length,
    qtWebLessonIdIntersection: qtWebLessonIds.length,
    nativeCatalogRowsOutsideQtUiCurriculum: publishedCatalogIds.length - qtCatalogLessonIds.length,
  },
  catalogMembership: {
    qtUiLessonsFound: qtCatalogLessonIds.length,
    webRuntimeLessonsFound: webCatalogLessonIds.length,
  },
  account: qt.accountName,
  selectedLesson: qt.selectedLesson.id,
  pythonLessonCount: qt.filteredLessonIds.length,
  sourceCodeSha256: codeHash,
}, null, 2));
