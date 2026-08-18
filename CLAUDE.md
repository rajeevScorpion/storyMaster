# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read these too, before non-trivial work:**
- [docs/agent-context/WORKING_AGREEMENTS.md](docs/agent-context/WORKING_AGREEMENTS.md) — non-negotiable rules for how work is delivered here
- [docs/agent-context/PROJECT_STATE.md](docs/agent-context/PROJECT_STATE.md) — what is shipped vs. pending, and which migrations are applied where
- [docs/agent-context/GOTCHAS.md](docs/agent-context/GOTCHAS.md) — bugs already paid for once; don't re-derive them
- [docs/onboarding-new-machine.md](docs/onboarding-new-machine.md) — setting up a fresh development machine

## Project Overview

Kissago (kissago.cc) is an AI-powered interactive branching-story platform built on Next.js 15 (App Router) and React 19. A user writes a one-line prompt; the app generates story "beats" — a scene, an illustration, and a few meaningful choices — and branches from whatever the reader picks. Characters, setting, and visual style stay consistent across beats.

It is positioned as a platform you come to **watch** stories on, not only to write them: the public discovery gallery is the front door, and authoring is an opt-in second act. Finished stories can be published, browsed by others, narrated, turned into vertical reels, and exported to video.

Durable state lives in **Supabase** (Postgres + auth + RLS). Media lives in **Cloudflare R2** with Supabase Storage as fallback. Payments run through **Razorpay**. Deployment is **Vercel**.

## Commands

```bash
npm run dev       # Dev server at localhost:3000 (raised 32KB header cap — see below)
npm run build     # Production build (standalone output)
npm run preview   # Run the production build locally with the raised header cap
npm start         # Plain production start
npm run lint      # ESLint (flat config)
npm test          # Vitest — full suite
npm run clean     # Clear the Next.js cache
npx tsc --noEmit  # Typecheck (the build also enforces this)

npm run test:character-novelty-smoke   # Smoke suite (separate vitest config)
npm run compare:image-prompts          # Legacy-vs-compiled image prompt size report
```

`dev` and `preview` invoke Next through `node --max-http-header-size=32768` on purpose. Supabase stores auth tokens as several large chunked cookies, and on localhost every project shares one cookie origin, so Node's default 16KB header cap is genuinely reachable — past it Node answers **HTTP 431** before Next ever sees the request. `start` deliberately omits it: standalone output prunes `node_modules`, so the explicit bin path is not safe for a hosted entrypoint.

**Never run `npm run build` while the dev server is running** — on Windows they fight over `.next` and the build stalls silently. See GOTCHAS.

## Environment

Copy `.env.example` to `.env.local` and fill it in. The app will not start without at least `GEMINI_API_KEY` and the three Supabase keys. Every key and where to obtain it is documented in [docs/onboarding-new-machine.md](docs/onboarding-new-machine.md).

Secrets are **not** in the repo and must never be committed — `.gitignore` excludes all `.env*` except `.env.example`.

## Architecture

### Routes

| Route | What it is |
|---|---|
| `/` | The gallery — discovery feed, front door for signed-in and signed-out visitors. Server component rendering `GalleryBrowser`. |
| `/create` | The authoring entry point. Renders `HomeContent`, which shows `LandingScreen` or `StoryScreen` depending on session state. |
| `/gallery` | **307** redirect to `/`, carrying the query string. Deliberately temporary, not 308 — a cached permanent redirect would make the move very hard to walk back. |
| `/gallery/kids` | The same discovery surface pinned to `mode: 'kids'`. |
| `/story/[id]` | Owner's reader/authoring view of a saved story. |
| `/explore/[id]` | Non-owner reader view. |
| `/storyline/[id]` | A published storyline (plus `cover-image` route for OG images). |
| `/[slug]` | Admin-managed CMS pages (`lib/managed-pages`). |
| `/wallet`, `/learn`, `/tutorial` | Coin wallet, product/partner presentation, onboarding. |
| `/admin/**` | ~40 admin pages: pricing, users, cost, image models, playgrounds, and ~20 settings panels. |
| `/api/**` | Batch and media workers, Razorpay billing, R2 presign/object routes, admin backfills. |

`middleware.ts` refreshes the Supabase session on every request and enforces user moderation — blocked/suspended accounts are redirected to `/account-restricted`.

### Layers

- **`app/actions/*.ts`** — 52 `'use server'` server-action modules; this is the main server surface. Notable: `story-runtime.ts` (beat generation), `beat-bundle.ts` (bundled server-side beat pipeline), `persistence.ts`, `gallery.ts`, `narration.ts` / `narration-batch.ts`, `image-jobs.ts`, `pricing-*.ts`, `references.ts`, `video-export.ts`.
- **`app/api/*/route.ts`** — long-running and externally-triggered work: batch narration/stateful image workers, `media/jobs/run`, R2 presign/complete/delete, Razorpay webhook, and the daily `batch/reconcile` cron. Worker routes authenticate with `CRON_SECRET`.
- **`lib/ai/`** (~79 files) — prompts, `generation-schemas.ts` (structured JSON output), `beat-orchestration.ts`, the `prompt-compiler/` module, `image-providers/` (Gemini, OpenAI, xAI, Runware behind `router.ts`), narration voice/accent/language resolution, `model-config.ts` (feature flags + per-task model overrides), cost telemetry.
- **`lib/store/`** — `story-store.ts` is a Zustand **module singleton with no persistence**: a session survives client-side navigation but *not* a reload. `my-stories-store.ts` + `my-stories-cache.ts` back the drawer, mirrored to localStorage.
- **`lib/persistence/`** — IndexedDB client cache for media, manifests, and reading progress. Not the source of truth.
- **`lib/supabase/`** — `client` (browser), `server` (RSC/actions), `admin` (service role), `middleware`, `storage`.
- **`lib/media/`, `lib/video-export/`, `lib/reel/`, `lib/storyboard/`** — media pipeline, ffmpeg.wasm/Mediabunny export, vertical reels, storyboard rendering.
- **`lib/pricing/`** — the coin economy, entitlements, and reserve→finalize/release billing around every AI call.
- **`lib/gallery/`, `lib/episodes/`, `lib/character-library/`, `lib/references/`, `lib/beat-control/`** — discovery, series/episodes, the character universe, user-uploaded reference images, and beat editing.
- **`supabase/migrations/`** — 96 numbered migrations, each with a `_rollback.sql` twin.

### Beat generation, in one paragraph

The store calls `generateStoryBeat()`, which sends Gemini a **linear path** — Gemini never sees the branch tree. `getBeatsToNode()` walks `parentId` pointers root→current and `getChoiceHistoryToNode()` collects the choices made at each fork; `storyMap` and `narratorVoice` are stripped before sending. The beat comes back as structured JSON (text, options, characters, continuity notes, image prompt). Images then run a two-step composer→image pipeline, either inline or as a durable background job depending on the image mode. Because branches are independent, revisiting a node and choosing differently replays the same history up to that fork plus the new choice. Full detail: [docs/agent-context/GOTCHAS.md](docs/agent-context/GOTCHAS.md) and `lib/utils/story-map.ts`.

**Every beat image is a 2×2 storyboard grid.** The grid is a pipeline artifact and must never reach a viewer — surfaces render panel 1 only, cards cycle panels on hover, the gallery hero never cycles. This has caused real bugs; read the rule in GOTCHAS before touching any surface that shows beat artwork.

### Feature flags

Most new behaviour ships behind a row in the `feature_flags` table, read through `lib/ai/model-config.ts` and edited from `/admin/settings/*`. Code is expected to **fail closed** when a flag or its migration is absent, so the app keeps working on an un-migrated database. Preserve that property.

## Conventions

- **`*.shared.ts` is pure and isomorphic**; the same-named `*.ts` sibling starts with `import 'server-only'`. Unit tests target the `.shared.ts` half. Follow this split when adding logic that both client and server need.
- **Never export a non-function value from a `'use server'` file.** It compiles and lints clean, then throws a runtime 500 (`can only export async functions, found object`). Put shared constants and types in a plain module and import them.
- **Never import a plain value from a `'use client'` module into server code** — you get a client-reference stub, not the value, and arithmetic on it silently yields `NaN`. Constants both sides need go in a module neither owns.
- Components are client components (`'use client'`) unless they are deliberately server components — the gallery route shells are server components on purpose, for first paint.
- Styling: Tailwind CSS v4, dark theme (`bg-neutral-950`), emerald/indigo/purple accents, glassmorphism. Animations via `motion` (Framer Motion).
- **All dropdowns use the shared `FilterDropdown`** from `@/components/ui/FilterDropdown` — never a native `<select>`.
- Path alias `@/*` maps to the project root. Fonts: Inter (sans) + Playfair Display (serif) via `next/font/google`. TypeScript strict mode. ESLint v9 flat config.
- Migrations are **numbered SQL files with a matching `_rollback.sql`**, applied by the user by hand in the Supabase dashboard. Never run the Supabase CLI. See WORKING_AGREEMENTS.

**Mock mode:** entering `"mock"` as the story prompt returns hardcoded data — useful for UI work without burning API calls or coins.
