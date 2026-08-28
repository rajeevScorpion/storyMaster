# 07 — Admin Voice and Language Presets

## Goal

Voice and language settings should be admin-configurable, not hardcoded only in frontend components.

Admin should be able to decide:

- Which languages are available
- Which providers are used for each language
- Which voices are available for each language
- Which voices are available for free/pro users
- Which models are used
- Which voice supports timestamps
- Which voices are active

## Voice preset fields

Each voice preset should include:

- Provider
- Language
- Voice name
- Voice ID
- Model
- Short description
- Gender/tone/style if available
- Tier availability
- Whether timestamps are supported
- Whether voice is active

Example:

```json
{
  "provider": "elevenlabs",
  "language": "en",
  "model": "eleven_multilingual_v3",
  "voices": [
    {
      "voiceId": "voice_01",
      "name": "Alice",
      "description": "Warm, calm, storytelling voice",
      "tier": ["free", "pro"],
      "supportsTimestamps": true,
      "active": true
    },
    {
      "voiceId": "voice_02",
      "name": "Bella",
      "description": "Expressive emotional narration",
      "tier": ["pro"],
      "supportsTimestamps": true,
      "active": true
    }
  ]
}
```

Example for Hindi:

```json
{
  "provider": "elevenlabs",
  "language": "hi",
  "model": "eleven_multilingual_v3",
  "voices": [
    {
      "voiceId": "voice_01",
      "name": "Hindi Voice 01",
      "description": "Natural Hindi narration",
      "tier": ["pro"],
      "supportsTimestamps": true,
      "active": true
    }
  ]
}
```

## Language settings

Admin should be able to define language availability like this:

```json
{
  "language": "bn",
  "label": "Bangla",
  "enabled": true,
  "availableForTiers": ["pro"],
  "preferredProvider": "elevenlabs",
  "fallbackProvider": "gemini",
  "textHighlightAvailable": true
}
```

Important:

`textHighlightAvailable` is only a broad setting. Actual highlight support must still be resolved from generated preview metadata.

Final rule:

```ts
textHighlightSupported = provider === "elevenlabs" && wordTimestamps?.length > 0;
```

## User-side filtering

User-side voice list should be filtered by:

- Selected language
- User tier
- Active voices
- Provider availability

Example voice list labels:

```text
Alice — Warm, calm storytelling voice
Bella — Expressive emotional narration
Hindi Voice 01 — Natural Hindi narration
Bangla Voice 01 — Soft emotional Bangla narration
```

Free users should see fewer languages and voices.

Pro users may see more languages, better voices, and more provider options.
