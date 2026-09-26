# Story consumption path — research for daily quota

Read-only discovery for a daily story-consumption quota (3 unique stories/day free, unlimited on paid
plans, signed-out gated at sign-in, never spends creation coins, server-side + race-safe). Branch
`payments`, 2026-09-17.

## 1. Entry points

**`/storyline/[id]` is the only real non-owner reading surface today.** Every gallery/discovery link
points here:
- `components/gallery/StorylineCard.tsx:229` `href={`/storyline/${item.id}`}`
- `components/gallery/GalleryHero.tsx:271`
- `components/gallery/SeriesEpisodeList.tsx:41` (series episode list — same route)

`/explore/[id]` and `/story/[id]` are gated **owner-or-reviewer only** as of Phase 10 Round 1 (D24):
`app/explore/[id]/layout.tsx:32-60` and `app/story/[id]/layout.tsx:38-66` both call
`assertCanEditStory` and redirect a signed-in non-owner to `resolveNonOwnerRedirectTarget`, which sends
them to `/storyline/[id]` (or `/`) — see GOTCHAS "shared branching is dormant, not deleted (D23)". So a
signed-in stranger cannot reach these two routes for someone else's story at all; they are creation/authoring
surfaces, not discovery-consumption ones.

**Route shape:**
- `/gallery`, `/gallery/kids` — `app/page.tsx` / `app/gallery/kids/page.tsx`, both server components
  (`getGalleryRails`, `getGalleryItems`), no beat content, just cards linking to `/storyline/[id]`.
- `/storyline/[id]` — `app/storyline/[id]/page.tsx` is an RSC. It resolves the storyline row itself
  (RLS: public or owner, plus a validated `?token=` for `visibility: 'unlisted'`, lines 152-176), computes
  `isOwner` (line 200) and `isSaved`/`isLiked`/series context, then renders the client component
  `StorylinePersistenceLoader` (`components/story/StorylinePersistenceLoader.tsx`).
- `StorylinePersistenceLoader` races a local IndexedDB read (`loadCachedStoryline`,
  `lib/persistence/runtime.ts:123`) against the authoritative network call
  `loadStorylineWithBeats(storylineId, { shareToken })` (`app/actions/exploration.ts:440`), a `'use server'`
  action. This is where beats, choices, and **signed** R2/Supabase media URLs are actually produced —
  `signStorylineBeatsUrls` (line 599/636) mints time-limited signed URLs, not permanent public ones, so a
  client cannot bypass a gate here by hitting a stored asset URL directly; a signature must be re-minted
  through this action (or `refreshStorylineSignedUrls`, line 689, for a mid-read refresh of an already-loaded
  story — not a new consumption).
- Once `loadStorylineWithBeats` resolves, the payload renders in `StorylinePlayer` (client component),
  which is also where `recordView`/`recordStorylineProgress` fire (see §3) and where narration
  (`useAudioPlayer`) and video export (`useStoryVideoExport`, `VideoExportDialog`,
  `authorizeCurrentUserVideoExport` in `app/actions/video-export.ts:84`) live.

**Reels / vertical video / series / narration / video export are not separate consumption routes.**
- Vertical ("reel-shaped") storylines are just `storylines.aspect_ratio === '9:16'`, played through the
  same `StorylinePlayer` — confirmed by `openKind = openMeta?.kind === 'reel' ? 'reel' : 'story'` in
  `app/story/[id]/page.tsx:39`, which only changes the *loading-screen skin*, not the content path — and
  `MyStoriesDrawer.tsx:112` (`kind: 'reel'`) navigates the owner to their own `/story/[id]`, not a
  distinct public route.
- Series/episodes: each episode is its own `stories` row and its own published `storylines` row, grouped
  by `storylines.series_id` (migration `093_storyline_series.sql`). `SeriesEpisodeList.tsx` links each
  episode to its own `/storyline/[episodeStorylineId]` — so "open episode 2" is exactly "open a
  different storyline," no special-cased route.
- Narration playback is embedded audio inside `StorylinePlayer` (`useAudioPlayer`), sourced from the same
  `beats[].audioUrl` signed URL — no standalone narration route.
- Video export (`app/actions/video-export.ts`) renders client-side (ffmpeg.wasm/Mediabunny) from beats
  already loaded by the player; it is a downstream export of a story already opened, not a separate way to
  consume one, and it is its own coin-metered action (`authorizeCurrentUserVideoExport`) — out of scope for
  this quota, but note it is **not** creation-coin spend either.
- No embed/share route exists beyond `/storyline/[id]?token=…` for unlisted links
  (`grep -rl embed app` found nothing under `app/`); `app/api` has no public content-serving route for
  stories (only admin backfills, batch workers, billing, R2 presign, `storyline-og` for OG images).

**Gaming surface from client-side caching:** `StorylinePersistenceLoader`'s effect (lines 43-134) shows the
cached IndexedDB payload if the network call fails or is slower, and — importantly — **on a network error it
falls back to whatever cached payload exists, if any** (lines 115-120: `if (active && !hasDisplayedPayload &&
!cached) setError(...)`, i.e. an error is only surfaced when there is *no* cache). If a quota check is added
inside `loadStorylineWithBeats` and it throws `quota_exceeded`, a story the user cached on a **previous** day
(and has not yet opened today) would still render from the stale IndexedDB copy instead of surfacing the
paywall — see the Recommendation for why the gate should sit above this loader, not only inside the action.

## 2. Unit of "a story"

**`stories.id` (a `story_id`) is the right key, not `storylines.id`.** Evidence the product already treats
`story_id` as "the same story":
- GOTCHAS: *"Rails dedupe by story (`dedupeByStory`): republishing creates a new storyline row per story, so
  without it the same story appears 2–3x in a rail."*
- `app/actions/gallery.ts:860` `dedupeByStory(items)` keys on `item.storyId || item.id` — used for the New
  rail, Continue Watching, and My List (`app/actions/gallery.ts:1161,1191,1201`).
- `app/actions/gallery.ts:1156-1159` comment: *"`dedupeByStory` keys on the story, so it never touches
  sibling episodes — each is a separate story."*

So: one `stories` row = one unit a viewer perceives as "a story" (each series episode is its own `stories`
row, confirmed by migration `093_storyline_series.sql`'s backfill joining `storylines.story_id = stories.id`
and copying `episode_number`/`series_id` from the *story*). A single story republished later produces a
**new `storylines.id`** for the **same `story_id`** — counting by `storyline_id` would let an author's
republish silently grant every past reader a "new" story for free (harmless to the business) but would also
mean two different storyline rows for what a viewer experienced as one story; `story_id` avoids this
ambiguity and matches the identity already used for "same story" everywhere else in the app (dedup, rails,
`explored_stories.story_id` in migration `003_normalize_beats.sql`).

`loadStorylineWithBeats` already returns `storyline.story_id` (`app/actions/exploration.ts:604`), so the
quota key is available for free at the exact enforcement point identified in §1.

## 3. Existing view/play/progress/analytics recording

Nothing today is a *daily* counter — everything is lifetime-unique per (user, storyline):

- **`storyline_views`** (migration `007_storyline_likes_views.sql:16-22`): `UNIQUE(user_id, storyline_id)`,
  written by `recordView()` (`app/actions/engagement.ts:107-120`) via
  `.upsert(..., { onConflict: 'user_id,storyline_id', ignoreDuplicates: true })` — a pure "have they ever
  opened this" flag with a trigger-maintained `storylines.view_count` cache (lines 62-74). Called from
  `StorylinePlayer.tsx:415-419` on mount, gated only on `isLoggedIn` (**not** on `isOwner`) — the owner's own
  view of their own storyline is recorded too, just not consulted anywhere as a limit today.
- **`storyline_progress`** (migration `090_storyline_progress.sql`): `UNIQUE(user_id, storyline_id)`,
  `current_beat_index`, `completed`/`completed_at`. Written by `recordStorylineProgress()`
  (`app/actions/engagement.ts:73-104`) from `StorylinePlayer.tsx:586-596`, **on page turns only** (not every
  audio tick — deliberately throttled). The migration's own comment (lines 8-18) defines "started" as
  `current_beat_index >= 1` specifically so an accidental single tap that leaves immediately does not count —
  directly relevant precedent for §4.
- **`storyline_likes`**: unrelated to consumption, listed for completeness (`app/actions/engagement.ts:5-49`).
- **`explored_stories`** (migration `003_normalize_beats.sql:57-65`): `UNIQUE(user_id, story_id)`,
  `last_node_id`, `explored_at`/`updated_at` — written by `trackExploration()`
  (`app/actions/exploration.ts:366`), called only from `lib/store/story-store.ts:5237` inside the
  `/explore/[id]` flow. Since `/explore/[id]` is now owner-or-reviewer only (D24), this table records
  reviewer/owner tree exploration, not organic reader consumption — not a source for the new quota, but
  structurally it is the closest existing precedent for a `(user_id, story_id)`-keyed table.

**None of these are day-bucketed or race-safe for a hard limit** — `storyline_views` is lifetime-unique
(no day column, `ignoreDuplicates: true` never re-fires after the first visit ever), so it cannot answer "how
many *distinct* stories today." A new table (or a new column/index) is needed; see Recommendation.

## 4. Candidate "consumed" moments

| Moment | Signal today | Gameable / fragile |
|---|---|---|
| Page open (`/storyline/[id]` RSC render) | None recorded; RLS/auth check only | Accidental click / `<Link>` prefetch / crawler would burn a slot with zero reading intent |
| `loadStorylineWithBeats` resolves (beats+media fetched) | Nothing recorded here today; the actual gated data fetch | Proves content was served, but fires before the reader sees anything, and on every retry |
| `recordView` fires (`StorylinePlayer` mount, `isLoggedIn` only) | **Recorded**, lifetime-unique | Fires once beats+first-page media are loaded (`preloadStorylineMedia` awaited first, `StorylinePersistenceLoader.tsx:84-107`) — no confirmation the reader saw more than beat 0 |
| First page turn / `current_beat_index >= 1` | **Recorded** via `recordStorylineProgress`, only on a page turn, by design (migration 090 comment: avoid counting "opened and immediately left") | Requires one page turn; opening and reading beat 0 without turning the page would not count |

No playback-start or narration-specific event exists separately from the above.

## 5. Kids mode vs account

Kids mode is **not** a separate account or profile with its own quota surface today. It is a catalogue
filter only: `app/gallery/kids/page.tsx` calls `getGalleryItems(..., 'kids')` /
`getGalleryRails('kids')`, which filter `storylines.age_group` (migration 089) —
`app/actions/gallery.ts:933,975,1451`. The *same* `auth.users` session is used; `getSavedStorylineIds()`
(no mode argument) is called identically in both `app/page.tsx:64` and `app/gallery/kids/page.tsx:47`.

Migration `091_viewer_profiles.sql` adds a `viewer_profiles` table (`account_id -> auth.users`) as a
**foundation only** — its own comment (lines 11-16) says it deliberately does *not* move saved
storylines/progress under a profile, and there is no code path yet that reads or writes it for gallery
scoping (`resolveEffectiveAudienceMode`, referenced in the migration comment, is the query-layer switch, and
it operates on the account/session, not a viewer-profile row). **So a kids-mode read today debits the same
account as an adult-mode read** — there is no household/child sub-identity to exempt or separately budget.
This is a genuine open question for a family-shared login (see Open Questions).

## 6. Timezone / daily reset boundary

**No user timezone or locale is stored anywhere.** `grep -rniE "timezone|Asia/Kolkata|IANA"` across
`supabase/migrations/*.sql` returns nothing; the only `Asia/Kolkata` in the whole codebase is a hardcoded
display format in `app/account-restricted/page.tsx:13` for a moderation-ban message, unrelated to daily
resets and not read from any per-user field.

**Existing UTC-day precedent:** `dayOfYearUtc()` in `app/actions/gallery.ts:1187-1191` computes
`Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())` to rotate the gallery hero once per
UTC calendar day, explicitly "stable across reloads." This is the only existing "day boundary" logic in the
app, and it is UTC, not IST or per-user local time — the natural default to mirror for a quota reset unless
the owner wants IST specifically (Kissago's primary market).

## 7. Owner's own stories / drafts

Already fully solved by existing plumbing, just needs to be *read* by the quota:
- `app/storyline/[id]/page.tsx:200` computes `const isOwner = user.id === storyline.user_id;` server-side
  and threads it through `StorylinePersistenceLoader` → `StorylinePlayer` as a boolean prop — this is the
  exact signal to skip quota consumption for the owner reading their own (published or, via the "Users can
  view own storylines" RLS policy in `001_initial_schema.sql:115-117`, unpublished/draft) storyline.
- `recordView`/`recordStorylineProgress` do **not** currently check `isOwner` — they fire for the owner too
  (harmless today since nothing reads them as a limit); a quota implementation must add the `isOwner` check
  explicitly rather than assume it's already excluded.
- Draft/unpublished reading only happens through `/story/[id]` (owner-or-reviewer gated, §1) — never through
  `/storyline/[id]`'s public path — so the quota's single enforcement point naturally never sees draft
  content for anyone but the owner/reviewer, who should be exempt anyway (creation-mode, not "watching").

## 8. Existing atomic counter / rate-limit patterns

The coin-spend reservation system is the direct precedent for a race-safe per-user daily counter, in
`supabase/migrations/021_pricing_enforcement_primitives.sql`:
- `pricing_authorize_spend(...)` (lines 26-146): a `plpgsql` function that locks the user's relevant rows
  with `FOR UPDATE` (lines 74-93, 95-105) inside one transaction, computes an available balance, and only
  then inserts a new `beat_spend_reservations` row — the check-then-insert race is closed by doing both
  inside the same locked transaction, not by a client-side check followed by a separate insert.
- `pricing_finalize_reservation` / `pricing_release_reservation` (lines 148-348) show the
  reserve → finalize/release shape `finalizeCurrentUserBillableAction` /
  `releaseCurrentUserBillableAction` wrap in `app/actions/pricing-enforcement.ts:230-263`.
- Idempotency: `pricing_authorize_spend` looks up an existing reservation by `(user_id, idempotency_key)`
  first (lines 59-72) and returns it unchanged if found — the pattern for "opening the same story twice in
  quick succession/two tabs must not double-count."
- Plan/entitlement lookup: `resolveEntitlementPlanKeyForUser(userId)` (`lib/pricing/enforcement.ts:630-642`)
  is the existing helper for "what tier is this user on" (fails closed to `'free'` on any error — a property
  worth preserving or deliberately inverting for a quota, since failing closed to `'free'` here means failing
  closed to *enforcing* the limit, not bypassing it). `PLAN_KEYS = ['free', 'plus', 'studio']`
  (`lib/types/pricing.ts:15`) — no `'audience'` key exists yet in code, consistent with it being a new plan
  the payments effort is introducing.
- Admin-configurable numeric settings precedent: `PRICING_RUNTIME_SETTING_DEFINITIONS`
  (`lib/types/pricing.ts:142`) is the existing shape for an admin-editable numeric runtime value (read
  through `lib/ai/model-config.ts`/`feature_flags` per CLAUDE.md's "Feature flags" section) — the natural
  home for an admin-configurable "3 stories/day" number, following the "fail closed when the flag/migration
  is absent" rule already in CLAUDE.md.

## Recommendation

**Enforcement point:** primary gate in `app/storyline/[id]/page.tsx` (the RSC), immediately after `isOwner`
is computed (line 200) and before rendering `StorylinePersistenceLoader` — a signed-in, non-owner,
non-unlimited-plan viewer who has not already been granted today's slot for this `story_id` sees a
paywall/upsell screen instead of the player, so the client-side IndexedDB fallback described in §1 never
gets a chance to serve stale content. Add a defense-in-depth check inside `loadStorylineWithBeats`
(`app/actions/exploration.ts:440`) too, since it is the one place that always executes server-side
regardless of route, and it already has `storyline.story_id` in scope (line 604) — throw a distinguishable
`quota_exceeded` error there rather than the generic `Error`.

**Unique ID for "one story":** `stories.id` (`story_id`), not `storylines.id` — see §2. Grant/consume the
slot keyed on `(user_id, story_id, day)`; a re-open of a `story_id` already granted today is a no-op success
regardless of which `storyline_id` (or which of several republished versions) it currently maps to.

**"Consumed" moment:** record the slot at the same point `recordView` already fires today — the loader
having successfully resolved beats + first-page media (`StorylinePersistenceLoader`'s network branch,
`app/actions/exploration.ts:440` succeeding) — not at bare page-open. This matches the existing product
judgment call in migration 090 (page open alone is not "progress"); note that today's `recordView` is looser
than that (fires before any page turn), so decide explicitly whether the quota should key off `recordView`'s
existing moment or the stricter `current_beat_index >= 1` used for `storyline_progress` — this is listed as
an open question below.

**Race safety:** follow the `pricing_authorize_spend` shape (§8) — one `plpgsql` function,
`SELECT ... FOR UPDATE` on a per-`(user_id, day)` summary row (or on the set of today's granted `story_id`
rows for that user), check-count-and-insert inside a single transaction, called via RPC from a server
action. This closes the two-tabs/two-devices race that a naive "count rows, then insert if under 3" from
application code would not.

**Plan check:** reuse `resolveEntitlementPlanKeyForUser` (`lib/pricing/enforcement.ts:630`) and treat only
`'free'` as quota-bound; `'plus'`/`'studio'` (and the future `'audience'` key, once it exists) are unlimited.
Never touch `beat_grants`/`beat_spend_reservations`/coin balance for this — consumption must remain outside
the creation-coin ledger entirely, per the task's constraint.

**Signed-out visitors:** already fully handled — `useSignInBeforeWatching`
(`lib/hooks/useSignInBeforeWatching.ts`) intercepts the click before navigation, and every
`/storyline/[id]` link (`StorylineCard.tsx:137`, `GalleryHero.tsx:272`, `SeriesEpisodeList.tsx:42`) calls
`gateOnSignIn` first. Nothing to add for anonymous browsing.

**Reset boundary:** UTC calendar day, matching the only existing precedent (`dayOfYearUtc()`,
`app/actions/gallery.ts:1187`) — no per-user timezone field exists to do otherwise (§6) without adding one,
which is a product decision, not a technical necessity.

**Owner exemption:** gate on the `isOwner` boolean already computed at
`app/storyline/[id]/page.tsx:200` — no new lookup needed.

## Open questions for owner

1. **Exact "consumed" trigger.** Today's `recordView` fires on player mount (beats + first-page media
   loaded, before any reading); `storyline_progress`'s "started" is stricter (`current_beat_index >= 1`,
   i.e. one page turn). Which should the quota use — burn a slot on open, or require at least one page
   turn? This changes both the felt fairness (an accidental tap costing a slot) and the implementation
   (gate in the RSC page vs. gate inside a later beat-turn action).
2. **Kids-mode / shared-login households.** Since kids mode is the same account (§5), a child and parent
   sharing one login share one daily budget. Is that acceptable, or does this quota effort need to pull in
   `viewer_profiles` (currently foundation-only, no read path) to give a household separate budgets?
3. **Republish edge case.** If an author republishes a story mid-day, `story_id` stays stable so a reader's
   already-granted slot carries over correctly (§2) — confirm this is the desired behavior versus, say,
   wanting a "meaningfully changed" republish to count as new content.
4. **Video export of a story that used today's last slot.** Video export (`app/actions/video-export.ts`) is
   a separate coin-metered action layered on an already-opened story — confirm it should never itself be
   quota-gated (only the initial open should be), since the story was already "consumed" to reach the export
   button.
