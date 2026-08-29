import { test, expect } from '@playwright/test';

/**
 * The site-wide progress bar (components/system/NavigationProgress.tsx) is
 * wired from a single capture-phase click listener with no per-link changes
 * needed, so a footer link is a representative click to prove it fires and
 * clears on a real navigation.
 */

test('the progress bar appears on a footer-link navigation and clears after it completes', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const bar = page.getByTestId('nav-progress-bar');
  await expect(bar).toHaveCSS('opacity', '0');

  await page.locator('footer').getByRole('link', { name: 'Terms', exact: true }).click();

  await expect(bar).toHaveCSS('opacity', '1');
  await expect(page).toHaveURL(/\/terms$/);
  await expect(bar).toHaveCSS('opacity', '0');
});

test('the progress bar does not fire for a same-page hash link', async ({ page }) => {
  await page.goto('/help-legal', { waitUntil: 'domcontentloaded' });

  const bar = page.getByTestId('nav-progress-bar');
  await expect(bar).toHaveCSS('opacity', '0');

  // Re-clicking the current page's own footer link is a no-op navigation --
  // shouldTrackAnchorClick() in NavigationProgress.tsx must leave it alone.
  await page.locator('footer').getByRole('link', { name: 'Help & Legal' }).click();
  await page.waitForTimeout(300);
  await expect(bar).toHaveCSS('opacity', '0');
});
