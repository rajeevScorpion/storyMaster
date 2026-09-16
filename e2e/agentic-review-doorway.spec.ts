import { test, expect, type Page } from '@playwright/test';

/**
 * Unit 9M: the doorway between the review queue and the authoring screen.
 *
 * Credentials come from the environment and are never committed. Set
 * E2E_REVIEWER_EMAIL / E2E_REVIEWER_PASSWORD (in .env.local, gitignored) to a
 * real, active row in agent_reviewers; without them these tests skip rather
 * than fail, exactly like e2e/agentic-review-reviewer.spec.ts does.
 *
 * These are the proofs that reading the code cannot give: that the action is
 * actually reachable from the row menu, that the link it builds resolves to a
 * story the reviewer is allowed to open, and that the way back out is offered
 * once they are there.
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

  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
}

test.describe('the review queue doorway (authenticated reviewer)', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_REVIEWER_EMAIL / E2E_REVIEWER_PASSWORD not set');

  test('a queue row offers "Open in authoring", pointing at its own story', async ({ page }) => {
    await signIn(page);
    await page.goto('/review', { waitUntil: 'load' });

    await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();

    const rows = page.locator('tbody tr');
    test.skip((await rows.count()) === 0, 'nothing is awaiting review on this database');

    // The row menu is the ⋮ trigger, labelled for screen readers by RowActionsMenu.
    await page.getByRole('button', { name: /^Actions for run /i }).first().click();

    const open = page.getByRole('menuitem', { name: 'Open in authoring' });
    await expect(open).toBeVisible();

    // A link, not a button — so middle-click and open-in-new-tab still work — and
    // it carries the marker the authoring screen reads to offer a way back.
    const href = await open.getAttribute('href');
    expect(href).toMatch(/^\/story\/[0-9a-f-]{36}\?from=review$/);
  });

  test('the authoring screen offers a way back to the queue, and never a way to publish', async ({ page }) => {
    await signIn(page);
    await page.goto('/review', { waitUntil: 'load' });

    const rows = page.locator('tbody tr');
    test.skip((await rows.count()) === 0, 'nothing is awaiting review on this database');

    await page.getByRole('button', { name: /^Actions for run /i }).first().click();
    const href = await page.getByRole('menuitem', { name: 'Open in authoring' }).getAttribute('href');
    expect(href).toBeTruthy();

    // Loading a saved story pulls its beats and its first image before the
    // authoring screen replaces the open-flow loader, so this is deliberately
    // patient rather than instant.
    await page.goto(href!, { waitUntil: 'load' });
    // Scoped to the story header: the agent-draft panel further down the page has
    // its own link to /review, so an unscoped name match finds two.
    const back = page.getByRole('banner').getByRole('link', { name: 'Review queue' });
    await expect(back).toBeVisible({ timeout: 60_000 });
    await expect(back).toHaveAttribute('href', '/review');

    // The panel that replaces publishing, and says why (D15). Filtered to the visible
    // one because the ending actions are rendered twice by design — inline for mobile,
    // and as a right-hand column on desktop — so both copies are always in the DOM and
    // exactly one of them is showing at any given width.
    await expect(page.getByText('This is an agent draft.').filter({ visible: true })).toBeVisible();

    // D15: publishing an agent draft from here would credit it to the reviewer.
    // The queue's own Publish is the only correct path, and the server refuses
    // this one regardless — this asserts the UI does not even offer it.
    await expect(page.getByRole('button', { name: /^Publish/i })).toHaveCount(0);

    // And the way back actually goes back.
    //
    // The settle wait is load-bearing, and was measured rather than guessed: a click
    // taken while this screen is still pulling beats and painting its first image is
    // handled (next/link calls preventDefault) but its router transition is deferred
    // until the page stops being busy, so the URL does not change for many seconds.
    // That is App Router behaviour on a heavy client page, not a broken link -- the
    // same delay affects the Kissago logo, which predates this unit entirely. Clicking
    // after the screen quiets down is what a real reviewer does, and the generous
    // toHaveURL timeout covers the rest.
    await page.waitForTimeout(5_000);
    await back.click();
    await expect(page).toHaveURL(/\/review$/, { timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();
  });
});
