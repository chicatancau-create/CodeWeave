import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
// API origin 的判据住在端侧自己的模块里（分离方案 §2：端口解析归启动器或 API 客户端配置）。
// 这里**不 import 后端的 server/config.mjs**——那正是本次分离要消除的第一条耦合。
import { resolveApiOrigin } from './src/api/origin'

/**
 * 只取开发代理用得上的变量：`loadEnv` 同时覆盖真实环境变量与 `.env` 文件，
 * 因此配置里不必出现 `process`（本 tsconfig 的 lib 没有 DOM，也没装 @types/node）。
 */
function readDevEnv(mode: string) {
  return loadEnv(mode, '.', [
    'VITE_API_ORIGIN',
    'CODEWEAVE_DEV_API_ORIGIN',
    'CODEWEAVE_DEV_API_PORT',
    'CODE_CANVAS_NO_OPEN',
  ])
}

// 导出只为让测试能核对端口来源；配置本身不依赖它。
export { resolveApiOrigin }

// Vite 8 基于 Rolldown：manualChunks 仅支持函数形式；minify 默认使用 oxc
// （保留 console、移除 debugger，与原 terser 配置 drop_console:false/drop_debugger:true 等效）。
export default defineConfig(({ mode, command }) => {
  const env = readDevEnv(mode)
  // 只有 `vite dev` 需要代理目标。生产与预览是**同源相对路径**，页面运行时不 baked 任何 origin，
  // 因此构建期不该解析它——否则「脱离后端目录能不能构建」这一条门禁会被一个无关的启动参数卡住（§10.2）。
  const apiTarget = command === 'serve' ? resolveApiOrigin(env) : ''
  return {
    plugins: [react()],
    build: {
      target: 'es2015',
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules')) {
              if (id.includes('lucide-react')) return 'icons'
              if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'react-vendor'
            }
            return undefined
          },
        },
      },
      chunkSizeWarningLimit: 1000,
    },
    server: {
      port: 5173,
      strictPort: false,
      // 自动化验证与一键启动不弹浏览器（与后端 `CODE_CANVAS_NO_OPEN` 同一约定）。
      open: env.CODE_CANVAS_NO_OPEN !== '1',
      proxy: {
        '/api': {
          target: apiTarget,
          /**
           * 必须保持 false（http-proxy 默认值）：服务端的跨源纵深防御比较的是请求的 `Origin` 与
           * **原样转发过去的** `Host`（后端 `guardWriteRequest`）。改成 `changeOrigin: true`
           * 会把 Host 改写成 target，浏览器仍发 `Origin: http://localhost:5173`，两者不等
           * → 注册/登录这类写请求得到 403 `cross_site_rejected`。
           * 正解是让 Host 透传，而不是关掉服务端的同源校验（ENV-01 §2 明令禁止）。
           */
          changeOrigin: false,
          ws: false,
          // 限流取 socket 地址且服务端明确不信任 X-Forwarded-*，所以不伪造转发头：
          // 开发期所有请求都记成 127.0.0.1，与同源部署同口径。
          xfwd: false,
        },
      },
    },
    preview: {
      port: 4173,
      strictPort: false,
      /**
       * 必须显式写空：Vite 的 `resolvePreviewConfig` 是 `preview.proxy ?? server.proxy`，
       * 不写的话 `pnpm run preview` 会**继承**上面那个 `/api` 代理，静态预览就悄悄变成了
       * 有 API 的第二档（README「三条路径先分清」里的第 3 档要成立的正是「无 API」）。
       */
      proxy: {},
    },
  }
})
