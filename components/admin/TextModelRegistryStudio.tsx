'use client';

import { useCallback, useEffect, useState } from 'react';
import FilterDropdown from '@/components/ui/FilterDropdown';
import {
  assignTextModelToTask,
  createAdminTextModel,
  getAdminTextModelRegistry,
  testAdminTextModel,
  updateAdminTextModel,
  type AdminTextModelRecord,
  type AdminTextModelRegistryState,
  type AdminTextModelTestResult,
  type TextTaskModelStatus,
} from '@/app/actions/text-models';
import {
  TEXT_PROVIDER_LABELS,
  TEXT_REASONING_LEVELS,
  suggestModelKey,
  validateTextModelSelection,
  type TextModelDefaultParams,
  type TextProviderKey,
  type TextReasoningLevel,
  type TextStructuredOutputSupport,
} from '@/lib/ai/text-models.shared';

interface FormState {
  providerKey: TextProviderKey;
  providerModelId: string;
  modelKey: string;
  displayName: string;
  description: string;
  structuredOutput: TextStructuredOutputSupport;
  vision: boolean;
  temperature: boolean;
  timeoutMs: string;
  inputCost: string;
  outputCost: string;
  cachedCost: string;
  // Free-text for now; Phase D replaces this with checkboxes limited to
  // PROVIDER_REASONING_LEVELS[provider]. Only a value in TEXT_REASONING_LEVELS is saved.
  reasoningLevel: string;
  maxOutputTokens: string;
}

const EMPTY_FORM: FormState = {
  providerKey: 'openrouter',
  providerModelId: '',
  modelKey: '',
  displayName: '',
  description: '',
  structuredOutput: 'json',
  vision: false,
  temperature: true,
  timeoutMs: '60000',
  inputCost: '',
  outputCost: '',
  cachedCost: '',
  reasoningLevel: '',
  maxOutputTokens: '',
};

const PROVIDER_OPTIONS = (Object.keys(TEXT_PROVIDER_LABELS) as TextProviderKey[]).map((key) => ({
  value: key,
  label: TEXT_PROVIDER_LABELS[key],
}));

const STRUCTURED_OUTPUT_OPTIONS = [
  { value: 'native', label: 'Native schema (provider enforces it)' },
  { value: 'json', label: 'JSON mode (validated in code)' },
  { value: 'none', label: 'None' },
];

const inputClass = 'w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100';

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function formFromRecord(record: AdminTextModelRecord): FormState {
  return {
    providerKey: record.providerKey,
    providerModelId: record.providerModelId,
    modelKey: record.modelKey,
    displayName: record.displayName,
    description: record.description,
    structuredOutput: record.capabilities.structuredOutput,
    vision: record.capabilities.vision,
    temperature: record.capabilities.temperature,
    timeoutMs: record.timeoutMs?.toString() ?? '',
    inputCost: record.inputCostPerMtokUsd?.toString() ?? '',
    outputCost: record.outputCostPerMtokUsd?.toString() ?? '',
    cachedCost: record.cachedInputCostPerMtokUsd?.toString() ?? '',
    reasoningLevel: record.defaultParams.reasoningLevel ?? '',
    maxOutputTokens: record.defaultParams.maxOutputTokens?.toString() ?? '',
  };
}

function formatPrice(record: AdminTextModelRecord): string {
  if (record.inputCostPerMtokUsd == null || record.outputCostPerMtokUsd == null) {
    return record.providerKey === 'gemini' ? 'code price table' : 'no price set';
  }
  return `$${record.inputCostPerMtokUsd} / $${record.outputCostPerMtokUsd} per 1M`;
}

/** Dropdown options for one task's row: every registry model that would actually resolve for
 * that task, plus the currently configured key even when it wouldn't -- so the dropdown never
 * renders with a blank value just because an admin disabled or removed the model mid-flight. */
function buildTaskAssignmentOptions(task: TextTaskModelStatus, records: AdminTextModelRecord[]) {
  const options = records
    .filter((record) => validateTextModelSelection(task.taskKey, record.modelKey, records) === null)
    .map((record) => ({
      value: record.modelKey,
      label: `${record.displayName} — ${TEXT_PROVIDER_LABELS[record.providerKey]}`,
    }));

  if (!options.some((option) => option.value === task.configuredKey)) {
    const configuredRecord = records.find((record) => record.modelKey === task.configuredKey);
    const suffix = configuredRecord ? ' (disabled)' : ' (not in registry)';
    options.unshift({ value: task.configuredKey, label: `${task.configuredKey}${suffix}` });
  }

  return options;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-400">{label}</span>
      {children}
    </label>
  );
}

export default function TextModelRegistryStudio() {
  const [data, setData] = useState<AdminTextModelRegistryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tests, setTests] = useState<Record<string, AdminTextModelTestResult | 'running'>>({});
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const load = useCallback(async () => {
    try {
      setData(await getAdminTextModelRegistry());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load text models.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const updateForm = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));

  const handleSave = () =>
    run(async () => {
      const base = editingId && editingId !== 'new' ? data?.records.find((record) => record.id === editingId) : undefined;
      const maxOutputTokens = numberOrNull(form.maxOutputTokens);
      const trimmedReasoningLevel = form.reasoningLevel.trim();
      const reasoningLevel = (TEXT_REASONING_LEVELS as readonly string[]).includes(trimmedReasoningLevel)
        ? (trimmedReasoningLevel as TextReasoningLevel)
        : undefined;
      const defaultParams: TextModelDefaultParams = {
        ...base?.defaultParams,
        reasoningLevel,
        maxOutputTokens: maxOutputTokens && maxOutputTokens > 0 ? maxOutputTokens : undefined,
      };
      const shared = {
        displayName: form.displayName,
        description: form.description,
        // reasoningLevels isn't editable from this free-text-era form (Phase D adds the
        // checkboxes) -- carry the existing model's levels forward so a save never blanks the
        // list migration 120 seeded, since this object fully replaces the stored capabilities.
        capabilities: {
          structuredOutput: form.structuredOutput,
          vision: form.vision,
          temperature: form.temperature,
          reasoningLevels: base?.capabilities.reasoningLevels ?? [],
        },
        defaultParams,
        timeoutMs: numberOrNull(form.timeoutMs),
        inputCostPerMtokUsd: numberOrNull(form.inputCost),
        outputCostPerMtokUsd: numberOrNull(form.outputCost),
        cachedInputCostPerMtokUsd: numberOrNull(form.cachedCost),
      };
      if (editingId === 'new') {
        const providerModelId = form.providerModelId.trim();
        await createAdminTextModel({
          ...shared,
          modelKey: form.modelKey.trim() || suggestModelKey(form.providerKey, providerModelId),
          providerKey: form.providerKey,
          providerModelId,
          isEnabled: false,
        });
      } else if (editingId) {
        await updateAdminTextModel(editingId, shared);
      }
      setEditingId(null);
    });

  const handleTest = async (id: string) => {
    setTests((current) => ({ ...current, [id]: 'running' }));
    const result = await testAdminTextModel(id);
    setTests((current) => ({ ...current, [id]: result }));
  };

  const fallbackTasks = data?.taskStatus.filter((task) => task.problem) ?? [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">Text Models</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-400">
            Models text tasks can run on. Assign a task to a model in the section below, or in the Story Playground.
            A task pointing at a disabled or unknown model runs on its Gemini default instead.
          </p>
        </div>
        {data?.available && (
          <button
            onClick={() => {
              setForm(EMPTY_FORM);
              setEditingId('new');
            }}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Add model
          </button>
        )}
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {!data && !error && <p className="text-sm text-neutral-500">Loading…</p>}

      {data && !data.available && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          Migration 119 is not applied (or this server started before it was). Text tasks use the legacy Gemini model
          list until it is applied and the server restarts.
        </div>
      )}

      {fallbackTasks.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          <p className="font-medium">These tasks are running on their fallback model:</p>
          <ul className="mt-2 space-y-1">
            {fallbackTasks.map((task) => (
              <li key={task.taskKey}>
                {task.label} — <span className="font-mono">{task.configuredKey}</span>: {task.problem}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data?.available && (
        <div className="space-y-3 rounded-xl border border-white/10 bg-neutral-900/60 p-4">
          <div>
            <h2 className="text-lg font-medium text-neutral-100">Task assignments</h2>
            <p className="mt-1 text-sm text-neutral-400">
              Point any text task at any enabled model, including the agentic tasks (story evaluation, novelty
              assessment, and the rest) which otherwise have no picker of their own.
            </p>
          </div>
          <div className="space-y-2">
            {data.taskStatus.map((task) => (
              <div
                key={task.taskKey}
                className="flex flex-col gap-2 rounded-lg border border-white/5 bg-neutral-950/40 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <p className="text-sm text-neutral-200">{task.label}</p>
                  {task.problem && <p className="mt-1 text-xs text-amber-300">{task.problem}</p>}
                </div>
                <div className={`w-full shrink-0 sm:w-72 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
                  <FilterDropdown
                    value={task.configuredKey}
                    options={buildTaskAssignmentOptions(task, data.records)}
                    onChange={(value) => run(() => assignTextModelToTask(task.taskKey, value))}
                    fullWidth
                    size="form"
                    ariaLabel={`Model for ${task.label}`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {editingId && (
        <div className="space-y-4 rounded-xl border border-white/10 bg-neutral-900/80 p-5 backdrop-blur">
          <h2 className="text-lg font-medium text-neutral-100">{editingId === 'new' ? 'Add text model' : `Edit ${form.displayName}`}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {editingId === 'new' && (
              <>
                <Field label="Provider">
                  <FilterDropdown value={form.providerKey} options={PROVIDER_OPTIONS} onChange={(value) => updateForm({ providerKey: value as TextProviderKey })} fullWidth />
                </Field>
                <Field label="Provider model id (exactly as the provider names it)">
                  <input className={inputClass} value={form.providerModelId} onChange={(event) => updateForm({ providerModelId: event.target.value })} />
                </Field>
                <Field label="Model key (permanent; leave blank to use the suggestion)">
                  <input
                    className={inputClass}
                    value={form.modelKey}
                    placeholder={form.providerModelId ? suggestModelKey(form.providerKey, form.providerModelId.trim()) : ''}
                    onChange={(event) => updateForm({ modelKey: event.target.value })}
                  />
                </Field>
              </>
            )}
            <Field label="Display name">
              <input className={inputClass} value={form.displayName} onChange={(event) => updateForm({ displayName: event.target.value })} />
            </Field>
            <Field label="Description">
              <input className={inputClass} value={form.description} onChange={(event) => updateForm({ description: event.target.value })} />
            </Field>
            <Field label="Structured output">
              <FilterDropdown
                value={form.structuredOutput}
                options={STRUCTURED_OUTPUT_OPTIONS}
                onChange={(value) => updateForm({ structuredOutput: value as TextStructuredOutputSupport })}
                fullWidth
              />
            </Field>
            <Field label="Timeout (ms, blank = global text timeout)">
              <input className={inputClass} value={form.timeoutMs} onChange={(event) => updateForm({ timeoutMs: event.target.value })} />
            </Field>
            <Field label="Input $ per 1M tokens">
              <input className={inputClass} value={form.inputCost} onChange={(event) => updateForm({ inputCost: event.target.value })} />
            </Field>
            <Field label="Output $ per 1M tokens">
              <input className={inputClass} value={form.outputCost} onChange={(event) => updateForm({ outputCost: event.target.value })} />
            </Field>
            <Field label="Cached input $ per 1M tokens">
              <input className={inputClass} value={form.cachedCost} onChange={(event) => updateForm({ cachedCost: event.target.value })} />
            </Field>
            <Field label={`Default thinking level (optional; one of ${TEXT_REASONING_LEVELS.join(', ')})`}>
              <input className={inputClass} value={form.reasoningLevel} onChange={(event) => updateForm({ reasoningLevel: event.target.value })} />
            </Field>
            <Field label="Max output tokens (optional)">
              <input className={inputClass} value={form.maxOutputTokens} onChange={(event) => updateForm({ maxOutputTokens: event.target.value })} />
            </Field>
            <div className="flex items-center gap-6 pt-5 text-sm text-neutral-300">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.vision} onChange={(event) => updateForm({ vision: event.target.checked })} className="accent-emerald-500" />
                Accepts images
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.temperature} onChange={(event) => updateForm({ temperature: event.target.checked })} className="accent-emerald-500" />
                Accepts temperature
              </label>
            </div>
          </div>
          <div className="flex gap-3">
            <button disabled={busy} onClick={handleSave} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
              Save
            </button>
            <button onClick={() => setEditingId(null)} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-neutral-300 hover:bg-white/5">
              Cancel
            </button>
          </div>
          {editingId === 'new' && <p className="text-xs text-neutral-500">New models are saved disabled. Enable one once its provider key is set and a test passes.</p>}
        </div>
      )}

      {data?.available && (
        <div className="space-y-3">
          {data.records.map((record) => {
            const test = tests[record.id];
            const usedBy = data.taskStatus.filter((task) => task.configuredKey === record.modelKey).map((task) => task.label);
            return (
              <div key={record.id} className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-neutral-100">
                      {record.displayName}
                      <span className={`ml-2 rounded px-2 py-0.5 text-xs ${record.isEnabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-neutral-700/60 text-neutral-400'}`}>
                        {record.isEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-neutral-400">
                      {record.modelKey} · {TEXT_PROVIDER_LABELS[record.providerKey]} · {record.providerModelId}
                    </p>
                    {record.description && <p className="mt-1 text-xs text-neutral-500">{record.description}</p>}
                    <p className="mt-1 text-xs text-neutral-500">
                      {record.capabilities.structuredOutput} output · {record.capabilities.vision ? 'images' : 'text only'} ·{' '}
                      {record.capabilities.temperature ? 'temperature' : 'no temperature'} · {formatPrice(record)}
                      {record.timeoutMs ? ` · ${record.timeoutMs}ms timeout` : ''}
                    </p>
                    {record.missingEnvVars.length > 0 && (
                      <p className="mt-1 text-xs text-amber-300">Missing on server: {record.missingEnvVars.join(', ')}</p>
                    )}
                    {usedBy.length > 0 && <p className="mt-1 text-xs text-indigo-300">Used by: {usedBy.join(', ')}</p>}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      disabled={busy}
                      onClick={() => run(() => updateAdminTextModel(record.id, { isEnabled: !record.isEnabled }))}
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-neutral-200 hover:bg-white/5 disabled:opacity-50"
                    >
                      {record.isEnabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      disabled={test === 'running' || record.missingEnvVars.length > 0}
                      onClick={() => void handleTest(record.id)}
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-neutral-200 hover:bg-white/5 disabled:opacity-50"
                    >
                      {test === 'running' ? 'Testing…' : 'Test'}
                    </button>
                    <button
                      onClick={() => {
                        setForm(formFromRecord(record));
                        setEditingId(record.id);
                      }}
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-neutral-200 hover:bg-white/5"
                    >
                      Edit
                    </button>
                  </div>
                </div>
                {test && test !== 'running' && (
                  <p className={`mt-2 text-xs ${test.ok ? 'text-emerald-300' : 'text-red-300'}`}>
                    {test.ok
                      ? `OK in ${test.latencyMs}ms · ${test.inputTokens ?? 0} in / ${test.outputTokens ?? 0} out tokens${test.costUsd != null ? ` · $${test.costUsd.toFixed(6)}` : ''} · "${test.text}"`
                      : `${test.category ? `[${test.category}] ` : ''}${test.error}`}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
