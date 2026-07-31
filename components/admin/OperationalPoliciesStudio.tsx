'use client';

import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  Coins,
  DatabaseZap,
  History,
  Loader2,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { updateFreeWelcomeGrantPolicy } from '@/app/actions/admin-policies';
import AdminToggle from '@/components/admin/AdminToggle';
import {
  FREE_WELCOME_GRANT_POLICY_KEY,
  readFreeWelcomeGrantConfig,
  type AdminOperationalPolicy,
  type AdminOperationalPolicyAuditItem,
  type FreeWelcomeGrantConfig,
  type OperationalPoliciesAdminState,
} from '@/lib/admin/operational-policies.shared';

const INPUT_CLASS =
  'w-full rounded-xl border border-white/10 bg-neutral-950/70 px-3 py-2.5 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-emerald-500/40';

const DEFAULT_CONFIG: FreeWelcomeGrantConfig = {
  coinAmount: 50,
  grantMode: 'once_per_account',
  expiresAfterDays: null,
};

export default function OperationalPoliciesStudio({
  initialState,
}: {
  initialState: OperationalPoliciesAdminState;
}) {
  const [state, setState] = useState(initialState);
  const policy = state.policies.find((item) => item.policyKey === FREE_WELCOME_GRANT_POLICY_KEY);
  const config = safeReadWelcomeConfig(policy);
  const [enabled, setEnabled] = useState(policy?.enabled ?? true);
  const [coinAmount, setCoinAmount] = useState(String(config.coinAmount));
  const [expiryDays, setExpiryDays] = useState(
    config.expiresAfterDays === null ? '' : String(config.expiresAfterDays)
  );
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const policyAudit = useMemo(
    () => state.auditItems.filter((item) => item.policyKey === FREE_WELCOME_GRANT_POLICY_KEY),
    [state.auditItems]
  );
  const activeCount = state.policies.filter((item) => item.enabled).length;

  async function savePolicy() {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const nextState = await updateFreeWelcomeGrantPolicy({
        enabled,
        coinAmount: Number(coinAmount),
        expiresAfterDays: expiryDays.trim() ? Number(expiryDays) : null,
        reason,
      });
      const nextPolicy = nextState.policies.find(
        (item) => item.policyKey === FREE_WELCOME_GRANT_POLICY_KEY
      );
      const nextConfig = safeReadWelcomeConfig(nextPolicy);

      setState(nextState);
      setEnabled(nextPolicy?.enabled ?? enabled);
      setCoinAmount(String(nextConfig.coinAmount));
      setExpiryDays(nextConfig.expiresAfterDays === null ? '' : String(nextConfig.expiresAfterDays));
      setReason('');
      setSuccess(`Policy version ${nextPolicy?.version ?? ''} is now active in enforcement.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save the policy');
    } finally {
      setIsSaving(false);
    }
  }

  if (!policy) {
    return (
      <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-5 text-sm text-rose-200">
        The free welcome policy is missing. Apply migration 084 before using this page.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          icon={ShieldCheck}
          label="Registered policies"
          value={String(state.policies.length)}
          detail={`${activeCount} currently active`}
        />
        <MetricCard
          icon={Coins}
          label="Free signup credit"
          value={`${config.coinAmount.toLocaleString()} coins`}
          detail="Once per account"
        />
        <MetricCard
          icon={History}
          label="Current policy version"
          value={`v${policy.version}`}
          detail={`Updated ${formatDateTime(policy.updatedAt)}`}
        />
      </div>

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 p-5">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-medium text-neutral-100">{policy.name}</h2>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] ${
                policy.enabled
                  ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-500/25 bg-amber-500/10 text-amber-300'
              }`}>
                {policy.enabled ? 'Enforced' : 'Paused'}
              </span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-neutral-400">{policy.description}</p>
            <p className="mt-2 font-mono text-[11px] text-neutral-600">{policy.policyKey}</p>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-neutral-950/50 px-3 py-2">
            <span className="text-xs text-neutral-400">Policy enabled</span>
            <AdminToggle
              checked={enabled}
              onToggle={() => setEnabled((value) => !value)}
              disabled={isSaving}
              ariaLabel="Enable free welcome grant policy"
            />
          </div>
        </div>

        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Welcome coins" help="Issued once when a free account is created.">
                <input
                  type="number"
                  min="0.01"
                  max="10000"
                  step="1"
                  value={coinAmount}
                  onChange={(event) => setCoinAmount(event.target.value)}
                  className={INPUT_CLASS}
                />
              </Field>
              <Field
                label="Expiry after days"
                help="Leave blank so the welcome coins never expire."
              >
                <input
                  type="number"
                  min="1"
                  max="3650"
                  step="1"
                  value={expiryDays}
                  onChange={(event) => setExpiryDays(event.target.value)}
                  placeholder="Never expires"
                  className={INPUT_CLASS}
                />
              </Field>
            </div>

            <Field
              label="Grant mode"
              help="Locked by validation. Changing the amount never grants a second welcome credit to an existing account."
            >
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-neutral-950/40 px-3 py-2.5 text-sm text-neutral-300">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                Once per account
              </div>
            </Field>

            <Field
              label="Change reason"
              help="Required. This note is stored with the immutable policy version."
            >
              <textarea
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why is this policy changing?"
                className={`${INPUT_CLASS} resize-y`}
              />
            </Field>

            {error && (
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {error}
              </div>
            )}
            {success && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                {success}
              </div>
            )}

            <button
              type="button"
              disabled={isSaving}
              onClick={() => void savePolicy()}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-medium text-neutral-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save new policy version
            </button>
          </div>

          <div className="space-y-3">
            <EnforcementPoint
              icon={DatabaseZap}
              title="Signup enforcement"
              description="A database trigger applies the active amount when the auth account is created."
            />
            <EnforcementPoint
              icon={ShieldCheck}
              title="Runtime safety check"
              description="The pricing gateway retries the same idempotent rule if signup delivery was interrupted."
            />
            <EnforcementPoint
              icon={Clock3}
              title="No recurring refill"
              description="Any historical free grant marks the benefit as already received, even after it expires or is consumed."
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div>
          <h2 className="text-lg font-medium text-neutral-100">Policy registry</h2>
          <p className="mt-1 text-sm text-neutral-400">
            New policy types can share this registry and audit model while keeping their own validated editor and enforcement adapter.
          </p>
        </div>
        <div className="mt-5 divide-y divide-white/10">
          {state.policies.map((item) => (
            <div
              key={item.policyKey}
              className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_120px_90px_180px] sm:items-center"
            >
              <div>
                <p className="text-sm font-medium text-neutral-200">{item.name}</p>
                <p className="mt-1 font-mono text-[11px] text-neutral-600">{item.policyKey}</p>
              </div>
              <p className="text-xs capitalize text-neutral-500">{item.category.replaceAll('_', ' ')}</p>
              <p className={item.enabled ? 'text-xs text-emerald-300' : 'text-xs text-amber-300'}>
                {item.enabled ? 'Enforced' : 'Paused'}
              </p>
              <p className="text-xs text-neutral-500 sm:text-right">
                v{item.version} · {formatDateTime(item.updatedAt)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div>
          <h2 className="text-lg font-medium text-neutral-100">Decision history</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Every saved change creates a new version with its reason and before/after snapshot.
          </p>
        </div>

        <div className="mt-5 divide-y divide-white/10">
          {policyAudit.map((item) => (
            <AuditRow key={item.id} item={item} />
          ))}
          {policyAudit.length === 0 && (
            <p className="py-6 text-sm text-neutral-500">No policy changes have been recorded yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-2 text-neutral-500">
        <Icon className="h-4 w-4" />
        <p className="text-xs uppercase tracking-wide">{label}</p>
      </div>
      <p className="mt-3 text-xl font-medium text-neutral-100">{value}</p>
      <p className="mt-1 text-xs text-neutral-500">{detail}</p>
    </div>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-neutral-200">{label}</span>
      <span className="mt-1 block text-xs leading-relaxed text-neutral-500">{help}</span>
      <span className="mt-2 block">{children}</span>
    </label>
  );
}

function EnforcementPoint({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof ShieldCheck;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-neutral-950/40 p-4">
      <div className="flex items-center gap-2 text-neutral-200">
        <Icon className="h-4 w-4 text-emerald-400" />
        <p className="text-sm font-medium">{title}</p>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-neutral-500">{description}</p>
    </div>
  );
}

function AuditRow({ item }: { item: AdminOperationalPolicyAuditItem }) {
  const snapshot = item.after;
  const config = asRecord(snapshot.config_json);
  const amount = Number(config?.coinAmount);
  const enabled = Boolean(snapshot.enabled);

  return (
    <div className="grid gap-2 py-4 sm:grid-cols-[100px_minmax(0,1fr)_180px] sm:items-start">
      <div>
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-neutral-300">
          v{item.policyVersion}
        </span>
      </div>
      <div>
        <p className="text-sm text-neutral-200">{item.reason}</p>
        <p className="mt-1 text-xs text-neutral-500">
          {Number.isFinite(amount) ? `${amount.toLocaleString()} coins` : 'Configured amount'}
          {' · '}
          {enabled ? 'enabled' : 'paused'}
        </p>
      </div>
      <p className="text-xs text-neutral-500 sm:text-right">{formatDateTime(item.createdAt)}</p>
    </div>
  );
}

function safeReadWelcomeConfig(policy: AdminOperationalPolicy | undefined): FreeWelcomeGrantConfig {
  if (!policy) return DEFAULT_CONFIG;
  try {
    return readFreeWelcomeGrantConfig(policy.config);
  } catch {
    return DEFAULT_CONFIG;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
