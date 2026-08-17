import { COINS_PER_BEAT, type PlanKey } from '@/lib/types/pricing';
import { normalizeEntitlementPlanKey } from '@/lib/pricing/entitlement-tier.shared';

export const ADMIN_USER_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_ADMIN_USER_PAGE_SIZE = ADMIN_USER_PAGE_SIZES[0];
export const MAX_ADMIN_COIN_GRANT = 10_000_000;

export type AdminAccountStatus = 'active' | 'suspended' | 'blocked';
export type AdminAccountStatusFilter = 'all' | AdminAccountStatus;

export interface AdminUserListInput {
  search?: string;
  status?: AdminAccountStatusFilter;
  page?: number;
  pageSize?: number;
}

export interface NormalizedAdminUserListInput {
  search: string;
  status: AdminAccountStatusFilter;
  page: number;
  pageSize: (typeof ADMIN_USER_PAGE_SIZES)[number];
}

export interface AdminUserRow {
  userId: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  authProvider: string | null;
  joinedAt: string;
  lastSignInAt: string | null;
  lastProductActivityAt: string | null;
  accountStatus: AdminAccountStatus;
  suspendedUntil: string | null;
  moderationReason: string | null;
  /** Billing truth: the plan an active subscription pays for. */
  currentPlanKey: string;
  /** Admin-granted feature tier, or null when the account was never promoted. */
  entitlementOverridePlanKey: PlanKey | null;
  /** What feature gates actually read — the higher of plan and override. */
  effectiveEntitlementPlanKey: PlanKey;
  availableCoins: number;
  lifetimeGrantedCoins: number;
  lifetimeConsumedCoins: number;
  monthConsumedCoins: number;
  expiringCoins30d: number;
  inProgressStoryCount: number;
  finishedStoryCount: number;
  publishedStoryCount: number;
  publishedPathCount: number;
  reelCount: number;
}

export interface AdminUserManagementSummary {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  blockedUsers: number;
  availableCoins: number;
  monthConsumedCoins: number;
}

export interface AdminUsersPageData {
  users: AdminUserRow[];
  summary: AdminUserManagementSummary;
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface AdminUserAuditItem {
  id: string;
  actionType:
    | 'account_suspended'
    | 'account_blocked'
    | 'account_reactivated'
    | 'coins_granted'
    | 'cohort_executed'
    | 'entitlement_tier_changed';
  reason: string;
  actorUserId: string | null;
  createdAt: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface AdminUserWalletActivityItem {
  id: string;
  kind: 'grant' | 'spend';
  label: string;
  coinsDelta: number;
  source: string;
  occurredAt: string;
  expiresAt: string | null;
}

export interface AdminUserRecentStory {
  id: string;
  title: string;
  kind: 'story' | 'reel';
  status: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserDetailData {
  user: AdminUserRow;
  walletActivity: AdminUserWalletActivityItem[];
  auditEvents: AdminUserAuditItem[];
  recentStories: AdminUserRecentStory[];
}

export type AdminCohortPlanFilter = 'all' | 'free' | 'plus' | 'studio';

export interface AdminPromotionalCohortInput {
  name: string;
  activeWithinDays: number;
  minFinishedStories: number;
  minPublishedStories: number;
  minLifetimeConsumedCoins: number;
  planKey: AdminCohortPlanFilter;
  coinsPerUser: number;
  grantExpiresAt?: string | null;
}

export interface NormalizedAdminPromotionalCohortInput {
  name: string;
  activeWithinDays: number;
  minFinishedStories: number;
  minPublishedStories: number;
  minLifetimeConsumedCoins: number;
  minLifetimeConsumedBeats: number;
  planKey: AdminCohortPlanFilter;
  coinsPerUser: number;
  beatsPerUser: number;
  grantExpiresAt: string | null;
}

export interface AdminPromotionalCohortCandidate {
  userId: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  currentPlanKey: string;
  lastProductActivityAt: string;
  finishedStoryCount: number;
  publishedStoryCount: number;
  lifetimeConsumedCoins: number;
}

export interface AdminPromotionalCohortPreview {
  input: NormalizedAdminPromotionalCohortInput;
  eligibleCount: number;
  estimatedLiabilityCoins: number;
  sample: AdminPromotionalCohortCandidate[];
}

export interface AdminPromotionalCohortRun {
  id: string;
  name: string;
  coinsPerUser: number;
  grantExpiresAt: string | null;
  eligibleCount: number;
  grantedCount: number;
  status: string;
  createdAt: string;
  rules: Record<string, unknown>;
}

export interface EffectiveModerationState {
  status: AdminAccountStatus;
  suspendedUntil: string | null;
  reason: string | null;
}

export function normalizeAdminUserListInput(
  input: AdminUserListInput = {}
): NormalizedAdminUserListInput {
  const search = String(input.search ?? '').trim().slice(0, 200);
  const requestedStatus = String(input.status ?? 'all');
  const status: AdminAccountStatusFilter = (
    ['all', 'active', 'suspended', 'blocked'] as const
  ).includes(requestedStatus as AdminAccountStatusFilter)
    ? requestedStatus as AdminAccountStatusFilter
    : 'all';
  const page = Math.max(1, Math.floor(Number(input.page) || 1));
  const requestedPageSize = Math.floor(Number(input.pageSize) || DEFAULT_ADMIN_USER_PAGE_SIZE);
  const pageSize = ADMIN_USER_PAGE_SIZES.includes(
    requestedPageSize as (typeof ADMIN_USER_PAGE_SIZES)[number]
  )
    ? requestedPageSize as (typeof ADMIN_USER_PAGE_SIZES)[number]
    : DEFAULT_ADMIN_USER_PAGE_SIZE;

  return { search, status, page, pageSize };
}

export function resolveEffectiveModerationState(
  row: {
    status?: string | null;
    suspended_until?: string | null;
    reason?: string | null;
  } | null | undefined,
  now: Date = new Date()
): EffectiveModerationState {
  const status = row?.status;
  if (status === 'blocked') {
    return {
      status: 'blocked',
      suspendedUntil: null,
      reason: row?.reason ?? null,
    };
  }

  if (status === 'suspended' && row?.suspended_until) {
    const until = new Date(row.suspended_until);
    if (Number.isFinite(until.getTime()) && until.getTime() > now.getTime()) {
      return {
        status: 'suspended',
        suspendedUntil: until.toISOString(),
        reason: row.reason ?? null,
      };
    }
  }

  return {
    status: 'active',
    suspendedUntil: null,
    reason: row?.reason ?? null,
  };
}

export function normalizeCoinGrantInput(input: {
  coins: number;
  reason: string;
  expiresAt?: string | null;
}): {
  coins: number;
  beats: number;
  reason: string;
  expiresAt: string | null;
} {
  const coins = Number(input.coins);
  if (!Number.isFinite(coins) || coins <= 0 || coins > MAX_ADMIN_COIN_GRANT) {
    throw new Error(`Coins must be between 1 and ${MAX_ADMIN_COIN_GRANT.toLocaleString()}.`);
  }
  if (!Number.isInteger(coins)) {
    throw new Error('Coin grants must use a whole number of coins.');
  }

  const reason = String(input.reason ?? '').trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new Error('Reason must be between 3 and 500 characters.');
  }

  let expiresAt: string | null = null;
  if (input.expiresAt) {
    const parsedExpiry = new Date(input.expiresAt);
    if (!Number.isFinite(parsedExpiry.getTime()) || parsedExpiry.getTime() <= Date.now()) {
      throw new Error('Coin expiry must be a valid future date.');
    }
    expiresAt = parsedExpiry.toISOString();
  }

  return {
    coins,
    beats: Number((coins / COINS_PER_BEAT).toFixed(2)),
    reason,
    expiresAt,
  };
}

export const ENTITLEMENT_TIER_OPTIONS: readonly { value: PlanKey; label: string }[] = [
  { value: 'free', label: 'Free' },
  { value: 'plus', label: 'Plus' },
  { value: 'studio', label: 'Studio' },
];

/**
 * A tier change grants feature access only, so the input carries no coin fields
 * by design. 'free' means "no promotion" and clears any existing row.
 */
export function normalizeEntitlementTierInput(input: {
  entitlementPlanKey: unknown;
  reason?: string | null;
}): { entitlementPlanKey: PlanKey; reason: string | null } {
  const entitlementPlanKey = normalizeEntitlementPlanKey(input.entitlementPlanKey);
  if (!entitlementPlanKey) {
    throw new Error('Pick a valid access tier: free, plus, or studio.');
  }

  const reason = String(input.reason ?? '').trim();
  if (reason.length > 500) {
    throw new Error('Reason must be 500 characters or fewer.');
  }

  return { entitlementPlanKey, reason: reason || null };
}

export function beatsToCoins(value: number | string | null | undefined): number {
  const beats = Number(value ?? 0);
  if (!Number.isFinite(beats)) return 0;
  return Number((beats * COINS_PER_BEAT).toFixed(2));
}

export function normalizePromotionalCohortInput(
  input: AdminPromotionalCohortInput
): NormalizedAdminPromotionalCohortInput {
  const name = String(input.name ?? '').trim();
  if (name.length < 3 || name.length > 120) {
    throw new Error('Cohort name must be between 3 and 120 characters.');
  }

  const activeWithinDays = boundedInteger(
    input.activeWithinDays,
    1,
    3650,
    'Active-within days'
  );
  const minFinishedStories = boundedInteger(
    input.minFinishedStories,
    0,
    100_000,
    'Minimum finished stories'
  );
  const minPublishedStories = boundedInteger(
    input.minPublishedStories,
    0,
    100_000,
    'Minimum published stories'
  );
  const minLifetimeConsumedCoins = boundedInteger(
    input.minLifetimeConsumedCoins,
    0,
    MAX_ADMIN_COIN_GRANT,
    'Minimum lifetime coins'
  );
  const grant = normalizeCoinGrantInput({
    coins: input.coinsPerUser,
    reason: `Promotional cohort: ${name}`,
    expiresAt: input.grantExpiresAt,
  });
  const planKey = (
    ['all', 'free', 'plus', 'studio'] as const
  ).includes(input.planKey)
    ? input.planKey
    : 'all';

  return {
    name,
    activeWithinDays,
    minFinishedStories,
    minPublishedStories,
    minLifetimeConsumedCoins,
    minLifetimeConsumedBeats: Number(
      (minLifetimeConsumedCoins / COINS_PER_BEAT).toFixed(2)
    ),
    planKey,
    coinsPerUser: grant.coins,
    beatsPerUser: grant.beats,
    grantExpiresAt: grant.expiresAt,
  };
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be a whole number between ${minimum} and ${maximum}.`);
  }
  return parsed;
}
