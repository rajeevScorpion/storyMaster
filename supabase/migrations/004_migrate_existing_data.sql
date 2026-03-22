-- ============================================================
-- 004: Migrate existing data from JSONB blobs to normalized tables
-- Extracts nodes from stories.story_map into beats table,
-- and converts storylines.beats JSONB into storyline_beats rows.
-- ============================================================

-- ============================================================
-- 1. Migrate story_map nodes → beats table
-- ============================================================
DO $$
DECLARE
  story_row RECORD;
  node_key text;
  node_val jsonb;
  beat_data jsonb;
BEGIN
  FOR story_row IN
    SELECT id, user_id, story_map
    FROM public.stories
    WHERE story_map IS NOT NULL
      AND story_map != 'null'::jsonb
      AND jsonb_typeof(story_map->'nodes') = 'object'
  LOOP
    FOR node_key, node_val IN
      SELECT * FROM jsonb_each(story_row.story_map->'nodes')
    LOOP
      beat_data := node_val->'data';

      INSERT INTO public.beats (
        story_id, node_id, beat_number, parent_node_id,
        selected_option_id, generated_by, title, is_ending,
        story_text, scene_summary, options, characters,
        continuity_notes, image_prompt, clues, next_beat_goal,
        ending_forecast, image_url, audio_url
      ) VALUES (
        story_row.id,
        node_key,
        COALESCE((node_val->>'beatNumber')::int, (beat_data->>'beatNumber')::int, 0),
        NULLIF(node_val->>'parentId', ''),
        NULLIF(node_val->>'selectedOptionId', ''),
        story_row.user_id,  -- attribute all existing beats to story creator
        COALESCE(beat_data->>'title', 'Untitled'),
        COALESCE((beat_data->>'isEnding')::boolean, false),
        COALESCE(beat_data->>'storyText', ''),
        beat_data->>'sceneSummary',
        beat_data->'options',
        beat_data->'characters',
        beat_data->'continuityNotes',
        beat_data->>'imagePrompt',
        beat_data->'clues',
        beat_data->>'nextBeatGoal',
        beat_data->'endingForecast',
        -- Only keep HTTP URLs, skip base64
        CASE
          WHEN beat_data->>'imageUrl' LIKE 'http%' THEN beat_data->>'imageUrl'
          ELSE NULL
        END,
        CASE
          WHEN beat_data->>'audioUrl' LIKE 'http%' THEN beat_data->>'audioUrl'
          ELSE NULL
        END
      )
      ON CONFLICT (story_id, node_id) DO NOTHING;
    END LOOP;

    -- Set current_node_id from the story_map
    UPDATE public.stories
    SET current_node_id = story_row.story_map->>'currentNodeId'
    WHERE id = story_row.id
      AND current_node_id IS NULL;
  END LOOP;
END $$;

-- ============================================================
-- 2. Migrate storylines.beats JSONB + node_path → storyline_beats
-- ============================================================
DO $$
DECLARE
  sl_row RECORD;
  beat_idx integer;
  path_node_id text;
  matched_beat_id uuid;
  choice_arr jsonb;
  choice_lbl text;
BEGIN
  FOR sl_row IN
    SELECT id, story_id, node_path, beats, choices
    FROM public.storylines
    WHERE node_path IS NOT NULL
      AND array_length(node_path, 1) > 0
  LOOP
    -- Compute path_hash
    UPDATE public.storylines
    SET path_hash = encode(sha256(array_to_string(sl_row.node_path, '|')::bytea), 'hex')
    WHERE id = sl_row.id
      AND path_hash IS NULL;

    -- Create storyline_beats junction rows
    FOR beat_idx IN 0..array_length(sl_row.node_path, 1) - 1
    LOOP
      path_node_id := sl_row.node_path[beat_idx + 1];  -- PostgreSQL arrays are 1-indexed

      -- Find the beat by story_id + node_id
      SELECT b.id INTO matched_beat_id
      FROM public.beats b
      WHERE b.story_id = sl_row.story_id
        AND b.node_id = path_node_id;

      IF matched_beat_id IS NOT NULL THEN
        -- Get choice label from choices array if available
        choice_lbl := NULL;
        IF sl_row.choices IS NOT NULL AND jsonb_typeof(sl_row.choices) = 'array' THEN
          IF beat_idx < jsonb_array_length(sl_row.choices) THEN
            choice_lbl := sl_row.choices->beat_idx->>'optionLabel';
          END IF;
        END IF;

        INSERT INTO public.storyline_beats (storyline_id, beat_id, position, choice_label)
        VALUES (sl_row.id, matched_beat_id, beat_idx, choice_lbl)
        ON CONFLICT (storyline_id, position) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ============================================================
-- 3. Verify migration counts
-- ============================================================
DO $$
DECLARE
  beat_count bigint;
  sl_beat_count bigint;
BEGIN
  SELECT count(*) INTO beat_count FROM public.beats;
  SELECT count(*) INTO sl_beat_count FROM public.storyline_beats;
  RAISE NOTICE 'Migration complete: % beats, % storyline_beats created', beat_count, sl_beat_count;
END $$;
