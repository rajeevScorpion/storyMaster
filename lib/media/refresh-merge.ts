import { extractStoryAssetStorageKey } from '@/lib/types/beat-media';
import type {
  BeatImageGalleryEntry,
  Character,
  CharacterSheetGalleryEntry,
  StoryBeat,
  StoryMap,
} from '@/lib/types/story';

function isTransientMediaUrl(url: string | undefined): boolean {
  return Boolean(url?.startsWith('data:') || url?.startsWith('blob:'));
}

function getMediaIdentity(url: string | undefined): string | null {
  if (!url || isTransientMediaUrl(url)) return null;

  const storageKey = extractStoryAssetStorageKey(url);
  if (storageKey) return storageKey;

  try {
    const parsed = new URL(url);
    return `${parsed.origin}${decodeURIComponent(parsed.pathname)}`;
  } catch {
    return url.split('?')[0] || null;
  }
}

function refreshMatchingUrl(
  currentUrl: string | undefined,
  refreshedUrl: string | undefined
): string | undefined {
  if (!currentUrl || !refreshedUrl || isTransientMediaUrl(currentUrl)) return currentUrl;

  const currentIdentity = getMediaIdentity(currentUrl);
  const refreshedIdentity = getMediaIdentity(refreshedUrl);
  return currentIdentity && currentIdentity === refreshedIdentity ? refreshedUrl : currentUrl;
}

function mergeGalleryUrls<T extends BeatImageGalleryEntry | CharacterSheetGalleryEntry>(
  currentGallery: T[] | undefined,
  refreshedGallery: T[] | undefined
): T[] | undefined {
  if (!currentGallery?.length || !refreshedGallery?.length) return currentGallery;

  const refreshedByStorageKey = new Map(
    refreshedGallery.map((entry) => [entry.storageKey, entry.url])
  );
  return currentGallery.map((entry) => {
    const refreshedUrl = refreshedByStorageKey.get(entry.storageKey);
    return refreshedUrl && !isTransientMediaUrl(entry.url)
      ? { ...entry, url: refreshedUrl }
      : entry;
  });
}

function mergeCharacterAssetUrls(
  currentCharacters: Character[],
  refreshedCharacters: Character[] | undefined
): Character[] {
  if (!refreshedCharacters?.length) return currentCharacters;

  const refreshedById = new Map(refreshedCharacters.map((character) => [character.id, character]));
  return currentCharacters.map((character) => {
    const refreshed = refreshedById.get(character.id);
    if (!refreshed) return character;

    return {
      ...character,
      portraitUrl: refreshMatchingUrl(
        character.portraitUrl,
        refreshed.portraitUrl
      ),
      referenceSheetUrl: refreshMatchingUrl(
        character.referenceSheetUrl,
        refreshed.referenceSheetUrl
      ),
      referenceSheetGallery: mergeGalleryUrls(
        character.referenceSheetGallery,
        refreshed.referenceSheetGallery
      ),
    };
  });
}

function mergeBeatAssetUrls(current: StoryBeat, refreshed: StoryBeat): StoryBeat {
  const refreshedImageUrl = refreshed.imageUrl ?? refreshed.persistedImageUrl;
  return {
    ...current,
    imageUrl: refreshMatchingUrl(current.imageUrl, refreshedImageUrl),
    persistedImageUrl: refreshMatchingUrl(current.persistedImageUrl, refreshedImageUrl),
    imageGallery: mergeGalleryUrls(current.imageGallery, refreshed.imageGallery),
    audioUrl: refreshMatchingUrl(current.audioUrl, refreshed.audioUrl),
    characters: mergeCharacterAssetUrls(current.characters, refreshed.characters),
  };
}

/**
 * Apply newly signed URLs without replacing the live story tree or beat metadata.
 * Only URLs for the same stored object are updated.
 */
export function mergeRefreshedStoryMapAssetUrls(
  currentMap: StoryMap,
  refreshedMap: StoryMap
): StoryMap {
  const nodes = { ...currentMap.nodes };

  for (const [nodeId, currentNode] of Object.entries(currentMap.nodes)) {
    const refreshedNode = refreshedMap.nodes[nodeId];
    if (!refreshedNode) continue;
    nodes[nodeId] = {
      ...currentNode,
      data: mergeBeatAssetUrls(currentNode.data, refreshedNode.data),
    };
  }

  return { ...currentMap, nodes };
}

/** Apply refreshed storyline URLs while preserving all client presentation state. */
export function mergeRefreshedStorylineBeatAssetUrls(
  currentBeats: StoryBeat[],
  refreshedBeats: StoryBeat[]
): StoryBeat[] {
  const refreshedByBeatNumber = new Map(
    refreshedBeats.map((beat) => [beat.beatNumber, beat])
  );

  return currentBeats.map((beat, index) => {
    const refreshed = refreshedByBeatNumber.get(beat.beatNumber) ?? refreshedBeats[index];
    return refreshed ? mergeBeatAssetUrls(beat, refreshed) : beat;
  });
}
