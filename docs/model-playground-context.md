# Model Playground — Implementation Context

> This document preserves context for Phase 2 multi-provider support.
> Updated during implementation — records what worked, what didn't, and decisions made.

---

## Phase 1: Gemini-Only Model Playground (2026-03-30)

### Goal
Admin dashboard tab to test different Gemini models per task, compare cost/speed/quality, and apply winners to production without code changes.

### Model Inventory (Before)

| Task | File | Line | Hardcoded Model | Temp |
|------|------|------|-----------------|------|
| Story Generation | `app/actions/story.ts` | 160 | `gemini-3.1-pro-preview` | 0.7 |
| Visual Prompt Composer | `app/actions/story.ts` | 199 | `gemini-3.1-pro-preview` | 0.7 |
| Image Generation | `app/actions/story.ts` | 209 | `gemini-3.1-flash-image-preview` | — |
| Text-to-Speech | `app/actions/narration.ts` | 66 | `gemini-2.5-flash-preview-tts` | — |
| Voice Selection | `app/actions/narration.ts` | 208 | `gemini-3.1-pro-preview` | 0.3 |

### Architecture Decisions

1. **Config store:** Supabase `model_config` table (runtime changes, no restart needed)
2. **story.ts stays `'use client'`** — `compressImage()` uses Canvas/DOM APIs. Model IDs threaded as optional params.
3. **narration.ts stays `'use server'`** — reads config directly from DB
4. **Playground tests are isolated** — separate server actions, never touch production data
5. **API key:** Single key `NEXT_PUBLIC_GEMINI_API_KEY` used everywhere
6. **No provider column in Phase 1** — keep simple, Phase 2 will add it

### Key Constraints
- `app/actions/story.ts` MUST remain `'use client'` — image compression uses `document.createElement('canvas')`, `new Image()`, `canvas.toDataURL()` (browser-only DOM APIs)
- Previous attempt to move story.ts to server-side broke image compression and upload flow
- Existing function signatures must not change for external callers

### Files Created
- `supabase/migrations/008_model_config.sql`
- `lib/ai/model-config.ts` — config reader/writer with 60s cache
- `lib/ai/pricing.ts` — Gemini cost estimation
- `app/actions/playground.ts` — isolated test + apply actions
- `app/admin/playground/page.tsx` — playground UI

### Files Modified
- `components/admin/AdminSidebar.tsx` — added Playground nav item
- `app/actions/narration.ts` — hardcoded models → config reads
- `app/actions/story.ts` — optional model override params
- `lib/store/story-store.ts` — fetch config at story-start

---

## Implementation Log

### Step 1: Migration
- **Status:** 🔲 Pending
- **Notes:**

### Step 2: Config reader (`lib/ai/model-config.ts`)
- **Status:** 🔲 Pending
- **Notes:**

### Step 3: Pricing utility
- **Status:** 🔲 Pending
- **Notes:**

### Step 4: Wire narration.ts to config
- **Status:** 🔲 Pending
- **Notes:**

### Step 5: Wire story.ts with optional overrides
- **Status:** 🔲 Pending
- **Notes:**

### Step 6: Wire store to fetch config
- **Status:** 🔲 Pending
- **Notes:**

### Step 7: Playground server actions
- **Status:** 🔲 Pending
- **Notes:**

### Step 8: Playground UI page
- **Status:** 🔲 Pending
- **Notes:**

### Step 9: Sidebar update
- **Status:** 🔲 Pending
- **Notes:**

---

## Phase 2: Multi-Provider Support (Future)

### Options Being Considered
1. **Single AI Gateway** — Vercel AI Gateway or OpenRouter (unified API, simplified key management)
2. **Independent providers per task** — Flux (images), ElevenLabs (music/narration), etc.

### Migration Path from Phase 1
- Add `provider` column to `model_config` table (default: 'gemini')
- Create provider adapter interface: `generateText(provider, model, prompt)`
- Playground UI adds provider dropdown before model dropdown
- Each provider gets own API key in env vars
- Extend pricing table per provider

### Open Questions for Phase 2
- Which gateway if option 1? (Vercel vs OpenRouter vs custom)
- How to handle provider-specific config (e.g., ElevenLabs voice IDs vs Gemini voice names)?
- Should we support A/B testing between providers in production?
- Cost tracking: aggregate per-provider or unified dashboard?
