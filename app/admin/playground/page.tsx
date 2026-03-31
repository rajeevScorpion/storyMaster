'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Play,
  Loader2,
  CheckCircle,
  AlertTriangle,
  Clock,
  Coins,
  Hash,
  Cpu,
  ChevronDown,
  RotateCcw,
} from 'lucide-react';
import { getActiveModelConfigs } from '@/app/actions/admin';
import {
  testStoryGeneration,
  testVisualPrompt,
  testImageGeneration,
  testTTS,
  testVoiceSelection,
  applyModelToProduction,
  type TestResult,
} from '@/app/actions/playground';
import type { ModelConfig, TaskKey } from '@/lib/ai/model-config.shared';
import { TASK_DEFINITIONS, KNOWN_MODELS, DEFAULT_MODELS } from '@/lib/ai/model-config.shared';
import { formatCost, formatLatency } from '@/lib/ai/pricing';

// ── Constants ──────────────────────────────────────────────────

const AVAILABLE_VOICES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede',
  'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
  'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
];

const DEFAULT_INPUTS: Record<TaskKey, Record<string, string>> = {
  story_generation: {
    prompt: 'A brave knight discovers a hidden door in an ancient castle',
  },
  visual_prompt: {
    scene: 'A moonlit garden with glowing fireflies and an old stone fountain',
  },
  image_generation: {
    prompt: 'A mystical forest at dawn with golden light filtering through ancient trees, cinematic storybook illustration',
  },
  tts: {
    text: 'Once upon a time, in a land far away, there lived a curious young fox who dreamed of touching the stars.',
    voice: 'Sulafat',
  },
  voice_selection: {
    genre: 'fantasy',
    tone: 'whimsical',
  },
};

function getModelsForTask(taskKey: TaskKey): string[] {
  switch (taskKey) {
    case 'image_generation':
      return KNOWN_MODELS.image;
    case 'tts':
      return KNOWN_MODELS.tts;
    default:
      return KNOWN_MODELS.text;
  }
}

function taskHasTemperature(taskKey: TaskKey): boolean {
  return taskKey !== 'image_generation' && taskKey !== 'tts';
}

// ── Components ─────────────────────────────────────────────────

function ModelDropdown({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  const [isCustom, setIsCustom] = useState(false);
  const [customValue, setCustomValue] = useState('');

  return (
    <div className="space-y-2">
      <div className="relative">
        <select
          value={isCustom ? '__custom__' : value}
          onChange={(e) => {
            if (e.target.value === '__custom__') {
              setIsCustom(true);
              if (customValue) onChange(customValue);
            } else {
              setIsCustom(false);
              onChange(e.target.value);
            }
          }}
          className="w-full bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-neutral-100 appearance-none cursor-pointer pr-8"
        >
          {options.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
          <option value="__custom__">Custom model ID...</option>
        </select>
        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
      </div>
      {isCustom && (
        <input
          type="text"
          value={customValue}
          onChange={(e) => {
            setCustomValue(e.target.value);
            onChange(e.target.value);
          }}
          placeholder="Enter model ID (e.g., gemini-2.0-flash)"
          className="w-full bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500"
        />
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color = 'text-neutral-300' }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="bg-neutral-800/50 border border-white/5 rounded-lg p-3 flex items-center gap-3">
      <Icon size={16} className={color} />
      <div>
        <p className="text-[11px] text-neutral-500 uppercase tracking-wider">{label}</p>
        <p className={`text-sm font-medium ${color}`}>{value}</p>
      </div>
    </div>
  );
}

function OutputPreview({ result }: { result: TestResult }) {
  if (result.outputType === 'image') {
    return (
      <div className="rounded-lg overflow-hidden border border-white/10">
        <img src={result.output} alt="Generated" className="w-full max-h-[400px] object-contain bg-neutral-900" />
      </div>
    );
  }

  if (result.outputType === 'audio') {
    return (
      <div className="p-4 bg-neutral-800/50 rounded-lg border border-white/10">
        <audio controls className="w-full" src={result.output} />
      </div>
    );
  }

  if (result.outputType === 'json') {
    try {
      const parsed = JSON.parse(result.output);
      return (
        <div className="bg-neutral-800/50 rounded-lg border border-white/10 p-4 max-h-[400px] overflow-y-auto">
          <pre className="text-xs text-neutral-300 whitespace-pre-wrap font-mono">
            {JSON.stringify(parsed, null, 2)}
          </pre>
        </div>
      );
    } catch {
      // Fall through to text rendering
    }
  }

  return (
    <div className="bg-neutral-800/50 rounded-lg border border-white/10 p-4 max-h-[400px] overflow-y-auto">
      <p className="text-sm text-neutral-300 whitespace-pre-wrap">{result.output}</p>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────

export default function PlaygroundPage() {
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [selectedTask, setSelectedTask] = useState<TaskKey>('story_generation');
  const [selectedModel, setSelectedModel] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingConfigs, setIsFetchingConfigs] = useState(true);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyStatus, setApplyStatus] = useState<'idle' | 'applying' | 'applied' | 'error'>('idle');
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  // Load configs on mount
  useEffect(() => {
    getActiveModelConfigs()
      .then((data) => {
        setConfigs(data);
        setIsFetchingConfigs(false);
      })
      .catch(() => setIsFetchingConfigs(false));
  }, []);

  // Update model/temp/inputs when task changes
  useEffect(() => {
    const config = configs.find((c) => c.taskKey === selectedTask);
    const defaults = DEFAULT_MODELS[selectedTask];
    setSelectedModel(config?.modelId || defaults.modelId);
    setTemperature(config?.temperature ?? defaults.temperature ?? 0.7);
    setInputs({ ...DEFAULT_INPUTS[selectedTask] });
    setResult(null);
    setError(null);
    setApplyStatus('idle');
  }, [selectedTask, configs]);

  const runTest = async () => {
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      let testResult: TestResult;

      switch (selectedTask) {
        case 'story_generation':
          testResult = await testStoryGeneration(selectedModel, temperature, inputs.prompt || '');
          break;
        case 'visual_prompt':
          testResult = await testVisualPrompt(selectedModel, temperature, inputs.scene || '');
          break;
        case 'image_generation':
          testResult = await testImageGeneration(selectedModel, inputs.prompt || '');
          break;
        case 'tts':
          testResult = await testTTS(selectedModel, inputs.text || '', inputs.voice || 'Sulafat');
          break;
        case 'voice_selection':
          testResult = await testVoiceSelection(selectedModel, temperature, inputs.genre || '', inputs.tone || '');
          break;
        default:
          throw new Error('Unknown task');
      }

      setResult(testResult);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (err: any) {
      setError(err.message || 'Test failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApply = async () => {
    setShowApplyConfirm(false);
    setApplyStatus('applying');
    try {
      await applyModelToProduction(
        selectedTask,
        selectedModel,
        taskHasTemperature(selectedTask) ? temperature : null
      );
      setApplyStatus('applied');
      // Refresh configs
      const updated = await getActiveModelConfigs();
      setConfigs(updated);
    } catch {
      setApplyStatus('error');
    }
  };

  const currentConfig = configs.find((c) => c.taskKey === selectedTask);
  const taskDef = TASK_DEFINITIONS.find((t) => t.key === selectedTask)!;
  const isChanged = currentConfig
    ? selectedModel !== currentConfig.modelId || (taskHasTemperature(selectedTask) && temperature !== (currentConfig.temperature ?? 0.7))
    : false;

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-2xl font-serif text-neutral-100 mb-1">Model Playground</h1>
      <p className="text-sm text-neutral-400 mb-8">
        Test different models per task, compare performance, and apply to production.
      </p>

      {isFetchingConfigs ? (
        <div className="flex items-center gap-2 text-neutral-400">
          <Loader2 size={16} className="animate-spin" />
          Loading model configs...
        </div>
      ) : (
        <div className="flex gap-6">
          {/* ── Task Selector (Left) ────────────────────── */}
          <div className="w-72 shrink-0 space-y-2">
            {TASK_DEFINITIONS.map((task) => {
              const config = configs.find((c) => c.taskKey === task.key);
              const isActive = selectedTask === task.key;
              return (
                <button
                  key={task.key}
                  onClick={() => setSelectedTask(task.key)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    isActive
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-white/5 border-white/10 text-neutral-300 hover:bg-white/10'
                  }`}
                >
                  <p className="text-sm font-medium">{task.label}</p>
                  <p className="text-[11px] mt-0.5 text-neutral-500 font-mono truncate">
                    {config?.modelId || DEFAULT_MODELS[task.key].modelId}
                  </p>
                </button>
              );
            })}
          </div>

          {/* ── Test Panel (Right) ──────────────────────── */}
          <div className="flex-1 space-y-6">
            {/* Task Description */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <h2 className="text-base font-medium text-neutral-100">{taskDef.label}</h2>
              <p className="text-sm text-neutral-400 mt-1">{taskDef.description}</p>
              {currentConfig && (
                <p className="text-xs text-neutral-500 mt-2">
                  Production: <span className="font-mono text-neutral-400">{currentConfig.modelId}</span>
                  {currentConfig.temperature != null && (
                    <span> · temp {currentConfig.temperature}</span>
                  )}
                </p>
              )}
            </div>

            {/* Model & Temperature Controls */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-neutral-400 mb-1.5">Model</label>
                <ModelDropdown
                  value={selectedModel}
                  onChange={setSelectedModel}
                  options={getModelsForTask(selectedTask)}
                />
              </div>
              {taskHasTemperature(selectedTask) && (
                <div>
                  <label className="block text-xs text-neutral-400 mb-1.5">
                    Temperature: {temperature.toFixed(2)}
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    className="w-full mt-2 accent-emerald-500"
                  />
                </div>
              )}
            </div>

            {/* Task-specific Inputs */}
            <div className="space-y-3">
              <label className="block text-xs text-neutral-400">Test Input</label>

              {selectedTask === 'story_generation' && (
                <textarea
                  value={inputs.prompt || ''}
                  onChange={(e) => setInputs((p) => ({ ...p, prompt: e.target.value }))}
                  rows={3}
                  className="w-full bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 resize-none"
                  placeholder="Enter a story prompt..."
                />
              )}

              {selectedTask === 'visual_prompt' && (
                <textarea
                  value={inputs.scene || ''}
                  onChange={(e) => setInputs((p) => ({ ...p, scene: e.target.value }))}
                  rows={3}
                  className="w-full bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 resize-none"
                  placeholder="Describe a scene..."
                />
              )}

              {selectedTask === 'image_generation' && (
                <textarea
                  value={inputs.prompt || ''}
                  onChange={(e) => setInputs((p) => ({ ...p, prompt: e.target.value }))}
                  rows={3}
                  className="w-full bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 resize-none"
                  placeholder="Enter an image prompt..."
                />
              )}

              {selectedTask === 'tts' && (
                <>
                  <textarea
                    value={inputs.text || ''}
                    onChange={(e) => setInputs((p) => ({ ...p, text: e.target.value }))}
                    rows={3}
                    className="w-full bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 resize-none"
                    placeholder="Enter text to narrate..."
                  />
                  <div className="relative">
                    <select
                      value={inputs.voice || 'Sulafat'}
                      onChange={(e) => setInputs((p) => ({ ...p, voice: e.target.value }))}
                      className="w-full bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-neutral-100 appearance-none cursor-pointer pr-8"
                    >
                      {AVAILABLE_VOICES.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
                  </div>
                </>
              )}

              {selectedTask === 'voice_selection' && (
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={inputs.genre || ''}
                    onChange={(e) => setInputs((p) => ({ ...p, genre: e.target.value }))}
                    placeholder="Genre (e.g., fantasy)"
                    className="bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500"
                  />
                  <input
                    type="text"
                    value={inputs.tone || ''}
                    onChange={(e) => setInputs((p) => ({ ...p, tone: e.target.value }))}
                    placeholder="Tone (e.g., whimsical)"
                    className="bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500"
                  />
                </div>
              )}
            </div>

            {/* Run Test Button */}
            <div className="flex gap-3">
              <button
                onClick={runTest}
                disabled={isLoading}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
              >
                {isLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Play size={16} />
                )}
                {isLoading ? 'Running...' : 'Run Test'}
              </button>
              {result && (
                <button
                  onClick={() => { setResult(null); setError(null); }}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-300 rounded-lg text-sm transition-colors"
                >
                  <RotateCcw size={14} />
                  Clear
                </button>
              )}
            </div>

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4"
                >
                  <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-300">{error}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Result */}
            <AnimatePresence>
              {result && (
                <motion.div
                  ref={resultRef}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4"
                >
                  {/* Stats Grid */}
                  <div className="grid grid-cols-4 gap-3">
                    <StatCard icon={Clock} label="Latency" value={formatLatency(result.latencyMs)} color="text-blue-300" />
                    <StatCard icon={Coins} label="Est. Cost" value={formatCost(result.estimatedCostUsd || 0)} color="text-amber-300" />
                    <StatCard
                      icon={Hash}
                      label="Tokens"
                      value={result.tokenCounts ? `${result.tokenCounts.input} → ${result.tokenCounts.output}` : 'N/A'}
                      color="text-purple-300"
                    />
                    <StatCard icon={Cpu} label="Model" value={result.model.replace('gemini-', '')} color="text-emerald-300" />
                  </div>

                  {/* Output Preview */}
                  <div>
                    <h3 className="text-xs text-neutral-400 mb-2 uppercase tracking-wider">Output Preview</h3>
                    <OutputPreview result={result} />
                  </div>

                  {/* Apply to Production */}
                  {isChanged && (
                    <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-amber-200">
                            Model differs from production
                          </p>
                          <p className="text-xs text-neutral-500 mt-0.5">
                            Production: <span className="font-mono">{currentConfig?.modelId}</span>
                            {' → '}
                            Test: <span className="font-mono">{selectedModel}</span>
                          </p>
                        </div>
                        {applyStatus === 'applied' ? (
                          <span className="flex items-center gap-1.5 text-sm text-emerald-400">
                            <CheckCircle size={14} /> Applied
                          </span>
                        ) : applyStatus === 'applying' ? (
                          <Loader2 size={16} className="animate-spin text-amber-300" />
                        ) : applyStatus === 'error' ? (
                          <span className="flex items-center gap-1.5 text-sm text-red-400">
                            <AlertTriangle size={14} /> Failed
                          </span>
                        ) : (
                          <button
                            onClick={() => setShowApplyConfirm(true)}
                            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-medium transition-colors"
                          >
                            Apply to Production
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Apply Confirmation Modal */}
      <AnimatePresence>
        {showApplyConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowApplyConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-neutral-900 border border-white/10 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl"
            >
              <h3 className="text-lg font-medium text-neutral-100">Apply to Production?</h3>
              <p className="text-sm text-neutral-400 mt-2">
                This will change the <strong className="text-neutral-200">{taskDef.label}</strong> model
                from <code className="text-xs bg-white/5 px-1.5 py-0.5 rounded">{currentConfig?.modelId}</code>
                {' to '}
                <code className="text-xs bg-emerald-500/10 text-emerald-300 px-1.5 py-0.5 rounded">{selectedModel}</code>.
              </p>
              <p className="text-xs text-neutral-500 mt-2">
                New stories will use this model immediately. In-progress stories will continue with their current model.
              </p>
              <div className="flex gap-3 mt-5 justify-end">
                <button
                  onClick={() => setShowApplyConfirm(false)}
                  className="px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApply}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Confirm & Apply
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
