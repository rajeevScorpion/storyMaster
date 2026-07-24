// Legacy-vs-compiled prompt comparison for the fixture scenes. Doubles as a
// developer report (run `npm run compare:image-prompts`) and a regression guard
// that the compiler materially shortens the prompt without dropping the critical
// requirements.
//
// The legacy baseline is reconstructed from the same pure prompt-config template
// + plan render + character-anchor JSON the legacy path uses. We rebuild it here
// (rather than importing buildFinalStoryboardImagePrompt) because that module
// transitively imports `server-only`, which cannot load under Vitest. The
// character anchors intentionally include the ids/personality the legacy path
// leaks, so the reduction reflects the real bloat the compiler removes.

import { describe, it, expect } from 'vitest';
import { IMAGE_GENERATION_PROMPT_DEFAULT, resolvePromptTemplate } from '@/lib/ai/prompt-config.shared';
import type { Character, StoryboardPlan } from '@/lib/types/story';
import { buildCanonicalImageScene, type BuildCanonicalSceneInput } from './scene-spec.shared';
import { compileImagePrompt } from './compile.shared';
import type { PromptCompilerCapability } from './capability.shared';
import { MEDIEVAL_MARKET_INPUT, MINIMAL_INPUT } from './__fixtures__/scenes';

const GEMINI: PromptCompilerCapability = {
  enabled: true,
  promptBudgetChars: 2800,
  supportsNegativePrompt: false,
  adapterVersion: 'gemini-v1',
};

// Mirrors lib/ai/beat-orchestration.ts renderStoryboardPlan + the appended layout
// requirements (kept minimal — the goal is a representative baseline).
const LAYOUT_REQUIREMENTS = [
  'Storyboard layout hard requirements:',
  '- Output a full-bleed image containing exactly four equal panels in a 2x2 grid.',
  '- Panels must touch the thin dark dividers directly; no white, cream, transparent, or empty gutters.',
  '- Do not add outer padding, matting, margins, rounded frames, poster borders, page borders, or whitespace around the grid.',
  '- Use only thin dark divider lines between panels; if dividers are visible, they must be black or near-black.',
  '- Each panel artwork must fill its full quadrant edge-to-edge.',
  '- Never duplicate a named character unless the story brief explicitly requires multiple copies of that same character.',
  '- If a named character is absent from a panel, omit them instead of cloning them into the composition.',
  '- Preserve one-to-one identity for every named character across all four panels.',
].join('\n');

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

// Mirrors lib/ai/story-bible.ts buildPromptCharacterAnchors (the legacy anchors,
// including the id + personality the compiler drops).
function legacyCharacterAnchors(characters: Character[]): string {
  return JSON.stringify(
    characters.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      appearanceSummary: truncate(c.appearanceSummary || '', 120),
      personalitySummary: truncate(c.personalitySummary || '', 100),
      hasReferencePortrait: Boolean(c.portraitBase64 || c.portraitUrl || c.referenceSheetUrl),
    }))
  );
}

function renderPlan(plan: StoryboardPlan): string {
  const frames = [
    ['Top Left', plan.topLeft],
    ['Top Right', plan.topRight],
    ['Bottom Left', plan.bottomLeft],
    ['Bottom Right', plan.bottomRight],
  ] as const;
  return [
    'Shared visual invariants:',
    ...plan.sharedVisualInvariants.map((i) => `- ${i}`),
    ...frames.flatMap(([label, frame]) => [
      '',
      `${label}:`,
      `Description: ${frame.description}`,
      `Prompt: ${frame.prompt}`,
      `Camera Angle: ${frame.cameraAngle}`,
      `Visual Focus: ${frame.visualFocus.join(', ')}`,
      `Emotion: ${frame.emotion}`,
      `Continuity Anchor: ${frame.continuityAnchor}`,
    ]),
    ...(plan.negativeConstraints.length > 0
      ? ['', 'Negative constraints:', ...plan.negativeConstraints.map((i) => `- ${i}`)]
      : []),
  ].join('\n');
}

function legacyPrompt(input: BuildCanonicalSceneInput): string {
  const rendered = input.storyboardPlan ? renderPlan(input.storyboardPlan) : (input.storyboardPromptText ?? '');
  const parts = [
    resolvePromptTemplate(IMAGE_GENERATION_PROMPT_DEFAULT, {
      prompt: rendered,
      characters: legacyCharacterAnchors(input.characters),
      visualStyle: input.visualStyle,
      beatNumber: 1,
    }),
  ];
  if (input.worldAnchor) {
    parts.push(`World reference continuity anchor (story style wins over any reference): ${input.worldAnchor}`);
  }
  parts.push(LAYOUT_REQUIREMENTS);
  return parts.join('\n\n');
}

describe('legacy vs compiled prompt comparison', () => {
  const cases: Array<{ name: string; input: BuildCanonicalSceneInput }> = [
    { name: 'medieval-market 9:16', input: MEDIEVAL_MARKET_INPUT },
    { name: 'medieval-market 16:9', input: { ...MEDIEVAL_MARKET_INPUT, aspectRatio: '16:9' } },
    { name: 'minimal 16:9', input: MINIMAL_INPUT },
  ];

  const report: string[] = ['', 'Prompt compiler — legacy vs compiled (chars):'];
  for (const { name, input } of cases) {
    it(`${name}: compiled is shorter and keeps critical requirements`, () => {
      const legacy = legacyPrompt(input);
      const compiled = compileImagePrompt(buildCanonicalImageScene(input), GEMINI);
      const reduction = Math.round(((legacy.length - compiled.characterCount) / legacy.length) * 100);
      report.push(
        `  ${name.padEnd(22)} legacy=${String(legacy.length).padStart(5)}  compiled=${String(compiled.characterCount).padStart(5)}  reduction=${reduction}%  level=${compiled.compressionLevel}`
      );
      expect(compiled.characterCount).toBeLessThan(legacy.length);
      expect(compiled.characterCount).toBeLessThanOrEqual(GEMINI.promptBudgetChars);
      // Legacy leaks a character uuid; compiled must not.
      expect(compiled.fullPrompt).not.toContain(input.characters[0].id);
    });
  }

  it('prints the comparison report', () => {
    console.log(report.join('\n'));
    expect(report.length).toBeGreaterThan(2);
  });
});
