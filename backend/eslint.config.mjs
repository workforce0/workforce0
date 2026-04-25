import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'prisma/migrations/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        global: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      // TypedEmitter pattern (class extends EventEmitter + same-name interface
      // for event-payload typings) is used throughout the voice services.
      '@typescript-eslint/no-unsafe-declaration-merging': 'off',
      // Function type appears in callback signatures across realtime/voice
      // glue; not worth refactoring under this PR.
      '@typescript-eslint/no-unsafe-function-type': 'off',
      // Boundary modules import a couple of CJS packages via require().
      '@typescript-eslint/no-require-imports': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // Downgraded to warnings — fixable but not in scope for this PR.
      'prefer-const': 'warn',
      'no-useless-escape': 'warn',
      'no-regex-spaces': 'warn',
      'no-case-declarations': 'warn',
    },
  },
];
