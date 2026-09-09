// D13/Unit 9d: the first coverage this module has ever had.
//
// Two things are proven here:
//
// 1. submitStoryNarrationBatch stamps narration_batch_jobs.user_id with the STORY
//    OWNER for an agent-owned story, never the reviewer who pressed the button --
//    this is the step the handoff's original "derive actorKind from job.user_id"
//    prescription silently depended on and never did (D13's whole "correction, not
//    confirmation" section). Skipping this step would make every other change in
//    this unit a no-op that still bills the reviewer.
// 2. processNarrationJob derives actorKind from job.user_id, and does so EVERY time
//    it runs -- including when reconcileStoryNarration / reconcileActiveNarrationJobs
//    re-enter it with nothing but the job row and no memory of who submitted or why.
//    A submit-time-only design (stamping actorKind once, at insert) would have passed
//    every other test here and still silently lost the bypass on exactly this path,
//    which is why the plan calls out the recovery path by name.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { adminState } = vi.hoisted(() => ({ adminState: { client: null as any } }));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => adminState.client,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/agentic/reviewers', () => ({
  assertCanEditStory: vi.fn(),
}));

vi.mock('@/lib/agentic/reviewers.shared', () => ({
  canTriggerMediaForEditAccess: vi.fn(),
}));

vi.mock('@/lib/ai/story-config', () => ({
  normalizeStoryConfig: vi.fn(),
}));

vi.mock('@/lib/utils/story-map', () => ({
  getPathToNode: vi.fn(),
}));

vi.mock('@/app/actions/narration', () => ({
  resolveNarrationVoiceServer: vi.fn(),
}));

vi.mock('@/app/actions/story-narration', () => ({
  generateAndPersistStoryNarrationWithOverlay: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import { assertCanEditStory } from '@/lib/agentic/reviewers';
import { canTriggerMediaForEditAccess } from '@/lib/agentic/reviewers.shared';
import { normalizeStoryConfig } from '@/lib/ai/story-config';
import { getPathToNode } from '@/lib/utils/story-map';
import { resolveNarrationVoiceServer } from '@/app/actions/narration';
import { generateAndPersistStoryNarrationWithOverlay } from '@/app/actions/story-narration';
import {
  submitStoryNarrationBatch,
  reconcileStoryNarration,
  reconcileActiveNarrationJobs,
} from '@/app/actions/narration-batch';

const createClientMock = vi.mocked(createClient);
const assertCanEditStoryMock = vi.mocked(assertCanEditStory);
const canTriggerMediaForEditAccessMock = vi.mocked(canTriggerMediaForEditAccess);
const normalizeStoryConfigMock = vi.mocked(normalizeStoryConfig);
const getPathToNodeMock = vi.mocked(getPathToNode);
const resolveNarrationVoiceServerMock = vi.mocked(resolveNarrationVoiceServer);
const generateAndPersistMock = vi.mocked(generateAndPersistStoryNarrationWithOverlay);

const AGENTIC_SYSTEM_USER_ID = 'agentic-system-user-id';
const REVIEWER_USER_ID = 'reviewer-user-id';
const OWNER_USER_ID = 'ordinary-owner-user-id';

const FAKE_NODE = {
  id: 'n1',
  parentId: null,
  children: [],
  data: {
    beatNumber: 1,
    storyText: 'Once upon a time.',
  },
};

const FAKE_STORY_MAP = {
  currentNodeId: 'n1',
  nodes: { n1: FAKE_NODE },
};

/**
 * A minimal chainable Supabase query-builder double. Every filter method returns
 * itself; a terminal call (.single()/.maybeSingle(), or being awaited directly)
 * resolves via a per-table handler that also sees which call on that table this is
 * (1-indexed) -- narration-batch.ts queries `beats` twice with different intent
 * (first "what already has audio", later "recompute the rollup"), so tests that
 * need different answers at each point key their handler on the call index.
 * insert()/update() payloads are recorded so a test can assert on what was written.
 */
function buildChainableAdmin(
  tableHandlers: Record<string, (callIndex: number) => { data: any; error: any }>
) {
  const callCounts: Record<string, number> = {};
  const inserts: Array<{ table: string; payload: any }> = [];
  const updates: Array<{ table: string; payload: any }> = [];

  function chain(table: string): any {
    const c: any = {
      select: () => c,
      insert: (payload: any) => {
        inserts.push({ table, payload });
        return c;
      },
      update: (payload: any) => {
        updates.push({ table, payload });
        return c;
      },
      eq: () => c,
      in: () => c,
      lt: () => c,
      gt: () => c,
      order: () => c,
      limit: () => c,
      maybeSingle: () => resolveTerminal(),
      single: () => resolveTerminal(),
      then: (resolve: any, reject: any) => resolveTerminal().then(resolve, reject),
    };
    function resolveTerminal() {
      callCounts[table] = (callCounts[table] ?? 0) + 1;
      const handler = tableHandlers[table];
      const result = handler ? handler(callCounts[table]) : { data: null, error: null };
      return Promise.resolve(result);
    }
    return c;
  }

  return { client: { from: (table: string) => chain(table) }, inserts, updates };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true } as any));
  normalizeStoryConfigMock.mockReturnValue({
    language: 'english',
    ageGroup: 'all_ages',
    storyTextOverlay: null,
  } as any);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('submitStoryNarrationBatch -- Unit 9d step 1: who the job bills', () => {
  it('stamps the job with the story OWNER (the system user) for an agent-owned story, not the reviewer who submitted', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: REVIEWER_USER_ID } }, error: null }),
      },
    } as any);
    assertCanEditStoryMock.mockResolvedValue({
      story: {
        id: 'story-agent',
        user_id: AGENTIC_SYSTEM_USER_ID,
        agent_persona_id: 'persona-1',
        story_map: FAKE_STORY_MAP,
        story_config: {},
        genre: 'adventure',
        tone: 'playful',
        target_age: 'all_ages',
      } as any,
      reviewer: { userId: REVIEWER_USER_ID, canTriggerMedia: true } as any,
    });
    canTriggerMediaForEditAccessMock.mockReturnValue(true);
    getPathToNodeMock.mockReturnValue([FAKE_NODE] as any);
    resolveNarrationVoiceServerMock.mockResolvedValue({
      voiceId: 'Zephyr',
      mode: 'legacy_auto',
      genderBucket: null,
      languageCode: 'english',
      accent: null,
    } as any);

    const { client, inserts } = buildChainableAdmin({
      narration_batch_jobs: () => ({ data: { id: 'job-agent' }, error: null }),
      beats: () => ({ data: [], error: null }),
    });
    adminState.client = client;

    const result = await submitStoryNarrationBatch({ storyId: 'story-agent' });

    expect(result.status).toBe('submitted');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('narration_batch_jobs');
    expect(inserts[0].payload.user_id).toBe(AGENTIC_SYSTEM_USER_ID);
    expect(inserts[0].payload.user_id).not.toBe(REVIEWER_USER_ID);
  });

  it('stamps the job with the caller for an ordinary (non-agent) story -- unchanged from before this unit', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: OWNER_USER_ID } }, error: null }),
      },
    } as any);
    assertCanEditStoryMock.mockResolvedValue({
      story: {
        id: 'story-human',
        user_id: OWNER_USER_ID,
        agent_persona_id: null,
        story_map: FAKE_STORY_MAP,
        story_config: {},
        genre: 'adventure',
        tone: 'playful',
        target_age: 'all_ages',
      } as any,
      reviewer: null,
    });
    canTriggerMediaForEditAccessMock.mockReturnValue(true);
    getPathToNodeMock.mockReturnValue([FAKE_NODE] as any);
    resolveNarrationVoiceServerMock.mockResolvedValue({
      voiceId: 'Zephyr',
      mode: 'legacy_auto',
      genderBucket: null,
      languageCode: 'english',
      accent: null,
    } as any);

    const { client, inserts } = buildChainableAdmin({
      narration_batch_jobs: () => ({ data: { id: 'job-human' }, error: null }),
      beats: () => ({ data: [], error: null }),
    });
    adminState.client = client;

    await submitStoryNarrationBatch({ storyId: 'story-human' });

    expect(inserts[0].payload.user_id).toBe(OWNER_USER_ID);
  });
});

describe('processNarrationJob -- actorKind derivation survives a reconcile re-entry', () => {
  function fakeJobRow(userId: string) {
    return {
      id: 'job-1',
      user_id: userId,
      story_id: 'story-1',
      scope: 'current_path',
      status: 'running',
      node_ids: ['n1'],
      voice_id: 'Zephyr',
      voice_mode: 'legacy_auto',
      voice_gender_bucket: null,
      language_code: 'english',
      accent: null,
      item_count: 1,
      succeeded_count: 0,
      failed_count: 0,
    };
  }

  function armAdminForOneBeatJob(userId: string) {
    const { client } = buildChainableAdmin({
      narration_batch_jobs: () => ({ data: [fakeJobRow(userId)], error: null }),
      stories: () => ({
        data: { story_map: FAKE_STORY_MAP, story_config: {}, genre: 'adventure', tone: 'playful' },
        error: null,
      }),
      // Call 1: "which beats already have audio" -- none yet, so the job actually
      // narrates. Call 2+: "recompute rollups" -- reads back as succeeded, so the
      // job reaches a terminal state without needing a re-kick (no network).
      beats: (callIndex) =>
        callIndex === 1
          ? { data: [], error: null }
          : { data: [{ node_id: 'n1', audio_url: 'https://audio.example/n1', audio_status: 'ready' }], error: null },
    });
    adminState.client = client;
  }

  beforeEach(() => {
    generateAndPersistMock.mockResolvedValue({ audioUrl: 'https://audio.example/n1' } as any);
    process.env.AGENTIC_SYSTEM_USER_ID = AGENTIC_SYSTEM_USER_ID;
  });

  it('reconcileStoryNarration re-entry derives actorKind: "agentic_system" from job.user_id alone', async () => {
    armAdminForOneBeatJob(AGENTIC_SYSTEM_USER_ID);

    await reconcileStoryNarration('story-1');

    expect(generateAndPersistMock).toHaveBeenCalledTimes(1);
    const options = generateAndPersistMock.mock.calls[0][8] as { serverAuth?: { userId: string; actorKind?: string } };
    expect(options.serverAuth).toEqual({ userId: AGENTIC_SYSTEM_USER_ID, actorKind: 'agentic_system' });
  });

  it('reconcileActiveNarrationJobs re-entry derives actorKind: "user" for a job whose payer is not the system user', async () => {
    armAdminForOneBeatJob(REVIEWER_USER_ID);

    await reconcileActiveNarrationJobs();

    expect(generateAndPersistMock).toHaveBeenCalledTimes(1);
    const options = generateAndPersistMock.mock.calls[0][8] as { serverAuth?: { userId: string; actorKind?: string } };
    expect(options.serverAuth).toEqual({ userId: REVIEWER_USER_ID, actorKind: 'user' });
  });
});
