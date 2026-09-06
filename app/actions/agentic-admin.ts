'use server';

// Admin toggles for the Agentic Creator System's six feature flags. Mirrors
// the shape of setVideoDownload() etc. in app/actions/admin.ts: verify admin,
// then write through setFeatureFlag(). Flags are read back exclusively
// through lib/agentic/flags.ts — see that file's header for why.
//
// Shared types (AgenticFlags, AGENTIC_FLAG_KEYS) live in lib/agentic/flags.ts,
// not here — a 'use server' file may only export async functions.

import { verifyAdmin } from '@/lib/supabase/admin';
import { setFeatureFlag } from '@/lib/ai/model-config';
import { getAgenticFlags, type AgenticFlags } from '@/lib/agentic/flags';

export async function getAgenticFlagsAction(): Promise<AgenticFlags> {
  await verifyAdmin();
  return getAgenticFlags();
}

export async function setAgenticCreatorEnabled(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('agentic_creator_enabled', enabled);
}

export async function setAgenticSchedulerEnabled(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('agentic_scheduler_enabled', enabled);
}

export async function setAgenticSupervisorEnabled(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('agentic_supervisor_enabled', enabled);
}

export async function setAgenticReviewerWorkflowEnabled(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('agentic_reviewer_workflow_enabled', enabled);
}

export async function setAgenticBillingBypassEnabled(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('agentic_billing_bypass_enabled', enabled);
}

export async function setAgenticImageGenerationEnabled(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('agentic_image_generation_enabled', enabled);
}
