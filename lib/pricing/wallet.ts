import 'server-only';

import type { DbBeatGrant, DbBeatSpendReservation } from '@/lib/types/database';
import type { BeatAvailability, BeatGrantSourceType } from '@/lib/types/pricing';

const PROMO_SOURCE_TYPES = new Set<BeatGrantSourceType>(['promotion']);
const TOPUP_SOURCE_TYPES = new Set<BeatGrantSourceType>(['topup']);
const SUBSCRIPTION_LIKE_SOURCE_TYPES = new Set<BeatGrantSourceType>([
  'subscription',
  'carry_forward',
  'admin_adjustment',
  'migration_grant',
  'free_allowance',
]);

function asBeatAmount(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface WalletAvailability extends BeatAvailability {
  pendingReserved: number;
}

export function computeWalletAvailability(
  grants: DbBeatGrant[],
  reservations: DbBeatSpendReservation[],
  now: Date = new Date()
): WalletAvailability {
  const baseAvailability = grants.reduce<BeatAvailability>(
    (totals, grant) => {
      if (!isGrantSpendable(grant, now)) {
        return totals;
      }

      const remaining = asBeatAmount(grant.beats_remaining);
      if (remaining <= 0) {
        return totals;
      }

      if (PROMO_SOURCE_TYPES.has(grant.source_type)) {
        totals.promo += remaining;
      } else if (TOPUP_SOURCE_TYPES.has(grant.source_type)) {
        totals.topup += remaining;
      } else if (SUBSCRIPTION_LIKE_SOURCE_TYPES.has(grant.source_type)) {
        totals.subscription += remaining;
      } else {
        totals.subscription += remaining;
      }

      totals.total += remaining;
      return totals;
    },
    { promo: 0, subscription: 0, topup: 0, total: 0 }
  );

  const pendingReserved = reservations.reduce((sum, reservation) => {
    if (!isPendingReservation(reservation, now)) {
      return sum;
    }
    return sum + asBeatAmount(reservation.requested_beat_cost);
  }, 0);

  return applyPendingReservationHold(baseAvailability, pendingReserved);
}

export function isGrantSpendable(grant: DbBeatGrant, now: Date = new Date()): boolean {
  if (asBeatAmount(grant.beats_remaining) <= 0) {
    return false;
  }

  if (!grant.expires_at) {
    return true;
  }

  return new Date(grant.expires_at).getTime() > now.getTime();
}

export function isPendingReservation(
  reservation: DbBeatSpendReservation,
  now: Date = new Date()
): boolean {
  if (reservation.status !== 'pending') {
    return false;
  }

  return new Date(reservation.expires_at).getTime() > now.getTime();
}

function applyPendingReservationHold(
  availability: BeatAvailability,
  pendingReserved: number
): WalletAvailability {
  let remainingHold = pendingReserved;

  const promoHold = Math.min(availability.promo, remainingHold);
  remainingHold -= promoHold;

  const subscriptionHold = Math.min(availability.subscription, remainingHold);
  remainingHold -= subscriptionHold;

  const topupHold = Math.min(availability.topup, remainingHold);

  const promo = availability.promo - promoHold;
  const subscription = availability.subscription - subscriptionHold;
  const topup = availability.topup - topupHold;

  return {
    promo,
    subscription,
    topup,
    total: promo + subscription + topup,
    pendingReserved,
  };
}
