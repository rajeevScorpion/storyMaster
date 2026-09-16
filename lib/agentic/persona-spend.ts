import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { isMissingReviewerSchemaError } from '@/lib/agentic/reviewers.shared';
import {
  buildPersonaSpendReport,
  type PersonaSpendReport,
  type PersonaSpendRow,
} from '@/lib/agentic/persona-spend.shared';

// ── Agentic Creator System: the persona spend report's data ──────────────
//
// Three small reads, assembled by the pure function in persona-spend.shared.ts.
// Nothing here is written; this module only ever reads.
//
// The agentic account is the filter that keeps this bounded: every charge for agent
// work lands on that one account (a reviewer finishing a draft is never charged), so
// the spend query is narrow rather than a scan of everyone's billing history.
//
// Fails closed and quietly. A database without the agentic migrations has no personas
// table to read, and an environment with no agentic account configured has nothing to
// report -- both return an empty report with a reason, never an error page.

export interface PersonaSpendResult {
  report: PersonaSpendReport | null;
  /** Why there is nothing to show, when there is nothing to show. */
  unavailable: 'schema_missing' | 'no_agentic_account' | null;
}

const EMPTY_REPORT: PersonaSpendReport = {
  personas: [],
  totalBeats: 0,
  totalCoins: 0,
  totalOperations: 0,
  unattributedBeats: 0,
  unattributedOperations: 0,
  bypassedBeats: 0,
};

/**
 * How many charges to read. Well above anything the agents can currently produce, and
 * present so a runaway never turns an admin page into a full-table scan. If this cap is
 * ever actually reached, the fix is a date filter on the page, not a bigger number.
 */
const MAX_SPEND_ROWS = 5000;

export async function getPersonaSpendReport(): Promise<PersonaSpendResult> {
  const systemUserId = process.env.AGENTIC_SYSTEM_USER_ID;
  if (!systemUserId) {
    return { report: EMPTY_REPORT, unavailable: 'no_agentic_account' };
  }

  const admin = createAdminClient();

  const personasResult = await admin
    .from('agent_personas')
    .select('id, display_name, slug, status');
  if (personasResult.error) {
    if (isMissingReviewerSchemaError(personasResult.error)) {
      return { report: EMPTY_REPORT, unavailable: 'schema_missing' };
    }
    throw new Error(`Failed to load personas: ${personasResult.error.message}`);
  }

  const storiesResult = await admin
    .from('stories')
    .select('id, agent_persona_id')
    .not('agent_persona_id', 'is', null);
  if (storiesResult.error) {
    // stories.agent_persona_id arrives with migration 103; without it there are no
    // agent stories to attribute anything to.
    if (isMissingReviewerSchemaError(storiesResult.error)) {
      return { report: EMPTY_REPORT, unavailable: 'schema_missing' };
    }
    throw new Error(`Failed to load agent stories: ${storiesResult.error.message}`);
  }

  // 'finalized' only: that is spend that actually completed. A reservation still in
  // flight has not happened yet, and a released or failed one never did.
  const spendResult = await admin
    .from('beat_spend_reservations')
    .select('related_story_id, action_key, requested_beat_cost, metadata_json')
    .eq('user_id', systemUserId)
    .eq('status', 'finalized')
    .order('created_at', { ascending: false })
    .limit(MAX_SPEND_ROWS);
  if (spendResult.error) {
    throw new Error(`Failed to load agent spend: ${spendResult.error.message}`);
  }

  const storyPersona = new Map<string, string>();
  for (const story of storiesResult.data ?? []) {
    if (story.agent_persona_id) storyPersona.set(story.id, story.agent_persona_id);
  }

  const rows: PersonaSpendRow[] = (spendResult.data ?? []).map((row) => {
    const metadata = (row.metadata_json ?? {}) as Record<string, unknown>;
    return {
      relatedStoryId: row.related_story_id ?? null,
      actionKey: row.action_key ?? 'unknown',
      beatCost: Number(row.requested_beat_cost ?? 0),
      wasBypassed: metadata.agenticBypass === true,
    };
  });

  return {
    report: buildPersonaSpendReport({
      rows,
      storyPersona,
      personas: (personasResult.data ?? []).map((persona) => ({
        id: persona.id,
        displayName: persona.display_name ?? 'Untitled persona',
        slug: persona.slug ?? null,
        status: persona.status ?? null,
      })),
    }),
    unavailable: null,
  };
}
