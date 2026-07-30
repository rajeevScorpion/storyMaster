-- 082_coin_economy_gateway.sql
-- Centralize meter prices and tier entitlements, and retain component-level
-- accounting for composite coin reservations.

ALTER TABLE public.pricing_action_costs
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS cost_family text NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS billing_unit text NOT NULL DEFAULT 'operation',
  ADD COLUMN IF NOT EXISTS free_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS plus_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS studio_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.pricing_action_costs
  DROP CONSTRAINT IF EXISTS pricing_action_costs_cost_family_check;

ALTER TABLE public.pricing_action_costs
  ADD CONSTRAINT pricing_action_costs_cost_family_check
  CHECK (cost_family IN ('text', 'image', 'tts', 'alignment', 'export', 'reference', 'other'));

UPDATE public.pricing_action_costs
SET
  display_name = CASE action_key
    WHEN 'start_story_initial_beat' THEN 'Start story with image'
    WHEN 'start_story_initial_beat_prompt_only' THEN 'Start story text'
    WHEN 'start_reel_full_generation' THEN 'Generate reel with images'
    WHEN 'start_reel_full_generation_prompt_only' THEN 'Generate reel text'
    WHEN 'continue_story_new_beat' THEN 'Continue story with image'
    WHEN 'continue_story_new_beat_prompt_only' THEN 'Continue story text'
    WHEN 'preview_seed_plan' THEN 'Preview story plan'
    WHEN 'regenerate_image' THEN 'Regenerate image'
    WHEN 'regenerate_narration' THEN 'Legacy narration regeneration'
    WHEN 'generate_social_share_cover' THEN 'Generate social cover'
    WHEN 'generate_audio_story_cover' THEN 'Generate audio-story cover'
    WHEN 'generate_reel_thumbnail' THEN 'Generate reel thumbnail'
    WHEN 'batch_image_generation' THEN 'Batch image generation'
    WHEN 'export_video_future' THEN 'Legacy video export'
    WHEN 'adopt_character_reference' THEN 'Adopt character reference'
    WHEN 'adopt_world_reference' THEN 'Adopt world reference'
    WHEN 'visualize_world_reference' THEN 'Visualize world reference'
    WHEN 'analyze_direct_reference' THEN 'Analyze direct reference'
    ELSE replace(initcap(replace(action_key, '_', ' ')), '  ', ' ')
  END,
  cost_family = CASE
    WHEN action_key IN (
      'start_story_initial_beat',
      'start_story_initial_beat_prompt_only',
      'start_reel_full_generation',
      'start_reel_full_generation_prompt_only',
      'continue_story_new_beat',
      'continue_story_new_beat_prompt_only',
      'preview_seed_plan'
    ) THEN 'text'
    WHEN action_key IN (
      'regenerate_image',
      'generate_social_share_cover',
      'generate_audio_story_cover',
      'generate_reel_thumbnail',
      'batch_image_generation'
    ) THEN 'image'
    WHEN action_key = 'regenerate_narration' THEN 'tts'
    WHEN action_key = 'export_video_future' THEN 'export'
    WHEN action_key IN (
      'adopt_character_reference',
      'adopt_world_reference',
      'visualize_world_reference',
      'analyze_direct_reference'
    ) THEN 'reference'
    ELSE cost_family
  END,
  billing_unit = CASE
    WHEN action_key = 'batch_image_generation' THEN 'image'
    WHEN action_key LIKE '%image%' OR action_key LIKE '%cover%' OR action_key LIKE '%thumbnail%' THEN 'image'
    WHEN action_key = 'regenerate_narration' THEN 'narration'
    WHEN action_key = 'export_video_future' THEN 'export'
    ELSE 'operation'
  END
WHERE display_name IS NULL OR display_name = '';

INSERT INTO public.pricing_action_costs (
  action_key,
  display_name,
  beat_cost,
  is_active,
  cost_family,
  billing_unit,
  free_enabled,
  plus_enabled,
  studio_enabled,
  metadata_json
)
VALUES
  (
    'image_generation',
    'AI image generation',
    0,
    true,
    'image',
    'image',
    false,
    true,
    true,
    '{"rateStrategy":"image_model_registry","description":"Tier gate; the selected image model supplies the per-image price."}'::jsonb
  ),
  (
    'generate_story_narration',
    'Story narration',
    1,
    true,
    'tts',
    'narration',
    true,
    true,
    true,
    '{"description":"Provider-backed story TTS. Never complimentary."}'::jsonb
  ),
  (
    'generate_reel_narration',
    'Reel narration',
    1,
    true,
    'tts',
    'narration',
    true,
    true,
    true,
    '{"description":"Provider-backed reel TTS. Never complimentary."}'::jsonb
  ),
  (
    'generate_narration_preview',
    'Narration preview',
    0.5,
    true,
    'tts',
    'preview',
    true,
    true,
    true,
    '{"description":"Provider-backed narration preview. Stored sample playback is not charged."}'::jsonb
  ),
  (
    'align_story_text_overlay',
    'Text/audio alignment',
    0.5,
    true,
    'alignment',
    'alignment',
    true,
    true,
    true,
    '{"description":"Known-text/audio forced alignment. This is not speech transcription."}'::jsonb
  ),
  (
    'transcribe_audio_stt',
    'Audio transcription',
    1,
    false,
    'alignment',
    'audio_minute',
    false,
    false,
    false,
    '{"description":"Reserved for future true speech-to-text transcription."}'::jsonb
  ),
  (
    'export_video_sd',
    'Export SD video',
    2,
    true,
    'export',
    'export',
    true,
    true,
    true,
    '{"quality":"sd","description":"720p browser video export."}'::jsonb
  ),
  (
    'export_video_hd',
    'Export HD video',
    3,
    true,
    'export',
    'export',
    false,
    true,
    true,
    '{"quality":"hd","description":"1080p browser video export."}'::jsonb
  )
ON CONFLICT (action_key) DO NOTHING;

-- The old generic keys remain available for old clients, but new clients quote
-- the explicit meter keys above.
UPDATE public.pricing_action_costs
SET metadata_json = COALESCE(metadata_json, '{}'::jsonb) || '{"legacyAlias":true}'::jsonb
WHERE action_key IN ('regenerate_narration', 'export_video_future');

CREATE TABLE IF NOT EXISTS public.beat_spend_reservation_components (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  reservation_id uuid REFERENCES public.beat_spend_reservations(id) ON DELETE CASCADE NOT NULL,
  component_key text NOT NULL,
  cost_family text NOT NULL,
  billing_unit text NOT NULL,
  quantity numeric(12,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_beat_cost numeric(12,2) NOT NULL CHECK (unit_beat_cost >= 0),
  quoted_beat_cost numeric(12,2) NOT NULL CHECK (quoted_beat_cost >= 0),
  status text NOT NULL DEFAULT 'quoted' CHECK (status IN ('quoted', 'succeeded', 'failed', 'released')),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reservation_id, component_key)
);

CREATE INDEX IF NOT EXISTS idx_reservation_components_reservation
  ON public.beat_spend_reservation_components(reservation_id, status);

CREATE TABLE IF NOT EXISTS public.beat_usage_event_components (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  usage_event_id uuid REFERENCES public.beat_usage_events(id) ON DELETE CASCADE NOT NULL,
  reservation_component_id uuid REFERENCES public.beat_spend_reservation_components(id) ON DELETE SET NULL,
  component_key text NOT NULL,
  cost_family text NOT NULL,
  billing_unit text NOT NULL,
  quantity numeric(12,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_beat_cost numeric(12,2) NOT NULL CHECK (unit_beat_cost >= 0),
  beat_cost numeric(12,2) NOT NULL CHECK (beat_cost >= 0),
  provider_cost_usd numeric(14,6),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (usage_event_id, component_key)
);

CREATE INDEX IF NOT EXISTS idx_usage_components_usage_event
  ON public.beat_usage_event_components(usage_event_id);

ALTER TABLE public.beat_spend_reservation_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beat_usage_event_components ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.pricing_materialize_usage_components()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'finalized'
     AND NEW.usage_event_id IS NOT NULL
     AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.usage_event_id IS DISTINCT FROM NEW.usage_event_id)
  THEN
    UPDATE public.beat_spend_reservation_components
    SET
      status = CASE WHEN status = 'quoted' THEN 'succeeded' ELSE status END,
      updated_at = now()
    WHERE reservation_id = NEW.id;

    INSERT INTO public.beat_usage_event_components (
      usage_event_id,
      reservation_component_id,
      component_key,
      cost_family,
      billing_unit,
      quantity,
      unit_beat_cost,
      beat_cost,
      metadata_json
    )
    SELECT
      NEW.usage_event_id,
      component.id,
      component.component_key,
      component.cost_family,
      component.billing_unit,
      component.quantity,
      component.unit_beat_cost,
      component.quoted_beat_cost,
      component.metadata_json
    FROM public.beat_spend_reservation_components component
    WHERE component.reservation_id = NEW.id
      AND component.status IN ('quoted', 'succeeded')
    ON CONFLICT (usage_event_id, component_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pricing_materialize_usage_components
  ON public.beat_spend_reservations;

CREATE TRIGGER trg_pricing_materialize_usage_components
AFTER UPDATE OF status, usage_event_id ON public.beat_spend_reservations
FOR EACH ROW
EXECUTE FUNCTION public.pricing_materialize_usage_components();

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES ('pricing_india_only_beta_enabled', true, NULL)
ON CONFLICT (flag_key) DO UPDATE
SET enabled = EXCLUDED.enabled;
