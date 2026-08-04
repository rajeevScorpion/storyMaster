import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(rootDir),
    },
  },
  test: {
    environment: 'node',
    include: ['scripts/**/*.smoke.ts'],
    testTimeout: 90_000,
    hookTimeout: 90_000,
    maxWorkers: 1,
  },
});
