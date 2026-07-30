-- 082_coin_economy_gateway_rollback.sql

DROP TRIGGER IF EXISTS trg_pricing_materialize_usage_components
  ON public.beat_spend_reservations;
DROP FUNCTION IF EXISTS public.pricing_materialize_usage_components();

DROP TABLE IF EXISTS public.beat_usage_event_components;
DROP TABLE IF EXISTS public.beat_spend_reservation_components;

DELETE FROM public.pricing_action_costs
WHERE action_key IN (
  'image_generation',
  'generate_story_narration',
  'generate_reel_narration',
  'generate_narration_preview',
  'align_story_text_overlay',
  'transcribe_audio_stt',
  'export_video_sd',
  'export_video_hd'
);

ALTER TABLE public.pricing_action_costs
  DROP CONSTRAINT IF EXISTS pricing_action_costs_cost_family_check,
  DROP COLUMN IF EXISTS metadata_json,
  DROP COLUMN IF EXISTS studio_enabled,
  DROP COLUMN IF EXISTS plus_enabled,
  DROP COLUMN IF EXISTS free_enabled,
  DROP COLUMN IF EXISTS billing_unit,
  DROP COLUMN IF EXISTS cost_family,
  DROP COLUMN IF EXISTS display_name;

DELETE FROM public.feature_flags
WHERE flag_key = 'pricing_india_only_beta_enabled';
