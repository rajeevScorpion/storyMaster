import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createR2SignedGetUrl } from '@/lib/media/r2-server';
import { parseR2Reference, parseR2UrlLikeReference } from '@/lib/media/r2-reference';
import { recoverCharacterReferenceSheet } from '@/lib/media/character-reference';
import { extractStoragePath } from '@/lib/supabase/storage';
import type { StoryBeat, StoryMap, Character } from '@/lib/types/story';

type StoryMapFieldEntry = { nodeId: string; field: 'imageUrl' | 'audioUrl'; url: string };
type StoryMapGalleryEntry = { nodeId: string; galleryIdx: number; url: string };
type StoryMapCharacterEntry = { nodeId: string; characterIdx: number; url: string };
type StoryMapCharacterGalleryEntry = { nodeId: string; characterIdx: number; galleryIdx: number; url: string };

async function signR2Url(value: string, expiresIn: number): Promise<string | null> {
  const parsedReference = parseR2Reference(value) ?? parseR2UrlLikeReference(value);
  if (!parsedReference) return null;
  try {
    return await createR2SignedGetUrl(parsedReference.bucket, parsedReference.objectKey, expiresIn);
  } catch (error) {
    console.error('Failed to create R2 signed URL:', error instanceof Error ? error.message : error);
    return null;
  }
}

async function signSupabaseUrls(
  supabase: SupabaseClient,
  bucket: string,
  urls: string[],
  expiresIn: number
): Promise<Map<string, string>> {
  const pathEntries = urls
    .map((url) => ({ url, path: extractStoragePath(url, bucket) }))
    .filter((entry): entry is { url: string; path: string } => Boolean(entry.path));
  if (pathEntries.length === 0) return new Map();

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(pathEntries.map((entry) => entry.path), expiresIn);

  if (error || !data) {
    console.error('Failed to create Supabase signed URLs:', error?.message);
    return new Map();
  }

  const signed = new Map<string, string>();
  pathEntries.forEach((entry, index) => {
    const signedUrl = data[index]?.signedUrl;
    if (signedUrl && !data[index]?.error) {
      signed.set(entry.url, signedUrl);
    }
  });
  return signed;
}

export async function signMixedUrls(
  supabase: SupabaseClient,
  urls: string[],
  bucket: string,
  expiresIn: number
): Promise<Map<string, string>> {
  const uniqueUrls = Array.from(new Set(urls.filter(Boolean)));
  const [supabaseSigned, r2Pairs] = await Promise.all([
    signSupabaseUrls(supabase, bucket, uniqueUrls, expiresIn),
    Promise.all(uniqueUrls.map(async (url) => [url, await signR2Url(url, expiresIn)] as const)),
  ]);

  for (const [url, signed] of r2Pairs) {
    if (signed) supabaseSigned.set(url, signed);
  }
  return supabaseSigned;
}

function addUrl(list: string[], value: string | undefined | null) {
  if (value) list.push(value);
}

function getCharacterReferenceStorageContext() {
  return {
    r2PrivateBucket: process.env.R2_PRIVATE_BUCKET_NAME,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseBucket: 'story-assets',
  };
}

export async function signStoryMapAssetUrls(
  supabase: SupabaseClient,
  storyMap: StoryMap,
  bucket = 'story-assets',
  expiresIn = 3600
): Promise<StoryMap> {
  const fieldEntries: StoryMapFieldEntry[] = [];
  const galleryEntries: StoryMapGalleryEntry[] = [];
  const portraitEntries: StoryMapCharacterEntry[] = [];
  const characterSheetEntries: StoryMapCharacterEntry[] = [];
  const characterSheetGalleryEntries: StoryMapCharacterGalleryEntry[] = [];
  const urls: string[] = [];
  const referenceStorageContext = getCharacterReferenceStorageContext();
  const hydratedStoryMap: StoryMap = {
    ...storyMap,
    nodes: Object.fromEntries(
      Object.entries(storyMap.nodes).map(([nodeId, node]) => [
        nodeId,
        {
          ...node,
          data: {
            ...node.data,
            characters: (node.data.characters ?? []).map((character) =>
              recoverCharacterReferenceSheet(
                character,
                undefined,
                referenceStorageContext
              )
            ),
          },
        },
      ])
    ),
  };

  for (const [nodeId, node] of Object.entries(hydratedStoryMap.nodes)) {
    for (const field of ['imageUrl', 'audioUrl'] as const) {
      const url = node.data[field];
      if (!url) continue;
      fieldEntries.push({ nodeId, field, url });
      addUrl(urls, url);
    }
    node.data.imageGallery?.forEach((entry, galleryIdx) => {
      galleryEntries.push({ nodeId, galleryIdx, url: entry.url });
      addUrl(urls, entry.url);
    });
    node.data.characters?.forEach((character, characterIdx) => {
      if (character.portraitUrl) {
        portraitEntries.push({ nodeId, characterIdx, url: character.portraitUrl });
        addUrl(urls, character.portraitUrl);
      }
      if (character.referenceSheetUrl) {
        characterSheetEntries.push({ nodeId, characterIdx, url: character.referenceSheetUrl });
        addUrl(urls, character.referenceSheetUrl);
      }
      character.referenceSheetGallery?.forEach((entry, galleryIdx) => {
        characterSheetGalleryEntries.push({ nodeId, characterIdx, galleryIdx, url: entry.url });
        addUrl(urls, entry.url);
      });
    });
  }

  if (urls.length === 0) return hydratedStoryMap;

  const signed = await signMixedUrls(supabase, urls, bucket, expiresIn);
  if (signed.size === 0) return hydratedStoryMap;

  const cloned: StoryMap = {
    ...hydratedStoryMap,
    nodes: { ...hydratedStoryMap.nodes },
  };

  for (const entry of fieldEntries) {
    const signedUrl = signed.get(entry.url);
    if (!signedUrl) continue;
    const node = cloned.nodes[entry.nodeId];
    cloned.nodes[entry.nodeId] = {
      ...node,
      data: { ...node.data, [entry.field]: signedUrl },
    };
  }

  for (const entry of galleryEntries) {
    const signedUrl = signed.get(entry.url);
    if (!signedUrl) continue;
    const node = cloned.nodes[entry.nodeId];
    const gallery = node.data.imageGallery ?? [];
    cloned.nodes[entry.nodeId] = {
      ...node,
      data: {
        ...node.data,
        imageGallery: gallery.map((item, idx) =>
          idx === entry.galleryIdx ? { ...item, url: signedUrl } : item
        ),
      },
    };
  }

  for (const entry of portraitEntries) {
    const signedUrl = signed.get(entry.url);
    if (!signedUrl) continue;
    const node = cloned.nodes[entry.nodeId];
    const characters = node.data.characters ?? [];
    cloned.nodes[entry.nodeId] = {
      ...node,
      data: {
        ...node.data,
        characters: characters.map((character, idx) =>
          idx === entry.characterIdx ? { ...character, portraitUrl: signedUrl } : character
        ),
      },
    };
  }

  for (const entry of characterSheetEntries) {
    const signedUrl = signed.get(entry.url);
    if (!signedUrl) continue;
    const node = cloned.nodes[entry.nodeId];
    const characters = node.data.characters ?? [];
    cloned.nodes[entry.nodeId] = {
      ...node,
      data: {
        ...node.data,
        characters: characters.map((character, idx) =>
          idx === entry.characterIdx ? { ...character, referenceSheetUrl: signedUrl } : character
        ),
      },
    };
  }

  for (const entry of characterSheetGalleryEntries) {
    const signedUrl = signed.get(entry.url);
    if (!signedUrl) continue;
    const node = cloned.nodes[entry.nodeId];
    const characters = node.data.characters ?? [];
    cloned.nodes[entry.nodeId] = {
      ...node,
      data: {
        ...node.data,
        characters: characters.map((character, idx) => {
          if (idx !== entry.characterIdx) return character;
          return {
            ...character,
            referenceSheetGallery: (character.referenceSheetGallery ?? []).map((item, galleryIdx) =>
              galleryIdx === entry.galleryIdx ? { ...item, url: signedUrl } : item
            ),
          };
        }),
      },
    };
  }

  return cloned;
}

export async function signCharacterRosterReferenceSheetUrls<T extends Character>(
  supabase: SupabaseClient,
  characters: T[] | undefined | null,
  bucket = 'story-assets',
  expiresIn = 3600
): Promise<T[]> {
  if (!characters || characters.length === 0) return characters ?? [];

  const referenceStorageContext = getCharacterReferenceStorageContext();
  const hydratedCharacters = characters.map((character) =>
    recoverCharacterReferenceSheet(
      character,
      undefined,
      referenceStorageContext,
      { synthesizeGallery: true }
    ) as T
  );
  const urls: string[] = [];
  hydratedCharacters.forEach((character) => {
    addUrl(urls, character.portraitUrl);
    addUrl(urls, character.referenceSheetUrl);
    character.referenceSheetGallery?.forEach((entry) => addUrl(urls, entry.url));
  });
  if (urls.length === 0) return hydratedCharacters;

  const signed = await signMixedUrls(supabase, urls, bucket, expiresIn);
  if (signed.size === 0) return hydratedCharacters;

  return hydratedCharacters.map((character) => ({
    ...character,
    portraitUrl: character.portraitUrl
      ? signed.get(character.portraitUrl) ?? character.portraitUrl
      : character.portraitUrl,
    referenceSheetUrl: character.referenceSheetUrl
      ? signed.get(character.referenceSheetUrl) ?? character.referenceSheetUrl
      : character.referenceSheetUrl,
    referenceSheetGallery: character.referenceSheetGallery?.map((entry) => ({
      ...entry,
      url: signed.get(entry.url) ?? entry.url,
    })),
  }));
}

export async function signStorylineBeatsUrls(
  supabase: SupabaseClient,
  beats: StoryBeat[],
  bucket = 'story-assets',
  expiresIn = 3600
): Promise<StoryBeat[]> {
  const urls: string[] = [];
  beats.forEach((beat) => {
    addUrl(urls, beat.imageUrl);
    addUrl(urls, beat.audioUrl);
  });
  if (urls.length === 0) return beats;

  const signed = await signMixedUrls(supabase, urls, bucket, expiresIn);
  if (signed.size === 0) return beats;

  return beats.map((beat) => ({
    ...beat,
    imageUrl: beat.imageUrl ? signed.get(beat.imageUrl) ?? beat.imageUrl : beat.imageUrl,
    audioUrl: beat.audioUrl ? signed.get(beat.audioUrl) ?? beat.audioUrl : beat.audioUrl,
  }));
}
