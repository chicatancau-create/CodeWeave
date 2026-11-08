import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const [qtPath, webPath] = process.argv.slice(2);
assert(qtPath && webPath, 'Expected Qt and Web topbar report paths');
const [qt, web] = await Promise.all([
  readFile(qtPath, 'utf8').then(JSON.parse),
  readFile(webPath, 'utf8').then(JSON.parse),
]);

assert.equal(qt.diagnostic, 'passed');
assert.deepEqual(qt.qmlWarnings, []);
assert.equal(web.passed, true);
assert.deepEqual(web.errors, []);
assert.equal(qt.referenceAccount, true);
assert.equal(qt.accountName, web.reference.accountName);
assert.equal(qt.accountContact, web.reference.email);
assert.equal(qt.selectedLesson.id, web.reference.documentId);

const sorted = values => [...values].sort();
assert.deepEqual(sorted(qt.lessonIds), sorted(web.reference.lessonIds));
assert.deepEqual(sorted(qt.filteredLessonIds), sorted(web.reference.filteredLessonIds));
assert.deepEqual(sorted(qt.filteredLessonIds), sorted([
  'python-condition', 'python-function', 'python-loop-sum',
  'python-output', 'python-types', 'python-while',
]));

const codeHash = createHash('sha256').update(qt.selectedLesson.code).digest('hex');
assert.equal(codeHash, web.reference.sourceCodeSha256);
console.log(JSON.stringify({
  passed: true,
  account: qt.accountName,
  lessonCount: qt.lessonIds.length,
  pythonLessonCount: qt.filteredLessonIds.length,
  selectedLesson: qt.selectedLesson.id,
  sourceCodeSha256: codeHash,
}, null, 2));
