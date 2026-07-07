export type StorylineVisibility = 'private' | 'public' | 'unlisted';

export type StorylinePublishQuality = 'standard' | 'high';

export const STORYLINE_VISIBILITIES: StorylineVisibility[] = ['private', 'public', 'unlisted'];

export function normalizeStorylineVisibility(value: unknown): StorylineVisibility {
  return value === 'public' || value === 'unlisted' || value === 'private' ? value : 'private';
}

export function normalizePublishQuality(value: unknown): StorylinePublishQuality {
  return value === 'high' ? 'high' : 'standard';
}

/** URL-safe unguessable token for unlisted share links (revocable/rotatable). */
export function generateShareToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Constant-time comparison so token checks don't leak prefix matches. */
export function shareTokensEqual(expected: string | null | undefined, provided: string | null | undefined): boolean {
  if (!expected || !provided) return false;
  if (expected.length !== provided.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return mismatch === 0;
}

export function buildUnlistedShareUrl(origin: string, storylineId: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/storyline/${storylineId}?token=${encodeURIComponent(token)}`;
}
