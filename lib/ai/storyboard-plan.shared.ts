// Normalizes the composer's raw JSON storyboard plan (Unit 3): coerces shape so
// a partially-malformed model response never throws downstream, enforces the
// English-only rule field by field (framework: continuity is attribute-specific,
// not "everything must match" -- a bad shared-invariant item is dropped, a
// non-English panel description forces the whole plan to the English fallback),
// and resolves character name references back to their canonical form.
//
// Unit 5 adds the continuity model on top: resolveContinuityContradictions()
// reconciles a plan against its own transition (age locks that don't survive a
// time jump, a must-not-inherit list that isn't there yet, prior-state notes
// that now contradict it) and flags cinematic repetition; presentCharacterNames /
// filterCharacterReferencesByPresence / shouldAttachPreviousStoryboardReference
// decide which reference images a beat should even attach. All of it is pure
// and deterministic -- see docs/visual-composer-continuity-framework.md §3, §6,
// §12, §14, §20, §21, §28-32, §45, §47, §48.
//
// Pure and deterministic: no logging, no I/O. lib/ai/beat-orchestration.ts calls
// normalizeStoryboardPlan right after JSON.parse-ing the composer's response;
// lib/ai/prompt-compiler/scene-spec.shared.ts calls resolveContinuityContradictions
// inside buildCanonicalImageScene so every path (store, bundle, agentic) gets it.

import type {
  Character,
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

// ---------------------------------------------------------------------------
// Unit 5: continuity contradiction resolution
// ---------------------------------------------------------------------------

/** A jump big enough that surface attributes must be reassessed rather than
 * copied (framework §6): age, hair and wardrobe stop being safe to inherit. */
export const BIG_TIME_JUMPS: ReadonlySet<StoryTimeRelation> = new Set([
  'months_later', 'years_later', 'flashback', 'memory', 'dream',
]);

/** A location change big enough that the previous scene's architecture is no
 * longer a safe visual anchor (framework §10). */
export const LOCATION_CHANGES: ReadonlySet<StoryLocationRelation> = new Set([
  'new_location', 'same_category_different_location',
]);

export interface ResolveContinuityContradictionsContext {
  /** The beat's own story-generation continuity notes (prior-state notes,
   * e.g. "yellow hair clips") -- separate from the plan's own fields. */
  continuityNotes?: string[];
}

export interface ResolveContinuityContradictionsResult {
  plan: StoryboardPlan;
  /** ctx.continuityNotes with prior-state entries dropped on a big jump/location
   * change (see shouldDropPriorStateNote below); unchanged otherwise. */
  continuityNotes: string[];
  /** e.g. 'camera_repetition'. Carried on the scene as planWarnings and folded
   * into the compiler's own warnings array. */
  warnings: string[];
}

function hasBigTimeJump(plan: StoryboardPlan): boolean {
  if (plan.transition && BIG_TIME_JUMPS.has(plan.transition.timeRelation)) return true;
  // A jump can happen INSIDE a beat, not only between beats (framework §6: "the
  // Hindi beat 3 went child -> adult between panels 2 and 3").
  return FRAME_KEYS.some((key) => {
    const relation = plan[key]?.timeRelationToPreviousPanel;
    return Boolean(relation && BIG_TIME_JUMPS.has(relation));
  });
}

function hasLocationChange(plan: StoryboardPlan): boolean {
  return Boolean(plan.transition && LOCATION_CHANGES.has(plan.transition.locationRelation));
}

/** True only for the beat-level transition (previous beat -> this beat) --
 * used for the previous-storyboard reference decision, which is about the
 * PREVIOUS BEAT'S image, not a time jump staged inside this same beat. */
function isBigBeatTransition(plan: StoryboardPlan): boolean {
  if (!plan.transition) return false;
  return BIG_TIME_JUMPS.has(plan.transition.timeRelation) || LOCATION_CHANGES.has(plan.transition.locationRelation);
}

// Small, deliberately generic English word list for spotting a prior-state note
// that describes wardrobe/hair/accessory/location detail (framework §14's
// must-not-inherit examples: "yellow hair clips", "village pond"). Not meant to
// be exhaustive -- paired with the mustNotInherit token-overlap check below.
const PRIOR_STATE_DROP_WORDS: ReadonlySet<string> = new Set([
  'wardrobe', 'clothes', 'clothing', 'outfit', 'costume', 'dress', 'shirt', 'jacket', 'coat',
  'trousers', 'pants', 'skirt', 'shoes', 'sandals', 'scarf', 'bag',
  'hair', 'hairstyle', 'braid', 'ponytail', 'bun', 'fringe', 'bangs',
  'clip', 'clips', 'ribbon', 'accessory', 'accessories', 'jewelry', 'jewellery',
  'necklace', 'bracelet', 'earring', 'earrings', 'hat', 'cap',
  'location', 'place', 'room', 'house', 'home', 'building', 'architecture',
  'village', 'town', 'city', 'market', 'pond', 'yard', 'garden', 'street', 'shop',
]);

const LOCAL_STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'of', 'and', 'or', 'with', 'in', 'on', 'at', 'to', 'is',
  'are', 'be', 'by', 'as', 'that', 'this', 'its', 'their', 'over', 'under', 'previous',
]);

/** Meaningful (non-stopword) lowercase tokens for a phrase, Unicode-aware. Kept
 * local rather than importing relevance.shared's phraseKey/tokenize -- that
 * module imports scene-spec.shared, which needs to import
 * resolveContinuityContradictions from THIS module, and a third import back
 * out to relevance.shared would close that into a cycle. */
function meaningfulTokens(text: string): Set<string> {
  const tokens = text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !LOCAL_STOPWORDS.has(t));
  return new Set(tokens);
}

/** True when `candidate`'s meaningful tokens are already a subset of some
 * existing item's tokens -- i.e. that item already covers the same ground
 * ("previous wardrobe" is covered by an existing "previous wardrobe and
 * accessories"). Phrase-key-style containment, not exact-string matching. */
function isCoveredByExisting(existingItems: string[], candidate: string): boolean {
  const candidateTokens = meaningfulTokens(candidate);
  if (candidateTokens.size === 0) return false;
  return existingItems.some((item) => {
    const itemTokens = meaningfulTokens(item);
    for (const token of candidateTokens) {
      if (!itemTokens.has(token)) return false;
    }
    return true;
  });
}

/** A continuityNotes entry describes prior visual state (see the module header
 * for why that differs from the composer's own, already-current-state
 * sharedVisualInvariants). On a big jump or location change it should be
 * dropped when it mentions wardrobe/hair/accessory/location detail, or shares
 * a meaningful word with something the plan now explicitly says not to
 * inherit. */
function shouldDropPriorStateNote(note: string, mustNotInherit: string[]): boolean {
  const noteTokens = meaningfulTokens(note);
  for (const word of PRIOR_STATE_DROP_WORDS) {
    if (noteTokens.has(word)) return true;
  }
  for (const item of mustNotInherit) {
    const itemTokens = meaningfulTokens(item);
    for (const token of noteTokens) {
      if (itemTokens.has(token)) return true;
    }
  }
  return false;
}

function normalizeShotKey(shotScale: string | undefined, cameraHeight: string | undefined): string | null {
  const scale = (shotScale ?? '').trim().toLowerCase();
  const height = (cameraHeight ?? '').trim().toLowerCase();
  return scale && height ? `${scale}|${height}` : null;
}

/**
 * Reconciles a normalized StoryboardPlan against its own declared transition
 * (framework §31 "Contradiction Detection"), pure and deterministic:
 * - a character's age lock doesn't survive a big time jump (the live smoke
 *   found Gemini setting `modes.age: LOCKED` across a twelve-year jump);
 * - a big jump/location change gets an explicit must-not-inherit entry for
 *   what should no longer be copied, unless something already covers it;
 * - the beat's own prior-state continuity notes are filtered against that
 *   same list so a stale detail ("yellow hair clips") doesn't linger;
 * - three or more panels sharing a camera setup with no deliberate echo is
 *   flagged (framework §20/§21), not silently rendered as accidental repeats.
 *
 * Composer invariants (`plan.sharedVisualInvariants`) are never touched here --
 * they describe the state AFTER the transition (see the module header) and
 * dropping them on a jump would delete correct within-beat continuity.
 */
export function resolveContinuityContradictions(
  plan: StoryboardPlan,
  ctx: ResolveContinuityContradictionsContext = {}
): ResolveContinuityContradictionsResult {
  const warnings: string[] = [];
  const bigTimeJump = hasBigTimeJump(plan);
  const locationChange = hasLocationChange(plan);

  const characterVisuals = plan.characterVisuals
    ? plan.characterVisuals.map((entry) =>
        bigTimeJump && entry.modes.age === 'LOCKED'
          ? { ...entry, modes: { ...entry.modes, age: 'EVOLVE' as ContinuityMode } }
          : entry
      )
    : plan.characterVisuals;

  const mustNotInherit = [...(plan.mustNotInherit ?? [])];
  const addIfNotCovered = (candidate: string) => {
    if (!isCoveredByExisting(mustNotInherit, candidate)) mustNotInherit.push(candidate);
  };
  if (bigTimeJump) {
    addIfNotCovered('previous wardrobe');
    addIfNotCovered('previous hairstyle');
  }
  if (locationChange) {
    addIfNotCovered('previous location architecture');
  }

  const sourceNotes = ctx.continuityNotes ?? [];
  const continuityNotes =
    bigTimeJump || locationChange
      ? sourceNotes.filter((note) => !shouldDropPriorStateNote(note, mustNotInherit))
      : sourceNotes;

  // Shot diversity (framework §20/§21): 3+ panels sharing a normalized
  // shotScale + cameraHeight with none of them a deliberate visual echo.
  const shotGroups = new Map<string, boolean[]>();
  for (const key of FRAME_KEYS) {
    const frame = plan[key];
    const shotKey = normalizeShotKey(frame?.shotScale, frame?.cameraHeight);
    if (!shotKey) continue;
    const flags = shotGroups.get(shotKey) ?? [];
    flags.push(Boolean(frame?.visualEcho));
    shotGroups.set(shotKey, flags);
  }
  for (const flags of shotGroups.values()) {
    if (flags.length >= 3 && !flags.some(Boolean)) {
      warnings.push('camera_repetition');
      break;
    }
  }

  const nextPlan: StoryboardPlan = {
    ...plan,
    ...(characterVisuals ? { characterVisuals } : {}),
    mustNotInherit,
  };

  return { plan: nextPlan, continuityNotes, warnings };
}

// ---------------------------------------------------------------------------
// Unit 5: presence-scoped references (Q4 / R8)
// ---------------------------------------------------------------------------

/**
 * The union of every panel's composer-declared `charactersPresent`, resolved
 * to canonical character names. Returns `null` -- meaning "don't restrict,
 * attach everything, exactly like before Unit 5" -- for a fallback plan
 * (`fallbackReason`/`languageFallback` set, so presence data can't be trusted),
 * when any of the four frames doesn't even carry a `charactersPresent` array
 * (a plan stored before that field existed), or when the union comes back
 * empty (nobody was ever declared present anywhere -- fail open rather than
 * attach no character references at all).
 */
export function presentCharacterNames(
  plan: StoryboardPlan | null | undefined,
  characters: Character[]
): Set<string> | null {
  if (!plan || plan.fallbackReason || plan.languageFallback) return null;
  const frames = FRAME_KEYS.map((key) => plan[key]);
  if (frames.some((frame) => !Array.isArray(frame?.charactersPresent))) return null;

  const union = new Set<string>();
  for (const frame of frames) {
    for (const raw of frame?.charactersPresent ?? []) {
      const key = normKey(raw);
      if (!key) continue;
      const canonical = characters.find((c) => normKey(c.name) === key);
      union.add(canonical ? canonical.name : raw);
    }
  }
  return union.size > 0 ? union : null;
}

/**
 * Restricts a reference list to characters actually present somewhere in the
 * beat (framework §30 "Reference Image Handling" / §48). `presentNames: null`
 * means "don't restrict" (see presentCharacterNames) -- every reference passes
 * through unchanged, matching pre-Unit-5 behaviour. Scene/world references
 * (`type !== 'character'`) always pass through: presence is a character-only
 * concept. Generic over the reference shape so the same helper serves the
 * browser's ReferenceImage and the server's ServerReferenceImage.
 */
export function filterCharacterReferencesByPresence<T extends { type: string; name?: string }>(
  refs: T[],
  presentNames: Set<string> | null
): T[] {
  if (!presentNames) return refs;
  const normalized = new Set(Array.from(presentNames, (name) => normKey(name)));
  return refs.filter((ref) => {
    if (ref.type !== 'character') return true;
    const name = ref.name;
    return Boolean(name) && normalized.has(normKey(name as string));
  });
}

/**
 * Q4 / R8: skip the previous beat's storyboard image as a reference on a big
 * time jump or location change -- it otherwise freezes wardrobe, pose and
 * staging the new beat is meant to reconsider -- UNLESS no character present
 * in this beat has a reference image of their own, in which case the old
 * image is the only identity anchor available and keeping it beats losing
 * identity entirely. True for a plan with no transition at all (nothing to
 * react to) and for any transition that isn't a big jump/location change.
 */
export function shouldAttachPreviousStoryboardReference(
  plan: StoryboardPlan | null | undefined,
  ctx: { presentCharacterHasReference: boolean }
): boolean {
  if (!plan || !plan.transition) return true;
  if (!isBigBeatTransition(plan)) return true;
  return !ctx.presentCharacterHasReference;
}
