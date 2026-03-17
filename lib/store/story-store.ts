import { create } from 'zustand';
import { persist, StateStorage, createJSONStorage } from 'zustand/middleware';
import { get, set as idbSet, del } from 'idb-keyval';
import { StorySession, StoryBeat } from '../types/story';
import { v4 as uuidv4 } from 'uuid';
import { generateStoryBeat, generateImage } from '@/app/actions/story';

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

interface StoryState {
  session: StorySession | null;
  isLoading: boolean;
  loadingClues: string[];
  error: string | null;
  startStory: (prompt: string) => Promise<void>;
  continueStory: (optionId: string) => Promise<void>;
  resetStory: () => void;
  setLoadingClues: (clues: string[]) => void;
}

export const useStoryStore = create<StoryState>()(
  persist(
    (set, get) => ({
      session: null,
      isLoading: false,
      loadingClues: [],
      error: null,

      startStory: async (prompt: string) => {
        set({ 
          isLoading: true, 
          error: null,
          loadingClues: ['The Story Master is weaving the next moment...'] 
        });
        
        try {
          const initialSession: Partial<StorySession> = {
            storySessionId: uuidv4(),
            userPrompt: prompt,
            genre: 'adventure',
            tone: 'playful',
            targetAge: 'all_ages',
            visualStyle: 'cinematic storybook illustration',
            currentBeat: 0,
            maxBeats: 6,
            status: 'active',
            characters: [],
            setting: {
              world: 'unknown',
              timeOfDay: 'unknown',
              mood: 'unknown',
            },
            beats: [],
            choiceHistory: [],
            openThreads: [],
            allowedEndings: ['friendship', 'moral', 'comedy', 'discovery', 'rescue', 'bittersweet'],
            safetyProfile: 'all_ages',
          };

          const beat = await generateStoryBeat(prompt, initialSession);
          
          set({ loadingClues: beat.clues });
          
          const imageUrl = await generateImage(beat.imagePrompt, beat.characters, initialSession.visualStyle!);
          beat.imageUrl = imageUrl;

          set({
            session: {
              ...initialSession,
              title: beat.title,
              currentBeat: beat.beatNumber,
              characters: beat.characters,
              beats: [beat],
            } as StorySession,
            isLoading: false,
          });
        } catch (error: any) {
          set({ isLoading: false, error: error.message || 'Failed to start story' });
        }
      },

      continueStory: async (optionId: string) => {
        const { session } = get();
        if (!session) return;

        const currentBeat = session.beats[session.beats.length - 1];
        const selectedOption = currentBeat.options.find(o => o.id === optionId);
        
        if (!selectedOption) return;

        set({ 
          isLoading: true, 
          error: null,
          loadingClues: currentBeat.clues.length > 0 ? currentBeat.clues : ['The Story Master is weaving the next moment...'] 
        });

        try {
          const updatedSession = {
            ...session,
            choiceHistory: [...session.choiceHistory, selectedOption.label],
          };

          const beat = await generateStoryBeat(session.userPrompt, updatedSession, selectedOption.label);
          
          set({ loadingClues: beat.clues });
          
          const imageUrl = await generateImage(beat.imagePrompt, beat.characters, session.visualStyle);
          beat.imageUrl = imageUrl;

          set({
            session: {
              ...updatedSession,
              currentBeat: beat.beatNumber,
              characters: beat.characters, // Update characters with any new ones
              beats: [...updatedSession.beats, beat],
              status: beat.isEnding ? 'completed' : 'active',
            },
            isLoading: false,
          });
        } catch (error: any) {
          set({ isLoading: false, error: error.message || 'Failed to continue story' });
        }
      },

      resetStory: () => {
        set({ session: null, error: null, isLoading: false, loadingClues: [] });
      },

      setLoadingClues: (clues: string[]) => {
        set({ loadingClues: clues });
      },
    }),
    {
      name: 'story-master-storage',
      storage: createJSONStorage(() => storage),
    }
  )
);
