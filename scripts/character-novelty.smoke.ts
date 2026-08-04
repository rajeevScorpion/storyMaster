import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { describe, expect, it } from 'vitest';
import {
  buildCharacterNoveltyInstructions,
  normalizeCharacterName,
  validateCharacterNovelty,
  type CharacterNoveltyContext,
} from '@/lib/ai/character-novelty.shared';
import type { Character, StoryBeat } from '@/lib/types/story';

const TEST_EMAIL_PREFIX = 'character-novelty-smoke-';
const STEP_TIMEOUT_MS = 15_000;

async function smokeStep<T>(label: string, operation: PromiseLike<T>): Promise<T> {
  console.info(`[character-novelty smoke] ${label}`);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Supabase smoke step timed out: ${label}`)),
          STEP_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function requiredEnvironment(): {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
} {
  const fileEnvironment = loadEnv('development', process.cwd(), '');
  const read = (key: string) => process.env[key] || fileEnvironment[key] || '';
  const supabaseUrl = read('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = read('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceRoleKey = read('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new Error(
      'Character novelty smoke test requires NEXT_PUBLIC_SUPABASE_URL, '
      + 'NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.'
    );
  }
  return { supabaseUrl, anonKey, serviceRoleKey };
}

function testBeat(character: Character): StoryBeat {
  return {
    title: 'Smoke test beat',
    beatNumber: 1,
    isEnding: false,
    storyText: 'A test character arrives.',
    storyTextParts: ['A', 'test', 'character', 'arrives.'],
    sceneSummary: 'A test encounter.',
    options: [],
    characters: [character],
    continuityNotes: [],
    imagePrompt: 'wide shot of a test scene',
    clues: [],
    nextBeatGoal: 'Complete the smoke test.',
    endingForecast: ['verification'],
    newCharacterIds: [character.id],
    changedCharacterIds: [],
  };
}

describe('character novelty Supabase smoke test', () => {
  it('persists history through RLS and feeds it into the real novelty validator', async () => {
    const { supabaseUrl, anonKey, serviceRoleKey } = requiredEnvironment();
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const owner = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const anonymous = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const removeStaleSmokeUsers = async (): Promise<void> => {
      const { data, error } = await smokeStep(
        'checking for stale smoke-test users',
        admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      );
      if (error) throw new Error(`Could not list smoke-test users: ${error.message}`);

      for (const user of data.users) {
        if (!user.email?.startsWith(TEST_EMAIL_PREFIX)) continue;
        const { error: deleteError } = await smokeStep(
          `removing stale smoke-test user ${user.id}`,
          admin.auth.admin.deleteUser(user.id)
        );
        if (deleteError) {
          throw new Error(`Could not remove stale smoke-test user: ${deleteError.message}`);
        }
      }
    };

    const marker = randomUUID();
    const email = `${TEST_EMAIL_PREFIX}${marker}@example.invalid`;
    const password = `Smoke-${randomUUID()}-Aa1!`;
    const characterId = `smoke-character-${marker}`;
    let testUserId: string | null = null;

    try {
      await removeStaleSmokeUsers();
      const { data: createdUser, error: createUserError } = await smokeStep(
        'creating temporary auth user',
        admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { testPurpose: 'character_novelty_smoke' },
        })
      );
      expect(createUserError).toBeNull();
      expect(createdUser.user).not.toBeNull();
      testUserId = createdUser.user?.id || null;
      if (!testUserId) throw new Error('Smoke test user was not created.');

      const { error: signInError } = await smokeStep(
        'signing in temporary user',
        owner.auth.signInWithPassword({ email, password })
      );
      expect(signInError).toBeNull();

      const { data: story, error: storyError } = await smokeStep(
        'creating temporary story through owner RLS',
        owner
          .from('stories')
          .insert({
            user_id: testUserId,
            title: 'Character novelty smoke test',
            user_prompt: 'Temporary automated smoke test',
            story_map: { nodes: {}, rootNodeId: null, currentNodeId: null },
            characters: [],
            status: 'active',
          })
          .select('id')
          .single()
      );
      expect(storyError).toBeNull();
      expect(story?.id).toBeTruthy();
      if (!story?.id) throw new Error('Smoke test story was not created.');

      const appearance = 'small golden-brown monkey with a curled tail, red waistcoat, bright eyes, and quick gestures';
      const usageRow = {
        user_id: testUserId,
        story_id: story.id,
        character_id: characterId,
        display_name: 'Milo',
        normalized_name: normalizeCharacterName('Milo'),
        appearance_signature: appearance,
        name_source: 'ai_generated',
        language: 'english',
        setting_country: 'generic',
      };

      const { error: insertUsageError } = await smokeStep(
        'inserting novelty usage through owner RLS',
        owner.from('character_novelty_usage').insert(usageRow)
      );
      expect(insertUsageError).toBeNull();

      const { data: ownerRows, error: ownerReadError } = await smokeStep(
        'reading novelty usage through owner RLS',
        owner
          .from('character_novelty_usage')
          .select('display_name, normalized_name, appearance_signature')
          .eq('character_id', characterId)
      );
      expect(ownerReadError).toBeNull();
      expect(ownerRows).toHaveLength(1);

      const { data: anonymousRows, error: anonymousReadError } = await smokeStep(
        'checking anonymous RLS isolation',
        anonymous.from('character_novelty_usage').select('id').eq('character_id', characterId)
      );
      expect(anonymousReadError).toBeNull();
      expect(anonymousRows).toEqual([]);

      const context: CharacterNoveltyContext = {
        recentCharacters: ownerRows!.map((row) => ({
          displayName: row.display_name,
          normalizedName: row.normalized_name,
          appearanceSignature: row.appearance_signature || undefined,
        })),
      };
      const instructions = buildCharacterNoveltyInstructions(context, []);
      expect(instructions).toContain('Milo');

      const generatedCharacter: Character = {
        id: 'generated-miko',
        name: 'Miko',
        type: 'monkey',
        appearanceSummary: 'towering stone automaton with mossy shoulders and a glowing geometric face',
        personalitySummary: 'curious and quick-thinking',
      };
      const issues = validateCharacterNovelty(
        testBeat(generatedCharacter),
        { currentBeat: 0, beats: [], characters: [] },
        'Tell a mountain adventure',
        context
      );
      expect(issues.some((issue) => issue.includes('recently used name "Milo"'))).toBe(true);

      const { error: upsertError } = await smokeStep(
        'checking idempotent novelty upsert',
        owner
          .from('character_novelty_usage')
          .upsert(
            { ...usageRow, last_used_at: new Date().toISOString() },
            { onConflict: 'user_id,story_id,character_id' }
          )
      );
      expect(upsertError).toBeNull();

      const { count, error: countError } = await smokeStep(
        'confirming one usage row remains',
        owner
          .from('character_novelty_usage')
          .select('id', { count: 'exact', head: true })
          .eq('character_id', characterId)
      );
      expect(countError).toBeNull();
      expect(count).toBe(1);
    } finally {
      await owner.auth.signOut().catch(() => undefined);
      if (testUserId) {
        const { error: cleanupError } = await smokeStep(
          `removing temporary smoke-test user ${testUserId}`,
          admin.auth.admin.deleteUser(testUserId)
        );
        if (cleanupError) {
          throw new Error(`Failed to remove character novelty smoke-test user: ${cleanupError.message}`);
        }
      }
    }
  });
});
