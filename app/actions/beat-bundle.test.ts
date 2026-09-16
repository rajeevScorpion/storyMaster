// Phase 10 Round 1b, fix B: processBeatVisuals's 'existing' target used to gate on
// a plain `story.user_id !== user.id` comparison, which is not reviewer-aware. It
// runs AFTER generateBeatCore's own assertCanEditStory check has already reserved
// coins and generated the beat (beat-bundle.ts lines ~120-141), so a reviewer
// continuing an agent draft through the bundle path was charged and then refused
// here -- the same charge-and-write-nothing defect class already fixed four times
// in this phase (3347ffb, a5e9bff, 4974611, 04e739b). beat_bundle_enabled is ON in
// dev, so this was reachable today, not merely theoretical.
//
// This proves two things:
// 1. A signed-in non-owner, non-reviewer is refused BEFORE any downstream work
//    (model overrides, portraits, save, enqueue) runs -- no wasted work, no
//    partial write.
// 2. A reviewer authorized via assertCanEditStory's reviewer branch is let through
//    all the way to a queued image job -- the exact case the old direct-equality
//    check refused.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/agentic/reviewers', () => ({
  assertCanEditStory: vi.fn(),
}));

vi.mock('@/lib/ai/model-config', () => ({
  getFeatureFlag: vi.fn(),
}));

vi.mock('@/lib/media/processing-mode', () => ({
  resolveEffectiveProcessingMode: vi.fn(),
}));

vi.mock('@/app/actions/admin', () => ({
  getStoryModelOverrides: vi.fn(),
}));

vi.mock('@/app/actions/persistence', () => ({
  saveBeat: vi.fn(),
  saveStory: vi.fn(),
  updateBeatMediaState: vi.fn(),
}));

vi.mock('@/app/actions/image-jobs', () => ({
  enqueueBeatImageJob: vi.fn(),
}));

vi.mock('@/app/actions/cost-tracking', () => ({
  linkCostEventsToBeat: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/pricing/image-aware-authorize', () => ({
  authorizeImageModelBillableActionForUser: vi.fn(),
}));

vi.mock('@/lib/pricing/enforcement', () => ({
  releaseBillableAction: vi.fn(),
}));

vi.mock('@/lib/ai/beat-orchestration', () => ({
  composeStoryboardPlan: vi.fn(),
  generateStoryBeat: vi.fn(),
  buildFinalStoryboardImagePrompt: vi.fn(() => 'legacy prompt'),
  mergeCharacterVisualReferences: vi.fn((beat: unknown) => beat),
  renderStoryboardPlan: vi.fn(() => 'rendered plan'),
  withGeneratedOrigin: vi.fn((beat: unknown) => beat),
}));

vi.mock('@/lib/ai/prompt-compiler/scene-spec.shared', () => ({
  buildCanonicalImageScene: vi.fn(() => ({})),
  resolveImageFacingNames: vi.fn(() => new Map()),
}));

vi.mock('@/lib/ai/prompt-compiler/assemble.shared', () => ({
  assembleFinalImagePrompt: vi.fn(() => ({ finalPrompt: 'compiled prompt', compiler: undefined })),
}));

vi.mock('@/app/actions/prompt-compiler', () => ({
  resolveImagePromptCompilerRuntimeAction: vi.fn(),
}));

vi.mock('@/lib/ai/portraits-server', () => ({
  collectCharacterPortraitReferences: vi.fn(() => []),
  generatePortraitsForPlanServer: vi.fn(),
  mergeServerReferenceImages: vi.fn(() => []),
  persistBeatPortraitsServer: vi.fn(),
}));

vi.mock('@/lib/types/beat-media', () => ({
  normalizeBeatMediaFields: vi.fn((beat: unknown) => beat),
}));

vi.mock('@/lib/types/storyboard-settings', () => ({
  normalizeStoryboardImageQualitySettings: vi.fn(() => ({ imageSize: '1K' })),
}));

import { createClient } from '@/lib/supabase/server';
import { assertCanEditStory } from '@/lib/agentic/reviewers';
import { getStoryModelOverrides } from '@/app/actions/admin';
import { saveBeat } from '@/app/actions/persistence';
import { enqueueBeatImageJob } from '@/app/actions/image-jobs';
import { generatePortraitsForPlanServer } from '@/lib/ai/portraits-server';
import { resolveImagePromptCompilerRuntimeAction } from '@/app/actions/prompt-compiler';
import { processBeatVisuals, type ProcessBeatVisualsInput } from '@/app/actions/beat-bundle';

const createClientMock = vi.mocked(createClient);
const assertCanEditStoryMock = vi.mocked(assertCanEditStory);
const getStoryModelOverridesMock = vi.mocked(getStoryModelOverrides);
const saveBeatMock = vi.mocked(saveBeat);
const enqueueBeatImageJobMock = vi.mocked(enqueueBeatImageJob);
const generatePortraitsForPlanServerMock = vi.mocked(generatePortraitsForPlanServer);
const resolveImagePromptCompilerRuntimeActionMock = vi.mocked(resolveImagePromptCompilerRuntimeAction);

const REVIEWER_USER_ID = 'reviewer-user-id';
const STRANGER_USER_ID = 'stranger-user-id';

function signedInAs(userId: string) {
  createClientMock.mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: userId } }, error: null }) },
  } as any);
}

function fakeInput(): ProcessBeatVisualsInput {
  return {
    target: {
      kind: 'existing',
      storyId: 'story-1',
      nodeId: 'node-2',
      parentNodeId: 'node-1',
      selectedOptionId: 'opt-1',
    },
    beat: {
      beatNumber: 2,
      storyText: 'The story continues.',
      characters: [],
      options: [],
      clues: [],
    } as any,
    storyboardPlan: { portraitTasks: [] } as any,
    visualStyle: 'storybook',
    storyConfig: {} as any,
    storyAspectRatio: '16:9' as any,
    reservationId: 'reservation-1',
    imageContinuityStrategy: 'reuse_previous' as any,
    storySessionId: 'session-1',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveImagePromptCompilerRuntimeActionMock.mockResolvedValue(null as any);
});

describe("processBeatVisuals -- the 'existing' target ownership gate is reviewer-aware", () => {
  it('refuses a signed-in non-owner, non-reviewer before any downstream work runs', async () => {
    signedInAs(STRANGER_USER_ID);
    assertCanEditStoryMock.mockRejectedValue(new Error('Forbidden.'));

    const result = await processBeatVisuals(fakeInput());

    expect(result).toEqual({ status: 'not_queued', reason: 'forbidden', message: 'Forbidden.' });
    expect(assertCanEditStoryMock).toHaveBeenCalledWith('story-1', STRANGER_USER_ID, ['id']);
    // The whole point: no wasted work and nothing written after the gate refuses.
    expect(getStoryModelOverridesMock).not.toHaveBeenCalled();
    expect(saveBeatMock).not.toHaveBeenCalled();
    expect(enqueueBeatImageJobMock).not.toHaveBeenCalled();
  });

  it("passes a story that doesn't exist through as 'Story not found.', not 'Forbidden.'", async () => {
    signedInAs(STRANGER_USER_ID);
    assertCanEditStoryMock.mockRejectedValue(new Error('Story not found.'));

    const result = await processBeatVisuals(fakeInput());

    expect(result).toEqual({ status: 'not_queued', reason: 'forbidden', message: 'Story not found.' });
  });

  it('lets a reviewer continue an agent draft through to a queued image job', async () => {
    signedInAs(REVIEWER_USER_ID);
    assertCanEditStoryMock.mockResolvedValue({
      story: { id: 'story-1', user_id: 'agentic-system-user', agent_persona_id: 'persona-1' },
      reviewer: { userId: REVIEWER_USER_ID, canTriggerMedia: true },
    } as any);
    getStoryModelOverridesMock.mockResolvedValue(undefined as any);
    generatePortraitsForPlanServerMock.mockResolvedValue({ references: [], latestState: null });
    saveBeatMock.mockResolvedValue({ beatId: 'beat-2' });
    enqueueBeatImageJobMock.mockResolvedValue({ status: 'queued' } as any);

    const result = await processBeatVisuals(fakeInput());

    expect(assertCanEditStoryMock).toHaveBeenCalledWith('story-1', REVIEWER_USER_ID, ['id']);
    expect(saveBeatMock).toHaveBeenCalled();
    expect(enqueueBeatImageJobMock).toHaveBeenCalled();
    expect(result).toEqual({
      status: 'queued',
      storyId: 'story-1',
      nodeId: 'node-2',
      savedByUserId: REVIEWER_USER_ID,
      beat: expect.objectContaining({ beatNumber: 2 }),
    });
  });
});
