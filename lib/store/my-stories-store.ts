import { create } from 'zustand';
import { listUserStories, listSavedStorylines, listUserReels } from '@/app/actions/persistence';
import { listExploredStories } from '@/app/actions/exploration';
import { listCharacterMasters } from '@/app/actions/character-library';
import type { TabId, SavedStory, UserReel, ExploredStory, SavedStorylineItem } from '@/lib/types/my-stories';
import type { CharacterMaster } from '@/lib/types/character-library';

const STALE_MS = 5 * 60 * 1000; // 5 minutes

interface MyStoriesState {
  stories: SavedStory[];
  reels: UserReel[];
  exploredStories: ExploredStory[];
  savedStorylines: SavedStorylineItem[];
  characters: CharacterMaster[];
  loading: Record<TabId, boolean>;
  lastFetched: Record<TabId, number>;

  prefetchAll: () => Promise<void>;
  fetchTab: (tab: TabId) => Promise<void>;
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
  loading: { ...initialLoading },
  lastFetched: { ...initialLastFetched },

  prefetchAll: async () => {
    const state = get();
    // The characters tab is flag-gated and fetched on demand via fetchTab.
    const tabs: TabId[] = ['my-stories', 'explored', 'storylines', 'reels'];
    const staleTabs = tabs.filter((t) => isStale(state.lastFetched[t]));
    if (staleTabs.length === 0) return;

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
        } else if (tab === 'explored') {
          const data = await listExploredStories();
          set({ exploredStories: data });
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

    await Promise.all(promises);
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

  clear: () => {
    set({
      stories: [],
      reels: [],
      exploredStories: [],
      savedStorylines: [],
      characters: [],
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
    set((s) => ({ lastFetched: { ...s.lastFetched, characters: 0 } }));
  },
}));
