import { normalizePortraitReferenceConfig } from '@/lib/ai/story-config';
import {
  getDefaultPromptBody,
  resolvePromptTemplate,
  validatePromptTemplate,
} from '@/lib/ai/prompt-config.shared';
import type { Character, PortraitReferenceConfig } from '@/lib/types/story';

/**
 * Minimal override surface used by the portrait prompt. Structurally satisfied by
 * `StoryModelOverrides` so callers can pass their full overrides object.
 */
export interface PortraitPromptModelOverrides {
  portraitPrompt?: string;
}

/**
 * Human-readable description of the reference layout for a portrait/character sheet.
 * Pure string building — safe to run on the server (no browser APIs).
 */
export function buildPortraitReferenceLayoutDescription(
  portraitReferenceConfig: Pick<PortraitReferenceConfig, 'mode' | 'quality'>
): string {
  if (portraitReferenceConfig.mode === 'single_portrait') {
    return 'one clean full-body reference portrait with a clear face, either front-facing or 3/4 view';
  }

  if (portraitReferenceConfig.quality === '1K') {
    return 'a single square character sheet showing the same character in four views: close-up face, front full body, 3/4 full body, and back full body';
  }

  return 'a single square character sheet showing the same character in three views: close-up face, front full body, and 3/4 full body';
}

/**
 * Build the final portrait-generation prompt for a character. Extracted from the
 * (client-only) story-runtime module so both the client portrait flow and the
 * server-side batch/stateful portrait flow can share it. Pure string building.
 */
export function buildFinalPortraitPrompt(
  character: Character,
  visualStyle: string,
  portraitReferenceConfig: PortraitReferenceConfig,
  modelOverrides?: PortraitPromptModelOverrides,
  promptOverride?: string
): string {
  const normalizedPortraitReferenceConfig = normalizePortraitReferenceConfig(portraitReferenceConfig);
  const referenceLayout = buildPortraitReferenceLayoutDescription(normalizedPortraitReferenceConfig);
  const portraitTemplateCandidate = modelOverrides?.portraitPrompt || getDefaultPromptBody('portrait_generation');
  const portraitTemplate = validatePromptTemplate('portrait_generation', portraitTemplateCandidate).isValid
    ? portraitTemplateCandidate
    : getDefaultPromptBody('portrait_generation');

  return resolvePromptTemplate(portraitTemplate, {
    characterName: character.name,
    characterAppearance: promptOverride || character.appearanceSummary,
    characterType: character.type,
    visualStyle,
    portraitMode: normalizedPortraitReferenceConfig.mode === 'character_sheet' ? 'character sheet' : 'single portrait',
    referenceQuality: normalizedPortraitReferenceConfig.quality,
    sheetLayout: referenceLayout,
  });
}
