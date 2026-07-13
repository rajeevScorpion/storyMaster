// Pack 1: builds the regeneration instruction block appended to the final
// storyboard/image prompt when the user regenerates a beat image. Pure and
// client-safe — used by the store for both the server-pipeline payload and
// the legacy inline path, and unit-tested in isolation.
//
// Continuity contract (spec 07): user suggestions are visual direction only.
// The block always restates the strict preservation rules so neither mode can
// drift the story event, character identities, or panel structure.

export type ImageRegenerationMode = 'refine' | 'reimagine';

export const STORYBOARD_PANEL_KEYS = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const;
export type StoryboardPanelKey = (typeof STORYBOARD_PANEL_KEYS)[number];

export const PANEL_LABELS: Record<StoryboardPanelKey, string> = {
  topLeft: 'Panel 1 (top-left)',
  topRight: 'Panel 2 (top-right)',
  bottomLeft: 'Panel 3 (bottom-left)',
  bottomRight: 'Panel 4 (bottom-right)',
};

const MODE_INSTRUCTIONS: Record<ImageRegenerationMode, string> = {
  refine:
    'Refine the existing storyboard concept. Keep the scene composition, character identities, story event, and panel logic close to the current version. Improve clarity, polish, emotional expression, visual consistency, detail, lighting, and composition according to the user\'s visual suggestions.',
  reimagine:
    'Reimagine the visual treatment while preserving the same story event, named characters, character identities, narrative meaning, visual style constraints, and panel count. You may change camera angles, composition, lighting, staging, and background richness according to the user\'s suggestions.',
};

/** What the regenerate-image dialog collects and the store threads through. */
export interface BeatImageRegenerationOptions {
  mode: ImageRegenerationMode;
  overallSuggestion?: string;
  panelSuggestions?: Partial<Record<StoryboardPanelKey, string>>;
}

/** Drop empty/whitespace-only panel suggestions; undefined when none remain. */
export function cleanPanelSuggestions(
  suggestions: Partial<Record<StoryboardPanelKey, string>> | undefined
): Record<string, string> | undefined {
  if (!suggestions) return undefined;
  const entries = STORYBOARD_PANEL_KEYS.map((key) => {
    const value = suggestions[key]?.trim();
    return value ? ([key, value] as const) : null;
  }).filter((entry): entry is readonly [StoryboardPanelKey, string] => entry !== null);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export interface RegenerationInstructionInput {
  mode: ImageRegenerationMode;
  overallSuggestion?: string;
  panelSuggestions?: Partial<Record<StoryboardPanelKey, string>>;
  /** Regular (non-storyboard) beats have a single image — panel wording is omitted. */
  isStoryboard: boolean;
}

export function buildRegenerationInstructionBlock(input: RegenerationInstructionInput): string {
  const lines: string[] = [];

  lines.push('REGENERATION MODE:');
  lines.push(MODE_INSTRUCTIONS[input.mode]);

  const overall = input.overallSuggestion?.trim();
  if (overall) {
    lines.push('');
    lines.push('USER OVERALL VISUAL SUGGESTION:');
    lines.push(overall);
  }

  if (input.isStoryboard && input.panelSuggestions) {
    const panelLines = STORYBOARD_PANEL_KEYS.map((key) => {
      const suggestion = input.panelSuggestions?.[key]?.trim();
      return suggestion ? `${PANEL_LABELS[key]}: ${suggestion}` : null;
    }).filter((line): line is string => line !== null);
    if (panelLines.length > 0) {
      lines.push('');
      lines.push('USER PANEL-SPECIFIC SUGGESTIONS:');
      lines.push(...panelLines);
    }
  }

  lines.push('');
  lines.push('STRICT REGENERATION RULES:');
  lines.push('- Preserve the exact story event and narrative meaning described in the beat text.');
  lines.push('- Preserve named character identities, appearance references, and costumes unless the user explicitly asks for a visual costume change.');
  lines.push('- Preserve the established visual style unless the user specifically requests a style shift.');
  if (input.isStoryboard) {
    lines.push('- Preserve the exact panel count and storyboard layout.');
    lines.push('- Apply panel-specific suggestions only to their own panels; keep all other panels consistent.');
  }
  lines.push('- Treat the user suggestions as visual direction only — do not add, remove, or change plot events.');
  lines.push('- Do not change story text, narration, or the future direction of the story.');

  return lines.join('\n');
}
