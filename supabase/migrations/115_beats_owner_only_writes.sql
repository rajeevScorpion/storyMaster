-- 115_beats_owner_only_writes.sql
--
-- Phase 10 Round 1 (D23): shared branching goes dormant at the database, not behind a
-- feature flag. docs/agentic-creator-phase10-plan.md section 2 (D23) explains why a
-- flag would be a lie here: the enforcement point is this RLS policy, and a Postgres
-- policy cannot cheaply read a feature_flags row. Flipping a flag on would leave writes
-- silently refused at the database while the button still worked -- the exact
-- silent-write class of bug this phase has already paid for four times.
--
-- "Any authenticated user may continue someone else's non-archived story on their own
-- branch" was a real, working feature (docs/agent-context/GOTCHAS.md, "`saveBeat` is
-- not an owner-only path, and gating it breaks shared branching"). The owner decided
-- 2026-09-12 that creation mode becomes owner-or-reviewer only; this migration is the
-- database half of that. The other half is entirely application-level and lands in the
-- same round, ahead of this migration ever being applied:
--   - the "Explore full story tree" doorway is removed (components/story/StorylinePlayer.tsx)
--   - app/story/[id]/layout.tsx and app/explore/[id]/layout.tsx gate both routes
--     server-side through assertCanEditStory (lib/agentic/reviewers.ts)
--   - continueStory's authorize step (lib/store/story-store.ts) now refuses a
--     non-owner, non-reviewer BEFORE reserving coins, via
--     app/actions/pricing-enforcement.ts's authorizeCurrentUserStoryContinuation
--     (legacy path) and app/actions/beat-bundle.ts's generateBeatCore (bundle path,
--     beat_bundle_enabled -- ON in dev per PROJECT_STATE.md, so this is the live path
--     there, not a defensive-only one)
--
-- Per docs/agentic-creator-phase10-plan.md section 3.2, THAT ORDER MATTERS: this
-- migration must land only after the three application-level changes above, never
-- before -- otherwise a non-owner's direct continuation attempt would already have
-- been charged (authorize) and generated (AI cost) by the time this policy refuses the
-- write, the same charge-and-write-nothing defect class this phase has already fixed
-- four times elsewhere. This file is produced but NOT applied by the agent that wrote
-- it, per WORKING_AGREEMENTS.md -- the owner applies it by hand, dev first, only once
-- confirming the three application-level changes are already live.
--
-- FAIL-CLOSED WHILE UNAPPLIED: until the owner runs this, the database keeps today's
-- broader policy and shared branching keeps working exactly as it does now for anyone
-- who reaches saveBeat directly. The three application-level gates above are what
-- protect a real user in the meantime; this migration is their backstop against direct
-- server-action invocation, not the primary protection.
--
-- NARROWS, does not replace: both new policies below are the exact
-- 003_normalize_beats.sql predicates with one clause ANDed on --
-- `s.user_id = auth.uid()`. Every existing condition (generated_by = auth.uid(),
-- is_archived = false) is untouched. For an ordinary owner writing their own story,
-- generated_by is already their own id and they already own the story, so both
-- conditions were already true for every row that isn't shared-branching's -- this is a
-- no-op for the owner path.
--
-- REVIEWER WRITES ARE UNAFFECTED. Every reviewer write site (saveBeat's routing in
-- app/actions/persistence.ts, beat-control.ts, image-batch.ts, narration-batch.ts,
-- lib/agentic/review-publish.ts) runs on the service-role admin client once
-- assertCanEditStory grants reviewer access, and the admin client bypasses RLS
-- entirely. This policy is never consulted on that path. Verified by audit,
-- docs/agentic-creator-phase10-plan.md section 3.5 ("Blast radius -- verified,
-- essentially nil").
--
-- DEPENDS ON 003 (public.beats, both policies below replace ones created there by
-- name). Reversed by 115_beats_owner_only_writes_rollback.sql, which restores the
-- original two policies byte-for-byte -- see that file for what else re-enabling
-- shared branching end-to-end would need.

DROP POLICY IF EXISTS "Authenticated users can insert beats" ON public.beats;

CREATE POLICY "Story owner can insert beats"
  ON public.beats FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND generated_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.stories s
      WHERE s.id = beats.story_id
        AND s.user_id = auth.uid()
        AND s.is_archived = false
    )
  );

DROP POLICY IF EXISTS "Beat generator can update own beats" ON public.beats;

CREATE POLICY "Story owner can update own beats"
  ON public.beats FOR UPDATE
  USING (
    generated_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.stories s
      WHERE s.id = beats.story_id
        AND s.user_id = auth.uid()
    )
  );

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (115, '115_beats_owner_only_writes.sql')
ON CONFLICT (migration_number) DO NOTHING;
