# Gotchas

Traps this project has already paid for once. Each one cost real debugging time, and most are invisible to
`tsc` and ESLint. Read the relevant section before working in that area.

---

## Build & environment

### `next build` and `next dev` fight over `.next` on Windows

> **Fixed twice over as of 2026-08-25.** Next 16 gives `next dev` its own output directory (`.next/dev`), so
> dev and build no longer collide at all — and it takes a per-directory lock rather than a per-project one, so
> two dev servers on different `distDir`s coexist (verified: ports 3000 and 3100 serving 200 simultaneously).
> On top of that, `distDir` is `process.env.NEXT_DIST_DIR || '.next'`, and the agent tooling points elsewhere:
> `npm run build:verify` builds into `.next-verify`, `npm run dev:agent` serves port 3100 from `.next-agent`.
>
> The history below is kept because it explains why the tooling is shaped this way, and because the
> orphaned-child and silent-stall behaviours are still true of Windows generally.

Both write `d:\AiCoding\storyMaster\.next`, and on Windows they do not fail cleanly when they collide:

- Starting a build while dev runs throws `EPERM: operation not permitted, open '.next\trace'` — or, worse,
  **stalls indefinitely with zero output** after compiling. Next buffers progress behind ANSI control codes,
  so a piped build looks identical to a hung one. Diagnose by comparing process CPU time, not by waiting.
- `rm -rf .next` under a live dev server makes it serve a bare `Internal Server Error` on every route until
  restarted.

**Always stop the dev server before running plain `npm run build`** (`build:verify` is unaffected). Find strays with
`Get-CimInstance Win32_Process -Filter "Name='node.exe'"` filtered on `CommandLine -like '*storyMaster*'` —
an unrelated Adobe Creative Cloud `node.exe` also runs on this machine, so never blanket-kill by name.

Killing a backgrounded `npm run …` kills the npm wrapper but **orphans the child** (`next build` /
`start-server.js`), which can sit on multiple GB. Kill the child by PID.

To build while dev runs, use `npm run build:verify` — the separate-directory trick this section used to
describe by hand is now permanent in `next.config.ts` and wired into `scripts/agent-build.mjs`.

One thing that hand-rolled version got wrong, and which the script now handles: Next repoints **both**
`tsconfig.json` *and* `next-env.d.ts` at the active distDir, and both are tracked. `next-env.d.ts` carries a
`/// <reference path>` to `<distDir>/types/routes.d.ts`, so leaving it rewritten points `tsc` at a directory
another machine does not have. `scripts/lib/preserve-generated.mjs` snapshots both and restores them on every
exit path, including signals.

### `output: 'standalone'` breaks Vercel packaging on Next 16.3.x

A Vercel deploy fails **after a successful compile**, during Vercel's own `onBuildComplete`
packaging step:

```
Error: ENOENT: no such file or directory, open '/vercel/path0/.next/next-server.js.nft.json'
Error: Command "npm run build" exited with 1
```

It reads like a broken build or a Node version problem. It is neither. Next compiles fine and
**does** emit that trace file — verified locally, 157 `.nft.json` files and a populated
`standalone/`. The failure is in the handoff to Vercel's packager, which looks for the file
somewhere else. It is a known Next 16.3.x + Vercel interaction, reported by others with the same
combination of Turbopack and `output: "standalone"`, passing locally and in other CI.

**Fix:** Vercel builds its own output and never needed standalone at all, so turn it off there:

```ts
output: process.env.VERCEL ? undefined : 'standalone',
```

`VERCEL` is set on **preview and production alike**, so one line covers both — there is nothing
separate to remember when promoting to `main`. Standalone still applies when self-hosting
(Cloud Run / Docker), where it is required. `outputFileTracingIncludes` is unaffected: the
`/admin/help` manual is still traced into both outputs.

**Do not diagnose this as a Node version issue.** Next 16 requires Node 20.9+ and Vercel defaults
to 24.x; too old a runtime fails early with an explicit version message, not an ENOENT during
packaging.

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

### The image prompt compiler was written for English — non-Latin text needs care

The relevance filter tokenizes phrases to compare them. Until 2026-09-15 it stripped everything outside
`[a-z0-9]`, so every Hindi, Arabic or CJK phrase reduced to the **same empty key**: distinct phrases were
dropped as "duplicates", focus items shared by three panels were hoisted and then deleted everywhere, and a
fully non-Latin character name made every focus item look like a redundant name. One real Hindi beat lost 4 of
its 5 world invariants, all 16 visual-focus items and 7 negative constraints before anyone noticed.

Two rules when touching `lib/ai/prompt-compiler/`:

- **Keep combining marks.** Devanagari vowel signs and the virama, and Arabic harakat, are marks, not letters —
  a class of letters and digits alone shreds every Hindi word into fragments. Name boundaries need them too,
  or a name matches inside a longer word.
- **Scripts written without spaces (Han, kana, Thai, Lao, Khmer, Myanmar) have no word boundary.** A Japanese
  name is followed directly by a particle, so boundary matching never fires; `findWholeName` falls back to a
  substring match for those. `\b` is ASCII-only in JavaScript even with the Unicode flag — it never matches a
  non-Latin name at all.

`isEnglishText` is a Latin-script ratio, so a Latin-script language that is not English (Spanish, French)
passes it. The composer's own rule is what keeps output English; the check is a backstop.

### Newlines are section breaks in a compiled image prompt

The compiled prompt is eight headed sections separated by blank lines, because the owner requires readable
prompts rather than one block. The redaction pass strips control characters — and a newline **is** a control
character, so the original version quietly collapsed every section break into a space and shipped one
paragraph. `CONTROL_RE` in `compile.shared.ts` deliberately excludes the line feed. Carriage returns are still
stripped so a stray CRLF cannot double a break.

### Never write a Unicode escape into source through the agent tooling

The tooling decodes an escape sequence into the real character before the file is written. A character class
written with escapes therefore lands as **literal control bytes**, NUL included, and git then treats the file
as binary: no diff, no review. This has bitten two units. Build such patterns from a string instead — copy the
form used by `CONTROL_RE` in `compile.shared.ts` — and never put an escape sequence in a prose comment either,
since it becomes a real newline and splits the line. Check with a byte scan before committing.

### Reference-image lines are part of the prompt budget, and use the English name

`buildReferenceBindingLines` appends "reference image N depicts X" lines **after** the compiler has finished,
so they used to push a budgeted prompt over its limit. `estimateReferenceBindingChars` now measures them up
front and the compiler subtracts that from both the target and the 5,000 hard cap. The name in those lines
comes from the same function that names characters inside the prompt (`deriveImageName`), so a non-Latin
canonical name cannot leak in through a binding line while the prompt itself says "Anvi". Compute the estimate
from the **final** reference list — after any filtering — or the reservation no longer matches what is sent.

### Continuity is not sameness — and the composer's invariants are already current

Visual continuity is attribute-specific (`docs/visual-composer-continuity-framework.md`): identity — face, skin
tone, build, distinguishing marks — is preserved, while age, hair, wardrobe, accessories and location are
reassessed whenever the story moves in time, place, activity or life stage. Each is marked LOCKED, EVOLVE or
FREE per character, and `resolveContinuityContradictions` overrides a LOCKED age across a months-or-years jump
(a live run had the model locking a character's age across twelve years).

**The trap:** it is tempting to strip wardrobe and hair detail from a plan when the beat jumps years ahead. Do
not. The composer's `sharedVisualInvariants` describe the state *after* the jump — a live run returned "adult
Anvi … dark hair tied in an athletic ponytail" for a twelve-years-later beat — so dropping them deletes correct
within-beat continuity. What actually drags old appearance forward is elsewhere: the story's own
`continuityNotes` (prior-state notes, filtered on a jump by a deliberately generic word list plus overlap with
`mustNotInherit` — a heuristic, so a plot-relevant note mentioning a room or a bag can be dropped), the
previous beat's storyboard image, and sameness wording in the prompts.

**References follow presence.** Character references are attached only for characters a panel actually declares
present, and the previous storyboard is skipped entirely on a big time jump or location change — unless no
present character has a reference of their own, in which case it stays as the only identity anchor. All of this
fails open: a fallback plan, a plan predating `charactersPresent`, or an empty union attaches everything, as
before. Decide this **before** the reference list is finalized, since the prompt budget reserves space from the
final list.

### Reels share the storyboard output schema

`visual_prompt` and `reel_visual_prompt` both map to a storyboard schema. The continuity fields (transition,
setting, characterVisuals, must-not-inherit, per-panel story function) live in a **separate**
`storyboardContinuityPlanSchema` used only by `visual_prompt`, so reels are not forced to produce them. Adding
a field to the shared schema changes reel generation too.

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

**The classifiers behind those latches are usually code-identical, which is what makes the rule easy to
violate.** `isMissingRunSchemaError` (migration 107) and `isMissingTaskSchemaError` (106) in the agentic
modules both accept exactly `42P01`, `42703`, `PGRST200`, `PGRST204`, as do the persona and memory ones.
They are told apart **only by which table the failing query touched** — never by the error itself. So
"try both classifiers and latch whichever matches" is not a safe pattern: it always matches the first one
you check. **Classify by the query, not by the error.**

This shipped once and was caught in review: `enqueueCommissionedTasks` classified an `agent_tasks`-only
read against the 107 latch first, so a missing `agent_tasks` — or a transient PostgREST `PGRST204` after
any migration — would latch `runSchemaUnavailable`, which `drainAgentRuns` reads at its top and
`listRuns`/`getRun` read too. One `agent_tasks` hiccup would have killed the entire run pipeline for the
life of the process and blanked `/admin/agents/runs` behind a "migration 107 is not applied" message that
was simply false. Fixed in `aa950db`.

A query that genuinely spans two groups — `drainAgentRuns`'s `agent_runs` select with an
`agent_tasks!inner` embed — is the one case where you cannot tell them apart, and there the right answer
is to reason from the schema: `agent_runs.task_id` is a foreign key onto `agent_tasks`, so 107 cannot
exist without 106 and latching 107 is correct either way. Write that reasoning down at the call site.

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

### Beat length is advisory — never retries, never fails

`validateGeneratedBeat` (`lib/ai/story-bible.ts`) no longer checks word count; only structural issues
(missing fields, wrong option count, storyTextParts mismatch, character id problems, novelty) can force the
one retry-then-throw in `generateStoryBeat`, `materializeSeededBeat`, and `generateSeedPlanPreview`. The
band `resolveStoryBeatLength` returns (`targetMinWords`/`targetMaxWords`) is what the model is told; a
separate, wider `allowanceMinWords`/`allowanceMaxWords` only decides whether `assessStoryBeatLength` /
`assessGeneratedBeatLength` (`lib/ai/story-audience.ts`, `lib/ai/story-bible.ts`) logs
`[story_runtime.beat_length_outside_allowance]`. A length miss must never be made to retry or fail a beat
on its own — that used to cost a full beat and two paid calls over wording alone.

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

### `saveBeat` routes by identity rather than gating — shared branching is dormant, not deleted (D23)

`app/actions/persistence.ts`'s `saveBeat` looks like it should be gated on story ownership. **Still don't
wire the reviewer-authorization helper into it as a strict allow/deny check** — that reasoning below is
current, even though the feature it originally protected is not.

**As of Phase 10 Round 1 (2026-09-12), "any authenticated user may continue someone else's non-archived
story on their own branch" is no longer true.** That was shared branching, a real working feature this
section used to describe — the owner has since taken it **dormant by decision (D23)**, not deleted, with
an explicit path back. Creation mode is now owner-or-reviewer only, enforced at four layers:

- the one non-owner entry point, `StorylinePlayer.tsx`'s "Explore full story tree" link, is removed
- `app/story/[id]/layout.tsx` and `app/explore/[id]/layout.tsx` gate both routes server-side to
  owner-or-reviewer via `assertCanEditStory`, redirecting a signed-in non-owner — never a signed-out
  visitor, who still needs through to the page's own sign-in dialog
- `continueStory`'s authorize step now refuses a non-owner, non-reviewer continuation **before** coins are
  reserved, on both the legacy and bundle paths
- migration `115_beats_owner_only_writes.sql` narrows `beats` INSERT/UPDATE RLS to also require the story's
  owner, ANDed onto the existing `003_normalize_beats.sql` predicates — **written, but NOT applied on any
  environment.** Until the owner applies it by hand, the database keeps the original, broader policy below;
  the three application-level layers above are what actually stop a direct explorer write in the meantime,
  not RLS. See `PROJECT_STATE.md`'s migration table (row 115) for where it stands.

```
beats INSERT (today, unmigrated)  auth.uid() IS NOT NULL AND generated_by = auth.uid() AND story not archived
beats UPDATE (today, unmigrated)  generated_by = auth.uid()
```

Note `beats.UPDATE` keys on `generated_by`, **not** on the story's owner — a differently shaped predicate
from `stories.UPDATE` (`auth.uid() = user_id`), and the reason an explorer's write was ever possible at all.

**Why `saveBeat` still must not become a strict gate, even now.** The reviewer path is real, live, and
untouched by D23: a reviewer granted by `assertCanEditStory`'s reviewer branch continues an agent draft
that isn't theirs. `saveBeat` consults the same helper **only to decide routing** — a granted reviewer
swaps to the admin client and drops the `generated_by` / `user_id` filters; every other outcome, including
the helper throwing, falls through to the ordinary session-client path unchanged. Turning that consultation
into `throw Forbidden.` on a non-grant is exactly what Phase 9 nearly shipped and would have broken every
reviewer continuation — the same defect class D23 avoided for explorers by gating at the route and the
authorize step instead of inside `saveBeat` itself.

Reversing D23 — restoring shared branching end-to-end — needs `115_beats_owner_only_writes_rollback.sql`
applied, the doorway restored, and both route layouts relaxed. Recorded in full in `PROJECT_STATE.md` so
it's one lookup, not an excavation; design rationale is in
[docs/agentic-creator-phase10-plan.md](../agentic-creator-phase10-plan.md), section 2 (D23).

## Text models

### A text model id is a registry key — never trust one from the client

Every text call runs through the gateway (`lib/ai/text-gateway/router.ts`), and the model id it is handed is a
`text_model_registry.model_key`, not a provider id. On the reader path that id comes from the browser — the
client fetches task model ids and passes them back into server actions — so treat it as attacker-controlled.
The gateway runs only an **enabled** registry row; anything else drops to the task's Gemini default with a
`[text-gateway] fallback` warning. Never pass a raw id straight to a provider adapter, and never widen the
legacy branch of `resolveTextModel` beyond a bare `gemini-*` id: with migration 119 absent, that regex is the
only thing between a client-supplied string and a paid OpenRouter call.

Related traps from the same build:
- **Never rename a `model_key`.** Tasks and persona overrides point at it by string, so a rename silently sends
  all of them to their fallback. Add a new row and move the tasks.
- **A process that saw 119 missing stays Gemini-only until it restarts.** The registry read latches legacy
  mode; after applying 119 the server needs a redeploy (or dev-server restart) before Text Models shows rows.
- **Gemini output is validated observe-only; OpenAI and OpenRouter strictly.** A schema mismatch on Gemini
  only warns, preserving production behaviour; the same mismatch elsewhere throws `malformed_output`. Changing
  either direction is a live behaviour change, not a tidy-up.
- **Capabilities are load-bearing.** GPT-5.6 Luna rejects `temperature` (HTTP 400) and Qwen 3.7 Flash has JSON
  mode only, no strict schema. A wrong checkbox in an admin edit makes every call on that model fail.
- **Remove a registry row only after moving what points at it.** Tasks and persona overrides hold the key as a
  string; delete first and they silently run their code default. Migration 120 moves, then deletes.

### Thinking levels, temperature and failure text (migration 120)

- **A thinking level is never taken from the request.** The gateway reads the task's level from
  `model_config.reasoning_level` on the server and applies it only when the call runs on that task's assigned
  model and the model lists the level; otherwise the model's default, otherwise nothing is sent. A model's
  levels are a load-bearing capability: Gemini 3 cannot switch thinking off and 3.8 Flash rejects `minimal`.
- **Gemini text calls always send temperature 1.0** — Google's Gemini 3 guidance (lower values risk looping) and
  an owner decision. Task temperatures apply to OpenAI and OpenRouter models only. Not an oversight.
- **Gemini thinking tokens count as output.** Usage adds `thoughtsTokenCount` to output tokens, as Google bills
  it. Gemini cost rows from before this change understate thinking-heavy tasks; don't compare across it.
- **`TextGatewayError.message` is for readers, `detail` is for you.** The message is a fixed sentence with no
  provider, model or task name. Logs, admin screens and agent run records read `errorDetail(error)`. Returning
  `error.message` from a server action is safe for gateway errors, not for arbitrary ones — allow-list the
  error classes you return. Image failures have no gateway, so readers get `readerSafeImageError(...)` at every
  point `beats.image_error` or a job error leaves the server.
- **Browser callers get gateway failures as data, server callers as `TextGatewayError`.** Next.js recommends
  returning expected errors from server functions; don't rely on a thrown action's message reaching the browser
  in production. Beat, storyboard and seed calls go through `callTextModelForReader`, which returns data in the
  browser and calls straight through on the server — so agent run records keep `detail`. Routing server callers
  through the data path too loses it: they record only the reader sentence.
- **A content-safety block is `content_blocked`, with the reason in `providerReason`.** Gemini answers HTTP 200
  with no text plus a `promptFeedback.blockReason` or a content `finishReason`; OpenAI and OpenRouter refuse or
  return a policy error. The gateway retries once on the task's `content_block_fallback_model_id` (121), never
  for strict-model (admin playground) calls. Every failed call, blocks included, is a `status: 'failed'` row in
  `ai_cost_events` with `errorCategory` and `errorDetail` in its metadata.
- **`content_block_fallback_model_id` has its own latch (121).** Never add it to the `model_config` select that
  carries `reasoning_level`: a database without 121 would look like one without 120, and every task thinking
  level would silently stop applying.
- **`model_config.reasoning_level` has its own latch.** A process that saw the column missing sends no task
  thinking levels until it restarts; model assignments are unaffected.

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

---

## Line endings are handled by `.gitattributes` now — do not strip CRs by hand

**The old ritual is dead.** For months, anything that wrote a file on Windows had to follow it with
`sed -i 's/$//' <path>`, because the repo had **no `.gitattributes`** and `core.autocrlf=false`, so git
committed whatever bytes the working tree held. Forgetting it turned a three-line edit into a whole-file
diff. It was forgotten often enough that **16 files reached the repo with CRLF** and one ended up mixed.

`.gitattributes` now carries `* text=auto eol=lf`, so **git normalises on `git add`** regardless of what
your editor produced. Write the file and commit it. No `sed`, no `od -c` check, no instruction in a brief
telling an agent to remember.

**What this does NOT do:** it does not retroactively fix files already stored as CRLF. Those were
renormalised once, in their own commit, deliberately isolated so the noise never lands inside a feature
commit. If you ever add a path pattern that changes text/binary classification, do the same —
`git add --renormalize .` on its own, never mixed with real changes.

**If you see a whole-file diff for a small edit**, that is the symptom this fixed. Check
`git ls-files --eol <path>`: `i/lf` is correct, `i/crlf` means something bypassed normalisation.
