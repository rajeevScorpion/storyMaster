import { describe, expect, it } from 'vitest';
import {
  AGENT_TASK_KEYS,
  AGENT_TASK_ROLES,
  resolveAgentModel,
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
