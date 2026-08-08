# Gallery Discovery Architecture

Covers phases 6–8 of the gallery transformation (`kissago_gallery_prompt_pack/`):
viewing state, the viewer-profile foundation, and the feed read path. Phases 1–5
(storyline-only feed, OTT visual system, touch, discovery intros, audience/genre/
kids) are described in the plan file and the per-phase commits.

## Read path

```
/gallery (server component)
  ├─ getGalleryRails()      → billboard + rails
  └─ getGalleryItems(...)   → first page of Browse All
        ↓ passed as props
  GalleryBrowser (client)   → filters, paging, saves, rotation
```

The page is a server component. It used to be a client component that fetched
everything after hydration, which meant the first paint was skeletons and real
content waited on *bundle download → hydrate → server action → database*.
Resolving the above-the-fold payload on the server collapses that into the
initial HTML. The client component still owns every interaction and refetches
independently when either half fails, so a failed prerender degrades to the old
behaviour rather than to a broken page.

## Caching (phase 8)

`lib/cache/ttl-cache.ts` — an in-process TTL cache with single-flight
de-duplication. Deliberately not Redis: the hot data is small, public, and cheap
to recompute, and there is no shared cache in the deployment today. Per-instance
caching removes the repeated work that dominates a feed request; an extra
instance only means an extra cold fill.

| Cached | Key | TTL | Why it is safe to share |
| --- | --- | --- | --- |
| Moderation gate setting | `gallery:moderation-gate` | 30s | Global admin setting |
| Public rail candidate pool | `gallery:rail-rows:{mode}:{gated}` | 60s | Read with a session-less client; `is_public = true` only |
| Cover-is-storyboard flag | `storyline-cover-storyboard:{id}` | 30min | Derived from published beats, which never change |
| Signed cover URL | `cover-signed-url:{sourceUrl}` | 12h | Signature is valid 24h; the object is the same for everyone |

**The rule that must not be broken:** nothing viewer-specific may enter a shared
key. My List, Continue Reading, and progress are fetched per request with the
viewer's own (RLS-scoped) client and merged on top of the cached public rows.

The public pool is read through `createAnonClient()` rather than the
cookie-bound client. RLS policies are additive — a signed-in viewer's client can
return rows an anonymous visitor would never see — so filling a shared cache
from a session-bound client is a leak waiting for a future policy change.

Failures are never cached. `cached()` drops a rejected fill, and
`fetchPublicRailRows` throws rather than returning an error object, so a
transient database error does not freeze the feed for the rest of the TTL.

### Other read-path work in phase 8

- Cover resolution used to make three admin round-trips per request purely to
  decide whether to crop a thumbnail. That answer is now cached per storyline,
  so a warm feed makes none.
- The recent-storyline pool dropped from 48 rows to 24. Rails only ever render
  12; the rest existed to group genre rails.
- `count: 'exact'` is a second scan of the filtered set. Only the first page of
  a filter combination requests it; later pages report `total: 0` and the client
  keeps the count it already has.
- Rails deduplicate by `story_id`. Republishing creates a new storyline row for
  the same story, which was surfacing near-identical cards side by side.

## Viewing state (phase 6)

Migration `090_storyline_progress.sql`.

Progress already existed client-side in IndexedDB (`lib/persistence`), but that
is per-device and invisible to the server, so it cannot drive a feed query.
`storyline_progress` is the server copy.

Definitions, chosen to match what `StorylinePlayer` already persists locally so
the two never disagree:

- **Started** — `current_beat_index >= 1`. Opening a storyline and leaving on
  beat 0 is not progress, so Continue Reading is not filled by accidental taps.
- **Complete** — the reader reached the final beat *and* that beat is an ending.
- **Progress** — beat index within the storyline's linear beat sequence. A
  storyline is already one flattened path through the story tree, so there is no
  branch-level summarisation to do.
- **Completion is sticky.** Re-reading a finished storyline updates the resume
  point without clearing the badge: `recordStorylineProgress` omits the
  `completed` column from the upsert when it is false.

Writes happen on page turns only (`persistPage`), never on the audio-progress
tick that drives the local save — that fires several times a second.

Reads are one indexed query per feed request covering every id on screen, never
one per card.

**Watch count is deliberately not implemented.** It would need either an
append-only event table or a counter that lies whenever a reader reopens a
storyline, and nothing in the product surfaces it. The pack lists it as
optional; this is the documented decision not to build it.

## Viewer profiles (phase 7 — foundation only)

Migration `091_viewer_profiles.sql`, resolved by `lib/viewer-profile/`.

Kissago has three identities, and conflating them is the main hazard here:

| Concept | Table | Meaning |
| --- | --- | --- |
| Account | `auth.users` | Who signed in; owns billing |
| Creator profile | `public.profiles` | Display name on a published storyline; one per account |
| Viewer profile | `public.viewer_profiles` | Who is watching now; several per account |

Only the third gates discovery. `public.profiles` already existed and is *not*
a household viewing profile.

**Backwards compatibility.** No backfill. An account with no `viewer_profiles`
rows resolves to an implicit default adult profile, so existing users see no
change and no rows are written on their behalf.

**Enforcement.** `resolveEffectiveAudienceMode` in `app/actions/gallery.ts`
narrows the requested scope by the active profile's eligibility, so a kids
profile stays on the kids catalogue even when the request came from `/gallery`.
It can only ever narrow. The active profile is named by a cookie, but ownership
is revalidated against the database on every request; an unmatched id falls back
to the account's stored default rather than to `all`, so a forged cookie cannot
escape a kids profile.

**Not built** (explicit stop conditions in the pack): profile switching UI, PINs,
parental dashboards, entitlements, avatar assets. Saved storylines and progress
remain account-scoped until switching actually ships.

## Migration status

`088`–`091` are applied by hand in the Supabase dashboard. All four are additive
and the code tolerates their absence:

| Migration | Absent behaviour |
| --- | --- |
| 088 discovery intro | Listing drops the columns and retries; intros fall back to a derived beat-1 excerpt |
| 089 age/genre | Same retry; `/gallery/kids` fails closed to empty rather than serving an unfiltered catalogue |
| 090 progress | Progress reads and writes warn and no-op; no Continue Reading rail, no badges |
| 091 viewer profiles | Every account resolves to the implicit default adult profile |
