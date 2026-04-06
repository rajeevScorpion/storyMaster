-- 019_pricing_seed_data_rollback.sql

DELETE FROM public.pricing_action_costs
WHERE action_key IN (
  'start_story_initial_beat',
  'continue_story_new_beat',
  'regenerate_image',
  'regenerate_narration',
  'export_video_future'
);

DELETE FROM public.pricing_topup_packs
WHERE pack_key IN ('beats_25', 'beats_80', 'beats_200');

DELETE FROM public.pricing_plan_versions
WHERE plan_id IN (
  SELECT id
  FROM public.pricing_plans
  WHERE plan_key IN ('free', 'plus', 'studio')
);

DELETE FROM public.pricing_plans
WHERE plan_key IN ('free', 'plus', 'studio');
