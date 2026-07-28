import {
  isR2Reference,
  normalizeR2UrlLikeReference,
  toR2Reference,
} from '@/lib/media/r2-reference';
import type { Character, CharacterSheetGalleryEntry } from '@/lib/types/story';

export interface CharacterReferenceStorageContext {
  r2PrivateBucket?: string | null;
  supabaseUrl?: string | null;
  supabaseBucket?: string;
}

export interface RecoverCharacterReferenceOptions {
  synthesizeGallery?: boolean;
}

function cleanValue(value: string | null | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function isTemporaryReference(value: string): boolean {
  return value.startsWith('data:') || value.startsWith('blob:');
}

/**
 * Returns a persistence-safe URL/reference. R2 signed URLs are reduced back to
 * their durable r2:// form; temporary browser URLs are rejected.
 */
export function canonicalizeCharacterReferenceUrl(
  value: string | null | undefined
): string | undefined {
  const cleaned = cleanValue(value);
  if (!cleaned || isTemporaryReference(cleaned)) return undefined;
  return normalizeR2UrlLikeReference(cleaned);
}

/**
 * Rebuilds the canonical media pointer from the separately persisted object
 * key. Current R2 character uploads use stories/... keys; Supabase fallback
 * uploads retain their user-prefixed bucket path.
 */
export function buildCharacterReferenceUrlFromStorageKey(
  storageKey: string | null | undefined,
  context: CharacterReferenceStorageContext
): string | undefined {
  const key = cleanValue(storageKey);
  if (!key || key.startsWith('pending/')) return undefined;
  if (key.startsWith('r2://')) return key;

  if (key.startsWith('stories/') && context.r2PrivateBucket?.trim()) {
    return toR2Reference(context.r2PrivateBucket, key);
  }

  const supabaseUrl = context.supabaseUrl?.trim().replace(/\/+$/, '');
  if (!supabaseUrl) return undefined;
  const bucket = context.supabaseBucket?.trim() || 'story-assets';
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${key.replace(/^\/+/, '')}`;
}

function resolveGallery(
  character: Character,
  fallback: Character | undefined,
  context: CharacterReferenceStorageContext
): CharacterSheetGalleryEntry[] | undefined {
  const source = Array.isArray(character.referenceSheetGallery)
    ? character.referenceSheetGallery
    : fallback?.referenceSheetGallery;
  if (!source) return undefined;

  return source.flatMap((entry) => {
    const url =
      canonicalizeCharacterReferenceUrl(entry.url)
      ?? buildCharacterReferenceUrlFromStorageKey(entry.storageKey, context);
    if (!url) return [];
    return [{
      ...entry,
      url,
    }];
  });
}

/**
 * Restores a character's active reference from a durable URL, an existing
 * persisted fallback, or its storage key (in that order). This is deliberately
 * pure so save, load, signing, repair, and tests share one rule.
 */
export function recoverCharacterReferenceSheet(
  character: Character,
  fallback: Character | undefined,
  context: CharacterReferenceStorageContext,
  options: RecoverCharacterReferenceOptions = {}
): Character {
  const referenceSheetStorageKey =
    cleanValue(character.referenceSheetStorageKey)
    ?? cleanValue(fallback?.referenceSheetStorageKey);
  const referenceSheetUploadedAt =
    cleanValue(character.referenceSheetUploadedAt)
    ?? cleanValue(fallback?.referenceSheetUploadedAt);
  const referenceSheetUrl =
    canonicalizeCharacterReferenceUrl(character.referenceSheetUrl)
    ?? canonicalizeCharacterReferenceUrl(fallback?.referenceSheetUrl)
    ?? buildCharacterReferenceUrlFromStorageKey(referenceSheetStorageKey, context);

  let referenceSheetGallery = resolveGallery(character, fallback, context);
  if (
    options.synthesizeGallery
    && (!referenceSheetGallery || referenceSheetGallery.length === 0)
    && referenceSheetUrl
    && referenceSheetStorageKey
    && referenceSheetUploadedAt
  ) {
    referenceSheetGallery = [{
      url: referenceSheetUrl,
      storageKey: referenceSheetStorageKey,
      uploadedAt: referenceSheetUploadedAt,
    }];
  }

  const recovered: Character = { ...character };
  if (referenceSheetUrl) {
    recovered.referenceSheetUrl = referenceSheetUrl;
  } else {
    delete recovered.referenceSheetUrl;
  }
  if (referenceSheetStorageKey) {
    recovered.referenceSheetStorageKey = referenceSheetStorageKey;
  } else {
    delete recovered.referenceSheetStorageKey;
  }
  if (referenceSheetUploadedAt) {
    recovered.referenceSheetUploadedAt = referenceSheetUploadedAt;
  } else {
    delete recovered.referenceSheetUploadedAt;
  }
  if (referenceSheetGallery && referenceSheetGallery.length > 0) {
    recovered.referenceSheetGallery = referenceSheetGallery;
  } else {
    delete recovered.referenceSheetGallery;
  }

  return recovered;
}

/**
 * Extracts a durable r2:// pointer from either a canonical R2 reference or an
 * R2 signed URL. Plain Supabase/HTTP references intentionally return undefined.
 */
export function getDurableR2Reference(
  value: string | null | undefined
): string | undefined {
  const canonical = canonicalizeCharacterReferenceUrl(value);
  return canonical && isR2Reference(canonical) ? canonical : undefined;
}
