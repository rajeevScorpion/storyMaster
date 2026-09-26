import { formatBillingDateShort } from '@/lib/billing/billing-dates.shared';
import { formatCurrencyMinor } from '@/lib/billing/wallet-tax.shared';
import {
  COINS_PER_BEAT,
  type PricingWalletActivityItem,
  type WalletActivityCursor,
  type WalletActivityPage,
} from '@/lib/types/pricing';

/**
 * The wallet's "Recent activity": every coin in and out, plus changes to the plan. Each source maps to
 * items here; the server loader (wallet-activity.ts) only fetches rows.
 */

export const WALLET_ACTIVITY_PAGE_SIZE = 5;

export interface ActivityGrantRow {
  id: string;
  source_type: string;
  beats_total: number | string;
  beats_remaining: number | string;
  granted_at: string;
  expires_at: string | null;
}

export interface ActivitySpendRow {
  id: string;
  action_key: string;
  beat_cost: number | string;
  created_at: string;
}

export interface ActivityPaymentRow {
  id: string;
  kind: string;
  status: string;
  gross_minor: number;
  currency_code: string;
  plan_version_id: string | null;
  purchase_snapshot_json: unknown;
  captured_at: string | null;
  created_at: string;
}

export interface ActivityRefundRow {
  id: string;
  payment_id: string | null;
  amount_minor: number;
  currency_code: string;
  status: string;
  coin_adjustment_json: unknown;
  processed_at: string | null;
  created_at: string;
}

export interface ActivitySubscriptionRow {
  id: string;
  plan_version_id: string;
  status: string;
  cancel_requested_at: string | null;
  current_period_end: string | null;
  first_charge_confirmed_at: string | null;
  updated_at: string;
}

export interface ActivitySources {
  grants: ActivityGrantRow[];
  expiredGrants: ActivityGrantRow[];
  spends: ActivitySpendRow[];
  payments: ActivityPaymentRow[];
  refunds: ActivityRefundRow[];
  subscriptions: ActivitySubscriptionRow[];
  planNamesByVersionId: Record<string, string>;
}

const ENDED_SUBSCRIPTION_STATUSES = new Set(['cancelled', 'completed', 'expired', 'halted']);

function beatsToCoins(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number(((Number.isFinite(parsed) ? parsed : 0) * COINS_PER_BEAT).toFixed(2));
}

function timeMs(value: string): number {
  return new Date(value).getTime();
}

export function getGrantTitle(sourceType: string): string {
  switch (sourceType) {
    case 'free_allowance':
    case 'migration_grant':
      return 'Welcome coins added';
    case 'subscription':
    case 'carry_forward':
      return 'Monthly refill';
    case 'topup':
      return 'Top-up added';
    case 'promotion':
      return 'Bonus coins added';
    case 'admin_adjustment':
      return 'Coins adjusted';
    default:
      return 'Coins added';
  }
}

export function getGrantSubtitle(sourceType: string): string {
  switch (sourceType) {
    case 'free_allowance':
      return 'One-time credit for joining Kissago';
    case 'subscription':
      return 'Included with your active plan';
    case 'carry_forward':
      return 'Unused coins carried into the new period';
    case 'topup':
      return 'Purchased coin pack';
    case 'promotion':
      return 'Campaign or bonus reward';
    case 'migration_grant':
      return 'Internal rollout goodwill grant';
    case 'admin_adjustment':
      return 'Manual support adjustment';
    default:
      return 'Wallet credit';
  }
}

function getExpirySubtitle(sourceType: string): string {
  switch (sourceType) {
    case 'subscription':
    case 'carry_forward':
      return 'Unused plan coins lapsed at the end of the period';
    case 'free_allowance':
    case 'migration_grant':
      return 'Unused welcome coins lapsed';
    case 'promotion':
      return 'Unused bonus coins lapsed';
    default:
      return 'Unused coins lapsed';
  }
}

export function getSpendTitle(actionKey: string): string {
  switch (actionKey) {
    case 'start_story_initial_beat':
      return 'Started a story';
    case 'start_story_initial_beat_prompt_only':
      return 'Started a prompt-only story';
    case 'start_reel_full_generation':
      return 'Generated a reel';
    case 'start_reel_full_generation_prompt_only':
      return 'Generated a prompt-only reel';
    case 'continue_story_new_beat':
      return 'Added a new beat';
    case 'continue_story_new_beat_prompt_only':
      return 'Added a prompt-only beat';
    case 'preview_seed_plan':
      return 'Previewed a seed plan';
    case 'regenerate_image':
      return 'Regenerated an image';
    case 'regenerate_narration':
      return 'Regenerated narration';
    case 'generate_social_share_cover':
      return 'Generated a share cover';
    case 'generate_audio_story_cover':
      return 'Generated an audio story cover';
    case 'generate_reel_thumbnail':
      return 'Generated a reel thumbnail';
    case 'export_video_future':
      return 'Exported a video';
    default:
      return 'Used coins in Kissago';
  }
}

function paymentPlanName(payment: ActivityPaymentRow, planNames: Record<string, string>): string {
  const snapshot = payment.purchase_snapshot_json as { planName?: unknown } | null;
  if (snapshot && typeof snapshot.planName === 'string' && snapshot.planName) return snapshot.planName;
  return (payment.plan_version_id && planNames[payment.plan_version_id]) || 'Your';
}

function planTitle(name: string, rest: string): string {
  return name === 'Your' ? `Your plan ${rest}` : `${name} plan ${rest}`;
}

function clawedBackBeats(adjustment: unknown): number {
  if (!adjustment || typeof adjustment !== 'object') return 0;
  const value = Number((adjustment as { beatsClawedBack?: unknown }).beatsClawedBack ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function buildWalletActivityItems(sources: ActivitySources): PricingWalletActivityItem[] {
  const items: PricingWalletActivityItem[] = [];
  const planNames = sources.planNamesByVersionId;

  for (const grant of sources.grants) {
    items.push({
      id: `grant:${grant.id}`,
      kind: 'grant',
      title: getGrantTitle(grant.source_type),
      subtitle: getGrantSubtitle(grant.source_type),
      coinsDelta: beatsToCoins(grant.beats_total),
      occurredAt: grant.granted_at,
    });
  }

  for (const grant of sources.expiredGrants) {
    const lapsed = beatsToCoins(grant.beats_remaining);
    if (!grant.expires_at || lapsed <= 0) continue;
    items.push({
      id: `expiry:${grant.id}`,
      kind: 'expiry',
      title: 'Coins expired',
      subtitle: getExpirySubtitle(grant.source_type),
      coinsDelta: -lapsed,
      occurredAt: grant.expires_at,
    });
  }

  for (const spend of sources.spends) {
    items.push({
      id: `spend:${spend.id}`,
      kind: 'spend',
      title: getSpendTitle(spend.action_key),
      subtitle: 'Used while creating in Kissago',
      coinsDelta: -beatsToCoins(spend.beat_cost),
      occurredAt: spend.created_at,
    });
  }

  const paymentsById = new Map(sources.payments.map((payment) => [payment.id, payment]));

  // Top-up payments are already shown by their "Top-up added" grant; only plan payments add a row.
  for (const payment of sources.payments) {
    if (payment.kind !== 'subscription_first' && payment.kind !== 'subscription_renewal') continue;
    const name = paymentPlanName(payment, planNames);
    const amount = formatCurrencyMinor(payment.currency_code, payment.gross_minor);

    if (payment.status === 'failed') {
      // A failed first charge is an abandoned checkout, not an event on a plan the customer had.
      if (payment.kind !== 'subscription_renewal') continue;
      items.push({
        id: `payment:${payment.id}`,
        kind: 'plan',
        title: 'Renewal payment failed',
        subtitle: `${amount} for ${name === 'Your' ? 'your plan' : `the ${name} plan`} didn't go through`,
        coinsDelta: null,
        occurredAt: payment.created_at,
      });
      continue;
    }

    items.push({
      id: `payment:${payment.id}`,
      kind: 'plan',
      title: planTitle(name, payment.kind === 'subscription_first' ? 'started' : 'renewed'),
      subtitle: `${amount} paid`,
      coinsDelta: null,
      occurredAt: payment.captured_at ?? payment.created_at,
    });
  }

  for (const refund of sources.refunds) {
    if (refund.status === 'failed') continue;
    const processed = refund.status === 'processed';
    const payment = refund.payment_id ? paymentsById.get(refund.payment_id) : undefined;
    const clawed = beatsToCoins(clawedBackBeats(refund.coin_adjustment_json));
    const amount = formatCurrencyMinor(refund.currency_code, refund.amount_minor);
    const what = !payment
      ? ''
      : payment.kind === 'topup'
        ? ' for a coin pack'
        : ` for the ${paymentPlanName(payment, planNames) === 'Your' ? 'plan' : `${paymentPlanName(payment, planNames)} plan`}`;

    items.push({
      id: `refund:${refund.id}`,
      kind: 'refund',
      title: processed ? 'Refund issued' : 'Refund in progress',
      subtitle: `${amount} ${processed ? 'refunded' : 'being refunded'}${what}${clawed > 0 ? '. Coins from it were removed' : ''}`,
      coinsDelta: clawed > 0 ? -clawed : null,
      occurredAt: refund.processed_at ?? refund.created_at,
    });
  }

  for (const subscription of sources.subscriptions) {
    // Never activated (an abandoned checkout): nothing ever began, so nothing ends either.
    if (!subscription.first_charge_confirmed_at) continue;
    const name = planNames[subscription.plan_version_id] ?? 'Your';

    if (subscription.cancel_requested_at) {
      const endsOn = formatBillingDateShort(subscription.current_period_end);
      items.push({
        id: `cancel:${subscription.id}`,
        kind: 'plan',
        title: 'Cancellation scheduled',
        subtitle: endsOn
          ? `${name === 'Your' ? 'Your plan' : `The ${name} plan`} stays active until ${endsOn}`
          : `${name === 'Your' ? 'Your plan' : `The ${name} plan`} ends at the close of this period`,
        coinsDelta: null,
        occurredAt: subscription.cancel_requested_at,
      });
    }

    if (ENDED_SUBSCRIPTION_STATUSES.has(subscription.status)) {
      // There is no ended-at column. An immediate end (a refund) is the row's last update; a
      // cycle-end cancel ends at the period boundary, even if a later sync touched the row.
      const endedAt =
        subscription.current_period_end && timeMs(subscription.current_period_end) < timeMs(subscription.updated_at)
          ? subscription.current_period_end
          : subscription.updated_at;
      items.push({
        id: `ended:${subscription.id}`,
        kind: 'plan',
        title: subscription.status === 'halted' ? planTitle(name, 'stopped') : planTitle(name, 'ended'),
        subtitle: subscription.status === 'halted' ? 'Renewal payments kept failing' : "You're back on the Free plan",
        coinsDelta: null,
        occurredAt: endedAt,
      });
    }
  }

  return items;
}

/** Newest first; ties broken by id so the order is the same on every load. */
function compareNewestFirst(left: PricingWalletActivityItem, right: PricingWalletActivityItem): number {
  const byTime = timeMs(right.occurredAt) - timeMs(left.occurredAt);
  if (byTime !== 0) return byTime;
  return left.id < right.id ? 1 : left.id > right.id ? -1 : 0;
}

/**
 * Cuts one page out of the merged items. Every source must already hold every row older than the
 * cursor that could make this page (the loader fetches `sourceFetchLimit` rows per source), so
 * "more than a page left" is exact.
 */
export function pageWalletActivity(
  items: PricingWalletActivityItem[],
  cursor: WalletActivityCursor | null,
  pageSize: number = WALLET_ACTIVITY_PAGE_SIZE
): WalletActivityPage {
  const seen = new Set(cursor?.seenIds ?? []);
  const remaining = items
    .filter((item) => {
      const ms = timeMs(item.occurredAt);
      if (!Number.isFinite(ms)) return false;
      if (!cursor) return true;
      return ms < cursor.beforeMs || (ms === cursor.beforeMs && !seen.has(item.id));
    })
    .sort(compareNewestFirst);

  const page = remaining.slice(0, pageSize);
  if (remaining.length <= pageSize || page.length === 0) {
    return { items: page, nextCursor: null };
  }

  const lastMs = timeMs(page[page.length - 1].occurredAt);
  const seenIds = page.filter((item) => timeMs(item.occurredAt) === lastMs).map((item) => item.id);
  if (cursor && cursor.beforeMs === lastMs) seenIds.push(...cursor.seenIds);

  return { items: page, nextCursor: { beforeMs: lastMs, seenIds } };
}

/** Rows each paged source must fetch: a full page, plus any at the boundary already shown, plus one
 * to tell whether more exist. */
export function sourceFetchLimit(cursor: WalletActivityCursor | null, pageSize: number = WALLET_ACTIVITY_PAGE_SIZE): number {
  return pageSize + (cursor?.seenIds.length ?? 0) + 1;
}

/** Upper bound (exclusive, ISO) for a source query: everything at the cursor's millisecond is fetched
 * and the seen ones are dropped in memory. */
export function cursorUpperBoundIso(cursor: WalletActivityCursor | null): string | null {
  return cursor ? new Date(cursor.beforeMs + 1).toISOString() : null;
}

export function isWalletActivityCursor(value: unknown): value is WalletActivityCursor {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { beforeMs?: unknown; seenIds?: unknown };
  return (
    typeof candidate.beforeMs === 'number' &&
    Number.isFinite(candidate.beforeMs) &&
    Array.isArray(candidate.seenIds) &&
    candidate.seenIds.length <= 100 &&
    candidate.seenIds.every((id) => typeof id === 'string' && id.length <= 80)
  );
}
