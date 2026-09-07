'use server';

// Admin entry points for agentic story memory. Every export is admin-gated and
// async — a 'use server' file may only export async functions, so the types
// live in lib/agentic/memory.shared.ts and lib/agentic/memory.ts.

import { verifyAdmin } from '@/lib/supabase/admin';
import { getAgenticFlags } from '@/lib/agentic/flags';
import {
  backfillStoryMemoryFromStorylines,
  resetStoryMemoryBackfillCursor,
  runNoveltyCheck,
  type BackfillResult,
  type NoveltyCheckResult,
} from '@/lib/agentic/memory';
import type { NoveltyCandidate, NoveltyStage } from '@/lib/agentic/memory.shared';

/**
 * Runs one batch of the storyline backfill. Call repeatedly until `done`.
 * Batched rather than run-to-completion on purpose: each call finishes well
 * inside a request budget, and the cursor means an interrupted sequence resumes
 * rather than restarting.
 */
export async function runStoryMemoryBackfillBatch(batchSize = 50): Promise<BackfillResult> {
  await verifyAdmin();

  const flags = await getAgenticFlags();
  if (!flags.creatorEnabled) {
    throw new Error('The Agentic Creator System is disabled. Enable it in /admin/agents before backfilling memory.');
  }

  return backfillStoryMemoryFromStorylines(batchSize);
}

/** Restarts the backfill from the beginning on the next batch. */
export async function resetStoryMemoryBackfill(): Promise<void> {
  await verifyAdmin();
  await resetStoryMemoryBackfillCursor();
}

/**
 * Scores a candidate without recording it as a story. Used by the persona test
 * lab so an admin can see what the novelty check would say before committing to
 * a run. The check itself still writes an agent_novelty_checks audit row.
 */
export async function previewNoveltyCheck(
  stage: NoveltyStage,
  candidate: NoveltyCandidate
): Promise<NoveltyCheckResult> {
  await verifyAdmin();
  return runNoveltyCheck(stage, candidate);
}
