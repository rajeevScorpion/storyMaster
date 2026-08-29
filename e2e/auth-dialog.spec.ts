import { test, expect } from '@playwright/test';

/**
 * Signed-out coverage of the redesigned AuthDialog (Phase 6 of the legal/auth
 * UX pack): focus trap + Escape/focus-restore, the sign-up checkbox gate, and
 * that opening the linked Terms document never ticks the box on its own —
 * only an explicit Agree does. Scoped to `[role="dialog"]`/`[role="tab"]`
 * inside the dialog specifically, since the gallery hero's own carousel dots
 * also carry `role="tab"`.
 */

test('the auth dialog is a real accessible dialog with a focus trap', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: /sign in/i }).first().click();
  const dialog = page.locator('[role="dialog"]').first();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');

  const tabs = dialog.locator('[role="tab"]');
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  const activeText = await page.evaluate(() => document.activeElement?.textContent?.trim());
  expect(activeText).toMatch(/sign in/i);
});

test('sign-up requires the agreement checkbox before submitting', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: /sign in/i }).first().click();
  const dialog = page.locator('[role="dialog"]').first();
  await expect(dialog).toBeVisible();

  await dialog.locator('[role="tab"]').nth(1).click(); // switch to Create account

  const checkbox = dialog.locator('input[type="checkbox"]');
  await expect(checkbox).not.toBeChecked();

  await page.fill('#auth-email', 'e2e-test@example.com');
  await page.fill('#auth-password', 'password123');
  await page.fill('#auth-confirm-password', 'password123');
  await dialog.locator('button[type="submit"]').click();

  await expect(dialog.getByRole('alert')).toHaveText(/agree to the terms/i);
  await expect(checkbox).not.toBeChecked();
});

test('opening the Terms document does not tick the box; Agree does', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: /sign in/i }).first().click();
  const authDialog = page.locator('[role="dialog"]').first();
  await expect(authDialog).toBeVisible();
  await authDialog.locator('[role="tab"]').nth(1).click();

  const checkbox = authDialog.locator('input[type="checkbox"]');
  await authDialog.getByRole('button', { name: /Terms & End User Licence Agreement|Terms of Service/i }).first().click();

  const legalDialog = page.locator('[role="dialog"]').nth(1);
  await expect(legalDialog).toBeVisible();
  await expect(checkbox).not.toBeChecked();

  await page.getByRole('button', { name: 'Agree', exact: true }).click();
  await expect(legalDialog).toHaveCount(0);
  await expect(checkbox).toBeChecked();
});
