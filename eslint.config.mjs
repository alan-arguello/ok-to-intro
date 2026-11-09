import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Copy uses curly quotes and apostrophes (ux-spec §2.7); straight ones in JSX text are a lint error.
      'react/no-unescaped-entities': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  globalIgnores([
    '.next/**',
    '.next-*/**',
    'out/**',
    'build/**',
    'coverage/**',
    '.shots/**',
    'next-env.d.ts',
    'plugins/**/*.sh',
    // A verbatim copy of the audit tool from build-inputs (S7 keeps it in sync).
    'scripts/shoot.mjs',
  ]),
]);
