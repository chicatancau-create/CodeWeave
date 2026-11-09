import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [runtime, chrome, origin, output] = process.argv.slice(2);
assert(runtime && chrome && origin && output, 'Expected Playwright runtime, Chrome, origin and output');
const { chromium } = await import(pathToFileURL(resolve(runtime, 'index.mjs')).href);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const report = { startedAt: new Date().toISOString(), isolatedApi: true, screenshots: [], checks: [], errors: [] };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.route('**/api/**', route => {
    const authenticated = new URL(route.request().url()).pathname === '/api/auth/me';
    return route.fulfill({ status: authenticated ? 200 : 503, contentType: 'application/json',
      body: JSON.stringify(authenticated ? { data: {
        id: 'topbar-reference', name: 'Reference', email: 'topbar@example.test', bio: '', createdAt: '2026-11-08T00:00:00Z',
      } } : { code: 'unavailable', error: 'Isolated reference: vault unavailable' }),
    });
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  const measureElements = async locator => locator.evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      text: element.textContent?.trim() ?? '',
      geometry: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      computed: {
        fontSize: style.fontSize, fontFamily: style.fontFamily, fontWeight: style.fontWeight,
        lineHeight: style.lineHeight, color: style.color, backgroundColor: style.backgroundColor,
        borderWidth: style.borderWidth, borderStyle: style.borderStyle, borderColor: style.borderColor,
        borderRadius: style.borderRadius, outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor, outlineOffset: style.outlineOffset,
      },
    };
  }));
  const measureElement = async locator => {
    const measurements = await measureElements(locator);
    assert.equal(measurements.length, 1, 'Expected one element for computed-style reference');
    return measurements[0];
  };
  const measureTopbar = async () => ({ viewport: page.viewportSize(),
    shell: await measureElement(page.locator('.topbar')),
    brand: await measureElement(page.locator('.topbar .desktop-brand')),
    areas: await measureElement(page.locator('.topbar .desktop-areas')),
    areaButtons: await measureElements(page.locator('.topbar .desktop-areas button')),
    search: await measureElement(page.locator('.topbar .global-search')),
    actions: await measureElement(page.locator('.topbar .topbar-actions')),
    breadcrumbs: await measureElements(page.locator('.breadcrumbs span, .breadcrumbs strong')) });
  const measureSettings = async () => {
    const rows = page.locator('.settings-modal .setting-row');
    assert.equal(await rows.count(), 8, 'Expected eight settings preference rows');
    const settingsRows = [];
    for (let index = 0; index < 8; index++) {
      const row = rows.nth(index);
      const title = await measureElement(row.locator('strong'));
      settingsRows.push({ index, title: title.text, label: title,
        description: await measureElement(row.locator('small')),
        row: await measureElement(row),
        control: await measureElement(row.locator('input[type="checkbox"], select')) });
    }
    return { viewport: page.viewportSize(), rows: settingsRows,
      headerClose: await measureElement(page.locator('.settings-modal .cw-modal-close')) };
  };
  const capture = async (name, selector) => {
    await page.evaluate(() => document.fonts.ready);
    const target = page.locator(selector);
    await target.waitFor();
    const geometry = await target.boundingBox();
    const viewport = page.viewportSize();
    assert(geometry && geometry.width > 0 && geometry.height > 0);
    assert(geometry.x >= 0 && geometry.y >= 0);
    assert(geometry.x + geometry.width <= viewport.width + 1);
    assert(geometry.y + geometry.height <= viewport.height + 1);
    await page.screenshot({ path: resolve(output, name + '.png'), animations: 'disabled' });
    report.screenshots.push({ name, viewport, selector, geometry });
  };
  const escapeAndFocus = async (selector, trigger) => {
    await page.keyboard.press('Escape');
    await page.locator(selector).waitFor({ state: 'hidden' });
    assert(await trigger.evaluate(element => element === document.activeElement));
    report.checks.push({ name: selector + ':escape-and-return-focus', passed: true });
  };
  await page.goto(origin);
  await page.getByRole('heading', { name: '你的学习路径', exact: true }).waitFor();
  await page.getByRole('group', { name: '选择学习科目' }).getByRole('button', { name: /Python/ }).click();
  const title = await page.locator('.desktop-course-hero h2').textContent();
  assert.equal(title, '循环是怎么工作的？');
  // Read the module used by the running fallback and verify the rendered editor separately.
  const lessons = await page.evaluate(async () => (await import('/src/data/lessons.ts')).lessons);
  const lesson = lessons.find(item => item.id === 'python-loop-sum');
  assert.equal(lesson.title, title);
  const pythonLessons = lessons.filter(item => item.languageLabel === 'Python');
  assert.equal(await page.locator('.desktop-unit-card').count(), pythonLessons.length);
  assert.deepEqual(await page.locator('.desktop-unit-card').evaluateAll(cards =>
    cards.map(card => card.querySelector('strong')?.textContent?.trim() ?? '')),
  pythonLessons.map(item => item.title));
  await page.getByRole('button', { name: '进入学习', exact: true }).click();
  const editor = page.locator('.code-editor textarea');
  await editor.waitFor();
  const code = await editor.inputValue();
  assert.equal(code, lesson.code);
  await page.goto(origin);
  await page.getByRole('heading', { name: '你的学习路径', exact: true }).waitFor();
  await page.locator('.desktop-course-hero h2').waitFor();
  report.reference = { accountName: 'Reference', email: 'topbar@example.test', documentId: lesson.id,
    lessonCount: lessons.length, lessonIds: lessons.map(item => item.id).sort(),
    subject: 'Python', filteredLessonIds: pythonLessons.map(item => item.id).sort(),
    sourceCodeSha256: createHash('sha256').update(code).digest('hex'),
    sourceVerification: 'running Vite module, rendered course cards and editor textarea',
    learningState: 'not-run, no evidence, no notifications' };
  await capture('topbar-shell', '.topbar');
  report.topbar = [await measureTopbar()];
  const quick = page.getByRole('button', { name: '快捷动作', exact: true });
  await quick.click();
  await capture('topbar-quick', '.topbar-quick-actions__panel');
  await escapeAndFocus('.topbar-quick-actions__panel', quick);
  const notifications = page.getByRole('button', { name: /通知/ }).first();
  await notifications.click();
  await capture('topbar-notifications', '.notification-panel');
  await escapeAndFocus('.notification-panel', notifications);
  const account = page.getByRole('button', { name: '账户菜单', exact: true });
  await account.click();
  await capture('topbar-account', '.account-menu');
  const accountButtons = page.locator('.account-menu > button');
  assert.equal(await accountButtons.count(), 5, 'Expected five account menu actions');
  report.account = { viewport: page.viewportSize(),
    name: await measureElement(page.locator('.account-menu > strong')),
    contact: await measureElement(page.locator('.account-menu > span')),
    buttons: await measureElements(accountButtons) };
  await escapeAndFocus('.account-menu', account);
  const search = page.getByRole('combobox', { name: '全局搜索课程、挑战与项目' });
  await search.fill('no-match-qt-smoke');
  await capture('topbar-search', '.global-search__panel');
  assert(await search.evaluate(element => element === document.activeElement));
  report.searchFocus = { ...await measureElement(search), focused: true,
    focusVisible: await search.evaluate(element => element.matches(':focus-visible')) };
  await escapeAndFocus('.global-search__panel', search);
  await search.fill('');
  await search.press('Escape');
  const settings = page.getByRole('button', { name: '打开设置', exact: true });
  await settings.click();
  await capture('topbar-settings', '.settings-modal');
  report.settings = [await measureSettings()];
  await page.setViewportSize({ width: 1100, height: 720 });
  await capture('topbar-settings-small', '.settings-modal');
  report.settings.push(await measureSettings());
  await escapeAndFocus('.settings-modal', settings);
  await capture('topbar-shell-small', '.topbar');
  report.topbar.push(await measureTopbar());
  await page.setViewportSize({ width: 1440, height: 900 });
  await quick.click();
  await page.getByRole('menuitem', { name: /学习指南/ }).click();
  await capture('topbar-help', '.help-modal');
  report.help = { viewport: page.viewportSize(),
    title: await measureElement(page.locator('.help-modal .cw-modal-title')),
    sectionTitles: await measureElements(page.locator('.help-modal .cw-modal-help h3')),
    body: await measureElements(page.locator('.help-modal .cw-modal-help p')),
    button: await measureElement(page.locator('.help-modal .cw-modal-cta')) };
  await escapeAndFocus('.help-modal', quick);
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = String(error);
  throw error;
} finally {
  report.completedAt = new Date().toISOString();
  await writeFile(resolve(output, 'web-topbar.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
