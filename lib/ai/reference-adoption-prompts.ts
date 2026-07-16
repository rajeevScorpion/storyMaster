// Prompt builders + anchor compilers for reference adoption. Pure and
// dependency-light so they unit test without any provider call. The style-lock
// rule is enforced in the canonical generation prompt: the uploaded reference
// supplies IDENTITY (or world layout) only, never rendering style.

import type {
  CharacterReferenceDescription,
  WorldReferenceDescription,
} from '@/lib/types/references';

// ---------------------------------------------------------------------------
// Character
// ---------------------------------------------------------------------------

export function buildCharacterAnalysisPrompt(): string {
  return [
    'You are analyzing ONE uploaded reference image to extract a character identity for a story.',
    'Return ONLY JSON matching this shape (no markdown, no commentary):',
    '{',
    '  "summary": string,                       // one sentence describing the character',
    '  "subjectType": string,                   // e.g. "human", "animal", "creature", "toy", "object"',
    '  "stableTraits": {',
    '    "face": string[], "hair": string[], "silhouette": string[],',
    '    "marks": string[], "stableAccessories": string[]',
    '  },',
    '  "changeable": { "clothing": string[], "pose": string[], "expression": string[] },',
    '  "continuityAnchors": string[],           // the few must-keep identity cues',
    '  "prohibitedDrift": string[],             // things NOT to add or change (e.g. "do not add spectacles")',
    '  "unusableReason": string | null          // set if the image cannot be used (see rules)',
    '}',
    '',
    'Rules:',
    '- Describe stable IDENTITY separately from temporary clothing, pose, expression and background.',
    '- Do NOT describe the art/rendering style, lighting, or the photographic look of the source.',
    '- Do NOT infer protected or sensitive personal attributes; describe only visible depiction.',
    '- Set unusableReason (a short user-safe phrase) if: there is no single clear primary subject,',
    '  the image is a collage or screenshot, the face/body is too obstructed to depict, or the image',
    '  is unsafe. Otherwise unusableReason MUST be null.',
  ].join('\n');
}

export function buildCanonicalCharacterAdoptionPrompt(input: {
  description: CharacterReferenceDescription;
  visualStyle: string;
  displayName?: string | null;
}): string {
  const { description, visualStyle, displayName } = input;
  const identity = compileCharacterAnchor(description);
  const name = (displayName ?? '').trim();
  return [
    'Create a single clean character reference image.',
    name ? `Character name: ${name}.` : '',
    `Identity to preserve (this is the ONLY thing carried from the upload): ${identity}`,
    '',
    `Render the character FULLY in the story's locked visual style: ${visualStyle}.`,
    'The uploaded reference defines identity only (face, hair, silhouette, distinctive marks) — it must',
    'NOT dictate rendering style, medium, palette, lighting or realism. A photograph becomes a fully',
    "stylized character in the story's style.",
    '',
    'Composition: one character only, neutral relaxed pose, plain neutral background, natural even',
    'lighting, no text, no watermark, no extra people or objects. Clothing may be simple and generic;',
    'do not lock temporary costume from the source.',
    description.prohibitedDrift.length > 0
      ? `Do not add or change: ${description.prohibitedDrift.join('; ')}.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Compact stable-identity anchor (~<=60 words) used as the character's
 *  appearanceSummary and injected into every relevant beat prompt. */
export function compileCharacterAnchor(description: CharacterReferenceDescription): string {
  const parts: string[] = [];
  if (description.summary) parts.push(description.summary.trim());
  const traitGroups: [string, string[]][] = [
    ['face', description.stableTraits.face],
    ['hair', description.stableTraits.hair],
    ['build', description.stableTraits.silhouette],
    ['marks', description.stableTraits.marks],
    ['accessories', description.stableTraits.stableAccessories],
  ];
  for (const [label, values] of traitGroups) {
    const cleaned = values.map((v) => v.trim()).filter(Boolean);
    if (cleaned.length > 0) parts.push(`${label}: ${cleaned.join(', ')}`);
  }
  return clampWords(parts.join('. '), 60);
}

// ---------------------------------------------------------------------------
// World (P5 uses these; character-only builds still compile)
// ---------------------------------------------------------------------------

export function buildWorldAnalysisPrompt(): string {
  return [
    'You are analyzing ONE uploaded reference image to extract a reusable "World DNA" for a story world/location.',
    'Return ONLY JSON matching this shape (no markdown, no commentary):',
    '{',
    '  "summary": string, "worldType": string,',
    '  "architecture": string[], "geography": string[], "spatialLayout": string[],',
    '  "materials": string[], "lighting": string[], "atmosphere": string[],',
    '  "recurringObjects": string[], "continuityAnchors": string[],',
    '  "keywords": string[],                    // short match terms for detecting this world in beat text',
    '  "incidentalElements": string[],          // things that are incidental and should NOT be preserved',
    '  "prohibitedDrift": string[],',
    '  "unusableReason": string | null',
    '}',
    '',
    'Rules:',
    '- Capture only visually useful, reusable environment information (layout, architecture, materials, landmarks).',
    '- Palette/lighting are SOURCE OBSERVATIONS, not a style lock; do not describe the art/rendering style.',
    '- Extract the environment even if people are present, but do NOT turn bystanders into characters.',
    '- Set unusableReason (short, user-safe) if the image is a portrait with no readable environment, a UI',
    '  screenshot, a text-heavy board, a collage, or unsafe. Otherwise unusableReason MUST be null.',
  ].join('\n');
}

export function buildCanonicalWorldAdoptionPrompt(input: {
  description: WorldReferenceDescription;
  visualStyle: string;
  displayName?: string | null;
}): string {
  const { description, visualStyle, displayName } = input;
  const anchor = compileWorldAnchor(description);
  const label = (displayName ?? '').trim();
  return [
    'Create a single establishing image of a story world/location (no people).',
    label ? `Location name: ${label}.` : '',
    `Layout and continuity to preserve (carried from the reference): ${anchor}`,
    '',
    `Render the location FULLY in the story's locked visual style: ${visualStyle}.`,
    'The reference defines spatial layout, architecture, materials and landmarks only — it must NOT',
    'dictate rendering style, medium, palette or realism.',
    '',
    'Composition: wide establishing shot, no characters, no text, no watermark, no UI. Preserve the',
    'recurring architecture and landmarks; ignore incidental clutter.',
    description.incidentalElements.length > 0
      ? `Ignore these incidental elements: ${description.incidentalElements.join('; ')}.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Compact world anchor (~<=80 words) accompanying relevant beat prompts. */
export function compileWorldAnchor(description: WorldReferenceDescription): string {
  const parts: string[] = [];
  if (description.summary) parts.push(description.summary.trim());
  const groups: [string, string[]][] = [
    ['type', description.worldType ? [description.worldType] : []],
    ['architecture', description.architecture],
    ['layout', description.spatialLayout],
    ['materials', description.materials],
    ['landmarks', description.recurringObjects],
    ['anchors', description.continuityAnchors],
  ];
  for (const [label, values] of groups) {
    const cleaned = values.map((v) => v.trim()).filter(Boolean);
    if (cleaned.length > 0) parts.push(`${label}: ${cleaned.join(', ')}`);
  }
  return clampWords(parts.join('. '), 80);
}

function clampWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(' ')}…`;
}
