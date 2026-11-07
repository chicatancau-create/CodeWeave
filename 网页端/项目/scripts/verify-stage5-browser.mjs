/* global document, window, getComputedStyle */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Supply an external Playwright runtime so the application keeps its existing dependencies.
const [runtimePath, chromePath, origin, outputPath] = process.argv.slice(2)
assert(runtimePath && chromePath && origin && outputPath, 'Expected runtime, Chrome, origin and output directory')
const { chromium } = await import(pathToFileURL(resolve(runtimePath, 'index.mjs')).href)
const output = resolve(outputPath)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: chromePath, headless: true })
const report = { startedAt: new Date().toISOString(), status: 'running', viewports: [], keyboard: [], motion: {}, errors: [] }
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
try {
  const context = await browser.newContext()
  await context.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname
    return route.fulfill({
      contentType: 'application/json',
      status: path === '/api/auth/me' ? 200 : 503,
      body: JSON.stringify(path === '/api/auth/me' ? { data: {
        id: 'browser-stage5-isolated', name: '浏览器验收', bio: '', createdAt: '2026-11-07T00:00:00Z',
      } } : { code: 'unavailable', error: '隔离浏览器验收：资料库未连接' }),
    })
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => report.errors.push(error.message))
  for (const width of [375, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(origin)
    await page.getByRole('heading', { name: '你的学习路径', exact: true }).waitFor()
    const styles = await page.evaluate(() => ({
      width: window.innerWidth,
      sidebar: getComputedStyle(document.querySelector('.sidebar')).width,
      sidebarWidth: document.querySelector('.sidebar').getBoundingClientRect().width,
      topbar: getComputedStyle(document.querySelector('.topbar')).height,
      busy: document.querySelector('main').getAttribute('aria-busy'),
      courseHeroWidth: Math.round(document.querySelector('.desktop-course-hero').getBoundingClientRect().width),
      courseHeroRight: Math.round(document.querySelector('.desktop-course-hero').getBoundingClientRect().right),
      primaryWidth: document.querySelector('.desktop-learning-primary').getBoundingClientRect().width,
      railWidth: window.innerWidth > 1200 ? document.querySelector('.desktop-learning-rail').getBoundingClientRect().width : 0,
      sourceLeadFits: (() => {
        const lead = document.querySelector('.cs-banner-lead')
        return lead.scrollWidth <= lead.clientWidth + 1
      })(),
      sourceActionsFit: (() => {
        const banner = document.querySelector('.content-source-banner').getBoundingClientRect()
        return [...document.querySelectorAll('.content-source-banner summary, .content-source-banner button')]
          .every((element) => {
            const rect = element.getBoundingClientRect()
            return rect.left >= banner.left && rect.right <= banner.right && rect.top >= banner.top && rect.bottom <= banner.bottom
          })
      })(),
      subjectLayout: getComputedStyle(document.querySelector('.desktop-subjects')).display,
      decorZIndex: getComputedStyle(document.querySelector('.shell-decor')).zIndex,
      decorPointerEvents: getComputedStyle(document.querySelector('.shell-decor')).pointerEvents,
      screenshot: `home-${window.innerWidth}.png`,
    }))
    assert.equal(styles.busy, 'false')
    assert.equal(styles.sourceLeadFits, true, `source description clipped at ${width}px`)
    assert.equal(styles.sourceActionsFit, true, `source actions overflow at ${width}px`)
    assert.equal(styles.subjectLayout, 'flex')
    assert.equal(styles.decorZIndex, '-1')
    assert.equal(styles.decorPointerEvents, 'none')
    assert(Math.abs(styles.courseHeroWidth - styles.primaryWidth) <= 1, `course hero must fill its column at ${width}px`)
    assert(styles.courseHeroWidth >= width - styles.sidebarWidth - styles.railWidth - (width > 1200 ? 96 : 64), `course hero clipped at ${width}px`)
    assert(styles.courseHeroRight <= width - (width < 600 ? 4 : 12), `course hero overflows at ${width}px`)
    if (width === 375) {
      assert.equal(styles.sidebar, '62px')
      assert.equal(styles.topbar, '56px')
    }
    if (width >= 1280) {
      assert.equal(styles.sidebar, '240px')
      assert.equal(styles.topbar, '68px')
    }
    await page.screenshot({ path: resolve(output, styles.screenshot) })
    report.viewports.push(styles)
    for (const name of ['账户菜单', '快捷动作']) {
      const trigger = page.getByRole('button', { name, exact: true })
      await trigger.click()
      const items = page.getByRole('menuitem').filter({ hasNot: page.locator(':disabled') })
      const first = page.locator('[role="menuitem"]:not(:disabled)').first()
      assert(await first.evaluate((element) => element === document.activeElement), `${name} must focus its first item`)
      await page.keyboard.press('End')
      assert(await page.locator('[role="menuitem"]:not(:disabled)').last().evaluate((element) => element === document.activeElement))
      await page.keyboard.press('ArrowDown')
      assert(await first.evaluate((element) => element === document.activeElement))
      await page.keyboard.press('Escape')
      assert(await trigger.evaluate((element) => element === document.activeElement))
      assert.equal(await items.count(), 0)
      report.keyboard.push(`${width}: ${name} focus, End, wrap, Escape`)
    }
    const calendarTrigger = page.getByRole('button', { name: '查看打卡日历' })
    await calendarTrigger.click()
    const previous = page.getByRole('button', { name: '上一月' })
    const next = page.getByRole('button', { name: '下一月' })
    assert(await previous.evaluate((element) => element === document.activeElement))
    await page.keyboard.press('Shift+Tab')
    assert(await next.evaluate((element) => element === document.activeElement))
    await page.keyboard.press('Tab')
    assert(await previous.evaluate((element) => element === document.activeElement))
    await page.keyboard.press('Escape')
    assert(await calendarTrigger.evaluate((element) => element === document.activeElement))
    report.keyboard.push(`${width}: calendar focus, Tab trap, Escape`)
  }
  report.motion.normal = await page.evaluate(() => ['::before', '::after'].map((pseudo) => {
    const style = getComputedStyle(document.querySelector('.shell-decor'), pseudo)
    return { pseudo, animation: style.animationName, transform: style.transform }
  }))
  await page.waitForFunction((initial) => getComputedStyle(document.querySelector('.shell-decor'), '::before').transform !== initial,
    report.motion.normal[0].transform)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  report.motion.systemReduced = await page.evaluate(() => ['::before', '::after'].map((pseudo) =>
    getComputedStyle(document.querySelector('.shell-decor'), pseudo).animationName))
  assert.deepEqual(report.motion.systemReduced, ['none', 'none'])
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => document.documentElement.classList.add('reduce-motion'))
  report.motion.appReduced = await page.evaluate(() => ['::before', '::after'].map((pseudo) =>
    getComputedStyle(document.querySelector('.shell-decor'), pseudo).animationName))
  assert.deepEqual(report.motion.appReduced, ['none', 'none'])
  assert.deepEqual(report.errors, [])
  report.status = 'passed'
  report.completedAt = new Date().toISOString()
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  report.status = 'failed'
  report.failure = String(error)
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
  throw error
} finally {
  await browser.close()
}
