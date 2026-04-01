# Improved Character Consistency — Implementation Log

## Branch: `improvedCC` (from `adminPlayground`)

## Status: ALL STEPS COMPLETE — TypeScript passes, lint clean (pre-existing only)

## All Changes

### Pre-Implementation
- [x] Committed migration fixes on `adminPlayground` (commit a9a9915)
- [x] Created and checked out `improvedCC` branch

### Step 1: Feature Flag + Quality Constants
- [x] `lib/types/story.ts` — Added `portraitBase64?: string` and `portraitUrl?: string` to `Character`
- [x] `lib/types/story.ts` — Added `enableReferenceImages?: boolean` to `StorySession`
- [x] `lib/constants/media.ts` — Added `PORTRAIT_MAX_WIDTH/HEIGHT/QUALITY` constants
- [x] `lib/constants/media.ts` — Added `MediaQualityProfile` interface + `QUALITY_DEFAULT` / `QUALITY_PREMIUM` profiles

### Step 2: portrait_generation Task Key
- [x] `lib/ai/model-config.shared.ts` — Added `'portrait_generation'` to `TaskKey` union
- [x] `lib/ai/model-config.shared.ts` — Added to `TASK_DEFINITIONS`, `DEFAULT_MODELS` (flash image)
- [x] `lib/ai/prompt-config.shared.ts` — Added `PORTRAIT_GENERATION_PROMPT_DEFAULT` (front-facing, clean bg, style-matched)
- [x] `lib/ai/prompt-config.shared.ts` — Added to `LOCKED_PROMPT_GUARDRAILS` and `PROMPT_TASK_DEFINITIONS`
- [x] `supabase/migrations/010_portrait_generation.sql` + rollback created

### Step 3: generateCharacterPortrait() Function
- [x] `app/actions/story-runtime.ts` — New `generateCharacterPortrait(character, visualStyle, modelOverrides)`
  - Uses `portrait_generation` prompt template, 1:1 aspect ratio, compresses to 512x512
  - Falls through on error (caller catches)
- [x] `app/actions/story-runtime.ts` — Extended `StoryModelOverrides` with `portraitModel?` and `portraitPrompt?`
- [x] `app/actions/admin.ts` — `getStoryModelOverrides()` now fetches portrait config + prompt

### Step 4: generateImage() Accepts Reference Images
- [x] `app/actions/story-runtime.ts` — Added `ReferenceImage` interface (`type: 'character' | 'scene', base64: string`)
- [x] `app/actions/story-runtime.ts` — `generateImage()` signature extended with optional `referenceImages` param
- [x] `app/actions/story-runtime.ts` — `requestImageResponse()` builds multipart content (text + inlineData parts) when refs present

### Step 5: startStory() Generates Portraits (Gated)
- [x] `lib/store/story-store.ts` — Added `generateCharacterPortrait` and `ReferenceImage` imports
- [x] `lib/store/story-store.ts` — `initialSession` sets `enableReferenceImages: true` (TODO: from user tier)
- [x] `lib/store/story-store.ts` — Portrait generation runs in parallel with scene image + voice (gated)
- [x] Portraits attached to `beat.characters[].portraitBase64` after generation

### Step 6: continueStory() Passes References (Gated)
- [x] `lib/store/story-store.ts` — Builds `referenceImages[]` from session character portraits + previous scene
- [x] Passes to `generateImage()` call, gated on `session.enableReferenceImages`
- [x] Scene ref only used if previous image is base64 (in-memory), skipped for storage URLs

### Step 7: Portrait Storage & Persistence
- [x] `lib/supabase/storage.ts` — `uploadNodeAssets()` uploads portrait base64 to `portrait_{charId}.webp`
- [x] `lib/supabase/storage.ts` — `stripBase64FromStoryMap()` strips `portraitBase64` from characters
- [x] `app/actions/persistence.ts` — `stripBase64()` strips `portraitBase64` from characters before DB save
- [x] `portraitUrl` set on character during upload for persistence

### Step 8: regenerateImageForNode() (Gated)
- [x] `lib/store/story-store.ts` — Builds reference images from session characters + parent node scene
- [x] Gated on `session.enableReferenceImages`

### Step 9: Playground Integration
- [x] `components/admin/PlaygroundStudio.tsx` — Added `portrait_generation` to `DEFAULT_INPUTS`
- [x] `components/admin/PlaygroundStudio.tsx` — `getModelsForTask()` returns image models for portrait task
- [x] `components/admin/PlaygroundStudio.tsx` — `taskHasTemperature()` returns false for portrait task
- [x] `app/actions/prompt-playground.ts` — Added `portrait_generation` case in `executeTaskTest()` switch
- [x] `app/actions/prompt-playground.ts` — New `runPortraitGenerationTest()` function (1:1 aspect, systemInstruction)

### Step 10: Update Visual Prompt Composer
- [x] `lib/ai/prompt-config.shared.ts` — Updated `VISUAL_PROMPT_DEFAULT` rule 2: "describe characters exactly as they appear in their reference images"

## Files Modified (Complete List)

| File | Changes |
|------|---------|
| `lib/types/story.ts` | `portraitBase64?`, `portraitUrl?` on Character; `enableReferenceImages?` on StorySession |
| `lib/constants/media.ts` | Portrait constants, `MediaQualityProfile`, `QUALITY_DEFAULT`, `QUALITY_PREMIUM` |
| `lib/ai/model-config.shared.ts` | `portrait_generation` in TaskKey, TASK_DEFINITIONS, DEFAULT_MODELS |
| `lib/ai/prompt-config.shared.ts` | Portrait prompt default, guardrail, task definition; updated visual_prompt |
| `app/actions/story-runtime.ts` | `generateCharacterPortrait()`, `ReferenceImage`, extended `generateImage()` + `requestImageResponse()`, extended `StoryModelOverrides` |
| `app/actions/admin.ts` | `getStoryModelOverrides()` fetches portrait model + prompt |
| `lib/store/story-store.ts` | `startStory()` parallel portraits, `continueStory()` ref injection, `regenerateImageForNode()` ref injection |
| `lib/supabase/storage.ts` | Portrait upload in `uploadNodeAssets()`, strip in `stripBase64FromStoryMap()` |
| `app/actions/persistence.ts` | Strip `portraitBase64` in `stripBase64()` |
| `components/admin/PlaygroundStudio.tsx` | Portrait default inputs, model/temp mappings |
| `app/actions/prompt-playground.ts` | `runPortraitGenerationTest()`, switch case |
| `supabase/migrations/010_portrait_generation.sql` | Seed model_config row |
| `supabase/migrations/010_portrait_generation_rollback.sql` | Delete seed row |

## Key Architecture Decisions
- **Feature gate:** `session.enableReferenceImages` boolean — false = current flow unchanged, true = portraits + refs
- **Default model:** `gemini-3.1-flash-image-preview` for all image tasks (user chose Flash for everything)
- **Portrait timing:** Parallel with scene image on beat 1 (no sequential delay)
- **Scene ref:** Previous beat's image passed as object reference alongside character portraits
- **Tier provisioning:** `MediaQualityProfile` interface defined but not wired — ready for tier-based switching
- **Skip portrait gen for free/paid:** When flag is false, zero extra API calls
- **Portrait storage:** Uploaded to `story-assets/{userId}/{storyId}/{nodeId}/portrait_{charId}.webp`, `portraitUrl` persisted on Character

## Known Limitations / Future Work
- `enableReferenceImages` hardcoded to `true` — needs user tier system to gate properly
- Scene reference only works for in-memory base64 images (not restored from storage URLs on load)
- Character library (save/reuse across stories) deferred to Phase 2
- `MediaQualityProfile` defined but not wired into generation calls yet
