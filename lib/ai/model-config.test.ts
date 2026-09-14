// Phase B/thinking-plan: the model_config.reasoning_level column-availability latch (migration
// 120). Per GOTCHAS.md "Column-availability latches are per migration group", classification is
// by which query ran (this module's own wide select, which is the only query here that ever
// asks for reasoning_level), never by the error text alone -- 42703 and PGRST204 both mean
// "migration 120 absent" here, while PGRST116 ("no row for this task_key", raised by .single())
// must NOT latch: it is normal "task has no override row" and predates this migration entirely.
//
// Each test dynamically imports a fresh copy of lib/ai/model-config after vi.resetModules() so
// the module-level latch/cache state never leaks between tests -- this file's whole point is
// that state.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const { adminState } = vi.hoisted(() => ({ adminState: { client: null as any } }));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => adminState.client,
}));

import { DEFAULT_MODELS } from '@/lib/ai/model-config.shared';

interface Row {
  task_key: string;
  model_id: string;
  temperature: number | null;
  reasoning_level?: string | null;
  updated_at: string;
}

interface AdminClientOptions {
  wideSingle?: () => { data: Row | null; error: { code?: string; message?: string } | null };
  narrowSingle?: () => { data: Row | null; error: { code?: string; message?: string } | null };
  existingSingle?: () => { data: { model_id: string; temperature: number | null } | null; error: { code?: string; message?: string } | null };
  wideAll?: () => { data: Row[] | null; error: { code?: string; message?: string } | null };
  narrowAll?: () => { data: Row[] | null; error: { code?: string; message?: string } | null };
  upsert?: (payload: Record<string, unknown>) => { error: { message: string } | null };
}

/** A minimal fake for the `model_config` table covering exactly the query shapes
 * lib/ai/model-config.ts issues: a wide select (with reasoning_level) that may fail with a
 * missing-column error and fall back to a narrow one, both for a single task_key (.eq().single())
 * and for every row (.order()), plus the two-column existing-row lookup and the upsert that
 * updateTaskReasoningLevel uses. */
function makeAdminClient(opts: AdminClientOptions) {
  const calls = { wideSingle: 0, narrowSingle: 0, existingSingle: 0, wideAll: 0, narrowAll: 0, upsert: 0 };
  const client = {
    from: (table: string) => {
      if (table !== 'model_config') throw new Error(`unexpected table: ${table}`);
      return {
        select: (cols: string) => {
          const isWide = cols.includes('reasoning_level');
          const isExisting = cols === 'model_id, temperature';
          return {
            eq: () => ({
              single: async () => {
                if (isExisting) {
                  calls.existingSingle++;
                  return opts.existingSingle ? opts.existingSingle() : { data: null, error: null };
                }
                if (isWide) {
                  calls.wideSingle++;
                  return opts.wideSingle ? opts.wideSingle() : { data: null, error: null };
                }
                calls.narrowSingle++;
                return opts.narrowSingle ? opts.narrowSingle() : { data: null, error: null };
              },
            }),
            order: async () => {
              if (isWide) {
                calls.wideAll++;
                return opts.wideAll ? opts.wideAll() : { data: [], error: null };
              }
              calls.narrowAll++;
              return opts.narrowAll ? opts.narrowAll() : { data: [], error: null };
            },
          };
        },
        upsert: async (payload: Record<string, unknown>) => {
          calls.upsert++;
          return opts.upsert ? opts.upsert(payload) : { error: null };
        },
      };
    },
  };
  return { client, calls };
}

beforeEach(() => {
  vi.resetModules();
  adminState.client = null;
});

describe('getModelConfig', () => {
  it('a successful wide select returns the model with its stored reasoning level', async () => {
    const { client } = makeAdminClient({
      wideSingle: () => ({
        data: { task_key: 'story_generation', model_id: 'gemini-3.8-flash', temperature: 0.7, reasoning_level: 'low', updated_at: '2026-01-01T00:00:00.000Z' },
        error: null,
      }),
    });
    adminState.client = client;
    const { getModelConfig } = await import('@/lib/ai/model-config');
    expect(await getModelConfig('story_generation')).toEqual({ model: 'gemini-3.8-flash', temperature: 0.7, reasoningLevel: 'low' });
  });

  it('a 42703 on the wide select retries narrow and returns the model with reasoningLevel: null', async () => {
    const { client, calls } = makeAdminClient({
      wideSingle: () => ({ data: null, error: { code: '42703', message: 'column model_config.reasoning_level does not exist' } }),
      narrowSingle: () => ({
        data: { task_key: 'story_generation', model_id: 'gemini-3.5-flash', temperature: 0.7, updated_at: '2026-01-01T00:00:00.000Z' },
        error: null,
      }),
    });
    adminState.client = client;
    const { getModelConfig } = await import('@/lib/ai/model-config');
    expect(await getModelConfig('story_generation')).toEqual({ model: 'gemini-3.5-flash', temperature: 0.7, reasoningLevel: null });
    expect(calls.wideSingle).toBe(1);
    expect(calls.narrowSingle).toBe(1);
  });

  it('a PGRST204 on the wide select also retries narrow (PostgREST schema-cache variant)', async () => {
    const { client, calls } = makeAdminClient({
      wideSingle: () => ({ data: null, error: { code: 'PGRST204', message: 'schema cache miss' } }),
      narrowSingle: () => ({
        data: { task_key: 'story_generation', model_id: 'gemini-3.5-flash', temperature: 0.7, updated_at: '2026-01-01T00:00:00.000Z' },
        error: null,
      }),
    });
    adminState.client = client;
    const { getModelConfig } = await import('@/lib/ai/model-config');
    expect(await getModelConfig('story_generation')).toEqual({ model: 'gemini-3.5-flash', temperature: 0.7, reasoningLevel: null });
    expect(calls.wideSingle).toBe(1);
    expect(calls.narrowSingle).toBe(1);
  });

  it('the latch sticks within a process: a later call for a different task skips straight to narrow', async () => {
    // Each row's task_key must match the task actually queried -- getModelConfig caches by
    // config.taskKey (from the response), and a mismatched fixture would silently serve the
    // first task's cached result back for the second, hiding the very thing under test.
    const rowsByTask: Record<string, Row> = {
      story_generation: { task_key: 'story_generation', model_id: 'gemini-3.5-flash', temperature: 0.7, updated_at: '2026-01-01T00:00:00.000Z' },
      reel_story_generation: { task_key: 'reel_story_generation', model_id: 'gemini-3.5-flash', temperature: 0.7, updated_at: '2026-01-01T00:00:00.000Z' },
    };
    const queriedTasks: string[] = [];
    const { client, calls } = makeAdminClient({
      wideSingle: () => ({ data: null, error: { code: '42703', message: 'missing column' } }),
      narrowSingle: () => ({ data: rowsByTask[queriedTasks[queriedTasks.length - 1]], error: null }),
    });
    adminState.client = client;
    const { getModelConfig } = await import('@/lib/ai/model-config');
    queriedTasks.push('story_generation');
    await getModelConfig('story_generation');
    queriedTasks.push('reel_story_generation');
    await getModelConfig('reel_story_generation');
    expect(calls.wideSingle).toBe(1); // latched after the first miss -- never probed again
    expect(calls.narrowSingle).toBe(2);
  });

  it('PGRST116 ("no row for this task") does NOT latch -- it is normal, not a migration problem', async () => {
    const { client, calls } = makeAdminClient({
      wideSingle: () => ({ data: null, error: { code: 'PGRST116', message: 'no rows' } }),
    });
    adminState.client = client;
    const { getModelConfig } = await import('@/lib/ai/model-config');

    const fallback1 = DEFAULT_MODELS.story_generation;
    expect(await getModelConfig('story_generation')).toEqual({ model: fallback1.modelId, temperature: fallback1.temperature, reasoningLevel: null });

    const fallback2 = DEFAULT_MODELS.reel_story_generation;
    expect(await getModelConfig('reel_story_generation')).toEqual({ model: fallback2.modelId, temperature: fallback2.temperature, reasoningLevel: null });

    // Not latched: both calls attempted the wide select, and neither fell back to narrow.
    expect(calls.wideSingle).toBe(2);
    expect(calls.narrowSingle).toBe(0);
  });

  it('an unrelated error code falls back to defaults without touching the latch', async () => {
    const { client, calls } = makeAdminClient({
      wideSingle: () => ({ data: null, error: { code: '57014', message: 'statement timeout' } }),
    });
    adminState.client = client;
    const { getModelConfig } = await import('@/lib/ai/model-config');
    const fallback = DEFAULT_MODELS.story_generation;
    expect(await getModelConfig('story_generation')).toEqual({ model: fallback.modelId, temperature: fallback.temperature, reasoningLevel: null });
    expect(calls.narrowSingle).toBe(0);
  });
});

describe('getAllModelConfigs', () => {
  it('a missing column on the wide select retries narrow for every row', async () => {
    const { client, calls } = makeAdminClient({
      wideAll: () => ({ data: null, error: { code: '42703', message: 'missing column' } }),
      narrowAll: () => ({
        data: [{ task_key: 'story_generation', model_id: 'gemini-3.5-flash', temperature: 0.7, updated_at: '2026-01-01T00:00:00.000Z' }],
        error: null,
      }),
    });
    adminState.client = client;
    const { getAllModelConfigs } = await import('@/lib/ai/model-config');
    const configs = await getAllModelConfigs();
    expect(configs).toEqual([
      { taskKey: 'story_generation', modelId: 'gemini-3.5-flash', temperature: 0.7, reasoningLevel: null, updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(calls.wideAll).toBe(1);
    expect(calls.narrowAll).toBe(1);
  });

  it('a successful wide select maps reasoning_level per row, defaulting an unrecognised value to null', async () => {
    const { client } = makeAdminClient({
      wideAll: () => ({
        data: [
          { task_key: 'graphic_style_extraction', model_id: 'gemini-3.8-flash', temperature: 0.4, reasoning_level: 'low', updated_at: '2026-01-01T00:00:00.000Z' },
          { task_key: 'story_generation', model_id: 'gemini-3.5-flash', temperature: 0.7, reasoning_level: 'not-a-level', updated_at: '2026-01-01T00:00:00.000Z' },
        ],
        error: null,
      }),
    });
    adminState.client = client;
    const { getAllModelConfigs } = await import('@/lib/ai/model-config');
    const configs = await getAllModelConfigs();
    expect(configs.find((c) => c.taskKey === 'graphic_style_extraction')?.reasoningLevel).toBe('low');
    expect(configs.find((c) => c.taskKey === 'story_generation')?.reasoningLevel).toBeNull();
  });
});

describe('isReasoningLevelColumnAvailable', () => {
  it('probes once via getAllModelConfigs and returns true when the column reads fine', async () => {
    const { client, calls } = makeAdminClient({
      wideAll: () => ({ data: [], error: null }),
    });
    adminState.client = client;
    const { isReasoningLevelColumnAvailable } = await import('@/lib/ai/model-config');
    expect(await isReasoningLevelColumnAvailable()).toBe(true);
    expect(await isReasoningLevelColumnAvailable()).toBe(true);
    expect(calls.wideAll).toBe(1); // second call used the already-known state, no re-probe
  });

  it('returns false when the wide select reports the column missing', async () => {
    const { client } = makeAdminClient({
      wideAll: () => ({ data: null, error: { code: '42703', message: 'missing column' } }),
      narrowAll: () => ({ data: [], error: null }),
    });
    adminState.client = client;
    const { isReasoningLevelColumnAvailable } = await import('@/lib/ai/model-config');
    expect(await isReasoningLevelColumnAvailable()).toBe(false);
  });
});

describe('updateTaskReasoningLevel', () => {
  it('throws "Migration 120 is not applied." and writes nothing when the column is unavailable', async () => {
    const { client, calls } = makeAdminClient({
      wideAll: () => ({ data: null, error: { code: '42703', message: 'missing column' } }),
      narrowAll: () => ({ data: [], error: null }),
    });
    adminState.client = client;
    const { updateTaskReasoningLevel } = await import('@/lib/ai/model-config');
    await expect(updateTaskReasoningLevel('story_generation', 'low')).rejects.toThrow('Migration 120 is not applied.');
    expect(calls.upsert).toBe(0);
  });

  it('upserts the full row, carrying forward the existing model and temperature', async () => {
    let capturedPayload: Record<string, unknown> | null = null;
    const { client } = makeAdminClient({
      wideAll: () => ({ data: [], error: null }),
      existingSingle: () => ({ data: { model_id: 'gemini-3.8-flash', temperature: 0.4 }, error: null }),
      upsert: (payload) => {
        capturedPayload = payload;
        return { error: null };
      },
    });
    adminState.client = client;
    const { updateTaskReasoningLevel } = await import('@/lib/ai/model-config');
    await updateTaskReasoningLevel('graphic_style_extraction', 'medium');
    expect(capturedPayload).toMatchObject({
      task_key: 'graphic_style_extraction',
      model_id: 'gemini-3.8-flash',
      temperature: 0.4,
      reasoning_level: 'medium',
    });
  });

  it('falls back to DEFAULT_MODELS for model/temperature when no row exists yet', async () => {
    let capturedPayload: Record<string, unknown> | null = null;
    const { client } = makeAdminClient({
      wideAll: () => ({ data: [], error: null }),
      existingSingle: () => ({ data: null, error: { code: 'PGRST116', message: 'no rows' } }),
      upsert: (payload) => {
        capturedPayload = payload;
        return { error: null };
      },
    });
    adminState.client = client;
    const { updateTaskReasoningLevel } = await import('@/lib/ai/model-config');
    const fallback = DEFAULT_MODELS.agent_novelty_assessment;
    await updateTaskReasoningLevel('agent_novelty_assessment', 'low');
    expect(capturedPayload).toMatchObject({
      task_key: 'agent_novelty_assessment',
      model_id: fallback.modelId,
      temperature: fallback.temperature,
      reasoning_level: 'low',
    });
  });

  it('null clears the override', async () => {
    let capturedPayload: Record<string, unknown> | null = null;
    const { client } = makeAdminClient({
      wideAll: () => ({ data: [], error: null }),
      existingSingle: () => ({ data: { model_id: 'gemini-3.8-flash', temperature: 0.4 }, error: null }),
      upsert: (payload) => {
        capturedPayload = payload;
        return { error: null };
      },
    });
    adminState.client = client;
    const { updateTaskReasoningLevel } = await import('@/lib/ai/model-config');
    await updateTaskReasoningLevel('graphic_style_extraction', null);
    expect(capturedPayload).toMatchObject({ reasoning_level: null });
  });
});
