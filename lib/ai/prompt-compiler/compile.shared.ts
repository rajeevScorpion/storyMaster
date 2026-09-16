// Provider-neutral image prompt compiler (v2). Turns a CanonicalImageScene
// into a compact, deterministic, English, sectioned prompt with a fixed
// section order, model-aware budgeting (target + hard cap) and a lossless-
// first, then lossy, compression pipeline. Pure and isomorphic. Same scene +
// capability + reservedChars always produces byte-identical output.
//
// Section order (framework §27, adapted — docs/visual-composer-continuity-
// framework.md):
//   FORMAT  STYLE  SETTING AND TIME  CHARACTERS  PANELS  CONTINUITY
//   USER DIRECTIVES  AVOID

import type { StoryAspectRatio, StoryLocationRelation, StoryTimeRelation } from '@/lib/types/story';
import {
  type CanonicalImageScene,
  type ScenePanel,
  type DiagnosticItem,
  type PanelPosition,
  findWholeName,
  sanitizeText,
} from './scene-spec.shared';
import { filterAndDedupScene, phraseKey, NEGATIVE_BUCKET_LABELS } from './relevance.shared';
import { isEnglishText } from './language.shared';
import { PROMPT_HARD_MAX_CHARS, type PromptCompilerCapability, type PromptCompilerAdapterVersion } from './capability.shared';

export const COMPILER_VERSION = 'compiler-v2';

/** 0 = full render fit the target untouched; 1 = lossless passes reached the
 * target; 2 = over target but within the hard cap (accepted); 3 = over the
 * hard cap, lossy trimming (and possibly a final hard cut) was required. Kept
 * on the `compressionLevel` field name so the admin comparison column (which
 * reads that field) keeps meaning. */
export type CompressionLevel = 0 | 1 | 2 | 3;

export interface CompiledImagePrompt {
  compilerVersion: string;
  adapterVersion: PromptCompilerAdapterVersion;
  sections: {
    format: string;
    style: string;
    settingAndTime: string;
    characters: string;
    panels: string[];
    continuity: string;
    userDirectives?: string;
    negatives: string;
  };
  fullPrompt: string;
  characterCount: number;
  compressionLevel: CompressionLevel;
  budget: { targetChars: number; hardMaxChars: number; reservedChars: number; tier: CompressionLevel };
  removedInformation: DiagnosticItem[];
  compressionActions: DiagnosticItem[];
  warnings: string[];
}

export interface CompileImagePromptOptions {
  /** Characters already spent on reference-image binding lines (Unit 4b),
   * subtracted from both the target and the hard cap before compiling. */
  reservedChars?: number;
}

// --- Small text helpers ---------------------------------------------------

function capitalizeFirst(value: string): string {
  return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function joinNames(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const POSITION_LABEL: Record<PanelPosition, string> = {
  'top-left': 'Top-left',
  'top-right': 'Top-right',
  'bottom-left': 'Bottom-left',
  'bottom-right': 'Bottom-right',
};

// --- Redaction ------------------------------------------------------------

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const R2_RE = /\br2:\/\/\S+/gi;
const URL_RE = /\bhttps?:\/\/\S+/gi;
const STORAGE_KEY_RE = /\b(?:internal|storage|media)[-_/][A-Za-z0-9_\-/.]+/gi;
// Strip control characters EXCEPT \n (U+000A): the compiled prompt's section
// headings and blank-line separators depend on real newlines surviving this
// pass (CLAUDE.md: "human-readable... sections separated by line breaks, not
// one block"). \r is still stripped so a stray \r\n never doubles a line break.
// Built from a string, not a regex literal: writing the escapes literally puts real
// control bytes in this file, which makes git treat it as binary and undiffable.
// The line-feed code point is deliberately outside the class: newlines are the
// section breaks in the compiled prompt.
const CONTROL_RE = new RegExp('[\\u0000-\\u0009\\u000B-\\u001F\\u007F]', 'g');

/** Scrub anything that could leak internal ids/urls; returns hits found. */
function redact(text: string): { text: string; hits: string[] } {
  const hits: string[] = [];
  let out = text;
  const scrub = (re: RegExp, label: string) => {
    if (re.test(out)) hits.push(label);
    re.lastIndex = 0;
    out = out.replace(re, '');
  };
  scrub(UUID_RE, 'uuid');
  scrub(R2_RE, 'r2-reference');
  scrub(URL_RE, 'url');
  scrub(STORAGE_KEY_RE, 'storage-key');
  out = out.replace(CONTROL_RE, ' ');
  // Collapse any double spaces the scrub introduced (per line).
  out = out
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').replace(/\s+$/g, ''))
    .join('\n');
  return { text: out, hits };
}

/** Cut `text` to at most `maxLength` characters at the last blank-line,
 * newline or space boundary at/before the cut point — never mid-word, and
 * never touching whitespace collapse (unlike sanitizeText) since this runs on
 * the fully assembled, multi-section prompt where blank lines are section
 * separators that must be preserved up to the cut. */
function cutAtBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  const candidates = [slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'), slice.lastIndexOf(' ')].filter(
    (i) => i >= 0
  );
  if (candidates.length === 0) return slice;
  const cut = Math.max(...candidates);
  return slice.slice(0, cut).trimEnd();
}

// --- STYLE ------------------------------------------------------------

const SHORTENED_SCOPE_LINE =
  'Scope boundary: style applies only to story-grounded content; add nothing just to express it.';

function renderStyle(scene: CanonicalImageScene): string {
  const axes = scene.style.axes.length > 0 ? scene.style.axes : scene.style.visualStyle ? [scene.style.visualStyle] : [];
  if (axes.length === 0) return '';
  return axes.map((line) => ensureSentence(line)).join('\n');
}

// --- SETTING AND TIME -------------------------------------------------

// Base clause (no trailing period) for each transition time relation, so it
// can be combined with a location clause before the sentence is closed.
const TIME_RELATION_BASE: Record<StoryTimeRelation, string> = {
  continuous: 'This moment continues directly from the previous scene',
  same_session: 'This scene follows shortly after the previous one, in the same session',
  hours_later: 'A few hours after the previous scene',
  next_day: 'The next day',
  days_weeks_later: 'Days or weeks after the previous scene',
  months_later: 'Months after the previous scene',
  years_later: 'Years after the previous scene',
  flashback: 'This is a flashback to an earlier time',
  memory: 'This is a remembered moment',
  dream: 'This is a dream sequence',
  unknown: '',
};

const LOCATION_RELATION_PHRASE: Record<StoryLocationRelation, string> = {
  same_exact: '',
  same_building_different_area: 'in a different area of the same place',
  same_category_different_location: 'in a similar but different location',
  new_location: 'in a new location',
  unknown: '',
};

function renderTransitionSentence(transition: CanonicalImageScene['transition']): string {
  if (!transition) return '';
  const timeBase = TIME_RELATION_BASE[transition.timeRelation] || '';
  const locationPhrase = LOCATION_RELATION_PHRASE[transition.locationRelation] || '';
  if (!timeBase && !locationPhrase) return '';
  if (!timeBase) return ensureSentence(capitalizeFirst(locationPhrase));
  if (!locationPhrase) return ensureSentence(timeBase);
  return ensureSentence(`${timeBase}, ${locationPhrase}`);
}

function renderSettingAndTime(scene: CanonicalImageScene): string {
  const lines: string[] = [];
  const setting = scene.setting;
  if (setting) {
    const parts: string[] = [];
    if (setting.location) parts.push(`Location: ${ensureSentence(setting.location)}`);
    if (setting.timeOfDay && setting.timeOfDay.toLowerCase() !== 'unknown') {
      parts.push(`Time of day: ${ensureSentence(setting.timeOfDay)}`);
    }
    if (setting.era && setting.era.toLowerCase() !== 'unknown') parts.push(`Era: ${ensureSentence(setting.era)}`);
    if (parts.length > 0) lines.push(parts.join(' '));
  }

  const transitionSentence = renderTransitionSentence(scene.transition);
  if (transitionSentence) lines.push(transitionSentence);

  if (scene.world.invariants.length > 0) {
    lines.push(scene.world.invariants.map(ensureSentence).join(' '));
  }
  if (scene.world.anchor) {
    lines.push(`World reference (story style wins): ${ensureSentence(scene.world.anchor)}`);
  }
  return lines.join('\n');
}

// --- CHARACTERS ---------------------------------------------------------

function renderCharacters(scene: CanonicalImageScene): string {
  if (scene.characters.length === 0) return '';
  const lines = scene.characters.map((c) => {
    const bits: string[] = [];
    if (c.identityAnchors) bits.push(`Identity: ${ensureSentence(c.identityAnchors)}`);
    if (c.currentAppearance) bits.push(`Current appearance: ${ensureSentence(c.currentAppearance)}`);
    if (bits.length > 0) return `- ${c.imageName} — ${bits.join(' ')}`;
    if (c.visualIdentity) return `- ${c.imageName} — ${ensureSentence(c.visualIdentity)}`;
    return `- ${c.imageName}.`;
  });
  const anyReference = scene.characters.some((c) => c.hasReference);
  const referenceNote = anyReference
    ? '\nReference images define identity only — face, skin tone, build and distinguishing features. Hair, clothing, age, pose, setting and camera come from this prompt. Render in the story’s style. Show each named character at most once per panel.'
    : '';
  return `${lines.join('\n')}${referenceNote}`;
}

// --- PANELS ---------------------------------------------------------------

// Short clause for a within-beat panel-to-panel time jump. continuous/
// same_session/unknown produce no line (no jump worth flagging).
const PANEL_TIME_LINE: Partial<Record<StoryTimeRelation, string>> = {
  hours_later: 'Time: a few hours after the previous panel.',
  next_day: 'Time: the next day, after the previous panel.',
  days_weeks_later: 'Time: days or weeks after the previous panel.',
  months_later: 'Time: months after the previous panel.',
  years_later: 'Time: years after the previous panel.',
  flashback: 'Time: a flashback relative to the previous panel.',
  memory: 'Time: a remembered moment relative to the previous panel.',
  dream: 'Time: a dream relative to the previous panel.',
};

function isPanelTimeJump(relation: StoryTimeRelation | undefined): boolean {
  return Boolean(relation && relation !== 'unknown' && relation !== 'continuous' && relation !== 'same_session');
}

interface CharacterNameLookup {
  display: string;
  image: string;
}

function renderPanel(
  panel: ScenePanel,
  keyToNames: Map<string, CharacterNameLookup>,
  recurringKeys: Set<string>
): string {
  const label = POSITION_LABEL[panel.position];
  const parts: string[] = [ensureSentence(panel.storyFunction ? `${label} — ${panel.storyFunction}` : label)];

  const cameraBits: string[] = [];
  if (panel.shotScale) cameraBits.push(panel.shotScale);
  if (panel.cameraHeight) cameraBits.push(panel.cameraHeight);
  if (panel.shot) {
    const shotScaleAlreadyPresent = panel.shotScale && panel.shot.toLowerCase().includes(panel.shotScale.toLowerCase());
    if (!shotScaleAlreadyPresent) cameraBits.push(panel.shot);
  }
  if (cameraBits.length > 0) parts.push(`Camera: ${cameraBits.join(', ')}.`);

  if (panel.action) parts.push(ensureSentence(panel.action));
  if (panel.emotion) parts.push(`Emotion: ${ensureSentence(capitalizeFirst(panel.emotion))}`);
  if (panel.visualFocus.length > 0) parts.push(`Focus: ${panel.visualFocus.join(', ')}.`);

  // Explicit absence only for strongly recurring characters missing here —
  // this prevents the model from cloning them in, without noising every
  // panel. Skip any character the action already names.
  const presentSet = new Set(panel.charactersPresent);
  const absentNames = [...recurringKeys]
    .filter((key) => !presentSet.has(key))
    .map((key) => keyToNames.get(key))
    .filter((n): n is CharacterNameLookup => Boolean(n))
    .filter((n) => findWholeName(panel.action, n.display) === -1 && findWholeName(panel.action, n.image) === -1)
    .map((n) => n.image);
  if (absentNames.length > 0) {
    parts.push(`${joinNames(absentNames)} ${absentNames.length === 1 ? 'is' : 'are'} absent.`);
  }

  if (panel.appearanceChanges.length > 0) {
    parts.push(ensureSentence(panel.appearanceChanges.join('; ')));
  }

  const timeLine = panel.timeRelationToPreviousPanel && PANEL_TIME_LINE[panel.timeRelationToPreviousPanel];
  if (timeLine) parts.push(timeLine);

  return parts.join(' ');
}

function renderPanels(scene: CanonicalImageScene): string[] {
  const keyToNames = new Map<string, CharacterNameLookup>(
    scene.characters.map((c) => [c.key, { display: c.displayName, image: c.imageName }])
  );
  // Recurring = present in at least two panels (at real risk of being cloned).
  const counts = new Map<string, number>();
  for (const panel of scene.panels) {
    for (const key of panel.charactersPresent) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const recurringKeys = new Set([...counts.entries()].filter(([, n]) => n >= 2).map(([k]) => k));
  return scene.panels.map((panel) => renderPanel(panel, keyToNames, recurringKeys));
}

// --- CONTINUITY -------------------------------------------------------

const CONTINUOUS_SENTENCE =
  'Keep one story world and four sequential moments; within this continuous scene keep identity, clothing, active props and physical state consistent.';
const RECOGNIZABLE_SENTENCE =
  'Identities stay recognizable; clothing, lighting and staging may change for the new time.';
const REASSESS_SENTENCE =
  'Identities stay recognizable; reassess age, hair, clothing and setting for this point in the story instead of copying the previous scene.';

const SHORT_GAP_RELATIONS: ReadonlySet<StoryTimeRelation> = new Set(['hours_later', 'next_day']);
const LONG_GAP_RELATIONS: ReadonlySet<StoryTimeRelation> = new Set([
  'days_weeks_later',
  'months_later',
  'years_later',
  'flashback',
  'memory',
  'dream',
]);

function continuitySentence(scene: CanonicalImageScene): string {
  const timeRelation = scene.transition?.timeRelation ?? 'unknown';
  const hasPanelJump = scene.panels.some((p) => isPanelTimeJump(p.timeRelationToPreviousPanel));
  if (LONG_GAP_RELATIONS.has(timeRelation) || hasPanelJump) return REASSESS_SENTENCE;
  if (SHORT_GAP_RELATIONS.has(timeRelation)) return RECOGNIZABLE_SENTENCE;
  return CONTINUOUS_SENTENCE;
}

function renderContinuity(scene: CanonicalImageScene): string {
  const parts: string[] = [continuitySentence(scene)];
  const hasPanelJump = scene.panels.some((p) => isPanelTimeJump(p.timeRelationToPreviousPanel));
  if (hasPanelJump) parts.push('Appearance may change between panels where noted.');
  if (scene.continuity.notes.length > 0) parts.push(scene.continuity.notes.map(ensureSentence).join(' '));
  if (scene.mustNotInherit.length > 0) parts.push(`Do not carry over: ${scene.mustNotInherit.join('; ')}.`);
  return parts.join(' ');
}

// --- USER DIRECTIVES --------------------------------------------------

function renderUserDirectives(scene: CanonicalImageScene): string | undefined {
  const directives = scene.userDirectives;
  if (!directives) return undefined;
  const lines: string[] = [
    'Visual changes only — do not alter the layout, panel count, character identity, or story events.',
    directives.mode === 'reimagine'
      ? 'Reimagine the visual treatment while preserving the same story event, characters and panel count.'
      : 'Refine the existing composition while keeping the scene, characters and panel logic close to the current version.',
  ];
  if (directives.overall) lines.push(`Overall: ${ensureSentence(directives.overall)}`);
  if (directives.perPanel) {
    for (const position of Object.keys(directives.perPanel) as PanelPosition[]) {
      const text = directives.perPanel[position];
      if (text) lines.push(`${POSITION_LABEL[position]}: ${ensureSentence(text)}`);
    }
  }
  return lines.join('\n');
}

// --- AVOID ------------------------------------------------------------

function renderNegatives(negatives: string[], adapterVersion: PromptCompilerAdapterVersion): string {
  if (negatives.length === 0) return '';
  if (adapterVersion === 'neutral-v1') {
    return negatives.map((n) => `- ${n}`).join('\n');
  }
  // gemini-v1: no separate negative channel — one compact avoid sentence.
  return `${negatives.join('; ')}.`;
}

// --- Assembly ---------------------------------------------------------

interface RenderedSections {
  format: string;
  style: string;
  settingAndTime: string;
  characters: string;
  panels: string[];
  continuity: string;
  userDirectives?: string;
  negatives: string;
}

function renderFormat(aspectRatio: StoryAspectRatio): string {
  const orientation = aspectRatio === '9:16' ? '9:16 vertical' : '16:9';
  return (
    `Create one full-bleed ${orientation} image containing exactly four equal panels in a 2x2 grid, ` +
    'read in order top-left, top-right, bottom-left, bottom-right. Use thin near-black dividers only; ' +
    'every quadrant fills its space edge-to-edge with no outer border, padding, matting or pale gutters.'
  );
}

function renderSections(scene: CanonicalImageScene, adapterVersion: PromptCompilerAdapterVersion): RenderedSections {
  return {
    format: renderFormat(scene.aspectRatio),
    style: renderStyle(scene),
    settingAndTime: renderSettingAndTime(scene),
    characters: renderCharacters(scene),
    panels: renderPanels(scene),
    continuity: renderContinuity(scene),
    userDirectives: renderUserDirectives(scene),
    negatives: renderNegatives(scene.negativeConstraints, adapterVersion),
  };
}

/**
 * Replace every occurrence of a character's non-English display name with
 * that character's `imageName` (framework: the compiled prompt is English-
 * only). A raw non-Latin name can still reach an assembled string two ways:
 * the panel action, which is kept verbatim even when non-English (see
 * ScenePanel.action), and an "English" sentence that only passed the
 * isEnglishText gate because language.shared's `ignore` option carved the
 * name out before judging the rest. A no-op for a character whose
 * `imageName` already equals its `displayName`. Operates on the NFC form
 * `findWholeName` itself normalizes to, so the returned index and the
 * normalized name's length agree.
 */
function substituteImageNames(text: string, characters: CanonicalImageScene['characters']): string {
  let out = text.normalize('NFC');
  for (const character of characters) {
    const displayName = character.displayName.trim();
    const imageName = character.imageName.trim();
    if (!displayName || !imageName || displayName === imageName) continue;
    const normName = displayName.normalize('NFC');
    let idx = findWholeName(out, displayName);
    let guard = 0;
    while (idx !== -1 && guard < 50) {
      out = out.slice(0, idx) + imageName + out.slice(idx + normName.length);
      idx = findWholeName(out, displayName);
      guard += 1;
    }
  }
  return out;
}

function assembleFullPrompt(sections: RenderedSections, characters: CanonicalImageScene['characters']): string {
  const blocks: string[] = [];
  const push = (heading: string, body: string) => {
    if (body) blocks.push(`${heading}\n${body}`);
  };
  push('FORMAT', sections.format);
  push('STYLE', sections.style);
  push('SETTING AND TIME', sections.settingAndTime);
  push('CHARACTERS', sections.characters);
  if (sections.panels.length > 0) push('PANELS', sections.panels.join('\n'));
  push('CONTINUITY', sections.continuity);
  if (sections.userDirectives) push('USER DIRECTIVES', sections.userDirectives);
  push('AVOID', sections.negatives);
  return substituteImageNames(blocks.join('\n\n'), characters);
}

// --- Lossless compression passes (never drop story-affecting content) -----
//
// Applied in order, re-measuring after each, stopping as soon as the target
// is met. Each pass returns a new scene (working copies only — the input
// scene passed to compileImagePrompt is never mutated).

type ScenePass = (scene: CanonicalImageScene) => CanonicalImageScene;

/** Drop visual-focus items the panel's own action already names. */
const passDropFocusInAction: ScenePass = (scene) => ({
  ...scene,
  panels: scene.panels.map((p) => ({
    ...p,
    visualFocus: p.visualFocus.filter((item) => !p.action.toLowerCase().includes(item.toLowerCase())),
  })),
});

/** Drop a per-panel continuity anchor that just repeats a world invariant
 * (same synonym-folded phraseKey, or literally contained in one). */
const passDropRedundantAnchors: ScenePass = (scene) => {
  const invariantKeys = new Set(scene.world.invariants.map(phraseKey));
  return {
    ...scene,
    panels: scene.panels.map((p) => {
      if (!p.continuityAnchor) return p;
      const key = phraseKey(p.continuityAnchor);
      const anchorLower = p.continuityAnchor.toLowerCase();
      const redundant =
        (key !== '' && invariantKeys.has(key)) ||
        scene.world.invariants.some((inv) => inv.toLowerCase().includes(anchorLower));
      if (!redundant) return p;
      const { continuityAnchor: _drop, ...rest } = p;
      return rest as ScenePanel;
    }),
  };
};

/** Replace the "Scope boundary:" style axis with its shortened form. */
const passShortenScopeLine: ScenePass = (scene) => ({
  ...scene,
  style: {
    ...scene.style,
    axes: scene.style.axes.map((line) => (/^scope boundary:/i.test(line.trim()) ? SHORTENED_SCOPE_LINE : line)),
  },
});

/** Cap continuity notes to the transition-relevant count: at most one, none
 * when the transition is a long time jump or a location change. */
const passCapContinuityNotes: ScenePass = (scene) => {
  const timeRelation = scene.transition?.timeRelation ?? 'unknown';
  const locationRelation = scene.transition?.locationRelation ?? 'unknown';
  const dropAll =
    LONG_GAP_RELATIONS.has(timeRelation) ||
    locationRelation === 'new_location' ||
    locationRelation === 'same_category_different_location';
  return {
    ...scene,
    continuity: { ...scene.continuity, notes: dropAll ? [] : scene.continuity.notes.slice(0, 1) },
  };
};

/** Shorten negatives to the canonical bucket labels plus at most 4 other
 * (deterministic, already-sorted) items. */
const passCanonicalizeNegatives: ScenePass = (scene) => {
  const bucketLabels = scene.negativeConstraints.filter((n) => NEGATIVE_BUCKET_LABELS.has(n));
  const others = scene.negativeConstraints.filter((n) => !NEGATIVE_BUCKET_LABELS.has(n));
  return { ...scene, negativeConstraints: [...bucketLabels, ...others.slice(0, 4)] };
};

const LOSSLESS_PASSES: Array<{ id: string; detail: string; apply: ScenePass }> = [
  {
    id: 'lossless-drop-redundant-focus',
    detail: 'dropped visual-focus items already named in the panel action',
    apply: passDropFocusInAction,
  },
  {
    id: 'lossless-drop-redundant-anchors',
    detail: 'dropped per-panel continuity anchors repeating a world invariant',
    apply: passDropRedundantAnchors,
  },
  {
    id: 'lossless-shorten-scope-line',
    detail: 'shortened the style scope-boundary line',
    apply: passShortenScopeLine,
  },
  {
    id: 'lossless-cap-continuity-notes',
    detail: 'capped continuity notes to transition-relevant ones',
    apply: passCapContinuityNotes,
  },
  {
    id: 'lossless-canonicalize-negatives',
    detail: 'reduced negatives to canonical buckets plus a few specific items',
    apply: passCanonicalizeNegatives,
  },
];

// --- Lossy compression passes (tier 3 only, over the hard cap) ------------
//
// Never touched: FORMAT, character identity lines, absent lines, camera,
// the transition sentence, "Do not carry over", AVOID bucket labels.

type LossyPass = (scene: CanonicalImageScene, overBy: number) => CanonicalImageScene;

const passRemoveWorldAnchor: LossyPass = (scene) => {
  const { anchor: _drop, ...rest } = scene.world;
  return { ...scene, world: rest };
};

const passRemoveInvariants: LossyPass = (scene) => ({ ...scene, world: { ...scene.world, invariants: [] } });

const passRemoveEmotion: LossyPass = (scene) => ({
  ...scene,
  panels: scene.panels.map((p) => ({ ...p, emotion: '' })),
});

const passRemoveFocus: LossyPass = (scene) => ({
  ...scene,
  panels: scene.panels.map((p) => ({ ...p, visualFocus: [] })),
});

/** Trim every panel action proportionally at a word boundary, never below
 * 120 characters. */
const passTrimActions: LossyPass = (scene, overBy) => {
  const panelCount = Math.max(1, scene.panels.length);
  const perPanel = Math.max(1, Math.ceil(overBy / panelCount));
  return {
    ...scene,
    panels: scene.panels.map((p) => {
      const target = Math.max(120, p.action.length - perPanel);
      return { ...p, action: target < p.action.length ? sanitizeText(p.action, target) : p.action };
    }),
  };
};

const passTrimAppearanceChanges: LossyPass = (scene) => ({
  ...scene,
  panels: scene.panels.map((p) => ({ ...p, appearanceChanges: [] })),
});

const passRemoveContinuityNotes: LossyPass = (scene) => ({
  ...scene,
  continuity: { ...scene.continuity, notes: [] },
});

const LOSSY_STEPS: Array<{ id: string; detail: string; apply: LossyPass }> = [
  { id: 'lossy-remove-world-anchor', detail: 'removed the world reference anchor', apply: passRemoveWorldAnchor },
  { id: 'lossy-remove-invariants', detail: 'removed world invariants', apply: passRemoveInvariants },
  { id: 'lossy-remove-emotion', detail: 'removed per-panel emotion', apply: passRemoveEmotion },
  { id: 'lossy-remove-focus', detail: 'removed per-panel visual focus', apply: passRemoveFocus },
  { id: 'lossy-trim-actions', detail: 'trimmed panel actions proportionally', apply: passTrimActions },
  {
    id: 'lossy-trim-appearance-changes',
    detail: 'removed per-panel appearance changes',
    apply: passTrimAppearanceChanges,
  },
  { id: 'lossy-remove-continuity-notes', detail: 'removed continuity notes', apply: passRemoveContinuityNotes },
];

// --- Legacy conversion path -------------------------------------------

function compileLegacyScene(
  scene: CanonicalImageScene,
  capability: PromptCompilerCapability,
  target: number,
  hard: number,
  reserved: number
): CompiledImagePrompt {
  const format = renderFormat(scene.aspectRatio);
  const negatives = renderNegatives(scene.negativeConstraints, capability.adapterVersion);
  const brief = scene.legacyText ? `Scene brief:\n${scene.legacyText}` : '';
  const assembled = substituteImageNames([format, brief, negatives].filter(Boolean).join('\n\n'), scene.characters);
  const { text, hits } = redact(assembled);
  const warnings: string[] = [];
  if (hits.length > 0) warnings.push(`redacted ${hits.join(', ')} from prompt`);

  let fullPrompt = text;
  let tier: CompressionLevel = 0;
  if (fullPrompt.length > hard) {
    fullPrompt = cutAtBoundary(fullPrompt, hard);
    warnings.push('hard_cut');
    tier = 3;
  }
  if (!isEnglishText(fullPrompt)) warnings.push('non_english_prompt');

  return {
    compilerVersion: COMPILER_VERSION,
    adapterVersion: capability.adapterVersion,
    sections: { format, style: '', settingAndTime: brief, characters: '', panels: [], continuity: '', negatives },
    fullPrompt,
    characterCount: fullPrompt.length,
    compressionLevel: tier,
    budget: { targetChars: target, hardMaxChars: hard, reservedChars: reserved, tier },
    removedInformation: [],
    compressionActions: [],
    warnings,
  };
}

// --- Main entry ---------------------------------------------------------

export function compileImagePrompt(
  scene: CanonicalImageScene,
  capability: PromptCompilerCapability,
  options?: CompileImagePromptOptions
): CompiledImagePrompt {
  const reserved = Math.max(0, Math.floor(options?.reservedChars ?? 0));
  const sep = reserved > 0 ? 2 : 0;
  const target = Math.max(800, capability.promptBudgetChars - reserved - sep);
  const hard = Math.max(1000, PROMPT_HARD_MAX_CHARS - reserved - sep);

  if (scene.provenance.source === 'legacy_text') {
    return compileLegacyScene(scene, capability, target, hard, reserved);
  }

  const warnings: string[] = [];
  const { scene: baseScene, diagnostics } = filterAndDedupScene(scene);
  warnings.push(...diagnostics.warnings);

  const compressionActions: DiagnosticItem[] = [];
  let working = baseScene;
  let sections = renderSections(working, capability.adapterVersion);
  let assembled = assembleFullPrompt(sections, working.characters);
  let redacted = redact(assembled);
  let tier: CompressionLevel = 0;

  if (redacted.text.length > target) {
    tier = 1;
    for (const pass of LOSSLESS_PASSES) {
      working = pass.apply(working);
      sections = renderSections(working, capability.adapterVersion);
      assembled = assembleFullPrompt(sections, working.characters);
      redacted = redact(assembled);
      compressionActions.push({ field: 'prompt', reason: pass.id, detail: pass.detail });
      if (redacted.text.length <= target) break;
    }
  }

  if (redacted.text.length > target) {
    if (redacted.text.length <= hard) {
      tier = 2;
      warnings.push('over_target');
    } else {
      tier = 3;
      for (const step of LOSSY_STEPS) {
        if (redacted.text.length <= hard) break;
        const overBy = redacted.text.length - hard;
        working = step.apply(working, overBy);
        sections = renderSections(working, capability.adapterVersion);
        assembled = assembleFullPrompt(sections, working.characters);
        redacted = redact(assembled);
        compressionActions.push({ field: 'prompt', reason: step.id, detail: step.detail });
      }
      warnings.push('lossy_trim');
      if (redacted.text.length > hard) {
        redacted = { text: cutAtBoundary(redacted.text, hard), hits: redacted.hits };
        warnings.push('hard_cut');
      }
    }
  }

  if (redacted.hits.length > 0) warnings.push(`redacted ${redacted.hits.join(', ')} from prompt`);
  if (!isEnglishText(redacted.text)) warnings.push('non_english_prompt');

  return {
    compilerVersion: COMPILER_VERSION,
    adapterVersion: capability.adapterVersion,
    sections,
    fullPrompt: redacted.text,
    characterCount: redacted.text.length,
    compressionLevel: tier,
    budget: { targetChars: target, hardMaxChars: hard, reservedChars: reserved, tier },
    removedInformation: diagnostics.excluded,
    compressionActions,
    warnings,
  };
}
