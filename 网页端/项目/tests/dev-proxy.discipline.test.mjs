/**
 * ENV-01 §2 · 开发代理目标必须由外部给定，端侧不许自己猜端口。
 *
 * 归属：那份 Vite 代理配置是**网页端工程自己的**开发期装配（§7.1、§9 阶段 C
 * 「Vite 代理改读 `CODEWEAVE_DEV_API_ORIGIN`，不再 import 后端 `config.mjs`」）。
 * 这段原本寄在后端包的 `tests/launcher.test.mjs` 里，用 `projectScript('app/vite.config.ts')`
 * 解析到网页端源码再 import——那是 §5 禁止的「后端测试通过相对路径读取端侧源码来完成核心断言」，
 * 所以整段搬回网页端。
 *
 * 与搬迁前的**一处语义差别**（分离方案 §2 第三行要求的就是它）：
 * 旧实现在没有任何显式变量时去调用后端的 `resolveRuntimePaths()` 兜底，
 * 于是页面工程脱离后端目录就跑不起来。新实现**没有兜底**：三档都没给就当场抛，
 * 由启动器把后端实际监听的 origin 传进来。「猜一个默认端口」从来不是更安全的行为——
 * 它只会让人对着另一台服务排查。
 */
import { describe, expect, it } from 'vitest'

import { importWebScript } from './layout.mjs'

const { resolveApiOrigin, ApiOriginError, DEFAULT_API_HOST } = await importWebScript('src/api/origin.ts')

describe('ENV-01 §2 代理目标的三档来源与硬失败', () => {
  it('三档都没给就抛错，不退回任何默认端口', () => {
    expect(() => resolveApiOrigin({})).toThrow(ApiOriginError)
    expect(() => resolveApiOrigin({})).toThrow(/没有给出 API origin/)
    expect(() => resolveApiOrigin({ CODEWEAVE_DEV_API_ORIGIN: '   ' })).toThrow(/没有给出 API origin/)
    // 端口号本身不出现在这份判据里：本模块只认传进来的值。
    expect(DEFAULT_API_HOST).toBe('127.0.0.1')
  })

  it('VITE_API_ORIGIN 与 CODEWEAVE_DEV_API_ORIGIN 都只接受 host[:port]', () => {
    expect(resolveApiOrigin({ VITE_API_ORIGIN: 'https://study.example' })).toBe('https://study.example')
    expect(resolveApiOrigin({ CODEWEAVE_DEV_API_ORIGIN: 'http://127.0.0.1:4290' })).toBe('http://127.0.0.1:4290')
    // 构建期的 VITE_API_ORIGIN 优先于开发档，两者同时给时不给「看哪一档」的余地。
    expect(resolveApiOrigin({ VITE_API_ORIGIN: 'http://127.0.0.1:4300', CODEWEAVE_DEV_API_ORIGIN: 'http://127.0.0.1:4290' }))
      .toBe('http://127.0.0.1:4300')
    expect(() => resolveApiOrigin({ CODEWEAVE_DEV_API_ORIGIN: 'http://x.example/api' })).toThrow(/不带路径/)
    expect(() => resolveApiOrigin({ CODEWEAVE_DEV_API_ORIGIN: 'ftp://127.0.0.1:21' })).toThrow(/CODEWEAVE_DEV_API_ORIGIN/)
  })

  it('CODEWEAVE_DEV_API_PORT 只换端口，主机沿用 loopback；坏端口硬失败', () => {
    expect(resolveApiOrigin({ CODEWEAVE_DEV_API_PORT: '4290' })).toBe('http://127.0.0.1:4290')
    for (const bad of ['0', 'abc', '65536', '-1', '1.5', '4 2']) {
      expect(() => resolveApiOrigin({ CODEWEAVE_DEV_API_PORT: bad }), bad).toThrow(/CODEWEAVE_DEV_API_PORT/)
    }
  })

  it('代理形态钉死：changeOrigin 保持 false（Host 透传才不被同源校验拒），preview 不继承代理', async () => {
    const config = await importWebScript('vite.config.ts')
    const previous = process.env.CODEWEAVE_DEV_API_ORIGIN
    process.env.CODEWEAVE_DEV_API_ORIGIN = 'http://127.0.0.1:4180'
    try {
      const resolved = config.default({ command: 'serve', mode: 'development' })
      expect(resolved.server.proxy['/api']).toMatchObject({
        changeOrigin: false,
        ws: false,
        xfwd: false,
        target: 'http://127.0.0.1:4180',
      })
      // Vite 的 preview 是 `preview.proxy ?? server.proxy`：不清空就没有「无 API 静态预览」这一档了。
      expect(resolved.preview.proxy).toEqual({})
    } finally {
      if (previous === undefined) delete process.env.CODEWEAVE_DEV_API_ORIGIN
      else process.env.CODEWEAVE_DEV_API_ORIGIN = previous
    }
  })

  it('构建期不解析 origin：脱离后端目录也要能出产物（§10.2 第一条）', async () => {
    const config = await importWebScript('vite.config.ts')
    const saved = { ...process.env }
    delete process.env.VITE_API_ORIGIN
    delete process.env.CODEWEAVE_DEV_API_ORIGIN
    delete process.env.CODEWEAVE_DEV_API_PORT
    try {
      // 同一个进程里 loadEnv 会读到真实环境变量，所以只判「构建档不去调用解析器」这一点：
      // 生产是同源相对路径，构建期根本不需要 origin。
      const resolved = config.default({ command: 'build', mode: 'production' })
      expect(resolved.server.proxy['/api'].target).toBe('')
      expect(resolved.preview.proxy).toEqual({})
    } finally {
      for (const key of ['VITE_API_ORIGIN', 'CODEWEAVE_DEV_API_ORIGIN', 'CODEWEAVE_DEV_API_PORT']) {
        if (saved[key] === undefined) delete process.env[key]
        else process.env[key] = saved[key]
      }
    }
  })
})
