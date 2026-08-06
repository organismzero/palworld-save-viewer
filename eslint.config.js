import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // `spike/` is the gitignored M0 measurement harness — throwaway by design,
  // and not held to the same bar as shipping code. See docs/spike-m0.md.
  { ignores: ['dist', 'node_modules', 'test/fixtures', 'spike'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The GVAS tree is untyped by nature — the combinator library in
      // src/parse/gvas.ts is precisely the boundary where `any` stops.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
