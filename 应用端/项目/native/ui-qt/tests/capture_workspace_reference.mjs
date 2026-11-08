import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [runtime, chrome, origin, output] = process.argv.slice(2);
assert(runtime && chrome && origin && output, 'Expected Playwright runtime, Chrome, origin and output directory');
const { chromium } = await import(pathToFileURL(resolve(runtime, 'index.mjs')).href);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const report = { isolatedApi: true, documentId: 'python-loop-sum', state: 'not-run', screenshots: [], errors: [] };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.route('**/api/**', route => {
    const authenticated = new URL(route.request().url()).pathname === '/api/auth/me';
    return route.fulfill({
      status: authenticated ? 200 : 503,
      contentType: 'application/json',
      body: JSON.stringify(authenticated ? { data: {
        id: 'workspace-reference', name: 'Reference', bio: '', createdAt: '2026-11-08T00:00:00Z',
      } } : { code: 'unavailable', error: 'Isolated reference: vault unavailable' }),
    });
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  const capture = async name => {
    await page.evaluate(() => document.fonts.ready);
    const viewport = page.viewportSize();
    const geometry = await page.locator('.cw-workspace').boundingBox();
    await page.screenshot({ path: resolve(output, name + '.png'), animations: 'disabled' });
    report.screenshots.push({ name, viewport, geometry });
  };
  await page.goto(origin);
  await page.getByRole('heading', { name: '你的学习路径', exact: true }).waitFor();
  await page.getByRole('group', { name: '选择学习科目' }).getByRole('button', { name: /Python/ }).click();
  await page.locator('.desktop-course-hero h2').filter({ hasText: '循环是怎么工作的？' }).waitFor();
  await page.getByRole('button', { name: '进入学习', exact: true }).click();
  await page.locator('.cw-workspace.is-code-mode .code-editor textarea').waitFor();
  const code = await page.locator('.code-editor textarea').inputValue();
  report.sourceCodeSha256 = createHash('sha256').update(code).digest('hex');
  assert.equal(code, 'total = 0\nfor i in range(1, 6):\n    total = total + i\nprint(total)');
  await capture('web-workbench-code');
  await page.getByRole('button', { name: '代码模式：左边写代码，右边看画布' }).click();
  await page.locator('.cw-workspace:not(.is-code-mode)').waitFor();
  await capture('web-workbench-reading');
  await page.getByRole('button', { name: '课程指南', exact: true }).click();
  await page.getByRole('region', { name: '课程指南', exact: true }).waitFor();
  await page.getByRole('region', { name: '课程指南', exact: true }).scrollIntoViewIfNeeded();
  await capture('web-workbench-guide');
  await page.getByRole('button', { name: '查看学习指南', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await capture('web-workbench-help');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '代码模式：左边写代码，右边看画布' }).click();
  for (const viewport of [{ width: 1100, height: 720 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(viewport);
    await capture(`web-workbench-code-${viewport.width}`);
  }
  assert.equal(await page.locator('.code-editor textarea').inputValue(), code);
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = String(error);
  throw error;
} finally {
  await writeFile(resolve(output, 'web-workspace.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
