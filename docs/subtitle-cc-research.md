# Subtitle / Closed Captions Research

Date: 2026-04-05
Branch: `subtitle`
Status: Research only. No implementation started.

## Goal

Add closed captions for narration in the storyline player first, with a user toggle to turn captions on or off.

Desired UX:

- Show story text line by line while narration plays.
- Highlight the currently spoken word with a rounded colored box.
- Reuse the same caption approach later in explorer modes.

## Current State In The Codebase

Relevant files:

- `components/story/StorylinePlayer.tsx`
- `components/story/StoryScreen.tsx`
- `lib/hooks/useAudioPlayer.ts`
- `app/actions/narration.ts`
- `lib/store/story-store.ts`
- `lib/types/story.ts`
- `app/actions/persistence.ts`
- `app/actions/exploration.ts`
- `supabase/migrations/003_normalize_beats.sql`

What exists today:

- Each beat has `storyText` and optional `audioUrl`.
- Narration is generated through Gemini TTS.
- The player renders the full beat paragraph as static text.
- The audio hook exposes play/pause state, but not playback time.
- No per-line or per-word timing payload is stored in the `StoryBeat` type or in the `beats` table.

Important references:

- `app/actions/narration.ts` treats Gemini TTS as audio-only output.
- `lib/types/story.ts` includes `storyText` and `audioUrl`, but no caption timing structure.
- `components/story/StorylinePlayer.tsx` renders `currentBeat.storyText` directly.
- `lib/hooks/useAudioPlayer.ts` does not expose `currentTime`.

## Feasibility Summary

This feature is feasible, but it needs one extra timing step.

The blocker is not UI rendering. The blocker is missing timing metadata.

## Can Gemini Return Audio And Timestamp JSON Together?

Current answer: do not plan on that.

Based on the current Gemini TTS documentation checked during research, Gemini TTS is documented as text input with audio output. The current app implementation also only consumes audio from the response.

Practical conclusion:

- Assume Gemini TTS does not give us production-ready line and word timestamps in the same response.
- If Google later adds that capability, we can simplify later, but v1 should not depend on it.

## Best Workable Options

### Option 1: Keep Gemini TTS, add forced alignment after narration

Recommended v1.

Flow:

1. Generate narration audio from `storyText`.
2. Send the generated audio plus the exact transcript to an alignment service.
3. Receive word-level and line-level timestamps.
4. Persist the timing payload with the beat.
5. Drive captions from audio playback time in the player.

Why this is the best fit:

- Smallest change to the current architecture.
- Keeps current narration generation flow intact.
- Best chance of getting accurate word highlighting without rewriting the entire narration pipeline.

Possible providers:

- ElevenLabs Forced Alignment
- Google Cloud Speech-to-Text with word offsets
- Deepgram speech-to-text with utterances and word timing

### Option 2: Switch narration to a provider with stronger caption/alignment tooling

Use if we later want one vendor to own both audio quality and timing.

Possible path:

- ElevenLabs for narration
- ElevenLabs forced alignment for timestamps

Tradeoff:

- Cleaner long-term media stack
- Bigger change because voice selection and narration generation are currently Gemini-based

### Option 3: Use synthesis markers / SSML timepoints

Potentially elegant, but not recommended for v1.

This works only if the chosen TTS path clearly supports synthesis timepoints in the exact model family we use. That was not strong enough to rely on during this research.

## Recommended Technical Direction

### V1 Recommendation

Keep Gemini TTS and add an alignment step.

Data we will likely need per beat:

- `captions.lines[]`
- `captions.words[]`
- Each word should have at least:
  - `text`
  - `startMs`
  - `endMs`
  - `lineIndex`

Likely future `StoryBeat` addition:

- `captions?: CaptionTrack`

Likely persistence additions:

- Add caption JSON to `beats`
- Include it in storyline loading and save/load paths

## UI Notes

Storyline player first:

- Add a `CC` toggle in `components/story/StorylinePlayer.tsx`
- Render a caption component that reads from playback time
- Highlight the active word
- Keep inactive words visible in a lower-contrast style

Later reuse:

- `components/story/StoryScreen.tsx` can likely reuse the same caption component once the data contract exists

## Key Edge Cases To Clarify Before Building

### Product behavior

- Should captions remain visible when the text card is minimized?
- Should captions appear as a bottom overlay over the image, inside the card, or both?
- Should beat 1 `Prelude` text also be narrated and captioned, or only the beat `storyText`?
- If a user manually scrubs in the future, should captions jump accordingly?

### Data / timing behavior

- What should happen when a beat has `storyText` but no `audioUrl`?
- What should happen when audio exists but alignment fails?
- Should we store captions per beat forever, or regenerate on demand?
- Do we want word timing only, or word timing plus pre-grouped lines?

### Language behavior

- English is straightforward for word tokenization.
- Hindi and future languages should not rely on naive whitespace splitting for highlight boxes.
- We should let the alignment provider define the word boundaries instead of trying to infer them ourselves.

### Playback behavior

- Replay should reset the active word to the beginning.
- Pause should freeze highlighting without drifting.
- Auto-advance should not cut off the final highlighted word.
- Signed URL refresh must not break caption sync for already-loaded beats.

### Generation behavior

- First beat can temporarily use base64 audio before persistence completes.
- Alignment may need to work from raw audio bytes, not only from a storage URL.
- Caption generation should not block image display or reading text.

## Suggested Rollout Plan

### Phase 1

- Add caption data contract
- Add alignment step after narration generation
- Persist caption JSON for beats
- Add `currentTime` support in `useAudioPlayer`
- Add CC toggle and karaoke-style captions in `StorylinePlayer`

### Phase 2

- Reuse in `StoryScreen`
- Improve line wrapping and language handling
- Add fallback states for missing caption timing

### Phase 3

- Optional SRT / VTT export
- Optional provider switch if alignment quality or cost is not good enough

## Final Recommendation

For the first production version:

- Keep Gemini TTS
- Add a separate alignment provider
- Store caption timings per beat
- Implement only in the storyline player first

This is the lowest-risk path and the best match for the current codebase.

