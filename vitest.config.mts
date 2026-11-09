import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${root}` },
      // `server-only` throws outside the react-server condition; tests import server modules directly.
      { find: /^server-only$/, replacement: `${root}tests/stubs/server-only.ts` },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // PGlite boots a WASM Postgres per test file: keep the pool small on this 8-CPU machine.
    maxWorkers: 4,
  },
});
