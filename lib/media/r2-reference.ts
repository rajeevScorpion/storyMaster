const R2_REFERENCE_PREFIX = 'r2://';

export type R2Reference = {
  bucket: string;
  objectKey: string;
};

export function toR2Reference(bucket: string, objectKey: string): string {
  return `${R2_REFERENCE_PREFIX}${bucket.replace(/^\/+|\/+$/g, '')}/${objectKey.replace(/^\/+/, '')}`;
}

export function parseR2Reference(value: string | null | undefined): R2Reference | null {
  if (!value?.startsWith(R2_REFERENCE_PREFIX)) return null;
  const withoutPrefix = value.slice(R2_REFERENCE_PREFIX.length);
  const separator = withoutPrefix.indexOf('/');
  if (separator <= 0 || separator === withoutPrefix.length - 1) return null;
  return {
    bucket: withoutPrefix.slice(0, separator),
    objectKey: withoutPrefix.slice(separator + 1),
  };
}

export function isR2Reference(value: string | null | undefined): value is string {
  return Boolean(parseR2Reference(value));
}

export function getR2ObjectKeyFromUrl(value: string | null | undefined): string | null {
  const parsedRef = parseR2Reference(value);
  if (parsedRef) return parsedRef.objectKey;
  if (!value) return null;

  try {
    const url = new URL(value);
    const path = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const storiesIdx = path.indexOf('stories/');
    if (storiesIdx >= 0) return path.slice(storiesIdx);
  } catch {
    return null;
  }

  return null;
}

export function parseR2UrlLikeReference(value: string | null | undefined): R2Reference | null {
  const parsedRef = parseR2Reference(value);
  if (parsedRef) return parsedRef;
  if (!value) return null;

  try {
    const url = new URL(value);
    if (!url.hostname.endsWith('.r2.cloudflarestorage.com')) return null;
    const segments = decodeURIComponent(url.pathname)
      .split('/')
      .filter(Boolean);
    const storiesIdx = segments.indexOf('stories');
    if (storiesIdx <= 0 || storiesIdx === segments.length - 1) return null;
    return {
      bucket: segments[storiesIdx - 1],
      objectKey: segments.slice(storiesIdx).join('/'),
    };
  } catch {
    return null;
  }
}

export function normalizeR2UrlLikeReference(value: string): string {
  const parsed = parseR2UrlLikeReference(value);
  return parsed ? toR2Reference(parsed.bucket, parsed.objectKey) : value;
}
