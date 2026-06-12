# 05 — Multi-Beat and Panel-Level Narration

## Problem

Gemini TTS does not provide word timestamps.

If the whole reel text is sent to Gemini as one block, panel and beat transitions cannot reliably follow word-by-word narration.

## Required solution

For multi-beat reels, especially when using Gemini:

- Generate separate TTS scripts per beat or panel.
- Send each panel script separately.
- Store each panel audio separately.
- Calculate each panel duration from its own audio file.
- Use each audio duration to control panel and beat transitions.
- Stitch or sequence the audio clips during preview/export.

## Suggested type

```ts
type BeatNarration = {
  beatId: string;
  panelId?: string;
  scriptText: string;
  provider: "elevenlabs" | "gemini";
  model: string;
  audioUrl: string;
  durationMs: number;
  wordTimestamps?: WordTimestamp[];
  textHighlightSupported: boolean;
};
```

## ElevenLabs timeline behavior

For ElevenLabs:

- Use word timestamps if returned.
- Offset timestamps by the beat/panel start time when building the final timeline.
- Use timestamp data for word highlighting.

Example:

```ts
const globalWordTimestamp = {
  word: local.word,
  startMs: beatStartMs + local.startMs,
  endMs: beatStartMs + local.endMs,
};
```

## Gemini timeline behavior

For Gemini:

- Do not expect word timestamps.
- Do not enable word-level text highlight.
- Use clip duration to time transitions.

Example:

```ts
panelStartMs = previousPanelEndMs;
panelEndMs = panelStartMs + geminiClipDurationMs;
```

## Export behavior

During export:

- Sequence all beat/panel audio clips in order.
- Use beat/panel durations for visuals.
- If ElevenLabs timestamps exist, apply text highlight with offset timestamps.
- If Gemini was used, export narration and transitions only, without text highlight.
