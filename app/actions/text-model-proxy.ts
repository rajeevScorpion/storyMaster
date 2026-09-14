'use server';

// Replaces gemini-proxy.ts's four Gemini-only text functions. Same params, same return
// type, same default temperatures, same schemaMap and guardrails -- only the model id's
// meaning changed: `model` now names a text_model_registry key (or a bare Gemini id in
// legacy mode), resolved and run by lib/ai/text-gateway/router.ts instead of talking to
// Gemini directly. A "call Gemini" function that actually runs Luna would be exactly the
// kind of lie migration 118 fixed -- hence the rename away from the old function names.
//
// 'use server' files may only export async functions -- interfaces are erased at compile
// time and are fine (gemini-proxy.ts already relies on this).

import { beatSchema, reelDraftSchema, seedPlanSchema, storyboardPlanSchema } from '@/lib/ai/generation-schemas';
import { LOCKED_PROMPT_GUARDRAILS } from '@/lib/ai/prompt-config.shared';
import type { TaskKey } from '@/lib/ai/model-config.shared';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import type { InlineImagePart } from '@/app/actions/gemini-proxy';
import { generateText } from '@/lib/ai/text-gateway/router';

const TEXT_SCHEMA_MAP = {
  story_generation: beatSchema,
  reel_story_generation: reelDraftSchema,
  seed_plan_generation: seedPlanSchema,
  seeded_beat_materialization: beatSchema,
  visual_prompt: storyboardPlanSchema,
  reel_visual_prompt: storyboardPlanSchema,
} as const;

export interface TextCallParams {
  task: Extract<TaskKey, 'story_generation' | 'reel_story_generation' | 'seed_plan_generation' | 'seeded_beat_materialization' | 'visual_prompt' | 'reel_visual_prompt'>;
  model: string;
  prompt: string;
  temperature?: number;
  telemetry?: CostTelemetryContext;
}

export async function callTextModel(params: TextCallParams): Promise<string> {
  const { task, model, prompt, temperature, telemetry } = params;
  const result = await generateText({
    taskKey: task,
    modelKey: model,
    prompt,
    systemInstruction: LOCKED_PROMPT_GUARDRAILS[task],
    schema: TEXT_SCHEMA_MAP[task],
    schemaName: task,
    temperature: temperature ?? 0.7,
    telemetry,
    telemetryMetadata: { promptChars: prompt.length, temperature: temperature ?? 0.7 },
  });
  return result.text;
}

export interface VisionTextCallParams {
  task: Extract<TaskKey, 'graphic_style_extraction'>;
  model: string;
  prompt: string;
  referenceParts: InlineImagePart[];
  temperature?: number;
  telemetry?: CostTelemetryContext;
}

export async function callTextModelVision(params: VisionTextCallParams): Promise<string> {
  const { task, model, prompt, referenceParts, temperature, telemetry } = params;
  const result = await generateText({
    taskKey: task,
    modelKey: model,
    prompt,
    systemInstruction: LOCKED_PROMPT_GUARDRAILS[task],
    images: referenceParts,
    requireVision: true,
    temperature: temperature ?? 0.4,
    telemetry,
    telemetryMetadata: { promptChars: prompt.length, referenceCount: referenceParts.length },
  });
  return result.text;
}

export interface ReferenceAnalysisCallParams {
  task: Extract<TaskKey, 'reference_character_analysis' | 'reference_world_analysis'>;
  model: string;
  /** Full instruction prompt (built inline in lib/ai/reference-analysis.ts). */
  prompt: string;
  referenceParts: InlineImagePart[];
  temperature?: number;
  telemetry?: CostTelemetryContext;
}

/**
 * Multimodal identity / World DNA extraction: sends the uploaded reference image plus a
 * JSON-instruction prompt and returns the raw JSON text for the caller to parse. Separate
 * from callTextModelVision because these tasks have no LOCKED_PROMPT_GUARDRAILS entry (not
 * part of the admin prompt playground) and want JSON output with no schema.
 */
export async function callTextModelReferenceAnalysis(params: ReferenceAnalysisCallParams): Promise<string> {
  const { task, model, prompt, referenceParts, temperature, telemetry } = params;
  const result = await generateText({
    taskKey: task,
    modelKey: model,
    prompt,
    images: referenceParts,
    requireVision: true,
    expectJson: true,
    temperature: temperature ?? 0.2,
    telemetry,
    telemetryMetadata: { promptChars: prompt.length, referenceCount: referenceParts.length },
  });
  return result.text;
}

export interface AgenticJsonCallParams {
  task: Extract<TaskKey, 'agent_novelty_assessment' | 'agent_supervisor_planning' | 'agent_story_brief' | 'agent_seed_story_writing' | 'agent_story_evaluation'>;
  model: string;
  prompt: string;
  temperature?: number;
  telemetry?: CostTelemetryContext;
}

/**
 * Text-in, JSON-out call shared by the agentic tasks that build their own prompt in code
 * rather than through the admin prompt registry (novelty adjudication, supervisor planning,
 * the story-assembly brief/seed-prose calls, and the evaluation grading call). Deliberately
 * separate from callTextModel: that function looks the task up in LOCKED_PROMPT_GUARDRAILS
 * and TEXT_SCHEMA_MAP, both keyed by the admin-editable prompt registry, and registering any
 * of these tasks there would put a non-editable prompt into the prompt playground (see
 * PromptTaskKey's exclusion list in prompt-config.shared.ts). No schema, no guardrail, JSON
 * output requested.
 */
export async function callTextModelAgenticJson(params: AgenticJsonCallParams): Promise<string> {
  const { task, model, prompt, temperature, telemetry } = params;
  const result = await generateText({
    taskKey: task,
    modelKey: model,
    prompt,
    expectJson: true,
    temperature: temperature ?? 0.2,
    telemetry,
    telemetryMetadata: { promptChars: prompt.length, temperature: temperature ?? 0.2 },
  });
  return result.text;
}
