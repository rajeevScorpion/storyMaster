import { test, expect, type Page } from '@playwright/test';

/**
 * Reviewer-authenticated coverage of the /review workspace (Phase 9c, Unit 9L;
 * Phase 10 Round 3).
 *
 * Credentials come from the environment and are never committed. Set
 * E2E_REVIEWER_EMAIL / E2E_REVIEWER_PASSWORD (in .env.local, gitignored) to a
 * real, active row in agent_reviewers; without them these tests skip rather
 * than fail, exactly like e2e/agentic-admin.spec.ts's E2E_ADMIN_* pattern.
 *
 * This spec deliberately does NOT assume which role ('reviewer' or 'editor') the
 * configured E2E account holds. Round 3's 5.2 (queue scoping) and 5.3 (sidebar nav)
 * are both role-dependent, so the assertions that care read the role off the
 * profile-menu badge first and branch, rather than hardcoding either shape --
 * E2E_REVIEWER_EMAIL/PASSWORD are credentials, never role data, and this file must
 * never inspect them for anything beyond signing in.
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

/**
 * Opens the profile menu, reads the reviewer role badge ("Reviewer" or "Editor"),
 * and closes the menu again by clicking the trigger a second time. Round 3's 5.2
 * and 5.3 both branch on which role the configured E2E account holds, and reading
 * it off the badge -- the same D20 payload UserMenu itself renders from -- is the
 * only way this spec can branch correctly without assuming either shape.
 */
async function readReviewerRoleLabel(page: Page): Promise<'Reviewer' | 'Editor'> {
  const trigger = page.getByRole('button', { name: 'Account menu' });
  await trigger.click();
  const badge = page.getByText(/^(Reviewer|Editor)$/);
  await expect(badge).toBeVisible();
  const label = ((await badge.textContent()) ?? '').trim() as 'Reviewer' | 'Editor';
  await trigger.click();
  await expect(badge).toHaveCount(0);
  return label;
}

test.describe('reviewer workspace (authenticated)', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_REVIEWER_EMAIL / E2E_REVIEWER_PASSWORD not set');

  test('the profile menu shows a reviewer badge, a Review queue link, and an honest count bubble (D20, 5.4)', async ({ page }) => {
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

    // 5.4: assignedCount rides the same payload and is never shown as a "0" bubble
    // -- rendering nothing IS what a zero count maps to. This spec cannot assert an
    // exact value (it depends on live agent_review_assignments state for whichever
    // account E2E_REVIEWER_EMAIL points at), but whatever DOES render inside the
    // link must be a genuine positive integer, never a literal "0" or an empty
    // pill. The bubble is aria-hidden (the link carries an explicit aria-label
    // instead, see UserMenu.tsx), so it is queried as a plain DOM node, not by role.
    const bubble = menu.locator('span[aria-hidden="true"]');
    if (await bubble.count()) {
      const text = (await bubble.first().textContent())?.trim() ?? '';
      expect(text).toMatch(/^\d+$/);
      expect(Number(text)).toBeGreaterThan(0);
    }
  });

  test('the header links home from /review (5.1)', async ({ page }) => {
    await signIn(page);
    await page.goto('/review', { waitUntil: 'domcontentloaded' });

    // Scoped to the header landmark: "Review queue" (agent-draft panel link) and
    // "Queue" (sidebar item / empty-state prose) both appear more than once on this
    // page, but the Kissago logo and the account menu trigger only ever live in the
    // banner -- see this file's own header for the ambiguity this project's specs
    // are known to hit.
    const banner = page.getByRole('banner');
    const logoLink = banner.getByRole('link', { name: 'kissago' });
    await expect(logoLink).toBeVisible();
    await expect(logoLink).toHaveAttribute('href', '/');

    // The rest of the profile menu is reachable too -- the whole point of 5.1 was
    // that a reviewer previously had no way back to either of these.
    await expect(banner.getByRole('button', { name: 'Account menu' })).toBeVisible();

    await logoLink.click();
    await expect(page).toHaveURL(/\/$/);
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
      const roleLabel = await readReviewerRoleLabel(page);

      const response = await page.goto('/review', { waitUntil: 'load' });
      expect(response?.status()).toBeLessThan(400);

      await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();

      // Give React time to hydrate (and, before the fix, to throw and log).
      await page.waitForTimeout(2000);

      const hydrationErrors = pageErrors.filter((message) => /hydrat/i.test(message));
      expect(hydrationErrors, `Hydration error(s) on /review:\n${hydrationErrors.join('\n\n')}`).toEqual([]);

      // Section 4.2: the minimal reviewer sidebar -- Queue and (Unit 9k) History
      // always; "My assignments" only for role 'editor' (Phase 10 Round 3, 5.3 --
      // retired for a plain reviewer, since their queue is already scoped to their
      // own assignments and the two links would show the same list). Never
      // AdminSidebar.
      await expect(page.getByRole('link', { name: 'Queue', exact: true })).toBeVisible();
      const myAssignments = page.getByRole('link', { name: 'My assignments' });
      if (roleLabel === 'Editor') {
        await expect(myAssignments).toBeVisible();
      } else {
        await expect(myAssignments).toHaveCount(0);
      }
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
