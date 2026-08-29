import { test, expect } from '@playwright/test';

/**
 * Signed-out coverage of the Phase 3/7 legal document rendering: the CMS
 * renderer (lib/managed-pages/render.shared.tsx) actually produces headings,
 * bold text and links for a real published document, not just for the
 * synthetic fixtures in render.shared.test.tsx.
 */

test('/terms renders as a legal document for a signed-out visitor', async ({ page }) => {
  const response = await page.goto('/terms', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBeLessThan(400);

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('h2').first()).toBeVisible();
  await expect(page.locator('strong').first()).toBeVisible();
});

test('/privacy renders as a legal document for a signed-out visitor', async ({ page }) => {
  const response = await page.goto('/privacy', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBeLessThan(400);

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('h2').first()).toBeVisible();
});

test('the footer links to Terms and Privacy, and /help-legal lists all documents', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const footer = page.locator('footer');
  await expect(footer.getByRole('link', { name: 'Terms', exact: true })).toHaveAttribute('href', /\/terms$/);
  await expect(footer.getByRole('link', { name: 'Privacy', exact: true })).toHaveAttribute('href', /\/privacy$/);

  await footer.getByRole('link', { name: 'Help & Legal' }).click();
  await expect(page).toHaveURL(/\/help-legal$/);
  // Regexes specific enough not to also match the page's own footer, which is
  // still on screen with its own plain "Terms"/"Privacy" links.
  await expect(page.getByRole('link', { name: /Terms of Service/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Privacy Policy/i })).toBeVisible();
});
