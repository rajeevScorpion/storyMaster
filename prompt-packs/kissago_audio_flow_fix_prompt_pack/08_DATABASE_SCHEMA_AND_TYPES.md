# 08 — Database Schema and Shared Types

## Narration preview table

Suggested table:

```sql
create table reel_narration_previews (
  id uuid primary key default gen_random_uuid(),
  reel_id uuid not null,
  scope text not null check (scope in ('sample', 'full')),
  provider text not null check (provider in ('elevenlabs', 'gemini')),
  model text not null,
  voice_id text,
  voice_name text,
  language text not null,
  audio_url text not null,
  duration_ms integer,
  word_timestamps jsonb,
  text_highlight_supported boolean default false,
  timestamp_source text default 'none',
  fallback_used boolean default false,
  fallback_reason text,
  chars_used integer,
  tokens_used integer,
  created_at timestamptz default now()
);
```

## Active narration on reel

Option A — Reference latest applied preview:

```sql
alter table reels
add column active_narration_preview_id uuid references reel_narration_previews(id);
```

Option B — Store active narration snapshot:

```sql
alter table reels
add column active_narration jsonb;
```

Using both is acceptable if useful:

- Reference gives traceability.
- Snapshot makes export safer if preview relations change.

## Voice presets

Suggested table:

```sql
create table voice_presets (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('elevenlabs', 'gemini')),
  language text not null,
  model text not null,
  voice_id text,
  voice_name text not null,
  description text,
  tone text,
  style text,
  available_for_tiers text[] default array['free'],
  supports_timestamps boolean default false,
  active boolean default true,
  created_at timestamptz default now()
);
```

## Language settings

Suggested table:

```sql
create table tts_language_settings (
  id uuid primary key default gen_random_uuid(),
  language text not null unique,
  label text not null,
  enabled boolean default true,
  available_for_tiers text[] default array['free'],
  preferred_provider text default 'elevenlabs',
  fallback_provider text default 'gemini',
  created_at timestamptz default now()
);
```

## Shared TypeScript types

```ts
type TTSProvider = "elevenlabs" | "gemini";
type PreviewScope = "sample" | "full";
type TimestampSource = "elevenlabs" | "none";

type WordTimestamp = {
  word: string;
  startMs: number;
  endMs: number;
};

type NarrationPreview = {
  id: string;
  reelId: string;
  scope: PreviewScope;
  provider: TTSProvider;
  model: string;
  voiceId?: string;
  voiceName?: string;
  language: string;
  audioUrl: string;
  durationMs: number;
  wordTimestamps?: WordTimestamp[];
  textHighlightSupported: boolean;
  timestampSource: TimestampSource;
  fallbackUsed: boolean;
  fallbackReason?: string;
  charsUsed?: number;
  tokensUsed?: number;
  createdAt: string;
};

type ActiveNarration = {
  previewId: string;
  scope: PreviewScope;
  provider: TTSProvider;
  model: string;
  voiceId?: string;
  voiceName?: string;
  language: string;
  audioUrl: string;
  durationMs: number;
  wordTimestamps?: WordTimestamp[];
  textHighlightSupported: boolean;
  timestampSource: TimestampSource;
};

type BeatNarration = {
  beatId: string;
  panelId?: string;
  scriptText: string;
  provider: TTSProvider;
  model: string;
  audioUrl: string;
  durationMs: number;
  wordTimestamps?: WordTimestamp[];
  textHighlightSupported: boolean;
};
```
