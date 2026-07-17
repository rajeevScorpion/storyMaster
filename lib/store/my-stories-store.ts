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
import type { TabId, SavedStory, UserReel, ExploredStory, SavedStorylineItem } from '@/lib/types/my-stories';
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
  }) => Promise<SessionBootstrapData | null>;
  /** Applies a bootstrap payload to the store (drawer tabs + characters). */
  hydrateFromBootstrap: (data: SessionBootstrapData) => void;
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
    if (!input?.force && tabsFresh && characterFresh) {
      return null;
    }
    // Coalesce concurrent callers (AuthProvider + LandingScreen) onto one POST.
    if (bootstrapInFlight) return bootstrapInFlight;

    const run = (async (): Promise<SessionBootstrapData | null> => {
      set((s) => ({
        loading: {
          ...s.loading,
          'my-stories': true,
          storylines: true,
          reels: true,
          characters: true,
        },
      }));
      try {
        const data = await getSessionBootstrap({
          imageTaskKey: input?.imageTaskKey ?? imageTaskForStoryKind('story'),
          imageModelSelection: input?.imageModelSelection ?? null,
        });
        get().hydrateFromBootstrap(data);
        return data;
      } catch (error) {
        console.error('Failed to bootstrap session:', error);
        return null;
      } finally {
        set((s) => ({
          loading: {
            ...s.loading,
            'my-stories': false,
            storylines: false,
            reels: false,
            characters: false,
          },
        }));
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
