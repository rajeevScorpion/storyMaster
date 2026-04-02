'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  Clock,
  Coins,
  Cpu,
  FileText,
  Hash,
  History,
  Loader2,
  Play,
  RotateCcw,
  Save,
  Upload,
} from 'lucide-react';
import { getActiveModelConfigs } from '@/app/actions/admin';
import {
  applyModelToProduction,
  getPromptPlaygroundStateAction,
  publishPromptDraftAction,
  restorePromptVersionToDraftAction,
  runPlaygroundTest,
  savePromptDraftAction,
  type PlaygroundPromptState,
  type TestResult,
} from '@/app/actions/prompt-playground';
import type { ModelConfig, TaskKey } from '@/lib/ai/model-config.shared';
import { DEFAULT_MODELS, KNOWN_MODELS, TASK_DEFINITIONS } from '@/lib/ai/model-config.shared';
import {
  PROMPT_TASK_DEFINITIONS,
  PROMPT_TASK_KEYS,
  type PromptTaskKey,
  isPromptTaskKey,
  validatePromptTemplate,
} from '@/lib/ai/prompt-config.shared';
import { formatCost, formatLatency } from '@/lib/ai/pricing';

const AVAILABLE_VOICES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede',
  'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
  'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
];

const DEFAULT_INPUTS: Record<TaskKey, Record<string, string>> = {
  story_generation: {
    userPrompt: 'A brave knight discovers a hidden door in an ancient castle',
    language: 'english',
    storyConfig: '- Language: english\n- Age Group: all_ages\n- Setting/Country: generic\n- Maximum Beats: 6\n- Current Beat: 1 of 6',
    storyState: '{}',
    selectedOptionLabel: 'None yet - first beat',
  },
  visual_prompt: {
    sceneDescription: 'A moonlit garden with glowing fireflies and an old stone fountain',
    characters: '[]',
    visualStyle: 'cinematic storybook illustration',
  },
  image_generation: {
    prompt: 'A mystical forest at dawn with golden light filtering through ancient trees, cinematic storybook illustration',
  },
  tts: {
    storyText: 'Once upon a time, in a land far away, there lived a curious young fox who dreamed of touching the stars.',
    genre: 'adventure',
    tone: 'playful',
    language: 'english',
    voice: 'Sulafat',
  },
  portrait_generation: {
    characterName: 'Miko',
    characterAppearance: 'small golden-brown monkey with a curled tail and expressive amber eyes, wearing a tiny red vest',
    characterType: 'monkey',
    visualStyle: 'cinematic storybook illustration',
  },
  voice_selection: {
    genre: 'fantasy',
    tone: 'whimsical',
    targetAge: 'all_ages',
    language: 'english',
  },
};

function getModelsForTask(taskKey: TaskKey): string[] {
  if (taskKey === 'image_generation' || taskKey === 'portrait_generation') return KNOWN_MODELS.image;
  if (taskKey === 'tts') return KNOWN_MODELS.tts;
  return KNOWN_MODELS.text;
}

function taskHasTemperature(taskKey: TaskKey): boolean {
  return taskKey !== 'image_generation' && taskKey !== 'portrait_generation' && taskKey !== 'tts';
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return 'Code default';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

function formatProductionConfig(modelId: string | undefined, temperature: number | null | undefined, includeTemperature: boolean): string {
  if (!modelId) return 'Not configured';
  if (!includeTemperature || temperature == null) return modelId;
  return `${modelId} | temp ${temperature}`;
}

function ModelDropdown({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full appearance-none rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 pr-8 text-sm text-neutral-100"
      >
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400" />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color = 'text-neutral-300' }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/5 bg-neutral-800/50 p-3">
      <Icon size={16} className={color} />
      <div>
        <p className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</p>
        <p className={`text-sm font-medium ${color}`}>{value}</p>
      </div>
    </div>
  );
}

function OutputPreview({ result }: { result: Pick<TestResult, 'output' | 'outputType'> }) {
  if (result.outputType === 'image') {
    // Data URLs from the playground are not a good fit for next/image optimization.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={result.output} alt="Generated output" className="max-h-[400px] w-full rounded-lg border border-white/10 bg-neutral-900 object-contain" />;
  }
  if (result.outputType === 'audio') {
    return <audio controls className="w-full rounded-lg border border-white/10 bg-neutral-900 p-2" src={result.output} />;
  }
  return (
    <div className="max-h-[400px] overflow-y-auto rounded-lg border border-white/10 bg-neutral-800/50 p-4">
      <pre className="whitespace-pre-wrap text-sm text-neutral-300">{result.output}</pre>
    </div>
  );
}

export default function PlaygroundStudio() {
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [selectedTask, setSelectedTask] = useState<TaskKey>('story_generation');
  const [selectedModel, setSelectedModel] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [promptState, setPromptState] = useState<PlaygroundPromptState | null>(null);
  const [draftPrompt, setDraftPrompt] = useState('');
  const [publishNote, setPublishNote] = useState('');
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promptMessage, setPromptMessage] = useState<string | null>(null);
  const [isFetchingConfigs, setIsFetchingConfigs] = useState(true);
  const [isPromptLoading, setIsPromptLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [publishStatus, setPublishStatus] = useState<'idle' | 'publishing' | 'published' | 'error'>('idle');
  const [applyStatus, setApplyStatus] = useState<'idle' | 'applying' | 'applied' | 'error'>('idle');
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const supportsPrompt = isPromptTaskKey(selectedTask);
  const promptTaskKey: PromptTaskKey | null = supportsPrompt ? selectedTask : null;
  const currentConfig = configs.find((config) => config.taskKey === selectedTask);
  const taskDef = TASK_DEFINITIONS.find((task) => task.key === selectedTask)!;
  const validation = promptTaskKey ? validatePromptTemplate(promptTaskKey, draftPrompt) : null;
  const isModelChanged = currentConfig ? selectedModel !== currentConfig.modelId || (taskHasTemperature(selectedTask) && temperature !== (currentConfig.temperature ?? 0.7)) : false;
  const isDraftDirty = supportsPrompt && promptState ? draftPrompt !== promptState.draft.promptBody : false;
  const isDraftDifferentFromPublished = supportsPrompt && promptState ? draftPrompt !== promptState.published.promptBody : false;
  const placeholderDefinitions = useMemo(() => promptTaskKey ? PROMPT_TASK_DEFINITIONS[promptTaskKey].placeholders : [], [promptTaskKey]);

  useEffect(() => {
    getActiveModelConfigs()
      .then((modelData) => {
        setConfigs(modelData);
        setIsFetchingConfigs(false);
      })
      .catch(() => setIsFetchingConfigs(false));
  }, []);

  useEffect(() => {
    const config = configs.find((item) => item.taskKey === selectedTask);
    const defaults = DEFAULT_MODELS[selectedTask];
    setSelectedModel(config?.modelId || defaults.modelId);
    setTemperature(config?.temperature ?? defaults.temperature ?? 0.7);
    setInputs({ ...DEFAULT_INPUTS[selectedTask] });
    setResult(null);
    setError(null);
    setPromptMessage(null);
    setSaveStatus('idle');
    setPublishStatus('idle');
    setApplyStatus('idle');
    setExpandedRunId(null);
    setExpandedHistoryId(null);

    if (isPromptTaskKey(selectedTask)) {
      void loadPromptState(selectedTask);
    } else {
      setPromptState(null);
      setDraftPrompt('');
      setPublishNote('');
    }
  }, [selectedTask, configs]);

  useEffect(() => {
    setApplyStatus('idle');
  }, [selectedModel, temperature, selectedTask]);

  const loadPromptState = async (taskKey: PromptTaskKey) => {
    setIsPromptLoading(true);
    try {
      const state = await getPromptPlaygroundStateAction(taskKey);
      setPromptState(state);
      setDraftPrompt(state.draft.promptBody);
      setPublishNote('');
    } catch (err: any) {
      setError(err.message || 'Failed to load prompt state');
    } finally {
      setIsPromptLoading(false);
    }
  };

  const productionConfigLabel = formatProductionConfig(
    currentConfig?.modelId,
    currentConfig?.temperature,
    taskHasTemperature(selectedTask)
  );
  const selectedConfigLabel = formatProductionConfig(
    selectedModel,
    taskHasTemperature(selectedTask) ? temperature : null,
    taskHasTemperature(selectedTask)
  );

  const handleRunTest = async () => {
    setIsTesting(true);
    setError(null);
    setPromptMessage(null);
    setResult(null);

    try {
      const nextResult = await runPlaygroundTest({
        taskKey: selectedTask,
        modelId: selectedModel,
        temperature: taskHasTemperature(selectedTask) ? temperature : null,
        inputs,
        promptBody: supportsPrompt ? draftPrompt : undefined,
      });
      setResult(nextResult);
      if (supportsPrompt) {
        await loadPromptState(selectedTask);
      }
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (err: any) {
      setError(err.message || 'Test failed');
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!supportsPrompt) return;
    setSaveStatus('saving');
    setPromptMessage(null);
    setError(null);
    try {
      const state = await savePromptDraftAction(promptTaskKey!, draftPrompt);
      setPromptState(state);
      setDraftPrompt(state.draft.promptBody);
      setSaveStatus('saved');
      setPromptMessage('Draft saved for this admin.');
    } catch (err: any) {
      setSaveStatus('error');
      setError(err.message || 'Failed to save draft');
    }
  };

  const handlePublishDraft = async () => {
    if (!supportsPrompt) return;
    setPublishStatus('publishing');
    setPromptMessage(null);
    setError(null);
    try {
      const state = await publishPromptDraftAction(promptTaskKey!, publishNote.trim() || undefined);
      setPromptState(state);
      setDraftPrompt(state.draft.promptBody);
      setPublishNote('');
      setPublishStatus('published');
      setPromptMessage('Prompt published. Future generations will use it immediately.');
    } catch (err: any) {
      setPublishStatus('error');
      setError(err.message || 'Failed to publish draft');
    }
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (!supportsPrompt) return;
    setPromptMessage(null);
    setError(null);
    try {
      const state = await restorePromptVersionToDraftAction(promptTaskKey!, versionId);
      setPromptState(state);
      setDraftPrompt(state.draft.promptBody);
      setPromptMessage('Selected published version has been restored into your draft.');
    } catch (err: any) {
      setError(err.message || 'Failed to restore prompt version');
    }
  };

  const handleApplyModel = async () => {
    setShowApplyConfirm(false);
    setApplyStatus('applying');
    try {
      await applyModelToProduction(selectedTask, selectedModel, taskHasTemperature(selectedTask) ? temperature : null);
      setApplyStatus('applied');
      setConfigs(await getActiveModelConfigs());
    } catch {
      setApplyStatus('error');
    }
  };

  const renderTaskInputs = () => {
    if (selectedTask === 'story_generation') {
      return (
        <div className="grid gap-3">
          <textarea value={inputs.userPrompt || ''} onChange={(event) => setInputs((current) => ({ ...current, userPrompt: event.target.value }))} rows={3} className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100" placeholder="Original user prompt" />
          <div className="grid gap-3 md:grid-cols-2">
            <input value={inputs.language || ''} onChange={(event) => setInputs((current) => ({ ...current, language: event.target.value }))} className="rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100" placeholder="Language" />
            <input value={inputs.selectedOptionLabel || ''} onChange={(event) => setInputs((current) => ({ ...current, selectedOptionLabel: event.target.value }))} className="rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100" placeholder="Selected option label" />
          </div>
          <textarea value={inputs.storyConfig || ''} onChange={(event) => setInputs((current) => ({ ...current, storyConfig: event.target.value }))} rows={5} className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 font-mono text-sm text-neutral-100" placeholder="Formatted story config" />
          <textarea value={inputs.storyState || ''} onChange={(event) => setInputs((current) => ({ ...current, storyState: event.target.value }))} rows={8} className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 font-mono text-sm text-neutral-100" placeholder="Current story state JSON" />
        </div>
      );
    }

    if (selectedTask === 'visual_prompt') {
      return (
        <div className="grid gap-3">
          <textarea value={inputs.sceneDescription || ''} onChange={(event) => setInputs((current) => ({ ...current, sceneDescription: event.target.value }))} rows={3} className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100" placeholder="Scene description" />
          <textarea value={inputs.characters || ''} onChange={(event) => setInputs((current) => ({ ...current, characters: event.target.value }))} rows={6} className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 font-mono text-sm text-neutral-100" placeholder="Character continuity JSON" />
          <input value={inputs.visualStyle || ''} onChange={(event) => setInputs((current) => ({ ...current, visualStyle: event.target.value }))} className="rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100" placeholder="Visual style" />
        </div>
      );
    }

    if (selectedTask === 'image_generation') {
      return <textarea value={inputs.prompt || ''} onChange={(event) => setInputs((current) => ({ ...current, prompt: event.target.value }))} rows={4} className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100" placeholder="Image prompt" />;
    }

    if (selectedTask === 'tts') {
      return (
        <div className="grid gap-3">
          <textarea value={inputs.storyText || ''} onChange={(event) => setInputs((current) => ({ ...current, storyText: event.target.value }))} rows={4} className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100" placeholder="Text to narrate" />
          <div className="grid gap-3 md:grid-cols-3">
            <input value={inputs.genre || ''} onChange={(event) => setInputs((current) => ({ ...current, genre: event.target.value }))} className="rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100" placeholder="Genre" />
            <input value={inputs.tone || ''} onChange={(event) => setInputs((current) => ({ ...current, tone: event.target.value }))} className="rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100" placeholder="Tone" />
            <input value={inputs.language || ''} onChange={(event) => setInputs((current) => ({ ...current, language: event.target.value }))} className="rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100" placeholder="Language" />
          </div>
          <div className="relative">
            <select value={inputs.voice || 'Sulafat'} onChange={(event) => setInputs((current) => ({ ...current, voice: event.target.value }))} className="w-full appearance-none rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 pr-8 text-sm text-neutral-100">
              {AVAILABLE_VOICES.map((voice) => <option key={voice} value={voice}>{voice}</option>)}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          </div>
        </div>
      );
    }

    return (
      <div className="grid gap-3 md:grid-cols-2">
        <input value={inputs.genre || ''} onChange={(event) => setInputs((current) => ({ ...current, genre: event.target.value }))} className="rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100" placeholder="Genre" />
        <input value={inputs.tone || ''} onChange={(event) => setInputs((current) => ({ ...current, tone: event.target.value }))} className="rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100" placeholder="Tone" />
        <input value={inputs.targetAge || ''} onChange={(event) => setInputs((current) => ({ ...current, targetAge: event.target.value }))} className="rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100" placeholder="Target age" />
        <input value={inputs.language || ''} onChange={(event) => setInputs((current) => ({ ...current, language: event.target.value }))} className="rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100" placeholder="Language" />
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="mb-1 text-2xl text-neutral-100">Prompt + Model Playground</h1>
      <p className="mb-8 text-sm text-neutral-400">Iterate on task prompts, test against different models, and publish production-ready prompt variants without a code deploy.</p>

      {isFetchingConfigs ? (
        <div className="flex items-center gap-2 text-neutral-400"><Loader2 size={16} className="animate-spin" />Loading playground config...</div>
      ) : (
        <div className="flex gap-6">
          <div className="w-72 shrink-0 space-y-2">
            {TASK_DEFINITIONS.map((task) => {
              const config = configs.find((item) => item.taskKey === task.key);
              const active = selectedTask === task.key;
              const promptEnabled = PROMPT_TASK_KEYS.includes(task.key as PromptTaskKey);
              return (
                <button key={task.key} onClick={() => setSelectedTask(task.key)} className={`w-full rounded-xl border p-3 text-left transition-all ${active ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{task.label}</p>
                    {promptEnabled && <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-300">Prompt</span>}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-neutral-500">{config?.modelId || DEFAULT_MODELS[task.key].modelId}</p>
                </button>
              );
            })}
          </div>

          <div className="flex-1 space-y-6">
            <>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-medium text-neutral-100">{taskDef.label}</h2>
                  <p className="mt-1 text-sm text-neutral-400">{taskDef.description}</p>
                </div>
                <div className={`rounded-lg px-3 py-2 text-xs ${supportsPrompt ? 'border border-emerald-500/20 bg-emerald-500/5 text-emerald-200' : 'border border-white/10 bg-neutral-900/60 text-neutral-400'}`}>
                  {supportsPrompt ? 'Prompt editing enabled' : 'Model-only task in v1'}
                </div>
              </div>
              {currentConfig && <p className="mt-3 text-xs text-neutral-500">Production model: <span className="font-mono text-neutral-300">{productionConfigLabel}</span></p>}
              {supportsPrompt && promptState && <p className="mt-1 text-xs text-neutral-500">Published prompt: <span className="text-neutral-300">{promptState.published.source === 'database' ? 'Database' : 'Code default'}</span> | Last updated: <span className="text-neutral-300">{formatTimestamp(promptState.published.updatedAt)}</span></p>}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs text-neutral-400">Model</label>
                <ModelDropdown value={selectedModel} onChange={setSelectedModel} options={getModelsForTask(selectedTask)} />
              </div>
              {taskHasTemperature(selectedTask) && (
                <div>
                  <label className="mb-1.5 block text-xs text-neutral-400">Temperature: {temperature.toFixed(2)}</label>
                  <input type="range" min={0} max={1} step={0.05} value={temperature} onChange={(event) => setTemperature(parseFloat(event.target.value))} className="mt-2 w-full accent-emerald-500" />
                </div>
              )}
            </div>

            {isModelChanged && (
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                <div>
                  <p className="text-sm text-amber-200">Playground config differs from production</p>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    Production: <span className="font-mono">{productionConfigLabel}</span> {'->'} Selected: <span className="font-mono">{selectedConfigLabel}</span>
                  </p>
                </div>
                {applyStatus === 'applied' ? (
                  <span className="flex items-center gap-1.5 text-sm text-emerald-400"><CheckCircle size={14} />Applied</span>
                ) : applyStatus === 'applying' ? (
                  <span className="flex items-center gap-2 text-sm text-amber-300"><Loader2 size={16} className="animate-spin" />Applying...</span>
                ) : applyStatus === 'error' ? (
                  <button onClick={() => setShowApplyConfirm(true)} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500">Retry Apply to Production</button>
                ) : (
                  <button onClick={() => setShowApplyConfirm(true)} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500">Apply Model to Production</button>
                )}
              </div>
            )}

            {supportsPrompt && (
              <div className="rounded-2xl border border-white/10 bg-neutral-950/40 p-5">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2"><FileText size={16} className="text-emerald-300" /><h3 className="text-sm font-medium text-neutral-100">{promptTaskKey ? PROMPT_TASK_DEFINITIONS[promptTaskKey].label : ''}</h3></div>
                    <p className="mt-1 text-sm text-neutral-400">{promptTaskKey ? PROMPT_TASK_DEFINITIONS[promptTaskKey].description : ''}</p>
                  </div>
                  {isPromptLoading && <span className="flex items-center gap-2 text-sm text-neutral-400"><Loader2 size={14} className="animate-spin" />Loading prompt state...</span>}
                </div>

                <div className="mb-4 flex flex-wrap gap-2">
                  {placeholderDefinitions.map((placeholder) => (
                    <div key={placeholder.key} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-neutral-300">
                      <span className="font-mono text-emerald-300">{`{{${placeholder.key}}}`}</span>
                      <span className="ml-2 text-neutral-400">{placeholder.description}</span>
                    </div>
                  ))}
                </div>

                <textarea value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} rows={20} className="w-full resize-y rounded-xl border border-white/10 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-100" placeholder="Draft prompt" />
                {validation && !validation.isValid && (
                  <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
                    {validation.unknownPlaceholders.length > 0 && <p>Unknown placeholders: {validation.unknownPlaceholders.join(', ')}</p>}
                    {validation.missingRequiredPlaceholders.length > 0 && <p>Missing required placeholders: {validation.missingRequiredPlaceholders.join(', ')}</p>}
                  </div>
                )}
                {validation?.isValid && <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">Template valid. Locked guardrails for schema and output format stay enforced in code.</div>}

                <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_220px]">
                  <textarea value={publishNote} onChange={(event) => setPublishNote(event.target.value)} rows={3} className="w-full rounded-xl border border-white/10 bg-neutral-900 px-4 py-3 text-sm text-neutral-100" placeholder="Optional publish note" />
                  <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-neutral-400">
                    <p>Draft source: <span className="text-neutral-200">{promptState?.draft.source || 'loading'}</span></p>
                    <p>Draft updated: <span className="text-neutral-200">{formatTimestamp(promptState?.draft.updatedAt)}</span></p>
                    <p>Different from published: <span className="text-neutral-200">{isDraftDifferentFromPublished ? 'Yes' : 'No'}</span></p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <button onClick={handleSaveDraft} disabled={!isDraftDirty || !validation?.isValid || saveStatus === 'saving'} className="flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2.5 text-sm text-neutral-200 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50">{saveStatus === 'saving' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}Save Draft</button>
                  <button onClick={() => { if (promptState) { setDraftPrompt(promptState.published.promptBody); setPromptMessage('Draft reset to the published prompt locally. Save if you want to persist it.'); } }} disabled={!promptState} className="flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2.5 text-sm text-neutral-300 hover:bg-white/5 disabled:opacity-50"><RotateCcw size={15} />Reset to Published</button>
                  <button onClick={handlePublishDraft} disabled={!validation?.isValid || !isDraftDifferentFromPublished || publishStatus === 'publishing'} className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50">{publishStatus === 'publishing' ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}Publish Draft</button>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <label className="block text-xs text-neutral-400">Test Inputs</label>
              {renderTaskInputs()}
            </div>

            <div className="flex flex-wrap gap-3">
              <button onClick={handleRunTest} disabled={isTesting || (supportsPrompt && !validation?.isValid)} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">{isTesting ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}{isTesting ? 'Running...' : 'Run Test'}</button>
              {result && <button onClick={() => { setResult(null); setError(null); }} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-neutral-300 hover:bg-white/10"><RotateCcw size={14} />Clear Result</button>}
            </div>

            <AnimatePresence>
              {error && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-400" />
                  <p className="text-sm text-red-300">{error}</p>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {promptMessage && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                  <CheckCircle size={16} className="mt-0.5 shrink-0 text-emerald-400" />
                  <p className="text-sm text-emerald-200">{promptMessage}</p>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {result && (
                <motion.div ref={resultRef} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-4">
                    <StatCard icon={Clock} label="Latency" value={formatLatency(result.latencyMs)} color="text-blue-300" />
                    <StatCard icon={Coins} label="Est. Cost" value={formatCost(result.estimatedCostUsd || 0)} color="text-amber-300" />
                    <StatCard icon={Hash} label="Tokens" value={result.tokenCounts ? `${result.tokenCounts.input} -> ${result.tokenCounts.output}` : 'N/A'} color="text-purple-300" />
                    <StatCard icon={Cpu} label="Model" value={result.model.replace('gemini-', '')} color="text-emerald-300" />
                  </div>
                  <div>
                    <h3 className="mb-2 text-xs uppercase tracking-wider text-neutral-400">Latest Output</h3>
                    <OutputPreview result={result} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            </>
          </div>
        </div>
      )}

      {supportsPrompt && promptState && (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4 rounded-2xl border border-white/10 bg-neutral-950/40 p-5">
            <div className="flex items-center gap-2"><History size={16} className="text-neutral-300" /><h3 className="text-sm font-medium text-neutral-100">Published History</h3></div>
            {promptState.history.length === 0 ? (
              <p className="text-sm text-neutral-500">No published versions yet. The current live prompt is still the code default.</p>
            ) : (
              promptState.history.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-neutral-200">{formatTimestamp(entry.publishedAt)}</p>
                      <p className="mt-1 text-xs text-neutral-500">Published by <span className="font-mono text-neutral-400">{entry.publishedBy || 'unknown'}</span></p>
                      {entry.note && <p className="mt-2 text-sm text-neutral-300">{entry.note}</p>}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setExpandedHistoryId((current) => current === entry.id ? null : entry.id)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/10">{expandedHistoryId === entry.id ? 'Hide Prompt' : 'View Prompt'}</button>
                      <button onClick={() => handleRestoreVersion(entry.id)} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-neutral-100 hover:bg-white/15">Restore to Draft</button>
                    </div>
                  </div>
                  {expandedHistoryId === entry.id && <pre className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-neutral-900 p-3 font-mono text-xs text-neutral-300">{entry.promptBody}</pre>}
                </div>
              ))
            )}
          </div>

          <div className="space-y-4 rounded-2xl border border-white/10 bg-neutral-950/40 p-5">
            <div className="flex items-center gap-2"><History size={16} className="text-neutral-300" /><h3 className="text-sm font-medium text-neutral-100">Recent Shared Runs</h3></div>
            {promptState.recentRuns.length === 0 ? (
              <p className="text-sm text-neutral-500">Run this prompt to start building shared experiment history.</p>
            ) : (
              promptState.recentRuns.map((run) => (
                <div key={run.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-neutral-200">{formatTimestamp(run.createdAt)}</p>
                      <p className="mt-1 text-xs text-neutral-500"><span className="font-mono text-neutral-400">{run.modelId}</span>{run.temperature != null && <span> | temp {run.temperature}</span>}</p>
                    </div>
                    <button onClick={() => setExpandedRunId((current) => current === run.id ? null : run.id)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/10">{expandedRunId === run.id ? 'Hide Details' : 'View Details'}</button>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    <StatCard icon={Clock} label="Latency" value={formatLatency(run.latencyMs)} color="text-blue-300" />
                    <StatCard icon={Coins} label="Est. Cost" value={formatCost(run.estimatedCostUsd || 0)} color="text-amber-300" />
                    <StatCard icon={Hash} label="Tokens" value={run.tokenCounts ? `${run.tokenCounts.input} -> ${run.tokenCounts.output}` : 'N/A'} color="text-purple-300" />
                  </div>
                  {expandedRunId === run.id && (
                    <div className="mt-4 space-y-4">
                      <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-neutral-900 p-3 font-mono text-xs text-neutral-300">{run.promptBody}</pre>
                      <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-neutral-900 p-3 font-mono text-xs text-neutral-300">{JSON.stringify(run.inputs, null, 2)}</pre>
                      <OutputPreview result={{ output: run.output, outputType: run.outputType }} />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <AnimatePresence>
        {showApplyConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowApplyConfirm(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(event) => event.stopPropagation()} className="mx-4 w-full max-w-md rounded-2xl border border-white/10 bg-neutral-900 p-6 shadow-2xl">
              <h3 className="text-lg font-medium text-neutral-100">Apply model to production?</h3>
              <p className="mt-2 text-sm text-neutral-400">This will change the <strong className="text-neutral-200">{taskDef.label}</strong> production config from <code className="rounded bg-white/5 px-1.5 py-0.5 text-xs">{productionConfigLabel}</code> to <code className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-300">{selectedConfigLabel}</code>.</p>
              <p className="mt-2 text-xs text-neutral-500">Prompt publishing is separate. Only the model selection and temperature for this task will change here.</p>
              <div className="mt-5 flex justify-end gap-3">
                <button onClick={() => setShowApplyConfirm(false)} className="px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200">Cancel</button>
                <button onClick={handleApplyModel} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500">Confirm & Apply</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
