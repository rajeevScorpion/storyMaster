'use client';

import { getClientStoryPersistenceEnabled } from '@/app/actions/client-persistence';
import { createClient } from '@/lib/supabase/client';
import type { StorySession } from '@/lib/types/story';
import { buildTreeStoryManifest } from './manifest';
import { buildStorylineManifest } from './manifest';
import { getStoryPersistence } from './index';
import type { CachedStorylineManifest, CachedTreeStoryManifest, StoryReaderKind, StoryProgress, StorylineManifestPayload } from './types';

const FLAG_STORAGE_KEY = 'kissago_client_story_persistence_enabled';
let enabledPromise: Promise<boolean> | null = null;
const cleanedUsers = new Set<string>();

export async function isClientStoryPersistenceEnabled(): Promise<boolean> {
  if (enabledPromise) return enabledPromise;

  const cachedEnabled = localStorage.getItem(FLAG_STORAGE_KEY) === 'true';
  const refreshEnabled = () => getClientStoryPersistenceEnabled().then((enabled) => {
    localStorage.setItem(FLAG_STORAGE_KEY, enabled ? 'true' : 'false');
    return enabled;
  });

  if (cachedEnabled) {
    enabledPromise = Promise.resolve(true);
    void refreshEnabled()
      .then((enabled) => {
        enabledPromise = Promise.resolve(enabled);
      })
      .catch(() => undefined);
  } else {
    enabledPromise = refreshEnabled().catch(() => false);
  }
  return enabledPromise;
}

export async function getLocalSessionUserId(): Promise<string | null> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

export async function loadCachedTreeStory(input: {
  readerKind: 'story' | 'explore';
  storyId: string;
  userId: string;
}): Promise<{ manifest: CachedTreeStoryManifest; session: StorySession } | null> {
  if (!await isClientStoryPersistenceEnabled()) return null;
  const persistence = getStoryPersistence();
  const manifest = await persistence.getStoryManifest(input);
  if (!manifest || manifest.readerKind === 'storyline') return null;
  const progress = await persistence.getProgress(input);
  let session = manifest.payload;
  if (progress && progress.readerKind !== 'storyline' && session.storyMap.nodes[progress.currentNodeId]) {
    session = {
      ...session,
      storyMap: { ...session.storyMap, currentNodeId: progress.currentNodeId },
    };
  }
  return { manifest, session };
}

function reachableNodeIds(session: StorySession, startNodeId: string, count: number): string[] {
  const result: string[] = [];
  const queue = [startNodeId];
  const seen = new Set<string>();
  while (queue.length > 0 && result.length < count) {
    const nodeId = queue.shift()!;
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    const node = session.storyMap.nodes[nodeId];
    if (!node) continue;
    result.push(nodeId);
    queue.push(...node.children);
  }
  return result;
}

export async function saveTreeStoryAndPrefetch(input: {
  readerKind: 'story' | 'explore';
  session: StorySession;
  userId: string;
}): Promise<void> {
  if (!await isClientStoryPersistenceEnabled()) return;
  const persistence = getStoryPersistence();
  const manifest = buildTreeStoryManifest(input);
  await persistence.saveStoryManifest(manifest);
  const nodeIds = reachableNodeIds(input.session, input.session.storyMap.currentNodeId, 3);
  const assets = manifest.assets.filter((asset) => asset.pageId && nodeIds.includes(asset.pageId));
  await Promise.allSettled(assets.map((asset) => persistence.prefetchMedia(asset)));
  if (!cleanedUsers.has(input.userId)) {
    cleanedUsers.add(input.userId);
    await persistence.cleanup({
      userId: input.userId,
      preserveStoryIds: [manifest.storyId],
      maxStories: 10,
      maxAgeDays: 30,
    });
  }
}

export async function saveTreeProgress(input: {
  readerKind: 'story' | 'explore';
  storyId: string;
  userId: string;
  currentNodeId: string;
  audioTimeMs?: number;
  completed: boolean;
}): Promise<void> {
  if (!await isClientStoryPersistenceEnabled()) return;
  const progress: StoryProgress = {
    ...input,
    audioTimeMs: input.audioTimeMs ?? 0,
    updatedAt: new Date().toISOString(),
  };
  await getStoryPersistence().saveProgress(progress);
}

export function readerKindForSession(session: StorySession): Exclude<StoryReaderKind, 'storyline'> {
  return session.explorationMode ? 'explore' : 'story';
}

export async function loadCachedStoryline(input: {
  storylineId: string;
  storyId: string;
  userId: string;
}): Promise<{ manifest: CachedStorylineManifest; progress: StoryProgress | null } | null> {
  if (!await isClientStoryPersistenceEnabled()) return null;
  const persistence = getStoryPersistence();
  const scope = { readerKind: 'storyline' as const, ...input };
  const manifest = await persistence.getStoryManifest(scope);
  if (!manifest || manifest.readerKind !== 'storyline') return null;
  return { manifest, progress: await persistence.getProgress(scope) };
}

export async function saveStorylineAndPrefetch(input: {
  payload: StorylineManifestPayload;
  userId: string;
  sourceUpdatedAt: string;
  currentPageIndex: number;
}): Promise<void> {
  if (!await isClientStoryPersistenceEnabled()) return;
  const persistence = getStoryPersistence();
  const manifest = buildStorylineManifest(input);
  await persistence.saveStoryManifest(manifest);
  const pageIds = new Set([
    input.currentPageIndex,
    input.currentPageIndex + 1,
    input.currentPageIndex + 2,
  ].filter((index) => index >= 0 && index < input.payload.beats.length).map(String));
  await Promise.allSettled(
    manifest.assets.filter((asset) => asset.pageId && pageIds.has(asset.pageId)).map((asset) => persistence.prefetchMedia(asset))
  );
  if (!cleanedUsers.has(input.userId)) {
    cleanedUsers.add(input.userId);
    await persistence.cleanup({
      userId: input.userId,
      preserveStoryIds: [input.payload.storyId],
      maxStories: 10,
      maxAgeDays: 30,
    });
  }
}

export async function saveStorylineProgress(input: {
  storylineId: string;
  storyId: string;
  userId: string;
  currentPageIndex: number;
  audioTimeMs?: number;
  completed: boolean;
}): Promise<void> {
  if (!await isClientStoryPersistenceEnabled()) return;
  await getStoryPersistence().saveProgress({
    ...input,
    readerKind: 'storyline',
    audioTimeMs: input.audioTimeMs ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
