import type { StoryLanguage } from '@/lib/types/story';

/**
 * Narrator accent support.
 *
 * Gemini 2.5 TTS has no structured accent parameter and no accent-specific
 * voice personas — the prebuilt voices are accent-flexible and steered purely by
 * natural-language instruction in the prompt text. So an "accent" here is really
 * a prompt fragment we inject into the TTS prompt via the {{accent}} variable.
 *
 * Accents are admin-configurable (list + per-plan gating) via feature flags, with
 * the constants below as the built-in defaults. This module is pure/shared (no
 * server-only imports) so both the client config and the server pipeline can use it.
 */

/** Grouping for the admin accent catalog ("bucket"). */
export type NarrationAccentCategory = 'international' | 'national';

export interface NarrationAccentOption {
  /** Stable identifier persisted on the story (story_config.narrationVoice.accent). */
  id: string;
  /** Human label shown in the picker. */
  label: string;
  /** Natural-language instruction injected into the TTS prompt's {{accent}} slot. */
  instruction: string;
  /** Catalog grouping. Optional on stored options; always set on catalog entries. */
  category?: NarrationAccentCategory;
}

/** planKey -> allowed accent ids. Plans not listed fall back to the default accent only. */
export type NarrationAccentTierMap = Record<string, string[]>;

export const DEFAULT_NARRATION_ACCENT_ID = 'us';

export const ACCENT_CATEGORY_ORDER: NarrationAccentCategory[] = ['international', 'national'];

export const ACCENT_CATEGORY_LABELS: Record<NarrationAccentCategory, string> = {
  international: 'International English',
  national: 'National / Regional (India)',
};

function accentInstruction(variety: string): string {
  return `Speak the entire narration in a natural ${variety} accent. Do not use any other regional accent.`;
}

/**
 * The master accent catalog ("bucket") admins choose from. Grouped into international
 * English varieties and India-focused national/regional ones. Gemini TTS steers accent
 * only via this prompt instruction, so fidelity is best-effort — admins can edit labels
 * and enable/disable per plan.
 */
export const NARRATION_ACCENT_CATALOG: NarrationAccentOption[] = [
  // International English
  { id: 'us', label: 'American (US)', category: 'international', instruction: accentInstruction('American English (General American)') },
  { id: 'uk', label: 'British (UK)', category: 'international', instruction: accentInstruction('British English (Received Pronunciation)') },
  { id: 'au', label: 'Australian', category: 'international', instruction: accentInstruction('Australian English') },
  { id: 'ca', label: 'Canadian', category: 'international', instruction: accentInstruction('Canadian English') },
  { id: 'ie', label: 'Irish', category: 'international', instruction: accentInstruction('Irish English') },
  { id: 'za', label: 'South African', category: 'international', instruction: accentInstruction('South African English') },
  // National / Regional (India)
  { id: 'in', label: 'Indian (Neutral)', category: 'national', instruction: accentInstruction('neutral Indian English') },
  { id: 'in-hi', label: 'Indian (Hindi-belt)', category: 'national', instruction: accentInstruction('North Indian, Hindi-influenced English') },
  { id: 'in-so', label: 'Indian (South Indian)', category: 'national', instruction: accentInstruction('South Indian English') },
];

const ACCENT_CATALOG_BY_ID = new Map(NARRATION_ACCENT_CATALOG.map((accent) => [accent.id, accent]));

/** Look up a catalog accent by id (fresh label + instruction). */
export function getCatalogAccentById(id: string | null | undefined): NarrationAccentOption | undefined {
  const key = id?.trim().toLowerCase();
  return key ? ACCENT_CATALOG_BY_ID.get(key) : undefined;
}

/** Derive a stable, url-safe accent id from a human label (for admin-created accents). */
export function slugifyAccentId(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Build a stored accent list from enabled ids, using fresh catalog labels/instructions. */
export function buildAccentOptionsFromIds(ids: readonly string[]): NarrationAccentOption[] {
  const seen = new Set<string>();
  const result: NarrationAccentOption[] = [];
  for (const rawId of ids) {
    const id = rawId?.trim().toLowerCase();
    if (!id || seen.has(id)) continue;
    const catalog = ACCENT_CATALOG_BY_ID.get(id);
    if (!catalog) continue;
    seen.add(id);
    result.push({ id: catalog.id, label: catalog.label, instruction: catalog.instruction, category: catalog.category });
  }
  return result;
}

/** The accents enabled out of the box (a curated subset of the catalog). */
export const DEFAULT_NARRATION_ACCENTS: NarrationAccentOption[] = buildAccentOptionsFromIds([
  'us',
  'uk',
  'in',
  'au',
]);

/**
 * Built-in per-plan defaults keyed by the canonical plan keys. Free gets the neutral
 * default only; paid tiers unlock progressively. Admins override this in the GUI.
 */
export const DEFAULT_NARRATION_ACCENT_TIER_MAP: NarrationAccentTierMap = {
  free: ['us'],
  plus: ['us', 'uk', 'au'],
  studio: ['us', 'uk', 'au', 'in'],
};

export const NARRATION_ACCENT_FLAG_KEYS = {
  enabled: 'narration_accent_selection_enabled',
  accentList: 'narration_accent_list',
  defaultAccent: 'narration_default_accent',
  tierMap: 'narration_accent_tier_map',
} as const;

/**
 * Accent is an English-narration concern. For other languages the built-in accents
 * don't apply, so callers should skip accent steering.
 */
export function isEnglishNarrationLanguage(
  language: StoryLanguage | string | null | undefined
): boolean {
  if (!language) return false;
  const value = String(language).toLowerCase();
  return value === 'english' || value.startsWith('en');
}

/**
 * Map a narration language value (story language like "english", or a locale code
 * like "en-IN") to a plain, region-neutral language NAME for the TTS prompt.
 *
 * This matters for accent: the TTS prompt's {{language}} slot is the only place a
 * region gets steered, and a locale like "en-IN" hard-forces Indian English, which
 * overrides any accent instruction. Using the bare language name ("English") lets
 * the accent instruction alone decide the regional variety.
 */
export function narrationLanguageDisplayName(
  language: StoryLanguage | string | null | undefined
): string {
  if (!language) return 'English';
  const value = String(language).toLowerCase();
  if (value.startsWith('hi') || value === 'hindi') return 'Hindi';
  if (value.startsWith('en') || value === 'english') return 'English';
  return String(language);
}

export function normalizeNarrationAccentList(
  values: readonly Partial<NarrationAccentOption>[]
): NarrationAccentOption[] {
  const seen = new Set<string>();
  const accents: NarrationAccentOption[] = [];

  for (const value of values) {
    const id = value.id?.trim().toLowerCase();
    const label = value.label?.trim();
    const instruction = value.instruction?.trim();
    if (!id || !label || !instruction) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    accents.push({ id, label, instruction });
  }

  return accents;
}

export function parseNarrationAccentListValue(
  value: string | null | undefined
): NarrationAccentOption[] {
  if (!value?.trim()) {
    return [...DEFAULT_NARRATION_ACCENTS];
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      const normalized = normalizeNarrationAccentList(parsed as Partial<NarrationAccentOption>[]);
      return normalized.length > 0 ? normalized : [...DEFAULT_NARRATION_ACCENTS];
    }
  } catch {
    // Malformed value — fall back to defaults.
  }

  return [...DEFAULT_NARRATION_ACCENTS];
}

export function serializeNarrationAccentList(accents: readonly NarrationAccentOption[]): string {
  return JSON.stringify(normalizeNarrationAccentList(accents));
}

export function parseNarrationAccentTierMapValue(
  value: string | null | undefined
): NarrationAccentTierMap {
  if (!value?.trim()) {
    return { ...DEFAULT_NARRATION_ACCENT_TIER_MAP };
  }

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const map: NarrationAccentTierMap = {};
      for (const [planKey, ids] of Object.entries(parsed as Record<string, unknown>)) {
        if (!Array.isArray(ids)) continue;
        const normalized = Array.from(
          new Set(ids.map((id) => String(id).trim().toLowerCase()).filter(Boolean))
        );
        if (normalized.length > 0) map[planKey.trim().toLowerCase()] = normalized;
      }
      if (Object.keys(map).length > 0) return map;
    }
  } catch {
    // Malformed value — fall back to defaults.
  }

  return { ...DEFAULT_NARRATION_ACCENT_TIER_MAP };
}

export function serializeNarrationAccentTierMap(map: NarrationAccentTierMap): string {
  return JSON.stringify(map);
}

export function resolveDefaultAccentId(
  accents: readonly NarrationAccentOption[],
  requestedDefault: string | null | undefined
): string {
  const trimmed = requestedDefault?.trim().toLowerCase();
  if (trimmed && accents.some((accent) => accent.id === trimmed)) {
    return trimmed;
  }
  return accents[0]?.id ?? DEFAULT_NARRATION_ACCENT_ID;
}

/**
 * The accent ids a given plan may use. Falls back to the default accent only for
 * plans not present in the tier map, so gating is safe-by-default.
 */
export function getAllowedAccentIdsForPlan(
  accents: readonly NarrationAccentOption[],
  tierMap: NarrationAccentTierMap,
  planKey: string | null | undefined,
  defaultAccentId: string
): string[] {
  const available = new Set(accents.map((accent) => accent.id));
  const plan = planKey?.trim().toLowerCase() || 'free';
  const mapped = tierMap[plan];
  const allowed = (mapped ?? [defaultAccentId]).filter((id) => available.has(id));
  if (allowed.length === 0) {
    // Never leave a plan with zero options — fall back to the default (or first).
    const fallback = available.has(defaultAccentId) ? defaultAccentId : accents[0]?.id;
    return fallback ? [fallback] : [];
  }
  return allowed;
}

export function getAllowedAccentsForPlan(
  accents: readonly NarrationAccentOption[],
  tierMap: NarrationAccentTierMap,
  planKey: string | null | undefined,
  defaultAccentId: string
): NarrationAccentOption[] {
  const allowedIds = new Set(
    getAllowedAccentIdsForPlan(accents, tierMap, planKey, defaultAccentId)
  );
  return accents.filter((accent) => allowedIds.has(accent.id));
}

/** Resolve the prompt instruction for an accent id, or null if unknown/absent. */
export function resolveAccentInstruction(
  accentId: string | null | undefined,
  accents: readonly NarrationAccentOption[]
): string | null {
  const id = accentId?.trim().toLowerCase();
  if (!id) return null;
  return accents.find((accent) => accent.id === id)?.instruction ?? null;
}
