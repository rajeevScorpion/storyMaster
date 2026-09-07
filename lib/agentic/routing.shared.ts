// ── Agentic Creator: task-role model routing, pure half ──────────────────
//
// Task-role model routing is implemented as TaskKeys in the EXISTING model_config
// registry (lib/ai/model-config.shared.ts), not a parallel role system -- see decision
// D1 in docs/agentic-creator-decisions.md. AGENT_TASK_ROLES below is documentation-as-
// data only: it never changes which model runs, it just labels which of the three
// informal tiers (economy / standard / creative) each agentic TaskKey belongs to, so an
// admin editing /admin/settings/model-config can see the intent behind a task's default.
//
// resolveAgentModel is the actual routing decision, and it names no model anywhere in
// this file: precedence is persona override -> model_config row -> DEFAULT_MODELS. The
// second and third tiers are already collapsed into one value by the time this function
// runs -- lib/ai/model-config.ts's getModelConfig(task) already falls back from the
// model_config row to DEFAULT_MODELS internally, so `globalConfig` here is simply
// "whatever getModelConfig(taskKey) returned." This function's only job is deciding
// whether a persona's own model_overrides (migration 103, JSONB keyed by TaskKey) beats
// that value for THIS task -- and never for any other task, which is why the persona
// override lookup is keyed on `taskKey` and nothing else.

import type { TaskKey } from '@/lib/ai/model-config.shared';
import type { AgentPersona } from './personas.shared';

/**
 * The agentic-specific TaskKeys this module routes for. The `satisfies` clause fails to
 * compile if one of these ever stops being a real TaskKey, mirroring the ALL_AGE_GROUPS
 * pattern in supervisor.shared.ts.
 */
export const AGENT_TASK_KEYS = [
  'agent_supervisor_planning',
  'agent_story_brief',
  'agent_seed_story_writing',
  'agent_novelty_assessment',
  'agent_story_evaluation',
] as const satisfies readonly TaskKey[];

export type AgentTaskKey = (typeof AGENT_TASK_KEYS)[number];

export type AgentTaskRole = 'economy' | 'standard' | 'creative';

/**
 * Informal cost/capability tier per agentic task, for admin legibility only -- see the
 * module header. Never read at generation time to pick a model; resolveAgentModel below
 * is the only thing that does that, and it never consults this map.
 */
export const AGENT_TASK_ROLES: Record<AgentTaskKey, AgentTaskRole> = {
  agent_supervisor_planning: 'standard',
  agent_story_brief: 'standard',
  agent_seed_story_writing: 'creative',
  agent_novelty_assessment: 'economy',
  agent_story_evaluation: 'standard',
};

/** The raw shape stored per task key in agent_personas.model_overrides (migration 103). */
export interface AgentModelOverride {
  modelId?: string;
  temperature?: number | null;
}

export interface AgentGlobalModelConfig {
  model: string;
  temperature: number | null;
}

export interface ResolvedAgentModel {
  model: string;
  temperature: number | null;
  /** Which precedence tier actually supplied `model` -- for run-event / debug logging. */
  source: 'persona_override' | 'global_config';
}

/** The slice of AgentPersona this module needs. Reused rather than re-declared. */
export type AgentModelRoutingPersona = Pick<AgentPersona, 'modelOverrides'>;

/**
 * Reads a validated override for exactly this task key out of a persona's
 * model_overrides bag. Treated as hostile/admin-editable JSONB, not a trusted shape: a
 * missing bag, a missing entry for this task, a non-object entry, or an entry with no
 * usable string modelId all resolve to "no override" rather than throwing or handing
 * back a garbage model id. `temperature` on its own is never enough to count as an
 * override -- an override without a model names nothing to route to.
 */
function readPersonaOverride(
  persona: AgentModelRoutingPersona | null | undefined,
  taskKey: AgentTaskKey
): { modelId: string; temperature: number | null } | null {
  const raw = persona?.modelOverrides?.[taskKey];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const candidate = raw as AgentModelOverride;
  const modelId = typeof candidate.modelId === 'string' ? candidate.modelId.trim() : '';
  if (!modelId) return null;

  const temperature =
    typeof candidate.temperature === 'number' && Number.isFinite(candidate.temperature) ? candidate.temperature : null;

  return { modelId, temperature };
}

/**
 * Resolves the model + temperature to use for one agentic model call.
 *
 * Precedence: a persona's own model_overrides for THIS taskKey wins outright; otherwise
 * `globalConfig` (the caller's already-resolved model_config-row-or-DEFAULT_MODELS value
 * for this task) is used verbatim. An override that names a model but no temperature
 * still falls back to globalConfig's temperature rather than leaving it undefined, since
 * a null temperature is a legitimate value for non-text tasks (see DEFAULT_MODELS'
 * image/tts entries) and must not be confused with "not specified."
 *
 * Persona logic never names a model: every model id returned by this function came from
 * either the persona's own admin-authored JSONB or the model_config/DEFAULT_MODELS chain
 * -- nothing here is a hardcoded model name.
 */
export function resolveAgentModel(
  taskKey: AgentTaskKey,
  persona: AgentModelRoutingPersona | null | undefined,
  globalConfig: AgentGlobalModelConfig
): ResolvedAgentModel {
  const override = readPersonaOverride(persona, taskKey);
  if (override) {
    return {
      model: override.modelId,
      temperature: override.temperature ?? globalConfig.temperature,
      source: 'persona_override',
    };
  }

  return { model: globalConfig.model, temperature: globalConfig.temperature, source: 'global_config' };
}
