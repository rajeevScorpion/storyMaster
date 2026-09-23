import { test, expect } from '@playwright/test';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit C): keyboard support for the shared
 * `FilterDropdown`, exercised on the one signed-out surface that already renders it -- the
 * gallery's filter bar (`components/gallery/GalleryFilters.tsx`, via `GallerySearchPanel`).
 * `?q=` (even empty) puts the gallery in search mode, which is where the desktop filter row
 * lives (`lib/gallery/search-params.ts`'s `isSearchOpen`) -- no sign-in and no extra clicks
 * needed to reach it.
 *
 * NOTE for the reviewer: not run by the executing agent (it would need to start a dev server,
 * which conflicts with another agent working in this tree). Run with `npm run test:e2e
 * e2e/filter-dropdown.spec.ts` to verify.
 */

test('keyboard opens the Genre dropdown, moves the highlight, and selects an option', async ({ page }) => {
  await page.goto('/?q=', { waitUntil: 'domcontentloaded' });

  const trigger = page.getByRole('button', { name: 'Genre' });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toContainText('All Genres');

  // Keyboard-only: focus the trigger without a click, then open with ArrowDown.
  await trigger.focus();
  await trigger.press('ArrowDown');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');

  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  await expect(listbox.getByRole('option')).toHaveCount(9); // "All Genres" + 8 genres

  // Highlight starts on the selected option ("All Genres", index 0); one ArrowDown moves to
  // "Adventure" (index 1). Enter selects it and closes the menu.
  await trigger.press('ArrowDown');
  await trigger.press('Enter');

  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toContainText('Adventure');
  await expect(listbox).toBeHidden();
});

test('Escape closes the dropdown without changing the selection and returns focus to the trigger', async ({ page }) => {
  await page.goto('/?q=', { waitUntil: 'domcontentloaded' });

  const trigger = page.getByRole('button', { name: 'Genre' });
  await trigger.focus();
  await trigger.press('Enter'); // open
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');

  await trigger.press('ArrowDown');
  await trigger.press('Escape');

  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toContainText('All Genres'); // unchanged
  await expect(trigger).toBeFocused();
});
