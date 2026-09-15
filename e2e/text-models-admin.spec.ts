import { test, expect, type Page } from '@playwright/test';

/**
 * Admin-authenticated coverage of the Text Models registry page (/admin/text-models).
 *
 * Mirrors e2e/agentic-admin.spec.ts's pattern rather than extending its AGENTIC_ROUTES list --
 * Text Models is not part of the Agentic Creator surface that file documents itself as
 * covering, it is the standalone text-model-registry admin page from the text model gateway
 * work (docs/text-model-gateway-plan.md P4b).
 *
 * Credentials come from the environment and are never committed. Set E2E_ADMIN_EMAIL /
 * E2E_ADMIN_PASSWORD (in .env.local, which is gitignored) to an account whose id equals
 * ADMIN_USER_ID for the target environment; without them this test skips rather than fails,
 * so CI and other machines stay green.
 */

const EMAIL = process.env.E2E_ADMIN_EMAIL;
const PASSWORD = process.env.E2E_ADMIN_PASSWORD;

const ROUTE = { path: '/admin/text-models', heading: /text models/i };

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

test.describe('text models admin surface (authenticated)', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set');

  test('/admin/text-models renders for an admin session', async ({ page }) => {
    await signIn(page);

    const response = await page.goto(ROUTE.path, { waitUntil: 'domcontentloaded' });
    const status = response?.status() ?? 0;
    const body = (await page.locator('body').innerText().catch(() => '')) || '';

    expect(status, `${ROUTE.path} -> HTTP ${status}`).toBeLessThan(400);
    expect(body, `${ROUTE.path} -> rendered Forbidden (not recognised as admin)`).not.toMatch(/forbidden/i);
    expect(body, `${ROUTE.path} -> client/server error boundary`).not.toMatch(/application error|unhandled runtime|digest:/i);
    expect(body, `${ROUTE.path} -> rendered, but no ${ROUTE.heading} content found`).toMatch(ROUTE.heading);

    // Card-grid layout (Phase D): the task assignments section, with a per-task Thinking
    // control, is the admin surface for migration 120's per-task thinking override.
    await expect(page.getByRole('heading', { name: /task assignments/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Thinking for Story Generation', exact: true })).toBeVisible();
    await expect(page.getByText('Suggested thinking').first()).toBeVisible();
  });
});

test.describe('text models admin surface (signed out)', () => {
  test('/admin/text-models redirects a signed-out visitor away from the admin surface', async ({ request }) => {
    const response = await request.get(ROUTE.path, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()['location']).toMatch(/\/$/);
  });
});
