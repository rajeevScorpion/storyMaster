import { test, expect, type Page } from '@playwright/test';

/**
 * Signed-out smoke tests over the surfaces a framework or bundler change is most
 * likely to break: the gallery front door, the authoring composer, the middleware
 * auth gate, the COOP/COEP headers ffmpeg.wasm needs, and the image optimizer.
 *
 * Signed-out on purpose — these must run without credentials in any environment.
 */

/** Collect uncaught exceptions; a page that throws is broken even if it paints. */
function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('the gallery is the front door and renders its hero', async ({ page }) => {
  const pageErrors = trackPageErrors(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveTitle(/Kissago/i);
  // The hero billboard's storyline title is the first h1 on the feed.
  await expect(page.locator('h1').first()).toBeVisible();
  expect(pageErrors, `uncaught exceptions: ${pageErrors.join(' | ')}`).toEqual([]);
});

test('/gallery still redirects to the front door', async ({ request }) => {
  const response = await request.get('/gallery', { maxRedirects: 0 });
  // Deliberately a 307, not a 308: a cached permanent redirect would make moving
  // the gallery back very hard. See docs/agent-context/GOTCHAS.md.
  expect(response.status()).toBe(307);
  expect(response.headers()['location']).toMatch(/\/$/);
});

test('cross-origin isolation holds, so ffmpeg.wasm keeps SharedArrayBuffer', async ({ page }) => {
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
  const headers = response?.headers() ?? {};

  expect(headers['cross-origin-embedder-policy']).toBe('credentialless');
  expect(headers['cross-origin-opener-policy']).toBe('same-origin');

  // The headers are the means; this is the property video export actually needs.
  const isolated = await page.evaluate(() => window.crossOriginIsolated);
  expect(isolated, 'crossOriginIsolated must be true or video export loses SharedArrayBuffer').toBe(true);
});

test('the authoring composer renders at /create', async ({ page }) => {
  const pageErrors = trackPageErrors(page);

  await page.goto('/create', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Kissago', level: 1 })).toBeVisible();
  await expect(page.getByPlaceholder(/Tell me a story/i)).toBeVisible();
  expect(pageErrors, `uncaught exceptions: ${pageErrors.join(' | ')}`).toEqual([]);
});

test('middleware keeps a signed-out visitor out of /admin', async ({ request }) => {
  const response = await request.get('/admin', { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers()['location']).toMatch(/\/$/);
});

test('the image optimizer serves gallery artwork', async ({ page }) => {
  const optimized: { url: string; status: number }[] = [];
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/_next/image')) optimized.push({ url, status: response.status() });
  });

  await page.goto('/', { waitUntil: 'networkidle' });

  expect(optimized.length, 'the gallery should request optimized images').toBeGreaterThan(0);
  const failed = optimized.filter((entry) => entry.status >= 400);
  expect(failed, `optimizer returned errors: ${JSON.stringify(failed.slice(0, 3))}`).toEqual([]);
});
