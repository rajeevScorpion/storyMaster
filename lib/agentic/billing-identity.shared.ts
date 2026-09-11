// ── Agentic Creator System: who pays for work a reviewer triggers ────────
//
// Pure, isomorphic, and unit-tested (billing-identity.shared.test.ts) because the
// consequence of getting it wrong is silent and financial: the wrong answer charges
// a real person's wallet for an agent's story, and nothing in the UI says so. The
// original defect (57b516b for narration, Unit 9M for images) was exactly this
// function written inline, three times, as `user.id`.
//
// It lives in a .shared.ts module rather than inline in a 'use server' file for the
// ordinary reason: app/actions/image-batch.ts cannot export a non-action helper for
// a test to import, and a helper that decides who gets billed should not be
// reachable over the network as a server action either.

/**
 * The two identities a billable submit has to keep apart, and which the defect
 * conflated: `payerUserId` is charged, `actorKind` decides whether the agentic
 * bypass may fire for that payer.
 */
export interface AgenticBillingIdentity {
  payerUserId: string;
  actorKind: 'user' | 'agentic_system';
}

/**
 * Resolve who pays for work submitted against a story.
 *
 * A reviewer finishing an agent draft acts on the agent's behalf, so the agent's
 * owner pays -- not the human who happened to press the button. `agentPersonaId`
 * is the test for "this is an agent-owned story": it is set only by
 * lib/agentic/story-assembly.ts's save, so an ordinary author's story has null here
 * and the caller pays exactly as they always did.
 *
 * `actorKind` is derived from the RESOLVED payer, never taken from a caller.
 * authorizeBillableAction's bypass additionally requires its own feature flag and an
 * exact match against AGENTIC_SYSTEM_USER_ID, so this value alone grants nothing --
 * but omitting it makes the bypass unreachable no matter who is named as payer,
 * which is the shape of the original narration defect.
 *
 * `systemUserId` is passed in rather than read from process.env so this stays pure
 * and testable; callers pass process.env.AGENTIC_SYSTEM_USER_ID. An unset value is
 * treated as "no system user configured", which yields 'user' and bills normally --
 * fail closed, never a free pass.
 */
export function resolveAgenticBillingIdentity(input: {
  storyUserId: string;
  agentPersonaId: string | null | undefined;
  callerUserId: string;
  systemUserId: string | null | undefined;
}): AgenticBillingIdentity {
  const payerUserId = input.agentPersonaId ? input.storyUserId : input.callerUserId;
  return {
    payerUserId,
    actorKind:
      input.systemUserId && payerUserId === input.systemUserId ? 'agentic_system' : 'user',
  };
}
