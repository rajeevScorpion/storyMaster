// Visual relevance filter + semantic deduplication. Runs on a CanonicalImageScene
// (which already excludes non-visual fields at build time) and removes repeated
// visual concepts before natural-language compilation. Fully deterministic: no
// Date/random, stable ordering, no LLM. Conflicting concepts are never merged.

import {
  type CanonicalImageScene,
  type ScenePanel,
  type DiagnosticItem,
  type PanelPosition,
  SCENE_LIMITS,
  deriveCharactersPresent,
} from './scene-spec.shared';

export { deriveCharactersPresent };

export interface RelevanceDiagnostics {
  included: string[];
  excluded: DiagnosticItem[];
  converted: DiagnosticItem[];
  warnings: string[];
}

// --- Token normalization --------------------------------------------------

const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'and', 'or', 'with', 'in', 'on', 'at', 'to', 'is',
  'are', 'be', 'by', 'as', 'that', 'this', 'its', 'their', 'over', 'under',
]);

// Coarse synonym folding for common visual terms so near-duplicates share a key.
const SYNONYM_TOKENS: Record<string, string> = {
  sunlight: 'sunlit', sunny: 'sunlit', sunlit: 'sunlit',
  gold: 'golden', golden: 'golden',
  tones: 'tone', tone: 'tone', hues: 'tone', hue: 'tone',
  colours: 'color', colors: 'color', colour: 'color', color: 'color',
  balloon: 'bubble', balloons: 'bubble', bubbles: 'bubble', bubble: 'bubble',
  caption: 'caption', captions: 'caption',
  label: 'label', labels: 'label',
  logo: 'logo', logos: 'logo',
  watermark: 'watermark', watermarks: 'watermark',
  border: 'border', borders: 'border',
  gutter: 'gutter', gutters: 'gutter',
  panel: 'panel', panels: 'panel',
  character: 'character', characters: 'character',
  palette: 'tone',
};

function tokenize(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => SYNONYM_TOKENS[t] ?? t)
    .filter((t) => !STOPWORDS.has(t));
}

/** Order-independent, synonym-folded comparison key for a phrase. */
export function phraseKey(phrase: string): string {
  return Array.from(new Set(tokenize(phrase))).sort().join(' ');
}

// --- Conflict detection ---------------------------------------------------

// Axes of mutually exclusive meaning. Two phrases must never be merged if they
// disagree on any axis (e.g. red apple vs green apple, warm vs cold light).
const CONFLICT_AXES: Record<string, string[]> = {
  // Genuine object colors only. Warm-palette tones (golden/amber/gold) are
  // handled by the temperature axis so they are not treated as mutually
  // exclusive with each other.
  color: ['red', 'green', 'blue', 'purple', 'orange', 'pink', 'crimson', 'yellow'],
  temperature: ['warm', 'cool', 'cold', 'hot'],
  time: ['day', 'daylight', 'dawn', 'morning', 'noon', 'dusk', 'evening', 'night', 'moonlit', 'nocturnal'],
  brightness: ['bright', 'dark', 'dim', 'shadowy'],
  shot: ['wide', 'establishing', 'medium', 'close', 'closeup', 'macro'],
  emotion: ['smiling', 'happy', 'joyful', 'worried', 'sad', 'angry', 'fearful', 'calm', 'anxious'],
};

/** Returns the conflicting axis name, or null when the phrases don't conflict. */
export function detectPhraseConflict(a: string, b: string): string | null {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  for (const [axis, members] of Object.entries(CONFLICT_AXES)) {
    const inA = members.filter((m) => tokensA.has(m));
    const inB = members.filter((m) => tokensB.has(m));
    if (inA.length === 0 || inB.length === 0) continue;
    const shared = inA.some((m) => inB.includes(m));
    const differ = inA.some((m) => !inB.includes(m)) || inB.some((m) => !inA.includes(m));
    if (!shared && differ) return axis;
  }
  return null;
}

// --- Negative constraint canonicalization ---------------------------------

// Negatives are prohibitions, so it is safe to collapse whole families into one
// representative phrase. Each source term maps to a canonical bucket label.
const NEGATIVE_BUCKETS: Record<string, string> = {
  representativeText: 'text, captions, speech bubbles, subtitles, labels, logos or watermarks',
  representativeGutters: 'white or pale gutters, outer borders, padding or margins',
  representativePanels: 'extra or nested panels',
  representativeDuplicates: 'duplicated or cloned named characters',
  representativeModern: 'modern or anachronistic elements',
};

const NEGATIVE_TERM_TO_BUCKET: Record<string, keyof typeof NEGATIVE_BUCKETS> = {};
function mapNegativeTerms(terms: string[], bucket: keyof typeof NEGATIVE_BUCKETS) {
  for (const term of terms) NEGATIVE_TERM_TO_BUCKET[term] = bucket;
}
mapNegativeTerms(
  ['text', 'captions', 'caption', 'speech bubbles', 'speech bubble', 'speech balloons', 'subtitles', 'subtitle', 'labels', 'label', 'logos', 'logo', 'watermarks', 'watermark', 'text overlays', 'signatures'],
  'representativeText'
);
mapNegativeTerms(
  ['white or cream gutters', 'white gutters', 'cream gutters', 'pale gutters', 'gutters', 'outer borders', 'outer border', 'borders', 'page borders', 'padding', 'outer margins', 'margins', 'matting', 'empty areas'],
  'representativeGutters'
);
mapNegativeTerms(['extra panels', 'nested panels', 'extra or nested panels', 'additional panels', 'thick borders'], 'representativePanels');
mapNegativeTerms(['duplicated named characters', 'duplicate characters', 'duplicated characters', 'cloned characters', 'character clones', 'character redesign'], 'representativeDuplicates');
mapNegativeTerms(['modern elements', 'modern objects', 'anachronistic elements', 'modern clothing'], 'representativeModern');

export interface NegativeCanonicalResult {
  kept: string[];
  converted: DiagnosticItem[];
  excluded: DiagnosticItem[];
}

export function canonicalizeNegativeConstraints(list: string[]): NegativeCanonicalResult {
  const converted: DiagnosticItem[] = [];
  const excluded: DiagnosticItem[] = [];
  const bucketsSeen = new Set<string>();
  const keptSet = new Map<string, string>(); // phraseKey -> display

  for (const raw of list) {
    const term = raw.trim();
    if (!term) continue;
    const bucketKey = NEGATIVE_TERM_TO_BUCKET[term.toLowerCase()];
    if (bucketKey) {
      const label = NEGATIVE_BUCKETS[bucketKey];
      if (bucketsSeen.has(bucketKey)) {
        excluded.push({ field: 'negativeConstraints', reason: 'duplicate-family', detail: term });
      } else {
        bucketsSeen.add(bucketKey);
        keptSet.set(`bucket:${bucketKey}`, label);
        if (label.toLowerCase() !== term.toLowerCase()) {
          converted.push({ field: 'negativeConstraints', reason: 'canonicalized', detail: `${term} -> ${label}` });
        }
      }
      continue;
    }
    const key = phraseKey(term);
    if (keptSet.has(key)) {
      excluded.push({ field: 'negativeConstraints', reason: 'duplicate', detail: term });
    } else {
      keptSet.set(key, term);
    }
  }

  // Lexicographic sort for deterministic, order-independent output.
  const kept = Array.from(keptSet.values()).sort((a, b) => a.localeCompare(b));
  return { kept, converted, excluded };
}

// --- Phrase list dedup ----------------------------------------------------

export interface PhraseDedupResult {
  kept: string[];
  excluded: DiagnosticItem[];
}

/** Dedup a list of phrases by synonym-folded key, preserving first-seen order. */
export function dedupPhrases(list: string[], field: string): PhraseDedupResult {
  const excluded: DiagnosticItem[] = [];
  const seen = new Map<string, string>();
  for (const raw of list) {
    const phrase = raw.trim();
    if (!phrase) continue;
    const key = phraseKey(phrase);
    const existing = seen.get(key);
    if (existing) {
      // Same key implies same normalized meaning; keep the longer phrasing.
      if (phrase.length > existing.length) {
        excluded.push({ field, reason: 'duplicate', detail: existing });
        seen.set(key, phrase);
      } else {
        excluded.push({ field, reason: 'duplicate', detail: phrase });
      }
    } else {
      seen.set(key, phrase);
    }
  }
  return { kept: Array.from(seen.values()), excluded };
}

// --- Scope rules ----------------------------------------------------------

const PANEL_MENTION_PATTERNS: Array<{ position: PanelPosition; pattern: RegExp }> = [
  { position: 'top-left', pattern: /\btop[-\s]?left\b/i },
  { position: 'top-right', pattern: /\btop[-\s]?right\b/i },
  { position: 'bottom-left', pattern: /\bbottom[-\s]?left\b/i },
  { position: 'bottom-right', pattern: /\bbottom[-\s]?right\b/i },
];

/** A global invariant that names exactly one panel is demoted to that panel. */
function detectPanelMention(text: string): PanelPosition | null {
  const hits = PANEL_MENTION_PATTERNS.filter(({ pattern }) => pattern.test(text));
  return hits.length === 1 ? hits[0].position : null;
}

// --- Main entry -----------------------------------------------------------

export function filterAndDedupScene(scene: CanonicalImageScene): {
  scene: CanonicalImageScene;
  diagnostics: RelevanceDiagnostics;
} {
  const excluded: DiagnosticItem[] = [];
  const converted: DiagnosticItem[] = [];
  const warnings: string[] = [];
  const included: string[] = ['style', 'characters', 'panels'];

  // Work on clones so the function stays pure.
  const panels: ScenePanel[] = scene.panels.map((p) => ({ ...p, visualFocus: [...p.visualFocus] }));
  let invariants = [...scene.world.invariants];

  // 1) Demote global invariants that name exactly one panel.
  const remainingInvariants: string[] = [];
  for (const invariant of invariants) {
    const position = detectPanelMention(invariant);
    if (position) {
      const panel = panels.find((p) => p.position === position);
      if (panel && panel.visualFocus.length < SCENE_LIMITS.visualFocusItems) {
        panel.visualFocus.push(invariant);
        converted.push({ field: 'world.invariants', reason: 'demoted-to-panel', detail: `${invariant} -> ${position}` });
        continue;
      }
    }
    remainingInvariants.push(invariant);
  }
  invariants = remainingInvariants;

  // 2) Hoist a visualFocus item shared by >= 3 panels to a global invariant.
  const focusCounts = new Map<string, { count: number; sample: string }>();
  for (const panel of panels) {
    const uniqueKeys = new Set(panel.visualFocus.map(phraseKey));
    for (const item of panel.visualFocus) {
      const key = phraseKey(item);
      if (!uniqueKeys.has(key)) continue;
      uniqueKeys.delete(key);
      const entry = focusCounts.get(key);
      if (entry) entry.count += 1;
      else focusCounts.set(key, { count: 1, sample: item });
    }
  }
  for (const [key, { count, sample }] of focusCounts) {
    if (count >= 3) {
      invariants.push(sample);
      converted.push({ field: 'panels.visualFocus', reason: 'hoisted-to-global', detail: `${sample} (in ${count} panels)` });
      for (const panel of panels) {
        panel.visualFocus = panel.visualFocus.filter((item) => phraseKey(item) !== key);
      }
    }
  }

  // 3) Dedup invariants and each panel's visual focus.
  const invariantDedup = dedupPhrases(invariants, 'world.invariants');
  excluded.push(...invariantDedup.excluded);
  invariants = invariantDedup.kept;

  const characterNameKeys = new Set(scene.characters.map((c) => phraseKey(c.displayName)));
  for (const panel of panels) {
    const focusDedup = dedupPhrases(panel.visualFocus, `panels.${panel.position}.visualFocus`);
    excluded.push(...focusDedup.excluded);
    // Drop focus items that only restate a present character's name.
    panel.visualFocus = focusDedup.kept.filter((item) => {
      if (characterNameKeys.has(phraseKey(item))) {
        excluded.push({ field: `panels.${panel.position}.visualFocus`, reason: 'redundant-character-name', detail: item });
        return false;
      }
      return true;
    });
  }

  // 4) Canonicalize negatives.
  const negatives = canonicalizeNegativeConstraints(scene.negativeConstraints);
  converted.push(...negatives.converted);
  excluded.push(...negatives.excluded);
  if (negatives.kept.length > 0) included.push('negativeConstraints');
  if (invariants.length > 0) included.push('world.invariants');
  if (scene.world.anchor) included.push('world.anchor');
  if (scene.continuity.notes.length > 0) included.push('continuity');
  if (scene.userDirectives) included.push('userDirectives');

  // 5) Conflict warnings across kept invariants (both are kept, never merged).
  for (let i = 0; i < invariants.length; i += 1) {
    for (let j = i + 1; j < invariants.length; j += 1) {
      const axis = detectPhraseConflict(invariants[i], invariants[j]);
      if (axis) {
        warnings.push(`conflicting ${axis}: "${invariants[i]}" vs "${invariants[j]}" (both kept)`);
      }
    }
  }

  const nextScene: CanonicalImageScene = {
    ...scene,
    world: { ...scene.world, invariants },
    panels,
    negativeConstraints: negatives.kept,
  };

  return { scene: nextScene, diagnostics: { included, excluded, converted, warnings } };
}
