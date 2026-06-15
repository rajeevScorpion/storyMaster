import type { StoryBeat, StorySession } from '@/lib/types/story';
import { getStableMediaIdentity } from './identity';
import {
  STORY_MANIFEST_SCHEMA_VERSION,
  type CachedStoryManifest,
  type CachedStorylineManifest,
  type CachedTreeStoryManifest,
  type StoryMediaAsset,
  type StoryReaderKind,
  type StorylineManifestPayload,
} from './types';

function assetFromUrl(input: {
  url?: string;
  kind: 'image' | 'audio';
  storyId: string;
  storylineId?: string;
  pageId: string;
  userId: string;
  version?: string;
}): StoryMediaAsset | null {
  if (!input.url || input.url.startsWith('data:')) return null;
  return {
    assetId: getStableMediaIdentity(input.url, input.kind),
    storyId: input.storyId,
    storylineId: input.storylineId,
    pageId: input.pageId,
    userId: input.userId,
    kind: input.kind,
    remoteUrl: input.url,
    version: input.version || 'legacy',
  };
}

function assetsFromBeat(input: {
  beat: StoryBeat;
  storyId: string;
  storylineId?: string;
  pageId: string;
  userId: string;
  fallbackVersion: string;
}): StoryMediaAsset[] {
  return [
    assetFromUrl({
      url: input.beat.imageUrl,
      kind: 'image',
      storyId: input.storyId,
      storylineId: input.storylineId,
      pageId: input.pageId,
      userId: input.userId,
      version: input.beat.imageVersion || input.fallbackVersion,
    }),
    assetFromUrl({
      url: input.beat.audioUrl,
      kind: 'audio',
      storyId: input.storyId,
      storylineId: input.storylineId,
      pageId: input.pageId,
      userId: input.userId,
      version: input.beat.audioVersion || input.fallbackVersion,
    }),
  ].filter((asset): asset is StoryMediaAsset => Boolean(asset));
}

export function buildTreeStoryManifest(input: {
  readerKind: Exclude<StoryReaderKind, 'storyline'>;
  session: StorySession;
  userId: string;
}): CachedTreeStoryManifest {
  const now = new Date().toISOString();
  const storyId = input.session.savedStoryId || input.session.storySessionId;
  const sourceUpdatedAt = input.session.sourceUpdatedAt || now;
  const assets = Object.values(input.session.storyMap.nodes).flatMap((node) => assetsFromBeat({
    beat: node.data,
    storyId,
    pageId: node.id,
    userId: input.userId,
    fallbackVersion: sourceUpdatedAt,
  }));
  return {
    schemaVersion: STORY_MANIFEST_SCHEMA_VERSION,
    readerKind: input.readerKind,
    storyId,
    userId: input.userId,
    title: input.session.title,
    sourceUpdatedAt,
    cachedAt: now,
    lastOpenedAt: now,
    assets,
    payload: input.session,
  };
}

export function buildStorylineManifest(input: {
  payload: StorylineManifestPayload;
  userId: string;
  sourceUpdatedAt: string;
}): CachedStorylineManifest {
  const now = new Date().toISOString();
  const assets = input.payload.beats.flatMap((beat, index) => assetsFromBeat({
    beat,
    storyId: input.payload.storyId,
    storylineId: input.payload.storylineId,
    pageId: String(index),
    userId: input.userId,
    fallbackVersion: input.sourceUpdatedAt,
  }));
  return {
    schemaVersion: STORY_MANIFEST_SCHEMA_VERSION,
    readerKind: 'storyline',
    storyId: input.payload.storyId,
    storylineId: input.payload.storylineId,
    userId: input.userId,
    title: input.payload.title,
    sourceUpdatedAt: input.sourceUpdatedAt,
    cachedAt: now,
    lastOpenedAt: now,
    assets,
    payload: input.payload,
  };
}

export function migrateCachedStoryManifest(input: unknown): CachedStoryManifest | null {
  if (!input || typeof input !== 'object') return null;
  const candidate = input as Partial<CachedStoryManifest>;
  if (candidate.schemaVersion !== STORY_MANIFEST_SCHEMA_VERSION) return null;
  if (!candidate.storyId || !candidate.userId || !candidate.readerKind || !candidate.payload) return null;
  if (!Array.isArray(candidate.assets)) return null;
  if (candidate.assets.some((asset) => !asset.assetId || !asset.remoteUrl || asset.remoteUrl.startsWith('data:'))) return null;
  if (candidate.readerKind === 'storyline' && !candidate.storylineId) return null;
  return candidate as CachedStoryManifest;
}

export function findBeatAsset(
  manifest: CachedStoryManifest | null,
  pageId: string,
  kind: 'image' | 'audio'
): StoryMediaAsset | undefined {
  return manifest?.assets.find((asset) => asset.pageId === pageId && asset.kind === kind);
}
