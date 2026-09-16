import { test, expect, type Page } from '@playwright/test';

/**
 * Route-gate coverage for /story/[id] and /explore/[id] (Phase 10 Round 1, D24).
 *
 * Both routes are gated by app/story/[id]/layout.tsx and app/explore/[id]/layout.tsx,
 * which resolve access through assertCanEditStory (lib/agentic/reviewers.ts) --
 * owner or an authorized reviewer on an agent draft -- and redirect() everyone else
 * to a published storyline when one exists, '/' otherwise. Before this round neither
 * route had any server-side ownership check at all
 * (docs/agentic-creator-phase10-plan.md section 3.1): a non-owner got a fully
 * functional creation-mode editor on someone else's story.
 *
 * Layered the same way smoke.spec.ts / review-gate.spec.ts / agentic-admin.spec.ts
 * already are in this repo: a credential-free proof that needs no fixtures at all,
 * plus authenticated coverage that skips (never fails) without
 * E2E_ADMIN_EMAIL/PASSWORD and E2E_REVIEWER_EMAIL/PASSWORD in .env.local.
 */

// A syntactically valid UUID that matches no row. A signed-out visitor is refused
// before the layout ever queries the database (no `user` at all), so this only
// needs to be UUID-shaped, not real.
const NO_SUCH_STORY_ID = '00000000-0000-0000-0000-000000000000';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const REVIEWER_EMAIL = process.env.E2E_REVIEWER_EMAIL;
const REVIEWER_PASSWORD = process.env.E2E_REVIEWER_PASSWORD;

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /sign in/i }).first().click();

  const dialog = page.locator('[role="dialog"]').first();
  await expect(dialog).toBeVisible();

  await page.fill('#auth-email', email);
  await page.fill('#auth-password', password);
  await dialog.locator('button[type="submit"]').click();

  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
}

/**
 * The signed-in account's own first "My Stories" entry, or null when it has none.
 * Deliberately a plain, manually-authored story (never an agent draft -- those are
 * never owned by a human test account), so it carries no reviewer standing for
 * anyone but its literal owner.
 */
async function findFirstOwnStoryId(page: Page): Promise<string | null> {
  await page.goto('/create', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'My Stories' }).click();
  await expect(page.getByRole('heading', { name: 'Stories', level: 2 })).toBeVisible();

  const emptyState = page.getByText('No stories yet');
  // Story rows are the only buttons on /create's drawer with an <h3> title;
  // LandingScreen itself has none, so this is unambiguous without a test id.
  const firstRow = page.getByRole('button').filter({ has: page.locator('h3') }).first();

  await Promise.race([
    emptyState.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined),
    firstRow.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined),
  ]);
  if (await emptyState.isVisible().catch(() => false)) return null;
  if (!(await firstRow.isVisible().catch(() => false))) return null;

  await firstRow.click();
  await page.waitForURL(/\/story\/[0-9a-f-]{36}/, { timeout: 30_000 });
  const match = page.url().match(/\/story\/([0-9a-f-]{36})/);
  return match ? match[1] : null;
}

test.describe('signed-out visitor (no credentials needed)', () => {
  // Regression coverage (Phase 10 Round 1b, fix A). D24's layout originally threw on
  // `!user` and redirected before the page ever rendered -- but app/story/[id]/page.tsx
  // and app/explore/[id]/page.tsx already handle anonymity themselves by opening the
  // sign-in dialog with a return URL back to the story (page.tsx lines 56-61 / 50-53).
  // A signed-out visitor clicking a link to their OWN story was bounced to `/` instead
  // of being offered sign-in and returned. The layout must let an anonymous visitor
  // through and refuse only a *signed-in* non-owner; loadStory / loadStoryTree still
  // require a session and throw for an anonymous caller, so nothing leaks.
  test('is not redirected out of /story/[id] or /explore/[id] -- the layout lets an anonymous visitor through', async ({ request }) => {
    const storyResponse = await request.get(`/story/${NO_SUCH_STORY_ID}`, { maxRedirects: 0 });
    expect(storyResponse.status()).toBe(200);

    const exploreResponse = await request.get(`/explore/${NO_SUCH_STORY_ID}`, { maxRedirects: 0 });
    expect(exploreResponse.status()).toBe(200);
  });

  test('reaches the page and is offered sign-in with a return URL, rather than being bounced to /', async ({ page }) => {
    await page.goto(`/story/${NO_SUCH_STORY_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`/story/${NO_SUCH_STORY_ID}$`));
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 15_000 });

    await page.goto(`/explore/${NO_SUCH_STORY_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`/explore/${NO_SUCH_STORY_ID}$`));
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('owner vs. stranger, on a real story (authenticated)', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set');

  let ownedStoryId: string | null = null;

  test.beforeAll(async ({ browser }) => {
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return;
    const page = await browser.newPage();
    try {
      await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      ownedStoryId = await findFirstOwnStoryId(page);
    } finally {
      await page.close();
    }
  });

  test('the owner is not redirected out of their own /story/[id]', async ({ page }) => {
    test.skip(!ownedStoryId, 'the admin test account has no stories of its own to check');

    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await page.goto(`/story/${ownedStoryId}`, { waitUntil: 'load' });
    await expect(page).toHaveURL(new RegExp(`/story/${ownedStoryId}$`));
  });

  test('a signed-in stranger is redirected out of someone else\'s /story/[id] and /explore/[id]', async ({ page }) => {
    test.skip(!ownedStoryId, 'the admin test account has no stories of its own to check');
    test.skip(!REVIEWER_EMAIL || !REVIEWER_PASSWORD, 'E2E_REVIEWER_EMAIL / E2E_REVIEWER_PASSWORD not set');

    // The reviewer account is a real, different, signed-in user with no relation
    // to a plain (non-agent) story it does not own -- assertCanEditStory's
    // reviewer branch only ever applies to an agent-owned story, so this is a
    // genuine stranger, not merely "not the owner".
    await signIn(page, REVIEWER_EMAIL!, REVIEWER_PASSWORD!);

    await page.goto(`/story/${ownedStoryId}`, { waitUntil: 'load' });
    await expect(page).not.toHaveURL(new RegExp(`/story/${ownedStoryId}$`));

    await page.goto(`/explore/${ownedStoryId}`, { waitUntil: 'load' });
    await expect(page).not.toHaveURL(new RegExp(`/explore/${ownedStoryId}$`));
  });
});

test.describe('a reviewer opening an assigned agent draft (authenticated)', () => {
  test.skip(!REVIEWER_EMAIL || !REVIEWER_PASSWORD, 'E2E_REVIEWER_EMAIL / E2E_REVIEWER_PASSWORD not set');

  test('is not redirected out of /story/[id]', async ({ page }) => {
    await signIn(page, REVIEWER_EMAIL!, REVIEWER_PASSWORD!);
    await page.goto('/review', { waitUntil: 'load' });

    const rows = page.locator('tbody tr');
    test.skip((await rows.count()) === 0, 'nothing is awaiting review on this database');

    // Same row-menu path e2e/agentic-review-doorway.spec.ts already proves is
    // reachable; this asserts the destination itself survives the new layout gate.
    await page.getByRole('button', { name: /^Actions for run /i }).first().click();
    const href = await page.getByRole('menuitem', { name: 'Open in authoring' }).getAttribute('href');
    expect(href).toBeTruthy();

    await page.goto(href!, { waitUntil: 'load' });
    await expect(page).toHaveURL(/\/story\/[0-9a-f-]{36}(\?|$)/, { timeout: 30_000 });

    // The agent-draft panel only renders once the authoring screen actually loaded
    // the story -- proof this is the real editor, not a page that merely kept the
    // URL. Filtered to the visible copy: the ending actions render twice by design
    // (inline for mobile, a right-hand column for desktop).
    await expect(page.getByText('This is an agent draft.').filter({ visible: true })).toBeVisible({ timeout: 60_000 });
  });
});
