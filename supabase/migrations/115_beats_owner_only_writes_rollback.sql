-- 115_beats_owner_only_writes_rollback.sql
--
-- Reverses 115. Restores shared branching's database half: any authenticated user may
-- again INSERT their own beats onto (and UPDATE their own beats within) anyone's
-- non-archived story. Byte-for-byte the original 003_normalize_beats.sql policies.
--
-- Restoring this alone does NOT bring shared branching back end-to-end -- it was taken
-- dormant at four layers (docs/agentic-creator-phase10-plan.md D23/section 3.2), and
-- this migration is only one of them. Also needed:
--   - re-add the "Explore full story tree" link in components/story/StorylinePlayer.tsx
--     (removed, the one non-owner entry point into /explore/[id])
--   - remove or relax the owner-or-reviewer gate in app/story/[id]/layout.tsx and
--     app/explore/[id]/layout.tsx (assertCanEditStory)
--   - revert continueStory's pre-authorize check in lib/store/story-store.ts /
--     app/actions/pricing-enforcement.ts's authorizeCurrentUserStoryContinuation /
--     app/actions/beat-bundle.ts's generateBeatCore
-- Not recorded as a PROJECT_STATE.md lookup by this migration's own commit -- flagged
-- as still owed, per D23's own text ("recorded in PROJECT_STATE so it is one lookup,
-- not an excavation").

DROP POLICY IF EXISTS "Story owner can insert beats" ON public.beats;

CREATE POLICY "Authenticated users can insert beats"
  ON public.beats FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND generated_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.stories s
      WHERE s.id = beats.story_id AND s.is_archived = false
    )
  );

DROP POLICY IF EXISTS "Story owner can update own beats" ON public.beats;

CREATE POLICY "Beat generator can update own beats"
  ON public.beats FOR UPDATE
  USING (generated_by = auth.uid());

DELETE FROM public.schema_migration_ledger WHERE migration_number = 115;
