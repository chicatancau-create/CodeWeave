import { describe, expect, it } from 'vitest'

import { currentSurface, resolveSurface, SURFACE_LABEL } from './surface'

const BROWSER_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'
const DESKTOP_SHELL =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) CodeWeave/0.1.0 Chrome/140.0.0.0 Electron/44.5.1 Safari/537.36'

describe('运行面判定（两端共用一份产物，徽章不能写死）', () => {
  it('只有宿主自己声明 Electron 才算桌面端', () => {
    expect(resolveSurface(DESKTOP_SHELL)).toBe('desktop')
    expect(resolveSurface(BROWSER_EDGE)).toBe('web')
  })

  it('认不出来一律退回浏览器：网页里不许出现 DESKTOP', () => {
    expect(resolveSurface('')).toBe('web')
    // 子串里带 electron 但没有 `Electron/版本` 这个 token，不算桌面壳
    expect(resolveSurface('Mozilla/5.0 (electron-desktop-fork) Chrome/140.0.0.0')).toBe('web')
    expect(SURFACE_LABEL.web).toBe('WEB')
    expect(SURFACE_LABEL.desktop).toBe('DESKTOP')
  })

  it('本测试环境（node/jsdom）里没有桌面壳，导出的当前面就是 web', () => {
    expect(currentSurface).toBe('web')
  })
})
