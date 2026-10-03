/**
 * 网页端自己的测试入口（分离方案 §2 耦合表最后一行：拆成 web / desktop / backend 三套测试入口）。
 *
 * 与旧配置的三处差别，全部是分离要求：
 *   1. 不再收 `../backend/tests/**` —— 后端测试由后端包自己跑（§10.2）；
 *   2. 收本包 tests 目录下的 .test.mjs —— 那五条「纪律」守卫量的是网页端源码，归属在这里；
 *   3. 覆盖率只统计 `src/**` —— 后端代码不在本包的统计范围里，分母才是这一端的真实面。
 *
 * 默认环境仍是 node，需要 DOM 的文件用首行 `// @vitest-environment jsdom` 覆盖；
 * 覆盖率阈值按分离前的实测留约 1 个点余量，提高阈值必须在同一提交里补对应测试。
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.test.mjs'],
    exclude: ['node_modules/**', 'dist/**'],
    // 并行成立的前提（沿用后端口径）：服务端集成测试一律随机端口 + mkdtemp 独立数据目录。
    fileParallelism: true,
    testTimeout: 10_000,
    hookTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/types/**',
        'src/vite-env.d.ts',
        'src/main.tsx',
      ],
      // 阈值 = 实测基线留余量；引用覆盖率一律按现测，不抄历史数字。
      // 最近一次实测基线（2026-10-02，分离后本包自己这一份范围，82 文件 / 全绿）：
      //   语句 89.19% / 分支 82.36% / 函数 86.51% / 行 92.18%
      // 与分离前那次合并范围（`src/**` + 后端 `server/**` 一起量）的 89.14 / 82.30 / 86.47 / 92.14
      // 四项都在 0.05 个点内 —— 换的是分母（后端文件移出本包），不是端侧的测试面。
      // **本轮没有上调阈值**：那四条阈值是按分离前的合并范围定的，分离后分母变小、
      // 抬阈值要在同一提交里补对应测试（§11.1），而这一轮只搬归属、没新增用例。
      thresholds: {
        lines: 78.5,
        statements: 75.5,
        functions: 73.5,
        branches: 63.5,
      },
    },
  },
})
