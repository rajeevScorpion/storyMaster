import { create } from 'zustand';
import { listUserStories, listSavedStorylines, listUserReels } from '@/app/actions/persistence';
import { listExploredStories } from '@/app/actions/exploration';
import {
  getCharacterUniversePayload,
  repairCharacterMasterVisuals,
} from '@/app/actions/character-library';
import { getSessionBootstrap, type SessionBootstrapData } from '@/app/actions/landing-bootstrap';
import { imageTaskForStoryKind } from '@/lib/ai/image-models.shared';
import type { ImageModelSelection, ImageTaskKey } from '@/lib/ai/image-models.shared';
import {
  MY_STORIES_PAGE_SIZE,
  type TabId,
  type PagedTabId,
  type SavedStory,
  type UserReel,
  type ExploredStory,
  type SavedStorylineItem,
} from '@/lib/types/my-stories';
import {
  clearMyStoriesCache,
  readMyStoriesCache,
  writeMyStoriesCache,
} from '@/lib/store/my-stories-cache';
import type { CharacterMaster } from '@/lib/types/character-library';
import type { CharacterUniverseRuntimeSettings } from '@/lib/character-universe/settings';

const STALE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Dedupes the bundled session bootstrap: AuthProvider (on login) and
 * LandingScreen (on mount) both trigger it within the same tick, and we want a
 * single POST. Held at module scope so every store consumer shares it.
 */
let bootstrapInFlight: Promise<SessionBootstrapData | null> | null = null;

/** One thumbnail-repair sweep per page session (see maybeRepairCharacterVisuals). */
let characterRepairAttempted = false;

interface MyStoriesState {
  stories: SavedStory[];
  reels: UserReel[];
  exploredStories: ExploredStory[];
  savedStorylines: SavedStorylineItem[];
  characters: CharacterMaster[];
  /** Flag-gated runtime snapshot shared by the drawer tab + landing picker. */
  characterSettings: CharacterUniverseRuntimeSettings | null;
  characterUniverseLastFetched: number;
  loading: Record<TabId, boolean>;
  lastFetched: Record<TabId, number>;
  /** Another page exists behind the rows currently held, per paged tab. */
  hasMore: Record<PagedTabId, boolean>;
  /** A "Load more" fetch is in flight (distinct from a first-page load). */
  loadingMore: Record<PagedTabId, boolean>;
  /** Owner of the rows in memory; also the key the disk cache is written under. */
  cacheUserId: string | null;

  prefetchAll: () => Promise<void>;
  /**
   * One bundled round trip for the whole signed-in landing surface (drawer
   * tabs + character universe + landing payload). Deduped + staleness-gated;
   * returns the raw payload so LandingScreen can also apply its picker/style
   * sections. Callers that only need the store hydrated can ignore the result.
   */
  bootstrapSession: (input?: {
    imageTaskKey?: ImageTaskKey;
    imageModelSelection?: ImageModelSelection | null;
    force?: boolean;
    /**
     * The caller needs the landing payload (picker, styles, moods) regardless
     * of how fresh the drawer lists are — it is never cached client-side. The
     * user sections still honour the staleness gate, so a landing remount
     * within the window costs the landing payload only.
     */
    requireLandingPayload?: boolean;
  }) => Promise<SessionBootstrapData | null>;
  /** Applies a bootstrap payload to the store (drawer tabs + characters). */
  hydrateFromBootstrap: (data: SessionBootstrapData) => void;
  /**
   * Paints the drawer from the previous session's cache for `userId` and
   * marks that user as the cache owner. Never overwrites rows already fetched
   * this session, and leaves `lastFetched` at 0 so a revalidation still runs.
   */
  hydrateFromCache: (userId: string) => void;
  fetchTab: (tab: TabId) => Promise<void>;
  /** Appends the next page of a paged tab. */
  loadMore: (tab: PagedTabId) => Promise<void>;
  /** Loads the character-universe snapshot + masters together (deduped). */
  ensureCharacterUniverse: (force?: boolean) => Promise<void>;
  clear: () => void;

  // Optimistic mutation helpers
  removeStory: (id: string) => void;
  updateStory: (id: string, patch: Partial<SavedStory>) => void;
  removeReel: (id: string) => void;
  updateReel: (id: string, patch: Partial<UserReel>) => void;
  removeExploredStory: (id: string) => void;
  removeSavedStoryline: (storylineId: string) => void;
  updateCharacter: (id: string, patch: Partial<CharacterMaster>) => void;
  removeCharacter: (id: string) => void;
  invalidateCharacters: () => void;
}

const initialLastFetched: Record<TabId, number> = {
  'my-stories': 0,
  explored: 0,
  storylines: 0,
  reels: 0,
  characters: 0,
};

const initialLoading: Record<TabId, boolean> = {
  'my-stories': false,
  explored: false,
  storylines: false,
  reels: false,
  characters: false,
};

const initialHasMore: Record<PagedTabId, boolean> = {
  'my-stories': false,
  storylines: false,
  reels: false,
};

const initialLoadingMore: Record<PagedTabId, boolean> = {
  'my-stories': false,
  storylines: false,
  reels: false,
};

function isStale(lastFetched: number): boolean {
  return Date.now() - lastFetched > STALE_MS;
}

/**
 * Appends a page, dropping rows already held. Paging is offset-based over a
 * list ordered by recency, so a row updated between two page fetches can
 * arrive twice; de-duping on id keeps React keys unique when it does.
 */
function appendPage<T>(existing: T[], incoming: T[], idOf: (item: T) => string): T[] {
  const seen = new Set(existing.map(idOf));
  return [...existing, ...incoming.filter((item) => !seen.has(idOf(item)))];
}

export const useMyStoriesStore = create<MyStoriesState>((set, get) => ({
  stories: [],
  reels: [],
  exploredStories: [],
  savedStorylines: [],
  characters: [],
  characterSettings: null,
  characterUniverseLastFetched: 0,
  loading: { ...initialLoading },
  lastFetched: { ...initialLastFetched },
  hasMore: { ...initialHasMore },
  loadingMore: { ...initialLoadingMore },
  cacheUserId: null,

  prefetchAll: async () => {
    // Everything the drawer + landing character surface needs now arrives in
    // one bundled round trip (deduped with LandingScreen's own call).
    await get().bootstrapSession();
  },

  bootstrapSession: async (input) => {
    const state = get();
    const tabsFresh = (['my-stories', 'storylines', 'reels'] as TabId[]).every(
      (tab) => !isStale(state.lastFetched[tab])
    );
    const characterFresh =
      state.characterSettings !== null && !isStale(state.characterUniverseLastFetched);
    const includeUserSections = input?.force === true || !tabsFresh || !characterFresh;
    if (!includeUserSections && !input?.requireLandingPayload) {
      return null;
    }
    // Coalesce concurrent callers (AuthProvider + LandingScreen) onto one POST.
    // Every bootstrap carries the landing payload, so a caller that needs it
    // can safely ride an in-flight request started by a caller that didn't.
    if (bootstrapInFlight) return bootstrapInFlight;

    const run = (async (): Promise<SessionBootstrapData | null> => {
      // Only claim the tabs are loading when they are actually being fetched;
      // otherwise a landing-payload-only refresh would flash skeletons over
      // rows that are already on screen.
      if (includeUserSections) {
        set((s) => ({
          loading: {
            ...s.loading,
            'my-stories': true,
            storylines: true,
            reels: true,
            characters: true,
          },
        }));
      }
      try {
        const data = await getSessionBootstrap({
          imageTaskKey: input?.imageTaskKey ?? imageTaskForStoryKind('story'),
          imageModelSelection: input?.imageModelSelection ?? null,
          includeUserSections,
        });
        get().hydrateFromBootstrap(data);
        return data;
      } catch (error) {
        console.error('Failed to bootstrap session:', error);
        return null;
      } finally {
        if (includeUserSections) {
          set((s) => ({
            loading: {
              ...s.loading,
              'my-stories': false,
              storylines: false,
              reels: false,
              characters: false,
            },
          }));
        }
        bootstrapInFlight = null;
      }
    })();
    bootstrapInFlight = run;
    return run;
  },

  hydrateFromBootstrap: (data) => {
    const now = Date.now();
    set((s) => ({
      ...(data.myStories
        ? {
            stories: data.myStories.stories,
            savedStorylines: data.myStories.storylines,
            reels: data.myStories.reels,
            hasMore: {
              'my-stories': data.myStories.hasMore.stories,
              storylines: data.myStories.hasMore.storylines,
              reels: data.myStories.hasMore.reels,
            },
          }
        : {}),
      ...(data.characterUniverse
        ? {
            characterSettings: data.characterUniverse.settings,
            characters: data.characterUniverse.masters,
          }
        : {}),
      lastFetched: {
        ...s.lastFetched,
        ...(data.myStories ? { 'my-stories': now, storylines: now, reels: now } : {}),
        ...(data.characterUniverse ? { characters: now } : {}),
      },
      characterUniverseLastFetched: data.characterUniverse
        ? now
        : s.characterUniverseLastFetched,
    }));
    if (data.characterUniverse) {
      void runCharacterRepairSweep();
    }
  },

  hydrateFromCache: (userId) => {
    const state = get();
    // A different account signing in must never inherit these rows.
    if (state.cacheUserId && state.cacheUserId !== userId) {
      clearMyStoriesCache();
      set({
        stories: [],
        reels: [],
        exploredStories: [],
        savedStorylines: [],
        characters: [],
        characterSettings: null,
        characterUniverseLastFetched: 0,
        lastFetched: { ...initialLastFetched },
        hasMore: { ...initialHasMore },
      });
    }
    set({ cacheUserId: userId });

    const cached = readMyStoriesCache(userId);
    if (!cached) return;

    // Only fill slices this session hasn't fetched yet: a live list always
    // beats a cached one. `lastFetched` deliberately stays 0, so the rows are
    // shown immediately *and* revalidated.
    const current = get();
    set({
      ...(current.lastFetched['my-stories'] === 0 ? { stories: cached.stories } : {}),
      ...(current.lastFetched.storylines === 0
        ? { savedStorylines: cached.savedStorylines }
        : {}),
      ...(current.lastFetched.reels === 0 ? { reels: cached.reels } : {}),
      ...(current.characterUniverseLastFetched === 0
        ? { characters: cached.characters, characterSettings: cached.characterSettings }
        : {}),
      hasMore: {
        'my-stories':
          current.lastFetched['my-stories'] === 0
            ? cached.hasMore['my-stories']
            : current.hasMore['my-stories'],
        storylines:
          current.lastFetched.storylines === 0
            ? cached.hasMore.storylines
            : current.hasMore.storylines,
        reels: current.lastFetched.reels === 0 ? cached.hasMore.reels : current.hasMore.reels,
      },
    });
  },

  fetchTab: async (tab: TabId) => {
    // The Characters tab is owned by ensureCharacterUniverse (snapshot + masters
    // together, with its own loading flag); delegate before touching loading.
    if (tab === 'characters') {
      await get().ensureCharacterUniverse();
      return;
    }

    const state = get();
    // Serve cache if fresh
    if (!isStale(state.lastFetched[tab])) return;

    set((s) => ({ loading: { ...s.loading, [tab]: true } }));

    try {
      if (tab === 'my-stories') {
        const page = await listUserStories();
        set((s) => ({ stories: page.items, hasMore: { ...s.hasMore, 'my-stories': page.hasMore } }));
      } else if (tab === 'explored') {
        const data = await listExploredStories();
        set({ exploredStories: data });
      } else if (tab === 'storylines') {
        const page = await listSavedStorylines();
        set((s) => ({
          savedStorylines: page.items,
          hasMore: { ...s.hasMore, storylines: page.hasMore },
        }));
      } else if (tab === 'reels') {
        const page = await listUserReels();
        set((s) => ({ reels: page.items, hasMore: { ...s.hasMore, reels: page.hasMore } }));
      }
      set((s) => ({
        lastFetched: { ...s.lastFetched, [tab]: Date.now() },
      }));
    } catch (error) {
      console.error(`Failed to fetch ${tab}:`, error);
    } finally {
      set((s) => ({ loading: { ...s.loading, [tab]: false } }));
    }
  },

  loadMore: async (tab: PagedTabId) => {
    const state = get();
    if (!state.hasMore[tab] || state.loadingMore[tab] || state.loading[tab]) return;

    set((s) => ({ loadingMore: { ...s.loadingMore, [tab]: true } }));
    try {
      if (tab === 'my-stories') {
        const page = await listUserStories({
          limit: MY_STORIES_PAGE_SIZE,
          offset: get().stories.length,
        });
        set((s) => ({
          stories: appendPage(s.stories, page.items, (story) => story.id),
          hasMore: { ...s.hasMore, 'my-stories': page.hasMore },
        }));
      } else if (tab === 'storylines') {
        const page = await listSavedStorylines({
          limit: MY_STORIES_PAGE_SIZE,
          offset: get().savedStorylines.length,
        });
        set((s) => ({
          savedStorylines: appendPage(s.savedStorylines, page.items, (item) => item.id),
          hasMore: { ...s.hasMore, storylines: page.hasMore },
        }));
      } else {
        const page = await listUserReels({
          limit: MY_STORIES_PAGE_SIZE,
          offset: get().reels.length,
        });
        set((s) => ({
          reels: appendPage(s.reels, page.items, (reel) => reel.id),
          hasMore: { ...s.hasMore, reels: page.hasMore },
        }));
      }
    } catch (error) {
      console.error(`Failed to load more ${tab}:`, error);
    } finally {
      set((s) => ({ loadingMore: { ...s.loadingMore, [tab]: false } }));
    }
  },

  ensureCharacterUniverse: async (force = false) => {
    const state = get();
    if (!force && state.characterSettings && !isStale(state.characterUniverseLastFetched)) {
      return;
    }
    // Dedupe concurrent callers (drawer + landing picker share this store).
    if (state.loading.characters) return;

    set((s) => ({ loading: { ...s.loading, characters: true } }));
    try {
      // Snapshot + masters in one round trip (settings gate + list resolve
      // server-side), replacing the prior settings→masters client waterfall.
      const { settings, masters } = await getCharacterUniversePayload();
      set((s) => ({
        characterSettings: settings,
        characters: masters,
        characterUniverseLastFetched: Date.now(),
        lastFetched: { ...s.lastFetched, characters: Date.now() },
      }));
      void runCharacterRepairSweep();
    } catch (error) {
      console.error('Failed to load character universe:', error);
    } finally {
      set((s) => ({ loading: { ...s.loading, characters: false } }));
    }
  },

  clear: () => {
    // Reset module-scoped session guards so the next account bootstraps fresh.
    bootstrapInFlight = null;
    characterRepairAttempted = false;
    // Signing out must take the on-disk copy with it, not just the in-memory one.
    clearMyStoriesCache();
    set({
      stories: [],
      reels: [],
      exploredStories: [],
      savedStorylines: [],
      characters: [],
      characterSettings: null,
      characterUniverseLastFetched: 0,
      loading: { ...initialLoading },
      lastFetched: { ...initialLastFetched },
      hasMore: { ...initialHasMore },
      loadingMore: { ...initialLoadingMore },
      cacheUserId: null,
    });
  },

  removeStory: (id: string) => {
    set((s) => ({
      stories: s.stories.filter((story) => story.id !== id),
      reels: s.reels.filter((reel) => reel.id !== id),
    }));
  },

  updateStory: (id: string, patch: Partial<SavedStory>) => {
    set((s) => ({
      stories: s.stories.map((story) =>
        story.id === id ? { ...story, ...patch } : story
      ),
    }));
  },

  removeReel: (id: string) => {
    set((s) => ({ reels: s.reels.filter((reel) => reel.id !== id) }));
  },

  updateReel: (id: string, patch: Partial<UserReel>) => {
    set((s) => ({
      reels: s.reels.map((reel) =>
        reel.id === id ? { ...reel, ...patch } : reel
      ),
    }));
  },

  removeExploredStory: (id: string) => {
    set((s) => ({
      exploredStories: s.exploredStories.filter((item) => item.id !== id),
    }));
  },

  removeSavedStoryline: (storylineId: string) => {
    set((s) => ({
      savedStorylines: s.savedStorylines.filter(
        (item) => item.storyline_id !== storylineId
      ),
    }));
  },

  updateCharacter: (id: string, patch: Partial<CharacterMaster>) => {
    set((s) => ({
      characters: s.characters.map((character) =>
        character.id === id ? { ...character, ...patch } : character
      ),
    }));
  },

  removeCharacter: (id: string) => {
    set((s) => ({
      characters: s.characters.filter((character) => character.id !== id),
    }));
  },

  invalidateCharacters: () => {
    set((s) => ({
      characterUniverseLastFetched: 0,
      lastFetched: { ...s.lastFetched, characters: 0 },
    }));
  },
}));

/**
 * Mirrors the rendered lists to disk so the next visit opens on content
 * instead of skeletons. Debounced because a single fetch settles several
 * slices in a row, and a bulk mutation (archive, delete) shouldn't cost one
 * serialization per keystroke of state.
 *
 * Subscribing here rather than writing inside each action means optimistic
 * mutations — delete, archive, unsave — are captured too, so the cache can
 * never resurrect a row the user just removed.
 */
const CACHE_WRITE_DEBOUNCE_MS = 500;
let cacheWriteTimer: ReturnType<typeof setTimeout> | null = null;

if (typeof window !== 'undefined') {
  useMyStoriesStore.subscribe((state, previous) => {
    if (!state.cacheUserId) return;
    const unchanged =
      state.stories === previous.stories
      && state.savedStorylines === previous.savedStorylines
      && state.reels === previous.reels
      && state.characters === previous.characters
      && state.characterSettings === previous.characterSettings
      && state.hasMore === previous.hasMore;
    if (unchanged) return;

    if (cacheWriteTimer) clearTimeout(cacheWriteTimer);
    cacheWriteTimer = setTimeout(() => {
      cacheWriteTimer = null;
      // Read fresh: the state captured above may be several updates stale.
      const current = useMyStoriesStore.getState();
      if (!current.cacheUserId) return;
      writeMyStoriesCache(current.cacheUserId, {
        stories: current.stories,
        savedStorylines: current.savedStorylines,
        reels: current.reels,
        characters: current.characters,
        characterSettings: current.characterSettings,
        hasMore: current.hasMore,
      });
    }, CACHE_WRITE_DEBOUNCE_MS);
  });
}

/**
 * Self-heals library masters whose thumbnails are blank because they were saved
 * before visual-backfill existed (NULL portrait + sheet, but a known origin
 * story). Runs at most once per page session, in the background — the list is
 * already rendered, and repaired thumbnails patch in as they resolve.
 */
async function runCharacterRepairSweep(): Promise<void> {
  if (characterRepairAttempted) return;
  const { characters } = useMyStoriesStore.getState();
  const needsRepair = characters.some(
    (master) => !master.portraitUrl && !master.referenceSheetUrl && master.originStoryId
  );
  if (!needsRepair) return;

  characterRepairAttempted = true;
  try {
    const repaired = await repairCharacterMasterVisuals();
    const { updateCharacter } = useMyStoriesStore.getState();
    for (const master of repaired) {
      updateCharacter(master.id, {
        portraitUrl: master.portraitUrl,
        portraitStorageKey: master.portraitStorageKey,
        referenceSheetUrl: master.referenceSheetUrl,
        referenceSheetStorageKey: master.referenceSheetStorageKey,
      });
    }
  } catch (error) {
    console.error('Character thumbnail repair failed:', error);
  }
}
