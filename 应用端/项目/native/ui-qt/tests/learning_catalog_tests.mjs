import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../qml/components/LearningCatalog.js', import.meta.url), 'utf8');
const catalog = {};
runInNewContext(source.replace(/^\.pragma library\r?\n/, ''), catalog);

test('only completion facts satisfy the completed filter', () => {
  for (const state of ['read', 'practiced', 'submittedEvidence']) {
    assert.equal(catalog.holdsCompletion({ [state]: true }), false);
  }
  for (const state of ['selfDeclaredPassed', 'autoVerifiedPassed', 'reviewMastered']) {
    assert.equal(catalog.holdsCompletion({ [state]: true }), true);
  }
  assert.equal(catalog.holdsCompletion(undefined), false);
  assert.equal(catalog.holdsCompletion({ autoVerifiedPassed: 'true' }), false);
});

test('the stage ledger preserves legacy units without inventing mappings', () => {
  const legacy = { id: 'legacy', label: 'A1' };
  const groups = catalog.stageGroups([legacy]);
  assert.equal(groups.length, 11);
  assert.equal(groups[0].key, 'S0');
  assert.equal(groups[9].key, 'S9');
  assert.ok(groups.slice(0, 10).every((group) => group.lessons.length === 0));
  assert.equal(groups[10].lessons[0], legacy);
  assert.equal(catalog.stageGapCount(groups), 0);
  assert.equal(catalog.stageGroups([]).length, 10);
});

test('stage gaps count only holes within observed numbered stages', () => {
  const lessons = [{ stageId: 'S2' }, { label: 'S4' }, { stageId: 'S4' }, { stageId: 'S10' }];
  const groups = catalog.stageGroups(lessons);
  assert.equal(catalog.stageGapCount(groups), 1);
  assert.equal(groups[4].lessons.length, 2);
  assert.equal(groups[10].lessons.length, 1);
  assert.equal(catalog.stageGapCount(catalog.stageGroups([{ stageId: 'S8' }])), 0);
});

test('source and gap labels follow actual metadata and distinguish missing fields', () => {
  assert.equal(catalog.sourceLabel({}), '来源未标注');
  assert.equal(catalog.sourceLabel({ legacy: true }), '旧内置课程 · 未迁入资料库');
  assert.equal(catalog.sourceLabel({ contentId: 'real', legacy: true }), '资料库正式内容');
  assert.equal(catalog.gapLabels({}).length, 2);
  assert.ok(catalog.gapLabels({ stageId: 'S0', contentId: 'real' }).includes('来源未定位'));
  assert.ok(catalog.gapLabels({ stageId: 'S0', source: { path: 'lesson.md' } }).includes('核验状态未记录'));
  assert.equal(catalog.gapLabels({ stageId: 'S0', contentId: 'real', exercise: {},
    source: { path: 'lesson.md', verificationStatus: 'verified' } }).length, 0);
  assert.equal(catalog.subjectLabel({}), '未标注科目');
});

test('subject metadata uses the full catalog and combines only actual capabilities', () => {
  const lessons = [{ languageLabel: 'Python', executable: false },
    { languageLabel: 'Python', contentId: 'real' }, { languageLabel: 'C', executable: false }];
  const python = catalog.subjectSummary(lessons, 'Python');
  assert.equal(python.count, 2);
  assert.equal(python.hasVault, true);
  assert.equal(python.executable, true);
  assert.equal(catalog.subjectSummary(lessons, 'C').executable, false);
  assert.equal(catalog.subjectSummary(lessons, 'Missing').count, 0);
  assert.equal(catalog.heldStateLabels({ read: true, selfDeclaredPassed: true }).join('|'), '已阅读|自评通过');
  assert.equal(catalog.heldStateLabels(undefined).length, 0);
});
