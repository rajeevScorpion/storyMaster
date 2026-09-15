// Normalizes the composer's raw JSON storyboard plan (Unit 3): coerces shape so
// a partially-malformed model response never throws downstream, enforces the
// English-only rule field by field (framework: continuity is attribute-specific,
// not "everything must match" -- a bad shared-invariant item is dropped, a
// non-English panel description forces the whole plan to the English fallback),
// and resolves character name references back to their canonical form.
//
// Pure and deterministic: no logging, no I/O. lib/ai/beat-orchestration.ts calls
// this right after JSON.parse-ing the composer's response.

import type {
  ContinuityMode,
  PanelStoryFunction,
  PortraitTask,
  StoryboardFramePlan,
  StoryboardPlan,
  StoryLocationRelation,
  StoryTimeRelation,
} from '@/lib/types/story';
import { isEnglishText } from './prompt-compiler/language.shared';

const STORY_TIME_RELATIONS: ReadonlySet<string> = new Set([
  'continuous', 'same_session', 'hours_later', 'next_day', 'days_weeks_later',
  'months_later', 'years_later', 'flashback', 'memory', 'dream', 'unknown',
]);

const STORY_LOCATION_RELATIONS: ReadonlySet<string> = new Set([
  'same_exact', 'same_building_different_area', 'same_category_different_location',
  'new_location', 'unknown',
]);

const CONTINUITY_MODES: ReadonlySet<string> = new Set(['LOCKED', 'EVOLVE', 'FREE']);

const PANEL_STORY_FUNCTIONS: ReadonlySet<string> = new Set([
  'ESTABLISH', 'REVEAL', 'ESCALATE', 'HESITATE', 'REACT', 'CHOOSE', 'ACT',
  'TRANSFORM', 'CONNECT', 'ISOLATE', 'RESOLVE', 'FORESHADOW', 'CONTRAST',
]);

const FRAME_KEYS = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const;
type FrameKey = (typeof FRAME_KEYS)[number];

export interface NormalizeStoryboardPlanContext {
  /** Canonical character names for this beat (beat.characters[].name), any script. */
  characterNames: string[];
}

export interface NormalizeStoryboardPlanResult {
  plan: StoryboardPlan;
  /** True when a panel was unusable (empty description) or its description/cameraAngle
   * was not English -- the caller should discard `plan` and use the English fallback. */
  needsLanguageFallback: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function normKey(value: string): string {
  return value.normalize('NFC').trim().toLowerCase();
}

function normalizeTimeRelation(value: unknown): StoryTimeRelation {
  return typeof value === 'string' && STORY_TIME_RELATIONS.has(value) ? (value as StoryTimeRelation) : 'unknown';
}

function normalizeLocationRelation(value: unknown): StoryLocationRelation {
  return typeof value === 'string' && STORY_LOCATION_RELATIONS.has(value)
    ? (value as StoryLocationRelation)
    : 'unknown';
}

function normalizeStoryFunction(value: unknown): PanelStoryFunction | undefined {
  return typeof value === 'string' && PANEL_STORY_FUNCTIONS.has(value) ? (value as PanelStoryFunction) : undefined;
}

function normalizeMode(value: unknown): ContinuityMode | undefined {
  return typeof value === 'string' && CONTINUITY_MODES.has(value) ? (value as ContinuityMode) : undefined;
}

function filterEnglish(items: string[], ignore: string[]): string[] {
  return items.filter((item) => isEnglishText(item, { ignore }));
}

function blankIfNonEnglish(value: string, ignore: string[]): string {
  return isEnglishText(value, { ignore }) ? value : '';
}

export function normalizeStoryboardPlan(
  raw: unknown,
  ctx: NormalizeStoryboardPlanContext
): NormalizeStoryboardPlanResult {
  const record = asRecord(raw);
  const characterNames = (ctx.characterNames || []).filter(
    (name): name is string => typeof name === 'string' && name.trim().length > 0
  );
  const ignore = characterNames;

  const exactCanonical = (value: string): string | undefined =>
    characterNames.find((name) => normKey(name) === normKey(value));

  // ---- characterVisuals: coerce, then build the englishName -> canonical-name
  // lookup used both here and to fix frame.charactersPresent references. ----
  const rawCharacterVisuals = Array.isArray(record.characterVisuals) ? record.characterVisuals : [];
  const selfResolved = rawCharacterVisuals.map((entryRaw) => {
    const entryRecord = asRecord(entryRaw);
    const modesRecord = asRecord(entryRecord.modes);
    const rawName = asString(entryRecord.name).trim();
    return {
      name: exactCanonical(rawName) ?? rawName,
      englishName: asString(entryRecord.englishName).trim(),
      identityAnchors: asString(entryRecord.identityAnchors),
      currentAppearance: asString(entryRecord.currentAppearance),
      modes: {
        age: normalizeMode(modesRecord.age),
        hair: normalizeMode(modesRecord.hair),
        wardrobe: normalizeMode(modesRecord.wardrobe),
        accessories: normalizeMode(modesRecord.accessories),
      },
    };
  });

  const englishNameToName = new Map<string, string>();
  for (const entry of selfResolved) {
    if (entry.englishName) {
      englishNameToName.set(normKey(entry.englishName), entry.name);
    }
  }

  const canonicalizeName = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;
    const exact = exactCanonical(trimmed);
    if (exact) return exact;
    const mapped = englishNameToName.get(normKey(trimmed));
    if (mapped) return exactCanonical(mapped) ?? mapped;
    return trimmed;
  };

  const characterVisuals = selfResolved
    .map((entry) => ({
      ...entry,
      name: canonicalizeName(entry.name),
      identityAnchors: blankIfNonEnglish(entry.identityAnchors, ignore),
      currentAppearance: blankIfNonEnglish(entry.currentAppearance, ignore),
      englishName: isEnglishText(entry.englishName) ? entry.englishName : '',
    }))
    .filter((entry) => Boolean(exactCanonical(entry.name)));

  // ---- frames ----
  let needsLanguageFallback = false;
  const frames = {} as Record<FrameKey, StoryboardFramePlan>;
  for (const key of FRAME_KEYS) {
    const frameRecord = asRecord(record[key]);
    const description = asString(frameRecord.description);
    const cameraAngle = asString(frameRecord.cameraAngle);

    if (!description.trim()) {
      needsLanguageFallback = true;
    }
    if (!isEnglishText(description, { ignore }) || !isEnglishText(cameraAngle, { ignore })) {
      needsLanguageFallback = true;
    }

    frames[key] = {
      description,
      prompt: blankIfNonEnglish(asString(frameRecord.prompt), ignore),
      cameraAngle,
      visualFocus: filterEnglish(asStringArray(frameRecord.visualFocus), ignore),
      emotion: blankIfNonEnglish(asString(frameRecord.emotion), ignore),
      continuityAnchor: blankIfNonEnglish(asString(frameRecord.continuityAnchor), ignore),
      charactersPresent: asStringArray(frameRecord.charactersPresent).map((name) => canonicalizeName(name)),
      storyFunction: normalizeStoryFunction(frameRecord.storyFunction),
      timeRelationToPreviousPanel: normalizeTimeRelation(frameRecord.timeRelationToPreviousPanel),
      appearanceChanges: filterEnglish(asStringArray(frameRecord.appearanceChanges), ignore),
      shotScale: blankIfNonEnglish(asString(frameRecord.shotScale), ignore),
      cameraHeight: blankIfNonEnglish(asString(frameRecord.cameraHeight), ignore),
      visualEcho: asBoolean(frameRecord.visualEcho),
    };
  }

  const transitionRecord = asRecord(record.transition);
  const transition = {
    timeRelation: normalizeTimeRelation(transitionRecord.timeRelation),
    locationRelation: normalizeLocationRelation(transitionRecord.locationRelation),
    evidence: blankIfNonEnglish(asString(transitionRecord.evidence), ignore),
  };

  const settingRecord = asRecord(record.setting);
  const setting = {
    location: blankIfNonEnglish(asString(settingRecord.location), ignore),
    timeOfDay: blankIfNonEnglish(asString(settingRecord.timeOfDay), ignore),
    era: blankIfNonEnglish(asString(settingRecord.era), ignore),
  };

  const plan: StoryboardPlan = {
    sharedVisualInvariants: filterEnglish(asStringArray(record.sharedVisualInvariants), ignore),
    // No validation beyond shape coercion, matching the legacy JSON.parse(text)-as-is
    // behavior -- portrait prompts are free text and were never checked here.
    portraitTasks: Array.isArray(record.portraitTasks) ? (record.portraitTasks as PortraitTask[]) : [],
    topLeft: frames.topLeft,
    topRight: frames.topRight,
    bottomLeft: frames.bottomLeft,
    bottomRight: frames.bottomRight,
    negativeConstraints: filterEnglish(asStringArray(record.negativeConstraints), ignore),
    transition,
    setting,
    characterVisuals,
    mustNotInherit: filterEnglish(asStringArray(record.mustNotInherit), ignore),
  };

  return { plan, needsLanguageFallback };
}
