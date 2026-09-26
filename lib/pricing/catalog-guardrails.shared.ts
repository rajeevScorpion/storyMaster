import { isLiveBillingSubscriptionStatus } from '@/lib/admin/user-management.shared';

/**
 * Payments Phase 4, Unit E -- pure helpers behind the pricing studio's "informed confirmation"
 * before an archive, deactivate, or publish-that-silently-archives catalogue action.
 *
 * Owner decision 14 (`docs/payments/audit-progress.md`) rejected a hard block: the finding directly
 * under it established that archiving already does NOT strip a live subscriber -- both paths that
 * decide entitlement resolve a subscriber's plan by id with no status filter, and Razorpay keeps
 * billing its own plan id regardless. So nothing here may claim to "protect" access or "prevent"
 * loss of entitlement -- that would be false, the same defect class already found twice in this
 * phase. This module only ever reports how many live subscribers are on the thing about to change,
 * so the admin is informed rather than blocked.
 */

/** null means the count could not be determined -- a failed read, never a reason to block the action. */
export type SubscriberImpactCount = number | null;

export interface RawSubscriberStatusRow {
  status: string;
  current_period_end: string | null;
  grace_period_ends_at: string | null;
}

/**
 * Counts rows this "live" by the same predicate admin_list_users and
 * selectActiveBillingSubscriptionForPlanKey use (lib/admin/user-management.shared.ts) -- never a
 * looser or stricter definition invented for this one caller.
 */
export function countLiveSubscriberRows(
  rows: readonly RawSubscriberStatusRow[],
  now: Date = new Date()
): number {
  return rows.filter((row) =>
    isLiveBillingSubscriptionStatus(row.status, row.current_period_end, row.grace_period_ends_at, now)
  ).length;
}

function describeCount(count: SubscriberImpactCount): string {
  if (count === null) {
    return 'Kissago could not determine how many subscribers this affects right now.';
  }
  if (count === 0) {
    return 'No live subscribers are on it right now.';
  }
  if (count === 1) {
    return '1 live subscriber is on it right now.';
  }
  return `${count} live subscribers are on it right now.`;
}

const NO_ACCESS_CHANGE_NOTE =
  'This is a catalogue change only -- it does not cancel, refund, or change billing or access for anyone already on it.';

export function describeArchivePlanVersionConfirmation(count: SubscriberImpactCount): string {
  return `${describeCount(count)} ${NO_ACCESS_CHANGE_NOTE}`;
}

export function describePublishPlanVersionConfirmation(
  archivedVersionLabel: string,
  count: SubscriberImpactCount
): string {
  return `Publishing this draft will also archive the currently published version (${archivedVersionLabel}). ${describeCount(count)} ${NO_ACCESS_CHANGE_NOTE}`;
}

export function describeDeactivatePlanConfirmation(count: SubscriberImpactCount): string {
  return `${describeCount(count)} ${NO_ACCESS_CHANGE_NOTE}`;
}
