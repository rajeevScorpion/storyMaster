'use client';

import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import FilterDropdown from '@/components/ui/FilterDropdown';
import AdminToggle from '@/components/admin/AdminToggle';
import { createPersona, updatePersona, type AgentPersona, type AgentPersonaInput } from '@/app/actions/agentic-personas';
import { STORY_CONFIG_KEYS } from '@/lib/agentic/personas.shared';
import { buildPersonaVoiceOptions, buildPersonaVoiceUsage, type PersonaVoiceLists } from '@/lib/agentic/persona-voice.shared';
import { STORY_LANGUAGE_OPTIONS } from '@/lib/ai/story-config';
import { STORY_AUDIENCE_OPTIONS } from '@/lib/ai/story-audience';
import { STORY_GENRES } from '@/lib/story/genres';

const STATUS_FORM_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'testing', label: 'Testing' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
];

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function joinList(values: string[]): string {
  return values.join(', ');
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

interface FormState {
  slug: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  language: string;
  ageGroup: string;
  genres: string[];
  speciality: string;
  personaPrompt: string;
  creativeNotes: string;
  restrictedThemes: string;
  defaultStoryConfig: string;
  dynamicSettingKeys: string[];
  beatCountMin: string;
  beatCountMax: string;
  preferredVoice: string;
  allowImageGeneration: boolean;
  allowNarration: boolean;
  modelOverrides: string;
  status: string;
  scheduleEligible: boolean;
}

function buildInitialState(persona: AgentPersona | null): FormState {
  if (!persona) {
    return {
      slug: '',
      displayName: '',
      bio: '',
      avatarUrl: '',
      language: 'english',
      ageGroup: 'all_ages',
      genres: [],
      speciality: '',
      personaPrompt: '',
      creativeNotes: '',
      restrictedThemes: '',
      defaultStoryConfig: '{}',
      dynamicSettingKeys: [],
      beatCountMin: '6',
      beatCountMax: '10',
      preferredVoice: '',
      allowImageGeneration: false,
      allowNarration: false,
      modelOverrides: '{}',
      status: 'draft',
      scheduleEligible: false,
    };
  }

  return {
    slug: persona.slug,
    displayName: persona.displayName,
    bio: persona.bio ?? '',
    avatarUrl: persona.avatarUrl ?? '',
    language: persona.language,
    ageGroup: persona.ageGroup,
    genres: [...persona.genres],
    speciality: persona.speciality ?? '',
    personaPrompt: persona.personaPrompt,
    creativeNotes: persona.creativeNotes ?? '',
    restrictedThemes: joinList(persona.restrictedThemes),
    defaultStoryConfig: JSON.stringify(persona.defaultStoryConfig ?? {}, null, 2),
    dynamicSettingKeys: [...persona.dynamicSettingKeys],
    beatCountMin: String(persona.beatCountMin),
    beatCountMax: String(persona.beatCountMax),
    preferredVoice: persona.preferredVoice ?? '',
    allowImageGeneration: persona.allowImageGeneration,
    allowNarration: persona.allowNarration,
    modelOverrides: JSON.stringify(persona.modelOverrides ?? {}, null, 2),
    status: persona.status,
    scheduleEligible: persona.scheduleEligible,
  };
}

/**
 * Create/edit form for a single persona. Rendered by PersonaCatalogue with a
 * fresh `key` per open (new persona vs. a specific persona's id), so this
 * component can own its form state with plain useState instead of syncing it
 * against a changing `persona` prop via effects.
 */
export default function PersonaEditorDrawer({
  persona,
  voiceLists,
  allPersonas,
  onClose,
  onSaved,
}: {
  /** null = create mode. */
  persona: AgentPersona | null;
  /** The two voice lists the narration-voice dropdown offers (Phase 8, Unit 8b). */
  voiceLists: PersonaVoiceLists;
  /** Full roster (not filtered to the catalogue's current view) so buildPersonaVoiceUsage sees every persona already using a voice. */
  allPersonas: AgentPersona[];
  onClose: () => void;
  onSaved: (persona: AgentPersona) => void;
}) {
  const [form, setForm] = useState<FormState>(() => buildInitialState(persona));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = Boolean(persona);

  // The slug this persona is known by in `allPersonas` -- an existing
  // persona's stored slug (stable, matches what buildPersonaVoiceUsage keyed
  // its sharers by), or, for a brand-new persona, the slug the form is
  // currently deriving from its own fields. Either way, this is what excludes
  // the persona being edited from its own voice's sharer list.
  const currentSlug = useMemo(
    () => (persona ? persona.slug : slugify(form.slug || form.displayName)),
    [persona, form.slug, form.displayName]
  );

  const voiceUsage = useMemo(() => buildPersonaVoiceUsage(allPersonas), [allPersonas]);

  const voiceOptions = useMemo(
    () =>
      buildPersonaVoiceOptions({
        lists: voiceLists,
        storedVoice: persona?.preferredVoice ?? null,
        usage: voiceUsage,
        currentSlug,
        // The form's live language, not the saved one -- switching a
        // persona's language should immediately re-evaluate which sharers
        // count as same-language.
        currentLanguage: form.language,
      }),
    [voiceLists, persona, voiceUsage, currentSlug, form.language]
  );

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleFromList(key: 'genres' | 'dynamicSettingKeys', value: string) {
    setForm((current) => {
      const list = current[key];
      const next = list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
      return { ...current, [key]: next };
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const slug = slugify(form.slug || form.displayName);
    if (!slug) {
      setError('Slug is required.');
      return;
    }
    if (!form.displayName.trim()) {
      setError('Display name is required.');
      return;
    }
    if (!form.personaPrompt.trim()) {
      setError('Persona prompt is required.');
      return;
    }

    let defaultStoryConfig: Record<string, unknown>;
    let modelOverrides: Record<string, unknown>;
    try {
      defaultStoryConfig = parseJsonObject(form.defaultStoryConfig, 'Default story config');
      modelOverrides = parseJsonObject(form.modelOverrides, 'Model overrides');
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'Invalid JSON.');
      return;
    }

    const beatCountMin = Math.max(1, Math.round(Number(form.beatCountMin) || 6));
    const beatCountMax = Math.max(beatCountMin, Math.round(Number(form.beatCountMax) || beatCountMin));

    setSaving(true);
    try {
      if (isEdit && persona) {
        const patch: Partial<AgentPersonaInput> = {
          slug,
          displayName: form.displayName.trim(),
          bio: form.bio.trim() || null,
          avatarUrl: form.avatarUrl.trim() || null,
          language: form.language as AgentPersona['language'],
          ageGroup: form.ageGroup as AgentPersona['ageGroup'],
          genres: form.genres,
          speciality: form.speciality.trim() || null,
          personaPrompt: form.personaPrompt.trim(),
          creativeNotes: form.creativeNotes.trim() || null,
          restrictedThemes: splitList(form.restrictedThemes),
          defaultStoryConfig,
          dynamicSettingKeys: form.dynamicSettingKeys,
          beatCountMin,
          beatCountMax,
          preferredVoice: form.preferredVoice.trim() || null,
          // approvedVoicePool intentionally omitted (Phase 8, Unit 8b): the
          // field is retired from this editor, not deleted from the schema.
          // mapInputToRow (agentic-personas.ts) only writes a column when its
          // key is present on the patch, so leaving this key out preserves
          // whatever approved_voice_pool the row already holds -- sending `[]`
          // or the old value back would either erase or needlessly rewrite it.
          allowImageGeneration: form.allowImageGeneration,
          allowNarration: form.allowNarration,
          modelOverrides,
          status: form.status as AgentPersona['status'],
          scheduleEligible: form.scheduleEligible,
        };
        const updated = await updatePersona(persona.id, patch);
        onSaved(updated);
      } else {
        const input: AgentPersonaInput = {
          slug,
          displayName: form.displayName.trim(),
          bio: form.bio.trim() || null,
          avatarUrl: form.avatarUrl.trim() || null,
          language: form.language as AgentPersona['language'],
          ageGroup: form.ageGroup as AgentPersona['ageGroup'],
          genres: form.genres,
          speciality: form.speciality.trim() || null,
          personaPrompt: form.personaPrompt.trim(),
          creativeNotes: form.creativeNotes.trim() || null,
          restrictedThemes: splitList(form.restrictedThemes),
          defaultStoryConfig,
          dynamicSettingKeys: form.dynamicSettingKeys,
          beatCountMin,
          beatCountMax,
          preferredVoice: form.preferredVoice.trim() || null,
          // approvedVoicePool intentionally omitted here too -- see the
          // matching comment in the update-patch branch above. A brand-new
          // persona simply starts with no approved_voice_pool value (the DB
          // column's own default applies), since nothing in this codebase
          // reads that column anymore.
          allowImageGeneration: form.allowImageGeneration,
          allowNarration: form.allowNarration,
          modelOverrides,
          status: 'draft',
          scheduleEligible: false,
          isSeed: false,
          clonedFrom: null,
        };
        const created = await createPersona(input);
        onSaved(created);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to save persona.');
    } finally {
      setSaving(false);
    }
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[110] flex justify-end bg-black/70 backdrop-blur-sm"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) onClose();
        }}
      >
        <motion.section
          role="dialog"
          aria-modal="true"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="flex h-full w-full max-w-xl flex-col border-l border-white/10 bg-neutral-950 shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
            <div>
              <h2 className="text-base font-semibold text-neutral-100">
                {isEdit ? `Edit ${persona?.displayName}` : 'New persona'}
              </h2>
              <p className="mt-0.5 text-xs text-neutral-500">
                {isEdit ? persona?.slug : 'Draft only — nothing generates until this is promoted to Active.'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-full p-2 text-neutral-500 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <FieldGroup title="Identity">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Display name">
                    <input
                      value={form.displayName}
                      onChange={(event) => update('displayName', event.target.value)}
                      className={inputClass}
                      placeholder="Aria the Storyteller"
                    />
                  </Field>
                  <Field label="Slug">
                    <input
                      value={form.slug}
                      onChange={(event) => update('slug', event.target.value)}
                      className={inputClass}
                      placeholder="aria-the-storyteller"
                    />
                  </Field>
                </div>
                <Field label="Bio">
                  <textarea
                    value={form.bio}
                    onChange={(event) => update('bio', event.target.value)}
                    className={`${inputClass} min-h-16 resize-y`}
                    placeholder="A short public-facing description of this persona."
                  />
                </Field>
                <Field label="Avatar URL">
                  <input
                    value={form.avatarUrl}
                    onChange={(event) => update('avatarUrl', event.target.value)}
                    className={inputClass}
                    placeholder="https://…"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Language">
                    <FilterDropdown
                      value={form.language}
                      options={STORY_LANGUAGE_OPTIONS}
                      onChange={(value) => update('language', value)}
                      ariaLabel="Persona language"
                      fullWidth
                    />
                  </Field>
                  <Field label="Age group">
                    <FilterDropdown
                      value={form.ageGroup}
                      options={STORY_AUDIENCE_OPTIONS}
                      onChange={(value) => update('ageGroup', value)}
                      ariaLabel="Persona age group"
                      fullWidth
                    />
                  </Field>
                </div>
                <Field label="Genres">
                  <ChipToggleGroup
                    options={STORY_GENRES}
                    selected={form.genres}
                    onToggle={(value) => toggleFromList('genres', value)}
                  />
                </Field>
                <Field label="Speciality">
                  <input
                    value={form.speciality}
                    onChange={(event) => update('speciality', event.target.value)}
                    className={inputClass}
                    placeholder="e.g. gentle mystery for early readers"
                  />
                </Field>
              </FieldGroup>

              <FieldGroup title="Creative identity">
                <Field label="Persona prompt" required>
                  <textarea
                    value={form.personaPrompt}
                    onChange={(event) => update('personaPrompt', event.target.value)}
                    className={`${inputClass} min-h-28 resize-y font-mono text-xs`}
                    placeholder="The voice, values, and storytelling instincts this persona writes with."
                  />
                </Field>
                <Field label="Creative notes">
                  <textarea
                    value={form.creativeNotes}
                    onChange={(event) => update('creativeNotes', event.target.value)}
                    className={`${inputClass} min-h-16 resize-y`}
                    placeholder="Internal notes for reviewers — never shown to readers."
                  />
                </Field>
                <Field label="Restricted themes (comma separated)">
                  <input
                    value={form.restrictedThemes}
                    onChange={(event) => update('restrictedThemes', event.target.value)}
                    className={inputClass}
                    placeholder="body horror, real-world tragedy"
                  />
                </Field>
              </FieldGroup>

              <FieldGroup title="Story defaults">
                <Field label="Default story config (JSON)">
                  <textarea
                    value={form.defaultStoryConfig}
                    onChange={(event) => update('defaultStoryConfig', event.target.value)}
                    className={`${inputClass} min-h-24 resize-y font-mono text-xs`}
                    spellCheck={false}
                  />
                </Field>
                <Field label="Overridable settings">
                  <ChipToggleGroup
                    options={STORY_CONFIG_KEYS.map((key) => ({ value: key, label: key }))}
                    selected={form.dynamicSettingKeys}
                    onToggle={(value) => toggleFromList('dynamicSettingKeys', value)}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Min beats">
                    <input
                      type="number"
                      min={1}
                      value={form.beatCountMin}
                      onChange={(event) => update('beatCountMin', event.target.value)}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Max beats">
                    <input
                      type="number"
                      min={1}
                      value={form.beatCountMax}
                      onChange={(event) => update('beatCountMax', event.target.value)}
                      className={inputClass}
                    />
                  </Field>
                </div>
              </FieldGroup>

              <FieldGroup title="Voice">
                <Field label="Narration voice">
                  <FilterDropdown
                    value={form.preferredVoice}
                    options={voiceOptions}
                    onChange={(value) => update('preferredVoice', value)}
                    ariaLabel="Persona narration voice"
                    fullWidth
                  />
                </Field>
              </FieldGroup>

              <FieldGroup title="Permissions">
                <ToggleRow
                  label="Allow image generation"
                  description="Off means every story from this persona is technically prompt-only — no image call is possible."
                  checked={form.allowImageGeneration}
                  onToggle={() => update('allowImageGeneration', !form.allowImageGeneration)}
                />
                <ToggleRow
                  label="Allow narration"
                  description="Independent of images — governs whether this persona's stories may be narrated."
                  checked={form.allowNarration}
                  onToggle={() => update('allowNarration', !form.allowNarration)}
                />
              </FieldGroup>

              <FieldGroup title="Model overrides">
                <Field label="Model overrides (JSON)">
                  <textarea
                    value={form.modelOverrides}
                    onChange={(event) => update('modelOverrides', event.target.value)}
                    className={`${inputClass} min-h-20 resize-y font-mono text-xs`}
                    spellCheck={false}
                  />
                </Field>
              </FieldGroup>

              {isEdit && (
                <FieldGroup title="Lifecycle">
                  <Field label="Status">
                    <FilterDropdown
                      value={form.status}
                      options={STATUS_FORM_OPTIONS}
                      onChange={(value) => update('status', value)}
                      ariaLabel="Persona status"
                      fullWidth
                    />
                  </Field>
                  <ToggleRow
                    label="Schedule eligible"
                    description="Lets the (not-yet-built) scheduler pick this persona up automatically."
                    checked={form.scheduleEligible}
                    onToggle={() => update('scheduleEligible', !form.scheduleEligible)}
                  />
                </FieldGroup>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-white/10 px-6 py-4">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-full px-4 py-2 text-sm font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-400 px-5 py-2 text-sm font-semibold text-neutral-950 transition-colors hover:bg-emerald-300 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {isEdit ? 'Save changes' : 'Create persona'}
              </button>
            </div>
          </form>
        </motion.section>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

const inputClass =
  'w-full rounded-xl border border-white/10 bg-neutral-900/80 px-3 py-2 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-emerald-500/40';

function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs text-neutral-400">
        {label}
        {required && <span className="ml-1 text-rose-400">*</span>}
      </span>
      {children}
    </label>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onToggle,
}: {
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-neutral-900/60 p-3">
      <div>
        <p className="text-sm text-neutral-200">{label}</p>
        <p className="mt-0.5 text-xs text-neutral-500">{description}</p>
      </div>
      <AdminToggle checked={checked} onToggle={onToggle} ariaLabel={label} />
    </div>
  );
}

function ChipToggleGroup({
  options,
  selected,
  onToggle,
}: {
  options: readonly { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const isActive = selected.includes(option.value);
        return (
          <button
            type="button"
            key={option.value}
            onClick={() => onToggle(option.value)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              isActive
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : 'border-white/10 bg-neutral-900/60 text-neutral-400 hover:border-white/20 hover:text-neutral-200'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
