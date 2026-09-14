import { describe, it, expect } from 'vitest';
import { resolveAgenticBillingIdentity } from './billing-identity.shared';

const SYSTEM = 'system-user-id';
const REVIEWER = 'reviewer-user-id';
const AUTHOR = 'author-user-id';

describe('resolveAgenticBillingIdentity', () => {
  it('bills the agent owner, not the reviewer who pressed the button', () => {
    expect(resolveAgenticBillingIdentity({
      storyUserId: SYSTEM,
      agentPersonaId: 'persona-1',
      callerUserId: REVIEWER,
      systemUserId: SYSTEM,
    })).toEqual({ payerUserId: SYSTEM, actorKind: 'agentic_system' });
  });

  // The regression that matters most: an ordinary author generating visuals on their
  // own story must be untouched by any of this.
  it('bills the author on their own story, as an ordinary user', () => {
    expect(resolveAgenticBillingIdentity({
      storyUserId: AUTHOR,
      agentPersonaId: null,
      callerUserId: AUTHOR,
      systemUserId: SYSTEM,
    })).toEqual({ payerUserId: AUTHOR, actorKind: 'user' });
  });

  it('treats an undefined agentPersonaId the same as null', () => {
    expect(resolveAgenticBillingIdentity({
      storyUserId: AUTHOR,
      agentPersonaId: undefined,
      callerUserId: AUTHOR,
      systemUserId: SYSTEM,
    }).payerUserId).toBe(AUTHOR);
  });

  // An empty-string persona id is falsy, and a story with no persona is not an agent
  // story -- so this must bill the caller rather than quietly redirecting to the owner.
  it('does not treat an empty persona id as agent ownership', () => {
    expect(resolveAgenticBillingIdentity({
      storyUserId: SYSTEM,
      agentPersonaId: '',
      callerUserId: REVIEWER,
      systemUserId: SYSTEM,
    })).toEqual({ payerUserId: REVIEWER, actorKind: 'user' });
  });

  it('fails closed to actorKind "user" when no system user is configured', () => {
    for (const systemUserId of [undefined, null, '']) {
      expect(resolveAgenticBillingIdentity({
        storyUserId: SYSTEM,
        agentPersonaId: 'persona-1',
        callerUserId: REVIEWER,
        systemUserId,
      })).toEqual({ payerUserId: SYSTEM, actorKind: 'user' });
    }
  });

  // actorKind follows the RESOLVED payer. An agent-owned story whose owner is somehow
  // not the configured system user must not be handed the bypass on the strength of
  // being agent-owned alone.
  it('grants agentic_system only on an exact payer match, never on agent ownership alone', () => {
    expect(resolveAgenticBillingIdentity({
      storyUserId: 'some-other-owner',
      agentPersonaId: 'persona-1',
      callerUserId: REVIEWER,
      systemUserId: SYSTEM,
    })).toEqual({ payerUserId: 'some-other-owner', actorKind: 'user' });
  });

  // The inverse: a caller who IS the system user, on an ordinary story, still resolves
  // to themselves -- the function never invents a payer neither party named.
  it('bills a system-user caller as themselves on a non-agent story', () => {
    expect(resolveAgenticBillingIdentity({
      storyUserId: SYSTEM,
      agentPersonaId: null,
      callerUserId: SYSTEM,
      systemUserId: SYSTEM,
    })).toEqual({ payerUserId: SYSTEM, actorKind: 'agentic_system' });
  });
});
