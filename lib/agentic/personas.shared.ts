import type { AgeGroup, StoryConfig, StoryLanguage } from '@/lib/types/story';
import { DEFAULT_STORY_CONFIG, normalizeStoryConfig } from '@/lib/ai/story-config';

// ── Agentic Creator System: persona library, pure half ──────────────────
//
// No `server-only`, no `'use client'` — this module is imported by both
// app/actions/agentic-personas.ts (server) and its colocated test file, per
// the repo's `*.shared.ts` convention. Everything here is deterministic and
// touches no database, network, or DOM API.
//
// The single load-bearing rule (decision D5 in
// docs/agentic-creator-decisions.md): a persona with allowImageGeneration ===
// false must NEVER be able to resolve to imageGenerationMode: 'generate'. That
// is enforced structurally in resolvePersonaStoryConfig below, as the last
// step, unconditionally — not as a policy check callers could forget to add
// at a new call site.

export type AgentPersonaStatus = 'draft' | 'testing' | 'active' | 'paused' | 'archived';

/**
 * Mirrors public.agent_personas (migration 103), camelCased. Persisted
 * columns only -- request/response shaping for the admin UI lives elsewhere.
 */
export interface AgentPersona {
  id: string;
  slug: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  language: StoryLanguage;
  ageGroup: AgeGroup;
  genres: string[];
  speciality: string | null;
  personaPrompt: string;
  creativeNotes: string | null;
  restrictedThemes: string[];
  /** Partial StoryConfig the persona's stories start from before overrides are applied. */
  defaultStoryConfig: Partial<StoryConfig>;
  /** StoryConfig top-level keys a caller is allowed to override for this persona. */
  dynamicSettingKeys: string[];
  beatCountMin: number;
  beatCountMax: number;
  preferredVoice: string | null;
  approvedVoicePool: string[];
  allowImageGeneration: boolean;
  allowNarration: boolean;
  modelOverrides: Record<string, unknown>;
  status: AgentPersonaStatus;
  scheduleEligible: boolean;
  isSeed: boolean;
  clonedFrom: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields needed to create (or clone into) a persona -- everything but server-generated columns. */
export type AgentPersonaInput = Omit<AgentPersona, 'id' | 'createdAt' | 'updatedAt'>;

/** Mirrors public.agent_persona_memory (migration 103), camelCased. */
export interface AgentPersonaMemory {
  personaId: string;
  recentTitles: string[];
  recentPremises: string[];
  characterNames: string[];
  settingsUsed: string[];
  themesUsed: string[];
  /** Shape settles in the review-queue phase (Phase 9); treated as opaque data until then. */
  reviewerFeedback: unknown[];
  storyCount: number;
  updatedAt: string;
}

/**
 * Runtime mirror of StoryConfig's top-level keys (lib/types/story.ts). The
 * `satisfies` clause below fails to compile if an entry stops being a real
 * StoryConfig key, but a genuinely new StoryConfig field still needs adding
 * here by hand before a persona can be granted permission to override it.
 * Exported so the admin editor can offer exactly this universe as the
 * checklist for a persona's dynamicSettingKeys.
 */
export const STORY_CONFIG_KEYS = [
  'storyKind',
  'ageGroup',
  'genre',
  'beatLength',
  'settingCountry',
  'maxBeats',
  'language',
  'imageGenerationMode',
  'imageDeliveryMode',
  'episodicCharacters',
  'imageModelSelection',
  'imageContinuityStrategy',
  'isVerticalStory',
  'aspectRatio',
  'visualSettings',
  'authoring',
  'reel',
  'storyTextOverlay',
  'storyTransition',
  'portraitReferences',
  'narrationVoice',
  'references',
] as const satisfies readonly (keyof StoryConfig)[];

const STORY_CONFIG_KEY_SET: ReadonlySet<string> = new Set(STORY_CONFIG_KEYS);

/** `persona.dynamicSettingKeys` filtered to keys that actually exist on StoryConfig. */
export function resolveAllowedSettingKeys(persona: Pick<AgentPersona, 'dynamicSettingKeys'>): string[] {
  return persona.dynamicSettingKeys.filter((key) => STORY_CONFIG_KEY_SET.has(key));
}

export interface AppliedPersonaOverrides {
  applied: Partial<StoryConfig>;
  rejected: string[];
}

/**
 * Splits a requested set of StoryConfig overrides into what this persona is
 * actually allowed to change (per resolveAllowedSettingKeys) and what got
 * dropped, so a caller can log the refusal instead of silently ignoring it.
 */
export function applyPersonaOverrides(
  persona: Pick<AgentPersona, 'dynamicSettingKeys'>,
  requested: Record<string, unknown>
): AppliedPersonaOverrides {
  const allowed = new Set(resolveAllowedSettingKeys(persona));
  const applied: Record<string, unknown> = {};
  const rejected: string[] = [];

  for (const [key, value] of Object.entries(requested)) {
    if (allowed.has(key)) {
      applied[key] = value;
    } else {
      rejected.push(key);
    }
  }

  return { applied: applied as Partial<StoryConfig>, rejected };
}

/**
 * Builds a real, normalized StoryConfig for this persona: persona.language
 * and persona.ageGroup are authoritative (they are the persona's identity,
 * not a per-story knob); persona.defaultStoryConfig fills in the rest;
 * `overrides` are filtered through applyPersonaOverrides before being
 * layered on top.
 *
 * CRITICAL (decision D5): when allowImageGeneration is false, the returned
 * config always has imageGenerationMode: 'prompt_only', regardless of what
 * defaultStoryConfig or overrides request. This check runs last and
 * unconditionally, so there is no path through this function that can hand
 * back 'generate' for an image-off persona.
 */
export function resolvePersonaStoryConfig(
  persona: AgentPersona,
  overrides?: Partial<StoryConfig> | Record<string, unknown>
): StoryConfig {
  const { applied } = overrides ? applyPersonaOverrides(persona, overrides) : { applied: {} };

  const merged = normalizeStoryConfig({
    ...DEFAULT_STORY_CONFIG,
    ...persona.defaultStoryConfig,
    ...applied,
    language: persona.language,
    ageGroup: persona.ageGroup,
  } as Partial<StoryConfig>);

  if (!persona.allowImageGeneration) {
    return { ...merged, imageGenerationMode: 'prompt_only' };
  }

  return merged;
}

/** Clamps a requested beat count into [beatCountMin, beatCountMax]. Non-finite input falls back to the minimum. */
/**
 * Clamp a requested beat count into the persona's configured range.
 *
 * Bounds come from admin-editable persona rows, so they can be nonsense: zero,
 * negative, or a minimum above the maximum. The low bound is floored at 1 and an
 * inverted range collapses to its low bound, so a misconfigured row can change how
 * long a persona's stories are but can never ask the pipeline for zero beats --
 * which would otherwise reach story assembly as an empty beat list.
 */
export function clampBeatCount(persona: Pick<AgentPersona, 'beatCountMin' | 'beatCountMax'>, requested: number): number {
  const min = Math.max(1, Math.floor(persona.beatCountMin) || 1);
  const max = Math.max(min, Math.floor(persona.beatCountMax) || min);
  if (!Number.isFinite(requested)) return min;
  return Math.min(max, Math.max(min, Math.round(requested)));
}

/**
 * Builds the insert payload for cloning a persona under a new slug/name.
 * Deliberately does not carry forward isSeed, status, or scheduleEligible --
 * a clone is always a fresh, unproven draft, never a seed and never
 * schedulable until an operator says otherwise.
 */
export function buildClonedPersonaInput(
  persona: AgentPersona,
  newSlug: string,
  newName: string
): AgentPersonaInput {
  return {
    slug: newSlug,
    displayName: newName,
    bio: persona.bio,
    avatarUrl: persona.avatarUrl,
    language: persona.language,
    ageGroup: persona.ageGroup,
    genres: [...persona.genres],
    speciality: persona.speciality,
    personaPrompt: persona.personaPrompt,
    creativeNotes: persona.creativeNotes,
    restrictedThemes: [...persona.restrictedThemes],
    defaultStoryConfig: { ...persona.defaultStoryConfig },
    dynamicSettingKeys: [...persona.dynamicSettingKeys],
    beatCountMin: persona.beatCountMin,
    beatCountMax: persona.beatCountMax,
    preferredVoice: persona.preferredVoice,
    approvedVoicePool: [...persona.approvedVoicePool],
    allowImageGeneration: persona.allowImageGeneration,
    allowNarration: persona.allowNarration,
    modelOverrides: { ...persona.modelOverrides },
    status: 'draft',
    scheduleEligible: false,
    isSeed: false,
    clonedFrom: persona.id,
  };
}

/**
 * True when a Postgres/PostgREST error means "migration 103 hasn't run on
 * this database yet" (undefined table or undefined column), as opposed to any
 * other failure that should still surface as a real error. Mirrors
 * lib/legal/consent.shared.ts's isMissingLegalSchemaError for the same class
 * of problem against a different migration group -- per GOTCHAS.md, latches
 * (and their error classifiers) are kept one-per-migration-group on purpose.
 */
/**
 * Raw shape of a public.agent_personas row (migration 103), snake_case, as
 * returned by Supabase. Shared so both the admin CRUD action module
 * (app/actions/agentic-personas.ts) and the headless story-assembly pipeline
 * (lib/agentic/story-assembly.ts, which cannot go through the admin module --
 * it has no admin session to verify) map a row the same way. Two mappers for
 * the same table drift; see mapRowToPersona below.
 */
export interface PersonaRow {
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

/** Maps a raw agent_personas row to the camelCased AgentPersona shape. The one mapper for this table -- see PersonaRow's comment. */
export function mapRowToPersona(row: PersonaRow): AgentPersona {
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

export function isMissingPersonaSchemaError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;

  // Codes only, deliberately. A bare table-name match on the message would also
  // catch a unique-slug violation (23505: 'duplicate key value violates unique
  // constraint "agent_personas_slug_key"'), which would report a real, fixable
  // admin mistake as "migration 103 has not been applied" -- the most confusing
  // possible diagnosis. agent_personas is admin-written and carries a UNIQUE
  // constraint, so that path is reachable in normal use, unlike the read-only
  // registries in lib/ai/image-models.ts that do match on message text.
  return (
    error.code === '42P01' ||    // undefined_table: agent_personas / agent_persona_memory absent
    error.code === '42703' ||    // undefined_column: stories.agent_persona_id absent
    error.code === 'PGRST200' || // PostgREST: relationship not found in schema cache
    error.code === 'PGRST204'    // PostgREST: column not found in schema cache
  );
}
