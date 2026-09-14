// Unit 9M: coverage for the server half of "who pays when a reviewer presses a media
// button on an agent draft". The pure half (resolveAgenticBillingIdentity) already has
// its own tests in billing-identity.shared.test.ts; what is tested here is the part
// that decides whether to deviate from ordinary behaviour AT ALL, because the failure
// mode is asymmetric and both directions are expensive:
//
//   - deviating when it should not would route an ordinary author's narration onto the
//     agent account and the service-role client
//   - not deviating when it should is the defect this exists to fix: the reviewer was
//     charged, the audio was generated, and the beat write silently matched no rows
//
// assertCanEditStory is mocked because it is a database read; its own behaviour (owner
// vs. reviewer vs. refused) is covered by reviewers.shared.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// billing-identity.ts is `import 'server-only'`, which throws unconditionally outside a
// Next.js server build -- neutralized the same way lib/pricing/enforcement.test.ts does.
vi.mock('server-only', () => ({}));

const { assertCanEditStoryMock } = vi.hoisted(() => ({ assertCanEditStoryMock: vi.fn() }));

vi.mock('@/lib/agentic/reviewers', () => ({
  assertCanEditStory: assertCanEditStoryMock,
}));

import { resolveAgentDraftServerAuth } from './billing-identity';

const SYSTEM_USER = '00000000-0000-4000-8000-00000000ag3n';
const REVIEWER = 'reviewer-1';
const STORY = 'story-1';

// Only the fields the capability predicates actually read; the rest of AgentReviewer is
// irrelevant to this decision, and spelling it out in full would just invite drift.
const activeReviewer = (overrides: Record<string, unknown> = {}) => ({
  userId: REVIEWER,
  status: 'active',
  role: 'reviewer',
  ...overrides,
});

let originalSystemUser: string | undefined;

beforeEach(() => {
  originalSystemUser = process.env.AGENTIC_SYSTEM_USER_ID;
  process.env.AGENTIC_SYSTEM_USER_ID = SYSTEM_USER;
  assertCanEditStoryMock.mockReset();
});

afterEach(() => {
  if (originalSystemUser === undefined) delete process.env.AGENTIC_SYSTEM_USER_ID;
  else process.env.AGENTIC_SYSTEM_USER_ID = originalSystemUser;
});

describe('resolveAgentDraftServerAuth', () => {
  it('routes a reviewer’s call onto the agent account, with the key that unlocks the bypass', async () => {
    assertCanEditStoryMock.mockResolvedValue({
      story: { id: STORY, user_id: SYSTEM_USER, agent_persona_id: 'persona-1' },
      reviewer: activeReviewer(),
    });

    await expect(resolveAgentDraftServerAuth(STORY, REVIEWER)).resolves.toEqual({
      userId: SYSTEM_USER,
      actorKind: 'agentic_system',
    });
  });

  // The line that protects every ordinary author on the site.
  it('does not deviate for the story’s own owner', async () => {
    assertCanEditStoryMock.mockResolvedValue({
      story: { id: STORY, user_id: 'author-1', agent_persona_id: null },
      reviewer: null,
    });

    await expect(resolveAgentDraftServerAuth(STORY, 'author-1')).resolves.toBeUndefined();
  });

  // An unsaved story cannot be an agent draft, and must cost no query at all.
  it('does not deviate, or even look, without a story id', async () => {
    await expect(resolveAgentDraftServerAuth(null, REVIEWER)).resolves.toBeUndefined();
    await expect(resolveAgentDraftServerAuth(undefined, REVIEWER)).resolves.toBeUndefined();
    expect(assertCanEditStoryMock).not.toHaveBeenCalled();
  });

  // Fail closed: naming the agent as payer without 'agentic_system' would bill it as an
  // ordinary user, and it resolves to the free plan -- a denial, not a bypass.
  it('does not deviate when AGENTIC_SYSTEM_USER_ID is unset', async () => {
    delete process.env.AGENTIC_SYSTEM_USER_ID;
    assertCanEditStoryMock.mockResolvedValue({
      story: { id: STORY, user_id: SYSTEM_USER, agent_persona_id: 'persona-1' },
      reviewer: activeReviewer(),
    });

    await expect(resolveAgentDraftServerAuth(STORY, REVIEWER)).resolves.toBeUndefined();
  });

  it('does not deviate when the story owner is not the configured system user', async () => {
    assertCanEditStoryMock.mockResolvedValue({
      story: { id: STORY, user_id: 'some-other-account', agent_persona_id: 'persona-1' },
      reviewer: activeReviewer(),
    });

    await expect(resolveAgentDraftServerAuth(STORY, REVIEWER)).resolves.toBeUndefined();
  });

  // Defence in depth, the same guard submitStoryImageBatch keeps: assertCanEditStory
  // should already have refused a suspended reviewer, so this branch is not expected to
  // be reachable -- but if it ever is, refusing beats the old behaviour, which was to
  // bill them and then write nothing.
  it('refuses a reviewer who is no longer active', async () => {
    assertCanEditStoryMock.mockResolvedValue({
      story: { id: STORY, user_id: SYSTEM_USER, agent_persona_id: 'persona-1' },
      reviewer: activeReviewer({ status: 'suspended' }),
    });

    await expect(resolveAgentDraftServerAuth(STORY, REVIEWER)).rejects.toThrow('Forbidden.');
  });

  // Generating media on a story you cannot edit was never something to fall through on.
  it('propagates a refusal from assertCanEditStory', async () => {
    assertCanEditStoryMock.mockRejectedValue(new Error('Forbidden.'));

    await expect(resolveAgentDraftServerAuth(STORY, 'stranger')).rejects.toThrow('Forbidden.');
  });
});
