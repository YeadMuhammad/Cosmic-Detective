// ESLint flat config for Cosmic Detective.
// - src/**/*.ts(x): type-aware linting (TypeScript + React Hooks rules).
// - scripts/**/*.mjs + vite config: plain JS rules (these are Node scripts, not
//   part of the app tsconfig, so no type-aware parsing).
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  {
    // Global ignores: build output and vendored sky/lightcurve data.
    ignores: ['dist/**', 'node_modules/**', 'public/**', 'src/data/lightcurves.ts'],
  },

  // --- TypeScript + React app source (type-aware) ---------------------------
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // The codebase uses non-null assertions and `as` casts intentionally in a
      // few demo/data places; keep them as warnings, not errors.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // --- Node scripts + Vite config (no type-aware parsing) --------------------
  {
    files: ['scripts/**/*.mjs', 'vite.config.ts'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        document: 'readonly',
        getComputedStyle: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
)
