import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
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
        id: 'topbar-reference', name: '访客模式', bio: '', createdAt: '2026-11-08T00:00:00Z',
      } } : { code: 'unavailable', error: 'Isolated reference: vault unavailable' }),
    });
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
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
  await capture('topbar-shell', '.topbar');
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
  await escapeAndFocus('.account-menu', account);
  const search = page.getByRole('combobox', { name: '全局搜索课程、挑战与项目' });
  await search.fill('no-match-qt-smoke');
  await capture('topbar-search', '.global-search__panel');
  await escapeAndFocus('.global-search__panel', search);
  await search.fill('');
  await search.press('Escape');
  const settings = page.getByRole('button', { name: '打开设置', exact: true });
  await settings.click();
  await capture('topbar-settings', '.settings-modal');
  await page.setViewportSize({ width: 1100, height: 720 });
  await capture('topbar-settings-small', '.settings-modal');
  await escapeAndFocus('.settings-modal', settings);
  await page.setViewportSize({ width: 1440, height: 900 });
  await quick.click();
  await page.getByRole('menuitem', { name: /学习指南/ }).click();
  await capture('topbar-help', '.help-modal');
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
