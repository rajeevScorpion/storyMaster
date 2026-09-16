// Canonical image scene spec — the versioned, provider-independent source of
// truth for the image prompt compiler. It is built deterministically from the
// existing storyboard plan + beat data (never from the redundant per-frame
// `prompt` string) and is designed to be rebuilt on demand rather than stored,
// so there is no second source of truth for scenes.
//
// Everything here is pure and isomorphic (no server-only imports): the store
// builds scenes in the browser, and beat-bundle builds them on the server.

import type {
  Character,
  ContinuityMode,
  PanelStoryFunction,
  StoryboardPlan,
  StoryboardFramePlan,
  StoryAspectRatio,
  StoryLocationRelation,
  StoryTimeRelation,
} from '@/lib/types/story';
import type { BeatImageRegenerationOptions, StoryboardPanelKey } from '@/lib/ai/image-regeneration.shared';
import { resolveContinuityContradictions } from '@/lib/ai/storyboard-plan.shared';
import { isEnglishText } from './language.shared';

export const SCENE_SCHEMA_VERSION = '1.1';
export const SCENE_BUILDER_VERSION = 'scene-builder-v2';

// Length caps. These bound free-text fields before compilation so a runaway
// summary cannot inflate the prompt or smuggle huge payloads through.
export const SCENE_LIMITS = {
  visualIdentity: 240,
  action: 320,
  emotion: 120,
  visualFocusItems: 6,
  visualFocusItem: 60,
  continuityNote: 160,
  continuityNotes: 2,
  worldInvariant: 200,
  worldInvariants: 12,
  worldAnchor: 400,
  // Story visual direction is a structured four-axis profile (rendering,
  // atmosphere, color/light, richness). Preserve all four admin definers.
  style: 2000,
  negativeConstraint: 120,
  negativeConstraints: 24,
  userDirective: 400,
  shot: 160,
  continuityAnchor: 160,
  // Continuity framework (schema 1.1) additions.
  imageName: 80,
  identityAnchors: 200,
  currentAppearance: 200,
  settingField: 80,
  transitionEvidence: 160,
  mustNotInheritItem: 80,
  mustNotInheritItems: 8,
  appearanceChangeItem: 120,
  appearanceChangeItems: 3,
  shotScale: 40,
  cameraHeight: 40,
} as const;

// Baseline negative constraints always present for a storyboard grid. Merged
// with the plan's own negatives and deduped downstream. These express the
// non-negotiable layout/no-text guarantees so they survive even when a plan
// omits them.
export const BASELINE_NEGATIVE_CONSTRAINTS: readonly string[] = [
  'text',
  'captions',
  'speech bubbles',
  'subtitles',
  'labels',
  'logos',
  'watermarks',
  'duplicated named characters',
  'extra panels',
  'nested panels',
  'white or cream gutters',
  'outer borders',
  'padding',
];

export type PanelPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export const PANEL_POSITIONS: readonly PanelPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

const FRAME_KEY_BY_POSITION: Record<PanelPosition, 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'> = {
  'top-left': 'topLeft',
  'top-right': 'topRight',
  'bottom-left': 'bottomLeft',
  'bottom-right': 'bottomRight',
};

const POSITION_BY_PANEL_KEY: Record<StoryboardPanelKey, PanelPosition> = {
  topLeft: 'top-left',
  topRight: 'top-right',
  bottomLeft: 'bottom-left',
  bottomRight: 'bottom-right',
};

/** A diagnostic record used by the relevance filter, compiler and assembler. */
export interface DiagnosticItem {
  field: string;
  reason: string;
  detail?: string;
}

export interface SceneCharacterModes {
  age?: ContinuityMode;
  hair?: ContinuityMode;
  wardrobe?: ContinuityMode;
  accessories?: ContinuityMode;
}

export interface SceneCharacter {
  /** Stable key derived from the display name — NEVER a database id/uuid. */
  key: string;
  displayName: string;
  /** English, image-facing name (framework §7 Q1): the composer's romanized
   * `englishName` when present and English, else `displayName` when it already
   * reads as English, else a positional placeholder ("Character N"). This is
   * the name that appears in the compiled prompt, never `displayName` when it
   * is non-Latin. */
  imageName: string;
  /** Compact visual identity (appearance), sanitized and length-capped.
   * English only — blank when the character's stored appearanceSummary is not
   * English (old stored data may predate the composer's English rule). */
  visualIdentity: string;
  /** LOCKED identity from the plan's characterVisuals: face, skin tone, build,
   * distinguishing marks. English only, blank when unavailable/non-English. */
  identityAnchors: string;
  /** EVOLVE/FREE current state: age/life stage, hair, wardrobe, accessories,
   * physical state. English only, blank when unavailable/non-English. */
  currentAppearance: string;
  modes?: SceneCharacterModes;
  hasReference: boolean;
  continuityPriority: 'critical';
}

export interface ScenePanel {
  position: PanelPosition;
  shot: string;
  /** Visible action for the panel — from frame.description, not frame.prompt.
   * Kept even when the source text is not English (framework: the image must
   * still depict the event; the compiler's final English gate warns instead
   * of silently blanking the one field that carries the story). */
  action: string;
  emotion: string;
  visualFocus: string[];
  /** Character keys present in this panel. */
  charactersPresent: string[];
  continuityAnchor?: string;
  /** This panel's dramatic function; drives camera derivation (framework §19). */
  storyFunction?: PanelStoryFunction;
  /** Time jump relative to the previous panel — jumps can happen inside a beat. */
  timeRelationToPreviousPanel?: StoryTimeRelation;
  /** English, per panel: how a character's look differs from characterVisuals's
   * currentAppearance for this specific panel. */
  appearanceChanges: string[];
  shotScale: string;
  cameraHeight: string;
  /** True only for a deliberate repeated framing (framework §21). */
  visualEcho: boolean;
}

export interface SceneUserDirectives {
  mode: 'refine' | 'reimagine';
  overall?: string;
  perPanel?: Partial<Record<PanelPosition, string>>;
}

export interface CanonicalImageScene {
  schemaVersion: string;
  imageType: 'storyboard';
  taskKey: 'image_generation';
  aspectRatio: StoryAspectRatio;
  layout: {
    type: 'grid';
    columns: 2;
    rows: 2;
    panelCount: 4;
    fullBleed: true;
    divider: 'thin near-black';
  };
  style: { visualStyle: string; axes: string[] };
  world: { anchor?: string; invariants: string[] };
  characters: SceneCharacter[];
  panels: ScenePanel[];
  continuity: {
    characterIdentity: 'strict';
    /** Derived per scene from the transition (Unit 5) -- no longer a constant:
     * 'scene' for a continuous/same_session/unknown transition (clothing holds
     * for the scene), 'evolve' otherwise (a time/location jump reassesses it). */
    clothing: 'scene' | 'evolve';
    world: 'strict';
    sequentialMoments: true;
    notes: string[];
  };
  /** Temporal/spatial relationship from the previous beat to this one (framework
   * §6, §10). Absent for a legacy-conversion scene (no structured plan). */
  transition?: {
    timeRelation: StoryTimeRelation;
    locationRelation: StoryLocationRelation;
    /** English, short: what in the beat text signals this transition. */
    evidence: string;
  };
  /** English. Current scene setting, independent of any previous beat's setting. */
  setting?: {
    location: string;
    timeOfDay: string;
    era: string;
  };
  /** Explicit "do not inherit" list (framework §14), e.g. "previous wardrobe".
   * Always an array (empty for a legacy-conversion scene). */
  mustNotInherit: string[];
  userDirectives?: SceneUserDirectives;
  negativeConstraints: string[];
  /** Warnings from resolveContinuityContradictions (Unit 5), e.g.
   * 'camera_repetition'. Folded into the compiler's own `warnings` array;
   * never rendered into the prompt text. Absent when there are none. */
  planWarnings?: string[];
  /** Development/diagnostic provenance — must never be compiled into a prompt. */
  provenance: { source: 'storyboard_plan' | 'legacy_text'; builderVersion: string };
  /** Present only for the legacy conversion path (no storyboard plan). */
  legacyText?: string;
}

// --- Sanitizers -----------------------------------------------------------

/** Replace control characters (incl. newlines/tabs) with spaces. */
export function stripControlChars(value: string): string {
  // Built from a string, not a regex literal — a literal escape here writes real
  // control bytes into this file and git then treats it as binary.
  return value.replace(new RegExp('[\\u0000-\\u001F\\u007F]', 'g'), ' ');
}

/** Index of the last whitespace char at or before `limit`, or -1 if none. */
function lastIndexOfWhitespace(value: string, limit: number): number {
  const end = Math.min(limit, value.length);
  for (let i = end - 1; i >= 0; i -= 1) {
    if (/\s/.test(value[i])) return i;
  }
  return -1;
}

/** End of the last whole `Intl.Segmenter` word segment that fits within `maxLength`. */
function findWordCutoff(value: string, maxLength: number): string | null {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null;
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  let result = '';
  for (const { segment } of segmenter.segment(value)) {
    if (result.length + segment.length > maxLength) break;
    result += segment;
  }
  return result || null;
}

/**
 * End of the last whole grapheme cluster that fits within `maxLength`, via
 * `Intl.Segmenter`. Falls back to a code-point cut (never splits a surrogate
 * pair) when `Intl.Segmenter` is unavailable.
 */
function findGraphemeCutoff(value: string, maxLength: number): string {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let result = '';
    for (const { segment } of segmenter.segment(value)) {
      if (result.length + segment.length > maxLength) break;
      result += segment;
    }
    return result;
  }
  let result = '';
  for (const ch of Array.from(value)) {
    if (result.length + ch.length > maxLength) break;
    result += ch;
  }
  return result;
}

// Non-breaking hyphen, en dash, em dash, plain hyphen-minus (kept last in the
// class so it can never be misread as a range operator) — the dash forms most
// likely to appear as a dangling separator after a word-boundary cut.
const DANGLING_SEPARATOR_RE = /[\s,;:‑–—-]+$/;

/** Strip trailing whitespace and dangling separators (,;: and dashes). */
function stripDanglingSeparators(value: string): string {
  return value.replace(DANGLING_SEPARATOR_RE, '');
}

/**
 * Strip control chars, collapse whitespace, trim and cap length. The
 * over-length branch cuts at a word boundary, never mid-word or mid-cluster:
 *   1. the last whitespace at/before maxLength, if it's at least halfway in;
 *   2. otherwise the end of the last Intl.Segmenter word that fits;
 *   3. otherwise the last grapheme boundary that fits (or a code-point cut).
 */
export function sanitizeText(value: string | undefined | null, maxLength: number): string {
  if (!value) return '';
  const cleaned = stripControlChars(value).replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;

  const wsIndex = lastIndexOfWhitespace(cleaned, maxLength);
  if (wsIndex >= maxLength / 2) {
    return stripDanglingSeparators(cleaned.slice(0, wsIndex).trimEnd());
  }

  const wordCut = findWordCutoff(cleaned, maxLength);
  if (wordCut) {
    return stripDanglingSeparators(wordCut.trimEnd());
  }

  return stripDanglingSeparators(findGraphemeCutoff(cleaned, maxLength).trimEnd());
}

/**
 * Gemini (and other providers) sometimes return camera fields as snake_case
 * enum-ish tokens ("medium_long_shot", "eye_level") rather than prose. Replace
 * underscores with spaces and collapse whitespace before sanitizing so the
 * compiled PANELS line reads "medium long shot, eye level" instead of leaking
 * the raw token.
 */
function normalizeCameraField(value: string | undefined | null, maxLength: number): string {
  if (!value) return '';
  const spaced = value.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  return sanitizeText(spaced, maxLength);
}

function sanitizeList(values: string[] | undefined | null, maxItems: number, maxItemLength: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values || []) {
    const cleaned = sanitizeText(raw, maxItemLength);
    if (!cleaned) continue;
    const dedupeKey = cleaned.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(cleaned);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** `sanitizeList`, dropping items that don't read as English first. */
function sanitizeEnglishList(
  values: string[] | undefined | null,
  ignore: string[],
  maxItems: number,
  maxItemLength: number
): string[] {
  const english = (values || []).filter((item) => isEnglishText(item, { ignore }));
  return sanitizeList(english, maxItems, maxItemLength);
}

/** Sanitized text, but blanked when it doesn't read as English. */
function sanitizeEnglishText(value: string | undefined | null, ignore: string[], maxLength: number): string {
  const text = value || '';
  return isEnglishText(text, { ignore }) ? sanitizeText(text, maxLength) : '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Character keys -------------------------------------------------------

/** Slugify a display name into a stable, id-free key. */
export function slugifyCharacterKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeNameKey(value: string): string {
  return value.normalize('NFC').trim().toLowerCase();
}

/** Find the plan's characterVisuals entry for a character, matched by
 * canonical name (NFC, case-insensitive). */
export function findCharacterVisual(
  name: string,
  characterVisuals: StoryboardPlan['characterVisuals'] | undefined
): NonNullable<StoryboardPlan['characterVisuals']>[number] | undefined {
  if (!characterVisuals || !name) return undefined;
  const key = normalizeNameKey(name);
  return characterVisuals.find((entry) => normalizeNameKey(entry.name) === key);
}

/**
 * The English, image-facing name for a character (framework §7 Q1): the
 * composer's romanized `englishName` when present and English, else the
 * character's own display name when it already reads as English, else a
 * positional placeholder ("Character N", 1-based). Exported so Unit 4b's
 * reference-binding lines can name a character exactly the way the compiled
 * prompt does.
 */
export function deriveImageName(
  name: string,
  index: number,
  characterVisuals: StoryboardPlan['characterVisuals'] | undefined
): string {
  const placeholder = `Character ${index + 1}`;
  const entry = findCharacterVisual(name, characterVisuals);
  if (entry?.englishName && isEnglishText(entry.englishName)) {
    return sanitizeText(entry.englishName, SCENE_LIMITS.imageName) || placeholder;
  }
  if (name && isEnglishText(name)) {
    return sanitizeText(name, SCENE_LIMITS.imageName) || placeholder;
  }
  return placeholder;
}

/**
 * Map of each character's canonical name (NFC, trimmed, lowercased) to its
 * image-facing name (`deriveImageName`, the same call `buildSceneCharacters`
 * makes for `SceneCharacter.imageName`) — the one function both the compiled
 * CHARACTERS section and Unit 4b's reference-binding lines call, so a
 * reference image can never be labelled with a name the compiled prompt does
 * not itself use. `index` follows `characters`' array order, matching how the
 * scene builder numbers "Character N" placeholders.
 */
export function resolveImageFacingNames(
  characters: Character[],
  plan?: StoryboardPlan | null
): Map<string, string> {
  const map = new Map<string, string>();
  characters.forEach((character, index) => {
    const key = normalizeNameKey(character.name || '');
    if (!key || map.has(key)) return;
    map.set(key, deriveImageName(character.name, index, plan?.characterVisuals));
  });
  return map;
}

function buildSceneCharacters(
  characters: Character[],
  plan: StoryboardPlan | null | undefined,
  ignore: string[]
): SceneCharacter[] {
  const out: SceneCharacter[] = [];
  const usedKeys = new Set<string>();
  characters.forEach((character, index) => {
    const displayName = sanitizeText(character.name, 80) || `Character ${index + 1}`;
    let base = slugifyCharacterKey(displayName);
    if (!base) base = `character-${index + 1}`;
    let key = base;
    let suffix = 2;
    while (usedKeys.has(key)) {
      key = `${base}-${suffix}`;
      suffix += 1;
    }
    usedKeys.add(key);

    const cv = findCharacterVisual(character.name, plan?.characterVisuals);
    const imageName = deriveImageName(character.name, index, plan?.characterVisuals);
    const modes = cv?.modes;
    const hasAnyMode = Boolean(modes && (modes.age || modes.hair || modes.wardrobe || modes.accessories));

    out.push({
      key,
      displayName,
      imageName,
      visualIdentity: sanitizeEnglishText(character.appearanceSummary, ignore, SCENE_LIMITS.visualIdentity),
      identityAnchors: cv ? sanitizeEnglishText(cv.identityAnchors, ignore, SCENE_LIMITS.identityAnchors) : '',
      currentAppearance: cv ? sanitizeEnglishText(cv.currentAppearance, ignore, SCENE_LIMITS.currentAppearance) : '',
      ...(hasAnyMode ? { modes } : {}),
      hasReference: Boolean(
        character.portraitBase64 || character.portraitUrl || character.referenceSheetUrl
      ),
      continuityPriority: 'critical',
    });
  });
  return out;
}

// --- Character presence ---------------------------------------------------

const ABSENCE_PATTERN = /(is\s+)?(not\s+present|absent|omitted|missing)/i;

// Scripts conventionally written without spaces between words. A whole-"word"
// boundary check is meaningless for these — a name is routinely followed
// directly by a particle or another character with no separator (e.g.
// Japanese さくらは). Detected on the NAME being searched for, not the haystack.
const NO_SPACE_SCRIPT_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/**
 * Unicode-aware, case-insensitive whole-name search. Returns the match index
 * in `haystack.normalize('NFC')`, or -1 if not found.
 *
 * For names in space-delimited scripts (Latin, Devanagari, Arabic, Cyrillic,
 * ...), matches on a real letter/mark/number boundary so e.g. "Leo" doesn't
 * match inside "Leonard" and Devanagari "अन्व" doesn't match inside "अन्वी"
 * (the trailing vowel sign is a combining mark, \p{M}, so it must be included
 * in the boundary check alongside \p{L}/\p{N}).
 *
 * For names containing characters from scripts conventionally written without
 * spaces (CJK, Thai, Lao, Khmer, Myanmar), a boundary check is meaningless —
 * use a plain substring match instead.
 */
export function findWholeName(haystack: string, name: string): number {
  const normHaystack = haystack.normalize('NFC');
  const normName = name.normalize('NFC').trim();
  if (!normName) return -1;
  if (NO_SPACE_SCRIPT_RE.test(normName)) {
    return normHaystack.toLowerCase().indexOf(normName.toLowerCase());
  }
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}])${escapeRegExp(normName)}(?![\\p{L}\\p{M}\\p{N}])`,
    'iu'
  );
  const match = pattern.exec(normHaystack);
  return match ? match.index : -1;
}

// Sentence terminators across scripts: Latin . ! ?, Devanagari danda/double
// danda, Arabic question mark, and the CJK full stop.
const SENTENCE_SPLIT_RE = /[.!?।॥؟。]/u;

/**
 * Best-effort presence detection for legacy plans that don't declare which
 * characters appear in a frame. Whole-name, case-insensitive, Unicode-aware
 * match on the action + visual focus, checked against either the character's
 * `displayName` or `imageName` (composer descriptions may use either), with a
 * small negation guard so "<name> is absent" does not count as present. The
 * composer-supplied `charactersPresent` field is the primary path; this is
 * only the fallback.
 */
export function deriveCharactersPresent(haystack: string, characters: SceneCharacter[]): string[] {
  const normHaystack = haystack.normalize('NFC');
  const present: string[] = [];
  for (const character of characters) {
    const candidates = [character.displayName, character.imageName]
      .map((n) => (n || '').trim())
      .filter((n, i, arr) => Boolean(n) && arr.indexOf(n) === i);
    for (const name of candidates) {
      const idx = findWholeName(normHaystack, name);
      if (idx === -1) continue;
      // Negation guard: within the same sentence after the name.
      const tail = normHaystack.slice(idx + name.normalize('NFC').length).split(SENTENCE_SPLIT_RE)[0] ?? '';
      if (ABSENCE_PATTERN.test(tail)) continue;
      present.push(character.key);
      break;
    }
  }
  return present;
}

function resolvePanelCharacters(
  frame: StoryboardFramePlan,
  action: string,
  visualFocus: string[],
  characters: SceneCharacter[]
): string[] {
  const byName = new Map<string, string>();
  for (const c of characters) {
    byName.set(c.displayName.normalize('NFC').toLowerCase(), c.key);
    if (c.imageName) byName.set(c.imageName.normalize('NFC').toLowerCase(), c.key);
  }
  // Primary path: composer supplied explicit presence by name (display or
  // English image name — composer descriptions increasingly use the latter).
  if (Array.isArray(frame.charactersPresent) && frame.charactersPresent.length > 0) {
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const raw of frame.charactersPresent) {
      const name = sanitizeText(raw, 80).normalize('NFC').toLowerCase();
      const key = byName.get(name);
      if (key && !seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
    // The composer named characters but none resolved to a known name (e.g. a
    // transliteration mismatch) — fall back to text derivation rather than
    // silently returning an empty panel.
    if (keys.length > 0) return keys;
  }
  // Fallback: derive from free text.
  const haystack = [action, ...visualFocus].join(' ');
  return deriveCharactersPresent(haystack, characters);
}

// --- Scene builder --------------------------------------------------------

export interface BuildCanonicalSceneInput {
  storyboardPlan?: StoryboardPlan | null;
  storyboardPromptText?: string | null;
  continuityNotes?: string[] | null;
  characters: Character[];
  visualStyle: string;
  aspectRatio: StoryAspectRatio;
  worldAnchor?: string | null;
  regeneration?: BeatImageRegenerationOptions | null;
}

function buildUserDirectives(
  regeneration: BeatImageRegenerationOptions | null | undefined
): SceneUserDirectives | undefined {
  if (!regeneration) return undefined;
  const overall = sanitizeText(regeneration.overallSuggestion, SCENE_LIMITS.userDirective);
  const perPanel: Partial<Record<PanelPosition, string>> = {};
  let hasPanel = false;
  for (const panelKey of Object.keys(POSITION_BY_PANEL_KEY) as StoryboardPanelKey[]) {
    const suggestion = sanitizeText(regeneration.panelSuggestions?.[panelKey], SCENE_LIMITS.userDirective);
    if (suggestion) {
      perPanel[POSITION_BY_PANEL_KEY[panelKey]] = suggestion;
      hasPanel = true;
    }
  }
  if (!overall && !hasPanel) {
    // Mode alone still matters for regeneration wording.
    return { mode: regeneration.mode };
  }
  return {
    mode: regeneration.mode,
    ...(overall ? { overall } : {}),
    ...(hasPanel ? { perPanel } : {}),
  };
}

const LAYOUT: CanonicalImageScene['layout'] = {
  type: 'grid',
  columns: 2,
  rows: 2,
  panelCount: 4,
  fullBleed: true,
  divider: 'thin near-black',
};

// clothing is always overridden per scene by deriveClothingContinuity below --
// this base value is never observed as-is.
const CONTINUITY: CanonicalImageScene['continuity'] = {
  characterIdentity: 'strict',
  clothing: 'scene',
  world: 'strict',
  sequentialMoments: true,
  notes: [],
};

/** 'scene' (clothing holds within the scene) for continuous/same_session/no-
 * transition-info; 'evolve' (reassess it) for every other transition,
 * including a big jump -- Unit 5 hard constraint: this is no longer the
 * constant 'strict'. */
function deriveClothingContinuity(timeRelation: StoryTimeRelation | undefined): 'scene' | 'evolve' {
  const relation = timeRelation ?? 'unknown';
  return relation === 'continuous' || relation === 'same_session' || relation === 'unknown' ? 'scene' : 'evolve';
}

/** Split a multi-axis style block (one directional axis per line, e.g. the
 * Rendering/Emotional atmosphere/Color and light/Scene richness/Scope
 * boundary profile) into sanitized, non-empty lines bounded to the total
 * style budget. Each line is kept in full — never the old first-clause cut. */
function buildStyleAxes(raw: string | undefined | null): { visualStyle: string; axes: string[] } {
  const source = raw || '';
  const lines = source
    .split('\n')
    .map((line) => sanitizeText(line, SCENE_LIMITS.style))
    .filter(Boolean);
  const axes: string[] = [];
  let used = 0;
  for (const line of lines) {
    const projected = used + (axes.length > 0 ? 1 : 0) + line.length;
    if (projected > SCENE_LIMITS.style) break;
    axes.push(line);
    used = projected;
  }
  return { visualStyle: sanitizeText(source, SCENE_LIMITS.style), axes };
}

function buildScenePanel(
  position: PanelPosition,
  frame: StoryboardFramePlan,
  characters: SceneCharacter[],
  ignore: string[]
): ScenePanel {
  // The action is kept even when the source text is not English — see the
  // ScenePanel.action doc comment. Every other per-panel field is dropped or
  // blanked when non-English.
  const action = sanitizeText(frame.description, SCENE_LIMITS.action);
  const visualFocus = sanitizeEnglishList(
    frame.visualFocus,
    ignore,
    SCENE_LIMITS.visualFocusItems,
    SCENE_LIMITS.visualFocusItem
  );
  const appearanceChanges = sanitizeEnglishList(
    frame.appearanceChanges,
    ignore,
    SCENE_LIMITS.appearanceChangeItems,
    SCENE_LIMITS.appearanceChangeItem
  );
  const emotion = sanitizeEnglishText(frame.emotion, ignore, SCENE_LIMITS.emotion);
  const shot = isEnglishText(frame.cameraAngle || '', { ignore })
    ? normalizeCameraField(frame.cameraAngle, SCENE_LIMITS.shot)
    : '';
  const shotScale = isEnglishText(frame.shotScale || '', { ignore })
    ? normalizeCameraField(frame.shotScale, SCENE_LIMITS.shotScale)
    : '';
  const cameraHeight = isEnglishText(frame.cameraHeight || '', { ignore })
    ? normalizeCameraField(frame.cameraHeight, SCENE_LIMITS.cameraHeight)
    : '';
  const continuityAnchor = frame.continuityAnchor
    ? sanitizeEnglishText(frame.continuityAnchor, ignore, SCENE_LIMITS.continuityAnchor)
    : '';

  return {
    position,
    shot,
    action,
    emotion,
    visualFocus,
    charactersPresent: resolvePanelCharacters(frame, action, visualFocus, characters),
    ...(continuityAnchor ? { continuityAnchor } : {}),
    ...(frame.storyFunction ? { storyFunction: frame.storyFunction } : {}),
    ...(frame.timeRelationToPreviousPanel ? { timeRelationToPreviousPanel: frame.timeRelationToPreviousPanel } : {}),
    appearanceChanges,
    shotScale,
    cameraHeight,
    visualEcho: frame.visualEcho === true,
  };
}

export function buildCanonicalImageScene(input: BuildCanonicalSceneInput): CanonicalImageScene {
  const aspectRatio: StoryAspectRatio = input.aspectRatio === '9:16' ? '9:16' : '16:9';
  // Unit 5: reconcile the plan against its own transition (age locks, must-
  // not-inherit, prior-state notes, camera repetition) before anything below
  // reads from it, so every downstream field -- characters' modes,
  // mustNotInherit, the continuity notes list -- already reflects the
  // resolution. No-op (and no warnings) when there's no plan to resolve.
  const continuityResolution = input.storyboardPlan
    ? resolveContinuityContradictions(input.storyboardPlan, { continuityNotes: input.continuityNotes ?? undefined })
    : null;
  const plan = continuityResolution ? continuityResolution.plan : input.storyboardPlan;
  const effectiveContinuityNotes = continuityResolution ? continuityResolution.continuityNotes : input.continuityNotes;
  // Canonical character names, used to let a character's own name (any
  // script) appear inside an otherwise-English string without failing the
  // English check (see language.shared.ts IsEnglishTextOptions.ignore).
  const ignore = (input.characters || []).map((c) => c.name).filter(Boolean);
  const characters = buildSceneCharacters(input.characters || [], plan, ignore);
  const worldAnchor = sanitizeText(input.worldAnchor, SCENE_LIMITS.worldAnchor);
  const notes = sanitizeEnglishList(effectiveContinuityNotes, ignore, SCENE_LIMITS.continuityNotes, SCENE_LIMITS.continuityNote);
  const userDirectives = buildUserDirectives(input.regeneration);
  const style = buildStyleAxes(input.visualStyle);
  const clothing = deriveClothingContinuity(plan?.transition?.timeRelation);

  const base: Omit<
    CanonicalImageScene,
    'panels' | 'world' | 'mustNotInherit' | 'negativeConstraints' | 'provenance' | 'legacyText' | 'transition' | 'setting'
  > = {
    schemaVersion: SCENE_SCHEMA_VERSION,
    imageType: 'storyboard',
    taskKey: 'image_generation',
    aspectRatio,
    layout: LAYOUT,
    style,
    characters,
    continuity: { ...CONTINUITY, clothing, notes },
    ...(userDirectives ? { userDirectives } : {}),
  };

  if (!plan) {
    // Legacy conversion path: no structured plan available. Carry the rendered
    // scene brief verbatim so the compiler can still dedup the wrapper layers.
    return {
      ...base,
      world: { ...(worldAnchor ? { anchor: worldAnchor } : {}), invariants: [] },
      panels: [],
      mustNotInherit: [],
      negativeConstraints: sanitizeList(
        BASELINE_NEGATIVE_CONSTRAINTS as string[],
        SCENE_LIMITS.negativeConstraints,
        SCENE_LIMITS.negativeConstraint
      ),
      provenance: { source: 'legacy_text', builderVersion: SCENE_BUILDER_VERSION },
      legacyText: sanitizeText(input.storyboardPromptText, 4000),
    };
  }

  const invariants = sanitizeEnglishList(
    plan.sharedVisualInvariants,
    ignore,
    SCENE_LIMITS.worldInvariants,
    SCENE_LIMITS.worldInvariant
  );

  const panels: ScenePanel[] = PANEL_POSITIONS.map((position) => {
    const frame = plan[FRAME_KEY_BY_POSITION[position]];
    return buildScenePanel(position, frame, characters, ignore);
  });

  const englishNegatives = (plan.negativeConstraints || []).filter((item) => isEnglishText(item, { ignore }));
  const negativeConstraints = sanitizeList(
    [...englishNegatives, ...BASELINE_NEGATIVE_CONSTRAINTS],
    SCENE_LIMITS.negativeConstraints,
    SCENE_LIMITS.negativeConstraint
  );

  const mustNotInherit = sanitizeEnglishList(
    plan.mustNotInherit,
    ignore,
    SCENE_LIMITS.mustNotInheritItems,
    SCENE_LIMITS.mustNotInheritItem
  );

  const transition = plan.transition
    ? {
        timeRelation: plan.transition.timeRelation,
        locationRelation: plan.transition.locationRelation,
        evidence: sanitizeEnglishText(plan.transition.evidence, ignore, SCENE_LIMITS.transitionEvidence),
      }
    : undefined;

  const setting = plan.setting
    ? {
        location: sanitizeEnglishText(plan.setting.location, ignore, SCENE_LIMITS.settingField),
        timeOfDay: sanitizeEnglishText(plan.setting.timeOfDay, ignore, SCENE_LIMITS.settingField),
        era: sanitizeEnglishText(plan.setting.era, ignore, SCENE_LIMITS.settingField),
      }
    : undefined;

  return {
    ...base,
    world: { ...(worldAnchor ? { anchor: worldAnchor } : {}), invariants },
    panels,
    mustNotInherit,
    negativeConstraints,
    ...(transition ? { transition } : {}),
    ...(setting ? { setting } : {}),
    ...(continuityResolution && continuityResolution.warnings.length > 0
      ? { planWarnings: continuityResolution.warnings }
      : {}),
    provenance: { source: 'storyboard_plan', builderVersion: SCENE_BUILDER_VERSION },
  };
}

// --- Validation -----------------------------------------------------------

export interface SceneValidationResult {
  ok: boolean;
  errors: string[];
}

function hasControlChars(value: string): boolean {
  // Built from a string, not a regex literal -- a literal escape here writes real
  // control bytes into this file and git then treats it as binary.
  return new RegExp('[\\u0000-\\u001F\\u007F]').test(value);
}

/** Runtime validation. Accepts unknown; unknown schema versions fail safely. */
export function validateCanonicalImageScene(scene: unknown): SceneValidationResult {
  const errors: string[] = [];
  if (!scene || typeof scene !== 'object') {
    return { ok: false, errors: ['scene is not an object'] };
  }
  const s = scene as Partial<CanonicalImageScene>;

  if (s.schemaVersion !== SCENE_SCHEMA_VERSION) {
    errors.push(`unsupported schemaVersion: ${String(s.schemaVersion)}`);
    // Unknown schema versions fail fast — do not attempt deeper checks.
    return { ok: false, errors };
  }
  if (s.imageType !== 'storyboard') errors.push('imageType must be "storyboard"');
  if (s.taskKey !== 'image_generation') errors.push('taskKey must be "image_generation"');
  if (s.aspectRatio !== '16:9' && s.aspectRatio !== '9:16') errors.push('aspectRatio must be 16:9 or 9:16');

  if (!s.layout || s.layout.panelCount !== 4) errors.push('layout.panelCount must be 4');

  const source = s.provenance?.source;
  if (source !== 'storyboard_plan' && source !== 'legacy_text') {
    errors.push('provenance.source must be storyboard_plan or legacy_text');
  }

  const characterKeys = new Set((s.characters || []).map((c) => c.key));
  for (const character of s.characters || []) {
    if (!character.key) errors.push('character key is empty');
    if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(character.key)) {
      errors.push(`character key looks like a uuid: ${character.key}`);
    }
    if (character.visualIdentity && hasControlChars(character.visualIdentity)) {
      errors.push(`character ${character.key} visualIdentity has control chars`);
    }
  }

  if (source === 'legacy_text') {
    if (!s.legacyText || !s.legacyText.trim()) errors.push('legacy_text scene missing legacyText');
  } else if (source === 'storyboard_plan') {
    const panels = s.panels || [];
    if (panels.length !== 4) errors.push(`expected 4 panels, got ${panels.length}`);
    const positions = new Set<string>();
    for (const panel of panels) {
      if (positions.has(panel.position)) errors.push(`duplicate panel position: ${panel.position}`);
      positions.add(panel.position);
      if (!PANEL_POSITIONS.includes(panel.position)) errors.push(`invalid panel position: ${panel.position}`);
      if (!panel.action || !panel.action.trim()) errors.push(`panel ${panel.position} has empty action`);
      if (panel.action && panel.action.length > SCENE_LIMITS.action) {
        errors.push(`panel ${panel.position} action exceeds length cap`);
      }
      for (const key of panel.charactersPresent || []) {
        if (!characterKeys.has(key)) errors.push(`panel ${panel.position} references unknown character ${key}`);
      }
    }
    for (const position of PANEL_POSITIONS) {
      if (!positions.has(position)) errors.push(`missing panel position: ${position}`);
    }
  }

  return { ok: errors.length === 0, errors };
}
