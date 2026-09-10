'use client';

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Ban, Check, Loader2, Pencil, Search, ShieldCheck, UsersRound, X } from 'lucide-react';
import FilterDropdown from '@/components/ui/FilterDropdown';
import RowActionsMenu, { type RowAction } from '@/components/ui/RowActionsMenu';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import {
  grantReviewerAction,
  searchGrantableUsersAction,
  setReviewerStatusAction,
  updateReviewerAction,
  type GrantableUserOption,
  type ReviewerRosterRow,
} from '@/app/actions/agentic-review';
import type { AgentReviewerRole } from '@/lib/agentic/reviewers.shared';
import { ROUTABLE_AGE_GROUPS, STORY_AGE_GROUPS } from '@/lib/story/age-groups';
import { STORY_GENRES } from '@/lib/story/genres';
import { STORY_LANGUAGE_OPTIONS } from '@/lib/ai/story-config';
import { formatDateTime, shortId } from '@/components/admin/agentic/run-presentation';

// ── Agentic Creator System: Phase 9b Unit 9g -- grant, edit, revoke reviewers ──
//
// Everything interactive about the reviewer roster lives in this one client
// component: the search-to-grant box, the role/coverage drawer (shape borrowed
// from PersonaEditorDrawer.tsx), the table itself, and its RowActionsMenu-driven
// Edit / Suspend / Reinstate actions. app/admin/authors/reviewers/page.tsx (a
// server component) fetches the initial roster and hands it in as
// `initialReviewers` -- exactly the initialRows pattern ReviewQueue.tsx and
// PersonaCatalogue.tsx already use -- and keeps its own "migration 111 not
// applied" banner entirely to itself; this component only ever renders once
// that base table is known to exist.
//
// The five age-group checkboxes render ROUTABLE_AGE_GROUPS, never
// STORY_AGE_GROUPS directly -- 'all_ages' is deliberately excluded (D16): an
// all_ages task is never auto-routed to a reviewer, it waits in the unassigned
// pool for any reviewer whose language matches. A reviewer "covering" all_ages
// would silently defeat that routing, which is also why
// validateReviewerCoverage (lib/agentic/reviewers.shared.ts) rejects it
// server-side regardless of what this form lets through.

const ROLE_OPTIONS: { value: AgentReviewerRole; label: string }[] = [
  { value: 'reviewer', label: 'Reviewer' },
  { value: 'editor', label: 'Editor' },
];

const AGE_GROUP_COVERAGE_OPTIONS = STORY_AGE_GROUPS.filter((group) =>
  (ROUTABLE_AGE_GROUPS as readonly string[]).includes(group.value)
);

function labelFor(options: readonly { value: string; label: string }[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

/** Every coverage value a reviewer holds, resolved to its display label -- languages, then age groups, then genres, matching the column order the table header uses. */
function coverageLabels(reviewer: ReviewerRosterRow): string[] {
  return [
    ...reviewer.languages.map((value) => labelFor(STORY_LANGUAGE_OPTIONS, value)),
    ...reviewer.ageGroups.map((value) => labelFor(STORY_AGE_GROUPS, value)),
    ...reviewer.genres.map((value) => labelFor(STORY_GENRES, value)),
  ];
}

type DrawerTarget = { mode: 'grant'; user: GrantableUserOption } | { mode: 'edit'; reviewer: ReviewerRosterRow };

export default function ReviewerRosterEditor({
  initialReviewers,
}: {
  initialReviewers: ReviewerRosterRow[];
}) {
  const [reviewers, setReviewers] = useState(initialReviewers);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GrantableUserOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [drawerTarget, setDrawerTarget] = useState<DrawerTarget | null>(null);
  const [statusTarget, setStatusTarget] = useState<ReviewerRosterRow | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounced search -- fires 300ms after the last keystroke, and a change to
  // searchQuery cancels whatever the previous keystroke scheduled.
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchError(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    const timer = setTimeout(() => {
      searchGrantableUsersAction(trimmed)
        .then((results) => {
          setSearchResults(results);
          setSearchError(null);
        })
        .catch((searchErr) => {
          setSearchError(searchErr instanceof Error ? searchErr.message : 'Unable to search accounts.');
        })
        .finally(() => setSearching(false));
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  function upsertReviewer(saved: ReviewerRosterRow) {
    setReviewers((current) => {
      const exists = current.some((row) => row.userId === saved.userId);
      return exists ? current.map((row) => (row.userId === saved.userId ? saved : row)) : [saved, ...current];
    });
  }

  async function confirmStatusChange() {
    if (!statusTarget) return;
    const nextStatus = statusTarget.status === 'active' ? 'suspended' : 'active';
    setBusyUserId(statusTarget.userId);
    setError(null);
    try {
      const saved = await setReviewerStatusAction(statusTarget.userId, nextStatus);
      upsertReviewer(saved);
      setStatusTarget(null);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Unable to update reviewer status.');
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <div>
      {error && (
        <div className="flex items-center gap-2 border-b border-white/10 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <AlertTriangle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      <div className="border-b border-white/10 p-4">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search by email or name to grant reviewer standing"
            className="h-10 w-full rounded-xl border border-white/10 bg-neutral-900/80 pl-9 pr-3 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-emerald-500/40"
          />
          {searchQuery.trim() && (
            <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-white/10 bg-neutral-900/95 shadow-2xl backdrop-blur-md">
              {searching ? (
                <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-neutral-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
                </div>
              ) : searchError ? (
                <div className="px-3 py-2.5 text-xs text-rose-300">{searchError}</div>
              ) : searchResults.length === 0 ? (
                <div className="px-3 py-2.5 text-xs text-neutral-500">No matching accounts.</div>
              ) : (
                searchResults.map((option) => {
                  const alreadyReviewer = reviewers.some((row) => row.userId === option.userId);
                  return (
                    <button
                      key={option.userId}
                      type="button"
                      disabled={alreadyReviewer}
                      onClick={() => {
                        setDrawerTarget({ mode: 'grant', user: option });
                        setSearchQuery('');
                      }}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-xs transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-neutral-200">{option.displayName || option.email || option.userId}</span>
                        {option.email && <span className="block truncate text-neutral-500">{option.email}</span>}
                      </span>
                      {alreadyReviewer && <span className="shrink-0 text-neutral-600">Already a reviewer</span>}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {reviewers.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <UsersRound className="mx-auto h-8 w-8 text-neutral-700" />
          <p className="mt-3 text-sm text-neutral-400">No reviewers yet.</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-neutral-600">
            process.env.ADMIN_USER_ID works as an implicit reviewer with every capability in the meantime —
            search for an account above and grant it reviewer standing to add the first real row.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.12em] text-neutral-600">
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Display name</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Coverage</th>
                <th className="px-4 py-3 font-medium">Added</th>
                <th className="px-4 py-3 font-medium" aria-label="Row actions" />
              </tr>
            </thead>
            <tbody>
              {reviewers.map((reviewer) => {
                const pills = coverageLabels(reviewer);
                const actions: RowAction[] = [
                  {
                    key: 'edit',
                    label: 'Edit',
                    icon: Pencil,
                    onSelect: () => setDrawerTarget({ mode: 'edit', reviewer }),
                  },
                  {
                    key: 'status',
                    label: reviewer.status === 'active' ? 'Suspend' : 'Reinstate',
                    icon: reviewer.status === 'active' ? Ban : ShieldCheck,
                    tone: reviewer.status === 'active' ? 'danger' : 'default',
                    onSelect: () => setStatusTarget(reviewer),
                  },
                ];

                return (
                  <tr key={reviewer.userId} className="border-b border-white/5">
                    <td className="px-4 py-4 font-mono text-xs text-neutral-400" title={reviewer.userId}>
                      {shortId(reviewer.userId)}
                    </td>
                    <td className="px-4 py-4 text-neutral-200">{reviewer.displayName ?? '—'}</td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
                          reviewer.status === 'active'
                            ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                            : 'border-neutral-500/25 bg-neutral-500/10 text-neutral-400'
                        }`}
                      >
                        {reviewer.status === 'active' ? 'Active' : 'Suspended'}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
                          reviewer.role === 'editor'
                            ? 'border-indigo-500/25 bg-indigo-500/10 text-indigo-300'
                            : 'border-neutral-500/25 bg-neutral-500/10 text-neutral-300'
                        }`}
                      >
                        {reviewer.role === 'editor' ? 'Editor' : 'Reviewer'}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      {pills.length === 0 ? (
                        <span className="text-xs text-neutral-600">—</span>
                      ) : (
                        <div className="flex max-w-64 flex-wrap gap-1">
                          {pills.map((label, index) => (
                            <span
                              key={`${reviewer.userId}-${index}-${label}`}
                              className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-neutral-300"
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4 text-neutral-500">{formatDateTime(reviewer.createdAt)}</td>
                    <td className="px-4 py-4 text-right">
                      <RowActionsMenu
                        actions={actions}
                        ariaLabel={`Actions for ${reviewer.displayName ?? shortId(reviewer.userId)}`}
                        busy={busyUserId === reviewer.userId}
                        className="ml-auto"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {drawerTarget && (
        <ReviewerFormDrawer
          key={drawerTarget.mode === 'edit' ? drawerTarget.reviewer.userId : drawerTarget.user.userId}
          target={drawerTarget}
          onClose={() => setDrawerTarget(null)}
          onSaved={(saved) => {
            upsertReviewer(saved);
            setDrawerTarget(null);
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(statusTarget)}
        title={
          statusTarget
            ? `${statusTarget.status === 'active' ? 'Suspend' : 'Reinstate'} ${statusTarget.displayName ?? shortId(statusTarget.userId)}`
            : 'Change reviewer status'
        }
        message={
          statusTarget?.status === 'active'
            ? 'A suspended reviewer keeps their row -- role and coverage are preserved -- but can no longer review, publish, or trigger media on agent drafts until reinstated.'
            : 'Reinstating restores this reviewer’s existing role and coverage immediately.'
        }
        confirmLabel={statusTarget?.status === 'active' ? 'Suspend' : 'Reinstate'}
        tone={statusTarget?.status === 'active' ? 'danger' : 'default'}
        busy={Boolean(statusTarget) && busyUserId === statusTarget?.userId}
        onCancel={() => setStatusTarget(null)}
        onConfirm={confirmStatusChange}
      />
    </div>
  );
}

interface ReviewerFormState {
  role: AgentReviewerRole;
  ageGroups: string[];
  languages: string[];
  genres: string[];
  displayName: string;
  notes: string;
}

function buildInitialFormState(target: DrawerTarget): ReviewerFormState {
  if (target.mode === 'edit') {
    return {
      role: target.reviewer.role,
      ageGroups: [...target.reviewer.ageGroups],
      languages: [...target.reviewer.languages],
      genres: [...target.reviewer.genres],
      displayName: target.reviewer.displayName ?? '',
      notes: target.reviewer.notes ?? '',
    };
  }
  return {
    role: 'reviewer',
    ageGroups: [],
    languages: [],
    genres: [],
    displayName: target.user.displayName ?? '',
    notes: '',
  };
}

/**
 * Create/edit form for one reviewer row -- shape deliberately borrowed from
 * PersonaEditorDrawer.tsx (portalled slide-over, FieldGroup/Field layout,
 * FilterDropdown for the single-select role, checkbox groups for the three
 * coverage arrays). Rendered with a fresh `key` per open (see the call site
 * above), so it can own its form state with plain useState.
 */
function ReviewerFormDrawer({
  target,
  onClose,
  onSaved,
}: {
  target: DrawerTarget;
  onClose: () => void;
  onSaved: (reviewer: ReviewerRosterRow) => void;
}) {
  const [form, setForm] = useState<ReviewerFormState>(() => buildInitialFormState(target));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = target.mode === 'edit';

  const heading = useMemo(() => {
    if (target.mode === 'edit') return target.reviewer.displayName || shortId(target.reviewer.userId);
    return target.user.displayName || target.user.email || target.user.userId;
  }, [target]);

  const subheading = target.mode === 'grant' ? target.user.email ?? target.user.userId : target.reviewer.userId;

  function update<K extends keyof ReviewerFormState>(key: K, value: ReviewerFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleFromList(key: 'ageGroups' | 'languages' | 'genres', value: string) {
    setForm((current) => {
      const list = current[key];
      const next = list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
      return { ...current, [key]: next };
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);

    const payload = {
      role: form.role,
      ageGroups: form.ageGroups,
      languages: form.languages,
      genres: form.genres,
      displayName: form.displayName.trim() || null,
      notes: form.notes.trim() || null,
    };

    try {
      const saved =
        target.mode === 'grant'
          ? await grantReviewerAction({ userId: target.user.userId, ...payload })
          : await updateReviewerAction({ userId: target.reviewer.userId, ...payload });
      onSaved(saved);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to save reviewer.');
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
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-neutral-100">
                {isEdit ? `Edit ${heading}` : `Grant reviewer standing to ${heading}`}
              </h2>
              <p className="mt-0.5 truncate text-xs text-neutral-500">{subheading}</p>
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

              <FieldGroup title="Capability">
                <Field label="Role">
                  <FilterDropdown
                    value={form.role}
                    options={ROLE_OPTIONS}
                    onChange={(value) => update('role', value as AgentReviewerRole)}
                    ariaLabel="Reviewer role"
                    fullWidth
                  />
                </Field>
                <p className="text-xs text-neutral-500">
                  Reviewer: review drafts and trigger narration/images. Editor: also publish and assign work
                  to other reviewers.
                </p>
              </FieldGroup>

              <FieldGroup title="Routing coverage">
                <Field label="Age groups">
                  <CheckboxGroup
                    options={AGE_GROUP_COVERAGE_OPTIONS}
                    selected={form.ageGroups}
                    onToggle={(value) => toggleFromList('ageGroups', value)}
                  />
                  <p className="mt-2 text-xs text-neutral-500">
                    All-ages drafts are never auto-routed to a specific reviewer (D16) -- they wait in the
                    unassigned pool for any reviewer whose language matches.
                  </p>
                </Field>
                <Field label="Languages">
                  <CheckboxGroup
                    options={STORY_LANGUAGE_OPTIONS}
                    selected={form.languages}
                    onToggle={(value) => toggleFromList('languages', value)}
                  />
                </Field>
                <Field label="Genres">
                  <CheckboxGroup
                    options={STORY_GENRES}
                    selected={form.genres}
                    onToggle={(value) => toggleFromList('genres', value)}
                  />
                  <p className="mt-2 text-xs text-neutral-500">
                    Preference, not a hard filter -- leaving this empty means no preference, never exclusion.
                  </p>
                </Field>
              </FieldGroup>

              <FieldGroup title="Identity">
                <Field label="Display name">
                  <input
                    value={form.displayName}
                    onChange={(event) => update('displayName', event.target.value)}
                    className={inputClass}
                    placeholder="Shown on review decisions"
                  />
                </Field>
                <Field label="Notes">
                  <textarea
                    value={form.notes}
                    onChange={(event) => update('notes', event.target.value)}
                    className={`${inputClass} min-h-16 resize-y`}
                    placeholder="Internal notes for other admins -- never shown to the reviewer."
                  />
                </Field>
              </FieldGroup>
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
                {isEdit ? 'Save changes' : 'Grant reviewer standing'}
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs text-neutral-400">{label}</span>
      {children}
    </label>
  );
}

function CheckboxGroup({
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
        const checked = selected.includes(option.value);
        return (
          <label
            key={option.value}
            className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              checked
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : 'border-white/10 bg-neutral-900/60 text-neutral-400 hover:border-white/20 hover:text-neutral-200'
            }`}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(option.value)}
              className="sr-only"
            />
            {checked && <Check className="h-3 w-3 shrink-0" />}
            {option.label}
          </label>
        );
      })}
    </div>
  );
}
