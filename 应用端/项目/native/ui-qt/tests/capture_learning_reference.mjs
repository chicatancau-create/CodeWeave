import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [runtime, chrome, origin, output] = process.argv.slice(2);
assert(runtime && chrome && origin && output, 'Expected Playwright runtime, Chrome, origin and output directory');
const { chromium } = await import(pathToFileURL(resolve(runtime, 'index.mjs')).href);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const report = { isolatedApi: true, viewport: { width: 1440, height: 900 }, screenshots: [], errors: [] };
try {
  const context = await browser.newContext({ viewport: report.viewport });
  await context.route('**/api/**', (route) => {
    const authenticated = new URL(route.request().url()).pathname === '/api/auth/me';
    return route.fulfill({
      status: authenticated ? 200 : 503,
      contentType: 'application/json',
      body: JSON.stringify(authenticated ? { data: {
        id: 'learning-reference', name: 'Reference', bio: '', createdAt: '2026-11-07T00:00:00Z',
      } } : { code: 'unavailable', error: 'Isolated reference: vault unavailable' }),
    });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.message));
  const screenshot = async (name) => {
    await page.screenshot({ path: resolve(output, name), animations: 'disabled' });
    report.screenshots.push(name);
  };
  await page.goto(origin);
  await page.getByRole('heading', { name: '你的学习路径', exact: true }).waitFor();
  await page.getByRole('group', { name: '选择学习科目' }).getByRole('button', { name: /Python/ }).click();
  await page.locator('.desktop-course-hero h2').filter({ hasText: '循环是怎么工作的？' }).waitFor();
  report.selectedTitle = await page.locator('.desktop-course-hero h2').textContent();
  assert.equal(report.selectedTitle, '循环是怎么工作的？');
  await screenshot('web-learning-python.png');
  await page.getByRole('button', { name: '阶段与来源明细' }).click();
  await page.getByRole('heading', { name: '选择科目和课程', exact: true }).waitFor();
  report.statistics = await page.locator('.lp-specs > div').allTextContents();
  assert.equal(report.statistics.length, 5);
  await screenshot('web-learning-details.png');
  await page.locator('.lp-continue').scrollIntoViewIfNeeded();
  await screenshot('web-learning-details-selected.png');
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  await writeFile(resolve(output, 'web-reference.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
