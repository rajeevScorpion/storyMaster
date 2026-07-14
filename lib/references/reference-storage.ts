// Pure storage-key builders and upload-validation helpers for Reference
// Personalization. No I/O — safe to unit test. Private objects live under a
// dedicated R2 prefix owned entirely by reference_sources / reference_adoptions
// rows (never media_assets), so retention cleanup never touches them.

import { createHash } from 'node:crypto';
import { splitBase64DataUrl } from '@/lib/utils/data-url';
import type { ReferenceKind } from '@/lib/types/references';

/** Root prefix for every private reference object. */
export const REFERENCE_STORAGE_PREFIX = 'references';

const MIME_EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
};

export const ACCEPTED_REFERENCE_MIME_TYPES = Object.keys(MIME_EXTENSIONS);

export function referenceMimeExtension(mimeType: string): string {
  return MIME_EXTENSIONS[mimeType.toLowerCase()] ?? 'webp';
}

/** Private key for an original upload: references/{userId}/{setupId}/src_{sourceId}.{ext} */
export function buildReferenceSourceKey(input: {
  userId: string;
  setupId: string;
  sourceId: string;
  mimeType: string;
}): string {
  const ext = referenceMimeExtension(input.mimeType);
  return `${REFERENCE_STORAGE_PREFIX}/${input.userId}/${input.setupId}/src_${input.sourceId}.${ext}`;
}

/** Private key for a canonical adopted asset: .../{setupId}/adopt_{adoptionId}_canonical.webp */
export function buildCanonicalReferenceKey(input: {
  userId: string;
  setupId: string;
  adoptionId: string;
}): string {
  return `${REFERENCE_STORAGE_PREFIX}/${input.userId}/${input.setupId}/adopt_${input.adoptionId}_canonical.webp`;
}

export function checksumSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export interface DecodedReferenceUpload {
  buffer: Buffer;
  mimeType: string;
  bytes: number;
  checksum: string;
}

export type ReferenceUploadValidationError =
  | 'invalid_data_url'
  | 'unsupported_mime'
  | 'too_large'
  | 'empty';

/**
 * Decode a client data URL into a validated buffer. Returns a discriminated
 * result so the caller can map to a stable REFERENCE_* error code. Dimension
 * checks happen in the action (they need an image decode).
 */
export function decodeReferenceUpload(input: {
  dataUrl: string;
  maxBytes: number;
}): { ok: true; value: DecodedReferenceUpload } | { ok: false; error: ReferenceUploadValidationError } {
  const parsed = splitBase64DataUrl(input.dataUrl);
  if (!parsed) return { ok: false, error: 'invalid_data_url' };

  const mimeType = parsed.mimeType.toLowerCase();
  if (!(mimeType in MIME_EXTENSIONS)) return { ok: false, error: 'unsupported_mime' };

  const buffer = Buffer.from(parsed.base64, 'base64');
  if (buffer.byteLength === 0) return { ok: false, error: 'empty' };
  if (buffer.byteLength > input.maxBytes) return { ok: false, error: 'too_large' };

  return {
    ok: true,
    value: {
      buffer,
      mimeType,
      bytes: buffer.byteLength,
      checksum: checksumSha256(buffer),
    },
  };
}

/** The two upload sections; used to validate a client-supplied kind. */
export function isReferenceKind(value: unknown): value is ReferenceKind {
  return value === 'character' || value === 'world';
}
