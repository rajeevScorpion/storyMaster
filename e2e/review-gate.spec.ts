import { test, expect } from '@playwright/test';

/**
 * Route-gate coverage for /review (Phase 9b, Unit 9h).
 *
 * /review is gated by app/review/layout.tsx's requireReviewer(), which throws --
 * and redirect('/')s -- for anyone who isn't an active row in agent_reviewers (or
 * process.env.ADMIN_USER_ID). A signed-out visitor is the one case provable with
 * no credentials at all, which is exactly why it is in scope here rather than
 * deferred alongside the rest of Unit 9h's live verification. See
 * e2e/agentic-admin.spec.ts for the authenticated, admin-only coverage of the
 * sibling /admin/authors surfaces, which skips without
 * E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD.
 *
 * The first test mirrors smoke.spec.ts's "middleware keeps a signed-out visitor
 * out of /admin" almost exactly, one route over -- except this redirect comes
 * from app/review/layout.tsx's own requireReviewer() check, not from proxy.ts.
 * The second test follows the redirect and asserts on the rendered page, so a
 * regression that changed the status code but left the queue itself reachable
 * (or vice versa) cannot slip through either half alone.
 */

test('a signed-out visitor to /review is redirected away, never reaching the queue', async ({ request }) => {
  const response = await request.get('/review', { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers()['location']).toMatch(/\/$/);
});

test('following that redirect lands on the gallery, with no queue content ever rendered', async ({ page }) => {
  await page.goto('/review', { waitUntil: 'domcontentloaded' });

  // redirect('/') should have carried the browser back to the front door --
  // never left it sitting on /review, and never landed it on an error page.
  await expect(page).toHaveURL(/\/$/);

  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/review queue/i);
  expect(body).not.toMatch(/awaiting.review/i);
});
