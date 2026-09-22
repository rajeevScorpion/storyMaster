'use client';

import { FormEvent, useState, useTransition } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Loader2, Search } from 'lucide-react';
import { getAdminPaymentsList } from '@/app/actions/admin-payments-list';
import FilterDropdown from '@/components/ui/FilterDropdown';
import { formatCurrencyMinor } from '@/lib/billing/wallet-tax.shared';
import {
  PAYMENT_KIND_FILTER_OPTIONS,
  PAYMENT_STATUS_FILTER_OPTIONS,
  PROVIDER_MODE_FILTER_OPTIONS,
  type AdminPaymentListRow,
  type AdminPaymentsListData,
  type PaymentKindFilter,
  type PaymentStatusFilter,
  type ProviderModeFilter,
} from '@/lib/admin/admin-payments-list.shared';

// /admin/pricing/payments: an admin-wide payments list. Built because the owner made a real test
// payment and the only place it showed up in admin was the Billing section at the bottom of one
// user's record -- there was no way to start from "a payment ID from Razorpay" or "someone's
// email" and find it. Read-only: this page never mutates a payment, refund, or user row (see
// AdminUserDetail's Billing panel for refund/cancel/re-sync actions).

export default function AdminPaymentsList({ initialData }: { initialData: AdminPaymentsListData }) {
  const [data, setData] = useState(initialData);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [status, setStatus] = useState<PaymentStatusFilter>('all');
  const [kind, setKind] = useState<PaymentKindFilter>('all');
  const [providerMode, setProviderMode] = useState<ProviderModeFilter>('all');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function load(input: {
    page?: number;
    search?: string;
    status?: PaymentStatusFilter;
    kind?: PaymentKindFilter;
    providerMode?: ProviderModeFilter;
  }) {
    const next = {
      page: input.page ?? 1,
      search: input.search ?? appliedSearch,
      status: input.status ?? status,
      kind: input.kind ?? kind,
      providerMode: input.providerMode ?? providerMode,
    };
    setError(null);
    startTransition(async () => {
      try {
        const result = await getAdminPaymentsList(next);
        setData(result);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load payments.');
      }
    });
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const normalized = search.trim();
    setAppliedSearch(normalized);
    load({ page: 1, search: normalized });
  }

  if (data.status === 'unavailable') {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-amber-500/10 p-2.5 text-amber-300">
            <AlertTriangle size={18} />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-100">Billing ledger unavailable</p>
            <p className="mt-1 text-sm text-neutral-400">
              The billing ledger isn&rsquo;t available on this environment yet (migration 125). This is expected on a
              database that hasn&rsquo;t had that migration applied — it is not an error.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TotalsStrip totals={data.totals} totalsCapped={data.totalsCapped} />

      <section className="rounded-2xl border border-white/10 bg-white/[0.035]">
        <div className="flex flex-col gap-3 border-b border-white/10 p-4 lg:flex-row lg:items-center">
          <form onSubmit={submitSearch} className="flex min-w-0 flex-1 gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by Razorpay id (pay_/order_/sub_), email, or user id"
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
              options={PAYMENT_STATUS_FILTER_OPTIONS}
              ariaLabel="Filter payments by status"
              onChange={(value) => {
                const next = value as PaymentStatusFilter;
                setStatus(next);
                load({ status: next, page: 1 });
              }}
            />
            <FilterDropdown
              value={kind}
              options={PAYMENT_KIND_FILTER_OPTIONS}
              ariaLabel="Filter payments by kind"
              onChange={(value) => {
                const next = value as PaymentKindFilter;
                setKind(next);
                load({ kind: next, page: 1 });
              }}
            />
            <FilterDropdown
              value={providerMode}
              options={PROVIDER_MODE_FILTER_OPTIONS}
              ariaLabel="Filter payments by test or live mode"
              onChange={(value) => {
                const next = value as ProviderModeFilter;
                setProviderMode(next);
                load({ providerMode: next, page: 1 });
              }}
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
          <table className="w-full min-w-[1180px] text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.12em] text-neutral-600">
                <th className="py-3 pl-4 pr-4 font-medium">Reference</th>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Kind</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Method</th>
                <th className="px-4 py-3 font-medium">Mode</th>
                <th className="px-4 py-3 font-medium">Captured</th>
                <th className="py-3 pl-4 pr-4 font-medium" aria-label="Open user" />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((payment) => (
                <PaymentRow key={payment.id} payment={payment} />
              ))}
            </tbody>
          </table>

          {data.rows.length === 0 && (
            <div className="px-6 py-16 text-center">
              <Search className="mx-auto h-8 w-8 text-neutral-700" />
              <p className="mt-3 text-sm text-neutral-400">No payments match these filters.</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-neutral-500">
            {data.totalCount === 0
              ? 'No payments'
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

function TotalsStrip({
  totals,
  totalsCapped,
}: {
  totals: AdminPaymentsListData['totals'];
  totalsCapped: boolean;
}) {
  if (totals.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-xs text-neutral-500">
        No payments in the current filter to total.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        {totals.map((total) => (
          <article key={total.mode} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <div className="flex items-center justify-between gap-3">
              <ModeBadge mode={total.mode} />
              <p className="text-xs text-neutral-500">{formatInteger(total.count)} payments</p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-neutral-600">Gross captured</p>
                <p className="mt-1 text-lg font-semibold text-neutral-100">
                  {formatCurrencyMinor(total.currencyCode, total.grossCapturedMinor)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-neutral-600">Refunded</p>
                <p className="mt-1 text-lg font-semibold text-neutral-300">
                  {formatCurrencyMinor(total.currencyCode, total.refundedMinor)}
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>
      {totalsCapped && (
        <p className="text-[11px] text-amber-300/80">
          Totals are computed over the most recent matching payments and may undercount older rows at this volume.
        </p>
      )}
    </div>
  );
}

function PaymentRow({ payment }: { payment: AdminPaymentListRow }) {
  const displayName = payment.userDisplayName || payment.userEmail || (payment.userId ? 'Unnamed account' : null);

  return (
    <tr className="border-b border-white/5 transition-colors hover:bg-white/[0.035]">
      <td className="py-4 pl-4 pr-4">
        <p title={payment.providerPaymentId} className="font-mono text-xs text-neutral-300">
          {shortId(payment.providerPaymentId)}
        </p>
        {payment.providerOrderId && (
          <p title={payment.providerOrderId} className="mt-0.5 font-mono text-[10px] text-neutral-600">
            order {shortId(payment.providerOrderId)}
          </p>
        )}
        {payment.providerSubscriptionId && (
          <p title={payment.providerSubscriptionId} className="mt-0.5 font-mono text-[10px] text-neutral-600">
            sub {shortId(payment.providerSubscriptionId)}
          </p>
        )}
      </td>
      <td className="px-4 py-4">
        {payment.userId ? (
          <Link
            href={`/admin/users/${payment.userId}#billing`}
            className="block max-w-56 truncate text-neutral-200 hover:text-emerald-300"
          >
            {displayName}
          </Link>
        ) : (
          <div className="max-w-56">
            <p className="text-neutral-400">Deleted account</p>
            <p title={payment.subjectRef} className="mt-0.5 truncate font-mono text-[10px] text-neutral-600">
              {payment.subjectRef}
            </p>
          </div>
        )}
      </td>
      <td className="px-4 py-4 capitalize text-neutral-400">{payment.kind.replaceAll('_', ' ')}</td>
      <td className="px-4 py-4 text-neutral-200">{formatCurrencyMinor(payment.currencyCode, payment.grossMinor)}</td>
      <td className="px-4 py-4">
        <p className="capitalize text-neutral-400">{payment.status.replaceAll('_', ' ')}</p>
        {payment.refundedMinor > 0 && (
          <p className="mt-0.5 text-[11px] text-amber-300/80">
            Refunded {formatCurrencyMinor(payment.currencyCode, payment.refundedMinor)}
          </p>
        )}
        {payment.hasPendingRefund && <p className="mt-0.5 text-[11px] text-amber-300/80">Refund pending</p>}
      </td>
      <td className="px-4 py-4 capitalize text-neutral-500">{payment.methodCategory ?? 'unknown'}</td>
      <td className="px-4 py-4">
        <ModeBadge mode={payment.providerMode ?? 'unknown'} />
      </td>
      <td className="px-4 py-4 text-neutral-500">{formatDate(payment.capturedAt ?? payment.createdAt)}</td>
      <td className="py-4 pl-4 pr-4 text-right">
        {payment.userId && (
          <Link
            href={`/admin/users/${payment.userId}#billing`}
            aria-label={`Open billing for ${displayName}`}
            className="inline-flex rounded-lg p-2 text-neutral-500 transition-colors hover:bg-white/5 hover:text-emerald-300"
          >
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </td>
    </tr>
  );
}

function ModeBadge({ mode }: { mode: string }) {
  const style = mode === 'live'
    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
    : mode === 'test'
      ? 'border-amber-500/20 bg-amber-500/10 text-amber-300'
      : 'border-white/10 bg-neutral-800 text-neutral-400';
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${style}`}>
      {mode}
    </span>
  );
}

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 12)}…` : id;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatInteger(value: number): string {
  return value.toLocaleString('en-IN');
}
