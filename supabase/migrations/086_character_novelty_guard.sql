-- Rolling, per-account memory used to avoid repeatedly inventing the same
-- character names and visual personas across otherwise unrelated stories.

CREATE TABLE IF NOT EXISTS public.character_novelty_usage (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  story_id uuid REFERENCES public.stories(id) ON DELETE CASCADE NOT NULL,
  character_id text NOT NULL,
  display_name text NOT NULL,
  normalized_name text NOT NULL,
  appearance_signature text,
  name_source text NOT NULL DEFAULT 'ai_generated'
    CHECK (name_source IN ('ai_generated', 'user_provided', 'character_library', 'episode_carry', 'legacy')),
  language text,
  setting_country text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_character_novelty_usage_identity
  ON public.character_novelty_usage (user_id, story_id, character_id);

CREATE INDEX IF NOT EXISTS idx_character_novelty_usage_recent
  ON public.character_novelty_usage (user_id, last_used_at DESC);

CREATE INDEX IF NOT EXISTS idx_character_novelty_usage_name
  ON public.character_novelty_usage (user_id, normalized_name);

ALTER TABLE public.character_novelty_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own character novelty usage" ON public.character_novelty_usage;
CREATE POLICY "Users read own character novelty usage"
  ON public.character_novelty_usage FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own character novelty usage" ON public.character_novelty_usage;
CREATE POLICY "Users insert own character novelty usage"
  ON public.character_novelty_usage FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own character novelty usage" ON public.character_novelty_usage;
CREATE POLICY "Users update own character novelty usage"
  ON public.character_novelty_usage FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Seed existing accounts so the guard helps immediately after rollout. One row
-- per story character is enough; later saves refresh last_used_at idempotently.
INSERT INTO public.character_novelty_usage (
  user_id,
  story_id,
  character_id,
  display_name,
  normalized_name,
  appearance_signature,
  name_source,
  created_at,
  last_used_at
)
SELECT DISTINCT ON (
  stories.user_id,
  stories.id,
  COALESCE(NULLIF(character.value->>'id', ''), 'legacy_' || character.ordinality::text)
)
  stories.user_id,
  stories.id,
  COALESCE(NULLIF(character.value->>'id', ''), 'legacy_' || character.ordinality::text),
  LEFT(TRIM(character.value->>'name'), 120),
  LEFT(LOWER(REGEXP_REPLACE(TRIM(character.value->>'name'), '\s+', ' ', 'g')), 120),
  NULLIF(LEFT(TRIM(character.value->>'appearanceSummary'), 300), ''),
  'legacy',
  COALESCE(stories.created_at, now()),
  COALESCE(stories.updated_at, stories.created_at, now())
FROM public.stories
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(stories.characters) = 'array' THEN stories.characters
    ELSE '[]'::jsonb
  END
)
  WITH ORDINALITY AS character(value, ordinality)
WHERE NULLIF(TRIM(character.value->>'name'), '') IS NOT NULL
ORDER BY
  stories.user_id,
  stories.id,
  COALESCE(NULLIF(character.value->>'id', ''), 'legacy_' || character.ordinality::text),
  character.ordinality
ON CONFLICT (user_id, story_id, character_id)
DO UPDATE SET
  display_name = EXCLUDED.display_name,
  normalized_name = EXCLUDED.normalized_name,
  appearance_signature = EXCLUDED.appearance_signature,
  last_used_at = GREATEST(public.character_novelty_usage.last_used_at, EXCLUDED.last_used_at);
