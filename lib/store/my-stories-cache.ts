import type {
  PagedTabId,
  SavedStory,
  SavedStorylineItem,
  UserReel,
} from '@/lib/types/my-stories';
import type { CharacterMaster } from '@/lib/types/character-library';
import type { CharacterUniverseRuntimeSettings } from '@/lib/character-universe/settings';

/** What the drawer keeps on disk between visits. */
export interface CachedMyStoriesSnapshot {
  stories: SavedStory[];
  savedStorylines: SavedStorylineItem[];
  reels: UserReel[];
  characters: CharacterMaster[];
  characterSettings: CharacterUniverseRuntimeSettings | null;
  hasMore: Record<PagedTabId, boolean>;
}

/**
 * Last-session cache for the My Stories drawer.
 *
 * The drawer store is in-memory only, so every fresh page load used to open on
 * skeletons and wait for the server before showing a single row — even though
 * the same rows had been on screen minutes earlier. This keeps the last
 * rendered snapshot in localStorage so the next visit paints instantly and
 * revalidates in the background.
 *
 * localStorage rather than IndexedDB deliberately: the payload is small
 * (~three pages of list rows) and the read is synchronous, which is the whole
 * point — an async read would land after first paint and reintroduce the flash
 * of empty state this exists to remove.
 *
 * The snapshot is scoped to a user id and dropped whenever a different user
 * signs in, so one account never sees another's library.
 */
const CACHE_KEY = 'kissago_my_stories_cache_v1';

/** Beyond this the cache is more likely to mislead than to help. */
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface CacheEnvelope extends CachedMyStoriesSnapshot {
  userId: string;
  savedAt: number;
}

function isArrayOf<T>(value: unknown): value is T[] {
  return Array.isArray(value);
}

export function readMyStoriesCache(userId: string): CachedMyStoriesSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<CacheEnvelope> | null;
    if (!parsed || parsed.userId !== userId) return null;
    if (typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > CACHE_MAX_AGE_MS) {
      window.localStorage.removeItem(CACHE_KEY);
      return null;
    }

    return {
      stories: isArrayOf<SavedStory>(parsed.stories) ? parsed.stories : [],
      savedStorylines: isArrayOf<SavedStorylineItem>(parsed.savedStorylines)
        ? parsed.savedStorylines
        : [],
      reels: isArrayOf<UserReel>(parsed.reels) ? parsed.reels : [],
      characters: isArrayOf<CharacterMaster>(parsed.characters) ? parsed.characters : [],
      characterSettings: (parsed.characterSettings as CharacterUniverseRuntimeSettings | null) ?? null,
      hasMore: {
        'my-stories': parsed.hasMore?.['my-stories'] === true,
        storylines: parsed.hasMore?.storylines === true,
        reels: parsed.hasMore?.reels === true,
      },
    };
  } catch {
    // Corrupt or unavailable storage (private mode, quota) is not an error
    // worth surfacing — the drawer just fetches as it always did.
    return null;
  }
}

export function writeMyStoriesCache(userId: string, snapshot: CachedMyStoriesSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    const envelope: CacheEnvelope = { ...snapshot, userId, savedAt: Date.now() };
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(envelope));
  } catch {
    // Over quota: drop the cache rather than leave a half-written one behind.
    try {
      window.localStorage.removeItem(CACHE_KEY);
    } catch {
      // Storage is entirely unavailable; nothing left to clean up.
    }
  }
}

export function clearMyStoriesCache(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    // Nothing to do — the cache is unreadable anyway.
  }
}
