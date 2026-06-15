import js from '@eslint/js'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

// Flat config（ESLint 9）。既有 422 檔有大量既有違規，策略：
//   • 核心衛生規則 → warn（可見、漸進修、不擋）；no-undef → off（純 JS 無型別誤報多，
//     真 undefined 由 build/test/runtime 抓）。放在「無 files 的全域 block」確保所有檔都套到。
//   • 真 bug（hooks 規則、JSX 用未定義元件）→ error，守住新 code。
//   CI 只對「PR 變動的檔案」跑 lint（.github/workflows/ci.yml），既有技術債不擋合併。
export default [
  {
    ignores: [
      'dist/**', 'coverage/**', 'playwright-report/**', 'test-results/**',
      'node_modules/**', 'public/**', 'scripts/**', '*.config.js', 'sw.js',
      '.claude/**',  // git worktree 副本（非 shipping，避免重複計算）
    ],
  },
  js.configs.recommended,

  // ── 全域核心規則覆蓋（無 files，確保所有 .js/.jsx 都套到，不留漏網檔仍是 error）──
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, ...globals.es2021 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-useless-escape': 'warn',
      'no-empty': 'warn',
      'no-irregular-whitespace': 'warn',
      'no-control-regex': 'warn',
      'no-misleading-character-class': 'warn',
    },
  },

  // ── React / JSX 專屬規則 ──
  {
    files: ['**/*.jsx', '**/*.js'],
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'off',
      'react/jsx-key': 'warn',
      'react/no-unknown-property': 'warn',
      // 維持 error（新 code 絕不該犯的真 bug）：
      //   react-hooks/rules-of-hooks、react/jsx-no-undef
    },
  },

  // ── 測試檔的 vitest 全域 ──
  {
    files: [
      '**/*.test.js', '**/*.test.jsx', '**/*.spec.js', '**/*.spec.jsx',
      '**/__tests__/**/*.js', '**/__tests__/**/*.jsx', 'e2e/**/*.js', 'e2e/**/*.jsx',
    ],
    languageOptions: {
      globals: {
        describe: 'readonly', it: 'readonly', test: 'readonly', expect: 'readonly',
        vi: 'readonly', beforeEach: 'readonly', afterEach: 'readonly',
        beforeAll: 'readonly', afterAll: 'readonly', suite: 'readonly',
      },
    },
  },
]
