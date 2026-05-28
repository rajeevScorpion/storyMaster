-- 054_reel_narration_presets.sql
-- Manual migration for reel-level narration settings, reusable narration presets,
-- and generation logging.

CREATE TABLE IF NOT EXISTS public.narration_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description TEXT NULL,
  provider TEXT NOT NULL DEFAULT 'elevenlabs',
  model TEXT NOT NULL DEFAULT 'eleven_multilingual_v2',
  voice_id TEXT NOT NULL,
  language_mode TEXT NOT NULL DEFAULT 'reel_language',
  speed NUMERIC(4,3) NOT NULL DEFAULT 0.95 CHECK (speed >= 0.5 AND speed <= 2),
  stability NUMERIC(4,3) NOT NULL DEFAULT 0.75 CHECK (stability >= 0 AND stability <= 1),
  similarity_boost NUMERIC(4,3) NOT NULL DEFAULT 0.80 CHECK (similarity_boost >= 0 AND similarity_boost <= 1),
  style NUMERIC(4,3) NOT NULL DEFAULT 0.15 CHECK (style >= 0 AND style <= 1),
  speaker_boost BOOLEAN NOT NULL DEFAULT true,
  tone TEXT NOT NULL DEFAULT 'clear, grounded, thoughtful',
  emotional_intensity NUMERIC(4,3) NOT NULL DEFAULT 0.35 CHECK (emotional_intensity >= 0 AND emotional_intensity <= 1),
  pacing TEXT NOT NULL DEFAULT 'steady',
  delivery_style TEXT NOT NULL DEFAULT 'informed storyteller',
  narration_instruction TEXT NOT NULL DEFAULT 'Sound warm, precise, and trustworthy. Keep pauses short and purposeful.',
  preset_scope TEXT NOT NULL DEFAULT 'user',
  preset_visibility TEXT NOT NULL DEFAULT 'private',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT narration_presets_provider_check
    CHECK (provider IN ('elevenlabs', 'gemini_tts')),
  CONSTRAINT narration_presets_language_mode_check
    CHECK (language_mode IN ('reel_language', 'auto', 'custom')),
  CONSTRAINT narration_presets_scope_check
    CHECK (preset_scope IN ('system', 'user')),
  CONSTRAINT narration_presets_visibility_check
    CHECK (preset_visibility IN ('private', 'public')),
  CONSTRAINT narration_presets_owner_check
    CHECK (
      (preset_scope = 'system' AND user_id IS NULL)
      OR (preset_scope = 'user' AND user_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_narration_presets_system
  ON public.narration_presets (preset_scope, name)
  WHERE preset_scope = 'system';

CREATE INDEX IF NOT EXISTS idx_narration_presets_user
  ON public.narration_presets (user_id, updated_at DESC)
  WHERE preset_scope = 'user';

CREATE UNIQUE INDEX IF NOT EXISTS idx_narration_presets_user_default
  ON public.narration_presets (user_id)
  WHERE preset_scope = 'user' AND is_default = true;

CREATE TABLE IF NOT EXISTS public.reel_narration_settings (
  story_id UUID PRIMARY KEY REFERENCES public.stories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'elevenlabs',
  fallback_provider TEXT NOT NULL DEFAULT 'gemini_tts',
  language TEXT NOT NULL DEFAULT 'en-IN',
  language_source TEXT NOT NULL DEFAULT 'reel_language',
  detected_language TEXT NULL,
  is_mixed_language BOOLEAN NOT NULL DEFAULT false,
  voice_id TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'eleven_multilingual_v2',
  preset_id UUID NULL REFERENCES public.narration_presets(id) ON DELETE SET NULL,
  speed NUMERIC(4,3) NOT NULL DEFAULT 0.95 CHECK (speed >= 0.5 AND speed <= 2),
  stability NUMERIC(4,3) NOT NULL DEFAULT 0.75 CHECK (stability >= 0 AND stability <= 1),
  similarity_boost NUMERIC(4,3) NOT NULL DEFAULT 0.80 CHECK (similarity_boost >= 0 AND similarity_boost <= 1),
  style NUMERIC(4,3) NOT NULL DEFAULT 0.15 CHECK (style >= 0 AND style <= 1),
  speaker_boost BOOLEAN NOT NULL DEFAULT true,
  emotional_intensity NUMERIC(4,3) NOT NULL DEFAULT 0.35 CHECK (emotional_intensity >= 0 AND emotional_intensity <= 1),
  pacing TEXT NOT NULL DEFAULT 'steady',
  tone TEXT NOT NULL DEFAULT 'clear, grounded, thoughtful',
  delivery_style TEXT NOT NULL DEFAULT 'informed storyteller',
  narration_instruction TEXT NOT NULL DEFAULT 'Sound warm, precise, and trustworthy. Keep pauses short and purposeful.',
  language_mode TEXT NOT NULL DEFAULT 'reel_language',
  use_expressive_tags BOOLEAN NOT NULL DEFAULT true,
  use_pronunciation_dictionary BOOLEAN NOT NULL DEFAULT false,
  pause_style TEXT NOT NULL DEFAULT 'natural',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reel_narration_settings_provider_check
    CHECK (provider IN ('elevenlabs', 'gemini_tts')),
  CONSTRAINT reel_narration_settings_fallback_check
    CHECK (fallback_provider IN ('gemini_tts')),
  CONSTRAINT reel_narration_settings_language_source_check
    CHECK (language_source IN ('reel_language', 'user_selected', 'auto_detected')),
  CONSTRAINT reel_narration_settings_language_mode_check
    CHECK (language_mode IN ('reel_language', 'auto', 'custom'))
);

CREATE INDEX IF NOT EXISTS idx_reel_narration_settings_user
  ON public.reel_narration_settings (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_reel_narration_settings_preset
  ON public.reel_narration_settings (preset_id)
  WHERE preset_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.narration_generation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  story_id UUID NULL REFERENCES public.stories(id) ON DELETE SET NULL,
  node_id TEXT NULL,
  generation_mode TEXT NOT NULL DEFAULT 'final',
  provider_used TEXT NOT NULL,
  fallback_used BOOLEAN NOT NULL DEFAULT false,
  selected_voice TEXT NULL,
  selected_model TEXT NULL,
  language TEXT NULL,
  detected_language TEXT NULL,
  is_mixed_language BOOLEAN NOT NULL DEFAULT false,
  preset_id UUID NULL REFERENCES public.narration_presets(id) ON DELETE SET NULL,
  generation_duration_ms INTEGER NULL,
  error_message TEXT NULL,
  generated_audio_storage_path TEXT NULL,
  estimated_cost_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT narration_generation_logs_mode_check
    CHECK (generation_mode IN ('preview', 'final')),
  CONSTRAINT narration_generation_logs_provider_check
    CHECK (provider_used IN ('elevenlabs', 'gemini_tts'))
);

CREATE INDEX IF NOT EXISTS idx_narration_generation_logs_story
  ON public.narration_generation_logs (story_id, created_at DESC)
  WHERE story_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_narration_generation_logs_user
  ON public.narration_generation_logs (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_narration_generation_logs_provider
  ON public.narration_generation_logs (provider_used, fallback_used, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_reel_narration_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS narration_presets_touch_updated_at ON public.narration_presets;
CREATE TRIGGER narration_presets_touch_updated_at
  BEFORE UPDATE ON public.narration_presets
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_reel_narration_updated_at();

DROP TRIGGER IF EXISTS reel_narration_settings_touch_updated_at ON public.reel_narration_settings;
CREATE TRIGGER reel_narration_settings_touch_updated_at
  BEFORE UPDATE ON public.reel_narration_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_reel_narration_updated_at();

ALTER TABLE public.narration_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reel_narration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.narration_generation_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read system narration presets" ON public.narration_presets;
CREATE POLICY "Public can read system narration presets"
  ON public.narration_presets FOR SELECT
  USING (preset_scope = 'system' AND preset_visibility = 'public');

DROP POLICY IF EXISTS "Users can read own narration presets" ON public.narration_presets;
CREATE POLICY "Users can read own narration presets"
  ON public.narration_presets FOR SELECT
  USING (preset_scope = 'user' AND auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own narration presets" ON public.narration_presets;
CREATE POLICY "Users can insert own narration presets"
  ON public.narration_presets FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND preset_scope = 'user'
    AND preset_visibility = 'private'
  );

DROP POLICY IF EXISTS "Users can update own narration presets" ON public.narration_presets;
CREATE POLICY "Users can update own narration presets"
  ON public.narration_presets FOR UPDATE
  USING (preset_scope = 'user' AND auth.uid() = user_id)
  WITH CHECK (
    preset_scope = 'user'
    AND preset_visibility = 'private'
    AND auth.uid() = user_id
  );

DROP POLICY IF EXISTS "Users can delete own narration presets" ON public.narration_presets;
CREATE POLICY "Users can delete own narration presets"
  ON public.narration_presets FOR DELETE
  USING (preset_scope = 'user' AND auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read own reel narration settings" ON public.reel_narration_settings;
CREATE POLICY "Users can read own reel narration settings"
  ON public.reel_narration_settings FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own reel narration settings" ON public.reel_narration_settings;
CREATE POLICY "Users can insert own reel narration settings"
  ON public.reel_narration_settings FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.stories s
      WHERE s.id = story_id
        AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update own reel narration settings" ON public.reel_narration_settings;
CREATE POLICY "Users can update own reel narration settings"
  ON public.reel_narration_settings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.stories s
      WHERE s.id = story_id
        AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete own reel narration settings" ON public.reel_narration_settings;
CREATE POLICY "Users can delete own reel narration settings"
  ON public.reel_narration_settings FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read own narration generation logs" ON public.narration_generation_logs;
CREATE POLICY "Users can read own narration generation logs"
  ON public.narration_generation_logs FOR SELECT
  USING (auth.uid() = user_id);

INSERT INTO public.narration_presets
  (
    id,
    user_id,
    name,
    description,
    provider,
    model,
    voice_id,
    language_mode,
    speed,
    stability,
    similarity_boost,
    style,
    speaker_boost,
    tone,
    emotional_intensity,
    pacing,
    delivery_style,
    narration_instruction,
    preset_scope,
    preset_visibility,
    is_default
  )
VALUES
  (
    '11111111-1111-4111-8111-111111111111',
    NULL,
    'Knowledgeable',
    'Calm, clear, confident explanation with gentle authority.',
    'elevenlabs',
    'eleven_multilingual_v2',
    'EXAVITQu4vr4xnSDxMaL',
    'reel_language',
    0.95,
    0.75,
    0.80,
    0.15,
    true,
    'clear, grounded, thoughtful',
    0.35,
    'steady',
    'informed storyteller',
    'Sound warm, precise, and trustworthy. Keep pauses short and purposeful.',
    'system',
    'public',
    true
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    NULL,
    'Philosophical',
    'Reflective, intimate, and spacious for meaning-heavy reels.',
    'elevenlabs',
    'eleven_multilingual_v2',
    'EXAVITQu4vr4xnSDxMaL',
    'reel_language',
    0.86,
    0.62,
    0.78,
    0.32,
    true,
    'reflective, soft, searching',
    0.50,
    'slow',
    'philosophical narrator',
    'Let ideas breathe. Use gentle pauses after images and questions.',
    'system',
    'public',
    false
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    NULL,
    'Soft Noir',
    'Low, cinematic, and intimate without becoming harsh.',
    'elevenlabs',
    'eleven_multilingual_v2',
    'EXAVITQu4vr4xnSDxMaL',
    'reel_language',
    0.82,
    0.55,
    0.76,
    0.42,
    true,
    'low, smoky, intimate',
    0.55,
    'slow',
    'soft noir narrator',
    'Keep the voice close and low. Add suspense through pauses, not volume.',
    'system',
    'public',
    false
  ),
  (
    '44444444-4444-4444-8444-444444444444',
    NULL,
    'Whispering',
    'Breathy, close, and delicate for quiet emotional reels.',
    'elevenlabs',
    'eleven_multilingual_v2',
    'EXAVITQu4vr4xnSDxMaL',
    'reel_language',
    0.78,
    0.50,
    0.72,
    0.55,
    true,
    'hushed, tender, close',
    0.62,
    'very_slow',
    'whispered storyteller',
    'Use a soft near-whisper. Keep consonants clear and avoid melodrama.',
    'system',
    'public',
    false
  ),
  (
    '55555555-5555-4555-8555-555555555555',
    NULL,
    'Dramatic',
    'Emotion-forward, cinematic, and high contrast.',
    'elevenlabs',
    'eleven_multilingual_v2',
    'EXAVITQu4vr4xnSDxMaL',
    'reel_language',
    0.90,
    0.42,
    0.75,
    0.65,
    true,
    'dramatic, cinematic, emotionally charged',
    0.78,
    'dynamic',
    'dramatic narrator',
    'Lean into emotion and contrast, but keep the delivery smooth and reel-friendly.',
    'system',
    'public',
    false
  ),
  (
    '66666666-6666-4666-8666-666666666666',
    NULL,
    'Affectionate Storyteller',
    'Warm, caring, and personal with soft emotional lift.',
    'elevenlabs',
    'eleven_multilingual_v2',
    'EXAVITQu4vr4xnSDxMaL',
    'reel_language',
    0.88,
    0.68,
    0.80,
    0.28,
    true,
    'affectionate, warm, reassuring',
    0.55,
    'gentle',
    'affectionate storyteller',
    'Sound like you are telling something precious to someone you care about.',
    'system',
    'public',
    false
  ),
  (
    '77777777-7777-4777-8777-777777777777',
    NULL,
    'Sage Narrator',
    'Wise, grounded, and unhurried.',
    'elevenlabs',
    'eleven_multilingual_v2',
    'EXAVITQu4vr4xnSDxMaL',
    'reel_language',
    0.84,
    0.70,
    0.82,
    0.25,
    true,
    'wise, grounded, compassionate',
    0.45,
    'slow',
    'sage narrator',
    'Speak with mature calm. Let each line feel earned.',
    'system',
    'public',
    false
  ),
  (
    '88888888-8888-4888-8888-888888888888',
    NULL,
    'Melancholic Poet',
    'Soft sadness, poetic rhythm, and careful silence.',
    'elevenlabs',
    'eleven_multilingual_v2',
    'EXAVITQu4vr4xnSDxMaL',
    'reel_language',
    0.80,
    0.56,
    0.78,
    0.40,
    true,
    'melancholic, lyrical, tender',
    0.65,
    'slow',
    'poetic narrator',
    'Use a lyrical cadence with gentle ache. Avoid theatrical overstatement.',
    'system',
    'public',
    false
  ),
  (
    '99999999-9999-4999-8999-999999999999',
    NULL,
    'Hopeful Mentor',
    'Encouraging, bright, and steady.',
    'elevenlabs',
    'eleven_multilingual_v2',
    'EXAVITQu4vr4xnSDxMaL',
    'reel_language',
    0.94,
    0.70,
    0.82,
    0.25,
    true,
    'hopeful, steady, encouraging',
    0.48,
    'steady',
    'hopeful mentor',
    'Carry quiet optimism. Make the final line feel like a hand on the shoulder.',
    'system',
    'public',
    false
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    NULL,
    'Mystic Documentary',
    'Documentary clarity with mystical wonder.',
    'elevenlabs',
    'eleven_multilingual_v2',
    'EXAVITQu4vr4xnSDxMaL',
    'reel_language',
    0.86,
    0.64,
    0.80,
    0.35,
    true,
    'mystic, observant, cinematic',
    0.55,
    'measured',
    'mystic documentary narrator',
    'Balance factual calm with a quiet sense of mystery and awe.',
    'system',
    'public',
    false
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    NULL,
    'Cinematic Trailer Soft',
    'Trailer-like lift with a softer emotional edge.',
    'elevenlabs',
    'eleven_multilingual_v2',
    'EXAVITQu4vr4xnSDxMaL',
    'reel_language',
    0.92,
    0.48,
    0.78,
    0.55,
    true,
    'cinematic, spacious, stirring',
    0.68,
    'dynamic',
    'soft cinematic trailer',
    'Use trailer pacing and weight, but keep the voice intimate and restrained.',
    'system',
    'public',
    false
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    NULL,
    'Gentle Hindi Kahani',
    'Warm Hindi storytelling with gentle pauses.',
    'elevenlabs',
    'eleven_multilingual_v2',
    'EXAVITQu4vr4xnSDxMaL',
    'reel_language',
    0.88,
    0.68,
    0.82,
    0.30,
    true,
    'narm, kahani-jaisa, affectionate',
    0.52,
    'gentle',
    'Hindi kahani narrator',
    'Narrate like a gentle Hindi kahani. Keep mixed Hindi-English words natural.',
    'system',
    'public',
    false
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    NULL,
    'Urdu Poetic Noir',
    'Poetic Urdu/Hindustani mood with noir softness.',
    'elevenlabs',
    'eleven_multilingual_v2',
    'EXAVITQu4vr4xnSDxMaL',
    'reel_language',
    0.82,
    0.56,
    0.78,
    0.44,
    true,
    'poetic, noir, mehsoos',
    0.64,
    'slow',
    'Urdu poetic narrator',
    'Keep the cadence poetic and intimate. Preserve Urdu/Hindustani words gracefully.',
    'system',
    'public',
    false
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    NULL,
    'Childlike Wonder',
    'Soft wonder, curiosity, and innocent warmth.',
    'elevenlabs',
    'eleven_multilingual_v2',
    'EXAVITQu4vr4xnSDxMaL',
    'reel_language',
    0.96,
    0.66,
    0.80,
    0.34,
    true,
    'curious, bright, gentle',
    0.50,
    'light',
    'wonder-filled storyteller',
    'Bring a small smile into the voice. Keep the wonder sincere and unforced.',
    'system',
    'public',
    false
  ),
  (
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    NULL,
    'Mythic Epic',
    'Grand, ancient, and emotionally resonant.',
    'elevenlabs',
    'eleven_multilingual_v2',
    'EXAVITQu4vr4xnSDxMaL',
    'reel_language',
    0.90,
    0.50,
    0.80,
    0.58,
    true,
    'mythic, grand, resonant',
    0.72,
    'measured',
    'mythic epic narrator',
    'Give the lines ancient weight. Let pauses create scale.',
    'system',
    'public',
    false
  )
ON CONFLICT (id) DO UPDATE
SET
  user_id = EXCLUDED.user_id,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  provider = EXCLUDED.provider,
  model = EXCLUDED.model,
  voice_id = EXCLUDED.voice_id,
  language_mode = EXCLUDED.language_mode,
  speed = EXCLUDED.speed,
  stability = EXCLUDED.stability,
  similarity_boost = EXCLUDED.similarity_boost,
  style = EXCLUDED.style,
  speaker_boost = EXCLUDED.speaker_boost,
  tone = EXCLUDED.tone,
  emotional_intensity = EXCLUDED.emotional_intensity,
  pacing = EXCLUDED.pacing,
  delivery_style = EXCLUDED.delivery_style,
  narration_instruction = EXCLUDED.narration_instruction,
  preset_scope = EXCLUDED.preset_scope,
  preset_visibility = EXCLUDED.preset_visibility,
  is_default = EXCLUDED.is_default,
  updated_at = now();

WITH narration_defaults AS (
  SELECT
    '{
      "defaultProvider": "elevenlabs",
      "fallbackProvider": "gemini_tts",
      "defaultPresetId": "11111111-1111-4111-8111-111111111111",
      "enabledSystemPresetIds": [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444",
        "55555555-5555-4555-8555-555555555555",
        "66666666-6666-4666-8666-666666666666",
        "77777777-7777-4777-8777-777777777777",
        "88888888-8888-4888-8888-888888888888",
        "99999999-9999-4999-8999-999999999999",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        "ffffffff-ffff-4fff-8fff-ffffffffffff"
      ],
      "defaultVoiceId": "EXAVITQu4vr4xnSDxMaL",
      "allowedElevenLabsVoices": [
        {
          "voiceId": "EXAVITQu4vr4xnSDxMaL",
          "label": "Bella",
          "description": "Soft, warm default ElevenLabs voice"
        }
      ],
      "defaultElevenLabsModel": "eleven_multilingual_v2",
      "previewElevenLabsModel": "eleven_flash_v2_5",
      "finalElevenLabsModel": "eleven_multilingual_v2",
      "fallbackGeminiVoice": "Sulafat",
      "maxNarrationLength": 5000,
      "expressiveTagsEnabled": true,
      "pronunciationDictionaryEnabled": false,
      "pronunciationDictionaryLocators": []
    }'::jsonb AS value
)
INSERT INTO public.feature_flags (flag_key, enabled, value)
SELECT
  'reel_story_settings',
  true,
  jsonb_set(
    '{
      "defaultLength": "medium",
      "defaultBeatCount": 2,
      "defaultTextLength": "medium",
      "textOverlayDefault": true,
      "defaultMood": "playful",
      "defaultVisualStyle": "cinematic",
      "defaultNarrationStyle": "expressive",
      "panelCount": 4,
      "retentionDays": { "free": 30, "plus": 90, "studio": 180 },
      "textLengthWordRanges": {
        "short": { "min": 4, "max": 8 },
        "medium": { "min": 8, "max": 12 },
        "long": { "min": 12, "max": 16 }
      },
      "elevenLabs": {
        "enabled": true,
        "voiceId": "EXAVITQu4vr4xnSDxMaL",
        "modelId": "eleven_multilingual_v2"
      },
      "moods": [
        { "key": "playful", "label": "Playful", "prompt": "bright, curious, quick emotional turns" },
        { "key": "cozy", "label": "Cozy", "prompt": "warm, intimate, gentle emotional rhythm" },
        { "key": "epic", "label": "Epic", "prompt": "bold, cinematic, adventurous stakes" }
      ],
      "visualStyles": [
        { "key": "cinematic", "label": "Cinematic", "prompt": "cinematic storybook frames with expressive lighting" },
        { "key": "anime", "label": "Anime", "prompt": "clean anime cel framing with expressive characters" },
        { "key": "storybook", "label": "Storybook", "prompt": "painterly storybook frames with warm character appeal" }
      ],
      "narrationStyles": [
        { "key": "expressive", "label": "Expressive", "prompt": "expressive narrator with natural pauses and energy" },
        { "key": "gentle", "label": "Gentle", "prompt": "soft, warm, reassuring narration" },
        { "key": "dramatic", "label": "Dramatic", "prompt": "dramatic narration with suspense and momentum" }
      ]
    }'::jsonb,
    '{narration}',
    narration_defaults.value,
    true
  )::text
FROM narration_defaults
ON CONFLICT (flag_key) DO NOTHING;

WITH narration_defaults AS (
  SELECT
    '{
      "defaultProvider": "elevenlabs",
      "fallbackProvider": "gemini_tts",
      "defaultPresetId": "11111111-1111-4111-8111-111111111111",
      "enabledSystemPresetIds": [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444",
        "55555555-5555-4555-8555-555555555555",
        "66666666-6666-4666-8666-666666666666",
        "77777777-7777-4777-8777-777777777777",
        "88888888-8888-4888-8888-888888888888",
        "99999999-9999-4999-8999-999999999999",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        "ffffffff-ffff-4fff-8fff-ffffffffffff"
      ],
      "defaultVoiceId": "EXAVITQu4vr4xnSDxMaL",
      "allowedElevenLabsVoices": [
        {
          "voiceId": "EXAVITQu4vr4xnSDxMaL",
          "label": "Bella",
          "description": "Soft, warm default ElevenLabs voice"
        }
      ],
      "defaultElevenLabsModel": "eleven_multilingual_v2",
      "previewElevenLabsModel": "eleven_flash_v2_5",
      "finalElevenLabsModel": "eleven_multilingual_v2",
      "fallbackGeminiVoice": "Sulafat",
      "maxNarrationLength": 5000,
      "expressiveTagsEnabled": true,
      "pronunciationDictionaryEnabled": false,
      "pronunciationDictionaryLocators": []
    }'::jsonb AS value
)
UPDATE public.feature_flags
SET
  enabled = true,
  value = jsonb_set(
    COALESCE(public.feature_flags.value::jsonb, '{}'::jsonb),
    '{narration}',
    narration_defaults.value,
    true
  )::text,
  updated_at = now()
FROM narration_defaults
WHERE public.feature_flags.flag_key = 'reel_story_settings';

INSERT INTO public.reel_narration_settings
  (
    story_id,
    user_id,
    provider,
    fallback_provider,
    language,
    language_source,
    voice_id,
    model,
    preset_id,
    speed,
    stability,
    similarity_boost,
    style,
    speaker_boost,
    emotional_intensity,
    pacing,
    tone,
    delivery_style,
    narration_instruction,
    language_mode,
    use_expressive_tags,
    use_pronunciation_dictionary,
    pause_style
  )
SELECT
  s.id,
  s.user_id,
  'elevenlabs',
  'gemini_tts',
  CASE
    WHEN s.story_config->>'language' = 'hindi' THEN 'hi-IN'
    ELSE 'en-IN'
  END,
  'reel_language',
  'EXAVITQu4vr4xnSDxMaL',
  'eleven_multilingual_v2',
  '11111111-1111-4111-8111-111111111111'::uuid,
  0.95,
  0.75,
  0.80,
  0.15,
  true,
  0.35,
  'steady',
  'clear, grounded, thoughtful',
  'informed storyteller',
  'Sound warm, precise, and trustworthy. Keep pauses short and purposeful.',
  'reel_language',
  true,
  false,
  'natural'
FROM public.stories AS s
WHERE COALESCE(s.story_kind, 'story') = 'reel'
ON CONFLICT (story_id) DO NOTHING;
