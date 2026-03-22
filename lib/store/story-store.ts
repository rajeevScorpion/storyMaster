import { create } from 'zustand';
import { persist, StateStorage, createJSONStorage } from 'zustand/middleware';
import { get, set as idbSet, del } from 'idb-keyval';
import { StorySession, StoryBeat, StoryConfig, StoryMap, StoryNode } from '../types/story';
import { v4 as uuidv4 } from 'uuid';
import { generateStoryBeat, generateImage, selectNarratorVoice, generateNarration } from '@/app/actions/story';
import { saveStory as saveStoryAction, loadStory as loadStoryAction } from '@/app/actions/persistence';
import { uploadNodeAssets, replaceBase64WithUrls, stripBase64FromStoryMap } from '@/lib/supabase/storage';
import { getPathToNode } from '../utils/story-map';
import {
  createStoryMap,
  addChildNode,
  findChildForOption,
  getBeatsToNode,
  getChoiceHistoryToNode,
  getCurrentNode,
} from '../utils/story-map';

const storage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    return (await get(name)) || null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await idbSet(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    await del(name);
  },
};

// Hydration guard: resolves when Zustand persist finishes rehydrating from IndexedDB.
// This prevents cloud loads from being overwritten by stale IndexedDB data.
let resolveHydration: () => void;
const hydrationPromise = new Promise<void>((resolve) => {
  resolveHydration = resolve;
});

const DEFAULT_CONFIG: StoryConfig = {
  language: 'english',
  ageGroup: 'all_ages',
  settingCountry: 'generic',
  maxBeats: 6,
};

interface StoryState {
  session: StorySession | null;
  isLoading: boolean;
  loadingClues: string[];
  error: string | null;
  isGeneratingAudio: boolean;
  audioReadyNodeId: string | null;
  storyMode: boolean;
  isSaving: boolean;
  startStory: (prompt: string, config?: StoryConfig) => Promise<void>;
  continueStory: (optionId: string) => Promise<void>;
  navigateToNode: (nodeId: string) => void;
  resetStory: () => void;
  setLoadingClues: (clues: string[]) => void;
  generateNarrationForNode: (nodeId: string) => Promise<void>;
  clearAudioReady: () => void;
  toggleStoryMode: () => void;
  saveStoryToCloud: (userId: string) => Promise<void>;
  loadStoryFromCloud: (storyId: string) => Promise<void>;
}

function deriveSessionFields(session: StorySession, storyMap: StoryMap): StorySession {
  const currentNode = getCurrentNode(storyMap);
  const beats = getBeatsToNode(storyMap, storyMap.currentNodeId);
  const choiceHistory = getChoiceHistoryToNode(storyMap, storyMap.currentNodeId);
  return {
    ...session,
    storyMap,
    beats,
    choiceHistory,
    currentBeat: currentNode.data.beatNumber,
    characters: currentNode.data.characters,
    status: currentNode.data.isEnding ? 'completed' : 'active',
  };
}

export const useStoryStore = create<StoryState>()(
  persist(
    (set, get) => ({
      session: null,
      isLoading: false,
      loadingClues: [],
      error: null,
      isGeneratingAudio: false,
      audioReadyNodeId: null,
      storyMode: false,
      isSaving: false,

      startStory: async (prompt: string, config?: StoryConfig) => {
        set({
          isLoading: true,
          error: null,
          loadingClues: ['Kissago is weaving the next moment...'],
        });

        const storyConfig = config || DEFAULT_CONFIG;

        try {
          const initialSession: Partial<StorySession> = {
            storySessionId: uuidv4(),
            userPrompt: prompt,
            genre: 'adventure',
            tone: 'playful',
            targetAge: storyConfig.ageGroup,
            visualStyle: 'cinematic storybook illustration',
            currentBeat: 0,
            maxBeats: storyConfig.maxBeats,
            status: 'active',
            characters: [],
            setting: {
              world: storyConfig.settingCountry !== 'generic' ? storyConfig.settingCountry : 'unknown',
              timeOfDay: 'unknown',
              mood: 'unknown',
            },
            storyConfig,
            beats: [],
            choiceHistory: [],
            openThreads: [],
            allowedEndings: ['friendship', 'moral', 'comedy', 'discovery', 'rescue', 'bittersweet'],
            safetyProfile: storyConfig.ageGroup.startsWith('kids') ? 'children' : 'all_ages',
          };

          const beat = await generateStoryBeat(prompt, initialSession);

          set({ loadingClues: beat.clues });

          const imageUrl = await generateImage(beat.imagePrompt, beat.characters, initialSession.visualStyle!);
          beat.imageUrl = imageUrl;

          const storyMap = createStoryMap(beat);

          const fullSession = deriveSessionFields(
            {
              ...initialSession,
              title: beat.title,
            } as StorySession,
            storyMap
          );

          set({
            session: fullSession,
            isLoading: false,
          });

          // Fire-and-forget: generate narration in background
          get().generateNarrationForNode(storyMap.rootNodeId);
        } catch (error: any) {
          set({ isLoading: false, error: error.message || 'Failed to start story' });
        }
      },

      continueStory: async (optionId: string) => {
        const { session } = get();
        if (!session) return;

        const currentNode = getCurrentNode(session.storyMap);
        const selectedOption = currentNode.data.options.find((o) => o.id === optionId);
        if (!selectedOption) return;

        // Check if branch already exists — instant load, no API call
        const existingChildId = findChildForOption(session.storyMap, session.storyMap.currentNodeId, optionId);
        if (existingChildId) {
          const updatedMap = { ...session.storyMap, currentNodeId: existingChildId };
          set({ session: deriveSessionFields(session, updatedMap) });
          return;
        }

        // No existing branch — generate new beat
        set({
          isLoading: true,
          error: null,
          loadingClues: currentNode.data.clues.length > 0
            ? currentNode.data.clues
            : ['Kissago is weaving the next moment...'],
        });

        try {
          // Build session state for Gemini with linear path beats
          const beatsForPrompt = getBeatsToNode(session.storyMap, session.storyMap.currentNodeId);
          const choiceHistoryForPrompt = [
            ...getChoiceHistoryToNode(session.storyMap, session.storyMap.currentNodeId),
            selectedOption.label,
          ];
          const sessionForPrompt: Partial<StorySession> = {
            ...session,
            beats: beatsForPrompt,
            choiceHistory: choiceHistoryForPrompt,
          };
          // Strip storyMap and heavy data from what we send to Gemini
          delete (sessionForPrompt as any).storyMap;
          delete (sessionForPrompt as any).narratorVoice;

          const beat = await generateStoryBeat(session.userPrompt, sessionForPrompt, selectedOption.label);

          set({ loadingClues: beat.clues });

          const imageUrl = await generateImage(beat.imagePrompt, beat.characters, session.visualStyle);
          beat.imageUrl = imageUrl;

          const updatedMap = addChildNode(
            session.storyMap,
            session.storyMap.currentNodeId,
            optionId,
            beat
          );

          set({
            session: deriveSessionFields(session, updatedMap),
            isLoading: false,
          });

          // Fire-and-forget: generate narration in background
          get().generateNarrationForNode(updatedMap.currentNodeId);
        } catch (error: any) {
          set({ isLoading: false, error: error.message || 'Failed to continue story' });
        }
      },

      navigateToNode: (nodeId: string) => {
        const { session } = get();
        if (!session || !session.storyMap.nodes[nodeId]) return;

        const updatedMap = { ...session.storyMap, currentNodeId: nodeId };
        set({ session: deriveSessionFields(session, updatedMap) });
      },

      resetStory: () => {
        set({ session: null, error: null, isLoading: false, loadingClues: [] });
      },

      setLoadingClues: (clues: string[]) => {
        set({ loadingClues: clues });
      },

      generateNarrationForNode: async (nodeId: string) => {
        const { session } = get();
        if (!session) return;

        const node = session.storyMap.nodes[nodeId];
        if (!node || node.data.audioUrl) return;

        // Skip for mock stories
        if (session.userPrompt.toLowerCase() === 'mock') return;

        set({ isGeneratingAudio: true });

        try {
          // Select voice if not yet chosen
          let voiceName = session.narratorVoice;
          if (!voiceName) {
            voiceName = await selectNarratorVoice(session.genre, session.tone, session.targetAge, session.storyConfig?.language || 'english');
            const currentSession = get().session;
            if (currentSession) {
              set({ session: { ...currentSession, narratorVoice: voiceName } });
            }
          }

          const audioUrl = await generateNarration(
            node.data.storyText,
            session.tone,
            session.genre,
            voiceName,
            session.storyConfig?.language || 'english'
          );

          // Update the node with audio — re-read session in case it changed
          const latestSession = get().session;
          if (!latestSession) return;

          const updatedNodes = {
            ...latestSession.storyMap.nodes,
            [nodeId]: {
              ...latestSession.storyMap.nodes[nodeId],
              data: { ...latestSession.storyMap.nodes[nodeId].data, audioUrl },
            },
          };
          const updatedMap = { ...latestSession.storyMap, nodes: updatedNodes };
          set({
            session: deriveSessionFields(latestSession, updatedMap),
            isGeneratingAudio: false,
            audioReadyNodeId: nodeId,
          });
        } catch (error) {
          console.error('Narration generation failed:', error);
          set({ isGeneratingAudio: false });
        }
      },

      clearAudioReady: () => {
        set({ audioReadyNodeId: null });
      },

      toggleStoryMode: () => {
        set((state) => ({ storyMode: !state.storyMode }));
      },

      saveStoryToCloud: async (userId: string) => {
        const { session } = get();
        if (!session) return;

        set({ isSaving: true, error: null });

        try {
          // Upload images for ALL explored nodes (not just current path)
          // so that branch images survive the save/load round-trip
          const nodeIds = Object.keys(session.storyMap.nodes);
          const basePath = `${userId}/${session.savedStoryId || session.storySessionId}`;
          const assetMap = await uploadNodeAssets('story-assets', basePath, session.storyMap, nodeIds);

          // Replace base64 with storage URLs in the map
          const updatedMap = replaceBase64WithUrls(session.storyMap, assetMap);

          // Strip any remaining base64 from the map before sending to server action
          const cleanMap = stripBase64FromStoryMap(updatedMap);

          // Save to database (session beats are stripped to avoid 1MB body limit)
          const strippedSession = {
            ...session,
            beats: session.beats.map(b => ({ ...b, imageUrl: undefined, audioUrl: undefined })),
          };
          const { storyId } = await saveStoryAction(strippedSession, cleanMap);

          // Update local session with savedStoryId but keep original base64 URLs
          // (storage URLs are for DB only — story-assets bucket is private)
          const updatedSession = deriveSessionFields(
            { ...session, savedStoryId: storyId },
            session.storyMap
          );
          set({ session: updatedSession, isSaving: false });
        } catch (error: any) {
          set({ isSaving: false, error: error.message || 'Failed to save story' });
        }
      },

      loadStoryFromCloud: async (storyId: string) => {
        // Wait for IndexedDB rehydration to complete before loading from cloud,
        // otherwise stale IndexedDB data can overwrite the freshly loaded session.
        await hydrationPromise;

        set({ isLoading: true, error: null });

        try {
          const session = await loadStoryAction(storyId);
          const fullSession = deriveSessionFields(session, session.storyMap);

          if (process.env.NODE_ENV === 'development') {
            const nodeCount = Object.keys(fullSession.storyMap.nodes).length;
            const branchPoints = Object.values(fullSession.storyMap.nodes)
              .filter((n) => n.children.length > 1).length;
            console.log(`[loadStory] Loaded ${nodeCount} nodes, ${branchPoints} branch points`);
          }

          set({ session: fullSession, isLoading: false });
        } catch (error: any) {
          set({ isLoading: false, error: error.message || 'Failed to load story' });
        }
      },
    }),
    {
      name: 'story-master-storage',
      version: 3,
      storage: createJSONStorage(() => storage),
      partialize: (state) => ({ session: state.session }),
      onRehydrateStorage: () => {
        return () => {
          resolveHydration();
        };
      },
      migrate: (persistedState: any, version: number) => {
        try {
          if (version < 2 && persistedState?.session?.beats && !persistedState?.session?.storyMap) {
            const session = persistedState.session;
            const nodes: Record<string, StoryNode> = {};
            let prevId: string | null = null;
            const nodeIds: string[] = [];

            for (const beat of session.beats) {
              const id = uuidv4();
              nodeIds.push(id);
              nodes[id] = {
                id,
                beatNumber: beat.beatNumber,
                parentId: prevId,
                selectedOptionId: null,
                data: beat,
                children: [],
              };
              if (prevId) nodes[prevId].children.push(id);
              prevId = id;
            }

            if (nodeIds.length > 0) {
              session.storyMap = {
                nodes,
                rootNodeId: nodeIds[0],
                currentNodeId: nodeIds[nodeIds.length - 1],
              };
            }

            session.storyConfig = {
              language: 'english',
              ageGroup: session.targetAge || 'all_ages',
              settingCountry: 'generic',
              maxBeats: session.maxBeats || 6,
            };
          }
          // v2 → v3: add language to storyConfig
          if (version < 3 && persistedState?.session?.storyConfig && !persistedState.session.storyConfig.language) {
            persistedState.session.storyConfig.language = 'english';
          }
          return persistedState as StoryState;
        } catch {
          // Migration failed — start fresh
          return { session: null } as unknown as StoryState;
        }
      },
    }
  )
);
