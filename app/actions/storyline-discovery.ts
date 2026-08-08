'use server';

import { GoogleGenAI } from '@google/genai';
import { createAdminClient } from '@/lib/supabase/admin';
import { getModelConfig } from '@/lib/ai/model-config';
import { getPublishedPrompt } from '@/lib/ai/prompt-config';
import { LOCKED_PROMPT_GUARDRAILS, resolvePromptTemplate } from '@/lib/ai/prompt-config.shared';
import { storylineDiscoveryMetadataSchema } from '@/lib/ai/generation-schemas';
import { normalizeDiscoveryIntro } from '@/lib/story/discovery-intro';
import { normalizeStoryConfig } from '@/lib/ai/story-config';
import type { AgeGroup } from '@/lib/types/story';

const AGE_GROUPS: AgeGroup[] = ['all_ages', 'kids_3_5', 'kids_5_8', 'kids_8_12', 'teens', 'adults'];
const GENRES = ['adventure', 'mystery', 'fantasy', 'comedy', 'drama', 'horror', 'romance', 'sci-fi'];

const MAX_BEATS_IN_PROMPT = 8;
const MAX_BEAT_CHARS = 160;
const MAX_CHARACTERS_IN_PROMPT = 5;
const BACKFILL_MAX_LIMIT = 200;

export interface StorylineDiscoveryMetadata {
  intro: string;
  /** Only set when the model returned a value inside the supported enum. */
  genre: string | null;
  ageFit: AgeGroup | null;
}

type PublishedBeat = {
  title?: unknown;
  storyText?: unknown;
  sceneSummary?: unknown;
  characters?: unknown;
};

function compact(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') return '';
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars)}…` : cleaned;
}

function buildBeatSummaries(beats: unknown): string {
  if (!Array.isArray(beats)) return '';
  return (beats as PublishedBeat[])
    .slice(0, MAX_BEATS_IN_PROMPT)
    .map((beat, index) => {
      const line = compact(beat?.sceneSummary || beat?.storyText || beat?.title, MAX_BEAT_CHARS);
      return line ? `${index + 1}. ${line}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

function buildCharacterLine(beats: unknown): string {
  if (!Array.isArray(beats)) return '';

  const names = new Set<string>();
  for (const beat of beats as PublishedBeat[]) {
    if (!Array.isArray(beat?.characters)) continue;
    for (const character of beat.characters as { name?: unknown }[]) {
      const name = compact(character?.name, 40);
      if (name) names.add(name);
      if (names.size >= MAX_CHARACTERS_IN_PROMPT) break;
    }
    if (names.size >= MAX_CHARACTERS_IN_PROMPT) break;
  }

  return Array.from(names).join(', ');
}

/**
 * Write the catalogue intro for one published storyline. Returns null on any
 * failure — the caller records that as `failed` and the gallery falls back to
 * a deterministic beat-1 excerpt, so publishing never depends on this.
 */
export async function generateStorylineDiscoveryMetadata(input: {
  storyId: string;
  title: string;
  beats: unknown;
}): Promise<StorylineDiscoveryMetadata | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const beatSummaries = buildBeatSummaries(input.beats);
  if (!beatSummaries) return null;

  try {
    const admin = createAdminClient();
    const { data: story } = await admin
      .from('stories')
      .select('title, genre, target_age, story_config, setting')
      .eq('id', input.storyId)
      .maybeSingle();

    const storyRow = story as {
      title?: string | null;
      genre?: string | null;
      target_age?: string | null;
      story_config?: Record<string, unknown> | null;
      setting?: { world?: string } | null;
    } | null;

    const storyConfig = normalizeStoryConfig(storyRow?.story_config);

    const [promptBody, { model, temperature }] = await Promise.all([
      getPublishedPrompt('storyline_discovery_metadata'),
      getModelConfig('storyline_discovery_metadata'),
    ]);

    const prompt = resolvePromptTemplate(promptBody, {
      title: input.title || storyRow?.title || 'Untitled Story',
      genre: storyRow?.genre || 'unspecified',
      targetAge: storyRow?.target_age || storyConfig.ageGroup,
      language: storyConfig.language,
      setting: storyRow?.setting?.world || storyConfig.settingCountry || '',
      characters: buildCharacterLine(input.beats),
      beatSummaries,
    });

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: LOCKED_PROMPT_GUARDRAILS.storyline_discovery_metadata,
        responseMimeType: 'application/json',
        responseSchema: storylineDiscoveryMetadataSchema,
        temperature: temperature ?? 0.4,
      },
    });

    if (!response.text) return null;

    const parsed = JSON.parse(response.text) as {
      intro?: unknown;
      genre?: unknown;
      ageFit?: unknown;
    };

    const intro = normalizeDiscoveryIntro(parsed.intro);
    if (!intro) return null;

    const genre = typeof parsed.genre === 'string' ? parsed.genre.trim().toLowerCase() : '';
    const ageFit = typeof parsed.ageFit === 'string' ? parsed.ageFit.trim() : '';

    return {
      intro,
      genre: GENRES.includes(genre) ? genre : null,
      ageFit: AGE_GROUPS.includes(ageFit as AgeGroup) ? (ageFit as AgeGroup) : null,
    };
  } catch (error) {
    console.error('Storyline discovery metadata generation failed:', error);
    return null;
  }
}

/**
 * Persist the generated intro. Never throws: a missing column (migration 088
 * not yet applied) or a failed update must not break publishing.
 */
export async function applyStorylineDiscoveryMetadata(
  storylineId: string,
  result: StorylineDiscoveryMetadata | null
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from('storylines')
      .update({
        discovery_intro: result?.intro ?? null,
        discovery_intro_status: result ? 'ready' : 'failed',
      })
      .eq('id', storylineId);

    if (error) {
      console.warn('Skipped storyline discovery metadata update:', error.message);
    }
  } catch (error) {
    console.warn('Skipped storyline discovery metadata update:', error);
  }
}

/**
 * Generate and store the intro for one storyline. Safe to call from any
 * publish path; swallows every failure.
 */
export async function refreshStorylineDiscoveryMetadata(input: {
  storylineId: string;
  storyId: string;
  title: string;
  beats: unknown;
}): Promise<void> {
  try {
    const result = await generateStorylineDiscoveryMetadata({
      storyId: input.storyId,
      title: input.title,
      beats: input.beats,
    });
    await applyStorylineDiscoveryMetadata(input.storylineId, result);
  } catch (error) {
    console.error('Failed to refresh storyline discovery metadata:', error);
  }
}

/**
 * Bounded, idempotent backfill for storylines published before the generator
 * existed. Only touches rows that were never attempted, so re-running it never
 * re-bills rows that already succeeded or permanently failed.
 */
export async function repairStorylineDiscoveryMetadata(
  options: { limit?: number } = {}
): Promise<{ scanned: number; ready: number; failed: number }> {
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 50), 1), BACKFILL_MAX_LIMIT);
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('storylines')
    .select('id, story_id, title, beats')
    .eq('is_public', true)
    .is('discovery_intro_status', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list storylines for discovery backfill: ${error.message}`);
  }

  const rows = (data || []) as { id: string; story_id: string | null; title: string; beats: unknown }[];
  let ready = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.story_id) {
      failed += 1;
      await applyStorylineDiscoveryMetadata(row.id, null);
      continue;
    }

    const result = await generateStorylineDiscoveryMetadata({
      storyId: row.story_id,
      title: row.title,
      beats: row.beats,
    });

    await applyStorylineDiscoveryMetadata(row.id, result);
    if (result) {
      ready += 1;
    } else {
      failed += 1;
    }
  }

  return { scanned: rows.length, ready, failed };
}
