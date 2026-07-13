// Pack 1 image version history helpers. The version store is the existing
// beats.image_gallery JSONB array; regeneration entries carry extra metadata
// (mode, suggestions, prompt snapshot). These helpers are pure so the worker
// (lib/media/image-job-runner.ts), the persistence layer, and the client
// store all share one field mapping and one eviction policy.

import type { BeatImageGalleryEntry, BeatImageVersionMode } from '@/lib/types/story';
import type { ImageCompressionMetadata } from '@/lib/media/imageUploadOptimization';

export const BEAT_IMAGE_PROMPT_SNAPSHOT_MAX_CHARS = 4000;

const VERSION_MODES: BeatImageVersionMode[] = ['initial', 'refine', 'reimagine', 'restore', 'upload'];

function normalizeMode(raw: unknown): BeatImageVersionMode | undefined {
  return VERSION_MODES.includes(raw as BeatImageVersionMode) ? (raw as BeatImageVersionMode) : undefined;
}

function normalizePanelSuggestions(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw as Record<string, unknown>).filter(
    (pair): pair is [string, string] => typeof pair[1] === 'string' && pair[1].trim().length > 0
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function truncatePromptSnapshot(prompt: string | null | undefined): string | undefined {
  const trimmed = prompt?.trim();
  if (!trimmed) return undefined;
  return trimmed.length > BEAT_IMAGE_PROMPT_SNAPSHOT_MAX_CHARS
    ? `${trimmed.slice(0, BEAT_IMAGE_PROMPT_SNAPSHOT_MAX_CHARS)}…`
    : trimmed;
}

/**
 * Serialize a gallery entry to the snake_case shape stored in the
 * beats.image_gallery JSONB column. `normalizeUrl` lets server callers apply
 * normalizeStorageUrl without this module importing server-only code.
 */
export function serializeGalleryEntry(
  entry: BeatImageGalleryEntry,
  normalizeUrl?: (url: string) => string
): Record<string, unknown> {
  return {
    url: normalizeUrl ? normalizeUrl(entry.url) : entry.url,
    storage_key: entry.storageKey,
    uploaded_at: entry.uploadedAt,
    ...(entry.optimizationMetadata
      ? { optimization_metadata: entry.optimizationMetadata as unknown as Record<string, unknown> }
      : {}),
    ...(entry.mode ? { mode: entry.mode } : {}),
    ...(entry.overallSuggestion ? { overall_suggestion: entry.overallSuggestion } : {}),
    ...(entry.panelSuggestions ? { panel_suggestions: entry.panelSuggestions } : {}),
    ...(entry.promptSnapshot ? { prompt_snapshot: entry.promptSnapshot } : {}),
    ...(entry.source ? { source: entry.source } : {}),
    ...(typeof entry.versionNumber === 'number' ? { version_number: entry.versionNumber } : {}),
  };
}

/** Parse a raw snake_case row entry back into a BeatImageGalleryEntry. */
export function parseGalleryEntry(raw: unknown): BeatImageGalleryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.url !== 'string' || !row.url) return null;
  const source = row.source === 'system' || row.source === 'user' ? row.source : undefined;
  return {
    url: row.url,
    storageKey: typeof row.storage_key === 'string' ? row.storage_key : '',
    uploadedAt: typeof row.uploaded_at === 'string' ? row.uploaded_at : new Date().toISOString(),
    ...(row.optimization_metadata
      ? { optimizationMetadata: row.optimization_metadata as unknown as ImageCompressionMetadata }
      : {}),
    ...(normalizeMode(row.mode) ? { mode: normalizeMode(row.mode) } : {}),
    ...(typeof row.overall_suggestion === 'string' && row.overall_suggestion
      ? { overallSuggestion: row.overall_suggestion }
      : {}),
    ...(normalizePanelSuggestions(row.panel_suggestions)
      ? { panelSuggestions: normalizePanelSuggestions(row.panel_suggestions) }
      : {}),
    ...(typeof row.prompt_snapshot === 'string' && row.prompt_snapshot
      ? { promptSnapshot: row.prompt_snapshot }
      : {}),
    ...(source ? { source } : {}),
    ...(typeof row.version_number === 'number' ? { versionNumber: row.version_number } : {}),
  };
}

export function serializeGalleryRows(
  gallery: BeatImageGalleryEntry[] | undefined | null,
  normalizeUrl?: (url: string) => string
): Record<string, unknown>[] {
  return (gallery ?? []).map((entry) => serializeGalleryEntry(entry, normalizeUrl));
}

export function parseGalleryRows(raw: unknown): BeatImageGalleryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseGalleryEntry).filter((entry): entry is BeatImageGalleryEntry => entry !== null);
}

/**
 * Sanitize a camelCase gallery for embedding into the story_map blob:
 * drops data-URL entries and preserves all version metadata.
 */
export function sanitizeGalleryForBlob(
  gallery: BeatImageGalleryEntry[] | undefined | null,
  normalizeUrl?: (url: string) => string
): BeatImageGalleryEntry[] {
  return (gallery ?? [])
    .filter((entry) => Boolean(entry?.url) && !entry.url.startsWith('data:'))
    .map((entry) => ({
      ...entry,
      url: normalizeUrl ? normalizeUrl(entry.url) : entry.url,
    }));
}

export function nextVersionNumber(gallery: BeatImageGalleryEntry[] | undefined | null): number {
  let max = 0;
  for (const entry of gallery ?? []) {
    if (typeof entry.versionNumber === 'number' && entry.versionNumber > max) {
      max = entry.versionNumber;
    }
  }
  return max + 1;
}

export function findGalleryEntry(
  gallery: BeatImageGalleryEntry[] | undefined | null,
  storageKey: string
): BeatImageGalleryEntry | undefined {
  return (gallery ?? []).find((entry) => entry.storageKey === storageKey);
}

/** True when two URLs point at the same stored object (signed variants of the
 *  same object share the path before the query string). */
export function imageUrlsMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const stripQuery = (value: string) => value.split('?')[0];
  return stripQuery(a) === stripQuery(b);
}

const urlsMatch = imageUrlsMatch;

/**
 * Ensure the beat's current active image is represented in the gallery so
 * the pre-Pack-1 image becomes restorable version 1 before a regeneration
 * replaces it. No-op when the gallery already contains the active image or
 * there is no active image.
 */
export function ensureActiveImageInGallery(
  gallery: BeatImageGalleryEntry[],
  activeImageUrl: string | null | undefined,
  nowIso: string
): BeatImageGalleryEntry[] {
  if (!activeImageUrl || activeImageUrl.startsWith('data:')) return gallery;
  if (gallery.some((entry) => urlsMatch(entry.url, activeImageUrl))) return gallery;
  return [
    ...gallery,
    {
      url: activeImageUrl,
      storageKey: activeImageUrl,
      uploadedAt: nowIso,
      mode: 'initial',
      source: 'system',
      versionNumber: nextVersionNumber(gallery),
    },
  ];
}

/**
 * Append a new version entry, evicting the oldest regeneration-family
 * entries (mode set and not 'upload') beyond `cap`. Upload entries keep the
 * prompt-only flow's own cap/prune lifecycle, and the entry matching
 * `activeImageUrl` is never evicted.
 */
export function appendImageVersion(
  gallery: BeatImageGalleryEntry[],
  entry: BeatImageGalleryEntry,
  cap: number,
  activeImageUrl?: string | null
): BeatImageGalleryEntry[] {
  const next = [...gallery, entry];
  const isVersionEntry = (candidate: BeatImageGalleryEntry) =>
    Boolean(candidate.mode) && candidate.mode !== 'upload';
  const versionEntries = next.filter(isVersionEntry);
  const overflow = versionEntries.length - Math.max(1, cap);
  if (overflow <= 0) return next;

  const evictable = versionEntries
    .filter((candidate) => candidate !== entry && !urlsMatch(candidate.url, activeImageUrl))
    .sort((a, b) => {
      const byVersion = (a.versionNumber ?? 0) - (b.versionNumber ?? 0);
      if (byVersion !== 0) return byVersion;
      return a.uploadedAt.localeCompare(b.uploadedAt);
    })
    .slice(0, overflow);
  if (evictable.length === 0) return next;

  const evictSet = new Set(evictable);
  return next.filter((candidate) => !evictSet.has(candidate));
}
