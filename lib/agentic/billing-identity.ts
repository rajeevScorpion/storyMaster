import 'server-only';

// ── Agentic Creator System: acting on an agent draft's behalf, server half ──
//
// The server-only sibling of billing-identity.shared.ts. That module answers "given a
// story row and a caller, who pays"; this one fetches the row, checks the caller is
// actually allowed to be doing this, and returns the `serverAuth` shape every media
// path in this codebase already threads through.
//
// WHY A serverAuth SHAPE RATHER THAN JUST A PAYER ID. The narration and image paths
// already carry an optional `serverAuth: { userId, actorKind }` for their background
// workers, and everything that has to follow the payer already keys off it: which
// Supabase client is used (service-role vs. the caller's session), the storage path
// prefix, the beat write, and the billing reservation. A reviewer finishing an agent
// draft needs exactly that same treatment, so this hands back the same object rather
// than inventing a parallel mechanism that each call site would have to honour
// separately -- which is how the interactive path came to be missed twice already.
//
// THE DEFECT THIS EXISTS FOR, measured on dev rather than reasoned about. Pressing
// "generate narration" on an agent draft as a reviewer: both charges (0.50
// generate_story_narration and 0.30 align_story_text_overlay) were finalized against
// the REVIEWER, the audio was really generated and paid for, and then nothing
// persisted -- audio_url stayed null and audio_status stayed 'not_requested', because
// the beat write ran on the reviewer's own session against owner-only RLS and matched
// no rows. No error surfaced anywhere. That is the same silent-write class as the
// story-save bug in 3347ffb, with a real charge attached.
//
// 57b516b fixed the narration BATCH path and a5e9bff fixed both image submit paths.
// Neither touched the interactive single-beat path, because nothing there resolved an
// agentic payer at all.

import { assertCanEditStory } from '@/lib/agentic/reviewers';
import { canTriggerMediaForEditAccess } from '@/lib/agentic/reviewers.shared';
import { resolveAgenticBillingIdentity } from '@/lib/agentic/billing-identity.shared';

/** The shape narration/image paths already accept for "act on behalf of this account". */
export interface AgentDraftServerAuth {
  userId: string;
  actorKind: 'user' | 'agentic_system';
}

/**
 * The `serverAuth` a reviewer's interactive media call should run under, or `undefined`
 * when there is no reason to deviate from ordinary behaviour.
 *
 * Returns `undefined` -- meaning "behave exactly as before, on the caller's own session
 * and wallet" -- for every one of:
 *   - no story id (an unsaved story cannot be an agent draft; agent drafts are always
 *     saved by lib/agentic/story-assembly.ts before a reviewer can ever see one)
 *   - the caller is the story's OWNER (assertCanEditStory returns `reviewer: null`),
 *     which is every ordinary author on their own story, and also the agent account
 *     itself when the pipeline runs
 *   - the story is not agent-owned
 *   - AGENTIC_SYSTEM_USER_ID is unset or does not match the story's owner, so the
 *     resolved actor kind is not 'agentic_system'. Naming a payer without that key
 *     would bill the agent account as an ordinary user, and it holds no subscription
 *     and no entitlement override -- it resolves to the free plan, so the call would be
 *     DENIED rather than bypassed. Failing closed to today's behaviour is the safer of
 *     the two wrong answers, and matches what a5e9bff chose for images.
 *
 * THROWS for the one case that must not be allowed to proceed quietly: a reviewer who
 * reaches an agent draft but lacks `can_trigger_media`. Today that call bills them and
 * writes nothing; refusing is both honest and exactly what submitStoryImageBatch
 * already does through the same `canTriggerMediaForEditAccess` gate.
 *
 * A caller with no access at all makes assertCanEditStory throw, which propagates --
 * media generation on someone else's story was never something to fall through on.
 */
export async function resolveAgentDraftServerAuth(
  storyId: string | null | undefined,
  callerUserId: string
): Promise<AgentDraftServerAuth | undefined> {
  if (!storyId) return undefined;

  const { story, reviewer } = await assertCanEditStory(storyId, callerUserId);

  // The owner branch. Never deviate: an ordinary author, and the agent account's own
  // pipeline, both land here and must keep the exact behaviour they have.
  if (!reviewer) return undefined;

  if (!canTriggerMediaForEditAccess(reviewer)) {
    throw new Error('Forbidden.');
  }

  const identity = resolveAgenticBillingIdentity({
    storyUserId: story.user_id,
    agentPersonaId: story.agent_persona_id,
    callerUserId,
    systemUserId: process.env.AGENTIC_SYSTEM_USER_ID,
  });

  if (identity.actorKind !== 'agentic_system') return undefined;

  return { userId: identity.payerUserId, actorKind: identity.actorKind };
}
