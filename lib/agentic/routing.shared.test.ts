import { describe, expect, it } from 'vitest';
import { mapTextModelRow, type TextModelRecord, type TextModelRow } from '@/lib/ai/text-models.shared';
import {
  AGENT_TASK_KEYS,
  AGENT_TASK_ROLES,
  resolveAgentModel,
  validatePersonaModelOverrides,
  type AgentModelRoutingPersona,
} from './routing.shared';

function persona(modelOverrides: Record<string, unknown> = {}): AgentModelRoutingPersona {
  return { modelOverrides };
}

const globalConfig = { model: 'gemini-3.5-flash', temperature: 0.4 };

describe('AGENT_TASK_ROLES', () => {
  it('assigns exactly the documented role to each agentic task key', () => {
    expect(AGENT_TASK_ROLES.agent_supervisor_planning).toBe('standard');
    expect(AGENT_TASK_ROLES.agent_story_brief).toBe('standard');
    expect(AGENT_TASK_ROLES.agent_seed_story_writing).toBe('creative');
    expect(AGENT_TASK_ROLES.agent_novelty_assessment).toBe('economy');
    expect(AGENT_TASK_ROLES.agent_story_evaluation).toBe('standard');
  });

  it('covers every AGENT_TASK_KEYS entry and no more', () => {
    expect(Object.keys(AGENT_TASK_ROLES).sort()).toEqual([...AGENT_TASK_KEYS].sort());
  });
});

describe('resolveAgentModel — precedence: persona override -> model_config row -> DEFAULT_MODELS', () => {
  it('tier 3 (DEFAULT_MODELS stand-in): no persona, no override -> globalConfig used verbatim', () => {
    const result = resolveAgentModel('agent_story_brief', null, globalConfig);
    expect(result).toEqual({ model: 'gemini-3.5-flash', temperature: 0.4, source: 'global_config' });
  });

  it('tier 2 (model_config row stand-in): persona has no override for this task -> the passed-in row wins over any notion of a hardcoded default', () => {
    const modelConfigRow = { model: 'gemini-3.1-pro-preview', temperature: 0.55 };
    const result = resolveAgentModel('agent_story_brief', persona({}), modelConfigRow);
    expect(result).toEqual({ model: 'gemini-3.1-pro-preview', temperature: 0.55, source: 'global_config' });
  });

  it('tier 1: a persona override for this exact task wins outright', () => {
    const withOverride = persona({
      agent_story_brief: { modelId: 'gemini-2.5-pro', temperature: 0.9 },
    });
    const result = resolveAgentModel('agent_story_brief', withOverride, globalConfig);
    expect(result).toEqual({ model: 'gemini-2.5-pro', temperature: 0.9, source: 'persona_override' });
  });

  it('a persona override for one task never leaks into a different task', () => {
    const withOverride = persona({
      agent_story_brief: { modelId: 'gemini-2.5-pro', temperature: 0.9 },
    });
    // Resolving a DIFFERENT task key must fall through to globalConfig, not the
    // agent_story_brief override.
    const result = resolveAgentModel('agent_seed_story_writing', withOverride, globalConfig);
    expect(result).toEqual({ model: 'gemini-3.5-flash', temperature: 0.4, source: 'global_config' });
  });

  it('an override with a modelId but no temperature falls back to globalConfig temperature, not null', () => {
    const withOverride = persona({ agent_story_brief: { modelId: 'gemini-2.5-pro' } });
    const result = resolveAgentModel('agent_story_brief', withOverride, globalConfig);
    expect(result).toEqual({ model: 'gemini-2.5-pro', temperature: 0.4, source: 'persona_override' });
  });

  it('an override object with no usable modelId is treated as no override at all', () => {
    const malformed = persona({ agent_story_brief: { temperature: 0.9 } });
    const result = resolveAgentModel('agent_story_brief', malformed, globalConfig);
    expect(result).toEqual({ model: 'gemini-3.5-flash', temperature: 0.4, source: 'global_config' });
  });

  it('tolerates a non-object override entry without throwing', () => {
    const malformed = persona({ agent_story_brief: 'gemini-2.5-pro' });
    expect(() => resolveAgentModel('agent_story_brief', malformed, globalConfig)).not.toThrow();
    expect(resolveAgentModel('agent_story_brief', malformed, globalConfig).source).toBe('global_config');
  });

  it('tolerates an undefined persona entirely', () => {
    const result = resolveAgentModel('agent_story_brief', undefined, globalConfig);
    expect(result).toEqual({ model: 'gemini-3.5-flash', temperature: 0.4, source: 'global_config' });
  });
});

describe('validatePersonaModelOverrides', () => {
  function makeRow(overrides: Partial<TextModelRow> = {}): TextModelRow {
    return {
      id: 'row-1',
      model_key: 'openrouter:qwen/qwen3.7-flash',
      provider_key: 'openrouter',
      provider_model_id: 'qwen/qwen3.7-flash',
      display_name: 'Qwen 3.7 Flash (OpenRouter)',
      description: '',
      is_enabled: true,
      capabilities: { structuredOutput: 'json', vision: true, temperature: true },
      default_params: {},
      timeout_ms: 60000,
      input_cost_per_mtok_usd: 0.03,
      output_cost_per_mtok_usd: 0.13,
      cached_input_cost_per_mtok_usd: 0.006,
      required_env_vars: ['OPENROUTER_API_KEY'],
      sort_order: 120,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      updated_by: null,
      ...overrides,
    };
  }

  const enabledRow: TextModelRecord = mapTextModelRow(makeRow());
  const disabledRow: TextModelRecord = mapTextModelRow(makeRow({ model_key: 'openai:gpt-5.6-luna', provider_key: 'openai', provider_model_id: 'gpt-5.6-luna', is_enabled: false }));

  it('accepts an empty or missing overrides bag', () => {
    expect(validatePersonaModelOverrides({}, [enabledRow])).toBeNull();
    expect(validatePersonaModelOverrides(null, [enabledRow])).toBeNull();
    expect(validatePersonaModelOverrides(undefined, [enabledRow])).toBeNull();
  });

  it('accepts an override on a known task key naming an enabled registry model', () => {
    const issue = validatePersonaModelOverrides(
      { agent_story_brief: { modelId: enabledRow.modelKey, temperature: 0.5 } },
      [enabledRow]
    );
    expect(issue).toBeNull();
  });

  it('rejects a task key outside AGENT_TASK_KEYS', () => {
    const issue = validatePersonaModelOverrides({ story_generation: { modelId: enabledRow.modelKey } }, [enabledRow]);
    expect(issue).toMatch(/Unknown agent task key/);
    expect(issue).toContain(AGENT_TASK_KEYS[0]);
  });

  it('rejects a model id that resolves to a disabled row', () => {
    const issue = validatePersonaModelOverrides({ agent_story_brief: { modelId: disabledRow.modelKey } }, [disabledRow]);
    expect(issue).toMatch(/Invalid model override for "agent_story_brief"/);
    expect(issue).toMatch(/disabled/);
  });

  it('rejects an unknown model id against a live registry', () => {
    const issue = validatePersonaModelOverrides({ agent_story_brief: { modelId: 'no-such-model' } }, [enabledRow]);
    expect(issue).toMatch(/not a known text model/);
  });

  it('in legacy mode (registry unavailable), accepts a bare Gemini id and rejects anything else', () => {
    expect(validatePersonaModelOverrides({ agent_story_brief: { modelId: 'gemini-3.5-flash' } }, null)).toBeNull();
    expect(validatePersonaModelOverrides({ agent_story_brief: { modelId: enabledRow.modelKey } }, null)).toMatch(/not a valid Gemini model id/);
  });

  it('skips an entry with no usable modelId, mirroring readPersonaOverride at read time', () => {
    expect(validatePersonaModelOverrides({ agent_story_brief: { temperature: 0.9 } }, [enabledRow])).toBeNull();
    expect(validatePersonaModelOverrides({ agent_story_brief: 'not-an-object' }, [enabledRow])).toBeNull();
  });
});
