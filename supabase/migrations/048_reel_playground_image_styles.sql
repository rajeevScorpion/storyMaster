-- 048_reel_playground_image_styles.sql
-- Manual migration for Reel Playground image-pipeline split and visual style library.
-- Do not apply automatically from Codex.

INSERT INTO public.model_config (task_key, model_id, temperature)
VALUES ('reel_image_generation', 'gemini-3.1-flash-image-preview', NULL)
ON CONFLICT (task_key) DO NOTHING;

ALTER TABLE public.media_assets
  DROP CONSTRAINT IF EXISTS media_assets_asset_type_check;

ALTER TABLE public.media_assets
  ADD CONSTRAINT media_assets_asset_type_check
  CHECK (asset_type IN (
    'beat_image',
    'storyboard_image',
    'character_reference',
    'storyline_cover',
    'share_cover',
    'youtube_thumbnail',
    'reel_thumbnail',
    'reel_style_sample',
    'narration_audio',
    'portrait',
    'unknown'
  ));

CREATE TABLE IF NOT EXISTS public.reel_visual_styles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  min_plan TEXT NOT NULL DEFAULT 'free',
  prompt_definer TEXT NOT NULL,
  sample_image_url TEXT NULL,
  sample_r2_object_key TEXT NULL,
  sample_r2_bucket TEXT NULL,
  text_overlay_style JSONB NOT NULL DEFAULT '{}'::jsonb,
  no_face_default BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ NULL,
  CONSTRAINT reel_visual_styles_status_check
    CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT reel_visual_styles_min_plan_check
    CHECK (min_plan IN ('free', 'plus', 'studio')),
  CONSTRAINT reel_visual_styles_published_sample_check
    CHECK (
      status <> 'published'
      OR (
        sample_image_url IS NOT NULL
        AND sample_r2_object_key IS NOT NULL
        AND sample_r2_bucket IS NOT NULL
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_reel_visual_styles_status_sort
  ON public.reel_visual_styles (status, sort_order, name);

CREATE OR REPLACE FUNCTION public.touch_reel_visual_styles_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reel_visual_styles_touch_updated_at ON public.reel_visual_styles;
CREATE TRIGGER reel_visual_styles_touch_updated_at
  BEFORE UPDATE ON public.reel_visual_styles
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_reel_visual_styles_updated_at();

ALTER TABLE public.reel_visual_styles ENABLE ROW LEVEL SECURITY;

-- Client reads/writes are intentionally not granted. Server actions use service-role
-- after admin checks for management and server-side filtering for user style cards.

INSERT INTO public.reel_visual_styles
  (name, slug, status, min_plan, prompt_definer, text_overlay_style, no_face_default, sort_order)
VALUES
  (
    'Risograph Memory',
    'risograph-memory',
    'draft',
    'free',
    'grainy risograph print texture, limited teal coral cream palette, symbolic landscapes, bold silhouettes, quiet negative space, poetic social reel mood',
    '{"position":"lower","align":"center","fontSize":38,"fontWeight":600,"color":"#ffffff","shadowColor":"rgba(0,0,0,0.72)","shadowBlur":14,"backgroundColor":"rgba(0,0,0,0.32)","backgroundOpacity":0.32}'::jsonb,
    true,
    10
  ),
  (
    'Ink Solitude',
    'ink-solitude',
    'draft',
    'free',
    'expressive black ink linework, muted watercolor washes, quiet interior spaces, back-view figures, soft paper grain, philosophical reflective mood',
    '{"position":"middle","align":"center","fontSize":36,"fontWeight":500,"color":"#ffffff","shadowColor":"rgba(0,0,0,0.7)","shadowBlur":16,"backgroundColor":"rgba(0,0,0,0.2)","backgroundOpacity":0.2}'::jsonb,
    true,
    20
  ),
  (
    'Bauhaus Pulse',
    'bauhaus-pulse',
    'draft',
    'plus',
    'Bauhaus-influenced geometry, bold primary accents, abstract human presence, clean symbolic motion, strong shape rhythm, modern poster clarity',
    '{"position":"lower","align":"center","fontSize":40,"fontWeight":700,"color":"#fff8e6","shadowColor":"rgba(0,0,0,0.64)","shadowBlur":10,"backgroundColor":"rgba(0,0,0,0.26)","backgroundOpacity":0.26}'::jsonb,
    true,
    30
  ),
  (
    'Surreal Wash',
    'surreal-wash',
    'draft',
    'plus',
    'surrealist dream logic, floating symbolic objects, soft gouache wash, twilight color fields, faceless figures, meditative emotional transformation',
    '{"position":"lower","align":"center","fontSize":38,"fontWeight":600,"color":"#f8f7ff","shadowColor":"rgba(18,12,36,0.75)","shadowBlur":18,"backgroundColor":"rgba(18,12,36,0.26)","backgroundOpacity":0.26}'::jsonb,
    true,
    40
  ),
  (
    'Constructivist Dawn',
    'constructivist-dawn',
    'draft',
    'studio',
    'constructivist poster energy, diagonal movement, limited red black cream palette, symbolic urban scenes, graphic momentum, no visible faces by default',
    '{"position":"upper","align":"center","fontSize":40,"fontWeight":700,"color":"#fff4df","shadowColor":"rgba(0,0,0,0.82)","shadowBlur":12,"backgroundColor":"rgba(0,0,0,0.3)","backgroundOpacity":0.3}'::jsonb,
    true,
    50
  )
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES
  (
    'reel_story_settings',
    true,
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
        "short": { "min": 5, "max": 8 },
        "medium": { "min": 9, "max": 14 },
        "long": { "min": 15, "max": 22 }
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
    }'
  )
ON CONFLICT (flag_key) DO NOTHING;

UPDATE public.feature_flags
SET
  enabled = true,
  value = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            COALESCE(value::jsonb, '{}'::jsonb),
            '{defaultBeatCount}',
            '2'::jsonb,
            true
          ),
          '{defaultTextLength}',
          '"medium"'::jsonb,
          true
        ),
        '{textOverlayDefault}',
        'true'::jsonb,
        true
      ),
      '{textLengthWordRanges}',
      '{"short":{"min":5,"max":8},"medium":{"min":9,"max":14},"long":{"min":15,"max":22}}'::jsonb,
      true
    ),
    '{elevenLabs}',
    '{"enabled":true,"voiceId":"EXAVITQu4vr4xnSDxMaL","modelId":"eleven_multilingual_v2"}'::jsonb,
    true
  )::text,
  updated_at = now()
WHERE flag_key = 'reel_story_settings';
