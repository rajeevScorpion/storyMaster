'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowLeft,
  Ban,
  BookOpen,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Coins,
  ExternalLink,
  Film,
  Gift,
  GitBranch,
  Loader2,
  RotateCcw,
  ShieldAlert,
  WalletCards,
} from 'lucide-react';
import {
  grantAdminUserCoins,
  updateAdminUserModeration,
} from '@/app/actions/admin-users';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import {
  type AdminAccountStatus,
  type AdminUserDetailData,
} from '@/lib/admin/user-management.shared';
import UserAvatar from './UserAvatar';
import {
  StatusBadge,
  formatCoins,
  formatDate,
  formatDateTime,
} from './AdminUserDirectory';

type ModerationMode = 'suspend' | 'block' | 'activate';

export default function AdminUserDetail({
  initialData,
}: {
  initialData: AdminUserDetailData;
}) {
  const [data, setData] = useState(initialData);
  const [moderationMode, setModerationMode] = useState<ModerationMode | null>(null);
  const [moderationReason, setModerationReason] = useState('');
  const [suspendedUntil, setSuspendedUntil] = useState(defaultSuspensionEnd);
  const [confirmModeration, setConfirmModeration] = useState(false);
  const [moderationBusy, setModerationBusy] = useState(false);

  const [grantCoins, setGrantCoins] = useState('');
  const [grantReason, setGrantReason] = useState('');
  const [grantExpiry, setGrantExpiry] = useState('');
  const [grantRequestKey, setGrantRequestKey] = useState('');
  const [confirmGrant, setConfirmGrant] = useState(false);
  const [grantBusy, setGrantBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const user = data.user;
  const parsedGrantCoins = Number(grantCoins);
  const projectedBalance = Number.isFinite(parsedGrantCoins)
    ? user.availableCoins + parsedGrantCoins
    : user.availableCoins;

  const moderationTarget = useMemo((): {
    status: AdminAccountStatus;
    suspendedUntil: string | null;
    label: string;
  } | null => {
    if (moderationMode === 'suspend') {
      const parsed = new Date(suspendedUntil);
      return {
        status: 'suspended',
        suspendedUntil: Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null,
        label: 'Suspend account',
      };
    }
    if (moderationMode === 'block') {
      return { status: 'blocked', suspendedUntil: null, label: 'Block account' };
    }
    if (moderationMode === 'activate') {
      return { status: 'active', suspendedUntil: null, label: 'Restore access' };
    }
    return null;
  }, [moderationMode, suspendedUntil]);

  async function executeModeration() {
    if (!moderationTarget) return;
    setModerationBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await updateAdminUserModeration({
        userId: user.userId,
        status: moderationTarget.status,
        suspendedUntil: moderationTarget.suspendedUntil,
        reason: moderationReason,
      });
      setData(result.detail);
      setModerationMode(null);
      setModerationReason('');
      setConfirmModeration(false);
      setNotice(
        result.authSyncWarning
          ? `Account status updated. ${result.authSyncWarning}`
          : 'Account status updated successfully.'
      );
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Unable to update account status.');
      setConfirmModeration(false);
    } finally {
      setModerationBusy(false);
    }
  }

  async function executeCoinGrant() {
    setGrantBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await grantAdminUserCoins({
        userId: user.userId,
        coins: parsedGrantCoins,
        reason: grantReason,
        expiresAt: grantExpiry
          ? new Date(`${grantExpiry}T23:59:59`).toISOString()
          : null,
        requestKey: grantRequestKey,
      });
      setData(result.detail);
      setGrantCoins('');
      setGrantReason('');
      setGrantExpiry('');
      setGrantRequestKey('');
      setConfirmGrant(false);
      setNotice(
        result.alreadyApplied
          ? 'This grant request had already been applied; no duplicate coins were added.'
          : `${formatCoins(parsedGrantCoins)} coins were added successfully.`
      );
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Unable to add coins.');
      setConfirmGrant(false);
    } finally {
      setGrantBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-2 text-sm text-neutral-500 transition-colors hover:text-emerald-300"
        >
          <ArrowLeft className="h-4 w-4" />
          User management
        </Link>
        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <UserAvatar src={user.avatarUrl} name={user.displayName} size={64} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-serif text-neutral-100">{user.displayName}</h1>
                <StatusBadge status={user.accountStatus} suspendedUntil={user.suspendedUntil} />
              </div>
              <p className="mt-1 truncate text-sm text-neutral-400">{user.email ?? 'No email available'}</p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-600">
                <span className="capitalize">{user.authProvider ?? 'unknown'} account</span>
                <span className="capitalize">{user.currentPlanKey} plan</span>
                <code>{user.userId}</code>
              </div>
            </div>
          </div>
          <Link
            href={`/admin/cost?userId=${user.userId}`}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Activity className="h-4 w-4" />
            AI cost activity
          </Link>
        </div>
      </div>

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

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Available coins"
          value={formatCoins(user.availableCoins)}
          hint={user.expiringCoins30d > 0 ? `${formatCoins(user.expiringCoins30d)} expire within 30 days` : 'Spendable after active holds'}
          icon={WalletCards}
        />
        <MetricCard
          label="Consumed lifetime"
          value={formatCoins(user.lifetimeConsumedCoins)}
          hint={`${formatCoins(user.lifetimeGrantedCoins)} coins granted lifetime`}
          icon={CircleDollarSign}
        />
        <MetricCard
          label="Consumed this month"
          value={formatCoins(user.monthConsumedCoins)}
          hint="UTC calendar month"
          icon={Coins}
        />
        <MetricCard
          label="Last active"
          value={user.lastProductActivityAt ? formatDate(user.lastProductActivityAt) : 'Never'}
          hint={`Joined ${formatDate(user.joinedAt)}`}
          icon={Clock3}
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StoryMetricCard label="In progress" value={user.inProgressStoryCount} icon={GitBranch} />
        <StoryMetricCard label="Finished" value={user.finishedStoryCount} icon={CheckCircle2} />
        <StoryMetricCard label="Published stories" value={user.publishedStoryCount} icon={BookOpen} />
        <StoryMetricCard label="Published paths" value={user.publishedPathCount} icon={ExternalLink} />
        <StoryMetricCard label="Reels" value={user.reelCount} icon={Film} />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-serif text-neutral-100">Account access</h2>
              <p className="mt-1 text-sm text-neutral-500">
                Suspensions expire automatically. Blocks remain until restored.
              </p>
            </div>
            <ShieldAlert className="h-5 w-5 text-neutral-600" />
          </div>

          {user.accountStatus !== 'active' && (
            <div className="mt-4 rounded-xl border border-white/10 bg-neutral-950/50 p-3 text-sm">
              <p className="text-neutral-300">
                Current state: <span className="capitalize">{user.accountStatus}</span>
                {user.suspendedUntil ? ` until ${formatDateTime(user.suspendedUntil)}` : ''}
              </p>
              {user.moderationReason && (
                <p className="mt-1 text-xs text-neutral-500">Internal reason: {user.moderationReason}</p>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton
              active={moderationMode === 'suspend'}
              icon={Clock3}
              label="Suspend"
              tone="amber"
              onClick={() => setModerationMode('suspend')}
            />
            <ActionButton
              active={moderationMode === 'block'}
              icon={Ban}
              label="Block"
              tone="rose"
              onClick={() => setModerationMode('block')}
            />
            {user.accountStatus !== 'active' && (
              <ActionButton
                active={moderationMode === 'activate'}
                icon={RotateCcw}
                label="Restore access"
                tone="emerald"
                onClick={() => setModerationMode('activate')}
              />
            )}
          </div>

          {moderationMode && (
            <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-neutral-950/40 p-4">
              {moderationMode === 'suspend' && (
                <label className="block">
                  <span className="mb-1.5 block text-xs uppercase tracking-[0.12em] text-neutral-500">
                    Suspended until
                  </span>
                  <input
                    type="datetime-local"
                    value={suspendedUntil}
                    onChange={(event) => setSuspendedUntil(event.target.value)}
                    className={INPUT_CLASS}
                  />
                </label>
              )}
              <label className="block">
                <span className="mb-1.5 block text-xs uppercase tracking-[0.12em] text-neutral-500">
                  Internal reason
                </span>
                <textarea
                  value={moderationReason}
                  onChange={(event) => setModerationReason(event.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Required for the audit trail"
                  className={`${INPUT_CLASS} resize-none`}
                />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setModerationMode(null);
                    setModerationReason('');
                  }}
                  className="rounded-lg px-3 py-2 text-sm text-neutral-500 hover:text-neutral-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    moderationReason.trim().length < 3
                    || (moderationMode === 'suspend' && !moderationTarget?.suspendedUntil)
                  }
                  onClick={() => setConfirmModeration(true)}
                  className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-neutral-100 transition-colors hover:bg-white/15 disabled:opacity-40"
                >
                  Review action
                </button>
              </div>
            </div>
          )}
        </article>

        <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-serif text-neutral-100">Add coins</h2>
              <p className="mt-1 text-sm text-neutral-500">
                Creates an immutable admin-adjustment grant; it never overwrites the wallet.
              </p>
            </div>
            <Gift className="h-5 w-5 text-emerald-300" />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs uppercase tracking-[0.12em] text-neutral-500">Coins</span>
              <input
                type="number"
                min="1"
                step="1"
                value={grantCoins}
                onChange={(event) => setGrantCoins(event.target.value)}
                placeholder="500"
                className={INPUT_CLASS}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs uppercase tracking-[0.12em] text-neutral-500">
                Optional expiry
              </span>
              <input
                type="date"
                value={grantExpiry}
                min={todayDateInput()}
                onChange={(event) => setGrantExpiry(event.target.value)}
                className={INPUT_CLASS}
              />
            </label>
          </div>
          <label className="mt-3 block">
            <span className="mb-1.5 block text-xs uppercase tracking-[0.12em] text-neutral-500">Reason</span>
            <textarea
              value={grantReason}
              onChange={(event) => setGrantReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Promotion, support compensation, or goodwill reason"
              className={`${INPUT_CLASS} resize-none`}
            />
          </label>
          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-xs text-neutral-500">
              Balance after grant: <span className="text-emerald-300">{formatCoins(projectedBalance)} coins</span>
            </p>
            <button
              type="button"
              disabled={!Number.isInteger(parsedGrantCoins) || parsedGrantCoins <= 0 || grantReason.trim().length < 3}
              onClick={() => {
                setGrantRequestKey(`manual:${crypto.randomUUID()}`);
                setConfirmGrant(true);
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-neutral-950 transition-colors hover:bg-emerald-300 disabled:opacity-40"
            >
              <Gift className="h-4 w-4" />
              Review grant
            </button>
          </div>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <TimelineCard title="Wallet activity" icon={WalletCards}>
          {data.walletActivity.length > 0 ? data.walletActivity.map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-4 border-b border-white/5 py-3 last:border-0">
              <div className="min-w-0">
                <p className="truncate text-sm text-neutral-300">{item.label}</p>
                <p className="mt-1 text-xs text-neutral-600">
                  {formatDateTime(item.occurredAt)}
                  {item.expiresAt ? ` · expires ${formatDate(item.expiresAt)}` : ''}
                </p>
              </div>
              <p className={`shrink-0 text-sm font-medium ${item.coinsDelta >= 0 ? 'text-emerald-300' : 'text-neutral-400'}`}>
                {item.coinsDelta >= 0 ? '+' : ''}{formatCoins(item.coinsDelta)}
              </p>
            </div>
          )) : <EmptyText>No wallet activity yet.</EmptyText>}
        </TimelineCard>

        <TimelineCard title="Admin audit trail" icon={ShieldAlert}>
          {data.auditEvents.length > 0 ? data.auditEvents.map((item) => (
            <div key={item.id} className="border-b border-white/5 py-3 last:border-0">
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm text-neutral-300">{auditLabel(item.actionType)}</p>
                <p className="shrink-0 text-xs text-neutral-600">{formatDateTime(item.createdAt)}</p>
              </div>
              <p className="mt-1 text-xs leading-5 text-neutral-500">{item.reason}</p>
            </div>
          )) : <EmptyText>No administrative actions yet.</EmptyText>}
        </TimelineCard>
      </section>

      <TimelineCard title="Recent stories and reels" icon={BookOpen}>
        {data.recentStories.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.12em] text-neutral-600">
                  <th className="py-3 pr-4 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Kind</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                  <th className="py-3 pl-4 font-medium" />
                </tr>
              </thead>
              <tbody>
                {data.recentStories.map((story) => (
                  <tr key={story.id} className="border-b border-white/5 last:border-0">
                    <td className="max-w-md truncate py-3 pr-4 text-neutral-200">{story.title}</td>
                    <td className="px-4 py-3 capitalize text-neutral-500">{story.kind}</td>
                    <td className="px-4 py-3 capitalize text-neutral-500">
                      {story.isArchived ? 'archived' : story.status}
                    </td>
                    <td className="px-4 py-3 text-neutral-500">{formatDate(story.updatedAt)}</td>
                    <td className="py-3 pl-4 text-right">
                      <Link
                        href={`/story/${story.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200"
                      >
                        Open <ExternalLink className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyText>No stories or reels created yet.</EmptyText>}
      </TimelineCard>

      <ConfirmDialog
        open={confirmModeration}
        title={moderationTarget?.label ?? 'Update account'}
        message={
          moderationTarget?.status === 'suspended'
            ? `This user will lose access until ${formatDateTime(moderationTarget.suspendedUntil)}.`
            : moderationTarget?.status === 'blocked'
              ? 'This user will lose access indefinitely. Published content is not changed.'
              : 'This user will regain account access immediately.'
        }
        confirmLabel={moderationTarget?.label ?? 'Confirm'}
        tone={moderationTarget?.status === 'blocked' ? 'danger' : 'default'}
        busy={moderationBusy}
        onCancel={() => setConfirmModeration(false)}
        onConfirm={executeModeration}
      />

      <ConfirmDialog
        open={confirmGrant}
        title="Confirm coin grant"
        message={`Add ${formatCoins(parsedGrantCoins)} coins to ${user.email ?? user.displayName}? The available balance will become approximately ${formatCoins(projectedBalance)} coins.`}
        confirmLabel="Add coins"
        busy={grantBusy}
        onCancel={() => {
          setConfirmGrant(false);
          setGrantRequestKey('');
        }}
        onConfirm={executeCoinGrant}
      />
    </div>
  );
}

const INPUT_CLASS = 'w-full rounded-xl border border-white/10 bg-neutral-900/80 px-3 py-2.5 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-emerald-500/40';

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof WalletCards;
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.13em] text-neutral-500">{label}</p>
        <Icon className="h-4 w-4 text-emerald-300" />
      </div>
      <p className="mt-3 text-2xl font-semibold text-neutral-100">{value}</p>
      <p className="mt-1 text-xs text-neutral-600">{hint}</p>
    </article>
  );
}

function StoryMetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof GitBranch;
}) {
  return (
    <article className="rounded-xl border border-white/10 bg-neutral-950/40 px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-2 text-xl font-medium text-neutral-100">{value.toLocaleString('en-IN')}</p>
    </article>
  );
}

function ActionButton({
  active,
  icon: Icon,
  label,
  tone,
  onClick,
}: {
  active: boolean;
  icon: typeof Ban;
  label: string;
  tone: 'amber' | 'rose' | 'emerald';
  onClick: () => void;
}) {
  const colors = tone === 'rose'
    ? 'border-rose-500/25 bg-rose-500/10 text-rose-300'
    : tone === 'amber'
      ? 'border-amber-500/25 bg-amber-500/10 text-amber-300'
      : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-opacity hover:opacity-90 ${colors} ${active ? 'ring-1 ring-white/20' : ''}`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function TimelineCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof BookOpen;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-emerald-300" />
        <h2 className="text-lg font-serif text-neutral-100">{title}</h2>
      </div>
      <div className="mt-3">{children}</div>
    </article>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-neutral-600">{children}</p>;
}

function auditLabel(actionType: string): string {
  const labels: Record<string, string> = {
    account_suspended: 'Account suspended',
    account_blocked: 'Account blocked',
    account_reactivated: 'Account access restored',
    coins_granted: 'Coins granted',
  };
  return labels[actionType] ?? actionType.replaceAll('_', ' ');
}

function defaultSuspensionEnd(): string {
  const value = new Date(Date.now() + 7 * 86_400_000);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
}

function todayDateInput(): string {
  const value = new Date();
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 10);
}
