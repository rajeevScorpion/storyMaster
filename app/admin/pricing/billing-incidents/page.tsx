import type { ComponentType, ReactNode } from 'react';
import { CalendarClock, FileWarning, Hourglass, MailWarning, PackageX, Webhook } from 'lucide-react';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { getBillingIncidentsDashboard, type BillingIncidentSection } from '@/app/actions/billing-incidents';
import { formatIncidentAge } from '@/lib/billing/billing-incidents.shared';

// Payments Phase 4, Unit F (docs/payments/phase-4-plan.md §9 "Unit F"): read-only incident
// dashboard. Renders the four failure classes lib/billing/razorpay-reconcile.ts's daily cron scans
// for -- see app/actions/billing-incidents.ts for why the counts can't drift apart from it -- plus
// four Phase 6 notification/document health cards added in Payments Phase 7
// (docs/payments/phase-7-plan.md §8, Unit B2). This page never mutates anything; there is nothing
// here to confirm or undo.
export const dynamic = 'force-dynamic';

function formatAmount(amountMinor: number, currencyCode: string): string {
  return `${(amountMinor / 100).toFixed(2)} ${currencyCode}`;
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function StatusPill({ tone, children }: { tone: 'healthy' | 'attention' | 'unavailable'; children: ReactNode }) {
  const toneClass =
    tone === 'healthy'
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
      : tone === 'attention'
        ? 'border-amber-500/20 bg-amber-500/10 text-amber-300'
        : 'border-white/10 bg-neutral-800 text-neutral-400';

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-wider ${toneClass}`}>
      {children}
    </span>
  );
}

function SectionShell({
  title,
  description,
  icon: Icon,
  section,
  healthyLabel,
  children,
}: {
  title: string;
  description: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  section: BillingIncidentSection<unknown>;
  healthyLabel: string;
  children: ReactNode;
}) {
  const tone: 'healthy' | 'attention' | 'unavailable' =
    section.status === 'unavailable' ? 'unavailable' : section.totalCount === 0 ? 'healthy' : 'attention';

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-emerald-500/10 p-2.5 text-emerald-300">
            <Icon size={18} />
          </div>
          <div>
            <h2 className="text-base font-medium text-neutral-100">{title}</h2>
            <p className="mt-1 text-sm text-neutral-400">{description}</p>
          </div>
        </div>
        <StatusPill tone={tone}>
          {tone === 'unavailable'
            ? section.unavailableReason === 'issuing_disabled'
              ? 'Issuing off'
              : 'Unavailable'
            : tone === 'healthy'
              ? 'Healthy'
              : `${section.totalCount} to review`}
        </StatusPill>
      </div>

      {section.status === 'unavailable' ? (
        <p className="rounded-xl border border-white/10 bg-neutral-900/60 p-4 text-sm text-neutral-500">
          {section.unavailableReason === 'provider_config'
            ? 'Unavailable on this environment — Razorpay is not configured here, so there is no provider mode to scope this section to. Set the Razorpay keys to read it. This is not an error.'
            : section.unavailableReason === 'issuing_disabled'
              ? 'Issuing off — billing_document_issuing_enabled is off, so no invoice is ever issued and this count would just be every captured payment. Turn the switch on in Operational flags to read this.'
              : section.unavailableReason === 'switch_unreadable'
                ? 'Unavailable — couldn’t read when the billing switches went on, so this can’t be scoped safely. Try again shortly.'
                : 'Unavailable on this environment — the table or column this section reads isn’t present here yet. This is expected on a database that hasn’t had every migration applied; it is not an error.'}
        </p>
      ) : section.totalCount === 0 ? (
        <p className="rounded-xl border border-white/10 bg-neutral-900/60 p-4 text-sm text-emerald-200/80">{healthyLabel}</p>
      ) : (
        <div className="space-y-3">{children}</div>
      )}
    </section>
  );
}

function RowCard({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">{children}</div>;
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-[10px] uppercase tracking-wider text-neutral-500">{children}</span>;
}

export default async function BillingIncidentsPage() {
  const data = await getBillingIncidentsDashboard();
  const generatedAt = new Date(data.generatedAtMs).toLocaleString();
  const nowMs = data.generatedAtMs;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <AdminPageHeader
          title="Billing incidents"
          description="The same failure classes the daily reconcile job scans for, read-only. Fix from the user's record or the Razorpay dashboard — nothing here mutates money."
        />
        <p className="mt-2 text-xs uppercase tracking-[0.18em] text-emerald-300/80">Snapshot at {generatedAt}</p>
      </div>

      <SectionShell
        title="Failed webhooks"
        description="Failed under the retry limit, or stuck in 'received' past the reprocess window."
        icon={Webhook}
        section={data.failedWebhooks}
        healthyLabel="No failed or stuck webhook events. The webhook is landing normally."
      >
        {data.failedWebhooks.rows.map((row) => (
          <RowCard key={row.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-neutral-100">
                  {row.eventType} <span className="text-neutral-500">({shortId(row.id)})</span>
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  Provider event {row.providerEventId} · attempt {row.attemptCount} · received {formatIncidentAge(nowMs, row.receivedAt)} ago
                </p>
              </div>
              <StatusPill tone="attention">{row.status}</StatusPill>
            </div>
            {row.errorMessage && <p className="mt-2 text-xs text-rose-300/90">Error: {row.errorMessage}</p>}
            {(row.relatedUserId || row.relatedSubscriptionId) && (
              <p className="mt-2 text-xs text-neutral-500">
                {row.relatedUserId && <>User {shortId(row.relatedUserId)}</>}
                {row.relatedUserId && row.relatedSubscriptionId && ' · '}
                {row.relatedSubscriptionId && <>Subscription {shortId(row.relatedSubscriptionId)}</>}
              </p>
            )}
          </RowCard>
        ))}
      </SectionShell>

      <SectionShell
        title="Stuck subscription checkouts"
        description="Created, abandoned, or superseded checkouts, 10 minutes to 7 days old, whose Razorpay subscription hasn't been confirmed."
        icon={Hourglass}
        section={data.stuckSubscriptionCheckouts}
        healthyLabel="No stuck subscription checkouts."
      >
        {data.stuckSubscriptionCheckouts.rows.map((row) => (
          <RowCard key={row.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-neutral-100">Order {shortId(row.id)}</p>
                <p className="mt-1 text-xs text-neutral-500">
                  {row.userId ? <>User {shortId(row.userId)} · </> : 'No owner (deleted account) · '}
                  {formatAmount(row.amountMinor, row.currencyCode)} · created {formatIncidentAge(nowMs, row.createdAt)} ago
                </p>
              </div>
              <StatusPill tone="attention">{row.status}</StatusPill>
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              <FieldLabel>Checkout session</FieldLabel> {row.providerCheckoutSessionId ?? 'none'}
            </p>
          </RowCard>
        ))}
      </SectionShell>

      <SectionShell
        title="Subscriptions past their boundary"
        description="Active-ish subscriptions with no confirmed first charge, a period that already ended, or no webhook in 2 days."
        icon={CalendarClock}
        section={data.subscriptionsPastBoundary}
        healthyLabel="No subscriptions past their renewal boundary."
      >
        {data.subscriptionsPastBoundary.rows.map((row) => {
          const reasons: string[] = [];
          if (!row.firstChargeConfirmedAt) reasons.push('first charge unconfirmed');
          if (row.currentPeriodEnd && new Date(row.currentPeriodEnd).getTime() < nowMs) reasons.push('period ended');
          if (row.lastWebhookAt && new Date(row.lastWebhookAt).getTime() < nowMs - 2 * 24 * 60 * 60 * 1000) {
            reasons.push('webhook stale');
          } else if (!row.lastWebhookAt) {
            reasons.push('no webhook yet');
          }

          return (
            <RowCard key={row.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-neutral-100">Subscription {shortId(row.id)}</p>
                  <p className="mt-1 text-xs text-neutral-500">
                    {row.userId ? <>User {shortId(row.userId)} · </> : 'No owner (deleted account) · '}
                    Provider {shortId(row.providerSubscriptionId)}
                    {row.cancelAtPeriodEnd ? ' · cancels at period end' : ''}
                  </p>
                </div>
                <StatusPill tone="attention">{row.status}</StatusPill>
              </div>
              <p className="mt-2 text-xs text-amber-300/90">Why: {reasons.join(', ')}</p>
              <p className="mt-1 text-xs text-neutral-500">
                Period end: {row.currentPeriodEnd ? new Date(row.currentPeriodEnd).toLocaleString() : 'none'} · Last webhook:{' '}
                {row.lastWebhookAt ? `${formatIncidentAge(nowMs, row.lastWebhookAt)} ago` : 'never'}
              </p>
            </RowCard>
          );
        })}
      </SectionShell>

      <SectionShell
        title="Stuck top-ups"
        description="Created, attempted, or failed top-up orders, 10 minutes to 7 days old, that never settled."
        icon={PackageX}
        section={data.stuckTopups}
        healthyLabel="No stuck top-up orders."
      >
        {data.stuckTopups.rows.map((row) => (
          <RowCard key={row.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-neutral-100">Order {shortId(row.id)}</p>
                <p className="mt-1 text-xs text-neutral-500">
                  {row.userId ? <>User {shortId(row.userId)} · </> : 'No owner (deleted account) · '}
                  {formatAmount(row.amountMinor, row.currencyCode)} · created {formatIncidentAge(nowMs, row.createdAt)} ago
                </p>
              </div>
              <StatusPill tone="attention">{row.status}</StatusPill>
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              <FieldLabel>Provider order</FieldLabel> {row.providerOrderId ?? 'none'}
              {row.providerPaymentId && (
                <>
                  {' '}
                  · <FieldLabel>Payment</FieldLabel> {row.providerPaymentId}
                </>
              )}
            </p>
          </RowCard>
        ))}
      </SectionShell>

      <SectionShell
        title="Failed billing jobs"
        description="Notification jobs (receipts, invoices, refund/cancellation emails) that exhausted their retries."
        icon={MailWarning}
        section={data.failedBillingJobs}
        healthyLabel="No failed billing jobs."
      >
        {data.failedBillingJobs.rows.map((row) => (
          <RowCard key={row.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-neutral-100">
                  {row.kind} <span className="text-neutral-500">({shortId(row.id)})</span>
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  {row.userId ? <>User {shortId(row.userId)} · </> : 'No owner (deleted account) · '}
                  attempt {row.attemptCount}/{row.maxAttempts} · created {formatIncidentAge(nowMs, row.createdAt)} ago
                </p>
              </div>
              <StatusPill tone="attention">failed</StatusPill>
            </div>
            {row.lastError && <p className="mt-2 text-xs text-rose-300/90">Error: {row.lastError}</p>}
          </RowCard>
        ))}
      </SectionShell>

      <SectionShell
        title="Pending billing jobs stuck over an hour"
        description="Still 'pending' more than an hour after being enqueued — the worker isn't claiming it."
        icon={Hourglass}
        section={data.stalePendingBillingJobs}
        healthyLabel="No billing jobs stuck pending."
      >
        {data.stalePendingBillingJobs.rows.map((row) => (
          <RowCard key={row.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-neutral-100">
                  {row.kind} <span className="text-neutral-500">({shortId(row.id)})</span>
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  {row.userId ? <>User {shortId(row.userId)} · </> : 'No owner (deleted account) · '}
                  attempt {row.attemptCount} · created {formatIncidentAge(nowMs, row.createdAt)} ago
                </p>
              </div>
              <StatusPill tone="attention">pending</StatusPill>
            </div>
          </RowCard>
        ))}
      </SectionShell>

      <SectionShell
        title="Refunds pending over 24h"
        description="Refunds Razorpay hasn't confirmed processed or failed within a day of being initiated."
        icon={FileWarning}
        section={data.stalePendingRefunds}
        healthyLabel="No refunds stuck pending."
      >
        {data.stalePendingRefunds.rows.map((row) => (
          <RowCard key={row.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-neutral-100">Refund {shortId(row.id)}</p>
                <p className="mt-1 text-xs text-neutral-500">
                  {row.subjectRef ? <>Account {shortId(row.subjectRef)} · </> : ''}
                  {formatAmount(row.amountMinor, row.currencyCode)} · initiated {row.initiatedBy ?? 'unknown'} · created{' '}
                  {formatIncidentAge(nowMs, row.createdAt)} ago
                </p>
              </div>
              <StatusPill tone="attention">pending</StatusPill>
            </div>
            {row.paymentId && (
              <p className="mt-2 text-xs text-neutral-500">
                <FieldLabel>Payment</FieldLabel> {shortId(row.paymentId)}
              </p>
            )}
          </RowCard>
        ))}
      </SectionShell>

      <SectionShell
        title="Captured payments with no issued invoice"
        description="Captured since the billing switches went on, with no issued tax invoice for that payment."
        icon={FileWarning}
        section={data.paymentsMissingInvoice}
        healthyLabel="Every captured payment since the switches went on has an issued invoice."
      >
        {data.paymentsMissingInvoice.rows.map((row) => (
          <RowCard key={row.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-neutral-100">Payment {shortId(row.id)}</p>
                <p className="mt-1 text-xs text-neutral-500">
                  {row.userId ? <>User {shortId(row.userId)} · </> : 'No owner (deleted account) · '}
                  {formatAmount(row.amountMinor, row.currencyCode)} · captured {formatIncidentAge(nowMs, row.capturedAt)} ago
                </p>
              </div>
              <StatusPill tone="attention">no invoice</StatusPill>
            </div>
          </RowCard>
        ))}
      </SectionShell>
    </div>
  );
}
