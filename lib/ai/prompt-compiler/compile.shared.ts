// Provider-neutral image prompt compiler. Turns a CanonicalImageScene into a
// compact, deterministic prompt with a fixed instruction priority, model-aware
// budgeting and priority-aware compression. Pure and isomorphic. Same scene +
// capability + compiler version always produces byte-identical output.
//
// Instruction priority (spec Phase 05):
//   1 layout/format  2 character identity + references  3 panel action/staging
//   4 sequential continuity  5 world/scene  6 style  7 secondary detail
//   8 negative constraints

import type { StoryAspectRatio } from '@/lib/types/story';
import {
  type CanonicalImageScene,
  type ScenePanel,
  type DiagnosticItem,
  type PanelPosition,
} from './scene-spec.shared';
import { filterAndDedupScene } from './relevance.shared';
import type { PromptCompilerCapability, PromptCompilerAdapterVersion } from './capability.shared';

export const COMPILER_VERSION = 'compiler-v1';

export type CompressionLevel = 0 | 1 | 2 | 3;

export interface CompiledImagePrompt {
  compilerVersion: string;
  adapterVersion: PromptCompilerAdapterVersion;
  sections: {
    composition: string;
    characters: string;
    panels: string[];
    continuity: string;
    styleAndWorld: string;
    userDirectives?: string;
    negatives: string;
  };
  fullPrompt: string;
  characterCount: number;
  compressionLevel: CompressionLevel;
  removedInformation: DiagnosticItem[];
  compressionActions: DiagnosticItem[];
  warnings: string[];
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
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001F\u007F]/g;

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

// --- Level-driven detail gates -------------------------------------------

interface RenderGates {
  visualFocus: boolean;
  emotion: boolean;
  perPanelContinuity: boolean;
  continuityNotes: boolean;
  worldInvariants: boolean;
  worldAnchor: boolean;
  styleVerbose: boolean;
}

function gatesForLevel(level: CompressionLevel): RenderGates {
  return {
    visualFocus: level <= 0,
    perPanelContinuity: level <= 0,
    emotion: level <= 1,
    continuityNotes: level <= 1,
    worldInvariants: level <= 1,
    worldAnchor: level <= 2,
    styleVerbose: level <= 2,
  };
}

// --- Section renderers ----------------------------------------------------

function renderComposition(aspectRatio: StoryAspectRatio): string {
  const orientation = aspectRatio === '9:16' ? '9:16 vertical' : '16:9';
  return (
    `Create one full-bleed ${orientation} image containing exactly four equal panels in a 2x2 grid, ` +
    'read in order top-left, top-right, bottom-left, bottom-right. Use thin near-black dividers only; ' +
    'every quadrant fills its space edge-to-edge with no outer border, padding, matting or pale gutters.'
  );
}

function renderCharacters(scene: CanonicalImageScene): string {
  if (scene.characters.length === 0) return '';
  const lines = scene.characters.map((c) =>
    c.visualIdentity ? `- ${c.displayName} — ${ensureSentence(c.visualIdentity)}` : `- ${c.displayName}.`
  );
  const anyReference = scene.characters.some((c) => c.hasReference);
  const header = 'Characters and identity:';
  const referenceNote = anyReference
    ? '\nUse each supplied reference image to lock that character’s identity — face, hair, build and colours — across every panel, rendered in the story’s visual style. Show each named character at most once per panel.'
    : '';
  return `${header}\n${lines.join('\n')}${referenceNote}`;
}

function renderPanel(
  panel: ScenePanel,
  keyToName: Map<string, string>,
  recurringKeys: Set<string>,
  gates: RenderGates
): string {
  const label = POSITION_LABEL[panel.position];
  const shot = panel.shot ? ` (${panel.shot})` : '';
  const parts: string[] = [`${label}${shot}: ${ensureSentence(panel.action)}`];

  if (gates.emotion && panel.emotion) parts.push(ensureSentence(capitalizeFirst(panel.emotion)));

  if (gates.visualFocus && panel.visualFocus.length > 0) {
    parts.push(ensureSentence(`Emphasise ${joinNames(panel.visualFocus)}`));
  }

  // Explicit absence only for strongly recurring characters missing here — this
  // prevents the model from cloning them in, without noising every panel. Skip
  // any character the action already names (it has already handled presence).
  const presentSet = new Set(panel.charactersPresent);
  const absent = [...recurringKeys]
    .filter((key) => !presentSet.has(key))
    .map((key) => keyToName.get(key))
    .filter((name): name is string => Boolean(name))
    .filter((name) => !new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(panel.action));
  if (absent.length > 0) {
    parts.push(`${joinNames(absent)} ${absent.length === 1 ? 'is' : 'are'} absent.`);
  }

  if (gates.perPanelContinuity && panel.continuityAnchor) {
    parts.push(ensureSentence(panel.continuityAnchor));
  }

  return parts.join(' ');
}

function renderPanels(
  scene: CanonicalImageScene,
  gates: RenderGates
): string[] {
  const keyToName = new Map(scene.characters.map((c) => [c.key, c.displayName]));
  // Recurring = present in at least two panels (at real risk of being cloned).
  const counts = new Map<string, number>();
  for (const panel of scene.panels) {
    for (const key of panel.charactersPresent) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const recurringKeys = new Set([...counts.entries()].filter(([, n]) => n >= 2).map(([k]) => k));
  return scene.panels.map((panel) => renderPanel(panel, keyToName, recurringKeys, gates));
}

function renderContinuity(scene: CanonicalImageScene, gates: RenderGates): string {
  const base = 'Continuity: keep one continuous world and four distinct sequential moments; preserve character identity, clothing and colours throughout.';
  if (gates.continuityNotes && scene.continuity.notes.length > 0) {
    return `${base} ${scene.continuity.notes.map(ensureSentence).join(' ')}`;
  }
  return base;
}

function renderStyleAndWorld(scene: CanonicalImageScene, gates: RenderGates): string {
  const parts: string[] = [];
  const worldBits: string[] = [];
  if (gates.worldInvariants && scene.world.invariants.length > 0) {
    worldBits.push(scene.world.invariants.map(ensureSentence).join(' '));
  }
  if (gates.worldAnchor && scene.world.anchor) {
    worldBits.push(`World reference continuity anchor (story style wins over any reference): ${ensureSentence(scene.world.anchor)}`);
  }
  if (worldBits.length > 0) parts.push(`World and scene: ${worldBits.join(' ')}`);

  if (scene.style.visualStyle) {
    const style = gates.styleVerbose
      ? scene.style.visualStyle
      : scene.style.visualStyle.split(/[.,;]/)[0].trim();
    parts.push(`Visual style: ${ensureSentence(style)}`);
  }
  return parts.join('\n');
}

function renderUserDirectives(scene: CanonicalImageScene): string | undefined {
  const directives = scene.userDirectives;
  if (!directives) return undefined;
  const lines: string[] = [
    'User visual directives (visual changes only — do not alter the layout, panel count, character identity, or story events):',
  ];
  lines.push(
    directives.mode === 'reimagine'
      ? 'Reimagine the visual treatment while preserving the same story event, characters and panel count.'
      : 'Refine the existing composition while keeping the scene, characters and panel logic close to the current version.'
  );
  if (directives.overall) lines.push(`Overall: ${ensureSentence(directives.overall)}`);
  if (directives.perPanel) {
    for (const position of Object.keys(directives.perPanel) as PanelPosition[]) {
      const text = directives.perPanel[position];
      if (text) lines.push(`${POSITION_LABEL[position]}: ${ensureSentence(text)}`);
    }
  }
  return lines.join('\n');
}

function renderNegatives(negatives: string[], adapterVersion: PromptCompilerAdapterVersion): string {
  if (negatives.length === 0) return '';
  if (adapterVersion === 'neutral-v1') {
    return `Avoid the following:\n${negatives.map((n) => `- ${n}`).join('\n')}`;
  }
  // gemini-v1: no separate negative channel — one compact avoid sentence.
  return `Avoid: ${negatives.join('; ')}.`;
}

// --- Assembly + budget loop ----------------------------------------------

interface RenderedSections {
  composition: string;
  characters: string;
  panels: string[];
  continuity: string;
  styleAndWorld: string;
  userDirectives?: string;
  negatives: string;
}

function renderSections(
  scene: CanonicalImageScene,
  capability: PromptCompilerCapability,
  level: CompressionLevel
): RenderedSections {
  const gates = gatesForLevel(level);
  return {
    composition: renderComposition(scene.aspectRatio),
    characters: renderCharacters(scene),
    panels: renderPanels(scene, gates),
    continuity: renderContinuity(scene, gates),
    styleAndWorld: renderStyleAndWorld(scene, gates),
    userDirectives: renderUserDirectives(scene),
    negatives: renderNegatives(scene.negativeConstraints, capability.adapterVersion),
  };
}

function assembleFullPrompt(sections: RenderedSections): string {
  // Priority order: layout -> identity -> panels -> continuity -> world/style
  // -> user deltas -> negatives.
  const blocks: string[] = [sections.composition];
  if (sections.characters) blocks.push(sections.characters);
  if (sections.panels.length > 0) blocks.push(`Panels:\n${sections.panels.join('\n')}`);
  if (sections.continuity) blocks.push(sections.continuity);
  if (sections.styleAndWorld) blocks.push(sections.styleAndWorld);
  if (sections.userDirectives) blocks.push(sections.userDirectives);
  if (sections.negatives) blocks.push(sections.negatives);
  return blocks.join('\n\n');
}

const LEVEL_ACTIONS: Record<Exclude<CompressionLevel, 0>, string> = {
  1: 'dropped per-panel visual-focus and continuity anchors',
  2: 'dropped emotion detail, continuity notes and world invariants',
  3: 'compacted world anchor and style to a minimal safe form',
};

export function compileImagePrompt(
  scene: CanonicalImageScene,
  capability: PromptCompilerCapability
): CompiledImagePrompt {
  const warnings: string[] = [];

  // Legacy conversion: no structured plan — pass the rendered brief through with
  // only the layout wrapper + negatives, no compression.
  if (scene.provenance.source === 'legacy_text') {
    const composition = renderComposition(scene.aspectRatio);
    const negatives = renderNegatives(scene.negativeConstraints, capability.adapterVersion);
    const brief = scene.legacyText ? `Scene brief:\n${scene.legacyText}` : '';
    const assembled = [composition, brief, negatives].filter(Boolean).join('\n\n');
    const { text: fullPrompt, hits } = redact(assembled);
    if (hits.length > 0) warnings.push(`redacted ${hits.join(', ')} from prompt`);
    return {
      compilerVersion: COMPILER_VERSION,
      adapterVersion: capability.adapterVersion,
      sections: { composition, characters: '', panels: [], continuity: '', styleAndWorld: brief, negatives },
      fullPrompt,
      characterCount: fullPrompt.length,
      compressionLevel: 0,
      removedInformation: [],
      compressionActions: [],
      warnings,
    };
  }

  const { scene: filtered, diagnostics } = filterAndDedupScene(scene);
  warnings.push(...diagnostics.warnings);

  const compressionActions: DiagnosticItem[] = [];
  let level: CompressionLevel = 0;
  let sections = renderSections(filtered, capability, level);
  let assembled = assembleFullPrompt(sections);
  let redacted = redact(assembled);

  while (redacted.text.length > capability.promptBudgetChars && level < 3) {
    level = (level + 1) as CompressionLevel;
    compressionActions.push({ field: 'prompt', reason: `compression-level-${level}`, detail: LEVEL_ACTIONS[level as 1 | 2 | 3] });
    sections = renderSections(filtered, capability, level);
    assembled = assembleFullPrompt(sections);
    redacted = redact(assembled);
  }

  if (redacted.hits.length > 0) warnings.push(`redacted ${redacted.hits.join(', ')} from prompt`);
  if (redacted.text.length > capability.promptBudgetChars) {
    warnings.push('over_budget_after_max_compression');
  }

  return {
    compilerVersion: COMPILER_VERSION,
    adapterVersion: capability.adapterVersion,
    sections,
    fullPrompt: redacted.text,
    characterCount: redacted.text.length,
    compressionLevel: level,
    removedInformation: diagnostics.excluded,
    compressionActions,
    warnings,
  };
}
