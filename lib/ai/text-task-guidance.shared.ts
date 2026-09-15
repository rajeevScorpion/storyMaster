// Pure, isomorphic advisory copy for the Task assignments cards on /admin/text-models. Fixed
// guidance shipped in code -- no migration, no feature flag, no effect on what gets saved.
//
// Principle: thinking buys planning, rule-keeping and judgment, not imagination. Push the
// suggested level up for many constraints or costly mistakes; down when a user waits on every
// call. See docs/text-task-guidance-plan.md.

import type { TaskKey } from '@/lib/ai/model-config.shared';
import { TEXT_REASONING_LEVELS, type TextReasoningLevel } from '@/lib/ai/text-models.shared';

export type SuggestedThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';
export const SUGGESTED_THINKING_STEPS: readonly SuggestedThinkingLevel[] = ['minimal', 'low', 'medium', 'high'];

/** Every TaskKey a text model can run. Must equal the set isTextModelTask accepts (unit-tested). */
export type TextTaskKey = Exclude<
  TaskKey,
  'image_generation' | 'reel_image_generation' | 'portrait_generation' | 'tts' | 'reel_tts' | 'story_text_overlay_alignment'
>;

export interface TextTaskGuidance {
  summary: string;
  /** A person is on screen waiting for this result. */
  userWaiting: boolean;
  cadence: string;
  suggested: SuggestedThinkingLevel;
  why: string;
}

export const TEXT_TASK_GUIDANCE: Record<TextTaskKey, TextTaskGuidance> = {
  story_generation: {
    summary: 'Writes each beat: the scene, the choices, the characters and what must stay consistent.',
    userWaiting: true,
    cadence: 'Every beat',
    suggested: 'medium',
    why: 'Holds the most rules at once, but a reader waits on every beat, so High costs time.',
  },
  reel_story_generation: {
    summary: 'Writes a short reel of one to three beats.',
    userWaiting: true,
    cadence: 'Per reel',
    suggested: 'low',
    why: 'Short and self-contained, with little continuity to track.',
  },
  seed_plan_generation: {
    summary: "Turns a creator's own material into a beat-by-beat plan they review.",
    userWaiting: true,
    cadence: 'Once per seeded story',
    suggested: 'high',
    why: 'Shapes the whole story in one pass, and runs only once.',
  },
  seeded_beat_materialization: {
    summary: 'Expands one approved plan beat into the full beat a reader sees.',
    userWaiting: true,
    cadence: 'Every beat of a seeded story',
    suggested: 'low',
    why: 'The plan already decided what happens, and a reader waits on every beat.',
  },
  story_bible_generation: {
    summary: 'Condenses a finished episode into the series bible the next episode builds on.',
    userWaiting: true,
    cadence: 'Once per episode',
    suggested: 'medium',
    why: 'Mistakes here carry into every later episode.',
  },
  storyline_discovery_metadata: {
    summary: 'Writes the short gallery blurb, genre and audience fit when a storyline is published.',
    userWaiting: true,
    cadence: 'Once per publish',
    suggested: 'low',
    why: 'A few sentences about a finished story; low stakes.',
  },
  visual_prompt: {
    summary: "Turns a finished beat into the 4-panel storyboard plan and portrait tasks for its image.",
    userWaiting: true,
    cadence: 'Every beat',
    suggested: 'low',
    why: 'Translates decisions the beat already made into image instructions.',
  },
  reel_visual_prompt: {
    summary: 'Turns a reel beat into a 4-panel storyboard plan paced for vertical video.',
    userWaiting: true,
    cadence: 'Every reel beat',
    suggested: 'low',
    why: 'Translates decisions the reel already made into image instructions.',
  },
  graphic_style_extraction: {
    summary: "Describes a reference image's art style in 150 words or fewer.",
    userWaiting: true,
    cadence: 'On demand, admin tool',
    suggested: 'minimal',
    why: 'Describes what is in the image; nothing to plan.',
  },
  reference_character_analysis: {
    summary: 'Reads an uploaded character image and separates fixed identity from details that can change.',
    userWaiting: true,
    cadence: 'Once per reference image',
    suggested: 'low',
    why: 'Careful reading, not invention.',
  },
  reference_world_analysis: {
    summary: "Reads an uploaded place image and records its layout, materials and lighting.",
    userWaiting: true,
    cadence: 'Once per reference image',
    suggested: 'low',
    why: 'Careful reading, not invention.',
  },
  voice_selection: {
    summary: 'Picks a narrator voice. Only used when user-led voice choice is off.',
    userWaiting: true,
    cadence: 'Once per story, legacy',
    suggested: 'minimal',
    why: 'A simple choice from a short list.',
  },
  agent_novelty_assessment: {
    summary: "Breaks ties on whether an agent's story idea is too close to existing ones.",
    userWaiting: false,
    cadence: 'Only in unclear cases',
    suggested: 'minimal',
    why: 'A second opinion after scoring has already done most of the work.',
  },
  agent_supervisor_planning: {
    summary: 'Turns gaps in the catalogue into story commissions for agent personas.',
    userWaiting: false,
    cadence: 'Per supervisor run',
    suggested: 'high',
    why: 'Sets direction for many stories, and runs rarely.',
  },
  agent_story_brief: {
    summary: 'Turns a commission into a title, premise, themes and characters.',
    userWaiting: false,
    cadence: 'Per agent story',
    suggested: 'medium',
    why: 'Everything the story writer produces builds on this.',
  },
  agent_seed_story_writing: {
    summary: "Writes the full source prose for an agent story, in the persona's language.",
    userWaiting: false,
    cadence: 'Per agent story',
    suggested: 'medium',
    why: 'Long writing that must follow the brief; more thinking does not add imagination.',
  },
  agent_story_evaluation: {
    summary: 'Checks coherence, age fit, persona fidelity, pacing and safety before human review.',
    userWaiting: false,
    cadence: 'Per agent story',
    suggested: 'high',
    why: 'The quality and safety gate; a miss reaches human review.',
  },
};

export function getTextTaskGuidance(taskKey: TaskKey): TextTaskGuidance | null {
  return (TEXT_TASK_GUIDANCE as Partial<Record<TaskKey, TextTaskGuidance>>)[taskKey] ?? null;
}

/** Closest level the model offers to `target`, by position in TEXT_REASONING_LEVELS. Exact match wins;
 * on a tie the lower (cheaper) level wins; null when `offered` is empty. */
export function nearestOfferedLevel(
  target: TextReasoningLevel,
  offered: readonly TextReasoningLevel[]
): TextReasoningLevel | null {
  if (offered.length === 0) return null;

  const targetIndex = TEXT_REASONING_LEVELS.indexOf(target);
  let best = offered[0];
  let bestIndex = TEXT_REASONING_LEVELS.indexOf(best);
  let bestDistance = Math.abs(bestIndex - targetIndex);

  for (const level of offered) {
    const index = TEXT_REASONING_LEVELS.indexOf(level);
    const distance = Math.abs(index - targetIndex);
    if (distance < bestDistance || (distance === bestDistance && index < bestIndex)) {
      best = level;
      bestIndex = index;
      bestDistance = distance;
    }
  }

  return best;
}

/** 'above' / 'below' when `effective` sits two or more positions (TEXT_REASONING_LEVELS index) from the
 * nearest offered level to `suggested`; otherwise null. Also null when `effective` is null (provider
 * default — unknown) or `offered` is empty (no thinking control). */
export function compareToSuggestion(
  effective: TextReasoningLevel | null,
  suggested: SuggestedThinkingLevel,
  offered: readonly TextReasoningLevel[]
): 'above' | 'below' | null {
  if (effective === null) return null;

  const nearest = nearestOfferedLevel(suggested, offered);
  if (nearest === null) return null;

  const diff = TEXT_REASONING_LEVELS.indexOf(effective) - TEXT_REASONING_LEVELS.indexOf(nearest);
  if (diff >= 2) return 'above';
  if (diff <= -2) return 'below';
  return null;
}
