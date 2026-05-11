-- 047_reel_story_generator_post_apply_patch.sql
-- Manual post-apply patch for environments where an earlier version of
-- 046_reel_story_generator.sql was already applied.
--
-- This migration is intentionally small and safe to run after either the
-- earlier 046 or the current corrected 046.

-- 1) Correct reel length backfill. The persisted config shape is:
--    story_config.reel.length, not story_config.reelLength.
UPDATE public.stories
SET
  story_kind = CASE
    WHEN story_config->>'storyKind' = 'reel' THEN 'reel'
    ELSE story_kind
  END,
  reel_length_key = CASE
    WHEN story_config->>'storyKind' = 'reel'
      AND story_config->'reel'->>'length' IN ('short', 'medium', 'long')
    THEN story_config->'reel'->>'length'
    ELSE reel_length_key
  END
WHERE story_config IS NOT NULL;

UPDATE public.storylines AS sl
SET story_kind = COALESCE(s.story_kind, 'story')
FROM public.stories AS s
WHERE s.id = sl.story_id;

-- 2) Move the seeded admin default length from Short to Medium.
--    If the settings row is missing, create it with the current defaults.
INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES
  (
    'reel_story_settings',
    true,
    '{
      "defaultLength": "medium",
      "defaultMood": "playful",
      "defaultVisualStyle": "cinematic",
      "defaultNarrationStyle": "expressive",
      "panelCount": 4,
      "retentionDays": { "free": 30, "plus": 90, "studio": 180 },
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
    COALESCE(value::jsonb, '{}'::jsonb),
    '{defaultLength}',
    '"medium"'::jsonb,
    true
  )::text,
  updated_at = now()
WHERE flag_key = 'reel_story_settings'
;

-- 3) Remove the direct-client cleanup read policy from the earlier 046.
--    Cleanup audit rows are accessed through verified admin server actions
--    using the service-role client.
DROP POLICY IF EXISTS "Admins can read reel cleanup runs" ON public.reel_cleanup_runs;

-- 4) Seed missing reel action costs and align earlier unmodified 1-beat seeds
--    with the current story-generation costs. The updated_by guard avoids
--    overwriting costs that were changed through the admin UI.
INSERT INTO public.pricing_action_costs (action_key, beat_cost, is_active)
SELECT
  'start_reel_initial_beat',
  COALESCE((SELECT beat_cost FROM public.pricing_action_costs WHERE action_key = 'start_story_initial_beat' ORDER BY effective_from DESC LIMIT 1), 1),
  true
UNION ALL
SELECT
  'continue_reel_new_beat',
  COALESCE((SELECT beat_cost FROM public.pricing_action_costs WHERE action_key = 'continue_story_new_beat' ORDER BY effective_from DESC LIMIT 1), 1),
  true
ON CONFLICT (action_key) DO NOTHING;

UPDATE public.pricing_action_costs AS reel
SET
  beat_cost = story.beat_cost,
  is_active = true,
  updated_at = now()
FROM public.pricing_action_costs AS story
WHERE reel.action_key = 'start_reel_initial_beat'
  AND story.action_key = 'start_story_initial_beat'
  AND reel.updated_by IS NULL
  AND reel.beat_cost = 1;

UPDATE public.pricing_action_costs AS reel
SET
  beat_cost = story.beat_cost,
  is_active = true,
  updated_at = now()
FROM public.pricing_action_costs AS story
WHERE reel.action_key = 'continue_reel_new_beat'
  AND story.action_key = 'continue_story_new_beat'
  AND reel.updated_by IS NULL
  AND reel.beat_cost = 1;
