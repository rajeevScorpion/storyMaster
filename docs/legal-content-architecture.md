# Managed-Pages Content Architecture

Date: 2026-08-29
Scope: Prompt 03 of `prompt-packs/kissago_legal_ux_prompt_pack_2026-08-28/` (Phase 3 of the legal/auth UX pack)

This documents the CMS rendering and caching architecture as it exists today, and the specific problems it
replaced. The code described here already shipped (merged into `dev` as part of `feat/legal-auth-ux`,
commit `b2092ea`); this is the record of what was built and why, not a proposal.

---

## The problem this fixes

Before this work, `app/[slug]/page.tsx` was `export const dynamic = 'force-dynamic'`, and
`generateMetadata` and the page body each called the page loader independently with no per-request dedupe.
For a `public` page — 9 of the CMS's 11 pages — that meant, on every single request:

- Two full database round trips for the same row (once for metadata, once for the body).
- Two calls to `auth.getUser()` and a feature-flag lookup, even though a public page's visibility never
  depends on who's asking.
- No cross-request caching at all, so the tenth visitor to `/terms` in the same minute paid the same cost as
  the first.
- No `loading.tsx`, so a footer-link click held the previous page frozen on screen until the entire server
  render — auth check included — finished. This is the "nothing moves" symptom the pack's Prompt 01 audit
  flagged.

## What replaced it

**`lib/managed-pages/cache.ts`** — two independent caching layers, stacked:

1. **React `cache()`** — per-request dedupe. `generateMetadata` and the default export both call
   `getCachedAllowedManagedPageBySlug(slug)`; within one request this resolves to a single underlying call
   no matter how many call sites ask for it.
2. **`unstable_cache()`** — cross-request, 300-second revalidate, tagged `managed-pages`. This is the layer
   that makes the tenth visitor free.

**The public-page fast path.** `getCachedAllowedManagedPageBySlug` reads the cached row, and if
`accessLevel === 'public'`, returns immediately — `getCurrentManagedPageAccessContext()` (which calls
`auth.getUser()` and checks `pricing_snapshot_enabled`) is never invoked. Only the 2 of 11 pages that are
`authenticated` / `admin` / `billing_enabled_only` pay for that check, and it is deliberately **never**
cached — an access decision depends on who is asking, so caching it would leak one visitor's result to the
next visitor for the rest of the revalidate window. `lib/managed-pages/access.ts`'s `canViewManagedPage()` is
the pure decision function this path calls.

**`app/[slug]/page.tsx`** no longer declares `force-dynamic`. **`app/[slug]/loading.tsx`** exists as a
skeleton, so Next streams a visible placeholder the instant navigation starts instead of holding the previous
screen frozen.

**Write-side invalidation.** `app/actions/managed-pages.ts` calls `updateTag('managed-pages')` after every
save, reset-to-seed, or version publish — this is Next 16's read-your-own-writes primitive, so the admin who
just edited a page sees the change immediately without waiting out the 300-second window. Every other viewer
picks it up on the next revalidation.

## Qualitative before/after

| | Before | After |
|---|---|---|
| DB row fetches per request (public page) | 2 (metadata + body, no dedupe) | 1 within the first 300s window across *all* visitors, 0 after that until revalidation; 1 per request only on a cache miss |
| `auth.getUser()` calls per request (public page) | 2 | 0 |
| Feature-flag lookups per request (public page) | 2 | 0 |
| Cross-request caching | None (`force-dynamic`) | 300s, tag-invalidated on admin write |
| Visible feedback on navigation | None until full render | `loading.tsx` skeleton streams immediately |

No load-testing or timing capture was run to produce hard latency numbers — the fix is structural (query
count and auth-check count are what changed, and those are verifiable by reading the code path above), and
the qualitative win was confirmed by `npm run test:e2e` and manual navigation rather than a benchmark. If a
hard number is wanted later, the honest way to get one is `console.time` around
`getCachedAllowedManagedPageBySlug` compared before/after cache-hit, not a guess.

## Rendering: `lib/managed-pages/render.shared.tsx`

The parser is pure (no `server-only`, no IO) and unit-tested directly in `render.shared.test.tsx`. It handles:

- `#`–`####` headings (`##`/`###` get slugified anchor ids for the table of contents), horizontal rules,
  ordered and unordered lists, blockquotes, and pipe tables (wrapped in `overflow-x-auto`).
- Inline `` `code` ``, `**bold**`, and `[text](href)` — internal (`/`-prefixed) links render as `next/link`;
  everything else opens in a new tab via a plain `<a target="_blank" rel="noreferrer">`.
- **React elements and text nodes only.** No `dangerouslySetInnerHTML`, no markdown dependency, no sanitizer
  — content is XSS-safe by construction because it was never HTML to begin with. This property must survive
  any future change to this file.

`app/[slug]/page.tsx` renders a sticky table of contents (built from `extractManagedPageHeadingsFromContent`)
for `pageType === 'legal'` pages, plus a header card showing `doc_version`, `effective_date`, and
`updated_at`.

## Verification

- `npx tsc --noEmit`, `npm run lint`, `npm test` all clean as of this writing.
- `e2e/legal-pages.spec.ts` confirms `/terms` and `/privacy` actually render headings and bold text for a
  signed-out visitor (not just that the parser produces correct output in isolation).
- `e2e/navigation-progress.spec.ts` confirms the loading-feedback problem is fixed end-to-end: a footer-link
  click now visibly starts progress and the destination paints.
