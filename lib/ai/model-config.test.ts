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

interface CbfRow {
  task_key: string;
  content_block_fallback_model_id: string | null;
}

interface AdminClientOptions {
  wideSingle?: () => { data: Row | null; error: { code?: string; message?: string } | null };
  narrowSingle?: () => { data: Row | null; error: { code?: string; message?: string } | null };
  existingSingle?: () => { data: { model_id: string; temperature: number | null } | null; error: { code?: string; message?: string } | null };
  wideAll?: () => { data: Row[] | null; error: { code?: string; message?: string } | null };
  narrowAll?: () => { data: Row[] | null; error: { code?: string; message?: string } | null };
  upsert?: (payload: Record<string, unknown>) => { error: { message: string } | null };
  /** migration 121's own query shape: .select('task_key, content_block_fallback_model_id').eq().maybeSingle() */
  cbfMaybeSingle?: () => { data: CbfRow | null; error: { code?: string; message?: string } | null };
  /** Same select, but .order() for every row -- getAllContentBlockFallbacks. */
  cbfAll?: () => { data: CbfRow[] | null; error: { code?: string; message?: string } | null };
}

/** A minimal fake for the `model_config` table covering exactly the query shapes
 * lib/ai/model-config.ts issues: a wide select (with reasoning_level) that may fail with a
 * missing-column error and fall back to a narrow one, both for a single task_key (.eq().single())
 * and for every row (.order()), the two-column existing-row lookup and upsert both
 * updateTaskReasoningLevel and updateTaskContentBlockFallback use, and migration 121's own
 * task_key/content_block_fallback_model_id select (.eq().maybeSingle() and .order()). */
function makeAdminClient(opts: AdminClientOptions) {
  const calls = { wideSingle: 0, narrowSingle: 0, existingSingle: 0, wideAll: 0, narrowAll: 0, upsert: 0, cbfMaybeSingle: 0, cbfAll: 0 };
  const client = {
    from: (table: string) => {
      if (table !== 'model_config') throw new Error(`unexpected table: ${table}`);
      return {
        select: (cols: string) => {
          const isWide = cols.includes('reasoning_level');
          const isExisting = cols === 'model_id, temperature';
          const isCbf = cols === 'task_key, content_block_fallback_model_id';
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
              maybeSingle: async () => {
                calls.cbfMaybeSingle++;
                return opts.cbfMaybeSingle ? opts.cbfMaybeSingle() : { data: null, error: null };
              },
            }),
            order: async () => {
              if (isCbf) {
                calls.cbfAll++;
                return opts.cbfAll ? opts.cbfAll() : { data: [], error: null };
              }
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

  it('a PGRST116 ("no row") result is cached for the normal TTL: a second call for the same task makes no query', async () => {
    const { client, calls } = makeAdminClient({
      wideSingle: () => ({ data: null, error: { code: 'PGRST116', message: 'no rows' } }),
    });
    adminState.client = client;
    const { getModelConfig } = await import('@/lib/ai/model-config');
    const fallback = DEFAULT_MODELS.story_generation;

    expect(await getModelConfig('story_generation')).toEqual({ model: fallback.modelId, temperature: fallback.temperature, reasoningLevel: null });
    expect(await getModelConfig('story_generation')).toEqual({ model: fallback.modelId, temperature: fallback.temperature, reasoningLevel: null });

    expect(calls.wideSingle).toBe(1); // second call served from cache
  });

  it('a non-PGRST116 error is NOT cached: a second call for the same task queries again', async () => {
    const { client, calls } = makeAdminClient({
      wideSingle: () => ({ data: null, error: { code: '57014', message: 'statement timeout' } }),
    });
    adminState.client = client;
    const { getModelConfig } = await import('@/lib/ai/model-config');

    await getModelConfig('story_generation');
    await getModelConfig('story_generation');

    expect(calls.wideSingle).toBe(2); // not cached -- both calls hit the database
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

// ── Migration 121: content_block_fallback_model_id ──────────────────────────────────────────
//
// Same shape of coverage as the reasoning_level suites above, plus explicit cross-latch checks:
// per GOTCHAS.md "Column-availability latches are per migration group", a missing-column error
// on this feature's own query must never latch (or be latched by) the reasoning_level one, even
// though both classifiers accept the same 42703 / PGRST204 codes.

describe('getContentBlockFallbackModel', () => {
  it('returns the configured fallback key when a row has one set', async () => {
    const { client } = makeAdminClient({
      cbfMaybeSingle: () => ({ data: { task_key: 'visual_prompt', content_block_fallback_model_id: 'gemini-3.8-flash' }, error: null }),
    });
    adminState.client = client;
    const { getContentBlockFallbackModel } = await import('@/lib/ai/model-config');
    expect(await getContentBlockFallbackModel('visual_prompt')).toBe('gemini-3.8-flash');
  });

  it('returns null for a row with no fallback set -- not an error, and does not latch', async () => {
    const { client, calls } = makeAdminClient({
      cbfMaybeSingle: () => ({ data: { task_key: 'visual_prompt', content_block_fallback_model_id: null }, error: null }),
    });
    adminState.client = client;
    const { getContentBlockFallbackModel, isContentBlockFallbackColumnAvailable } = await import('@/lib/ai/model-config');
    expect(await getContentBlockFallbackModel('visual_prompt')).toBeNull();
    expect(await isContentBlockFallbackColumnAvailable()).toBe(true);
    expect(calls.cbfMaybeSingle).toBe(1); // the isContentBlockFallbackColumnAvailable check above used the already-known state
  });

  it('null (no row at all, .maybeSingle()) also returns null without latching', async () => {
    const { client } = makeAdminClient({ cbfMaybeSingle: () => ({ data: null, error: null }) });
    adminState.client = client;
    const { getContentBlockFallbackModel } = await import('@/lib/ai/model-config');
    expect(await getContentBlockFallbackModel('visual_prompt')).toBeNull();
  });

  it('a 42703 latches this feature only -- a reasoning_level read for the same task is unaffected', async () => {
    const { client, calls } = makeAdminClient({
      cbfMaybeSingle: () => ({ data: null, error: { code: '42703', message: 'column model_config.content_block_fallback_model_id does not exist' } }),
      wideSingle: () => ({
        data: { task_key: 'story_generation', model_id: 'gemini-3.8-flash', temperature: 0.7, reasoning_level: 'low', updated_at: '2026-01-01T00:00:00.000Z' },
        error: null,
      }),
    });
    adminState.client = client;
    const {
      getContentBlockFallbackModel,
      getModelConfig,
      isContentBlockFallbackColumnAvailable,
      isReasoningLevelColumnAvailable,
    } = await import('@/lib/ai/model-config');

    expect(await getContentBlockFallbackModel('story_generation')).toBeNull();
    expect(await isContentBlockFallbackColumnAvailable()).toBe(false);

    // Separate flag -- the reasoning_level query still runs and succeeds normally.
    expect(await getModelConfig('story_generation')).toEqual({ model: 'gemini-3.8-flash', temperature: 0.7, reasoningLevel: 'low' });
    expect(await isReasoningLevelColumnAvailable()).toBe(true);

    // A second content-block-fallback read is short-circuited by its own latch -- no further query.
    await getContentBlockFallbackModel('story_generation');
    expect(calls.cbfMaybeSingle).toBe(1);
  });

  it('a PGRST204 also latches (PostgREST schema-cache variant)', async () => {
    const { client } = makeAdminClient({
      cbfMaybeSingle: () => ({ data: null, error: { code: 'PGRST204', message: 'schema cache miss' } }),
    });
    adminState.client = client;
    const { getContentBlockFallbackModel, isContentBlockFallbackColumnAvailable } = await import('@/lib/ai/model-config');
    expect(await getContentBlockFallbackModel('visual_prompt')).toBeNull();
    expect(await isContentBlockFallbackColumnAvailable()).toBe(false);
  });

  it('an unrelated error returns null without latching -- a later call is not skipped', async () => {
    let callNum = 0;
    const { client, calls } = makeAdminClient({
      cbfMaybeSingle: () => {
        callNum += 1;
        return callNum === 1
          ? { data: null, error: { code: '57014', message: 'statement timeout' } }
          : { data: { task_key: 'visual_prompt', content_block_fallback_model_id: 'gemini-3.8-flash' }, error: null };
      },
    });
    adminState.client = client;
    const { getContentBlockFallbackModel } = await import('@/lib/ai/model-config');

    expect(await getContentBlockFallbackModel('visual_prompt')).toBeNull();
    expect(await getContentBlockFallbackModel('visual_prompt')).toBe('gemini-3.8-flash');
    expect(calls.cbfMaybeSingle).toBe(2); // neither call was skipped by a falsely-set latch
  });
});

describe('getAllContentBlockFallbacks', () => {
  it('builds a Map skipping tasks with no fallback set', async () => {
    const { client } = makeAdminClient({
      cbfAll: () => ({
        data: [
          { task_key: 'visual_prompt', content_block_fallback_model_id: 'gemini-3.8-flash' },
          { task_key: 'story_generation', content_block_fallback_model_id: null },
        ],
        error: null,
      }),
    });
    adminState.client = client;
    const { getAllContentBlockFallbacks } = await import('@/lib/ai/model-config');
    const map = await getAllContentBlockFallbacks();
    expect(map.get('visual_prompt')).toBe('gemini-3.8-flash');
    expect(map.has('story_generation')).toBe(false);
  });

  it('a missing column returns an empty Map and latches', async () => {
    const { client } = makeAdminClient({
      cbfAll: () => ({ data: null, error: { code: '42703', message: 'missing column' } }),
    });
    adminState.client = client;
    const { getAllContentBlockFallbacks, isContentBlockFallbackColumnAvailable } = await import('@/lib/ai/model-config');
    expect(await getAllContentBlockFallbacks()).toEqual(new Map());
    expect(await isContentBlockFallbackColumnAvailable()).toBe(false);
  });
});

describe('isContentBlockFallbackColumnAvailable', () => {
  it('probes once via getAllContentBlockFallbacks and returns true when the column reads fine', async () => {
    const { client, calls } = makeAdminClient({ cbfAll: () => ({ data: [], error: null }) });
    adminState.client = client;
    const { isContentBlockFallbackColumnAvailable } = await import('@/lib/ai/model-config');
    expect(await isContentBlockFallbackColumnAvailable()).toBe(true);
    expect(await isContentBlockFallbackColumnAvailable()).toBe(true);
    expect(calls.cbfAll).toBe(1); // second call used the already-known state, no re-probe
  });
});

describe('updateTaskContentBlockFallback', () => {
  it('throws "Migration 121 is not applied." and writes nothing when the column is unavailable', async () => {
    const { client, calls } = makeAdminClient({
      cbfAll: () => ({ data: null, error: { code: '42703', message: 'missing column' } }),
    });
    adminState.client = client;
    const { updateTaskContentBlockFallback } = await import('@/lib/ai/model-config');
    await expect(updateTaskContentBlockFallback('visual_prompt', 'gemini-3.8-flash')).rejects.toThrow('Migration 121 is not applied.');
    expect(calls.upsert).toBe(0);
  });

  it('upserts the full row, carrying forward the existing model and temperature', async () => {
    let capturedPayload: Record<string, unknown> | null = null;
    const { client } = makeAdminClient({
      cbfAll: () => ({ data: [], error: null }),
      existingSingle: () => ({ data: { model_id: 'gemini-3.5-flash', temperature: 0.7 }, error: null }),
      upsert: (payload) => {
        capturedPayload = payload;
        return { error: null };
      },
    });
    adminState.client = client;
    const { updateTaskContentBlockFallback } = await import('@/lib/ai/model-config');
    await updateTaskContentBlockFallback('visual_prompt', 'gemini-3.8-flash');
    expect(capturedPayload).toMatchObject({
      task_key: 'visual_prompt',
      model_id: 'gemini-3.5-flash',
      temperature: 0.7,
      content_block_fallback_model_id: 'gemini-3.8-flash',
    });
  });

  it('falls back to DEFAULT_MODELS for model/temperature when no row exists yet', async () => {
    let capturedPayload: Record<string, unknown> | null = null;
    const { client } = makeAdminClient({
      cbfAll: () => ({ data: [], error: null }),
      existingSingle: () => ({ data: null, error: { code: 'PGRST116', message: 'no rows' } }),
      upsert: (payload) => {
        capturedPayload = payload;
        return { error: null };
      },
    });
    adminState.client = client;
    const { updateTaskContentBlockFallback } = await import('@/lib/ai/model-config');
    const fallback = DEFAULT_MODELS.agent_novelty_assessment;
    await updateTaskContentBlockFallback('agent_novelty_assessment', 'gemini-3.8-flash');
    expect(capturedPayload).toMatchObject({
      task_key: 'agent_novelty_assessment',
      model_id: fallback.modelId,
      temperature: fallback.temperature,
      content_block_fallback_model_id: 'gemini-3.8-flash',
    });
  });

  it('null clears the fallback', async () => {
    let capturedPayload: Record<string, unknown> | null = null;
    const { client } = makeAdminClient({
      cbfAll: () => ({ data: [], error: null }),
      existingSingle: () => ({ data: { model_id: 'gemini-3.8-flash', temperature: 0.4 }, error: null }),
      upsert: (payload) => {
        capturedPayload = payload;
        return { error: null };
      },
    });
    adminState.client = client;
    const { updateTaskContentBlockFallback } = await import('@/lib/ai/model-config');
    await updateTaskContentBlockFallback('visual_prompt', null);
    expect(capturedPayload).toMatchObject({ content_block_fallback_model_id: null });
  });
});
