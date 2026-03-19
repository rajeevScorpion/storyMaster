import { create } from 'zustand';
import { persist, StateStorage, createJSONStorage } from 'zustand/middleware';
import { get, set as idbSet, del } from 'idb-keyval';
import { StorySession, StoryBeat, StoryConfig, StoryMap, StoryNode } from '../types/story';
import { v4 as uuidv4 } from 'uuid';
import { generateStoryBeat, generateImage, selectNarratorVoice, generateNarration } from '@/app/actions/story';
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

const DEFAULT_CONFIG: StoryConfig = {
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
  startStory: (prompt: string, config?: StoryConfig) => Promise<void>;
  continueStory: (optionId: string) => Promise<void>;
  navigateToNode: (nodeId: string) => void;
  resetStory: () => void;
  setLoadingClues: (clues: string[]) => void;
  generateNarrationForNode: (nodeId: string) => Promise<void>;
  clearAudioReady: () => void;
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

      startStory: async (prompt: string, config?: StoryConfig) => {
        set({
          isLoading: true,
          error: null,
          loadingClues: ['The Story Master is weaving the next moment...'],
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
            : ['The Story Master is weaving the next moment...'],
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
            voiceName = await selectNarratorVoice(session.genre, session.tone, session.targetAge);
            const currentSession = get().session;
            if (currentSession) {
              set({ session: { ...currentSession, narratorVoice: voiceName } });
            }
          }

          const audioUrl = await generateNarration(
            node.data.storyText,
            session.tone,
            session.genre,
            voiceName
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
    }),
    {
      name: 'story-master-storage',
      version: 2,
      storage: createJSONStorage(() => storage),
      partialize: (state) => ({ session: state.session }),
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
              ageGroup: session.targetAge || 'all_ages',
              settingCountry: 'generic',
              maxBeats: session.maxBeats || 6,
            };
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
