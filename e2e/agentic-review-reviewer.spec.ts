import { test, expect, type Page } from '@playwright/test';

/**
 * Reviewer-authenticated coverage of the /review workspace (Phase 9c, Unit 9L).
 *
 * Credentials come from the environment and are never committed. Set
 * E2E_REVIEWER_EMAIL / E2E_REVIEWER_PASSWORD (in .env.local, gitignored) to a
 * real, active row in agent_reviewers; without them these tests skip rather
 * than fail, exactly like e2e/agentic-admin.spec.ts's E2E_ADMIN_* pattern.
 */

const EMAIL = process.env.E2E_REVIEWER_EMAIL;
const PASSWORD = process.env.E2E_REVIEWER_PASSWORD;

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

test.describe('reviewer workspace (authenticated)', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_REVIEWER_EMAIL / E2E_REVIEWER_PASSWORD not set');

  test('the profile menu shows a reviewer badge and a Review queue link (D20)', async ({ page }) => {
    await signIn(page);

    // D20: reviewer standing rides the already-fetched pricing-runtime payload,
    // so this must render with no extra request -- opening the menu is enough,
    // there is nothing to wait on beyond what sign-in already loaded.
    await page.getByRole('button', { name: 'Account menu' }).click();

    const menu = page.getByRole('link', { name: 'Review queue' });
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('href', '/review');

    const badge = page.getByText(/^(Reviewer|Editor)$/);
    await expect(badge).toBeVisible();
  });

  // A forced timezone different from the dev server's own is what actually
  // reproduced the hydration error this unit fixed: formatDateTime rendered
  // "9 Sept 2026, 4:40 pm" server-side (the server process's local zone) and
  // "9 Sept 2026, 4:10 am" on the client once the browser's zone disagreed,
  // and React threw "Hydration failed because the server rendered text didn't
  // match the client." A test that leaves the browser's timezone at its
  // default would pass even with the bug present on any machine where the two
  // happen to already agree (as they do on a same-box dev setup) -- so this is
  // pinned far from any plausible server zone rather than left default.
  test.describe('with a browser timezone forced away from the server', () => {
    test.use({ timezoneId: 'Pacific/Kiritimati' });

    test('/review hydrates with no error, a sidebar, and no horizontal scroll', async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      await signIn(page);

      const response = await page.goto('/review', { waitUntil: 'load' });
      expect(response?.status()).toBeLessThan(400);

      await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();

      // Give React time to hydrate (and, before the fix, to throw and log).
      await page.waitForTimeout(2000);

      const hydrationErrors = pageErrors.filter((message) => /hydrat/i.test(message));
      expect(hydrationErrors, `Hydration error(s) on /review:\n${hydrationErrors.join('\n\n')}`).toEqual([]);

      // Section 4.2: the minimal reviewer sidebar -- Queue, My assignments, and
      // (Unit 9k) History -- and never AdminSidebar. History was asserted ABSENT
      // here until 9k shipped, which is exactly what this spec is for: the
      // carve-out was real, and its end is a visible change to this file rather
      // than a silent one.
      await expect(page.getByRole('link', { name: 'Queue' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'My assignments' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'History' })).toHaveAttribute('href', '/review/history');
      await expect(page.getByText(/admin/i)).toHaveCount(0);

      // Section 4.3: the table must not scroll horizontally at any width.
      const table = page.locator('table').first();
      if (await table.count()) {
        const overflow = await table.evaluate((el) => {
          let node: HTMLElement | null = el as HTMLElement;
          while (node) {
            if (node.scrollWidth > node.clientWidth + 1) return true;
            node = node.parentElement;
          }
          return false;
        });
        expect(overflow).toBe(false);
      }
    });

    // Unit 9k. Same forced timezone, for the same reason: this page renders a
    // timestamp per decision, which is the exact shape that threw a hydration
    // error on /review before FormattedDateTime existed.
    test('/review/history hydrates with no error and shows the reviewer their own decisions', async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      await signIn(page);

      const response = await page.goto('/review/history', { waitUntil: 'load' });
      expect(response?.status()).toBeLessThan(400);

      await expect(page.getByRole('heading', { name: 'My review history' })).toBeVisible();

      await page.waitForTimeout(2000);

      const hydrationErrors = pageErrors.filter((message) => /hydrat/i.test(message));
      expect(hydrationErrors, `Hydration error(s) on /review/history: ${hydrationErrors.join(' | ')}`).toEqual([]);

      // The page is legitimately empty on a database where this reviewer has
      // decided nothing, so the assertion is "one of the two honest states", not
      // "there are rows" -- a test that demanded rows would fail on a clean
      // environment for no real reason.
      const empty = page.getByText('You have not recorded a decision yet.');
      const list = page.getByRole('listitem');
      const hasRows = (await list.count()) > 0;
      if (!hasRows) await expect(empty).toBeVisible();

      // Whichever state it is, the reviewer sidebar came with it. `exact` matters:
      // the empty state's own prose links to the "review queue", which a substring
      // match on "Queue" also picks up.
      await expect(page.getByRole('link', { name: 'Queue', exact: true })).toBeVisible();
    });
  });
});
