import type { TaskKey } from './model-config.shared';

export type PromptTaskKey = TaskKey;

export interface PromptPlaceholderDefinition {
  key: string;
  label: string;
  description: string;
  required: boolean;
}

export interface PromptTaskDefinition {
  key: PromptTaskKey;
  label: string;
  description: string;
  placeholders: PromptPlaceholderDefinition[];
  defaultPrompt: string;
}

export interface PromptValidationResult {
  isValid: boolean;
  unknownPlaceholders: string[];
  missingRequiredPlaceholders: string[];
  usedPlaceholders: string[];
}

export interface PromptTestRunRecord {
  id: string;
  taskKey: PromptTaskKey;
  createdBy: string;
  promptBody: string;
  modelId: string;
  temperature: number | null;
  inputs: Record<string, string>;
  output: string;
  outputType: 'json' | 'text' | 'image' | 'audio';
  latencyMs: number;
  tokenCounts?: { input: number; output: number };
  estimatedCostUsd?: number;
  createdAt: string;
}

export const STORY_GENERATION_PROMPT_DEFAULT = `You are Kissago, an expert interactive storyteller for a visual branching story platform.

Your task is to generate one story beat at a time for short interactive stories. You never generate the full story in one response. You only generate the next beat based on the user's original prompt, the current story state, and the option selected by the user.

Your stories must be:
- imaginative
- emotionally engaging
- visually vivid
- coherent across turns
- short in total length
- suitable for branching interaction

Core behavior rules:
1. Generate only one beat per response.
2. Each beat must contain a short paragraph of story text, not the whole story.
3. Each non-ending beat must provide 3 or 4 distinct next choices.
4. Each choice must be meaningfully different and easy to understand.
5. Respect all established story facts, character traits, and world details from the story state.
6. Maintain character consistency in name, appearance, temperament, and role.
7. Keep the number of primary characters small, ideally 2 to 4.
8. Move the story toward a satisfying ending within the configured maximum number of beats.
9. If the story is nearing the final beat, begin resolving tensions rather than creating many new ones.
10. Each beat must include an image prompt that preserves visual continuity.
11. The image prompt must describe the same characters consistently across beats.
12. Each beat's imagePrompt must suggest a camera angle that DIFFERS from the previous beat. Rotate between: wide establishing shot, medium two-shot, close-up on face or hands, over-the-shoulder, low-angle, bird's-eye view. State the angle explicitly in the prompt.
13. Also generate 2 to 4 short clue or loading lines that can be shown while the next beat is generated.
13. Keep the writing accessible, vivid, and cinematic.
14. Avoid contradiction, repetition, and random additions.
15. Default to all-ages safe content unless the product configuration says otherwise.
16. Avoid graphic violence, cruelty, adult content, hateful content, or disturbing imagery.

Age group adaptation rules:
- kids_3_5: Very simple sentences, 2-3 sentences per beat, no scary content, bright and happy themes, familiar objects, warm and safe tone.
- kids_5_8: Simple but slightly richer vocabulary, short paragraphs, gentle tension, playful and clear, animal characters work well, clear morals.
- kids_8_12: Moderate complexity, can include mild peril and mystery, adventurous tone, more character depth and descriptive language.
- teens: Complex narratives, nuanced emotions, layered conflict, moral ambiguity allowed, can include moderate tension and relationship complexity.
- adults: Full narrative complexity, rich prose, mature themes permitted (but still no graphic violence, cruelty, or adult content), deeper storytelling and emotional texture.
- all_ages: Universal Pixar-like appeal, sophisticated enough for adults but accessible to children.

Setting and cultural adaptation rules:
- If a setting or country is specified, incorporate culturally appropriate character names, environments, food, landmarks, customs, and references.
- Ensure respectful and authentic cultural representation without stereotyping.
- Use the setting to enrich the story world naturally.
- If no setting is specified or it is "generic", use a universal fantasy or contemporary setting.

Language rules:
- Write every story value in {{language}} unless a runtime instruction says otherwise.
- JSON field names remain in English.
- imagePrompt must remain in English.
- continuityNotes should remain in English for internal consistency tracking.
- Character names should match the setting and language naturally.

Beat pacing and story length rules:
- Pace the story to the configured maximum beats.
- At the final beat, resolve all narrative threads and return no options.
- At the penultimate beat, begin wrapping up narrative threads and steering toward resolution.
- Beat 1 establishes characters and world. Middle beats deepen conflict and relationships.

Continuity rules:
- Treat {{storyState}} as the highest source of truth.
- If there is a conflict between invention and runtime state, follow the runtime state.
- Reuse the same visual descriptors for characters unless a deliberate transformation happens.
- Do not rename characters unless the runtime state explicitly changes them.
- Do not suddenly change setting, time of day, or mood without narrative reason.

Output schema:
Return a JSON object with these keys:
- title
- beatNumber
- isEnding
- storyText
- sceneSummary
- options
- characters
- continuityNotes
- imagePrompt
- clues
- nextBeatGoal
- endingForecast

If isEnding is true:
- options must be an empty array
- nextBeatGoal should summarize the emotional resolution
- storyText should feel conclusive

Choice rules:
Each option object must contain:
- id
- label
- intent

Character rules:
Each character object must contain:
- id
- name
- type
- appearanceSummary
- personalitySummary

Runtime context:
Language: {{language}}
User Request: {{userPrompt}}

Story Configuration:
{{storyConfig}}

Current Story State:
{{storyState}}

User Selected Option:
{{selectedOptionLabel}}

Generate the next story beat.`;

export const VISUAL_PROMPT_DEFAULT = `You are Visual Prompt Composer.

Your job is to convert the latest story beat and the story bible into a high-quality image prompt that preserves continuity.

Rules:
1. Preserve character appearance exactly as described in {{characters}}.
2. If character reference portraits are provided, describe characters exactly as they appear in their reference images — same proportions, colors, clothing, and distinguishing features.
3. Preserve the art style across the whole story session.
4. Focus on one clear cinematic moment.
5. Do not include text overlays in the image.
6. Ensure the prompt is emotionally expressive and visually specific.
7. Choose a camera angle and framing that is DIFFERENT from the previous beat. Rotate between: wide establishing shot, medium two-shot, close-up on face or hands, over-the-shoulder, low-angle, bird's-eye view, or dutch angle. Always state the chosen angle explicitly (e.g. "low-angle wide shot", "tight close-up", "over-the-shoulder medium shot").
8. Keep the prompt concise but rich.
9. Avoid adding new visual elements not grounded in the story state.
10. Prefer readable, beautiful compositions suitable for story scenes.
11. When storyboard mode is active, the output image will be composed as a 2×2 panel grid. In that case: describe four distinct sequential moments from the scene, one per panel, in reading order (top-left → top-right → bottom-left → bottom-right). Each panel should advance the action naturally. Panels are separated by thin dark lines; no text, captions, or labels inside panels. Maintain strict character visual consistency (same face, clothing, proportions) across all four panels.
12. Output only the final image prompt as plain text.

Story Beat Image Prompt:
{{sceneDescription}}

Characters:
{{characters}}

Visual Style:
{{visualStyle}}

Beat Number: {{beatNumber}}

Generate the final image prompt based on the above.`;

export const TTS_PROMPT_DEFAULT = `You are a master storyteller narrating a {{genre}} tale with a {{tone}} tone in {{language}}.

Read this passage aloud with natural pacing, dramatic pauses, and emotional expression that matches the scene.

Passage:
{{storyText}}`;

export const VOICE_SELECTION_PROMPT_DEFAULT = `Pick the single best narrator voice for a {{genre}} story with a {{tone}} tone, aimed at a {{targetAge}} audience. The story will be narrated in {{language}}.

Available voices:
{{availableVoices}}

Respond with ONLY the voice name, nothing else.`;

export const IMAGE_GENERATION_PROMPT_DEFAULT = `{{prompt}}

Cinematic storybook illustration, visually clear composition, expressive lighting, rich environmental detail, consistent character continuity, emotionally readable scene, no text overlays or typography. Compose as a 2×2 storyboard grid of four equal 16:9-proportioned panels separated by thin dark dividing lines — each panel a distinct sequential cinematic moment of the scene.`;

export const PORTRAIT_GENERATION_PROMPT_DEFAULT = `Generate a single character portrait of {{characterName}}, a {{characterType}}.

Appearance: {{characterAppearance}}

Requirements:
- Front-facing or three-quarter view, clear face and full body visible
- Clean, simple background (soft gradient or neutral tone)
- Match the art style: {{visualStyle}}
- Single character only, no other characters or figures
- High detail on distinguishing features (face, clothing, accessories, coloring)
- Expressive pose that reflects personality
- No text, labels, or watermarks`;

export const LOCKED_PROMPT_GUARDRAILS: Record<PromptTaskKey, string> = {
  story_generation: 'Return strict valid JSON only. Never include markdown, commentary, or text outside the JSON object. Follow the provided schema exactly and keep the content safe for the requested audience.',
  visual_prompt: 'Return only the final image prompt as plain text. Do not add explanations, numbering, or markdown.',
  image_generation: 'Return only the final image prompt as plain text. Do not add explanations, numbering, or markdown.',
  portrait_generation: 'Generate a single character portrait image. No text overlays, no multiple characters, no background clutter.',
  tts: 'Produce narration-ready text-to-speech content only. Do not introduce metadata or alternative takes.',
  voice_selection: 'Return only a single voice name from the available list. Do not add commentary or punctuation beyond the voice name.',
};

export const PROMPT_TASK_DEFINITIONS: Record<PromptTaskKey, PromptTaskDefinition> = {
  story_generation: {
    key: 'story_generation',
    label: 'Story Generation Prompt',
    description: 'Controls the storytelling instruction template used before JSON beat generation.',
    placeholders: [
      { key: 'language', label: 'Language', description: 'Requested output language.', required: true },
      { key: 'userPrompt', label: 'User Prompt', description: 'Original story request from the user.', required: true },
      { key: 'storyConfig', label: 'Story Config', description: 'Formatted story configuration and beat pacing context.', required: true },
      { key: 'storyState', label: 'Story State', description: 'Current story state snapshot.', required: true },
      { key: 'selectedOptionLabel', label: 'Selected Option', description: 'Most recently chosen option label, or blank on the first beat.', required: true },
    ],
    defaultPrompt: STORY_GENERATION_PROMPT_DEFAULT,
  },
  visual_prompt: {
    key: 'visual_prompt',
    label: 'Visual Prompt Composer',
    description: 'Controls how scene descriptions are refined into final image prompts.',
    placeholders: [
      { key: 'sceneDescription', label: 'Scene Description', description: 'The current beat image prompt or scene summary.', required: true },
      { key: 'characters', label: 'Characters', description: 'Character continuity details.', required: true },
      { key: 'visualStyle', label: 'Visual Style', description: 'Requested art style or rendering direction.', required: true },
      { key: 'beatNumber', label: 'Beat Number', description: 'Current beat number, used to calibrate camera angle variety.', required: false },
    ],
    defaultPrompt: VISUAL_PROMPT_DEFAULT,
  },
  image_generation: {
    key: 'image_generation',
    label: 'Image Generation Wrapper',
    description: 'Controls the final plain-text wrapper sent into the image model after visual prompt composition.',
    placeholders: [
      { key: 'prompt', label: 'Base Prompt', description: 'The composed image prompt that will be refined before image generation.', required: true },
    ],
    defaultPrompt: IMAGE_GENERATION_PROMPT_DEFAULT,
  },
  portrait_generation: {
    key: 'portrait_generation',
    label: 'Portrait Generation Prompt',
    description: 'Controls how character reference portraits are generated for visual consistency.',
    placeholders: [
      { key: 'characterName', label: 'Character Name', description: 'Name of the character.', required: true },
      { key: 'characterAppearance', label: 'Character Appearance', description: 'Detailed appearance description from the story beat.', required: true },
      { key: 'characterType', label: 'Character Type', description: 'Type/species of the character (e.g., monkey, wizard, girl).', required: true },
      { key: 'visualStyle', label: 'Visual Style', description: 'Art style for the portrait to match scene images.', required: true },
    ],
    defaultPrompt: PORTRAIT_GENERATION_PROMPT_DEFAULT,
  },
  tts: {
    key: 'tts',
    label: 'TTS Narration Prompt',
    description: 'Controls the spoken narration style before audio synthesis.',
    placeholders: [
      { key: 'storyText', label: 'Story Text', description: 'Text passage that will be narrated.', required: true },
      { key: 'tone', label: 'Tone', description: 'Desired narration tone.', required: true },
      { key: 'genre', label: 'Genre', description: 'Story genre context.', required: true },
      { key: 'language', label: 'Language', description: 'Narration language.', required: true },
    ],
    defaultPrompt: TTS_PROMPT_DEFAULT,
  },
  voice_selection: {
    key: 'voice_selection',
    label: 'Voice Selection Prompt',
    description: 'Controls how the best narrator voice is selected for a story.',
    placeholders: [
      { key: 'genre', label: 'Genre', description: 'Story genre context.', required: true },
      { key: 'tone', label: 'Tone', description: 'Desired narration tone.', required: true },
      { key: 'targetAge', label: 'Target Age', description: 'Audience target age band.', required: true },
      { key: 'language', label: 'Language', description: 'Narration language.', required: true },
      { key: 'availableVoices', label: 'Available Voices', description: 'Comma-separated list of voice names available to the selector.', required: true },
    ],
    defaultPrompt: VOICE_SELECTION_PROMPT_DEFAULT,
  },
};

export const PROMPT_TASK_KEYS = Object.keys(PROMPT_TASK_DEFINITIONS) as PromptTaskKey[];

const PLACEHOLDER_PATTERN = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;

export function isPromptTaskKey(taskKey: TaskKey): taskKey is PromptTaskKey {
  return PROMPT_TASK_KEYS.includes(taskKey as PromptTaskKey);
}

export function extractPromptPlaceholders(promptBody: string): string[] {
  const matches = promptBody.matchAll(PLACEHOLDER_PATTERN);
  return [...new Set(Array.from(matches, (match) => match[1]))];
}

export function validatePromptTemplate(taskKey: PromptTaskKey, promptBody: string): PromptValidationResult {
  const placeholders = PROMPT_TASK_DEFINITIONS[taskKey].placeholders;
  const allowedKeys = new Set(placeholders.map((placeholder) => placeholder.key));
  const requiredKeys = placeholders.filter((placeholder) => placeholder.required).map((placeholder) => placeholder.key);
  const usedPlaceholders = extractPromptPlaceholders(promptBody);
  const unknownPlaceholders = usedPlaceholders.filter((placeholder) => !allowedKeys.has(placeholder));
  const missingRequiredPlaceholders = requiredKeys.filter((placeholder) => !usedPlaceholders.includes(placeholder));

  return {
    isValid: unknownPlaceholders.length === 0 && missingRequiredPlaceholders.length === 0,
    unknownPlaceholders,
    missingRequiredPlaceholders,
    usedPlaceholders,
  };
}

export function resolvePromptTemplate(
  promptBody: string,
  values: Record<string, string | number | boolean | null | undefined>
): string {
  return promptBody.replace(PLACEHOLDER_PATTERN, (_, placeholderName: string) => {
    const value = values[placeholderName];
    if (value == null) return '';
    return String(value);
  });
}

export function getDefaultPromptBody(taskKey: PromptTaskKey): string {
  return PROMPT_TASK_DEFINITIONS[taskKey].defaultPrompt;
}
