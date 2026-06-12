# 03 — Provider Fallback and Timestamp Rules

## Provider priority

Use this priority:

```text
ElevenLabs → Gemini TTS
```

ElevenLabs should be attempted first when available for the selected language and voice.

Gemini should be used as fallback.

## ElevenLabs success with timestamps

When ElevenLabs succeeds and returns word timestamps:

```ts
provider = "elevenlabs";
timestampSource = "elevenlabs";
textHighlightSupported = true;
```

Store the returned timestamps.

## ElevenLabs success without timestamps

When ElevenLabs returns audio but no usable timestamps:

```ts
provider = "elevenlabs";
timestampSource = "none";
textHighlightSupported = false;
```

User-facing message:

```text
Word highlight is unavailable for this preview because timestamps were not returned.
```

Audio should still work.

Export should still work.

## Gemini fallback

Use Gemini when:

- ElevenLabs fails.
- ElevenLabs times out.
- ElevenLabs quota fails.
- ElevenLabs permission fails.
- ElevenLabs model fails.
- Selected language is unsupported by ElevenLabs.
- Selected voice is unavailable.

For Gemini:

```ts
provider = "gemini";
timestampSource = "none";
textHighlightSupported = false;
```

User-facing message:

```text
Text highlight is not available for Gemini TTS because word timestamps are not provided.
```

## Final text highlight rule

Use only this final rule:

```ts
textHighlightSupported = provider === "elevenlabs" && wordTimestamps?.length > 0;
```

Do not infer support only from:

- Language
- Model name
- Voice name
- Provider label
- Admin setting

Actual generated preview metadata is the source of truth.

## Timeout constants

Suggested timeouts:

```ts
const ELEVENLABS_TIMEOUT_MS = 45000;
const GEMINI_TTS_TIMEOUT_MS = 45000;
```

On timeout:

- Mark provider attempt failed.
- Attempt fallback if possible.
- Store fallback reason.
- Show friendly user message.

## Logging format

Log developer metadata like this:

```ts
{
  providerAttempted: "elevenlabs",
  fallbackProvider: "gemini",
  language,
  model,
  voiceId,
  errorCode,
  errorMessage,
  durationMs,
  charsUsed
}
```

## User-facing fallback message

When fallback happens, show something like:

```text
ElevenLabs could not generate this narration, so Gemini TTS was used instead. Text highlight is unavailable for this preview.
```
