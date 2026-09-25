import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * Payments Phase 8 (docs/payments/phase-8-plan.md §4 B): the billing details dialog saves a US address.
 *
 * Signed in, and it rewrites that account's billing profile, so it needs a throwaway account:
 * E2E_BILLING_USER_EMAIL / E2E_BILLING_USER_PASSWORD in .env.local (gitignored). Without them it skips.
 * The country picker only appears while `billing_international_countries` is on, so on an environment
 * where it is off the test skips with that reason rather than failing. It leaves the account on an India
 * address (the test's own, not whatever was there before).
 */

const EMAIL = process.env.E2E_BILLING_USER_EMAIL;
const PASSWORD = process.env.E2E_BILLING_USER_PASSWORD;

async function signIn(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /sign in/i }).first().click();
  const dialog = page.locator('[role="dialog"]').first();
  await expect(dialog).toBeVisible();
  await page.fill('#auth-email', EMAIL!);
  await page.fill('#auth-password', PASSWORD!);
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
}

async function openBillingDialog(page: Page): Promise<Locator> {
  await page.goto('/account/billing', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^(edit|add billing details)$/i }).first().click({ timeout: 60_000 });
  const dialog = page.locator('[role="dialog"]').filter({ hasText: 'Billing details' }).first();
  await expect(dialog).toBeVisible();
  return dialog;
}

async function pick(page: Page, dialog: Locator, trigger: string, option: RegExp): Promise<void> {
  await dialog.getByRole('button', { name: trigger }).click();
  const search = page.getByRole('combobox', { name: new RegExp(`search ${trigger}`, 'i') });
  if (await search.isVisible().catch(() => false)) await search.fill(option.source.replace(/[\^$]/g, ''));
  await page.getByRole('option', { name: option }).first().click();
}

const field = (dialog: Locator, name: string) => dialog.locator(`[id$="-${name}"]`).first();

test.describe('billing details: a US address', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_BILLING_USER_EMAIL / E2E_BILLING_USER_PASSWORD not set');

  test('switches to the US form, refuses bad input, saves, and goes back to India', async ({ page }) => {
    await signIn(page);
    let dialog = await openBillingDialog(page);

    const countryPicker = dialog.getByRole('button', { name: 'Billing country' });
    await page.waitForTimeout(2000); // the country list is fetched when the dialog opens
    test.skip(!(await countryPicker.isVisible()), 'billing_international_countries is off on this environment');

    await pick(page, dialog, 'Billing country', /^united states$/i);

    // The India-only fields are gone for a foreign address.
    await expect(dialog.getByRole('tablist', { name: 'Personal or business' })).toHaveCount(0);
    await expect(field(dialog, 'gstin')).toHaveCount(0);

    await field(dialog, 'legalName').fill('E2E Billing');
    await field(dialog, 'billingEmail').fill('delivered@resend.dev');
    await field(dialog, 'phone').fill('123');
    await pick(page, dialog, 'Billing state', /^texas$/i);
    await field(dialog, 'city').fill('Austin');
    await field(dialog, 'postalCode').fill('ABCDE');
    await dialog.getByRole('button', { name: /^save/i }).click();

    // Still open, with both bad fields flagged.
    await expect(dialog).toBeVisible();
    await expect(field(dialog, 'phone')).toHaveAttribute('aria-invalid', 'true');
    await expect(field(dialog, 'postalCode')).toHaveAttribute('aria-invalid', 'true');

    await field(dialog, 'phone').fill('(512) 555-0142');
    await field(dialog, 'postalCode').fill('78701');
    await field(dialog, 'addressLine1').fill('100 Congress Avenue');
    await dialog.getByRole('button', { name: /^save/i }).click();
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText(/Austin/).first()).toBeVisible();

    // Reopening shows the saved US address, then put the account back on India.
    dialog = await openBillingDialog(page);
    await expect(dialog.getByRole('button', { name: 'Billing country' })).toContainText(/united states/i);
    await expect(field(dialog, 'postalCode')).toHaveValue('78701');

    await pick(page, dialog, 'Billing country', /^india$/i);
    await field(dialog, 'phone').fill('98765 43210');
    await pick(page, dialog, 'Billing state', /^maharashtra$/i);
    await field(dialog, 'city').fill('Mumbai');
    await field(dialog, 'postalCode').fill('400001');
    await dialog.getByRole('button', { name: /^save/i }).click();
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText(/Mumbai/).first()).toBeVisible();
  });
});
