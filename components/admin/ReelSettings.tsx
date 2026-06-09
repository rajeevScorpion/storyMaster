'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCcw, Save, Trash2 } from 'lucide-react';

import {
  getReelStorySetupSettings,
  saveReelStorySettings,
  setReelStoryEnabled,
  setReelStoryPublishEnabled,
} from '@/app/actions/admin';
import { runReelCleanup, type ReelCleanupResult } from '@/app/actions/reel-cleanup';
import {
  DEFAULT_REEL_NARRATION_ADMIN_SETTINGS,
  RECOMMENDED_REEL_FEMALE_VOICES,
  RECOMMENDED_REEL_MALE_VOICES,
  SYSTEM_NARRATION_PRESETS,
  type PronunciationDictionaryLocator,
  type ReelNarrationAdminSettings,
  type NarrationVoiceOption,
} from '@/lib/reel/narration';
import {
  DEFAULT_REEL_STORY_SETTINGS,
  REEL_TEXT_LENGTH_KEYS,
  normalizeReelStorySettings,
  serializeReelStorySettings,
  type ReelStorySettings,
  type ReelTextLengthKey,
} from '@/lib/reel/settings';

const REEL_TEXT_LENGTH_LABELS: Record<ReelTextLengthKey, string> = {
  short: 'Short',
  medium: 'Medium',
  long: 'Long',
};

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-neutral-900/60 p-4">
      <div>
        <p className="text-sm font-medium text-neutral-100">{label}</p>
        <p className="mt-0.5 text-xs text-neutral-400">{description}</p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className={`relative ml-6 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${checked ? 'bg-emerald-500' : 'bg-neutral-600'}`}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>
  );
}

function formatResultLabel(result: ReelCleanupResult): string {
  if (result.status === 'failed') return 'Failed';
  return result.mode === 'dry_run' ? 'Dry run complete' : 'Cleanup complete';
}

function formatAllowedVoices(voices: NarrationVoiceOption[]): string {
  return voices
    .map((voice) => [voice.voiceId, voice.label, voice.description ?? ''].join('|').replace(/\|+$/g, ''))
    .join('\n');
}

function parseAllowedVoices(
  value: string,
  fallback: NarrationVoiceOption[] = DEFAULT_REEL_NARRATION_ADMIN_SETTINGS.allowedElevenLabsVoices
): NarrationVoiceOption[] {
  const voices = value
    .split(/\r?\n/)
    .map((line): NarrationVoiceOption | null => {
      const [voiceId = '', label = '', description = ''] = line.split('|').map((part) => part.trim());
      if (!voiceId) return null;
      const voice: NarrationVoiceOption = {
        voiceId,
        label: label || voiceId,
      };
      if (description) voice.description = description;
      return voice;
    })
    .filter((voice): voice is NarrationVoiceOption => Boolean(voice));

  return voices.length > 0 ? voices : fallback;
}

function appendMissingVoices(
  current: NarrationVoiceOption[],
  recommended: NarrationVoiceOption[]
): NarrationVoiceOption[] {
  const existingIds = new Set(current.map((voice) => voice.voiceId));
  return [
    ...current,
    ...recommended.filter((voice) => !existingIds.has(voice.voiceId)),
  ];
}

function formatDictionaryLocators(locators: PronunciationDictionaryLocator[]): string {
  return locators
    .map((locator) => `${locator.pronunciation_dictionary_id}|${locator.version_id}`)
    .join('\n');
}

function parseDictionaryLocators(value: string): PronunciationDictionaryLocator[] {
  return value
    .split(/\r?\n/)
    .map((line) => {
      const [id = '', versionId = ''] = line.split('|').map((part) => part.trim());
      if (!id || !versionId) return null;
      return {
        pronunciation_dictionary_id: id,
        version_id: versionId,
      };
    })
    .filter((locator): locator is PronunciationDictionaryLocator => Boolean(locator));
}

export default function ReelSettings() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [toggleSaving, setToggleSaving] = useState(false);
  const [publishEnabled, setPublishEnabled] = useState(false);
  const [publishToggleSaving, setPublishToggleSaving] = useState(false);
  const [settingsJson, setSettingsJson] = useState(serializeReelStorySettings(DEFAULT_REEL_STORY_SETTINGS));
  const [lastSavedSettings, setLastSavedSettings] = useState<ReelStorySettings>(DEFAULT_REEL_STORY_SETTINGS);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [batchSizeInput, setBatchSizeInput] = useState('25');
  const [cleanupRunning, setCleanupRunning] = useState<null | 'dry_run' | 'execute'>(null);
  const [cleanupResult, setCleanupResult] = useState<ReelCleanupResult | null>(null);
  const [executeConfirmed, setExecuteConfirmed] = useState(false);

  useEffect(() => {
    getReelStorySetupSettings()
      .then((setup) => {
        setEnabled(setup.enabled);
        setPublishEnabled(setup.publishEnabled);
        setLastSavedSettings(setup.settings);
        setSettingsJson(serializeReelStorySettings(setup.settings));
        setLoadError(null);
      })
      .catch((error) => {
        setLoadError(error instanceof Error ? error.message : 'Failed to load Reel settings.');
      })
      .finally(() => setLoading(false));
  }, []);

  const parsedSettings = useMemo(() => {
    try {
      return JSON.parse(settingsJson) as ReelStorySettings;
    } catch {
      return null;
    }
  }, [settingsJson]);
  const editableSettings = useMemo(
    () => (parsedSettings ? normalizeReelStorySettings(parsedSettings) : null),
    [parsedSettings]
  );

  const hasSettingsChanges = settingsJson.trim() !== serializeReelStorySettings(lastSavedSettings).trim();
  const parsedBatchSize = Number.parseInt(batchSizeInput, 10);
  const batchSizeIsValid = Number.isFinite(parsedBatchSize) && parsedBatchSize >= 1 && parsedBatchSize <= 100;
  const narrationSettings = editableSettings?.narration ?? DEFAULT_REEL_NARRATION_ADMIN_SETTINGS;
  const enabledSystemPresetIds = new Set(narrationSettings.enabledSystemPresetIds);
  const enabledSystemPresets = SYSTEM_NARRATION_PRESETS.filter((preset) => enabledSystemPresetIds.has(preset.id));

  const handleToggle = async () => {
    setToggleSaving(true);
    const next = !enabled;
    try {
      await setReelStoryEnabled(next);
      setEnabled(next);
    } finally {
      setToggleSaving(false);
    }
  };

  const handlePublishToggle = async () => {
    setPublishToggleSaving(true);
    const next = !publishEnabled;
    try {
      await setReelStoryPublishEnabled(next);
      setPublishEnabled(next);
    } finally {
      setPublishToggleSaving(false);
    }
  };

  const handleSettingsSave = async () => {
    setSettingsSaving(true);
    setSettingsMessage(null);
    try {
      if (!parsedSettings) {
        setSettingsMessage('Settings JSON is not valid.');
        return;
      }
      const saved = await saveReelStorySettings(parsedSettings);
      setLastSavedSettings(saved);
      setSettingsJson(serializeReelStorySettings(saved));
      setSettingsMessage('Reel settings saved.');
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : 'Failed to save Reel settings.');
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleWordRangeChange = (
    length: ReelTextLengthKey,
    field: 'min' | 'max',
    value: string
  ) => {
    if (!parsedSettings) return;
    const nextValue = value.replace(/\D/g, '');
    const currentRanges = parsedSettings.textLengthWordRanges ?? DEFAULT_REEL_STORY_SETTINGS.textLengthWordRanges;
    const currentRange = currentRanges[length] ?? DEFAULT_REEL_STORY_SETTINGS.textLengthWordRanges[length];
    const nextSettings = {
      ...parsedSettings,
      textLengthWordRanges: {
        ...currentRanges,
        [length]: {
          ...currentRange,
          [field]: nextValue,
        },
      },
    };
    setSettingsJson(JSON.stringify(nextSettings, null, 2));
    setSettingsMessage(null);
  };

  const updateReelSettingsDraft = (updater: (settings: ReelStorySettings) => ReelStorySettings) => {
    if (!parsedSettings) return;
    const nextSettings = updater(normalizeReelStorySettings(parsedSettings));
    setSettingsJson(JSON.stringify(nextSettings, null, 2));
    setSettingsMessage(null);
  };

  const updateNarrationSettings = (patch: Partial<ReelNarrationAdminSettings>) => {
    updateReelSettingsDraft((settings) => ({
      ...settings,
      narration: {
        ...settings.narration,
        ...patch,
      },
    }));
  };

  const handleAddRecommendedVoices = () => {
    const femaleElevenLabsVoices = appendMissingVoices(
      narrationSettings.femaleElevenLabsVoices,
      RECOMMENDED_REEL_FEMALE_VOICES
    );
    const maleElevenLabsVoices = appendMissingVoices(
      narrationSettings.maleElevenLabsVoices,
      RECOMMENDED_REEL_MALE_VOICES
    );
    updateNarrationSettings({
      femaleElevenLabsVoices,
      maleElevenLabsVoices,
      allowedElevenLabsVoices: [...femaleElevenLabsVoices, ...maleElevenLabsVoices],
      defaultVoiceId: narrationSettings.defaultVoiceId || femaleElevenLabsVoices[0]?.voiceId,
    });
  };

  const toggleSystemPreset = (presetId: string) => {
    if (!editableSettings) return;
    const current = new Set(editableSettings.narration.enabledSystemPresetIds);
    if (current.has(presetId)) {
      current.delete(presetId);
    } else {
      current.add(presetId);
    }
    const enabledSystemPresetIds = Array.from(current);
    updateNarrationSettings({
      enabledSystemPresetIds,
      defaultPresetId: enabledSystemPresetIds.includes(editableSettings.narration.defaultPresetId)
        ? editableSettings.narration.defaultPresetId
        : enabledSystemPresetIds[0] ?? DEFAULT_REEL_NARRATION_ADMIN_SETTINGS.defaultPresetId,
    });
  };

  const handleCleanup = async (mode: 'dry_run' | 'execute') => {
    setCleanupRunning(mode);
    setCleanupResult(null);
    try {
      const result = await runReelCleanup({
        mode,
        batchSize: parsedBatchSize,
      });
      setCleanupResult(result);
    } finally {
      setCleanupRunning(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-sm text-neutral-400">
        <Loader2 size={16} className="animate-spin" />
        Loading Reel settings...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
        {loadError}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.22em] text-emerald-300">Global Settings</p>
        <h1 className="mt-2 text-2xl font-serif text-neutral-100">Reel Story</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-neutral-400">
          Configure the short-form Reel Story layer, its admin-editable prompt definers, defaults, retention windows, and manual draft cleanup.
        </p>
      </div>

      <ToggleRow
        label="Enable Reel Story"
        description="Shows the Reel Story creation mode on the landing screen."
        checked={enabled}
        disabled={toggleSaving}
        onToggle={handleToggle}
      />

      <ToggleRow
        label="Allow Reel Publishing"
        description="Shows the Publish action in completed reel editors. Export remains available through video export access."
        checked={publishEnabled}
        disabled={publishToggleSaving}
        onToggle={handlePublishToggle}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
          <p className="text-xs uppercase tracking-wider text-neutral-500">Default length</p>
          <p className="mt-2 text-lg text-neutral-100">{lastSavedSettings.defaultLength}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
          <p className="text-xs uppercase tracking-wider text-neutral-500">Panel count</p>
          <p className="mt-2 text-lg text-neutral-100">{lastSavedSettings.panelCount}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
          <p className="text-xs uppercase tracking-wider text-neutral-500">Mood presets</p>
          <p className="mt-2 text-lg text-neutral-100">{lastSavedSettings.moods.length}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
          <p className="text-xs uppercase tracking-wider text-neutral-500">Retention</p>
          <p className="mt-2 text-sm text-neutral-100">
            {lastSavedSettings.retentionDays.free}/{lastSavedSettings.retentionDays.plus}/{lastSavedSettings.retentionDays.studio} days
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Reel narration defaults</h2>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-neutral-400">
              Manage the global voice models, preset availability, fallback voice, and pronunciation settings used by Kissago Reels.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasSettingsChanges && <span className="text-xs text-amber-400">Unsaved</span>}
            <button
              type="button"
              onClick={handleSettingsSave}
              disabled={settingsSaving || !hasSettingsChanges || !parsedSettings}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {settingsSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Save
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-neutral-500">Default provider</span>
            <select
              value={narrationSettings.defaultProvider}
              disabled={!editableSettings}
              onChange={(event) => updateNarrationSettings({ defaultProvider: event.target.value as ReelNarrationAdminSettings['defaultProvider'] })}
              className="mt-1 w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none transition-colors focus:border-emerald-500/40 disabled:opacity-50"
            >
              <option value="elevenlabs">ElevenLabs</option>
              <option value="gemini_tts">Gemini TTS</option>
            </select>
          </label>

          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-neutral-500">Fallback provider</span>
            <select
              value={narrationSettings.fallbackProvider}
              disabled={!editableSettings}
              onChange={(event) => updateNarrationSettings({ fallbackProvider: event.target.value as ReelNarrationAdminSettings['fallbackProvider'] })}
              className="mt-1 w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none transition-colors focus:border-emerald-500/40 disabled:opacity-50"
            >
              <option value="gemini_tts">Gemini TTS</option>
            </select>
          </label>

          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-neutral-500">Default preset</span>
            <select
              value={narrationSettings.defaultPresetId}
              disabled={!editableSettings}
              onChange={(event) => updateNarrationSettings({ defaultPresetId: event.target.value })}
              className="mt-1 w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none transition-colors focus:border-emerald-500/40 disabled:opacity-50"
            >
              {(enabledSystemPresets.length > 0 ? enabledSystemPresets : SYSTEM_NARRATION_PRESETS).map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.name}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-neutral-500">Default voice ID</span>
            <input
              type="text"
              value={narrationSettings.defaultVoiceId}
              disabled={!editableSettings}
              onChange={(event) => updateNarrationSettings({ defaultVoiceId: event.target.value })}
              className="mt-1 w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none transition-colors focus:border-emerald-500/40 disabled:opacity-50"
            />
          </label>

          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-neutral-500">Base model</span>
            <input
              type="text"
              value={narrationSettings.defaultElevenLabsModel}
              disabled={!editableSettings}
              onChange={(event) => updateNarrationSettings({ defaultElevenLabsModel: event.target.value })}
              className="mt-1 w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none transition-colors focus:border-emerald-500/40 disabled:opacity-50"
            />
          </label>

          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-neutral-500">Preview model</span>
            <input
              type="text"
              value={narrationSettings.previewElevenLabsModel}
              disabled={!editableSettings}
              onChange={(event) => updateNarrationSettings({ previewElevenLabsModel: event.target.value })}
              className="mt-1 w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none transition-colors focus:border-emerald-500/40 disabled:opacity-50"
            />
          </label>

          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-neutral-500">Final model</span>
            <input
              type="text"
              value={narrationSettings.finalElevenLabsModel}
              disabled={!editableSettings}
              onChange={(event) => updateNarrationSettings({ finalElevenLabsModel: event.target.value })}
              className="mt-1 w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none transition-colors focus:border-emerald-500/40 disabled:opacity-50"
            />
          </label>

          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-neutral-500">Gemini fallback voice</span>
            <input
              type="text"
              value={narrationSettings.fallbackGeminiVoice}
              disabled={!editableSettings}
              onChange={(event) => updateNarrationSettings({ fallbackGeminiVoice: event.target.value })}
              className="mt-1 w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none transition-colors focus:border-emerald-500/40 disabled:opacity-50"
            />
          </label>

          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-neutral-500">Max narration characters</span>
            <input
              type="number"
              min={200}
              max={20000}
              value={narrationSettings.maxNarrationLength}
              disabled={!editableSettings}
              onChange={(event) => updateNarrationSettings({ maxNarrationLength: Number(event.target.value) })}
              className="mt-1 w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none transition-colors focus:border-emerald-500/40 disabled:opacity-50"
            />
          </label>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-neutral-950/60 p-4 text-sm text-neutral-200">
            <span>Expressive tags</span>
            <input
              type="checkbox"
              checked={narrationSettings.expressiveTagsEnabled}
              disabled={!editableSettings}
              onChange={(event) => updateNarrationSettings({ expressiveTagsEnabled: event.target.checked })}
              className="h-4 w-4 accent-emerald-500"
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-neutral-950/60 p-4 text-sm text-neutral-200">
            <span>Pronunciation dictionaries</span>
            <input
              type="checkbox"
              checked={narrationSettings.pronunciationDictionaryEnabled}
              disabled={!editableSettings}
              onChange={(event) => updateNarrationSettings({ pronunciationDictionaryEnabled: event.target.checked })}
              className="h-4 w-4 accent-emerald-500"
            />
          </label>
        </div>

        <div className="mt-5 rounded-xl border border-white/10 bg-neutral-950/40 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-neutral-500">ElevenLabs reel voices</p>
              <p className="mt-1 text-xs leading-relaxed text-neutral-400">
                Add one voice per line as voiceId|Label|Description. Users choose Female or Male first, then pick from that list.
              </p>
            </div>
            <button
              type="button"
              onClick={handleAddRecommendedVoices}
              disabled={!editableSettings}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCcw size={13} />
              Add recommended voices
            </button>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-neutral-500">Female voices</span>
              <textarea
                value={formatAllowedVoices(narrationSettings.femaleElevenLabsVoices)}
                disabled={!editableSettings}
                onChange={(event) => {
                  const femaleElevenLabsVoices = parseAllowedVoices(
                    event.target.value,
                    DEFAULT_REEL_NARRATION_ADMIN_SETTINGS.femaleElevenLabsVoices
                  );
                  updateNarrationSettings({
                    femaleElevenLabsVoices,
                    allowedElevenLabsVoices: [...femaleElevenLabsVoices, ...narrationSettings.maleElevenLabsVoices],
                  });
                }}
                spellCheck={false}
                className="mt-1 min-h-28 w-full rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-100 outline-none transition-colors focus:border-emerald-500/40 disabled:opacity-50"
              />
            </label>

            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-neutral-500">Male voices</span>
              <textarea
                value={formatAllowedVoices(narrationSettings.maleElevenLabsVoices)}
                disabled={!editableSettings}
                onChange={(event) => {
                  const maleElevenLabsVoices = parseAllowedVoices(
                    event.target.value,
                    DEFAULT_REEL_NARRATION_ADMIN_SETTINGS.maleElevenLabsVoices
                  );
                  updateNarrationSettings({
                    maleElevenLabsVoices,
                    allowedElevenLabsVoices: [...narrationSettings.femaleElevenLabsVoices, ...maleElevenLabsVoices],
                  });
                }}
                spellCheck={false}
                className="mt-1 min-h-28 w-full rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-100 outline-none transition-colors focus:border-emerald-500/40 disabled:opacity-50"
              />
            </label>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-neutral-500">Pronunciation locators</span>
            <textarea
              value={formatDictionaryLocators(narrationSettings.pronunciationDictionaryLocators)}
              disabled={!editableSettings}
              onChange={(event) => updateNarrationSettings({ pronunciationDictionaryLocators: parseDictionaryLocators(event.target.value) })}
              spellCheck={false}
              className="mt-1 min-h-28 w-full rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-100 outline-none transition-colors focus:border-emerald-500/40 disabled:opacity-50"
            />
          </label>
        </div>

        <div className="mt-5">
          <p className="text-[11px] uppercase tracking-wider text-neutral-500">Enabled system presets</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {SYSTEM_NARRATION_PRESETS.map((preset) => (
              <label key={preset.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-neutral-950/60 px-3 py-2 text-sm text-neutral-200">
                <input
                  type="checkbox"
                  checked={enabledSystemPresetIds.has(preset.id)}
                  disabled={!editableSettings}
                  onChange={() => toggleSystemPreset(preset.id)}
                  className="h-4 w-4 accent-emerald-500"
                />
                <span>{preset.name}</span>
              </label>
            ))}
          </div>
        </div>

        {!editableSettings && (
          <p className="mt-3 text-xs text-rose-300">Fix the JSON syntax error before editing narration controls.</p>
        )}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Reel text length</h2>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-neutral-400">
              Configure the target words per image panel for each user-facing text length. Each reel beat has four panels, so the writer also receives a total beat budget based on these values.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasSettingsChanges && <span className="text-xs text-amber-400">Unsaved</span>}
            <button
              type="button"
              onClick={handleSettingsSave}
              disabled={settingsSaving || !hasSettingsChanges || !parsedSettings}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {settingsSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Save
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {REEL_TEXT_LENGTH_KEYS.map((length) => {
            const rawRange = parsedSettings?.textLengthWordRanges?.[length];
            const range = editableSettings?.textLengthWordRanges[length]
              ?? DEFAULT_REEL_STORY_SETTINGS.textLengthWordRanges[length];
            const totalMin = range.min * (editableSettings?.panelCount ?? DEFAULT_REEL_STORY_SETTINGS.panelCount);
            const totalMax = range.max * (editableSettings?.panelCount ?? DEFAULT_REEL_STORY_SETTINGS.panelCount);
            const minValue = rawRange?.min ?? range.min;
            const maxValue = rawRange?.max ?? range.max;

            return (
              <div key={length} className="rounded-xl border border-white/10 bg-neutral-950/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-neutral-100">{REEL_TEXT_LENGTH_LABELS[length]}</p>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-neutral-400">
                    {totalMin}-{totalMax} / beat
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-neutral-500">Min / panel</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={String(minValue)}
                      disabled={!editableSettings}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => handleWordRangeChange(length, 'min', event.target.value)}
                      className="mt-1 w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none transition-colors focus:border-emerald-500/40 disabled:opacity-50"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-neutral-500">Max / panel</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={String(maxValue)}
                      disabled={!editableSettings}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => handleWordRangeChange(length, 'max', event.target.value)}
                      className="mt-1 w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none transition-colors focus:border-emerald-500/40 disabled:opacity-50"
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        {!editableSettings && (
          <p className="mt-3 text-xs text-rose-300">Fix the JSON syntax error before editing text length controls.</p>
        )}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Reel settings JSON</h2>
            <p className="mt-2 text-xs leading-relaxed text-neutral-400">
              Edit defaults, mood definers, visual style definers, narration style definers, and plan retention days. Panel count is normalized to 4 in v1.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasSettingsChanges && <span className="text-xs text-amber-400">Unsaved</span>}
            <button
              type="button"
              onClick={() => {
                setSettingsJson(serializeReelStorySettings(DEFAULT_REEL_STORY_SETTINGS));
                setSettingsMessage('Defaults loaded in the editor. Save to publish them.');
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-300 transition-colors hover:border-white/20 hover:bg-white/10"
            >
              <RefreshCcw size={13} />
              Defaults
            </button>
            <button
              type="button"
              onClick={handleSettingsSave}
              disabled={settingsSaving || !hasSettingsChanges || !parsedSettings}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {settingsSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Save
            </button>
          </div>
        </div>

        <textarea
          value={settingsJson}
          onChange={(event) => {
            setSettingsJson(event.target.value);
            setSettingsMessage(null);
          }}
          spellCheck={false}
          className="mt-4 min-h-[520px] w-full rounded-xl border border-white/10 bg-neutral-950/80 p-4 font-mono text-xs leading-relaxed text-neutral-100 outline-none transition-colors focus:border-emerald-500/40"
        />

        {!parsedSettings && (
          <p className="mt-3 text-xs text-rose-300">The JSON editor has a syntax error.</p>
        )}
        {settingsMessage && (
          <p className="mt-3 text-xs text-neutral-300">{settingsMessage}</p>
        )}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Expired draft cleanup</h2>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-neutral-400">
              Manual cleanup only. The action targets expired unpublished reel drafts, deletes private linked media, then deletes the draft story row. Public storylines are excluded.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={1}
              max={100}
              value={batchSizeInput}
              onChange={(event) => setBatchSizeInput(event.target.value)}
              className="w-24 rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500/40"
            />
            <button
              type="button"
              onClick={() => handleCleanup('dry_run')}
              disabled={cleanupRunning !== null || !batchSizeIsValid}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-300 transition-colors hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {cleanupRunning === 'dry_run' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />}
              Dry run
            </button>
            <button
              type="button"
              onClick={() => handleCleanup('execute')}
              disabled={cleanupRunning !== null || !batchSizeIsValid || !executeConfirmed}
              className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {cleanupRunning === 'execute' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Execute
            </button>
          </div>
        </div>

        <label className="mt-4 flex items-center gap-3 rounded-xl border border-white/10 bg-neutral-900/60 p-4 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={executeConfirmed}
            onChange={(event) => setExecuteConfirmed(event.target.checked)}
            className="h-4 w-4 accent-rose-500"
          />
          I understand execute permanently deletes eligible reel draft rows and private media.
        </label>

        {cleanupResult && (
          <div className="mt-4 rounded-xl border border-white/10 bg-neutral-950/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-neutral-100">{formatResultLabel(cleanupResult)}</p>
                <p className="mt-1 text-xs text-neutral-400">{cleanupResult.message}</p>
              </div>
              {cleanupResult.runId && (
                <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-wider text-neutral-500">
                  Audit {cleanupResult.runId.slice(0, 8)}
                </span>
              )}
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-4">
              {[
                ['Eligible stories', cleanupResult.eligibleStoryCount],
                ['Deleted stories', cleanupResult.deletedStoryCount],
                ['Deleted assets', cleanupResult.deletedAssetCount],
                ['Failed assets', cleanupResult.failedAssetCount],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-white/10 bg-neutral-900/70 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</p>
                  <p className="mt-2 text-lg text-neutral-100">{value}</p>
                </div>
              ))}
            </div>

            {cleanupResult.stories.length > 0 && (
              <div className="mt-4 max-h-72 overflow-auto rounded-lg border border-white/10">
                {cleanupResult.stories.slice(0, 25).map((story) => (
                  <div key={story.storyId} className="border-b border-white/10 p-3 last:border-b-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-neutral-100">{story.title}</p>
                      <span className="text-[10px] uppercase tracking-wider text-neutral-500">
                        {story.privateAssetCount} private / {story.publicAssetCount} public assets
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-neutral-500">{story.storyId}</p>
                    <p className="mt-1 text-xs text-neutral-500">Expires: {story.expiresAt || 'unknown'}</p>
                  </div>
                ))}
              </div>
            )}

            {cleanupResult.errors.length > 0 && (
              <div className="mt-4 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3">
                <p className="text-xs font-medium text-rose-200">Errors</p>
                <ul className="mt-2 space-y-1 text-xs text-rose-200/80">
                  {cleanupResult.errors.slice(0, 10).map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
