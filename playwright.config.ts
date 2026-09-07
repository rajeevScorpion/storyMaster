import { defineConfig, devices } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Load .env.local into this process.
 *
 * Next.js loads .env.local for the APP, but Playwright's runner is a separate node
 * process that inherits nothing from it -- and `dotenv` is not a dependency of this
 * project. So an env-gated spec reading process.env saw nothing, no matter what was
 * in .env.local. e2e/agentic-admin.spec.ts documents exactly that placement for
 * E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD and then skipped forever, silently, because
 * a skip is how it stays green on machines without an admin account. The only way it
 * ever ran was with the variables exported into the shell by hand.
 *
 * Deliberately minimal and dependency-free: KEY=VALUE, optional surrounding quotes,
 * '#' comments and blank lines skipped, and an existing process.env value always
 * wins so CI and one-off shell overrides keep working.
 */
function loadEnvLocal(): void {
  const file = join(process.cwd(), '.env.local');
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(String.fromCharCode(10))) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length > 1 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvLocal();

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
