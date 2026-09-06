'use server';

// Agentic Creator System: persona CRUD. Every export starts with
// verifyAdmin(). Reads (listPersonas/getPersona/getPersonaMemory) are allowed
// even while the master flag is off -- an admin browsing the (empty) catalog
// is harmless -- but every write (createPersona/updatePersona/clonePersona/
// setPersonaStatus) additionally requires agentic_creator_enabled, so a
// persona can never be created or changed while the feature is switched off.
//
// Migration 103 will not be applied when this code first ships (see
// docs/agentic-creator-working-memory.md). Every query here fails closed on a
// missing-relation error: reads return [] / null, writes throw a clear "not
// applied yet" message instead of a raw Postgres error. This mirrors
// lib/legal/consent.ts's latch for migrations 099/100 (GOTCHAS.md: latches
// are kept one per migration group, never reused across groups).
//
// Types (AgentPersona, AgentPersonaInput, AgentPersonaMemory,
// AgentPersonaStatus) live in lib/agentic/personas.shared.ts, not here -- a
// 'use server' file may only export async functions at runtime (type-only
// exports are erased by the compiler and are fine).

import { verifyAdmin, createAdminClient } from '@/lib/supabase/admin';
import { getAgenticFlags } from '@/lib/agentic/flags';
import { buildSearchOrFilter } from '@/lib/gallery/search-query';
import {
  buildClonedPersonaInput,
  isMissingPersonaSchemaError,
  type AgentPersona,
  type AgentPersonaInput,
  type AgentPersonaMemory,
  type AgentPersonaStatus,
} from '@/lib/agentic/personas.shared';
import type { StoryConfig } from '@/lib/types/story';

export type { AgentPersona, AgentPersonaInput, AgentPersonaMemory, AgentPersonaStatus } from '@/lib/agentic/personas.shared';

export interface PersonaListFilters {
  status?: AgentPersonaStatus;
  language?: string;
  ageGroup?: string;
  genre?: string;
  search?: string;
}

/**
 * Dedicated latch for migration 103 only. Per GOTCHAS.md, reusing another
 * migration group's latch (e.g. legal's 099/100 one) would fail an unrelated
 * surface closed for the wrong reason.
 */
let personasSchemaUnavailable = false;

function latchPersonasSchemaUnavailable(context: string): void {
  if (personasSchemaUnavailable) return;
  personasSchemaUnavailable = true;
  console.warn(
    `Agent persona schema unavailable (migration 103 not applied); ${context} stays inert until it's applied.`
  );
}

const SCHEMA_UNAVAILABLE_MESSAGE =
  'Persona storage is not available yet — migration 103 has not been applied to this environment.';

async function requireCreatorEnabled(): Promise<void> {
  const flags = await getAgenticFlags();
  if (!flags.creatorEnabled) {
    throw new Error(
      'The Agentic Creator System is currently disabled. Turn on the master switch on the Agents Overview page before editing personas.'
    );
  }
}

interface PersonaRow {
  id: string;
  slug: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  language: string;
  age_group: string;
  genres: string[] | null;
  speciality: string | null;
  persona_prompt: string;
  creative_notes: string | null;
  restricted_themes: string[] | null;
  default_story_config: Record<string, unknown> | null;
  dynamic_setting_keys: string[] | null;
  beat_count_min: number;
  beat_count_max: number;
  preferred_voice: string | null;
  approved_voice_pool: string[] | null;
  allow_image_generation: boolean;
  allow_narration: boolean;
  model_overrides: Record<string, unknown> | null;
  status: AgentPersonaStatus;
  schedule_eligible: boolean;
  is_seed: boolean;
  cloned_from: string | null;
  created_at: string;
  updated_at: string;
}

interface PersonaMemoryRow {
  persona_id: string;
  recent_titles: string[] | null;
  recent_premises: string[] | null;
  character_names: string[] | null;
  settings_used: string[] | null;
  themes_used: string[] | null;
  reviewer_feedback: unknown[] | null;
  story_count: number;
  updated_at: string;
}

function mapRowToPersona(row: PersonaRow): AgentPersona {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    language: row.language as AgentPersona['language'],
    ageGroup: row.age_group as AgentPersona['ageGroup'],
    genres: row.genres ?? [],
    speciality: row.speciality,
    personaPrompt: row.persona_prompt,
    creativeNotes: row.creative_notes,
    restrictedThemes: row.restricted_themes ?? [],
    defaultStoryConfig: (row.default_story_config ?? {}) as Partial<StoryConfig>,
    dynamicSettingKeys: row.dynamic_setting_keys ?? [],
    beatCountMin: row.beat_count_min,
    beatCountMax: row.beat_count_max,
    preferredVoice: row.preferred_voice,
    approvedVoicePool: row.approved_voice_pool ?? [],
    allowImageGeneration: row.allow_image_generation,
    allowNarration: row.allow_narration,
    modelOverrides: (row.model_overrides ?? {}) as Record<string, unknown>,
    status: row.status,
    scheduleEligible: row.schedule_eligible,
    isSeed: row.is_seed,
    clonedFrom: row.cloned_from,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMemoryRow(row: PersonaMemoryRow): AgentPersonaMemory {
  return {
    personaId: row.persona_id,
    recentTitles: row.recent_titles ?? [],
    recentPremises: row.recent_premises ?? [],
    characterNames: row.character_names ?? [],
    settingsUsed: row.settings_used ?? [],
    themesUsed: row.themes_used ?? [],
    reviewerFeedback: row.reviewer_feedback ?? [],
    storyCount: row.story_count,
    updatedAt: row.updated_at,
  };
}

/** Maps only the keys present on `input` to their DB column names -- used for both insert and partial update. */
function mapInputToRow(input: Partial<AgentPersonaInput>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (input.slug !== undefined) row.slug = input.slug;
  if (input.displayName !== undefined) row.display_name = input.displayName;
  if (input.bio !== undefined) row.bio = input.bio;
  if (input.avatarUrl !== undefined) row.avatar_url = input.avatarUrl;
  if (input.language !== undefined) row.language = input.language;
  if (input.ageGroup !== undefined) row.age_group = input.ageGroup;
  if (input.genres !== undefined) row.genres = input.genres;
  if (input.speciality !== undefined) row.speciality = input.speciality;
  if (input.personaPrompt !== undefined) row.persona_prompt = input.personaPrompt;
  if (input.creativeNotes !== undefined) row.creative_notes = input.creativeNotes;
  if (input.restrictedThemes !== undefined) row.restricted_themes = input.restrictedThemes;
  if (input.defaultStoryConfig !== undefined) row.default_story_config = input.defaultStoryConfig;
  if (input.dynamicSettingKeys !== undefined) row.dynamic_setting_keys = input.dynamicSettingKeys;
  if (input.beatCountMin !== undefined) row.beat_count_min = input.beatCountMin;
  if (input.beatCountMax !== undefined) row.beat_count_max = input.beatCountMax;
  if (input.preferredVoice !== undefined) row.preferred_voice = input.preferredVoice;
  if (input.approvedVoicePool !== undefined) row.approved_voice_pool = input.approvedVoicePool;
  if (input.allowImageGeneration !== undefined) row.allow_image_generation = input.allowImageGeneration;
  if (input.allowNarration !== undefined) row.allow_narration = input.allowNarration;
  if (input.modelOverrides !== undefined) row.model_overrides = input.modelOverrides;
  if (input.status !== undefined) row.status = input.status;
  if (input.scheduleEligible !== undefined) row.schedule_eligible = input.scheduleEligible;
  if (input.isSeed !== undefined) row.is_seed = input.isSeed;
  if (input.clonedFrom !== undefined) row.cloned_from = input.clonedFrom;
  return row;
}

async function insertPersonaRow(input: AgentPersonaInput): Promise<AgentPersona> {
  if (personasSchemaUnavailable) throw new Error(SCHEMA_UNAVAILABLE_MESSAGE);

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('agent_personas')
    .insert(mapInputToRow(input))
    .select('*')
    .single();

  if (error) {
    if (isMissingPersonaSchemaError(error)) {
      latchPersonasSchemaUnavailable('persona create');
      throw new Error(SCHEMA_UNAVAILABLE_MESSAGE);
    }
    throw new Error(`Failed to create persona: ${error.message}`);
  }

  return mapRowToPersona(data as PersonaRow);
}

/**
 * Distinguishes the two honest empty states the catalogue UI must show:
 * migration 103 not applied yet (schemaApplied: false) vs. applied but no
 * personas seeded yet (schemaApplied: true, listPersonas() returns []).
 * Phase 2b seeds 15 personas once the taxonomy mapping is sight-checked.
 */
export async function getPersonaCatalogueStatus(): Promise<{ schemaApplied: boolean }> {
  await verifyAdmin();
  if (personasSchemaUnavailable) return { schemaApplied: false };

  const supabase = createAdminClient();
  const { error } = await supabase.from('agent_personas').select('id').limit(1);

  if (error) {
    if (isMissingPersonaSchemaError(error)) {
      latchPersonasSchemaUnavailable('schema status check');
      return { schemaApplied: false };
    }
    throw new Error(`Failed to check persona schema status: ${error.message}`);
  }

  return { schemaApplied: true };
}

export async function listPersonas(filters?: PersonaListFilters): Promise<AgentPersona[]> {
  await verifyAdmin();
  if (personasSchemaUnavailable) return [];

  const supabase = createAdminClient();
  let query = supabase.from('agent_personas').select('*').order('created_at', { ascending: false });

  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.language) query = query.eq('language', filters.language);
  if (filters?.ageGroup) query = query.eq('age_group', filters.ageGroup);
  if (filters?.genre) query = query.contains('genres', [filters.genre]);
  if (filters?.search) {
    const orFilter = buildSearchOrFilter(filters.search, ['display_name', 'slug']);
    if (orFilter) query = query.or(orFilter);
  }

  const { data, error } = await query;

  if (error) {
    if (isMissingPersonaSchemaError(error)) {
      latchPersonasSchemaUnavailable('persona list');
      return [];
    }
    throw new Error(`Failed to load personas: ${error.message}`);
  }

  return (data ?? []).map((row) => mapRowToPersona(row as PersonaRow));
}

export async function getPersona(id: string): Promise<AgentPersona | null> {
  await verifyAdmin();
  if (personasSchemaUnavailable) return null;

  const supabase = createAdminClient();
  const { data, error } = await supabase.from('agent_personas').select('*').eq('id', id).maybeSingle();

  if (error) {
    if (isMissingPersonaSchemaError(error)) {
      latchPersonasSchemaUnavailable('persona lookup');
      return null;
    }
    throw new Error(`Failed to load persona: ${error.message}`);
  }

  return data ? mapRowToPersona(data as PersonaRow) : null;
}

export async function getPersonaMemory(id: string): Promise<AgentPersonaMemory | null> {
  await verifyAdmin();
  if (personasSchemaUnavailable) return null;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('agent_persona_memory')
    .select('*')
    .eq('persona_id', id)
    .maybeSingle();

  if (error) {
    if (isMissingPersonaSchemaError(error)) {
      latchPersonasSchemaUnavailable('persona memory lookup');
      return null;
    }
    throw new Error(`Failed to load persona memory: ${error.message}`);
  }

  return data ? mapMemoryRow(data as PersonaMemoryRow) : null;
}

export async function createPersona(input: AgentPersonaInput): Promise<AgentPersona> {
  await verifyAdmin();
  await requireCreatorEnabled();
  return insertPersonaRow(input);
}

export async function updatePersona(id: string, patch: Partial<AgentPersonaInput>): Promise<AgentPersona> {
  await verifyAdmin();
  await requireCreatorEnabled();
  if (personasSchemaUnavailable) throw new Error(SCHEMA_UNAVAILABLE_MESSAGE);

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('agent_personas')
    .update({ ...mapInputToRow(patch), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    if (isMissingPersonaSchemaError(error)) {
      latchPersonasSchemaUnavailable('persona update');
      throw new Error(SCHEMA_UNAVAILABLE_MESSAGE);
    }
    throw new Error(`Failed to update persona: ${error.message}`);
  }

  return mapRowToPersona(data as PersonaRow);
}

export async function clonePersona(id: string, newSlug: string, newName: string): Promise<AgentPersona> {
  await verifyAdmin();
  await requireCreatorEnabled();
  if (personasSchemaUnavailable) throw new Error(SCHEMA_UNAVAILABLE_MESSAGE);

  const supabase = createAdminClient();
  const { data, error } = await supabase.from('agent_personas').select('*').eq('id', id).maybeSingle();

  if (error) {
    if (isMissingPersonaSchemaError(error)) {
      latchPersonasSchemaUnavailable('persona clone lookup');
      throw new Error(SCHEMA_UNAVAILABLE_MESSAGE);
    }
    throw new Error(`Failed to load persona to clone: ${error.message}`);
  }
  if (!data) throw new Error('Persona not found.');

  const source = mapRowToPersona(data as PersonaRow);
  const cloneInput = buildClonedPersonaInput(source, newSlug, newName);
  return insertPersonaRow(cloneInput);
}

export async function setPersonaStatus(id: string, status: AgentPersonaStatus): Promise<AgentPersona> {
  return updatePersona(id, { status });
}
