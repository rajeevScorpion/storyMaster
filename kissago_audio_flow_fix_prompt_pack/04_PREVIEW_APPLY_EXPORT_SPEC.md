# 04 — Preview, Apply, and Export Specification

## Preview metadata

Every generated preview must store complete metadata.

Required type:

```ts
type NarrationPreview = {
  id: string;
  reelId: string;
  scope: "sample" | "full";
  provider: "elevenlabs" | "gemini";
  model: string;
  voiceId?: string;
  voiceName?: string;
  language: string;
  audioUrl: string;
  durationMs: number;
  wordTimestamps?: WordTimestamp[];
  textHighlightSupported: boolean;
  timestampSource: "elevenlabs" | "none";
  fallbackUsed: boolean;
  fallbackReason?: string;
  charsUsed?: number;
  tokensUsed?: number;
  createdAt: string;
};
```

## Preview list UI

The preview list should show:

```text
Preview 01 — Alice — sample — ElevenLabs v3 — Highlight supported
Preview 02 — Bella — sample — Gemini TTS — Highlight unavailable
Preview 03 — Bella — full — ElevenLabs v3 — Highlight supported
```

Show:

- Preview number/name
- Voice name
- Scope
- Provider
- Model
- Highlight status
- Fallback status when relevant

## Apply preview behavior

When user clicks Apply:

- Save selected preview as active narration.
- Preserve metadata.
- Preserve audio URL.
- Preserve timestamps if available.
- Preserve provider/model info.
- Update reel timing based on applied audio duration.
- Update panel/beat transitions according to applied audio duration.
- Set text highlight availability from applied preview metadata.

Suggested type:

```ts
type ActiveNarration = {
  previewId: string;
  scope: "sample" | "full";
  provider: "elevenlabs" | "gemini";
  model: string;
  voiceId?: string;
  voiceName?: string;
  language: string;
  audioUrl: string;
  durationMs: number;
  wordTimestamps?: WordTimestamp[];
  textHighlightSupported: boolean;
  timestampSource: "elevenlabs" | "none";
};
```

Do not recompute or discard timestamp data during Apply.

The applied preview is the source of truth.

## Export behavior

Final export must use the applied full preview audio.

Rules:

- If full preview is applied, use that audio directly.
- If only sample preview exists, block final export.
- If Gemini audio is applied, export should work without text highlight.
- If ElevenLabs audio with timestamps is applied, export should include text highlight timing.
- Export should not fail only because text highlight is unavailable.

Validation:

```ts
if (!activeNarration?.audioUrl) {
  throw new Error("No applied narration found. Please generate and apply a full preview before export.");
}

if (activeNarration.scope !== "full") {
  throw new Error("Please generate and apply a full narration preview before export.");
}
```

If text highlight is enabled but timestamps are missing:

```ts
textHighlightEnabled = false;
showWarning("Text highlight was disabled because word timestamps are unavailable.");
continueExport();
```

Do not fail export only because word highlighting is unavailable.
