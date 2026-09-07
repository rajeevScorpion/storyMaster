import { test, expect, type Page } from '@playwright/test';

/**
 * Admin-authenticated coverage of the Agentic Creator surfaces.
 *
 * The rest of this suite runs signed out, which is why every /admin route had gone
 * unverified in a browser: verifyAdmin() throws Forbidden for anonymous requests, so
 * a signed-out spec can only ever prove the guard works, never that the pages render.
 *
 * Credentials come from the environment and are never committed. Set
 * E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD (in .env.local, which is gitignored) to an
 * account whose id equals ADMIN_USER_ID for the target environment; without them
 * these tests skip rather than fail, so CI and other machines stay green.
 */

const EMAIL = process.env.E2E_ADMIN_EMAIL;
const PASSWORD = process.env.E2E_ADMIN_PASSWORD;

const AGENTIC_ROUTES = [
  { path: '/admin/agents', heading: /agent/i },
  { path: '/admin/agents/personas', heading: /persona/i },
  { path: '/admin/agents/test-lab', heading: /test lab/i },
  { path: '/admin/agents/tasks', heading: /task|coverage/i },
  { path: '/admin/agents/runs', heading: /run/i },
  { path: '/admin/agents/routing', heading: /routing|model/i },
];

async function signIn(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /sign in/i }).first().click();

  const dialog = page.locator('[role="dialog"]').first();
  await expect(dialog).toBeVisible();

  await page.fill('#auth-email', EMAIL!);
  await page.fill('#auth-password', PASSWORD!);
  await dialog.locator('button[type="submit"]').click();

  // The dialog closing is the app's own signal that the session took.
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
}

test.describe('agentic admin surfaces (authenticated)', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set');

  test('every agentic admin route renders for an admin session', async ({ page }) => {
    const failures: string[] = [];

    await signIn(page);

    for (const route of AGENTIC_ROUTES) {
      const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      const status = response?.status() ?? 0;
      const body = (await page.locator('body').innerText().catch(() => '')) || '';

      if (status >= 400) {
        failures.push(`${route.path} -> HTTP ${status}`);
        continue;
      }
      if (/forbidden/i.test(body)) {
        failures.push(`${route.path} -> rendered Forbidden (not recognised as admin)`);
        continue;
      }
      if (/application error|unhandled runtime|digest:/i.test(body)) {
        failures.push(`${route.path} -> client/server error boundary`);
        continue;
      }
      if (!route.heading.test(body)) {
        failures.push(`${route.path} -> rendered, but no ${route.heading} content found`);
      }
    }

    expect(failures, `Agentic admin routes with problems:\n${failures.join('\n')}`).toEqual([]);
  });
});
