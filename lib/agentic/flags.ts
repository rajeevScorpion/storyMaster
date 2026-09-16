import 'server-only';

// ── Agentic Creator System: the one place these flags are read ─────────
//
// This module is the ONLY place in the codebase allowed to read the six
// `agentic_*` feature flags. Every call goes through getFeatureFlags() with
// fallback = false, so:
//   - a database missing migration 102 (no rows for these keys) behaves
//     exactly like one where the whole feature is switched off, and
//   - any Supabase error while reading flags also degrades to feature-off
//     rather than surfacing a 500.
// Dev and prod are expected to drift — the owner applies migrations by hand
// per environment (see PROJECT_STATE.md) — and an unapplied migration has
// already caused one production outage. Keeping every read behind this one
// function, with a hardcoded false fallback, is what makes that safe.
//
// Do not call getFeatureFlag()/getFeatureFlags() with these keys anywhere
// else. Add new agentic flags here first.

import { getFeatureFlags } from '@/lib/ai/model-config';

export const AGENTIC_FLAG_KEYS = [
  'agentic_creator_enabled',
  'agentic_scheduler_enabled',
  'agentic_supervisor_enabled',
  'agentic_reviewer_workflow_enabled',
  'agentic_billing_bypass_enabled',
  // Renamed from agentic_image_generation_enabled (migration 118). The old name
  // read as a general image-generation switch and was repeatedly mistaken for a
  // guard on a REVIEWER's interactive "Regenerate image..." -- it never was one;
  // it only gates the autonomous agent PIPELINE generating images.
  'agentic_pipeline_image_generation_enabled',
] as const;

export interface AgenticFlags {
  /** Master kill switch. Off means: no /admin/agents render, no worker drain, no supervisor tick, no agent generation of any kind. */
  creatorEnabled: boolean;
  /** Lets the existing daily /api/batch/reconcile cron drain the agent queue. */
  schedulerEnabled: boolean;
  /** Lets the Editorial Supervisor commission tasks into the pool. */
  supervisorEnabled: boolean;
  /** Turns on /admin/authors and the human review queue. */
  reviewerWorkflowEnabled: boolean;
  /** Lets the AGENTIC_SYSTEM_USER_ID account skip the coin reservation. Cost telemetry is still recorded. */
  billingBypassEnabled: boolean;
  /** Global gate above each persona's own allow_image_generation for the AUTONOMOUS
   *  PIPELINE only -- it does NOT gate a reviewer's interactive image regeneration
   *  (that has its own authorization path; see app/actions/pricing-enforcement.ts). */
  pipelineImageGenerationEnabled: boolean;
}

export async function getAgenticFlags(): Promise<AgenticFlags> {
  const flags = await getFeatureFlags(AGENTIC_FLAG_KEYS, false);

  return {
    creatorEnabled: flags.agentic_creator_enabled ?? false,
    schedulerEnabled: flags.agentic_scheduler_enabled ?? false,
    supervisorEnabled: flags.agentic_supervisor_enabled ?? false,
    reviewerWorkflowEnabled: flags.agentic_reviewer_workflow_enabled ?? false,
    billingBypassEnabled: flags.agentic_billing_bypass_enabled ?? false,
    pipelineImageGenerationEnabled: flags.agentic_pipeline_image_generation_enabled ?? false,
  };
}
