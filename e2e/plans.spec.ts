import { test, expect, type Page } from '@playwright/test';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit G execution spec): the public plan
 * comparison at /plans. Signed-out only, matching every other spec in this directory -- the
 * signed-in CTA states (current plan, switch-after) are covered by
 * lib/pricing/plans-comparison.shared.test.ts instead.
 */

function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('/plans returns 200 and lists every public plan name', async ({ page }) => {
  const pageErrors = trackPageErrors(page);

  const response = await page.goto('/plans', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);

  // The table and the card layout both render at every viewport width (Tailwind toggles which is
  // hidden via CSS, not what's mounted) -- scoped to the desktop table here, which is visible at the
  // default Desktop Chrome viewport this project runs against.
  const table = page.getByTestId('plans-table');
  for (const name of ['Free', 'Audience', 'Plus', 'Studio']) {
    await expect(table.getByText(name, { exact: true }).first()).toBeVisible();
  }

  expect(pageErrors, `uncaught exceptions: ${pageErrors.join(' | ')}`).toEqual([]);
});

test('no card or table cell shows a paid plan at ₹0', async ({ page }) => {
  await page.goto('/plans', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('plans-table').getByText('Free', { exact: true }).first()).toBeVisible();

  await expect(page.locator('body')).not.toContainText('₹0');
});

test('never loads Razorpay on /plans', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await page.goto('/plans', { waitUntil: 'networkidle' });

  const razorpayRequests = requests.filter((url) => url.includes('razorpay'));
  expect(razorpayRequests, `unexpected Razorpay requests: ${razorpayRequests.join(', ')}`).toEqual([]);
});

test('the comparison table shows at desktop width', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/plans', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('plans-table').locator('table')).toBeVisible();
});

test('the table collapses into cards at phone width, with no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/plans', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('plans-table').locator('table')).toBeHidden();
  await expect(page.getByTestId('plans-cards').getByText('Free', { exact: true }).first()).toBeVisible();

  const hasHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(hasHorizontalScroll).toBe(false);
});
