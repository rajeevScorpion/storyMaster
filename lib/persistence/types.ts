import type { StoryBeat, StorySession } from '@/lib/types/story';
import type { StoryTransitionSettings } from '@/lib/story-transitions/settings';

export const STORY_MANIFEST_SCHEMA_VERSION = 2;

export type StoryReaderKind = 'story' | 'explore' | 'storyline';
export type StoryMediaKind = 'image' | 'audio';

export interface StoryManifestScope {
  readerKind: StoryReaderKind;
  storyId: string;
  storylineId?: string;
  userId: string;
}

export interface StoryMediaAsset {
  assetId: string;
  storyId: string;
  storylineId?: string;
  pageId?: string;
  userId: string;
  kind: StoryMediaKind;
  remoteUrl: string;
  version: string;
  contentType?: string;
  byteSize?: number;
}

export interface StorylineManifestPayload {
  storylineId: string;
  storyId: string;
  title: string;
  isVerticalStory: boolean;
  aspectRatio: '16:9' | '9:16';
  storyTransition?: StoryTransitionSettings;
  beats: StoryBeat[];
  choices: Array<{ fromBeat: number; optionLabel: string }>;
  authorName: string | null;
  isOwner: boolean;
  isSaved: boolean;
  isLiked: boolean;
  likeCount: number;
  isLoggedIn: boolean;
}

interface CachedStoryManifestBase extends StoryManifestScope {
  schemaVersion: typeof STORY_MANIFEST_SCHEMA_VERSION;
  title: string;
  sourceUpdatedAt: string;
  cachedAt: string;
  lastOpenedAt: string;
  assets: StoryMediaAsset[];
}

export interface CachedTreeStoryManifest extends CachedStoryManifestBase {
  readerKind: 'story' | 'explore';
  payload: StorySession;
}

export interface CachedStorylineManifest extends CachedStoryManifestBase {
  readerKind: 'storyline';
  storylineId: string;
  payload: StorylineManifestPayload;
}

export type CachedStoryManifest = CachedTreeStoryManifest | CachedStorylineManifest;

export type StoryProgress =
  | {
      readerKind: 'story' | 'explore';
      storyId: string;
      userId: string;
      currentNodeId: string;
      audioTimeMs: number;
      completed: boolean;
      updatedAt: string;
    }
  | {
      readerKind: 'storyline';
      storyId: string;
      storylineId: string;
      userId: string;
      currentPageIndex: number;
      audioTimeMs: number;
      completed: boolean;
      updatedAt: string;
    };

export interface ResolvedMedia {
  assetId: string;
  source: 'remote' | 'cache-storage' | 'capacitor-filesystem';
  url: string;
  cacheHit: boolean;
  resolvedAt: string;
}

export interface StorageStats {
  estimatedUsageBytes?: number;
  estimatedQuotaBytes?: number;
  cachedStoryCount: number;
  cachedAssetCount: number;
}

export interface CleanupOptions {
  userId: string;
  preserveStoryIds?: string[];
  maxStories?: number;
  maxAgeDays?: number;
}

export interface StoryPersistence {
  getStoryManifest(scope: StoryManifestScope): Promise<CachedStoryManifest | null>;
  saveStoryManifest(manifest: CachedStoryManifest): Promise<void>;
  getProgress(scope: StoryManifestScope): Promise<StoryProgress | null>;
  saveProgress(progress: StoryProgress): Promise<void>;
  resolveMedia(asset: StoryMediaAsset): Promise<ResolvedMedia>;
  prefetchMedia(asset: StoryMediaAsset): Promise<ResolvedMedia>;
  removeStory(userId: string, storyId: string): Promise<void>;
  clearUser(userId: string): Promise<void>;
  getStorageStats(userId: string): Promise<StorageStats>;
  cleanup(options: CleanupOptions): Promise<void>;
  releaseMedia(url: string): void;
}
