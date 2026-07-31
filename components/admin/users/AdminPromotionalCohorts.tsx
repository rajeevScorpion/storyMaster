'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Gift,
  Loader2,
  Megaphone,
  Search,
  ShieldCheck,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import {
  executeAdminPromotionalCohort,
  previewAdminPromotionalCohort,
} from '@/app/actions/admin-users';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import FilterDropdown from '@/components/ui/FilterDropdown';
import {
  type AdminCohortPlanFilter,
  type AdminPromotionalCohortInput,
  type AdminPromotionalCohortPreview,
  type AdminPromotionalCohortRun,
} from '@/lib/admin/user-management.shared';
import UserAvatar from './UserAvatar';
import { formatCoins, formatDate, formatDateTime } from './AdminUserDirectory';

const PLAN_OPTIONS = [
  { value: 'all', label: 'All plans' },
  { value: 'free', label: 'Free' },
  { value: 'plus', label: 'Plus' },
  { value: 'studio', label: 'Studio' },
];

const DEFAULT_FORM: AdminPromotionalCohortInput = {
  name: 'Engaged creators',
  activeWithinDays: 30,
  minFinishedStories: 2,
  minPublishedStories: 1,
  minLifetimeConsumedCoins: 100,
  planKey: 'all',
  coinsPerUser: 500,
  grantExpiresAt: null,
};

export default function AdminPromotionalCohorts({
  initialRuns,
}: {
  initialRuns: AdminPromotionalCohortRun[];
}) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [expiryDate, setExpiryDate] = useState('');
  const [preview, setPreview] = useState<AdminPromotionalCohortPreview | null>(null);
  const [runs, setRuns] = useState(initialRuns);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [executeBusy, setExecuteBusy] = useState(false);
  const [confirmExecute, setConfirmExecute] = useState(false);
  const [requestKey, setRequestKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function updateForm(patch: Partial<AdminPromotionalCohortInput>) {
    setForm((current) => ({ ...current, ...patch }));
    setPreview(null);
    setNotice(null);
  }

  function currentInput(): AdminPromotionalCohortInput {
    return {
      ...form,
      grantExpiresAt: expiryDate
        ? new Date(`${expiryDate}T23:59:59`).toISOString()
        : null,
    };
  }

  async function previewCohort() {
    setPreviewBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await previewAdminPromotionalCohort(currentInput());
      setPreview(result);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Unable to preview cohort.');
    } finally {
      setPreviewBusy(false);
    }
  }

  async function executeCohort() {
    if (!preview) return;
    setExecuteBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await executeAdminPromotionalCohort({
        cohort: currentInput(),
        approvedRecipientCount: preview.eligibleCount,
        requestKey,
      });
      setRuns(result.runs);
      setConfirmExecute(false);
      setRequestKey('');
      setNotice(
        result.alreadyApplied
          ? 'This cohort request had already completed; no duplicate grants were created.'
          : `${result.grantedCount.toLocaleString('en-IN')} users received the promotion.`
      );
      setPreview(null);
    } catch (executeError) {
      setError(executeError instanceof Error ? executeError.message : 'Unable to execute cohort.');
      setConfirmExecute(false);
    } finally {
      setExecuteBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link
        href="/admin/users"
        className="inline-flex items-center gap-2 text-sm text-neutral-500 transition-colors hover:text-emerald-300"
      >
        <ArrowLeft className="h-4 w-4" />
        User management
      </Link>

      {error && (
        <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {notice}
        </div>
      )}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-serif text-neutral-100">Cohort rules</h2>
              <p className="mt-1 text-sm leading-5 text-neutral-500">
                Reward transparent engagement signals. Restricted users and the administrator are always excluded.
              </p>
            </div>
            <UsersRound className="h-5 w-5 text-emerald-300" />
          </div>

          <div className="mt-5 space-y-4">
            <Field label="Campaign name">
              <input
                value={form.name}
                maxLength={120}
                onChange={(event) => updateForm({ name: event.target.value })}
                className={INPUT_CLASS}
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                label="Active within days"
                value={form.activeWithinDays}
                min={1}
                onChange={(value) => updateForm({ activeWithinDays: value })}
              />
              <Field label="Plan">
                <FilterDropdown
                  value={form.planKey}
                  options={PLAN_OPTIONS}
                  fullWidth
                  size="form"
                  onChange={(value) => updateForm({ planKey: value as AdminCohortPlanFilter })}
                />
              </Field>
              <NumberField
                label="Minimum finished stories"
                value={form.minFinishedStories}
                min={0}
                onChange={(value) => updateForm({ minFinishedStories: value })}
              />
              <NumberField
                label="Minimum published stories"
                value={form.minPublishedStories}
                min={0}
                onChange={(value) => updateForm({ minPublishedStories: value })}
              />
              <NumberField
                label="Minimum lifetime coins used"
                value={form.minLifetimeConsumedCoins}
                min={0}
                onChange={(value) => updateForm({ minLifetimeConsumedCoins: value })}
              />
              <NumberField
                label="Coins per eligible user"
                value={form.coinsPerUser}
                min={1}
                onChange={(value) => updateForm({ coinsPerUser: value })}
              />
            </div>

            <Field label="Optional grant expiry">
              <input
                type="date"
                value={expiryDate}
                min={todayDateInput()}
                onChange={(event) => {
                  setExpiryDate(event.target.value);
                  setPreview(null);
                }}
                className={INPUT_CLASS}
              />
            </Field>

            <button
              type="button"
              disabled={previewBusy}
              onClick={previewCohort}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-neutral-950 transition-colors hover:bg-emerald-300 disabled:opacity-50"
            >
              {previewBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Preview audience
            </button>
          </div>
        </article>

        <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-serif text-neutral-100">Audience preview</h2>
              <p className="mt-1 text-sm text-neutral-500">
                The audience is recalculated transactionally when the campaign runs.
              </p>
            </div>
            <ShieldCheck className="h-5 w-5 text-neutral-600" />
          </div>

          {!preview ? (
            <div className="flex min-h-80 flex-col items-center justify-center text-center">
              <Search className="h-8 w-8 text-neutral-700" />
              <p className="mt-3 text-sm text-neutral-500">Preview the rules before granting any coins.</p>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <PreviewMetric
                  label="Eligible users"
                  value={preview.eligibleCount.toLocaleString('en-IN')}
                  icon={UsersRound}
                />
                <PreviewMetric
                  label="Coins each"
                  value={formatCoins(preview.input.coinsPerUser)}
                  icon={Gift}
                />
                <PreviewMetric
                  label="Maximum liability"
                  value={formatCoins(preview.estimatedLiabilityCoins)}
                  icon={WalletCards}
                />
              </div>

              {preview.sample.length > 0 ? (
                <div className="overflow-hidden rounded-xl border border-white/10">
                  <div className="border-b border-white/10 bg-neutral-950/40 px-3 py-2 text-xs uppercase tracking-[0.12em] text-neutral-600">
                    Top matching users · up to 25
                  </div>
                  <div className="max-h-[380px] overflow-y-auto">
                    {preview.sample.map((candidate) => (
                      <div key={candidate.userId} className="flex items-center gap-3 border-b border-white/5 px-3 py-3 last:border-0">
                        <UserAvatar src={candidate.avatarUrl} name={candidate.displayName} size={36} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-neutral-200">{candidate.displayName}</p>
                          <p className="truncate text-xs text-neutral-600">{candidate.email}</p>
                        </div>
                        <div className="shrink-0 text-right text-xs text-neutral-500">
                          <p>{candidate.finishedStoryCount} finished · {candidate.publishedStoryCount} published</p>
                          <p className="mt-1">{formatCoins(candidate.lifetimeConsumedCoins)} coins used</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-white/10 bg-neutral-950/40 px-4 py-10 text-center text-sm text-neutral-500">
                  No users currently match these rules.
                </div>
              )}

              <button
                type="button"
                disabled={preview.eligibleCount < 1 || preview.eligibleCount > 1_000}
                onClick={() => {
                  setRequestKey(`cohort:${crypto.randomUUID()}`);
                  setConfirmExecute(true);
                }}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-neutral-950 transition-colors hover:bg-emerald-300 disabled:opacity-40"
              >
                <Megaphone className="h-4 w-4" />
                Launch promotion
              </button>
              {preview.eligibleCount > 1_000 && (
                <p className="text-center text-xs text-amber-300">
                  Phase 1 campaigns are capped at 1,000 recipients. Tighten the cohort rules and preview again.
                </p>
              )}
            </div>
          )}
        </article>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
        <div className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-emerald-300" />
          <h2 className="text-lg font-serif text-neutral-100">Campaign history</h2>
        </div>
        {runs.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.12em] text-neutral-600">
                  <th className="py-3 pr-4 font-medium">Campaign</th>
                  <th className="px-4 py-3 font-medium">Audience</th>
                  <th className="px-4 py-3 font-medium">Grant</th>
                  <th className="px-4 py-3 font-medium">Expiry</th>
                  <th className="py-3 pl-4 font-medium">Executed</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-b border-white/5 last:border-0">
                    <td className="py-3 pr-4">
                      <p className="font-medium text-neutral-200">{run.name}</p>
                      <p className="mt-1 text-xs capitalize text-emerald-300">{run.status}</p>
                    </td>
                    <td className="px-4 py-3 text-neutral-400">
                      {run.grantedCount.toLocaleString('en-IN')} / {run.eligibleCount.toLocaleString('en-IN')} granted
                    </td>
                    <td className="px-4 py-3 text-neutral-300">{formatCoins(run.coinsPerUser)} each</td>
                    <td className="px-4 py-3 text-neutral-500">{run.grantExpiresAt ? formatDate(run.grantExpiresAt) : 'No expiry'}</td>
                    <td className="py-3 pl-4 text-neutral-500">{formatDateTime(run.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-neutral-600">No promotional cohorts have run yet.</p>
        )}
      </section>

      <ConfirmDialog
        open={confirmExecute}
        title="Launch promotional cohort"
        message={preview
          ? `Grant ${formatCoins(preview.input.coinsPerUser)} coins to up to ${preview.eligibleCount.toLocaleString('en-IN')} eligible users. Maximum liability: ${formatCoins(preview.estimatedLiabilityCoins)} coins. Audience growth after this preview will stop the run for review.`
          : ''}
        confirmLabel="Launch and grant"
        busy={executeBusy}
        onCancel={() => {
          setConfirmExecute(false);
          setRequestKey('');
        }}
        onConfirm={executeCohort}
      />
    </div>
  );
}

const INPUT_CLASS = 'min-h-12 w-full rounded-2xl border border-white/10 bg-neutral-800/80 px-4 py-3 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-emerald-500/40';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs uppercase tracking-[0.12em] text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        min={min}
        step="1"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className={INPUT_CLASS}
      />
    </Field>
  );
}

function PreviewMetric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof UsersRound;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-neutral-950/40 p-3">
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-2 text-lg font-medium text-neutral-100">{value}</p>
    </div>
  );
}

function todayDateInput(): string {
  const value = new Date();
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 10);
}
