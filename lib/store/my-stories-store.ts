import { create } from 'zustand';
import { listUserStories, listSavedStorylines, listUserReels } from '@/app/actions/persistence';
import { listExploredStories } from '@/app/actions/exploration';
import {
  getCharacterUniverseRuntimeSettings,
  listCharacterMasters,
} from '@/app/actions/character-library';
import type { TabId, SavedStory, UserReel, ExploredStory, SavedStorylineItem } from '@/lib/types/my-stories';
import type { CharacterMaster } from '@/lib/types/character-library';
import type { CharacterUniverseRuntimeSettings } from '@/lib/character-universe/settings';

const STALE_MS = 5 * 60 * 1000; // 5 minutes

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

  prefetchAll: () => Promise<void>;
  fetchTab: (tab: TabId) => Promise<void>;
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

function isStale(lastFetched: number): boolean {
  return Date.now() - lastFetched > STALE_MS;
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

  prefetchAll: async () => {
    const state = get();
    // Explored is no longer surfaced in the drawer, so it's not prefetched.
    const tabs: TabId[] = ['my-stories', 'storylines', 'reels'];
    const staleTabs = tabs.filter((t) => isStale(state.lastFetched[t]));

    // Warm the character universe (tab visibility + masters) on the same login
    // pass as everything else, so the drawer/landing picker open instantly.
    const characterPromise = get().ensureCharacterUniverse();

    if (staleTabs.length === 0) {
      await characterPromise;
      return;
    }

    // Mark all stale tabs as loading
    set((s) => ({
      loading: {
        ...s.loading,
        ...Object.fromEntries(staleTabs.map((t) => [t, true])),
      },
    }));

    const promises = staleTabs.map(async (tab) => {
      try {
        if (tab === 'my-stories') {
          const data = await listUserStories();
          set({ stories: data });
        } else if (tab === 'storylines') {
          const data = await listSavedStorylines();
          set({ savedStorylines: data });
        } else if (tab === 'reels') {
          const data = await listUserReels();
          set({ reels: data });
        }
        set((s) => ({
          lastFetched: { ...s.lastFetched, [tab]: Date.now() },
        }));
      } catch (error) {
        console.error(`Failed to prefetch ${tab}:`, error);
      } finally {
        set((s) => ({
          loading: { ...s.loading, [tab]: false },
        }));
      }
    });

    await Promise.all([...promises, characterPromise]);
  },

  fetchTab: async (tab: TabId) => {
    const state = get();
    // Serve cache if fresh
    if (!isStale(state.lastFetched[tab])) return;

    set((s) => ({ loading: { ...s.loading, [tab]: true } }));

    try {
      if (tab === 'my-stories') {
        const data = await listUserStories();
        set({ stories: data });
      } else if (tab === 'explored') {
        const data = await listExploredStories();
        set({ exploredStories: data });
      } else if (tab === 'storylines') {
        const data = await listSavedStorylines();
        set({ savedStorylines: data });
      } else if (tab === 'reels') {
        const data = await listUserReels();
        set({ reels: data });
      } else if (tab === 'characters') {
        const data = await listCharacterMasters({ includeArchived: true });
        set({ characters: data });
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

  ensureCharacterUniverse: async (force = false) => {
    const state = get();
    if (!force && state.characterSettings && !isStale(state.characterUniverseLastFetched)) {
      return;
    }
    // Dedupe concurrent callers (drawer + landing picker share this store).
    if (state.loading.characters) return;

    set((s) => ({ loading: { ...s.loading, characters: true } }));
    try {
      // The flag snapshot is one batched query; only hit the masters endpoint
      // when the library is actually on (skips a wasted call for anonymous /
      // disabled users on the heavily-trafficked landing page).
      const settings = await getCharacterUniverseRuntimeSettings();
      set({ characterSettings: settings });

      if (settings.libraryEnabled) {
        const masters = await listCharacterMasters({ includeArchived: true });
        set({ characters: masters });
      } else {
        set({ characters: [] });
      }
      set((s) => ({
        characterUniverseLastFetched: Date.now(),
        lastFetched: { ...s.lastFetched, characters: Date.now() },
      }));
    } catch (error) {
      console.error('Failed to load character universe:', error);
    } finally {
      set((s) => ({ loading: { ...s.loading, characters: false } }));
    }
  },

  clear: () => {
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
