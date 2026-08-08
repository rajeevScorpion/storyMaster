-- 092_backfill_beat_is_storyboard.sql
--
-- Backfill beats.is_storyboard for 2x2 grids saved while the write path only
-- persisted the raw client flag. Every read path infers a storyboard from a
-- narration timing map or a full set of four panel captions as well, so beats
-- carrying that evidence were stored as is_storyboard = false and gallery
-- surfaces rendered the whole grid instead of a single panel.
--
-- Deliberately conservative: it flags only beats with positive evidence of four
-- panels. Beats whose only evidence is the artwork itself are left untouched —
-- see the note at the end of this file.

CREATE TABLE IF NOT EXISTS public.beats_is_storyboard_backfill_092 (
  beat_id uuid PRIMARY KEY,
  backfilled_at timestamptz NOT NULL DEFAULT now()
);

-- Record what this migration changes so the rollback can revert exactly those
-- rows rather than clearing the flag catalogue-wide.
INSERT INTO public.beats_is_storyboard_backfill_092 (beat_id)
SELECT b.id
FROM public.beats b
WHERE b.is_storyboard IS NOT TRUE
  AND (
    b.storyboard_narration_timing IS NOT NULL
    OR (
      jsonb_typeof(b.reel_captions) = 'array'
      AND (
        SELECT count(DISTINCT c ->> 'panelIndex')
        FROM jsonb_array_elements(b.reel_captions) AS c
      ) = 4
    )
    OR (
      jsonb_typeof(b.story_text_overlay_captions) = 'array'
      AND (
        SELECT count(DISTINCT c ->> 'panelIndex')
        FROM jsonb_array_elements(b.story_text_overlay_captions) AS c
      ) = 4
    )
  )
ON CONFLICT (beat_id) DO NOTHING;

UPDATE public.beats
SET is_storyboard = true
WHERE id IN (SELECT beat_id FROM public.beats_is_storyboard_backfill_092);

-- Rows this migration cannot reach: beats generated in storyboard mode that
-- carry no captions and no narration timing. There is no column that proves
-- they are grids. If the catalogue is known to be storyboard-only, the sweep
-- below finishes the job — run it deliberately, not as part of this migration,
-- because it is not reversible against beats that really are single images:
--
--   INSERT INTO public.beats_is_storyboard_backfill_092 (beat_id)
--   SELECT id FROM public.beats
--   WHERE is_storyboard IS NOT TRUE AND image_url IS NOT NULL
--   ON CONFLICT (beat_id) DO NOTHING;
--
--   UPDATE public.beats SET is_storyboard = true
--   WHERE id IN (SELECT beat_id FROM public.beats_is_storyboard_backfill_092);
