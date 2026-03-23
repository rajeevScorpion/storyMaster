import { create } from 'zustand';
import { listUserStories, listSavedStorylines } from '@/app/actions/persistence';
import { listExploredStories } from '@/app/actions/exploration';
import type { TabId, SavedStory, ExploredStory, SavedStorylineItem } from '@/lib/types/my-stories';

const STALE_MS = 5 * 60 * 1000; // 5 minutes

interface MyStoriesState {
  stories: SavedStory[];
  exploredStories: ExploredStory[];
  savedStorylines: SavedStorylineItem[];
  loading: Record<TabId, boolean>;
  lastFetched: Record<TabId, number>;

  prefetchAll: () => Promise<void>;
  fetchTab: (tab: TabId) => Promise<void>;
  clear: () => void;

  // Optimistic mutation helpers
  removeStory: (id: string) => void;
  updateStory: (id: string, patch: Partial<SavedStory>) => void;
  removeExploredStory: (id: string) => void;
  removeSavedStoryline: (storylineId: string) => void;
}

const initialLastFetched: Record<TabId, number> = {
  'my-stories': 0,
  explored: 0,
  storylines: 0,
};

const initialLoading: Record<TabId, boolean> = {
  'my-stories': false,
  explored: false,
  storylines: false,
};

function isStale(lastFetched: number): boolean {
  return Date.now() - lastFetched > STALE_MS;
}

export const useMyStoriesStore = create<MyStoriesState>((set, get) => ({
  stories: [],
  exploredStories: [],
  savedStorylines: [],
  loading: { ...initialLoading },
  lastFetched: { ...initialLastFetched },

  prefetchAll: async () => {
    const state = get();
    const tabs: TabId[] = ['my-stories', 'explored', 'storylines'];
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
      exploredStories: [],
      savedStorylines: [],
      loading: { ...initialLoading },
      lastFetched: { ...initialLastFetched },
    });
  },

  removeStory: (id: string) => {
    set((s) => ({ stories: s.stories.filter((story) => story.id !== id) }));
  },

  updateStory: (id: string, patch: Partial<SavedStory>) => {
    set((s) => ({
      stories: s.stories.map((story) =>
        story.id === id ? { ...story, ...patch } : story
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
}));
