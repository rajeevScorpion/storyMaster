import { describe, expect, it } from 'vitest';

import {
  buildCharacterReferenceUrlFromStorageKey,
  canonicalizeCharacterReferenceUrl,
  getDurableR2Reference,
  recoverCharacterReferenceSheet,
} from './character-reference';
import type { Character } from '@/lib/types/story';

const storageContext = {
  r2PrivateBucket: 'kissago-private',
  supabaseUrl: 'https://project.supabase.co',
  supabaseBucket: 'story-assets',
};

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'bhima',
    name: 'Bhima',
    type: 'person',
    appearanceSummary: 'A brave child.',
    personalitySummary: 'Curious.',
    ...overrides,
  };
}

describe('character reference persistence', () => {
  it('rebuilds an orphaned R2 reference and gallery from its storage key', () => {
    const recovered = recoverCharacterReferenceSheet(
      makeCharacter({
        referenceSheetStorageKey: 'stories/story-1/characters/bhima/sheet.webp',
        referenceSheetUploadedAt: '2026-07-28T06:17:15.161Z',
      }),
      undefined,
      storageContext,
      { synthesizeGallery: true }
    );

    expect(recovered.referenceSheetUrl).toBe(
      'r2://kissago-private/stories/story-1/characters/bhima/sheet.webp'
    );
    expect(recovered.referenceSheetGallery).toEqual([{
      url: 'r2://kissago-private/stories/story-1/characters/bhima/sheet.webp',
      storageKey: 'stories/story-1/characters/bhima/sheet.webp',
      uploadedAt: '2026-07-28T06:17:15.161Z',
    }]);
  });

  it('uses the persisted fallback when a later save still has a data preview', () => {
    const recovered = recoverCharacterReferenceSheet(
      makeCharacter({
        referenceSheetUrl: 'data:image/webp;base64,preview',
        referenceSheetStorageKey: 'stories/story-1/characters/bhima/sheet.webp',
      }),
      makeCharacter({
        referenceSheetUrl: 'r2://kissago-private/stories/story-1/characters/bhima/sheet.webp',
        referenceSheetStorageKey: 'stories/story-1/characters/bhima/sheet.webp',
      }),
      storageContext
    );

    expect(recovered.referenceSheetUrl).toBe(
      'r2://kissago-private/stories/story-1/characters/bhima/sheet.webp'
    );
  });

  it('reduces an R2 signed display URL back to a durable reference', () => {
    const signed =
      'https://account.r2.cloudflarestorage.com/kissago-private/stories/story-1/characters/bhima/sheet.webp?X-Amz-Signature=abc';

    expect(canonicalizeCharacterReferenceUrl(signed)).toBe(
      'r2://kissago-private/stories/story-1/characters/bhima/sheet.webp'
    );
    expect(getDurableR2Reference(signed)).toBe(
      'r2://kissago-private/stories/story-1/characters/bhima/sheet.webp'
    );
  });

  it('reconstructs Supabase fallback paths but rejects provisional keys', () => {
    expect(
      buildCharacterReferenceUrlFromStorageKey(
        'user-1/story-1/character-sheets/bhima/sheet.webp',
        storageContext
      )
    ).toBe(
      'https://project.supabase.co/storage/v1/object/public/story-assets/user-1/story-1/character-sheets/bhima/sheet.webp'
    );
    expect(
      buildCharacterReferenceUrlFromStorageKey(
        'pending/character-sheets/bhima.webp',
        storageContext
      )
    ).toBeUndefined();
  });
});
