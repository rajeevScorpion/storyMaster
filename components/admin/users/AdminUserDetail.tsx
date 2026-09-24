'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Ban,
  BookOpen,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Coins,
  CreditCard,
  Download,
  Eye,
  ExternalLink,
  FileText,
  Film,
  Gift,
  GitBranch,
  Landmark,
  Loader2,
  Mail,
  MoreVertical,
  RefreshCw,
  Repeat,
  RotateCcw,
  RotateCw,
  Send,
  ShieldAlert,
  ShoppingCart,
  Undo2,
  WalletCards,
  Webhook,
  XCircle,
} from 'lucide-react';
import {
  grantAdminUserCoins,
  updateAdminUserModeration,
} from '@/app/actions/admin-users';
import {
  cancelBillingSubscriptionAtCycleEndSettled,
  refundBillingPaymentSettled,
  reprocessBillingWebhookEventByIdSettled,
  resyncBillingSubscriptionFromProviderSettled,
  resyncBillingTopupFromProviderSettled,
} from '@/app/actions/admin-billing-ui-actions';
import {
  resendBillingDocumentSettled,
  retryBillingJobSettled,
} from '@/app/actions/admin-billing-jobs';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { isCurrentCycleSubscriptionPayment } from '@/lib/billing/subscription-refund-end.shared';
import RowActionsMenu, { type RowAction } from '@/components/ui/RowActionsMenu';
import { formatCurrencyMinor } from '@/lib/billing/wallet-tax.shared';
import {
  formatMoneyMinorForConfirmation,
  matchTopupGrantForRefund,
  unwrapAdminBillingActionResult as unwrap,
} from '@/lib/admin/billing-admin-ui.shared';
import { paginateAdminTableRows } from '@/lib/admin/table-pagination.shared';
import {
  describeBillingEmailStatus,
  describeBillingJobKind,
  describeBillingSectionState,
  type AdminAccountStatus,
  type AdminBillingDocument,
  type AdminBillingNotificationJob,
  type AdminBillingOrder,
  type AdminBillingPayment,
  type AdminBillingProfile,
  type AdminBillingRefund,
  beatsToCoins,
  type AdminBillingSectionKey,
  type AdminBillingSectionStatus,
  type AdminBillingSubscription,
  type AdminBillingWebhookEvent,
  type AdminUserDetailData,
} from '@/lib/admin/user-management.shared';
import type { AdminWatchQuotaWhy } from '@/lib/pricing/watch-quota-admin.shared';
import UserAvatar from './UserAvatar';
import {
  StatusBadge,
  formatCoins,
  formatDate,
  formatDateTime,
} from './AdminUserDirectory';

type ModerationMode = 'suspend' | 'block' | 'activate';

const JUMP_LINKS: { href: string; label: string }[] = [
  { href: '#account', label: 'Account & coins' },
  { href: '#activity', label: 'Activity' },
  { href: '#stories', label: 'Stories & reels' },
  { href: '#watch-quota', label: 'Watch quota' },
  { href: '#billing', label: 'Billing' },
];

/** One dialog state doubles for all five Unit C actions -- ConfirmDialog is generic enough that the
 * only per-kind differences are the copy and whether a reason/request key applies (refund, cancel). */
type BillingDialogState =
  | { kind: 'refund'; payment: AdminBillingPayment }
  | { kind: 'cancel'; subscription: AdminBillingSubscription }
  | { kind: 'resyncSubscription'; subscription: AdminBillingSubscription }
  | { kind: 'resyncTopup'; order: AdminBillingOrder }
  | { kind: 'reprocess'; event: AdminBillingWebhookEvent }
  | { kind: 'retryJob'; job: AdminBillingNotificationJob }
  | { kind: 'resendDocument'; document: AdminBillingDocument };

export default function AdminUserDetail({
  initialData,
  billingActionsEnabled,
}: {
  initialData: AdminUserDetailData;
  billingActionsEnabled: boolean;
}) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  // The moderation/grant flows below update `data` directly from their own action's return value
  // (the full detail), so they never touch this. The billing actions' server responses are narrow
  // (a refund amount, a resync count) -- not the full record -- so those instead call
  // router.refresh(). A useState's initial value is only read once at mount, so without this effect
  // a refresh would re-run the server component but leave this row data stale on screen.
  useEffect(() => {
    setData(initialData);
  }, [initialData]);
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

  const [billingDialog, setBillingDialog] = useState<BillingDialogState | null>(null);
  const [billingRequestKey, setBillingRequestKey] = useState('');
  const [billingReason, setBillingReason] = useState('');
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingDialogError, setBillingDialogError] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const user = data.user;
  const parsedGrantCoins = Number(grantCoins);
  const projectedBalance = Number.isFinite(parsedGrantCoins)
    ? user.availableCoins + parsedGrantCoins
    : user.availableCoins;

  function openBillingDialog(dialog: BillingDialogState) {
    setBillingDialog(dialog);
    // Generated once per open, then reused for every retry of this same dialog -- a double click or
    // a retry after a transient failure replays the same attempt instead of refunding/cancelling
    // twice. Opening the dialog again (even for the same row) gets a fresh key.
    setBillingRequestKey(`manual:${crypto.randomUUID()}`);
    setBillingReason('');
    setBillingDialogError(null);
  }

  function closeBillingDialog() {
    if (billingBusy) return;
    setBillingDialog(null);
    setBillingRequestKey('');
    setBillingReason('');
    setBillingDialogError(null);
  }

  async function executeBillingDialog() {
    if (!billingDialog) return;
    setBillingBusy(true);
    setBillingDialogError(null);
    try {
      let successMessage: string;
      switch (billingDialog.kind) {
        case 'refund': {
          const payment = billingDialog.payment;
          const result = unwrap(await refundBillingPaymentSettled({
            paymentId: payment.id,
            reason: billingReason,
            requestKey: billingRequestKey,
          }));
          const amount = formatMoneyMinorForConfirmation(payment.currencyCode, result.refundedAmountMinor);
          // Decision 15: a full refund of the current cycle ends the subscription -- separate from
          // whether the refund itself succeeded, so a cancel failure here is never reported as the
          // refund failing.
          const subscriptionNote = result.subscriptionEnded
            ? ' The subscription was also ended immediately.'
            : result.subscriptionEndError
              ? ' Ending the subscription failed -- cancel it manually.'
              : result.subscriptionEndPending
                ? ' Razorpay has the refund as pending; the subscription ends when it confirms.'
                : '';
          successMessage = (result.alreadyApplied
            ? `This refund had already been applied -- no duplicate refund was issued (${amount} · ${formatCoins(beatsToCoins(result.beatsClawedBack))} coins clawed back).`
            : `Refunded ${amount} · ${formatCoins(beatsToCoins(result.beatsClawedBack))} coins clawed back.`) + subscriptionNote;
          break;
        }
        case 'cancel': {
          const result = unwrap(await cancelBillingSubscriptionAtCycleEndSettled({
            subscriptionId: billingDialog.subscription.id,
            reason: billingReason,
            requestKey: billingRequestKey,
          }));
          successMessage = result.alreadyApplied
            ? 'This cancellation had already been applied.'
            : `This subscription will stop renewing at the end of the current cycle (status: ${result.status}).`;
          break;
        }
        case 'resyncSubscription': {
          const result = unwrap(await resyncBillingSubscriptionFromProviderSettled({
            providerSubscriptionId: billingDialog.subscription.providerSubscriptionId ?? '',
          }));
          successMessage = `Re-synced from Razorpay -- status: ${result.subscriptionStatus}${
            result.grantedCoins > 0 ? ` · ${formatCoins(result.grantedCoins)} coins granted` : ''
          }.`;
          break;
        }
        case 'resyncTopup': {
          const result = unwrap(await resyncBillingTopupFromProviderSettled({ billingOrderId: billingDialog.order.id }));
          successMessage = result.grantedCoins > 0
            ? `Re-synced from Razorpay -- ${formatCoins(result.grantedCoins)} coins granted.`
            : 'Re-synced from Razorpay -- nothing new to grant.';
          break;
        }
        case 'reprocess': {
          const result = unwrap(await reprocessBillingWebhookEventByIdSettled({ eventId: billingDialog.event.id }));
          successMessage = `Reprocessed -- status: ${result.status}${result.outcome ? ` · outcome: ${result.outcome}` : ''}.`;
          break;
        }
        case 'retryJob': {
          unwrap(await retryBillingJobSettled({ jobId: billingDialog.job.id }));
          successMessage = 'The billing email job was reset to pending and the worker was kicked.';
          break;
        }
        case 'resendDocument': {
          unwrap(await resendBillingDocumentSettled({ documentId: billingDialog.document.id }));
          successMessage = 'A resend of this document was queued.';
          break;
        }
      }
      setError(null);
      setNotice(successMessage);
      setBillingDialog(null);
      setBillingRequestKey('');
      setBillingReason('');
      router.refresh();
    } catch (actionError) {
      setBillingDialogError(actionError instanceof Error ? actionError.message : 'This action failed.');
    } finally {
      setBillingBusy(false);
    }
  }

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

  const billingDialogMeta = useMemo(() => {
    if (!billingDialog) return null;
    if (billingDialog.kind === 'refund') {
      const payment = billingDialog.payment;
      const grantMatch = matchTopupGrantForRefund(
        { kind: payment.kind, billingOrderId: payment.billingOrderId },
        data.walletActivity
      );
      return {
        title: 'Refund payment',
        tone: 'danger' as const,
        confirmLabel: 'Refund',
        requiresReason: true,
        lines: [
          `Refunding ${formatMoneyMinorForConfirmation(payment.currencyCode, payment.grossMinor)} in full -- this action only issues full refunds.`,
          grantMatch
            ? `${formatCoins(grantMatch.remainingCoins)} of ${formatCoins(grantMatch.totalCoins)} coins from this purchase are still unspent -- ${formatCoins(grantMatch.remainingCoins)} will be removed. Coins already spent are not recoverable.`
            : "This purchase's unspent coins will be removed first; coins already spent are not recoverable.",
          "Refused if too much of this purchase's coins have already been spent.",
          // Decision 15: only a refund of the cycle presently paid for ends the subscription.
          ...(isCurrentCycleSubscriptionPayment({ kind: payment.kind, cycleEnd: payment.cycleEnd })
            ? ['This also ends the subscription immediately.']
            : []),
        ],
      };
    }
    if (billingDialog.kind === 'cancel') {
      return {
        title: 'Cancel at cycle end',
        tone: 'danger' as const,
        confirmLabel: 'Cancel at cycle end',
        requiresReason: true,
        lines: ['Renewal stops; the user keeps access until the end of the current billing period.'],
      };
    }
    if (billingDialog.kind === 'resyncSubscription') {
      return {
        title: 'Re-sync subscription',
        tone: 'default' as const,
        confirmLabel: 'Re-sync',
        requiresReason: false,
        lines: ["Re-runs the same idempotent reconcile the daily cron uses for this subscription."],
      };
    }
    if (billingDialog.kind === 'resyncTopup') {
      return {
        title: 'Re-sync top-up order',
        tone: 'default' as const,
        confirmLabel: 'Re-sync',
        requiresReason: false,
        lines: ['Re-runs the same idempotent reconcile the daily cron uses for this order.'],
      };
    }
    if (billingDialog.kind === 'reprocess') {
      return {
        title: 'Reprocess webhook event',
        tone: 'default' as const,
        confirmLabel: 'Reprocess',
        requiresReason: false,
        lines: [
          'Re-runs this webhook event through the same handler live traffic uses.',
          'Safe to repeat: a payment, grant or refund already recorded is not recorded again. A full refund of a current-cycle subscription payment ends that subscription.',
        ],
      };
    }
    if (billingDialog.kind === 'retryJob') {
      return {
        title: 'Retry billing email',
        tone: 'default' as const,
        confirmLabel: 'Retry',
        requiresReason: false,
        lines: [
          `Resets this "${describeBillingJobKind(billingDialog.job.kind)}" job to pending and kicks the worker to run it again now.`,
        ],
      };
    }
    return {
      title: 'Resend document email',
      tone: 'default' as const,
      confirmLabel: 'Resend',
      requiresReason: false,
      lines: ['Queues a fresh email for this document, with the PDF attached again.'],
    };
  }, [billingDialog, data.walletActivity]);

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

      <nav aria-label="Jump to section" className="flex flex-wrap gap-2">
        {JUMP_LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-neutral-400 transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-200"
          >
            {link.label}
          </a>
        ))}
      </nav>

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

      <section id="account" className="grid scroll-mt-6 gap-4 xl:grid-cols-2">
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

      <section id="activity" className="grid scroll-mt-6 gap-4 xl:grid-cols-2">
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

      <TimelineCard id="stories" title="Recent stories and reels" icon={BookOpen}>
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

      <TimelineCard id="watch-quota" title="Watch quota" icon={Eye}>
        {data.watchQuota.status === 'unavailable' ? (
          <EmptyText>
            <span className="inline-flex items-center gap-1.5 text-amber-400/70">
              <AlertTriangle className="h-3.5 w-3.5" />
              {data.watchQuota.unavailableReason === 'pricing_state'
                ? 'Could not be read -- this account’s pricing state failed to load, so whether a limit applies is unknown. Treat this as a live problem, not a missing migration.'
                : 'Not available on this environment yet -- the watch-quota migration (129) has not been applied here.'}
            </span>
          </EmptyText>
        ) : (
          <div className="space-y-4">
            <p className="rounded-xl border border-white/10 bg-neutral-950/40 p-3 text-sm text-neutral-300">
              {describeWatchQuotaWhy(data.watchQuota.why)}
            </p>
            <p className="text-xs text-neutral-500">
              Reporting IST day <span className="text-neutral-300">{data.watchQuota.istDay.localDay}</span>
              {' '}&mdash; rolls over at {formatDateTime(data.watchQuota.istDay.rollsOverAtUtc)}.
            </p>

            <div>
              <h3 className="text-xs uppercase tracking-[0.12em] text-neutral-600">Opened today</h3>
              {data.watchQuota.todaySlots.length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {data.watchQuota.todaySlots.map((slot) => (
                    <li key={slot.storylineId} className="flex items-center justify-between gap-4 text-sm">
                      <span className="truncate text-neutral-300">
                        {slot.storylineTitle ?? slot.storylineId}
                      </span>
                      <span className="shrink-0 text-xs text-neutral-600">
                        {formatDateTime(slot.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-neutral-600">Nothing opened yet today.</p>
              )}
            </div>

            <div>
              <h3 className="text-xs uppercase tracking-[0.12em] text-neutral-600">
                Last {data.watchQuota.recentDayCounts.length} IST days
              </h3>
              <div className="mt-2 grid grid-cols-7 gap-1.5">
                {data.watchQuota.recentDayCounts.map((day) => (
                  <div
                    key={day.localDay}
                    className="rounded-lg border border-white/10 bg-neutral-950/40 px-1.5 py-1.5 text-center"
                  >
                    <p className="text-[10px] text-neutral-600">{day.localDay.slice(5)}</p>
                    <p className="text-sm font-medium text-neutral-200">{day.count}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </TimelineCard>

      <div id="billing" className="scroll-mt-6">
        <h2 className="text-lg font-serif text-neutral-100">Billing</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Read-only tables below survive their migration not being applied on this environment yet --
          a section renders &ldquo;not available&rdquo; rather than breaking the page. Refund, cancel,
          re-sync and reprocess actions live in each row&apos;s <MoreVertical className="inline h-3.5 w-3.5" /> menu.
        </p>
      </div>

      {!billingActionsEnabled && (
        <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-neutral-400">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
          <p>
            Admin money actions (refund, cancel, re-sync, reprocess) are switched off. Turn them on at{' '}
            <Link
              href="/admin/settings/billing-operations"
              className="text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
            >
              /admin/settings/billing-operations
            </Link>
            . The menu items below still show what would be available.
          </p>
        </div>
      )}

      {data.billing.planKeyCheck.mismatched && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Plan key disagreement: the user directory reports{' '}
            <span className="font-medium capitalize">{data.billing.planKeyCheck.rpcPlanKey}</span>, but this
            account&apos;s own subscription records imply{' '}
            <span className="font-medium capitalize">{data.billing.planKeyCheck.subscriptionPlanKey}</span>.
            Worth investigating directly rather than assuming either side is right.
          </p>
        </div>
      )}

      <section className="grid gap-4 xl:grid-cols-2">
        <BillingListSection<AdminBillingSubscription>
          title="Subscription"
          icon={Repeat}
          sectionKey="subscriptions"
          status={data.billing.subscriptions.status}
          items={data.billing.subscriptions.items}
          headerCells={['Status', 'Plan', 'Interval', 'Period end', 'Cancel at end', 'Provider', '']}
          renderRow={(subscription) => {
            const eligible = subscription.status === 'active' && !subscription.cancelAtPeriodEnd;
            const actions: RowAction[] = eligible
              ? [
                  {
                    key: 'cancel',
                    label: 'Cancel at cycle end…',
                    icon: XCircle,
                    tone: 'danger',
                    disabled: !billingActionsEnabled,
                    onSelect: () => openBillingDialog({ kind: 'cancel', subscription }),
                  },
                  {
                    key: 'resync',
                    label: 'Re-sync from Razorpay',
                    icon: RefreshCw,
                    disabled: !billingActionsEnabled || !subscription.providerSubscriptionId,
                    onSelect: () => openBillingDialog({ kind: 'resyncSubscription', subscription }),
                  },
                ]
              : [];
            return (
              <tr key={subscription.id} className="border-b border-white/5 last:border-0">
                <td className="py-3 pr-4 capitalize text-neutral-200">{subscription.status}</td>
                <td className="px-4 py-3 capitalize text-neutral-400">{subscription.planKey ?? '—'}</td>
                <td className="px-4 py-3 capitalize text-neutral-500">{subscription.billingInterval ?? '—'}</td>
                <td className="px-4 py-3 text-neutral-500">
                  {subscription.currentPeriodEnd ? formatDateTime(subscription.currentPeriodEnd) : '—'}
                </td>
                <td className="px-4 py-3 text-neutral-500">{subscription.cancelAtPeriodEnd ? 'Yes' : 'No'}</td>
                <td className="px-4 py-3 text-neutral-500">
                  {subscription.provider}
                  {subscription.providerMode ? ` · ${subscription.providerMode}` : ''}
                </td>
                <td className="py-3 pl-4 text-right">
                  <RowActionsMenu ariaLabel={`Billing actions for subscription ${subscription.id}`} actions={actions} />
                </td>
              </tr>
            );
          }}
        />

        <BillingListSection<AdminBillingOrder>
          title="Orders"
          icon={ShoppingCart}
          sectionKey="orders"
          status={data.billing.orders.status}
          items={data.billing.orders.items}
          headerCells={['Type', 'Amount', 'Status', 'Provider', 'Created', '']}
          renderRow={(order) => {
            const actions: RowAction[] = order.orderType === 'topup_checkout'
              ? [
                  {
                    key: 'resync',
                    label: 'Re-sync from Razorpay',
                    icon: RefreshCw,
                    disabled: !billingActionsEnabled,
                    onSelect: () => openBillingDialog({ kind: 'resyncTopup', order }),
                  },
                ]
              : [];
            return (
              <tr key={order.id} className="border-b border-white/5 last:border-0">
                <td className="py-3 pr-4 text-neutral-200">{order.orderType.replaceAll('_', ' ')}</td>
                <td className="px-4 py-3 text-neutral-300">{formatCurrencyMinor(order.currencyCode, order.amountMinor)}</td>
                <td className="px-4 py-3 capitalize text-neutral-500">{order.status}</td>
                <td className="px-4 py-3 text-neutral-500">
                  {order.provider}
                  {order.providerMode ? ` · ${order.providerMode}` : ''}
                </td>
                <td className="px-4 py-3 text-neutral-500">{formatDate(order.createdAt)}</td>
                <td className="py-3 pl-4 text-right">
                  <RowActionsMenu ariaLabel={`Billing actions for order ${order.id}`} actions={actions} />
                </td>
              </tr>
            );
          }}
        />

        <BillingListSection<AdminBillingPayment>
          title="Payments"
          icon={CreditCard}
          sectionKey="payments"
          status={data.billing.payments.status}
          items={data.billing.payments.items}
          headerCells={['Kind', 'Gross', 'Method', 'Status', 'Captured', '']}
          renderRow={(payment) => {
            const actions: RowAction[] = payment.status === 'captured'
              ? [
                  {
                    key: 'refund',
                    label: 'Refund…',
                    icon: Undo2,
                    tone: 'danger',
                    disabled: !billingActionsEnabled,
                    onSelect: () => openBillingDialog({ kind: 'refund', payment }),
                  },
                ]
              : [];
            return (
              <tr key={payment.id} className="border-b border-white/5 last:border-0">
                <td className="py-3 pr-4 text-neutral-200">{payment.kind.replaceAll('_', ' ')}</td>
                <td className="px-4 py-3 text-neutral-300">{formatCurrencyMinor(payment.currencyCode, payment.grossMinor)}</td>
                <td className="px-4 py-3 capitalize text-neutral-500">{payment.methodCategory ?? 'unknown'}</td>
                <td className="px-4 py-3 capitalize text-neutral-500">{payment.status}</td>
                <td className="px-4 py-3 text-neutral-500">
                  {payment.capturedAt ? formatDate(payment.capturedAt) : '—'}
                </td>
                <td className="py-3 pl-4 text-right">
                  <RowActionsMenu ariaLabel={`Billing actions for payment ${payment.id}`} actions={actions} />
                </td>
              </tr>
            );
          }}
        />

        <BillingListSection<AdminBillingRefund>
          title="Refunds & disputes"
          icon={Undo2}
          sectionKey="refunds"
          status={data.billing.refunds.status}
          items={data.billing.refunds.items}
          headerCells={['Type', 'Amount', 'Status', 'Reason', 'Created']}
          renderRow={(refund) => (
            <tr key={refund.id} className="border-b border-white/5 last:border-0">
              <td className="py-3 pr-4 text-neutral-200">{refund.isDispute ? 'Dispute' : 'Refund'}</td>
              <td className="px-4 py-3 text-neutral-300">{formatCurrencyMinor(refund.currencyCode, refund.amountMinor)}</td>
              <td className="px-4 py-3 capitalize text-neutral-500">{refund.status}</td>
              <td className="max-w-[220px] truncate px-4 py-3 text-neutral-500">{refund.reason ?? '—'}</td>
              <td className="px-4 py-3 text-neutral-500">{formatDate(refund.createdAt)}</td>
            </tr>
          )}
        />

        <BillingListSection<AdminBillingDocument>
          title="Documents"
          icon={FileText}
          sectionKey="documents"
          status={data.billing.documents.status}
          items={data.billing.documents.items}
          headerCells={['Number', 'Type', 'Amount', 'Status', 'Issued', '']}
          renderRow={(doc) => {
            // Resend only makes sense for a document that was actually issued -- a void document
            // has nothing to re-email (plan §10 D: "Resend (each issued document on the page)").
            const actions: RowAction[] = doc.status === 'issued'
              ? [
                  {
                    key: 'resend',
                    label: 'Resend email…',
                    icon: Send,
                    onSelect: () => openBillingDialog({ kind: 'resendDocument', document: doc }),
                  },
                ]
              : [];
            return (
              <tr key={doc.id} className="border-b border-white/5 last:border-0">
                <td className="py-3 pr-4 text-neutral-200">{doc.documentNumber}</td>
                <td className="px-4 py-3 capitalize text-neutral-500">{doc.documentType.replaceAll('_', ' ')}</td>
                <td className="px-4 py-3 text-neutral-300">{formatCurrencyMinor(doc.currencyCode, doc.grossMinor)}</td>
                <td className="px-4 py-3 capitalize text-neutral-500">{doc.status}</td>
                <td className="px-4 py-3 text-neutral-500">{formatDate(doc.issuedAt)}</td>
                <td className="py-3 pl-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <a
                      href={`/api/billing/documents/${doc.id}/pdf`}
                      download
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-neutral-300 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-neutral-100"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </a>
                    <RowActionsMenu ariaLabel={`Billing actions for document ${doc.documentNumber}`} actions={actions} />
                  </div>
                </td>
              </tr>
            );
          }}
        />

        <BillingProfileCard status={data.billing.profile.status} profile={data.billing.profile.profile} />

        <BillingListSection<AdminBillingNotificationJob>
          title="Billing emails"
          icon={Mail}
          sectionKey="notificationJobs"
          status={data.billing.notificationJobs.status}
          items={data.billing.notificationJobs.items}
          headerCells={['Kind', 'Status', 'Email', 'Document', 'Error', 'Created', '']}
          renderRow={(job) => {
            // Retry only makes sense once a job has actually failed -- a pending/processing/done job
            // has nothing to retry (plan §10 D: "Retry (failed jobs only)").
            const actions: RowAction[] = job.status === 'failed'
              ? [
                  {
                    key: 'retry',
                    label: 'Retry',
                    icon: RotateCw,
                    onSelect: () => openBillingDialog({ kind: 'retryJob', job }),
                  },
                ]
              : [];
            return (
              <tr key={job.id} className="border-b border-white/5 last:border-0">
                <td className="py-3 pr-4 text-neutral-200">{describeBillingJobKind(job.kind)}</td>
                <td className="px-4 py-3 capitalize text-neutral-500">{job.status}</td>
                <td className="px-4 py-3 text-neutral-500">{describeBillingEmailStatus(job.emailStatus)}</td>
                <td className="px-4 py-3 capitalize text-neutral-500">{job.documentOutcome?.replaceAll('_', ' ') ?? '—'}</td>
                <td className="max-w-[200px] truncate px-4 py-3 text-neutral-500" title={job.lastError ?? undefined}>
                  {job.lastError ?? '—'}
                </td>
                <td className="px-4 py-3 text-neutral-500">{formatDateTime(job.createdAt)}</td>
                <td className="py-3 pl-4 text-right">
                  <RowActionsMenu ariaLabel={`Billing actions for job ${job.id}`} actions={actions} />
                </td>
              </tr>
            );
          }}
        />

        <BillingListSection<AdminBillingWebhookEvent>
          title="Webhook events"
          icon={Webhook}
          sectionKey="webhookEvents"
          status={data.billing.webhookEvents.status}
          items={data.billing.webhookEvents.items}
          headerCells={['Event', 'Status', 'Outcome', 'Attempts', 'Received', '']}
          renderRow={(event) => {
            // Offered on every event, not only failed ones: processing is idempotent, and re-running a
            // processed event is how a rule added after it arrived (e.g. decision 15) gets applied.
            const actions: RowAction[] = [
              {
                key: 'reprocess',
                label: event.status === 'failed' || event.status === 'received' ? 'Reprocess' : 'Re-run',
                icon: RotateCw,
                disabled: !billingActionsEnabled,
                onSelect: () => openBillingDialog({ kind: 'reprocess', event }),
              },
            ];
            return (
              <tr key={event.id} className="border-b border-white/5 last:border-0">
                <td className="max-w-[220px] truncate py-3 pr-4 text-neutral-200">{event.eventType}</td>
                <td className="px-4 py-3 capitalize text-neutral-500">{event.status}</td>
                <td className="px-4 py-3 capitalize text-neutral-500">{event.outcome ?? '—'}</td>
                <td className="px-4 py-3 text-neutral-500">{event.attemptCount ?? '—'}</td>
                <td className="px-4 py-3 text-neutral-500">{formatDateTime(event.receivedAt)}</td>
                <td className="py-3 pl-4 text-right">
                  <RowActionsMenu ariaLabel={`Billing actions for webhook event ${event.id}`} actions={actions} />
                </td>
              </tr>
            );
          }}
        />
      </section>

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

      <ConfirmDialog
        open={billingDialog !== null}
        title={billingDialogMeta?.title ?? 'Confirm'}
        tone={billingDialogMeta?.tone ?? 'default'}
        confirmLabel={billingDialogMeta?.confirmLabel ?? 'Confirm'}
        busy={billingBusy}
        confirmDisabled={
          billingDialogMeta?.requiresReason
            ? billingReason.trim().length < 3 || billingReason.trim().length > 500
            : false
        }
        onCancel={closeBillingDialog}
        onConfirm={executeBillingDialog}
        message={
          <div className="space-y-3">
            {billingDialogMeta?.lines.map((line) => <p key={line}>{line}</p>)}
            {billingDialogMeta?.requiresReason && (
              <label className="block">
                <span className="mb-1.5 block text-xs uppercase tracking-[0.12em] text-neutral-500">Reason</span>
                <textarea
                  value={billingReason}
                  onChange={(event) => setBillingReason(event.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Required for the audit trail"
                  className={`${INPUT_CLASS} resize-none`}
                />
              </label>
            )}
            {billingDialogError && (
              <p className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                {billingDialogError}
              </p>
            )}
          </div>
        }
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
  id,
  children,
}: {
  title: string;
  icon: typeof BookOpen;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <article id={id} className={`rounded-2xl border border-white/10 bg-white/[0.035] p-5${id ? ' scroll-mt-6' : ''}`}>
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

function BillingSectionEmptyState({
  state,
}: {
  state: ReturnType<typeof describeBillingSectionState>;
}) {
  if (state.kind === 'unavailable') {
    return (
      <EmptyText>
        <span className="inline-flex items-center gap-1.5 text-amber-400/70">
          <AlertTriangle className="h-3.5 w-3.5" />
          {state.message}
        </span>
      </EmptyText>
    );
  }
  return <EmptyText>{state.message}</EmptyText>;
}

function BillingListSection<T>({
  title,
  icon: Icon,
  sectionKey,
  status,
  items,
  headerCells,
  renderRow,
}: {
  title: string;
  icon: typeof WalletCards;
  sectionKey: AdminBillingSectionKey;
  status: AdminBillingSectionStatus;
  items: T[];
  headerCells: string[];
  renderRow: (item: T) => React.ReactNode;
}) {
  const state = describeBillingSectionState(sectionKey, status, items.length);
  const [page, setPage] = useState(1);
  // A refund/cancel/re-sync/reprocess action calls router.refresh() rather than patching this
  // row in place, which hands `items` down as a new array -- reset to page 1 so a stale page
  // number from a longer previous result set never renders an empty table. Adjusted during render
  // (React's documented pattern for "state that depends on a prop"), not an effect -- an effect's
  // setState here is exactly what react-hooks/set-state-in-effect rejects.
  const [prevItems, setPrevItems] = useState(items);
  if (items !== prevItems) {
    setPrevItems(items);
    setPage(1);
  }
  const paged = paginateAdminTableRows(items, page);

  return (
    <TimelineCard title={title} icon={Icon}>
      {state.kind === 'has_data' ? (
        <>
          <div className="admin-table-scroll max-h-[420px] overflow-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="sticky top-0 z-10 border-b border-white/10 bg-neutral-950 text-left text-xs uppercase tracking-[0.12em] text-neutral-600">
                  {headerCells.map((cell, index) => (
                    <th key={cell} className={index === 0 ? 'py-3 pr-4 font-medium' : 'px-4 py-3 font-medium'}>
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>{paged.rows.map(renderRow)}</tbody>
            </table>
          </div>
          <TablePager
            page={paged.page}
            pageCount={paged.pageCount}
            rangeStart={paged.rangeStart}
            rangeEnd={paged.rangeEnd}
            totalCount={paged.totalCount}
            onPageChange={setPage}
          />
        </>
      ) : (
        <BillingSectionEmptyState state={state} />
      )}
    </TimelineCard>
  );
}

/** Compact "‹ Prev · 1–10 of 23 · Next ›" footer for a BillingListSection table. Hidden entirely
 * when everything fits on one page -- pageCount is always >= 1, so this is the only check needed. */
function TablePager({
  page,
  pageCount,
  rangeStart,
  rangeEnd,
  totalCount,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  rangeStart: number;
  rangeEnd: number;
  totalCount: number;
  onPageChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  const pagerButtonClass = 'rounded-full border border-white/10 bg-white/5 px-3 py-1 text-neutral-400 transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-200 disabled:pointer-events-none disabled:opacity-30';
  return (
    <div className="mt-3 flex items-center justify-end gap-3 border-t border-white/5 pt-3 text-xs text-neutral-500">
      <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} className={pagerButtonClass}>
        ‹ Prev
      </button>
      <span>
        {rangeStart}–{rangeEnd} of {totalCount}
      </span>
      <button
        type="button"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
        className={pagerButtonClass}
      >
        Next ›
      </button>
    </div>
  );
}

function BillingProfileCard({
  status,
  profile,
}: {
  status: AdminBillingSectionStatus;
  profile: AdminBillingProfile | null;
}) {
  const state = describeBillingSectionState('profile', status, profile ? 1 : 0);
  const address = profile
    ? [profile.addressLine1, profile.addressLine2, profile.city, profile.postalCode, profile.countryCode]
      .filter(Boolean)
      .join(', ')
    : '';

  return (
    <TimelineCard title="Billing profile" icon={Landmark}>
      {state.kind === 'has_data' && profile ? (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <ProfileField label="Legal name" value={profile.legalName} />
          <ProfileField label="Company" value={profile.companyName} />
          <ProfileField label="Billing email" value={profile.billingEmail} />
          <ProfileField label="Phone" value={profile.phone} />
          <ProfileField label="GSTIN" value={profile.gstin} />
          <ProfileField label="State code" value={profile.stateCode} />
          <ProfileField label="Address" value={address || null} />
        </dl>
      ) : (
        <BillingSectionEmptyState state={state} />
      )}
    </TimelineCard>
  );
}

function ProfileField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.12em] text-neutral-600">{label}</dt>
      <dd className="mt-1 text-sm text-neutral-300">{value ?? '—'}</dd>
    </div>
  );
}

function describeWatchQuotaWhy(why: AdminWatchQuotaWhy | null): string {
  if (!why) return '';
  if (why.reason === 'admin_account') {
    return 'This is the admin account -- never metered, and no ledger row is ever written for it.';
  }
  if (why.reason === 'unlimited_plan') {
    return `This account's plan (${why.planKey}) grants unlimited watching -- no daily limit applies.`;
  }
  return `A daily limit of ${why.limit} applies. Used ${why.used} today; ${why.remaining} remaining.`;
}

function auditLabel(actionType: string): string {
  const labels: Record<string, string> = {
    account_suspended: 'Account suspended',
    account_blocked: 'Account blocked',
    account_reactivated: 'Account access restored',
    coins_granted: 'Coins granted',
    entitlement_tier_changed: 'Access tier changed',
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
