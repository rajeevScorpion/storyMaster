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

/**
 * Signature reuse cache.
 *
 * Supabase and R2 mint a *fresh token* every time an object is signed, so
 * signing the same thumbnail on every request handed the browser a new URL
 * string each visit. Same bytes, different URL — which misses the browser
 * cache, and misses Next's image optimizer too, whose cache key is the whole
 * URL including the query. The result was that every drawer/gallery open
 * re-downloaded and re-encoded artwork that had not changed in weeks, no
 * matter how long `minimumCacheTTL` was set to.
 *
 * Reusing a live signature fixes that: the same object yields the same URL
 * until the token is half-spent, so repeat visits hit cache all the way down.
 * Entries are dropped at the halfway mark rather than at expiry, so a URL
 * handed out here always has at least 50% of its lifetime left — long enough
 * for the client to finish loading it, and for the 24h list TTL that still
 * means a URL stable for 12 hours.
 *
 * Process-local by design: a cold serverless instance simply signs again. It
 * is a latency cache, never a source of truth, and it holds no user identity —
 * a storage signature authorizes the object, not the requester, exactly as
 * before.
 */
const SIGNATURE_REUSE_FRACTION = 0.5;
const SIGNATURE_CACHE_LIMIT = 4000;

const signatureCache = new Map<string, { signedUrl: string; reuseUntil: number }>();

function signatureCacheKey(bucket: string, url: string, expiresIn: number): string {
  // A newline can't appear in a bucket name or URL, so it's a delimiter no
  // key part can smuggle in to collide with a different triple.
  return `${bucket}\n${expiresIn}\n${url}`;
}

function readCachedSignature(key: string): string | null {
  const entry = signatureCache.get(key);
  if (!entry) return null;
  if (entry.reuseUntil <= Date.now()) {
    signatureCache.delete(key);
    return null;
  }
  // Re-insert to move the entry to the tail — Map iterates in insertion order,
  // so the eviction sweep below drops the least recently used first.
  signatureCache.delete(key);
  signatureCache.set(key, entry);
  return entry.signedUrl;
}

function writeCachedSignature(key: string, signedUrl: string, expiresIn: number): void {
  signatureCache.set(key, {
    signedUrl,
    reuseUntil: Date.now() + expiresIn * 1000 * SIGNATURE_REUSE_FRACTION,
  });
  if (signatureCache.size <= SIGNATURE_CACHE_LIMIT) return;
  for (const staleKey of signatureCache.keys()) {
    signatureCache.delete(staleKey);
    if (signatureCache.size <= SIGNATURE_CACHE_LIMIT) break;
  }
}

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

  // Serve live signatures from cache and only pay the signing round trip for
  // what's genuinely missing or half-spent (see the cache note above).
  const signed = new Map<string, string>();
  const pending: string[] = [];
  for (const url of uniqueUrls) {
    const cached = readCachedSignature(signatureCacheKey(bucket, url, expiresIn));
    if (cached) {
      signed.set(url, cached);
    } else {
      pending.push(url);
    }
  }
  if (pending.length === 0) return signed;

  const [supabaseSigned, r2Pairs] = await Promise.all([
    signSupabaseUrls(supabase, bucket, pending, expiresIn),
    Promise.all(pending.map(async (url) => [url, await signR2Url(url, expiresIn)] as const)),
  ]);

  for (const [url, signedUrl] of supabaseSigned) {
    signed.set(url, signedUrl);
  }
  // R2 references win over the Supabase pass, as before.
  for (const [url, signedUrl] of r2Pairs) {
    if (signedUrl) signed.set(url, signedUrl);
  }
  for (const url of pending) {
    const signedUrl = signed.get(url);
    if (signedUrl) writeCachedSignature(signatureCacheKey(bucket, url, expiresIn), signedUrl, expiresIn);
  }
  return signed;
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
