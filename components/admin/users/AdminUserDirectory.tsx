'use client';

import { FormEvent, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Ban,
  CircleDollarSign,
  Clock3,
  Loader2,
  Search,
  ShieldCheck,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import { getAdminUsersPage } from '@/app/actions/admin-users';
import FilterDropdown from '@/components/ui/FilterDropdown';
import {
  ADMIN_USER_PAGE_SIZES,
  type AdminAccountStatus,
  type AdminAccountStatusFilter,
  type AdminUsersPageData,
} from '@/lib/admin/user-management.shared';
import UserAvatar from './UserAvatar';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'blocked', label: 'Blocked' },
];

export default function AdminUserDirectory({
  initialData,
}: {
  initialData: AdminUsersPageData;
}) {
  const [data, setData] = useState(initialData);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [status, setStatus] = useState<AdminAccountStatusFilter>('all');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function load(input: {
    page?: number;
    pageSize?: number;
    status?: AdminAccountStatusFilter;
    search?: string;
  }) {
    const next = {
      page: input.page ?? data.page,
      pageSize: input.pageSize ?? data.pageSize,
      status: input.status ?? status,
      search: input.search ?? appliedSearch,
    };
    setError(null);
    startTransition(async () => {
      try {
        const result = await getAdminUsersPage(next);
        setData(result);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load users.');
      }
    });
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const normalized = search.trim();
    setAppliedSearch(normalized);
    load({ page: 1, search: normalized });
  }

  const restrictedUsers = data.summary.suspendedUsers + data.summary.blockedUsers;

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Total users"
          value={formatInteger(data.summary.totalUsers)}
          hint={`${formatInteger(data.summary.activeUsers)} active`}
          icon={UsersRound}
        />
        <SummaryCard
          label="Restricted"
          value={formatInteger(restrictedUsers)}
          hint={`${data.summary.suspendedUsers} suspended · ${data.summary.blockedUsers} blocked`}
          icon={Ban}
          tone={restrictedUsers > 0 ? 'amber' : 'neutral'}
        />
        <SummaryCard
          label="Available coins"
          value={formatCoins(data.summary.availableCoins)}
          hint="Across all spendable wallets"
          icon={WalletCards}
        />
        <SummaryCard
          label="Consumed this month"
          value={formatCoins(data.summary.monthConsumedCoins)}
          hint="UTC calendar month"
          icon={CircleDollarSign}
        />
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.035]">
        <div className="flex flex-col gap-3 border-b border-white/10 p-4 lg:flex-row lg:items-center">
          <form onSubmit={submitSearch} className="flex min-w-0 flex-1 gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by email or name"
                className="h-10 w-full rounded-xl border border-white/10 bg-neutral-900/80 pl-9 pr-3 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-emerald-500/40"
              />
            </div>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-400 px-4 text-sm font-semibold text-neutral-950 transition-colors hover:bg-emerald-300 disabled:opacity-50"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </button>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            <FilterDropdown
              value={status}
              options={STATUS_OPTIONS}
              ariaLabel="Filter users by status"
              onChange={(value) => {
                const nextStatus = value as AdminAccountStatusFilter;
                setStatus(nextStatus);
                load({ status: nextStatus, page: 1 });
              }}
            />
            <FilterDropdown
              value={String(data.pageSize)}
              options={ADMIN_USER_PAGE_SIZES.map((value) => ({
                value: String(value),
                label: `${value} per page`,
              }))}
              ariaLabel="Users per page"
              onChange={(value) => load({ pageSize: Number(value), page: 1 })}
            />
          </div>
        </div>

        {appliedSearch && (
          <div className="flex items-center justify-between gap-3 border-b border-white/5 px-4 py-2 text-xs text-neutral-500">
            <span>
              Results for <span className="text-neutral-300">{appliedSearch}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setAppliedSearch('');
                load({ search: '', page: 1 });
              }}
              className="text-emerald-300 hover:text-emerald-200"
            >
              Clear
            </button>
          </div>
        )}

        {error && (
          <div className="m-4 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        <div className={`relative overflow-x-auto transition-opacity ${isPending ? 'opacity-55' : ''}`}>
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.12em] text-neutral-600">
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Access</th>
                <th className="px-4 py-3 font-medium">Stories</th>
                <th className="px-4 py-3 font-medium">Coins</th>
                <th className="px-4 py-3 font-medium">Activity</th>
                <th className="px-4 py-3 font-medium" aria-label="Open user" />
              </tr>
            </thead>
            <tbody>
              {data.users.map((user) => (
                <tr key={user.userId} className="border-b border-white/5 transition-colors hover:bg-white/[0.035]">
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <UserAvatar src={user.avatarUrl} name={user.displayName} />
                      <div className="min-w-0">
                        <Link
                          href={`/admin/users/${user.userId}`}
                          className="block max-w-64 truncate font-medium text-neutral-100 hover:text-emerald-300"
                        >
                          {user.displayName}
                        </Link>
                        <p className="max-w-64 truncate text-xs text-neutral-500">
                          {user.email ?? 'No email available'}
                        </p>
                        <p className="mt-0.5 text-[11px] uppercase tracking-wide text-neutral-700">
                          {user.authProvider ?? 'unknown provider'}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge status={user.accountStatus} suspendedUntil={user.suspendedUntil} />
                    <p className="mt-1.5 text-xs capitalize text-neutral-500">{user.currentPlanKey} plan</p>
                  </td>
                  <td className="px-4 py-4">
                    <div className="grid grid-cols-3 gap-3">
                      <StoryMetric label="Progress" value={user.inProgressStoryCount} />
                      <StoryMetric label="Finished" value={user.finishedStoryCount} />
                      <StoryMetric label="Published" value={user.publishedStoryCount} />
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-medium text-emerald-300">{formatCoins(user.availableCoins)} available</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      {formatCoins(user.monthConsumedCoins)} month · {formatCoins(user.lifetimeConsumedCoins)} lifetime
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="text-neutral-300">{formatRelativeDate(user.lastProductActivityAt)}</p>
                    <p className="mt-1 text-xs text-neutral-600">
                      Joined {formatDate(user.joinedAt)}
                    </p>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <Link
                      href={`/admin/users/${user.userId}`}
                      aria-label={`Manage ${user.displayName}`}
                      className="inline-flex rounded-lg p-2 text-neutral-500 transition-colors hover:bg-white/5 hover:text-emerald-300"
                    >
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {data.users.length === 0 && (
            <div className="px-6 py-16 text-center">
              <Search className="mx-auto h-8 w-8 text-neutral-700" />
              <p className="mt-3 text-sm text-neutral-400">No users match these filters.</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-neutral-500">
            {data.totalCount === 0
              ? 'No users'
              : `Showing ${(data.page - 1) * data.pageSize + 1}–${Math.min(data.page * data.pageSize, data.totalCount)} of ${formatInteger(data.totalCount)}`}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isPending || data.page <= 1}
              onClick={() => load({ page: data.page - 1 })}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-white/5 disabled:opacity-35"
            >
              Previous
            </button>
            <span className="px-2 text-xs text-neutral-500">
              Page {data.page} of {data.totalPages}
            </span>
            <button
              type="button"
              disabled={isPending || data.page >= data.totalPages}
              onClick={() => load({ page: data.page + 1 })}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-white/5 disabled:opacity-35"
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export function StatusBadge({
  status,
  suspendedUntil,
}: {
  status: AdminAccountStatus;
  suspendedUntil?: string | null;
}) {
  const style = status === 'active'
    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
    : status === 'suspended'
      ? 'border-amber-500/20 bg-amber-500/10 text-amber-300'
      : 'border-rose-500/20 bg-rose-500/10 text-rose-300';
  return (
    <span
      title={status === 'suspended' && suspendedUntil ? `Until ${formatDateTime(suspendedUntil)}` : undefined}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${style}`}
    >
      {status === 'active'
        ? <ShieldCheck className="h-3 w-3" />
        : status === 'suspended'
          ? <Clock3 className="h-3 w-3" />
          : <Ban className="h-3 w-3" />}
      {status}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof UsersRound;
  tone?: 'neutral' | 'amber';
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.14em] text-neutral-500">{label}</p>
        <span className={`rounded-lg p-2 ${tone === 'amber' ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold text-neutral-100">{value}</p>
      <p className="mt-1 text-xs text-neutral-600">{hint}</p>
    </article>
  );
}

function StoryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="font-medium text-neutral-200">{value.toLocaleString()}</p>
      <p className="text-[11px] text-neutral-600">{label}</p>
    </div>
  );
}

export function formatCoins(value: number): string {
  return value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export function formatDate(value: string | null): string {
  if (!value) return 'Never';
  return new Date(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(value: string | null): string {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatRelativeDate(value: string | null): string {
  if (!value) return 'No activity yet';
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return formatDate(value);
  const days = Math.floor(elapsed / 86_400_000);
  if (days === 0) return 'Active today';
  if (days === 1) return 'Active yesterday';
  if (days < 30) return `Active ${days} days ago`;
  return `Active ${formatDate(value)}`;
}

function formatInteger(value: number): string {
  return value.toLocaleString('en-IN');
}
