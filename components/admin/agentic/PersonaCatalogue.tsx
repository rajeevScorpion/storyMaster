'use client';

import { useState, useTransition, type FormEvent } from 'react';
import {
  AlertTriangle,
  Archive,
  Copy,
  ImageOff,
  Loader2,
  MicOff,
  Pencil,
  PlusCircle,
  Search,
  ShieldAlert,
  ToggleRight,
  Users,
} from 'lucide-react';
import FilterDropdown from '@/components/ui/FilterDropdown';
import RowActionsMenu, { type RowAction } from '@/components/ui/RowActionsMenu';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import {
  clonePersona,
  listPersonas,
  setPersonaStatus,
  type AgentPersona,
  type AgentPersonaStatus,
  type PersonaListFilters,
} from '@/app/actions/agentic-personas';
import { STORY_LANGUAGE_OPTIONS } from '@/lib/ai/story-config';
import { STORY_AUDIENCE_OPTIONS } from '@/lib/ai/story-audience';
import { STORY_GENRES } from '@/lib/story/genres';
import PersonaEditorDrawer from './PersonaEditorDrawer';

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'testing', label: 'Testing' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
];

const LANGUAGE_FILTER_OPTIONS = [{ value: 'all', label: 'All languages' }, ...STORY_LANGUAGE_OPTIONS];
const AGE_GROUP_FILTER_OPTIONS = [{ value: 'all', label: 'All age groups' }, ...STORY_AUDIENCE_OPTIONS];
const GENRE_FILTER_OPTIONS = [{ value: 'all', label: 'All genres' }, ...STORY_GENRES];

const STATUS_STYLES: Record<AgentPersonaStatus, string> = {
  draft: 'border-neutral-500/25 bg-neutral-500/10 text-neutral-300',
  testing: 'border-indigo-500/25 bg-indigo-500/10 text-indigo-300',
  active: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
  paused: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
  archived: 'border-rose-500/25 bg-rose-500/10 text-rose-300',
};

const STATUS_CHANGE_OPTIONS = STATUS_FILTER_OPTIONS.filter((option) => option.value !== 'all');

type EditorTarget = { mode: 'create' } | { mode: 'edit'; persona: AgentPersona };

/**
 * Compact filterable table for the persona library. Follows the shape of
 * AdminUserDirectory (filters row + table + honest empty state), but the
 * catalogue is small (max 15 seeds in Phase 2b) so there is no pagination.
 *
 * Detail editing lives in PersonaEditorDrawer (a slide-over), never inline —
 * per the brief, this file must not render a form per row.
 */
export default function PersonaCatalogue({
  initialPersonas,
  schemaApplied,
}: {
  initialPersonas: AgentPersona[];
  schemaApplied: boolean;
}) {
  const [personas, setPersonas] = useState(initialPersonas);
  const [status, setStatus] = useState('all');
  const [language, setLanguage] = useState('all');
  const [ageGroup, setAgeGroup] = useState('all');
  const [genre, setGenre] = useState('all');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyPersonaId, setBusyPersonaId] = useState<string | null>(null);
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
  const [cloneTarget, setCloneTarget] = useState<AgentPersona | null>(null);
  const [cloneSlug, setCloneSlug] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [archiveTarget, setArchiveTarget] = useState<AgentPersona | null>(null);
  const [statusTarget, setStatusTarget] = useState<AgentPersona | null>(null);
  const [nextStatus, setNextStatus] = useState<string>('active');

  const filtersActive =
    status !== 'all' || language !== 'all' || ageGroup !== 'all' || genre !== 'all' || Boolean(appliedSearch);

  function reload(next: Partial<{ status: string; language: string; ageGroup: string; genre: string; search: string }> = {}) {
    const nextStatusValue = next.status ?? status;
    const nextLanguageValue = next.language ?? language;
    const nextAgeGroupValue = next.ageGroup ?? ageGroup;
    const nextGenreValue = next.genre ?? genre;
    const nextSearchValue = next.search ?? appliedSearch;

    const filters: PersonaListFilters = {};
    if (nextStatusValue !== 'all') filters.status = nextStatusValue as AgentPersonaStatus;
    if (nextLanguageValue !== 'all') filters.language = nextLanguageValue;
    if (nextAgeGroupValue !== 'all') filters.ageGroup = nextAgeGroupValue;
    if (nextGenreValue !== 'all') filters.genre = nextGenreValue;
    if (nextSearchValue) filters.search = nextSearchValue;

    setError(null);
    startTransition(async () => {
      try {
        const result = await listPersonas(filters);
        setPersonas(result);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load personas.');
      }
    });
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const normalized = search.trim();
    setAppliedSearch(normalized);
    reload({ search: normalized });
  }

  function upsertPersona(saved: AgentPersona) {
    setPersonas((current) => {
      const exists = current.some((row) => row.id === saved.id);
      return exists ? current.map((row) => (row.id === saved.id ? saved : row)) : [saved, ...current];
    });
  }

  function openClone(target: AgentPersona) {
    setCloneTarget(target);
    setCloneSlug(`${target.slug}-copy`);
    setCloneName(`${target.displayName} (Copy)`);
    setError(null);
  }

  async function confirmClone() {
    if (!cloneTarget) return;
    const slug = cloneSlug.trim();
    const name = cloneName.trim();
    if (!slug || !name) {
      setError('Clone needs both a slug and a display name.');
      return;
    }

    setBusyPersonaId(cloneTarget.id);
    setError(null);
    try {
      const cloned = await clonePersona(cloneTarget.id, slug, name);
      upsertPersona(cloned);
      setCloneTarget(null);
    } catch (cloneError) {
      setError(cloneError instanceof Error ? cloneError.message : 'Unable to clone persona.');
    } finally {
      setBusyPersonaId(null);
    }
  }

  function openStatusChange(target: AgentPersona) {
    setStatusTarget(target);
    setNextStatus(target.status === 'active' ? 'paused' : 'active');
    setError(null);
  }

  async function confirmStatusChange() {
    if (!statusTarget) return;
    setBusyPersonaId(statusTarget.id);
    setError(null);
    try {
      const updated = await setPersonaStatus(statusTarget.id, nextStatus as AgentPersonaStatus);
      upsertPersona(updated);
      setStatusTarget(null);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Unable to change status.');
    } finally {
      setBusyPersonaId(null);
    }
  }

  async function confirmArchive() {
    if (!archiveTarget) return;
    setBusyPersonaId(archiveTarget.id);
    setError(null);
    try {
      const updated = await setPersonaStatus(archiveTarget.id, 'archived');
      upsertPersona(updated);
      setArchiveTarget(null);
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : 'Unable to archive persona.');
    } finally {
      setBusyPersonaId(null);
    }
  }

  if (!schemaApplied) {
    return (
      <div className="flex gap-4 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-5">
        <ShieldAlert size={22} className="mt-0.5 shrink-0 text-amber-300" />
        <div className="space-y-1 text-sm text-neutral-200">
          <p className="font-medium text-amber-200">Migration 103 has not been applied to this environment yet.</p>
          <p className="text-neutral-300">
            The persona tables (<code className="text-neutral-100">agent_personas</code>,{' '}
            <code className="text-neutral-100">agent_persona_memory</code>) don&apos;t exist here, so this page has
            nothing to show. Apply <code className="text-neutral-100">103_agent_personas.sql</code> in the Supabase
            dashboard for this environment, then reload.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          <AlertTriangle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      <section className="rounded-2xl border border-white/10 bg-white/[0.035]">
        <div className="flex flex-col gap-3 border-b border-white/10 p-4 lg:flex-row lg:items-center lg:justify-between">
          <form onSubmit={submitSearch} className="flex min-w-0 flex-1 gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name or slug"
                className="h-10 w-full rounded-xl border border-white/10 bg-neutral-900/80 pl-9 pr-3 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-emerald-500/40"
              />
            </div>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-neutral-800 px-4 text-sm font-medium text-neutral-200 transition-colors hover:bg-neutral-700 disabled:opacity-50"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </button>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            <FilterDropdown
              value={status}
              options={STATUS_FILTER_OPTIONS}
              ariaLabel="Filter personas by status"
              onChange={(value) => {
                setStatus(value);
                reload({ status: value });
              }}
            />
            <FilterDropdown
              value={language}
              options={LANGUAGE_FILTER_OPTIONS}
              ariaLabel="Filter personas by language"
              onChange={(value) => {
                setLanguage(value);
                reload({ language: value });
              }}
            />
            <FilterDropdown
              value={ageGroup}
              options={AGE_GROUP_FILTER_OPTIONS}
              ariaLabel="Filter personas by age group"
              onChange={(value) => {
                setAgeGroup(value);
                reload({ ageGroup: value });
              }}
            />
            <FilterDropdown
              value={genre}
              options={GENRE_FILTER_OPTIONS}
              ariaLabel="Filter personas by genre"
              onChange={(value) => {
                setGenre(value);
                reload({ genre: value });
              }}
            />
            <button
              type="button"
              onClick={() => setEditorTarget({ mode: 'create' })}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-400 px-4 text-sm font-semibold text-neutral-950 transition-colors hover:bg-emerald-300"
            >
              <PlusCircle className="h-4 w-4" />
              New persona
            </button>
          </div>
        </div>

        <div className={`relative overflow-x-auto transition-opacity ${isPending ? 'opacity-55' : ''}`}>
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.12em] text-neutral-600">
                <th className="px-4 py-3 font-medium">Persona</th>
                <th className="px-4 py-3 font-medium">Language</th>
                <th className="px-4 py-3 font-medium">Age group</th>
                <th className="px-4 py-3 font-medium">Genres</th>
                <th className="px-4 py-3 font-medium">Beats</th>
                <th className="px-4 py-3 font-medium">Permissions</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" aria-label="Row actions" />
              </tr>
            </thead>
            <tbody>
              {personas.map((persona) => {
                const actions: RowAction[] = [
                  {
                    key: 'edit',
                    label: 'Edit',
                    icon: Pencil,
                    onSelect: () => setEditorTarget({ mode: 'edit', persona }),
                  },
                  {
                    key: 'clone',
                    label: 'Clone',
                    icon: Copy,
                    onSelect: () => openClone(persona),
                  },
                  {
                    key: 'status',
                    label: 'Change status',
                    icon: ToggleRight,
                    onSelect: () => openStatusChange(persona),
                    disabled: persona.status === 'archived',
                  },
                  {
                    key: 'archive',
                    label: 'Archive',
                    icon: Archive,
                    tone: 'danger',
                    onSelect: () => setArchiveTarget(persona),
                    disabled: persona.status === 'archived',
                  },
                ];

                return (
                  <tr key={persona.id} className="border-b border-white/5 transition-colors hover:bg-white/[0.035]">
                    <td className="px-4 py-4">
                      <p className="font-medium text-neutral-100">{persona.displayName}</p>
                      <p className="text-xs text-neutral-500">{persona.slug}</p>
                      {persona.isSeed && (
                        <span className="mt-1 inline-block rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
                          Seed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-neutral-300">{languageLabel(persona.language)}</td>
                    <td className="px-4 py-4 text-neutral-300">{ageGroupLabel(persona.ageGroup)}</td>
                    <td className="px-4 py-4">
                      <div className="flex max-w-52 flex-wrap gap-1">
                        {persona.genres.length === 0 ? (
                          <span className="text-xs text-neutral-600">—</span>
                        ) : (
                          persona.genres.map((entry) => (
                            <span
                              key={entry}
                              className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-neutral-300"
                            >
                              {entry}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-neutral-300">
                      {persona.beatCountMin}–{persona.beatCountMax}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2 text-neutral-500">
                        {persona.allowImageGeneration ? (
                          <span title="Image generation allowed" className="text-emerald-300">
                            Images on
                          </span>
                        ) : (
                          <span title="Image generation off — prompt_only is enforced" className="inline-flex items-center gap-1">
                            <ImageOff className="h-3.5 w-3.5" /> off
                          </span>
                        )}
                        {!persona.allowNarration && (
                          <span title="Narration off" className="inline-flex items-center gap-1">
                            <MicOff className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${STATUS_STYLES[persona.status]}`}
                      >
                        {persona.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <RowActionsMenu
                        actions={actions}
                        ariaLabel={`Actions for ${persona.displayName}`}
                        busy={busyPersonaId === persona.id}
                        className="ml-auto"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {personas.length === 0 && (
            <div className="px-6 py-16 text-center">
              <Users className="mx-auto h-8 w-8 text-neutral-700" />
              {filtersActive ? (
                <p className="mt-3 text-sm text-neutral-400">No personas match these filters.</p>
              ) : (
                <>
                  <p className="mt-3 text-sm text-neutral-400">No personas seeded yet.</p>
                  <p className="mx-auto mt-1 max-w-sm text-xs text-neutral-600">
                    Migration 103 is applied and the table is empty and ready. Phase 2b seeds 15 starter personas
                    once the taxonomy mapping is sight-checked — or create one by hand with &ldquo;New persona&rdquo;
                    above.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </section>

      {editorTarget && (
        <PersonaEditorDrawer
          key={editorTarget.mode === 'edit' ? editorTarget.persona.id : 'new'}
          persona={editorTarget.mode === 'edit' ? editorTarget.persona : null}
          onClose={() => setEditorTarget(null)}
          onSaved={(saved) => {
            upsertPersona(saved);
            setEditorTarget(null);
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(cloneTarget)}
        title={cloneTarget ? `Clone ${cloneTarget.displayName}` : 'Clone persona'}
        message={
          <div className="space-y-3">
            <p>Everything else (prompt, permissions, defaults) copies over as a new draft.</p>
            <label className="block space-y-1">
              <span className="text-xs text-neutral-500">New slug</span>
              <input
                value={cloneSlug}
                onChange={(event) => setCloneSlug(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-neutral-900/80 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500/40"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-neutral-500">New display name</span>
              <input
                value={cloneName}
                onChange={(event) => setCloneName(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-neutral-900/80 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500/40"
              />
            </label>
          </div>
        }
        confirmLabel="Clone"
        busy={Boolean(cloneTarget) && busyPersonaId === cloneTarget?.id}
        onCancel={() => setCloneTarget(null)}
        onConfirm={confirmClone}
      />

      <ConfirmDialog
        open={Boolean(statusTarget)}
        title={statusTarget ? `Change status for ${statusTarget.displayName}` : 'Change status'}
        message={
          <div className="space-y-3">
            <p>Currently {statusTarget?.status}.</p>
            <FilterDropdown
              value={nextStatus}
              options={STATUS_CHANGE_OPTIONS}
              onChange={setNextStatus}
              ariaLabel="New status"
              fullWidth
            />
          </div>
        }
        confirmLabel="Update status"
        busy={Boolean(statusTarget) && busyPersonaId === statusTarget?.id}
        onCancel={() => setStatusTarget(null)}
        onConfirm={confirmStatusChange}
      />

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title={archiveTarget ? `Archive ${archiveTarget.displayName}` : 'Archive persona'}
        message="Archived personas are excluded from scheduling and stop appearing as active, but their past stories are unaffected."
        confirmLabel="Archive"
        tone="danger"
        busy={Boolean(archiveTarget) && busyPersonaId === archiveTarget?.id}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={confirmArchive}
      />
    </div>
  );
}

function languageLabel(value: string): string {
  return STORY_LANGUAGE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function ageGroupLabel(value: string): string {
  return STORY_AUDIENCE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}
