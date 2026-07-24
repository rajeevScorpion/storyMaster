'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import AdminToggle from '@/components/admin/AdminToggle';
import {
  getCharacterUniverseAdminSettings,
  setCharacterUniverseFlag,
  type CharacterUniverseAdminSettings,
} from '@/app/actions/admin';
import { type CharacterUniverseFlagKey } from '@/lib/character-universe/settings';

const FLAG_FIELDS: Array<{ key: CharacterUniverseFlagKey; label: string; description: string }> = [
  {
    key: 'character_library_enabled',
    label: 'Character library',
    description: 'The "Characters" tab in My Stories, showing saved reusable characters with edit and archive.',
  },
  {
    key: 'character_global_save_enabled',
    label: 'Save characters to library',
    description: 'The "Save to My Library" affordance on story characters. Reading the library stays available while off.',
  },
  {
    key: 'character_mixing_enabled',
    label: 'Character mixing',
    description: 'Bring saved characters into a brand-new story from the landing screen (picker + @name mentions).',
  },
  {
    key: 'episodes_enabled',
    label: 'Episodes (Continue as Episode)',
    description: 'Continue a finished story as the next connected episode, automatically carrying its named characters.',
  },
  {
    key: 'story_bible_enabled',
    label: 'Story bible',
    description: 'Generate and carry an editable series bible (world rules + inherited settings) across episodes.',
  },
  {
    key: 'episode_journal_enabled',
    label: 'Episode journal',
    description: 'Append-only series memory: episode summaries and structural events feeding future episode context.',
  },
];

export default function CharacterUniverseSettingsPanel() {
  const [settings, setSettings] = useState<CharacterUniverseAdminSettings | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  useEffect(() => {
    getCharacterUniverseAdminSettings()
      .then(setSettings)
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Failed to load settings'));
  }, []);

  const handleToggle = async (key: CharacterUniverseFlagKey) => {
    if (!settings) return;
    const next = !settings.flags[key];
    setTogglingKey(key);
    setMessage(null);
    try {
      await setCharacterUniverseFlag(key, next);
      setSettings((prev) => (prev ? { ...prev, flags: { ...prev.flags, [key]: next } } : prev));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to update flag');
    } finally {
      setTogglingKey(null);
    }
  };

  if (!settings) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-neutral-400">
        {message ?? (
          <span className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Loading character universe settings…
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Characters &amp; Episodes</h2>
        <p className="-mt-2 text-xs text-neutral-400">
          Flags are enforced in the backend too — turning one off hides the UI and rejects direct requests.
          Existing library characters, bibles, and journals are kept while a flag is off.
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

      {message && <p className="text-xs text-amber-300">{message}</p>}
    </div>
  );
}
