-- 110_riya_sen_narration_voice.sql
--
-- Agentic Creator System: fixes the one real same-language voice collision among
-- the 15 seed personas (Phase 8, Unit 8a).
--
-- THE RULE THIS MOVES TOWARD: one persona has one fixed narration voice, chosen
-- from exactly the voices the consumer "advanced settings" picker exposes
-- (DEFAULT_MALE_NARRATION_VOICES / DEFAULT_FEMALE_NARRATION_VOICES in
-- lib/ai/narration-voices.ts). `preferred_voice` (migration 103) has carried a
-- value since the 104 seed, but nothing in the codebase has ever read it --
-- narration has always fallen back to automatic model-chosen voice selection
-- regardless of what this column says. `approved_voice_pool` is being retired as
-- a concept alongside this: the column stays (other rows still reference it,
-- and dropping a column is a separate, unrelated migration), it is simply no
-- longer where voice selection looks.
--
-- WHY THIS DOESN'T TRY TO MAKE EVERY PERSONA'S VOICE UNIQUE. 15 seed personas,
-- 12 exposed voices -- uniqueness is arithmetically impossible, so it is not the
-- bar. Four voices are already shared by two personas each, and three of those
-- four pairs write in different languages, which is fine: a Hindi persona and an
-- English persona sharing "Charon" never sit next to each other in the same
-- narrated language. The one pairing that IS a real collision is Leda, shared by
-- `madhurima-bose` (bangla) and `riya-sen` (bangla) -- two Bangla authors would
-- sound identical to a listener. That is the only pair this migration touches.
--
-- WHY CALLIRRHOE, SPECIFICALLY. Not an arbitrary reassignment:
--   1. It is already inside riya-sen's own seeded `approved_voice_pool`
--      (ARRAY['Leda','Aoede','Callirrhoe'], migration 104) -- the seed author
--      had already judged this voice fitting for this persona, so this
--      migration is picking from a choice already made, not inventing a new one.
--   2. No Bangla persona uses Callirrhoe today (madhurima-bose: Leda,
--      ishani-chatterjee: Sulafat), so this creates no new same-language
--      collision while resolving the one that exists.
--
-- madhurima-bose keeps Leda -- there is no reason to move both personas, and
-- doing so would just relocate the pair rather than resolve it. Moving riya-sen
-- is the smaller, sufficient change.
--
-- SAFE TO RE-RUN. The UPDATE's WHERE clause guards on the CURRENT value
-- (`preferred_voice = 'Leda'`), not just the slug, so running this twice is a
-- no-op the second time, and it will not clobber a later manual change made
-- through the (not-yet-built) admin persona editor -- if an operator has since
-- set riya-sen to some other voice on purpose, this migration quietly does
-- nothing rather than stomping that choice.
--
-- Apply to DEVELOPMENT ONLY for now. Production has none of migrations 102-110
-- (see docs/agent-context/PROJECT_STATE.md) -- there is no agent_personas table
-- to update there yet, so this migration is meaningless on prod until 102-109
-- land first, in numeric order.
--
-- Apply to development, then confirm:
--   select * from public.schema_migration_ledger where migration_number = 110;
--   select slug, preferred_voice from public.agent_personas where slug in ('riya-sen','madhurima-bose');
--   -- expect: riya-sen -> Callirrhoe, madhurima-bose -> Leda

UPDATE public.agent_personas
   SET preferred_voice = 'Callirrhoe', updated_at = NOW()
 WHERE slug = 'riya-sen' AND preferred_voice = 'Leda';

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (110, '110_riya_sen_narration_voice.sql')
ON CONFLICT (migration_number) DO NOTHING;
