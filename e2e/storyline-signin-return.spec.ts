import { test, expect, type Page } from '@playwright/test';

/**
 * A signed-out visitor picking a story from the gallery used to ride the full
 * open-flow loader to a server-rendered sign-in preview, then land on / after
 * signing in -- never the story. Covers both entry points (clicking the
 * gallery hero's "Start watching" link, and opening a storyline URL directly)
 * and both directions: the credential-free half proves the dialog opens
 * immediately with no loader, the credentialed half (skips without
 * E2E_VIEWER_EMAIL / E2E_VIEWER_PASSWORD in .env.local, same pattern as
 * e2e/agentic-creation-mode-gate.spec.ts) proves sign-in actually returns to
 * the story and renders the signed-in player.
 */

const VIEWER_EMAIL = process.env.E2E_VIEWER_EMAIL;
const VIEWER_PASSWORD = process.env.E2E_VIEWER_PASSWORD;

async function getStorylineHref(page: Page): Promise<string> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const link = page.getByRole('link', { name: /start watching/i }).first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute('href');
  if (!href) throw new Error('Gallery hero "Start watching" link has no href');
  return href;
}

async function signInThroughDialog(page: Page, email: string, password: string): Promise<void> {
  const dialog = page.locator('[role="dialog"]').first();
  await expect(dialog).toBeVisible();
  await page.fill('#auth-email', email);
  await page.fill('#auth-password', password);
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
}

test('signed out: clicking "Start watching" opens sign-in without leaving the gallery', async ({ page }) => {
  await getStorylineHref(page);
  await page.getByRole('link', { name: /start watching/i }).first().click();

  await expect(page.locator('[role="dialog"]').first()).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('signed out: opening a storyline link directly opens sign-in by itself', async ({ page }) => {
  const href = await getStorylineHref(page);
  await page.goto(href, { waitUntil: 'domcontentloaded' });

  await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 15_000 });
});

test.describe('signing in returns to the storyline (authenticated)', () => {
  test.skip(!VIEWER_EMAIL || !VIEWER_PASSWORD, 'E2E_VIEWER_EMAIL / E2E_VIEWER_PASSWORD not set');

  test('from the gallery hero, sign-in lands on the storyline and renders the player', async ({ page }) => {
    const href = await getStorylineHref(page);
    await page.getByRole('link', { name: /start watching/i }).first().click();

    await signInThroughDialog(page, VIEWER_EMAIL!, VIEWER_PASSWORD!);

    await expect(page).toHaveURL(new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
    await expect(page.getByTitle('Share storyline')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Sign in to experience this story')).toHaveCount(0);
  });

  test('opening a storyline link directly, sign-in in the auto-opened dialog lands on the player', async ({ page }) => {
    const href = await getStorylineHref(page);
    await page.goto(href, { waitUntil: 'domcontentloaded' });

    await signInThroughDialog(page, VIEWER_EMAIL!, VIEWER_PASSWORD!);

    await expect(page).toHaveURL(new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
    await expect(page.getByTitle('Share storyline')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Sign in to experience this story')).toHaveCount(0);
  });
});
