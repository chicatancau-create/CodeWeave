import eslint from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

/**
 * 网页端自己的 Lint 范围（分离方案 §2：`lint` 脚本原先扫 `../backend` 与 `../tools`，
 * 让页面工程的成败取决于另外两个工程的代码质量）。
 * 后端的 `server/**` 与 `scripts/**` 由后端包自己那套检查负责，两端各自可验收（§10.2）。
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.tmp-video/**', 'public/**', 'server/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // 本包内的 Node 侧文件（构建与测试配置、随包的分发脚本）。
    files: ['*.config.{ts,js,mjs}', 'scripts/**/*.mjs', 'tests/**/*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        AbortController: 'readonly',
      },
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
)
