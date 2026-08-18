# Gotchas

Traps this project has already paid for once. Each one cost real debugging time, and most are invisible to
`tsc` and ESLint. Read the relevant section before working in that area.

---

## Build & environment

### `next build` and `next dev` fight over `.next` on Windows

Both write `d:\AiCoding\storyMaster\.next`, and on Windows they do not fail cleanly when they collide:

- Starting a build while dev runs throws `EPERM: operation not permitted, open '.next\trace'` — or, worse,
  **stalls indefinitely with zero output** after compiling. Next buffers progress behind ANSI control codes,
  so a piped build looks identical to a hung one. Diagnose by comparing process CPU time, not by waiting.
- `rm -rf .next` under a live dev server makes it serve a bare `Internal Server Error` on every route until
  restarted.

**Always stop the dev server before building.** Find strays with
`Get-CimInstance Win32_Process -Filter "Name='node.exe'"` filtered on `CommandLine -like '*storyMaster*'` —
an unrelated Adobe Creative Cloud `node.exe` also runs on this machine, so never blanket-kill by name.

Killing a backgrounded `npm run …` kills the npm wrapper but **orphans the child** (`next build` /
`start-server.js`), which can sit on multiple GB. Kill the child by PID.

If you must build while dev runs, build into a separate directory: temporarily set
`distDir: process.env.NEXT_BUILD_DIR || '.next'` in `next.config.ts`, run
`NEXT_BUILD_DIR=.next-verify npm run build`, then revert the config and delete the directory. Next also
auto-patches `tsconfig.json` during a build — revert that too.

### Node version

`@google/genai` 2.12 declares `node ^22.13.0 || >=24`. The project has run on Node 22.11.0 with an
`EBADENGINE` warning and no observed runtime failure, but a fresh machine should install **Node 22.13+ or 24**
and sidestep the question.

---

## Next.js server/client boundary

### Never export a non-function value from a `'use server'` file

A `'use server'` module may only export async functions. Exporting an array or object throws at runtime:

```
can only export async functions, found object
```

**`tsc` and ESLint do not catch this** — it is runtime-only, and it surfaces as an opaque 500. Hit twice: once
exporting `RECENT_BEAT_LIMIT_OPTIONS` from `cost-admin.ts`, once with `ListPageInput` in the drawer work.

**Fix:** put shared constants and types in a plain module (`lib/admin/cost-config.ts`,
`lib/types/my-stories.ts`) and import them into the action.

### Never import a plain value from a `'use client'` module into server code

On the server that import resolves to a **client-reference stub**, not the value. Arithmetic on it yields
`NaN` silently.

This produced the "26 stories over an empty grid" bug: `PAGE_SIZE` was exported from `GalleryBrowser`
(`'use client'`) and imported by the server route shells, so `offset + limit - 1` was `NaN`, and
`.range(0, NaN)` made PostgREST return **zero rows while still reporting the true count**. The count was real;
the rows were not.

**Two lessons:** a constant both sides need must live in a module neither owns (`lib/gallery/paging.ts`), and
**`.range()` with a non-finite bound fails silently as "no results"** rather than erroring.

### Debugging a server action

The fastest way is a temporary route handler at `app/api/<name>/route.ts` curled from the shell — it runs in
the same process with the same module state as the action. Note that `app/api/_x/` will 404: an
underscore-prefixed folder is a Next private folder and is excluded from routing.

---

## Styling & layout

### Tailwind v4 `ring-*` defaults to `currentColor`

This project runs Tailwind CSS v4, where `ring-*` utilities default their colour to `currentColor` (v3
defaulted to a fixed blue). On an element with light text like `text-neutral-100`, `ring-1 ring-transparent`
plus `hover:ring-emerald-400/30` renders a **white** outline, not emerald.

Neither `tsc` nor ESLint catches it — it is visual-only, so it surfaces in manual QA or not at all.

**Fix:** draw coloured edges with an inset box-shadow, which composes edge and glow into one property and
cannot fall back to `currentColor`:

```
hover:shadow-[inset_0_0_0_1px_rgba(52,211,153,0.35),0_0_22px_rgba(16,185,129,0.16)]
```

### The landing composer traps overlays

In `components/story/LandingScreen.tsx` the prompt composer lives inside a `motion.div` with a `y` transform
and `z-10`. That transform **creates a stacking context**, so any `position: fixed` overlay rendered inside it
is trapped — the `PromptCarousel` wrapper and the Advanced Options block, both also `z-10`, paint straight
over it no matter how high its z-index goes. The symptom is a dropdown or modal that looks "transparent",
with suggestion chips showing through.

z-index only competes *within* a stacking context. No value fixes this.

**Fix:** portal any dropdown/modal/sheet from inside the composer to `document.body` with `createPortal`.
Working examples: `components/story/AttachMenu.tsx` (positioned from the trigger's `getBoundingClientRect()`,
re-measured on resize and capture-phase scroll) and `components/story/AttachmentsSheet.tsx`. Measure the
trigger **in the click handler, not in an effect** — `react-hooks/set-state-in-effect` rejects a synchronous
`setState` in an effect body.

### Storyboard reader z-order

In `components/story/StoryScreen.tsx` the beat image renders as up to three `StoryStoryboardPlayer`
instances. The full-bleed backdrop and the 9:16 vertical window both live inside
`<div className="absolute inset-0 z-0">`, behind `<main>` (which is `relative z-10`). The **mobile framed
card** (`aspect-[4/3]`, `md:hidden`) is the only instance inside `<main>` — so it is the only one whose
on-image controls can receive clicks.

Any interactive control placed inside the backdrop or vertical players is unreachable. Swipe/tap panel
navigation is therefore `interactive` only on the mobile framed card; the `z-0` instances stay synced via
`manualPanel` + `onActivePanelChange` but are `interactive={false}` / `showIndicators={false}`. Desktop panel
navigation is solved by rendering panel dots in the reader **card control toolbar**, which lives inside
`<main>`.

---

## Story images

### Every beat image is a 2×2 storyboard grid — never leak it

The grid is a generation-pipeline artifact, not a product surface. A leaked grid reads as a broken image.

- Any surface showing beat artwork renders **the first panel only** — every breakpoint, every storyline.
- Card and thumbnail surfaces **cycle the four panels on hover** (`StoryboardThumbnail` via
  `useStoryboardThumbnailPreview`).
- The **gallery hero billboard never cycles** — not on hover, not on a timer. "Cover" in these rules means the
  hero specifically; rail cards keep hovering.
- **Vertical (9:16) storylines** blow out when one panel is stretched across the wide hero. Lay all four
  panels side by side at ≥768px and fall back to the first panel alone below that. Horizontal (16:9) stays a
  single first panel at every width.
- A storyline with a **poster cover** (a rendered share cover with the title composited in) shows that cover
  **whole** on rail cards — never cropped to a quadrant. Hover still cycles, borrowing the opening beat's grid.

**Decide "is this a grid?" structurally, from which source the image came — never from a flag or a size
heuristic.** In the gallery: a ready `share_cover_url` is a rendered poster (never crop); every other cover
source is beat artwork (always crop), because publishing copies the cover node's own image into
`storylines.cover_image_url`.

Two heuristics caused real bugs and are gone: `beats.is_storyboard` was only ever written from the raw client
field, so it reads `false` on real grids; and a ≥1800×1000 size check misread posters as grids.

---

## Data & performance

### Signed URLs churn defeats every image cache

`signMixedUrls` (`lib/media/storage-url-signing.ts`) originally minted a fresh token per call, so every visit
produced new URL strings — a browser cache miss *and* a Next image-optimizer cache miss, since the optimizer's
key is the whole URL. That silently defeated the 30-day `minimumCacheTTL`. There is now a process-local
signature cache reusing a signature for the first 50% of each token's TTL. Don't remove it.

### Nothing viewer-specific in a shared cache key

`lib/cache/ttl-cache.ts` is an in-process TTL cache with single-flight, used for the gallery. The public pool
is read via `createAnonClient()` because RLS policies are additive — a viewer-scoped client would return a
different row set into a shared key.

### Column-availability latches are per migration group

The gallery tolerates missing columns by latching "this column group is unavailable" and retrying without it.
**Reusing one migration group's latch for another blanks unrelated surfaces** — reusing the 088/089 latch for
093 would blank `/gallery/kids`, because `kidsEligibilityUnavailable` fails that surface closed.

Relatedly: the `stories!inner` join was deliberately **not** widened with episode columns as a pre-093
fallback. A database without migration 075 would then fail the whole gallery rather than lose one feature.

### PostgREST `or()` needs double-quoted values

Values in an `or()` filter are double-quoted (`title.ilike."%Mr. Bean%"`) so dots and commas survive. Strip
`%`, `_`, `*`, `(`, `)`, `,`, `"`, backslash and control characters first.

---

## Story generation

### Gemini never sees the branch tree

`generateStoryBeat()` sends a **linear path** from root to the current node: `getBeatsToNode()` walks
`parentId` pointers, `getChoiceHistoryToNode()` collects the choices at each fork, and `storyMap` +
`narratorVoice` are stripped before sending. Branches are fully independent — Gemini has no knowledge of
sibling paths. Revisiting a node and picking a different option sends the same history up to that fork plus
the new choice.

Key files: `lib/store/story-store.ts` (orchestration), `app/actions/story-runtime.ts` (prompt build + JSON
parse), `lib/ai/prompts.ts`, `lib/utils/story-map.ts`, `lib/types/story.ts`.

> Note: `app/actions/story.ts` appears in older docs and plans. It was a dead orphan and was **deleted** —
> the live equivalents are `app/actions/story-runtime.ts` and `app/actions/persistence.ts`.

### Gemini TTS has no locale parameter

`speechConfig` sets only the voice name. **All accent and language steering is prompt text.** Feeding the raw
`en-IN` locale into the prompt's `{{language}}` slot hard-forced Indian English and silently overrode accent
instructions. `callGeminiTTS` now always feeds a bare display name via `narrationLanguageDisplayName()`, and
defensively prepends the accent instruction when an admin-published prompt template lacks the `{{accent}}`
slot.

**Accent is an English-only concept.** Non-English languages are narrated by native speakers, so the accent
picker stays English-only. Do not cross every accent with every language.

### Narration is on-demand, not automatic

Auto-narration was removed from the start/continue flows to kill a race where narration was kicked before
`saveBeatAction` ran, hitting `BEAT_ROW_NOT_FOUND` and losing durable audio. Beats now land with
`audioStatus: 'not_requested'` and narration runs only after the beat exists.
`updateBeatMediaStateWithRetry` (8 × 1500ms, `BEAT_ROW_NOT_FOUND` only) remains as a backstop for legacy-mode
narration.

### Batch narration can strand a beat

The narration worker's self re-kick chain (`after()` + keepalive fetch) is best-effort on Vercel serverless
and can drop before the last beat. The reconcile cron is **daily** (`0 3 * * *` — a Vercel Hobby limit), so
recovery is slow. Mitigations in place: the per-beat narration button is no longer locked in batch mode, the
banner has a "Resume" button, a beat with a missing node is marked `failed` rather than skipped, and
`loadStoryFromCloud` fires a best-effort reconcile on the owner path. Still missing: a durable per-beat
attempt cap (needs a migration).

---

## Product decisions worth not re-deriving

- **`/gallery` is a 307, not a 308.** A cached permanent redirect would make moving the gallery back very hard.
  Promote it only once the IA has settled.
- **Search state is the URL.** `?q=` present — even empty — means search is open. Mutations go through
  `window.history.pushState/replaceState`, **never** the router: `/` is `force-dynamic`, so `router.push`
  re-renders the whole feed on every keystroke. The feed stays mounted behind search (`hidden`, not
  unmounted) so leaving costs no refetch. Clicking the field opens search; **focusing** it does not, so
  tabbing past cannot swap the page out.
- **The `HomeContent` bounce-back guard on `/create` is load-bearing.** The Zustand story store is a module
  singleton with **no persistence**, so arriving at `/create` with a session that already has a `savedStoryId`
  would fire the creation-flow redirect on mount and throw the user back into that story. The guard resets
  such a session — but *only* when `savedStoryId` is set; a session without one is mid-generation and exists
  nowhere else.
- **Expand-on-hover is `pointerType`-detected, never viewport width.** Desktop: hover 400ms expands, click
  still navigates. Touch: tap expands, and only the CTA navigates.
- **Series membership is denormalized onto `storylines` at publish time** because `episode_branches` is
  owner-only RLS and must stay that way — it points at unpublished work. Write-time reads are authorized;
  read-time reads are not.
- **Rails dedupe by story** (`dedupeByStory`): republishing creates a new storyline row per story, so without
  it the same story appears 2–3× in a rail.
- **Feature-tier promotions grant access, never coins.** `snapshot.planKey` is billing truth;
  `snapshot.entitlementPlanKey` is what feature gates read. Resolution is promote-only
  (`max(billing, override)`). A promoted user still pays catalog price and can still hit
  `insufficient_balance`.
