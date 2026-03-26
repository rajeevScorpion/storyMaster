import { create } from 'zustand';
import { StorySession, StoryBeat, StoryConfig, StoryMap } from '../types/story';
import { v4 as uuidv4 } from 'uuid';
import { generateStoryBeat, generateImage } from '@/app/actions/story';
import { generateAndPersistNarration, generateNarrationOnly, selectNarratorVoiceServer } from '@/app/actions/narration';
import { saveStory as saveStoryAction, loadStory as loadStoryAction, saveBeat as saveBeatAction, autoPublishStoryline, copyCoverToPublicBucket, setStoryCoverImage } from '@/app/actions/persistence';
import { loadStoryTree as loadStoryTreeAction, trackExploration as trackExplorationAction, refreshStoryMapSignedUrls as refreshStoryMapAction } from '@/app/actions/exploration';
import { uploadNodeAssets, replaceBase64WithUrls, stripBase64FromStoryMap, uploadCoverImage, extractStoragePath } from '@/lib/supabase/storage';
import { createClient as createBrowserClient } from '@/lib/supabase/client';
import { getPathToNode } from '../utils/story-map';
import {
  createStoryMap,
  addChildNode,
  findChildForOption,
  getBeatsToNode,
  getChoiceHistoryToNode,
  getCurrentNode,
} from '../utils/story-map';


const DEFAULT_CONFIG: StoryConfig = {
  language: 'english',
  ageGroup: 'all_ages',
  settingCountry: 'generic',
  maxBeats: 6,
};

interface PublishResult {
  alreadyPublished: boolean;
  storylineId: string;
}

interface StoryState {
  session: StorySession | null;
  isLoading: boolean;
  loadingClues: string[];
  error: string | null;
  isGeneratingAudio: boolean;
  audioReadyNodeId: string | null;
  storyMode: boolean;
  isSaving: boolean;
  saveStatus: 'idle' | 'unsaved' | 'saving' | 'saved';
  lastPublishResult: PublishResult | null;
  startStory: (prompt: string, config?: StoryConfig) => Promise<void>;
  continueStory: (optionId: string) => Promise<void>;
  navigateToNode: (nodeId: string) => void;
  resetStory: () => void;
  restartExploration: () => void;
  setLoadingClues: (clues: string[]) => void;
  generateNarrationForNode: (nodeId: string) => Promise<void>;
  clearAudioReady: () => void;
  toggleStoryMode: () => void;
  saveStoryToCloud: (userId: string) => Promise<void>;
  loadStoryFromCloud: (storyId: string) => Promise<void>;
  exploreStoryTree: (storyId: string) => Promise<void>;
  refreshSignedUrls: () => Promise<void>;
  clearPublishResult: () => void;
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
    (set, get) => ({
      session: null,
      isLoading: false,
      loadingClues: [],
      error: null,
      isGeneratingAudio: false,
      audioReadyNodeId: null,
      storyMode: false,
      isSaving: false,
      saveStatus: 'idle' as const,
      lastPublishResult: null,

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

          const lang = initialSession.storyConfig?.language || 'english';

          // Track resolved audio URL for merging after storyMap creation
          let resolvedAudioUrl: string | undefined;

          // Start voice selection (fast ~1s) — shared by both image-blocking path and narration chain
          const voicePromise = selectNarratorVoiceServer(
            initialSession.genre!,
            initialSession.tone!,
            initialSession.targetAge!,
            lang
          );

          // Fire-and-forget: once voice resolves, start narration in parallel with image
          if (initialSession.userPrompt !== 'mock') {
            voicePromise.then((voice) => {
              generateNarrationOnly(
                beat.storyText,
                initialSession.tone!,
                initialSession.genre!,
                voice,
                lang
              ).then((audioUrl) => {
                resolvedAudioUrl = audioUrl;
                const latestSession = get().session;
                if (!latestSession) return;
                const rootId = latestSession.storyMap.rootNodeId;
                const rootNode = latestSession.storyMap.nodes[rootId];
                if (!rootNode || rootNode.data.audioUrl) return;

                const updatedNodes = {
                  ...latestSession.storyMap.nodes,
                  [rootId]: {
                    ...rootNode,
                    data: { ...rootNode.data, audioUrl },
                  },
                };
                const updatedMap = { ...latestSession.storyMap, nodes: updatedNodes };
                set({
                  session: deriveSessionFields(latestSession, updatedMap),
                  isGeneratingAudio: false,
                  audioReadyNodeId: rootId,
                });
              }).catch((err) => {
                console.error('Narration generation failed:', err);
                set({ isGeneratingAudio: false });
              });

              set({ isGeneratingAudio: true });
            });
          }

          // Block loading on image + voice (voice is fast, image is the bottleneck)
          const [imageUrl, narratorVoice] = await Promise.all([
            generateImage(beat.imagePrompt, beat.characters, initialSession.visualStyle!),
            voicePromise,
          ]);
          beat.imageUrl = imageUrl;

          const storyMap = createStoryMap(beat);

          // Apply resolved audioUrl if narration finished before image
          if (resolvedAudioUrl) {
            const rootId = storyMap.rootNodeId;
            storyMap.nodes[rootId] = {
              ...storyMap.nodes[rootId],
              data: { ...storyMap.nodes[rootId].data, audioUrl: resolvedAudioUrl },
            };
          }

          const fullSession = deriveSessionFields(
            {
              ...initialSession,
              title: beat.title,
              narratorVoice,
            } as StorySession,
            storyMap
          );

          // If narration already resolved, signal readiness immediately
          const audioExtra = resolvedAudioUrl
            ? { isGeneratingAudio: false, audioReadyNodeId: storyMap.rootNodeId }
            : {};

          set({
            session: fullSession,
            isLoading: false,
            saveStatus: 'unsaved',
            ...audioExtra,
          });
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

          const lang = session.storyConfig?.language || 'english';
          const newNodeId = crypto.randomUUID();
          const parentId = session.storyMap.currentNodeId;

          // Track resolved audio URL — if narration finishes before image,
          // the .then() can't update the store (node doesn't exist yet),
          // so we capture the URL and apply it during the merge.
          let resolvedAudioUrl: string | undefined;

          // Fire-and-forget: start narration in parallel with image generation
          let narrationPromise: Promise<void> | null = null;
          if (session.userPrompt.toLowerCase() !== 'mock' && session.narratorVoice) {
            set({ isGeneratingAudio: true });

            const handleNarrationResolved = (audioUrl: string) => {
              resolvedAudioUrl = audioUrl;
              const latestSession = get().session;
              if (!latestSession) return;
              const node = latestSession.storyMap.nodes[newNodeId];
              if (!node || node.data.audioUrl) return;

              const updatedNodes = {
                ...latestSession.storyMap.nodes,
                [newNodeId]: {
                  ...node,
                  data: { ...node.data, audioUrl },
                },
              };
              const updatedMap = { ...latestSession.storyMap, nodes: updatedNodes };
              set({
                session: deriveSessionFields(latestSession, updatedMap),
                isGeneratingAudio: false,
                audioReadyNodeId: newNodeId,
              });
            };

            const handleNarrationError = (err: unknown) => {
              console.error('Narration generation failed:', err);
              set({ isGeneratingAudio: false });
            };

            if (session.savedStoryId) {
              // Server-side: generate + upload to Supabase in one round trip
              narrationPromise = generateAndPersistNarration(
                beat.storyText, session.tone, session.genre,
                session.narratorVoice, lang,
                session.savedStoryId, newNodeId
              ).then(({ audioUrl }) => handleNarrationResolved(audioUrl))
                .catch(handleNarrationError);
            } else {
              // Fallback: generate only (no persistence yet)
              narrationPromise = generateNarrationOnly(
                beat.storyText, session.tone, session.genre,
                session.narratorVoice, lang
              ).then(handleNarrationResolved)
                .catch(handleNarrationError);
            }
          }

          // Block loading on image only
          const imageUrl = await generateImage(beat.imagePrompt, beat.characters, session.visualStyle);
          beat.imageUrl = imageUrl;

          const updatedMap = addChildNode(
            session.storyMap,
            session.storyMap.currentNodeId,
            optionId,
            beat,
            newNodeId
          );

          // Merge: prefer latest store nodes (with audioUrl from concurrent narration)
          // but override parent (for updated children array) and new node (from addChildNode)
          const latestSession = get().session;
          if (!latestSession) return;
          const mergedMap = {
            ...updatedMap,
            nodes: {
              ...updatedMap.nodes,              // base: stale existing + updated parent + new node
              ...latestSession.storyMap.nodes,  // overlay: latest existing nodes (preserves audioUrl etc.)
              // Re-apply parent's children update (latestSession wouldn't have it)
              [parentId]: {
                ...(latestSession.storyMap.nodes[parentId] || updatedMap.nodes[parentId]),
                children: updatedMap.nodes[parentId].children,
              },
              // Re-apply new node, merging in audioUrl if narration already resolved
              [newNodeId]: {
                ...updatedMap.nodes[newNodeId],
                data: {
                  ...updatedMap.nodes[newNodeId].data,
                  ...(resolvedAudioUrl ? { audioUrl: resolvedAudioUrl } : {}),
                },
              },
            },
          };

          // If narration already resolved, signal readiness immediately
          const audioExtra = resolvedAudioUrl
            ? { isGeneratingAudio: false, audioReadyNodeId: newNodeId }
            : {};

          set({
            session: deriveSessionFields(latestSession, mergedMap),
            isLoading: false,
            saveStatus: 'unsaved',
            ...audioExtra,
          });

          // Fire-and-forget: incremental beat save if story is persisted
          if (session.savedStoryId) {
            const newNode = mergedMap.nodes[mergedMap.currentNodeId];
            // Strip base64 assets before sending — persistence discards them anyway
            const cleanNode = {
              ...newNode,
              data: {
                ...newNode.data,
                imageUrl: newNode.data.imageUrl?.startsWith('data:') ? undefined : newNode.data.imageUrl,
                audioUrl: newNode.data.audioUrl?.startsWith('data:') ? undefined : newNode.data.audioUrl,
              },
            };
            saveBeatAction(session.savedStoryId, mergedMap.currentNodeId, cleanNode).catch(
              (err) => console.error('Incremental beat save failed:', err)
            );

            // Auto-publish if this is an ending beat
            if (beat.isEnding) {
              (async () => {
                const storyPath = getPathToNode(updatedMap, updatedMap.currentNodeId);

                // Storyline cover = second beat (index 1), tree cover = first beat (index 0)
                const storylineCoverNode = storyPath.length > 1 ? storyPath[1] : storyPath[0];
                const treeCoverNode = storyPath[0];

                // Helper: resolve a node's image to a public-bucket URL
                const resolvePublicCoverUrl = async (
                  imageData: string | undefined,
                  destSuffix: string
                ): Promise<string | null> => {
                  if (!imageData) return null;
                  if (imageData.startsWith('data:')) {
                    const supabase = createBrowserClient();
                    const { data: { user } } = await supabase.auth.getUser();
                    if (!user) return null;
                    return uploadCoverImage(user.id, session.savedStoryId!, imageData);
                  }
                  if (extractStoragePath(imageData, 'story-assets')) {
                    // Private-bucket URL — copy to public bucket via server action
                    return copyCoverToPublicBucket(session.savedStoryId!, imageData);
                  }
                  if (extractStoragePath(imageData, 'public-storylines')) {
                    // Already in public bucket
                    return imageData;
                  }
                  // External URL (e.g. picsum placeholder) — skip
                  return null;
                };

                let coverImageUrl: string | null = null;
                try {
                  coverImageUrl = await resolvePublicCoverUrl(
                    storylineCoverNode?.data.imageUrl,
                    'cover.webp'
                  );
                } catch (err) {
                  console.error('Storyline cover upload failed:', err);
                }

                // Also set tree cover (beat 0) if not already set
                try {
                  const treeCoverData = treeCoverNode?.data.imageUrl;
                  if (treeCoverData && treeCoverNode !== storylineCoverNode) {
                    const treeCoverUrl = await resolvePublicCoverUrl(treeCoverData, 'tree-cover.webp');
                    if (treeCoverUrl) {
                      await setStoryCoverImage(session.savedStoryId!, treeCoverUrl);
                    }
                  } else if (coverImageUrl) {
                    // Single-beat story: use same cover for tree
                    await setStoryCoverImage(session.savedStoryId!, coverImageUrl);
                  }
                } catch (err) {
                  console.error('Tree cover upload failed:', err);
                }

                return autoPublishStoryline(
                  session.savedStoryId!,
                  updatedMap.currentNodeId,
                  session.title,
                  coverImageUrl
                );
              })()
                .then((result) => {
                  set({ lastPublishResult: result });
                })
                .catch((err) => console.error('Auto-publish failed:', err));
            }
          }
        } catch (error: any) {
          set({ isLoading: false, error: error.message || 'Failed to continue story' });
        }
      },

      navigateToNode: (nodeId: string) => {
        const { session } = get();
        if (!session || !session.storyMap.nodes[nodeId]) return;

        const updatedMap = { ...session.storyMap, currentNodeId: nodeId };
        set({ session: deriveSessionFields(session, updatedMap) });

        // Fire-and-forget: track exploration position for non-owners
        if (session.explorationMode && session.savedStoryId) {
          trackExplorationAction(session.savedStoryId, nodeId).catch(() => {});
        }
      },

      resetStory: () => {
        set({ session: null, error: null, isLoading: false, loadingClues: [] });
      },

      restartExploration: () => {
        const { session } = get();
        if (!session?.storyMap?.rootNodeId) return;
        const rootId = session.storyMap.rootNodeId;
        const updatedMap = { ...session.storyMap, currentNodeId: rootId };
        set({ session: deriveSessionFields(session, updatedMap) });
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
          const lang = session.storyConfig?.language || 'english';

          // Select voice if not yet chosen
          let voiceName = session.narratorVoice;
          if (!voiceName) {
            voiceName = await selectNarratorVoiceServer(session.genre, session.tone, session.targetAge, lang);
            const currentSession = get().session;
            if (currentSession) {
              set({ session: { ...currentSession, narratorVoice: voiceName } });
            }
          }

          let audioUrl: string;

          if (session.savedStoryId) {
            // Server-side: generate + upload to Supabase in one round trip
            const result = await generateAndPersistNarration(
              node.data.storyText, session.tone, session.genre,
              voiceName, lang, session.savedStoryId, nodeId
            );
            audioUrl = result.audioUrl;
          } else {
            // No cloud save yet — generate only, returns base64
            audioUrl = await generateNarrationOnly(
              node.data.storyText, session.tone, session.genre,
              voiceName, lang
            );
          }

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

        set({ isSaving: true, saveStatus: 'saving', error: null });

        try {
          // Persist story to DB first to get a stable storyId for asset paths.
          // On first save this inserts and returns a new ID; on subsequent saves it updates.
          const strippedForId = {
            ...session,
            beats: session.beats.map(b => ({ ...b, imageUrl: undefined, audioUrl: undefined })),
            storyMap: stripBase64FromStoryMap(session.storyMap),
          };
          const { storyId } = await saveStoryAction(strippedForId, strippedForId.storyMap);

          // Upload assets using the stable storyId so images + audio always share the same folder
          const nodeIds = Object.keys(session.storyMap.nodes);
          const basePath = `${userId}/${storyId}`;
          const assetMap = await uploadNodeAssets('story-assets', basePath, session.storyMap, nodeIds);

          // Replace base64 with storage URLs in the map
          const updatedMap = replaceBase64WithUrls(session.storyMap, assetMap);

          // Strip any remaining base64 and re-save with asset URLs
          const cleanMap = stripBase64FromStoryMap(updatedMap);
          const strippedSession = {
            ...session,
            savedStoryId: storyId,
            beats: session.beats.map(b => ({ ...b, imageUrl: undefined, audioUrl: undefined })),
            storyMap: cleanMap,
          };
          await saveStoryAction(strippedSession, cleanMap);

          // Update local session with savedStoryId but keep original base64 URLs
          // (storage URLs are for DB only — story-assets bucket is private)
          // Re-read latest session to preserve audioUrls written by concurrent narration
          const latestSession = get().session;
          const latestMap = latestSession?.storyMap || session.storyMap;
          const updatedSession = deriveSessionFields(
            { ...(latestSession || session), savedStoryId: storyId, savedByUserId: userId },
            latestMap
          );
          set({ session: updatedSession, isSaving: false, saveStatus: 'saved' });
        } catch (error: any) {
          set({ isSaving: false, saveStatus: 'unsaved', error: error.message || 'Failed to save story' });
        }
      },

      loadStoryFromCloud: async (storyId: string) => {
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

      exploreStoryTree: async (storyId: string) => {
        set({ isLoading: true, error: null, lastPublishResult: null });

        try {
          const session = await loadStoryTreeAction(storyId);
          const fullSession = deriveSessionFields(session, session.storyMap);

          if (process.env.NODE_ENV === 'development') {
            const nodeCount = Object.keys(fullSession.storyMap.nodes).length;
            console.log(`[exploreStory] Loaded ${nodeCount} nodes, exploration=${fullSession.explorationMode}`);
          }

          set({ session: fullSession, isLoading: false, saveStatus: 'saved' });
        } catch (error: any) {
          set({ isLoading: false, error: error.message || 'Failed to load story for exploration' });
        }
      },

      refreshSignedUrls: async () => {
        const session = get().session;
        if (!session?.savedStoryId) return;
        try {
          const refreshedMap = await refreshStoryMapAction(session.savedStoryId);
          const current = get().session;
          if (!current || current.savedStoryId !== session.savedStoryId) return;
          set({ session: deriveSessionFields(current, refreshedMap) });
        } catch {
          // Silent fail — URLs will still work until full expiry
        }
      },

      clearPublishResult: () => {
        set({ lastPublishResult: null });
      },
    })
);
