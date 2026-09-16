-- 110_riya_sen_narration_voice_rollback.sql
--
-- Reverses 110_riya_sen_narration_voice.sql: puts riya-sen back on Leda, the
-- voice she shares with madhurima-bose (both Bangla). This restores the
-- pre-migration same-language collision -- that is the point of a rollback --
-- not a claim that the collision was ever desirable.
--
-- Guarded the same way as the forward migration: the WHERE clause checks the
-- CURRENT value (`preferred_voice = 'Callirrhoe'`), so this is a no-op if an
-- operator has since set riya-sen to some other voice by hand, and safe to
-- re-run.

UPDATE public.agent_personas
   SET preferred_voice = 'Leda', updated_at = NOW()
 WHERE slug = 'riya-sen' AND preferred_voice = 'Callirrhoe';

DELETE FROM public.schema_migration_ledger WHERE migration_number = 110;
