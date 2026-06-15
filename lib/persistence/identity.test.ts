import { describe, expect, it } from 'vitest';
import { getStableMediaIdentity } from './identity';

describe('getStableMediaIdentity', () => {
  it('keeps Supabase identity stable when signed tokens change', () => {
    const first = getStableMediaIdentity(
      'https://project.supabase.co/storage/v1/object/sign/story-assets/user/story/image.webp?token=first',
      'image'
    );
    const second = getStableMediaIdentity(
      'https://project.supabase.co/storage/v1/object/sign/story-assets/user/story/image.webp?token=second',
      'image'
    );
    expect(first).toBe(second);
  });

  it('normalizes R2 references and signed URLs to one identity', () => {
    const reference = getStableMediaIdentity('r2://private/stories/story/beat/audio.wav', 'audio');
    const signed = getStableMediaIdentity(
      'https://account.r2.cloudflarestorage.com/private/stories/story/beat/audio.wav?X-Amz-Signature=abc',
      'audio'
    );
    expect(reference).toBe(signed);
  });
});
