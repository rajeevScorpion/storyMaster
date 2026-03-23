# Multi-Provider Media Generation Plan

## Problem

Current image generation is sequential and slow (~8-15s blocking time per beat):

1. `generateStoryBeat()` (Gemini Pro) — 3-5s
2. `generateImage()` — 5-10s (includes 2 Gemini calls: prompt composer + image gen)
3. `generateNarration()` — 3-5s (already fire-and-forget)

## Proposed Architecture

```
                         ┌→ Flux (imagePrompt)        → image
generateStoryBeat()  ────┤→ ElevenLabs (storyText)    → audio
  (Gemini Pro)           └→ UI renders text immediately

All 3 run in PARALLEL after text is ready
```

### Provider Roles

| Provider | Role | Advantage |
|----------|------|-----------|
| Gemini Pro | Story text + imagePrompt | Best at structured JSON, story continuity |
| Flux (via Replicate/fal.ai) | Image generation | ~2-3s, no prompt composer needed |
| ElevenLabs | Narration | Higher quality voices, faster than Gemini TTS |

### Context Sharing

No special integration needed — Gemini's structured output already produces:
- `imagePrompt` → plain text description, passed directly to Flux
- `storyText` → passed directly to ElevenLabs
- `characters` array → can enrich Flux prompt with appearance details if needed

### Implementation Steps

#### Phase 1: Quick Wins (no new providers)
- [ ] Parallelize image + narration after text generation (currently sequential in `story-store.ts` lines 139-163 and 210-231)
- [ ] Remove the visual prompt composer call inside `generateImage()` — pass `imagePrompt` directly to the image model
- [ ] Expected improvement: ~5s saved per beat

#### Phase 2: Flux Integration
- [ ] Add Flux API client (Replicate or fal.ai)
- [ ] Create `generateImageFlux(prompt, characters, style)` in a new `lib/ai/flux.ts`
- [ ] Add `FLUX_API_KEY` env var
- [ ] Swap `generateImage()` to use Flux, keep Gemini as fallback
- [ ] Expected image gen time: 2-3s

#### Phase 3: ElevenLabs Integration
- [ ] Add ElevenLabs API client
- [ ] Create `generateNarrationElevenLabs(text, voiceId)` in `lib/ai/elevenlabs.ts`
- [ ] Map narrator voice selection to ElevenLabs voice IDs
- [ ] Add `ELEVENLABS_API_KEY` env var
- [ ] Expected narration time: 2-3s with better quality

### Expected Results

| Metric | Current | After Phase 1 | After All Phases |
|--------|---------|---------------|-----------------|
| Blocking time | 8-15s | 5-8s | 5-8s |
| Total gen time | 11-20s | 5-8s | 3-5s |
| Image quality | Good | Good | Better (Flux) |
| Voice quality | OK | OK | Better (ElevenLabs) |

### Files to Modify

- `app/actions/story.ts` — image/narration generation functions
- `lib/store/story-store.ts` — orchestration (parallelize calls)
- `lib/constants/media.ts` — add provider config
- New: `lib/ai/flux.ts`, `lib/ai/elevenlabs.ts`
