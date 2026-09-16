# Storyline sign-in return — plan

Branch: `fix/storyline-signin-return` (off `dev`). One committable unit. No migration, no feature flag.

## Problem

A signed-out visitor who picks a story on the gallery sees the full "opening story" loader, then a sign-in
card, and after signing in ends up on `/` instead of the story. Owner-reported on production and dev.
Owner decision (2026-09-16): the loader must not play for a signed-out visitor — ask for sign-in immediately.

## Verified current-state facts

- Gallery entry points for signed-out visitors are four `next/link` links to `/storyline/<id>`:
  `components/gallery/StorylineCard.tsx` (stretched link, `handleClick`), `StorylineCardPanel.tsx` (CTA,
  `onClick={() => onOpen()}`), `SeriesEpisodeList.tsx` (`onClick={() => onOpen(episode)}`), `GalleryHero.tsx`
  ("Start watching", `onClick={handleOpen}`). All four are client components. Clicking navigates, which shows
  `app/storyline/[id]/loading.tsx` (the open-flow loader) while the server page renders.
- `app/storyline/[id]/page.tsx` renders `StorylinePreview` when there is no user. The preview's button calls
  `openAuthDialog('sign_in', '/storyline/<id>')` — dropping `?token=` for unlisted links.
- `components/auth/AuthProvider.tsx` `finishAuthFlow`: when the return path equals the current path it only
  closes the dialog. Password sign-in (and instant sign-up) from the preview therefore leaves the server-rendered
  signed-out preview on screen; the visitor then clicks the logo / "Browse Gallery" and lands on `/`.
- `signUpWithPassword` hard-codes `emailRedirectTo` to `${origin}/`, so a confirmation email always lands on `/`
  and bypasses `app/auth/callback/route.ts` (and its terms-acceptance gate).
- `app/auth/callback/route.ts` falls back to `/` when the code exchange fails, discarding the sanitized `next`.
- Google sign-in already carries `next` through the callback correctly in code. If it still lands on `/` in an
  environment, that is Supabase Auth URL configuration (redirect falls back to Site URL) — dashboard, not code.
- `/story/[id]` and `/explore/[id]` are client pages that react to the user changing; not affected.
- `useAuth` lives at `lib/hooks/useAuth.ts`. Auth dialog inputs are `#auth-email` / `#auth-password`, submit is
  `button[type="submit"]` inside `[role="dialog"]`.

## Edits

1. **New `lib/hooks/useSignInBeforeWatching.ts`** (`'use client'`). Returns a callback
   `(event: React.MouseEvent, href: string) => boolean`. When auth has finished loading and there is no user,
   and the click is a plain primary click (no meta/ctrl/shift/alt, `button === 0`), it calls
   `event.preventDefault()`, `openAuthDialog('sign_in', href)` and returns `true`. Otherwise returns `false` and
   the link navigates normally (auth still loading → navigate; modifier clicks → new tab lands on the preview).

2. **Gate the four gallery links** with that hook, keeping each existing nav-meta write *before* the gate so the
   loader after sign-in still shows the right cover/title:
   - `StorylineCard.tsx` `handleClick`: after the touch-expand branch, `rememberNavMeta(); gate(event, href)`.
     The touch first-tap-expands behaviour must be unchanged.
   - `StorylineCardPanel.tsx` CTA and `SeriesEpisodeList.tsx` episode link: `onClick={(event) => { onOpen(...); gate(event, href); }}`.
   - `GalleryHero.tsx` "Start watching": `handleOpen` then gate.

3. **`components/story/StorylinePreview.tsx`**
   - New optional prop `shareToken?: string | null`; return path is `/storyline/<id>` plus
     `?token=<encoded>` when present. Pass `validatedShareToken` from `app/storyline/[id]/page.tsx`.
   - Auto-open the sign-in dialog once, as soon as auth has finished loading with no user (ref guard, same
     pattern as `app/explore/[id]/page.tsx`). The button keeps working to re-open it.
   - When a user appears, `window.location.reload()` so the server renders the signed-in player. Loop guard:
     a sessionStorage key per storyline holding a timestamp; skip the reload if one happened in the last
     10 seconds. Wrap storage access in try/catch.

4. **`components/auth/AuthProvider.tsx` `signUpWithPassword`**: `emailRedirectTo` becomes
   `${origin}/auth/callback?next=${encodeURIComponent(pendingReturnTo ?? '/')}`.

5. **`app/auth/callback/route.ts`**: the failure fallback redirects to `${origin}${next}` instead of `${origin}/`
   (`next` is already sanitized; default is `/`).

6. **`.env.example`**: add empty `E2E_VIEWER_EMAIL=""` / `E2E_VIEWER_PASSWORD=""` under the existing E2E block,
   with a one-line comment: any ordinary account. Real values live only in `.env.local`.

7. **New `e2e/storyline-signin-return.spec.ts`**. Resolve a storyline href from the gallery hero's
   "Start watching" link on `/`.
   - Signed out, no credentials: clicking "Start watching" opens `[role="dialog"]` and the pathname stays `/`.
   - Signed out, no credentials: `goto` the storyline href → the dialog opens by itself.
   - Credentials (`E2E_VIEWER_EMAIL`/`PASSWORD`, `test.skip` when absent): from `/`, click "Start watching",
     sign in → URL becomes the storyline href and the signed-in player renders (positive signal, e.g. the
     "Share storyline" control) with no "Sign in to experience this story" text.
   - Credentials: `goto` the storyline href signed out, sign in in the auto-opened dialog → same URL, player
     renders.

## Verification

`npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build:verify`, `npm run test:e2e` (full suite; stop the
agent dev server afterwards). Not provable automatically: email-confirmation landing (needs an inbox) and Google
(needs a real Google login) — owner checks those by hand.
