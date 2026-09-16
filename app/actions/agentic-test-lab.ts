'use server';

// Agentic Creator System: Persona Test Lab admin entry points. Every export
// starts with verifyAdmin() -- a 'use server' file may only export async
// functions, so the types (TestLabRunView, TestLabModelRoute,
// TestLabNoveltyPreview) live in lib/agentic/test-lab.ts, not here, and are
// re-exported below as type-only re-exports (mirrors agentic-runs.ts:41).
//
// listTestLabPersonasAction and getTestLabRunAction are read-only and allowed
// even while the master flag is off -- an admin browsing the persona picker
// or a previously-parked run is harmless, mirroring listRunsAction/getRunAction
// in agentic-runs.ts. startTestLabRunAction, continueTestLabRunAction and
// promoteTestLabRunAction all drive real (paid) generation work or promote a
// draft, so they additionally require agentic_creator_enabled via the same
// requireCreatorEnabled() gate every other agentic action module uses for its
// own writes.
//
// THE SAFETY PROPERTY (see lib/agentic/test-lab.ts's header for the full
// explanation): startTestLabRunAction and continueTestLabRunAction can never
// reach draft_created -- and therefore can never write agent_story_memory or
// reach the gallery -- because they call executeRunNow with
// `stopAfterStage: 'story_generated'`. Only promoteTestLabRunAction can cross
// that boundary, and it does so explicitly, one stage at a time, after
// flipping the task's is_test off first.

import { verifyAdmin } from '@/lib/supabase/admin';
import { getAgenticFlags } from '@/lib/agentic/flags';
import {
  continueTestLabRun,
  getTestLabRun,
  listTestLabPersonas,
  promoteTestLabRun,
  startTestLabRun,
  type TestLabRunView,
} from '@/lib/agentic/test-lab';

export type { TestLabModelRoute, TestLabNoveltyPreview, TestLabRunView } from '@/lib/agentic/test-lab';

async function requireCreatorEnabled(): Promise<void> {
  const flags = await getAgenticFlags();
  if (!flags.creatorEnabled) {
    throw new Error(
      'The Agentic Creator System is currently disabled. Turn on the master switch on the Agents Overview page before running the Persona Test Lab.'
    );
  }
}

/** Read-only: non-archived personas for the Test Lab's picker. Allowed while the system is off. */
export async function listTestLabPersonasAction(): Promise<
  { id: string; slug: string; displayName: string; language: string; ageGroup: string; status: string }[]
> {
  await verifyAdmin();
  return listTestLabPersonas();
}

/**
 * Starts a new Persona Test Lab run: commissions an is_test agent_task for
 * `personaId` (with an optional operator-supplied `theme` folded into its
 * brief) and drives it through the real pipeline up to -- and never past --
 * 'story_generated'. `createdBy` is taken from the verified admin's own id,
 * never from caller input.
 */
export async function startTestLabRunAction(personaId: string, theme: string | null): Promise<TestLabRunView> {
  const { user } = await verifyAdmin();
  await requireCreatorEnabled();
  return startTestLabRun(personaId, theme, user.id);
}

/** Resumes a parked or still-generating run with another executeRunNow pass, same stop boundary as start. */
export async function continueTestLabRunAction(runId: string): Promise<TestLabRunView> {
  await verifyAdmin();
  await requireCreatorEnabled();
  return continueTestLabRun(runId);
}

/** Read-only: the current state of one Test Lab run. Allowed while the system is off. */
export async function getTestLabRunAction(runId: string): Promise<TestLabRunView | null> {
  await verifyAdmin();
  return getTestLabRun(runId);
}

/** Promotes a run parked at 'story_generated' into a real draft: flips is_test off, then runs draft_created onward. */
export async function promoteTestLabRunAction(runId: string): Promise<TestLabRunView> {
  await verifyAdmin();
  await requireCreatorEnabled();
  return promoteTestLabRun(runId);
}
