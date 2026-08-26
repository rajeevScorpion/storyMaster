import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.AGENT_DEV_PORT || 3100);
const BASE_URL = process.env.AGENT_DEV_URL || `http://127.0.0.1:${PORT}`;

/**
 * Browser smoke tests, run against the agent-owned dev server on port 3100
 * (see scripts/agent-dev.mjs). Start it first, or use `npm run test:e2e`,
 * which starts it for you.
 *
 * These deliberately do NOT assert performance. A dev server compiles each route
 * on first request, so the generous timeouts here are compile budgets, not
 * latency expectations.
 */
export default defineConfig({
  testDir: './e2e',
  // Restores next-env.d.ts / tsconfig.json, which the running dev server
  // repoints at .next-agent as it compiles each route the suite visits.
  globalSetup: './e2e/global-setup.ts',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '.agent/playwright',
  use: {
    baseURL: BASE_URL,
    navigationTimeout: 90_000,
    actionTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
