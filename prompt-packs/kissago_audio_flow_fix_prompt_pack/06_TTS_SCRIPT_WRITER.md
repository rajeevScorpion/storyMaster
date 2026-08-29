# 06 — TTS Script Writer Layer

## Purpose

Do not send raw beat text directly to TTS when a prepared narration script is available.

Add a TTS script preparation layer before calling ElevenLabs or Gemini.

The script writer should convert beat text into clean, natural, provider-ready narration.

## What the script writer should do

The script writer should:

- Convert beat text into natural spoken narration.
- Add voice tags where supported.
- Add pauses where supported.
- Add tone, pace, emotion, and delivery instructions where supported.
- Remove visual-only instructions.
- Remove prompt artifacts.
- Avoid reading UI labels, panel names, camera notes, or technical metadata.
- Generate separate scripts per beat/panel where needed.
- Output structured JSON.

## Suggested script output

```json
{
  "language": "bn",
  "beats": [
    {
      "beatId": "beat_01",
      "panelId": "panel_01",
      "plainText": "...",
      "elevenLabsScript": "...",
      "geminiScript": "..."
    },
    {
      "beatId": "beat_02",
      "panelId": "panel_02",
      "plainText": "...",
      "elevenLabsScript": "...",
      "geminiScript": "..."
    }
  ]
}
```

## Provider selection

The flow should be:

```text
Beat text generated
→ TTS script writer creates scripts for ElevenLabs and Gemini
→ System tries ElevenLabs script first
→ If ElevenLabs fails, system sends Gemini script
→ Preview metadata stores actual provider used
```

## Voice tags

Use voice tags to make narration sound more natural and human wherever the provider supports it.

Examples of intended direction:

- Calm storytelling
- Warm emotional pause
- Soft reflective tone
- Slightly slower delivery
- Natural spoken phrasing

Do not overdo voice tags if they make the TTS sound unnatural.

## Important rule

The script writer should run once and store the result as JSON.

The system should later choose the provider-specific script based on which TTS provider is actually used.
