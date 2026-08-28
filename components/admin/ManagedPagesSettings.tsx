'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileText, RotateCcw, Save, UploadCloud } from 'lucide-react';

import AdminToggle from '@/components/admin/AdminToggle';
import FilterDropdown from '@/components/ui/FilterDropdown';

import {
  getManagedPagesAdminStateAction,
  publishManagedPageVersionAction,
  resetManagedPageToSeedAction,
  saveManagedPageAction,
} from '@/app/actions/managed-pages';
import {
  MANAGED_PAGE_ACCEPTANCE_KINDS,
  MANAGED_PAGE_ACCESS_LEVELS,
  MANAGED_PAGE_TYPES,
  type ManagedPageRecord,
  type ManagedPageSaveInput,
  type ManagedPagesAdminState,
} from '@/lib/managed-pages/types';
import type { ManagedPageChangeType } from '@/lib/managed-pages/versioning';

const LEGAL_REVIEW_KEYS = new Set([
  'privacy_policy',
  'content_usage_policy',
  'terms',
  'refund_policy',
  'ai_disclosure',
  'copyright_licensing',
  'account_deletion',
]);

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function pageToInput(page: ManagedPageRecord): ManagedPageSaveInput {
  return {
    pageKey: page.pageKey,
    title: page.title,
    slug: page.slug,
    enabled: page.enabled,
    showInFooter: page.showInFooter,
    footerOrder: page.footerOrder,
    openInNewTab: page.openInNewTab,
    accessLevel: page.accessLevel,
    pageType: page.pageType,
    content: page.content,
    excerpt: page.excerpt,
    docVersion: page.docVersion,
    effectiveDate: page.effectiveDate,
    requiresAcceptance: page.requiresAcceptance,
    acceptanceKind: page.acceptanceKind,
  };
}

const ACCEPTANCE_KIND_OPTIONS = [
  { value: '', label: 'None' },
  ...MANAGED_PAGE_ACCEPTANCE_KINDS.map((kind) => ({
    value: kind,
    label: kind === 'accepted' ? 'Accepted (contract action)' : 'Acknowledged (notice shown)',
  })),
];

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function accessLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

function pageTypeLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return <AdminToggle checked={checked} onToggle={() => onChange(!checked)} ariaLabel={label} />;
}

export default function ManagedPagesSettings() {
  const [state, setState] = useState<ManagedPagesAdminState | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<ManagedPageSaveInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getManagedPagesAdminStateAction()
      .then((nextState) => {
        if (cancelled) return;
        setState(nextState);
        const firstPage = nextState.pages[0] ?? null;
        setSelectedKey(firstPage?.pageKey ?? null);
        setDraft(firstPage ? pageToInput(firstPage) : null);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Failed to load managed pages.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedPage = useMemo(
    () => state?.pages.find((page) => page.pageKey === selectedKey) ?? null,
    [state?.pages, selectedKey]
  );

  const normalizedSlug = draft ? normalizeSlug(draft.slug) : '';
  const duplicateSlug = Boolean(
    draft && state?.pages.some((page) => page.pageKey !== draft.pageKey && page.slug === normalizedSlug)
  );
  const reservedSlug = Boolean(state?.reservedSlugs.includes(normalizedSlug));
  const supportWarning = Boolean(draft?.content.includes('{{SUPPORT_EMAIL}}') && !state?.supportEmailConfigured);
  const legalDisableWarning = Boolean(draft && LEGAL_REVIEW_KEYS.has(draft.pageKey) && !draft.enabled);
  const canSave = Boolean(draft?.title.trim() && normalizedSlug && !duplicateSlug && !reservedSlug && !saving);
  const hasUnsavedChanges = Boolean(
    draft && selectedPage && JSON.stringify(draft) !== JSON.stringify(pageToInput(selectedPage))
  );
  const canPublish = Boolean(draft?.docVersion && draft?.acceptanceKind && !hasUnsavedChanges && !saving);

  const updateDraft = <Key extends keyof ManagedPageSaveInput>(key: Key, value: ManagedPageSaveInput[Key]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setMessage(null);
    setError(null);
  };

  const selectPage = (page: ManagedPageRecord) => {
    setSelectedKey(page.pageKey);
    setDraft(pageToInput(page));
    setMessage(null);
    setError(null);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const nextState = await saveManagedPageAction({ ...draft, slug: normalizedSlug });
      setState(nextState);
      const updated = nextState.pages.find((page) => page.pageKey === draft.pageKey);
      if (updated) setDraft(pageToInput(updated));
      setMessage('Page saved.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save page.');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!draft) return;
    const confirmed = window.confirm('Reset this page to the current starter seed content?');
    if (!confirmed) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const nextState = await resetManagedPageToSeedAction(draft.pageKey);
      setState(nextState);
      const updated = nextState.pages.find((page) => page.pageKey === draft.pageKey);
      if (updated) setDraft(pageToInput(updated));
      setMessage('Starter seed restored.');
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Failed to reset page.');
    } finally {
      setSaving(false);
    }
  };

  const publish = async (changeType: ManagedPageChangeType) => {
    if (!draft || !selectedPage) return;

    if (changeType === 'material') {
      const confirmed = window.confirm(
        'Publishing a material change requires every user to re-accept before they can continue using Kissago. Continue?'
      );
      if (!confirmed) return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const nextState = await publishManagedPageVersionAction(draft.pageKey, changeType);
      setState(nextState);
      const updated = nextState.pages.find((page) => page.pageKey === draft.pageKey);
      if (updated) setDraft(pageToInput(updated));
      setMessage(
        changeType === 'material'
          ? `Version ${selectedPage.docVersion} published as a material change. Re-acceptance is now required.`
          : `Version ${selectedPage.docVersion} published as a minor change. Existing acceptances still satisfy it.`
      );
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Failed to publish version.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 p-8 text-neutral-200">
        <p className="text-sm text-neutral-400">Loading managed pages...</p>
      </div>
    );
  }

  if (!state || state.pages.length === 0) {
    return (
      <div className="min-h-screen bg-neutral-950 p-8 text-neutral-200">
        <h1 className="text-2xl font-semibold text-white">Managed Pages</h1>
        <p className="mt-3 text-sm text-neutral-400">
          No managed pages were found. Run the managed pages migration before rollout.
        </p>
        {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 p-8 text-neutral-200">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-emerald-300/80">Global Settings</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal text-white">Managed Pages</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
            Edit rollout system pages, footer visibility, route slugs, and access rules from one place.
          </p>
        </div>
        <Link
          href="/admin/settings"
          className="rounded-lg border border-white/10 px-4 py-2 text-sm text-neutral-300 transition-colors hover:border-emerald-500/30 hover:text-emerald-200"
        >
          Settings overview
        </Link>
      </div>

      {error ? (
        <div className="mb-5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="mb-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
          {message}
        </div>
      ) : null}
      {!state.supportEmailConfigured ? (
        <div className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          `SUPPORT_EMAIL` is not configured. Pages that use the support placeholder will show a rollout warning.
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(320px,420px)_1fr]">
        <section className="space-y-3">
          {state.pages.map((page) => {
            const active = page.pageKey === selectedKey;
            return (
              <button
                key={page.pageKey}
                type="button"
                onClick={() => selectPage(page)}
                className={`w-full rounded-xl border p-4 text-left transition-colors ${
                  active
                    ? 'border-emerald-500/40 bg-emerald-500/10'
                    : 'border-white/10 bg-neutral-900/60 hover:border-white/20 hover:bg-neutral-900'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">{page.title}</p>
                    <p className="mt-1 text-xs text-neutral-500">/{page.slug}</p>
                  </div>
                  <FileText size={18} className={active ? 'text-emerald-300' : 'text-neutral-500'} />
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
                  <span className={`rounded-full px-2 py-1 ${page.enabled ? 'bg-emerald-500/10 text-emerald-300' : 'bg-neutral-800 text-neutral-400'}`}>
                    {page.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <span className={`rounded-full px-2 py-1 ${page.showInFooter ? 'bg-sky-500/10 text-sky-300' : 'bg-neutral-800 text-neutral-400'}`}>
                    {page.showInFooter ? 'Footer' : 'Hidden footer'}
                  </span>
                  <span className="rounded-full bg-neutral-800 px-2 py-1 text-neutral-300">
                    {accessLabel(page.accessLevel)}
                  </span>
                </div>
              </button>
            );
          })}
        </section>

        {draft && selectedPage ? (
          <section className="rounded-xl border border-white/10 bg-neutral-900/60 p-5">
            <div className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">{selectedPage.title}</h2>
                <p className="mt-1 text-xs text-neutral-500">Updated {formatDate(selectedPage.updatedAt)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/${normalizedSlug || selectedPage.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-neutral-300 transition-colors hover:border-emerald-500/30 hover:text-emerald-200"
                >
                  <ExternalLink size={15} />
                  Preview
                </Link>
                <button
                  type="button"
                  onClick={reset}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-neutral-300 transition-colors hover:border-amber-500/30 hover:text-amber-200 disabled:opacity-50"
                >
                  <RotateCcw size={15} />
                  Reset seed
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={!canSave}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
                >
                  <Save size={15} />
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">Title</span>
                <input
                  value={draft.title}
                  onChange={(event) => updateDraft('title', event.target.value)}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">Slug</span>
                <input
                  value={draft.slug}
                  onChange={(event) => updateDraft('slug', event.target.value)}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                />
                <span className="mt-1 block text-xs text-neutral-500">Effective URL: /{normalizedSlug || 'slug-required'}</span>
              </label>

              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">Access level</span>
                <select
                  value={draft.accessLevel}
                  onChange={(event) => updateDraft('accessLevel', event.target.value as ManagedPageSaveInput['accessLevel'])}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                >
                  {MANAGED_PAGE_ACCESS_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {accessLabel(level)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">Page type</span>
                <select
                  value={draft.pageType}
                  onChange={(event) => updateDraft('pageType', event.target.value as ManagedPageSaveInput['pageType'])}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                >
                  {MANAGED_PAGE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {pageTypeLabel(type)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">Footer order</span>
                <input
                  type="number"
                  value={draft.footerOrder}
                  onChange={(event) => updateDraft('footerOrder', Number(event.target.value))}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">Summary</span>
                <textarea
                  value={draft.excerpt ?? ''}
                  onChange={(event) => updateDraft('excerpt', event.target.value || null)}
                  rows={3}
                  className="mt-2 w-full resize-y rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 text-sm leading-6 text-white outline-none focus:border-emerald-500/50"
                />
              </label>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-white/10 bg-neutral-950 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">Enabled</p>
                    <p className="mt-1 text-xs text-neutral-500">Direct route can render when access allows.</p>
                  </div>
                  <Toggle checked={draft.enabled} onChange={(value) => updateDraft('enabled', value)} label="Toggle enabled" />
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-neutral-950 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">Footer</p>
                    <p className="mt-1 text-xs text-neutral-500">Only eligible viewers see this link.</p>
                  </div>
                  <Toggle checked={draft.showInFooter} onChange={(value) => updateDraft('showInFooter', value)} label="Toggle footer" />
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-neutral-950 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">New tab</p>
                    <p className="mt-1 text-xs text-neutral-500">Applied by footer links.</p>
                  </div>
                  <Toggle checked={draft.openInNewTab} onChange={(value) => updateDraft('openInNewTab', value)} label="Toggle new tab" />
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-lg border border-white/10 bg-neutral-950 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-white">Version &amp; consent</p>
                  <p className="mt-1 text-xs text-neutral-500">
                    {selectedPage.publishedAt
                      ? `Published v${selectedPage.docVersion} on ${formatDate(selectedPage.publishedAt)}${
                          selectedPage.reacceptanceRequired ? ' — re-acceptance required' : ''
                        }`
                      : 'Not published yet.'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => publish('minor')}
                    disabled={!canPublish}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-neutral-300 transition-colors hover:border-sky-500/30 hover:text-sky-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <UploadCloud size={15} />
                    Publish (minor)
                  </button>
                  <button
                    type="button"
                    onClick={() => publish('material')}
                    disabled={!canPublish}
                    className="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <UploadCloud size={15} />
                    Publish (material)
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">Document version</span>
                  <input
                    value={draft.docVersion ?? ''}
                    onChange={(event) => updateDraft('docVersion', event.target.value || null)}
                    placeholder="1.0.0"
                    className="mt-2 w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">Effective date</span>
                  <input
                    type="date"
                    value={draft.effectiveDate ?? ''}
                    onChange={(event) => updateDraft('effectiveDate', event.target.value || null)}
                    className="mt-2 w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                  />
                </label>

                <div className="block">
                  <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">Acceptance kind</span>
                  <div className="mt-2">
                    <FilterDropdown
                      fullWidth
                      size="form"
                      value={draft.acceptanceKind ?? ''}
                      options={ACCEPTANCE_KIND_OPTIONS}
                      onChange={(value) =>
                        updateDraft('acceptanceKind', (value || null) as ManagedPageSaveInput['acceptanceKind'])
                      }
                      ariaLabel="Acceptance kind"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-neutral-900 p-3">
                  <div>
                    <p className="text-sm text-white">Requires acceptance</p>
                    <p className="mt-1 text-xs text-neutral-500">Gates entry once legal_consent_gate_enabled is on.</p>
                  </div>
                  <Toggle
                    checked={draft.requiresAcceptance}
                    onChange={(value) => updateDraft('requiresAcceptance', value)}
                    label="Toggle requires acceptance"
                  />
                </div>
              </div>

              {hasUnsavedChanges ? (
                <p className="mt-3 text-xs text-amber-200">Save your changes before publishing — publishing snapshots the saved content, not this draft.</p>
              ) : null}
            </div>

            <div className="mt-5 space-y-2">
              {duplicateSlug ? (
                <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
                  This slug is already used by another managed page.
                </p>
              ) : null}
              {reservedSlug ? (
                <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
                  This slug is reserved by an existing app route.
                </p>
              ) : null}
              {supportWarning ? (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                  This content uses `{'{{SUPPORT_EMAIL}}'}` but `SUPPORT_EMAIL` is not configured.
                </p>
              ) : null}
              {legalDisableWarning ? (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                  This is a rollout-critical legal or policy page. Disable it only if another reviewed page covers the same need.
                </p>
              ) : null}
              {draft.accessLevel === 'admin' ? (
                <p className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-100">
                  Admin-only pages are hidden from non-admin footer UI and return 404 for disallowed direct access.
                </p>
              ) : null}
              {draft.accessLevel === 'billing_enabled_only' ? (
                <p className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-100">
                  This page appears only while `pricing_snapshot_enabled` is true.
                </p>
              ) : null}
            </div>

            <label className="mt-5 block">
              <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">Content</span>
              <textarea
                value={draft.content}
                onChange={(event) => updateDraft('content', event.target.value)}
                rows={24}
                className="mt-2 w-full resize-y rounded-lg border border-white/10 bg-neutral-950 px-4 py-3 font-mono text-sm leading-6 text-neutral-100 outline-none focus:border-emerald-500/50"
                spellCheck={false}
              />
            </label>
          </section>
        ) : null}
      </div>
    </div>
  );
}
