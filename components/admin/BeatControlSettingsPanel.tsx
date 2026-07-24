'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import AdminToggle from '@/components/admin/AdminToggle';
import {
  getBeatControlAdminSettings,
  setBeatControlFlag,
  setBeatImageMaxVersionsPerBeat,
  type BeatControlAdminSettings,
} from '@/app/actions/admin';
import {
  MAX_BEAT_IMAGE_VERSIONS_PER_BEAT,
  MIN_BEAT_IMAGE_VERSIONS_PER_BEAT,
  type BeatControlFlagKey,
} from '@/lib/beat-control/settings';

const FLAG_FIELDS: Array<{ key: BeatControlFlagKey; label: string; description: string }> = [
  {
    key: 'beat_text_edit_enabled',
    label: 'Beat text editing',
    description: 'Users can edit the story text of a beat. Past-beat edits go through the timeline rewrite warning.',
  },
  {
    key: 'beat_timeline_rewrite_enabled',
    label: 'Timeline rewrite (downstream wipe)',
    description: 'Allows confirmed story-changing edits to past beats, removing all later beats. With this off, past beats are fully locked.',
  },
  {
    key: 'beat_image_regen_enabled',
    label: 'Image regeneration',
    description: 'Regenerate a beat image with refine/reimagine modes and an optional visual suggestion. Never changes story text.',
  },
  {
    key: 'beat_panel_suggestions_enabled',
    label: 'Advanced panel suggestions',
    description: 'Per-panel instructions for 4-panel storyboard beats inside the image regeneration dialog.',
  },
  {
    key: 'beat_image_version_history_enabled',
    label: 'Image version history',
    description: 'Version drawer with restore. Versions are still recorded while this is off; only the UI is hidden.',
  },
  {
    key: 'beat_narration_regen_enabled',
    label: 'Narration regeneration',
    description: 'Regenerate narration audio for a beat from its current story text.',
  },
  {
    key: 'beat_options_regen_enabled',
    label: 'Options regeneration',
    description: 'Replace the AI-generated choices of the current beat. Custom options written by the user are preserved.',
  },
  {
    key: 'beat_custom_options_enabled',
    label: 'Custom options',
    description: 'Users can write their own next choice, with @name mentions of story characters.',
  },
];

export default function BeatControlSettingsPanel() {
  const [settings, setSettings] = useState<BeatControlAdminSettings | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [maxVersionsDraft, setMaxVersionsDraft] = useState<number | null>(null);
  const [savingMaxVersions, setSavingMaxVersions] = useState(false);

  useEffect(() => {
    getBeatControlAdminSettings()
      .then((state) => {
        setSettings(state);
        setMaxVersionsDraft(state.maxImageVersionsPerBeat);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Failed to load settings'));
  }, []);

  const handleToggle = async (key: BeatControlFlagKey) => {
    if (!settings) return;
    const next = !settings.flags[key];
    setTogglingKey(key);
    setMessage(null);
    try {
      await setBeatControlFlag(key, next);
      setSettings((prev) => (prev ? { ...prev, flags: { ...prev.flags, [key]: next } } : prev));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to update flag');
    } finally {
      setTogglingKey(null);
    }
  };

  const handleSaveMaxVersions = async () => {
    if (!settings || maxVersionsDraft === null) return;
    setSavingMaxVersions(true);
    setMessage(null);
    try {
      await setBeatImageMaxVersionsPerBeat(maxVersionsDraft);
      setSettings((prev) => (prev ? { ...prev, maxImageVersionsPerBeat: maxVersionsDraft } : prev));
      setMessage('Version cap saved. Changes apply within ~60 seconds.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save version cap');
    } finally {
      setSavingMaxVersions(false);
    }
  };

  if (!settings) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-neutral-400">
        {message ?? (
          <span className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Loading beat control settings…
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Beat Control Features</h2>
        <p className="-mt-2 text-xs text-neutral-400">
          Flags are enforced in the backend too — turning one off hides the UI and rejects direct requests.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {FLAG_FIELDS.map((field) => (
            <div
              key={field.key}
              className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-neutral-900/60 p-4"
            >
              <span>
                <span className="block text-sm text-neutral-100">{field.label}</span>
                <span className="mt-0.5 block text-xs leading-snug text-neutral-400">{field.description}</span>
              </span>
              <span className="mt-1 shrink-0">
                <AdminToggle
                  checked={settings.flags[field.key]}
                  onToggle={() => void handleToggle(field.key)}
                  disabled={togglingKey === field.key}
                  ariaLabel={`Toggle ${field.label}`}
                />
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Version History</h2>
        <label className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-neutral-900/60 p-4 text-sm text-neutral-300">
          <span>
            <span className="block text-sm text-neutral-100">Max image versions per beat</span>
            <span className="mt-0.5 block text-xs text-neutral-400">
              Oldest regenerated versions beyond this cap are evicted. User uploads and the active image are never evicted.
            </span>
          </span>
          <span className="flex items-center gap-2">
            <input
              type="number"
              min={MIN_BEAT_IMAGE_VERSIONS_PER_BEAT}
              max={MAX_BEAT_IMAGE_VERSIONS_PER_BEAT}
              value={maxVersionsDraft ?? settings.maxImageVersionsPerBeat}
              onChange={(event) => setMaxVersionsDraft(Number(event.target.value))}
              className="w-24 rounded-lg border border-white/10 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <button
              onClick={() => void handleSaveMaxVersions()}
              disabled={savingMaxVersions || maxVersionsDraft === settings.maxImageVersionsPerBeat}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingMaxVersions ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
            </button>
          </span>
        </label>
      </div>

      {message && <p className="text-xs text-amber-300">{message}</p>}
    </div>
  );
}
