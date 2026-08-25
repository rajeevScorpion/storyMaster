import { configDefaults, defineConfig } from 'vitest/config';
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
    clearMocks: true,
    // Playwright owns e2e/ and its specs use the Playwright test API, not
    // vitest's — vitest's default include would otherwise pick up *.spec.ts
    // there. .next* are generated build dirs.
    exclude: [...configDefaults.exclude, 'e2e/**', '.next*/**'],
  },
});
