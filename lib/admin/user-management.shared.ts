import { COINS_PER_BEAT, type PlanKey } from '@/lib/types/pricing';
import { normalizeEntitlementPlanKey } from '@/lib/pricing/entitlement-tier.shared';
import type { AdminWatchQuotaView } from '@/lib/pricing/watch-quota-admin.shared';

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
  billing: AdminUserBillingData;
  /** Payments Phase 4, Unit D: "why did this Free user hit the daily watch limit". */
  watchQuota: AdminWatchQuotaView;
}

// --- Billing panel (Payments Phase 4, Unit B) ------------------------------------------------
//
// Every table here except billing_profiles/billing_payments/billing_refunds/billing_documents
// predates migration 125, but several columns this panel reads (provider_mode,
// first_charge_confirmed_at on subscriptions/orders; attempt_count/last_attempt_at/outcome on
// webhook events) were added by migration 124, and subject_ref by 125 -- neither is applied on
// production today. So every section is loaded as a AdminBillingSectionResult: 'unavailable' means
// the read hit a missing-schema error (see lib/billing/schema-availability.shared.ts) and must
// render as "not on this environment yet", never throw. 'ok' with an empty list is a genuine "no
// rows" and renders its own, different empty state -- see describeBillingSectionState.

export type AdminBillingSectionStatus = 'ok' | 'unavailable';

export interface AdminBillingSectionResult<T> {
  status: AdminBillingSectionStatus;
  items: T[];
}

export interface AdminBillingSubscription {
  id: string;
  planVersionId: string | null;
  /** Resolved from plan_version_id via pricing_plan_versions/pricing_plans; null when the join
   * could not be resolved (data gap or the lookup itself failed) -- never guessed. */
  planKey: string | null;
  provider: string;
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
  status: string;
  billingInterval: string | null;
  currencyCode: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  gracePeriodEndsAt: string | null;
  lastWebhookAt: string | null;
  providerMode: string | null;
  firstChargeConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminBillingOrder {
  id: string;
  provider: string;
  orderType: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  currencyCode: string;
  amountMinor: number;
  status: string;
  planVersionId: string | null;
  topupPackId: string | null;
  providerMode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminBillingPayment {
  id: string;
  provider: string;
  providerMode: string | null;
  providerPaymentId: string;
  providerOrderId: string | null;
  providerSubscriptionId: string | null;
  providerInvoiceId: string | null;
  billingOrderId: string | null;
  billingSubscriptionId: string | null;
  planVersionId: string | null;
  topupPackId: string | null;
  kind: string;
  status: string;
  currencyCode: string;
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  methodCategory: string | null;
  providerFeeMinor: number | null;
  providerTaxMinor: number | null;
  cycleStart: string | null;
  cycleEnd: string | null;
  capturedAt: string | null;
  createdAt: string;
}

export interface AdminBillingRefund {
  id: string;
  paymentId: string | null;
  provider: string;
  providerMode: string | null;
  providerRefundId: string;
  providerPaymentId: string | null;
  amountMinor: number;
  netMinor: number | null;
  taxMinor: number | null;
  currencyCode: string;
  status: string;
  reason: string | null;
  initiatedBy: string | null;
  /** initiated_by === 'dispute' -- a dispute is a billing_refunds row, not a separate table. */
  isDispute: boolean;
  processedAt: string | null;
  createdAt: string;
}

export interface AdminBillingDocument {
  id: string;
  documentType: string;
  documentNumber: string;
  financialYear: string;
  issuedAt: string;
  paymentId: string | null;
  refundId: string | null;
  currencyCode: string;
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  status: string;
  voidReason: string | null;
  storageRef: string | null;
  createdAt: string;
}

export interface AdminBillingProfile {
  id: string;
  legalName: string | null;
  billingEmail: string | null;
  phone: string | null;
  companyName: string | null;
  gstin: string | null;
  stateCode: string | null;
  countryCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postalCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminBillingWebhookEvent {
  id: string;
  provider: string;
  eventType: string;
  providerEventId: string | null;
  status: string;
  relatedSubscriptionId: string | null;
  receivedAt: string;
  processedAt: string | null;
  errorMessage: string | null;
  attemptCount: number | null;
  lastAttemptAt: string | null;
  outcome: string | null;
}

/**
 * currentPlanKey is billing truth from the admin_list_users RPC (see mapAdminUserRow), never
 * overridden by a billing_subscriptions read. This is the other half of that fact: whether the
 * user's own subscription rows imply the same plan, computed independently so a disagreement is
 * shown rather than silently resolved one way. subscriptionPlanKey is null -- never a guess --
 * when the section couldn't be read, or when an active-looking row's plan_version_id didn't
 * resolve to a known plan; in both cases mismatched stays false, since flagging a "disagreement"
 * off data we don't actually have would itself be a false alarm.
 */
export interface AdminBillingPlanKeyCheck {
  rpcPlanKey: string;
  subscriptionPlanKey: string | null;
  mismatched: boolean;
}

export interface AdminUserBillingData {
  subscriptions: AdminBillingSectionResult<AdminBillingSubscription>;
  orders: AdminBillingSectionResult<AdminBillingOrder>;
  payments: AdminBillingSectionResult<AdminBillingPayment>;
  refunds: AdminBillingSectionResult<AdminBillingRefund>;
  documents: AdminBillingSectionResult<AdminBillingDocument>;
  profile: { status: AdminBillingSectionStatus; profile: AdminBillingProfile | null };
  webhookEvents: AdminBillingSectionResult<AdminBillingWebhookEvent>;
  planKeyCheck: AdminBillingPlanKeyCheck;
}

export type AdminCohortPlanFilter = 'all' | 'free' | 'audience' | 'plus' | 'studio';

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
  { value: 'audience', label: 'Audience' },
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
    throw new Error('Pick a valid access tier: free, audience, plus, or studio.');
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
    ['all', 'free', 'audience', 'plus', 'studio'] as const
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

function billingNumberValue(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function billingIntegerValue(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

// --- Billing panel: raw row shapes (snake_case, as read from Supabase) and pure mappers -------

export interface RawBillingSubscriptionRow {
  id: string;
  plan_version_id: string | null;
  provider: string;
  provider_subscription_id: string | null;
  provider_customer_id: string | null;
  status: string;
  billing_interval: string | null;
  currency_code: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  grace_period_ends_at: string | null;
  last_webhook_at: string | null;
  provider_mode: string | null;
  first_charge_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function mapAdminBillingSubscription(
  row: RawBillingSubscriptionRow,
  planKeyByVersionId: ReadonlyMap<string, string>
): AdminBillingSubscription {
  return {
    id: row.id,
    planVersionId: row.plan_version_id,
    planKey: row.plan_version_id ? planKeyByVersionId.get(row.plan_version_id) ?? null : null,
    provider: row.provider,
    providerSubscriptionId: row.provider_subscription_id,
    providerCustomerId: row.provider_customer_id,
    status: row.status,
    billingInterval: row.billing_interval,
    currencyCode: row.currency_code,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    gracePeriodEndsAt: row.grace_period_ends_at,
    lastWebhookAt: row.last_webhook_at,
    providerMode: row.provider_mode,
    firstChargeConfirmedAt: row.first_charge_confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface RawBillingOrderRow {
  id: string;
  provider: string;
  order_type: string;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  currency_code: string;
  amount_minor: number | string;
  status: string;
  plan_version_id: string | null;
  topup_pack_id: string | null;
  provider_mode: string | null;
  created_at: string;
  updated_at: string;
}

export function mapAdminBillingOrder(row: RawBillingOrderRow): AdminBillingOrder {
  return {
    id: row.id,
    provider: row.provider,
    orderType: row.order_type,
    providerOrderId: row.provider_order_id,
    providerPaymentId: row.provider_payment_id,
    currencyCode: row.currency_code,
    amountMinor: billingNumberValue(row.amount_minor),
    status: row.status,
    planVersionId: row.plan_version_id,
    topupPackId: row.topup_pack_id,
    providerMode: row.provider_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface RawBillingPaymentRow {
  id: string;
  provider: string;
  provider_mode: string | null;
  provider_payment_id: string;
  provider_order_id: string | null;
  provider_subscription_id: string | null;
  provider_invoice_id: string | null;
  billing_order_id: string | null;
  billing_subscription_id: string | null;
  plan_version_id: string | null;
  topup_pack_id: string | null;
  kind: string;
  status: string;
  currency_code: string;
  net_minor: number | string;
  tax_minor: number | string;
  gross_minor: number | string;
  method_category: string | null;
  provider_fee_minor: number | string | null;
  provider_tax_minor: number | string | null;
  cycle_start: string | null;
  cycle_end: string | null;
  captured_at: string | null;
  created_at: string;
}

export function mapAdminBillingPayment(row: RawBillingPaymentRow): AdminBillingPayment {
  return {
    id: row.id,
    provider: row.provider,
    providerMode: row.provider_mode,
    providerPaymentId: row.provider_payment_id,
    providerOrderId: row.provider_order_id,
    providerSubscriptionId: row.provider_subscription_id,
    providerInvoiceId: row.provider_invoice_id,
    billingOrderId: row.billing_order_id,
    billingSubscriptionId: row.billing_subscription_id,
    planVersionId: row.plan_version_id,
    topupPackId: row.topup_pack_id,
    kind: row.kind,
    status: row.status,
    currencyCode: row.currency_code,
    netMinor: billingNumberValue(row.net_minor),
    taxMinor: billingNumberValue(row.tax_minor),
    grossMinor: billingNumberValue(row.gross_minor),
    methodCategory: row.method_category,
    providerFeeMinor: row.provider_fee_minor == null ? null : billingNumberValue(row.provider_fee_minor),
    providerTaxMinor: row.provider_tax_minor == null ? null : billingNumberValue(row.provider_tax_minor),
    cycleStart: row.cycle_start,
    cycleEnd: row.cycle_end,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
  };
}

export interface RawBillingRefundRow {
  id: string;
  payment_id: string | null;
  provider: string;
  provider_mode: string | null;
  provider_refund_id: string;
  provider_payment_id: string | null;
  amount_minor: number | string;
  net_minor: number | string | null;
  tax_minor: number | string | null;
  currency_code: string;
  status: string;
  reason: string | null;
  initiated_by: string | null;
  processed_at: string | null;
  created_at: string;
}

export function mapAdminBillingRefund(row: RawBillingRefundRow): AdminBillingRefund {
  return {
    id: row.id,
    paymentId: row.payment_id,
    provider: row.provider,
    providerMode: row.provider_mode,
    providerRefundId: row.provider_refund_id,
    providerPaymentId: row.provider_payment_id,
    amountMinor: billingNumberValue(row.amount_minor),
    netMinor: row.net_minor == null ? null : billingNumberValue(row.net_minor),
    taxMinor: row.tax_minor == null ? null : billingNumberValue(row.tax_minor),
    currencyCode: row.currency_code,
    status: row.status,
    reason: row.reason,
    initiatedBy: row.initiated_by,
    isDispute: row.initiated_by === 'dispute',
    processedAt: row.processed_at,
    createdAt: row.created_at,
  };
}

export interface RawBillingDocumentRow {
  id: string;
  document_type: string;
  document_number: string;
  financial_year: string;
  issued_at: string;
  payment_id: string | null;
  refund_id: string | null;
  currency_code: string;
  net_minor: number | string;
  tax_minor: number | string;
  gross_minor: number | string;
  status: string;
  void_reason: string | null;
  storage_ref: string | null;
  created_at: string;
}

export function mapAdminBillingDocument(row: RawBillingDocumentRow): AdminBillingDocument {
  return {
    id: row.id,
    documentType: row.document_type,
    documentNumber: row.document_number,
    financialYear: row.financial_year,
    issuedAt: row.issued_at,
    paymentId: row.payment_id,
    refundId: row.refund_id,
    currencyCode: row.currency_code,
    netMinor: billingNumberValue(row.net_minor),
    taxMinor: billingNumberValue(row.tax_minor),
    grossMinor: billingNumberValue(row.gross_minor),
    status: row.status,
    voidReason: row.void_reason,
    storageRef: row.storage_ref,
    createdAt: row.created_at,
  };
}

export interface RawBillingProfileRow {
  id: string;
  legal_name: string | null;
  billing_email: string | null;
  phone: string | null;
  company_name: string | null;
  gstin: string | null;
  state_code: string | null;
  country_code: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  postal_code: string | null;
  created_at: string;
  updated_at: string;
}

export function mapAdminBillingProfile(row: RawBillingProfileRow): AdminBillingProfile {
  return {
    id: row.id,
    legalName: row.legal_name,
    billingEmail: row.billing_email,
    phone: row.phone,
    companyName: row.company_name,
    gstin: row.gstin,
    stateCode: row.state_code,
    countryCode: row.country_code,
    addressLine1: row.address_line_1,
    addressLine2: row.address_line_2,
    city: row.city,
    postalCode: row.postal_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface RawBillingWebhookEventRow {
  id: string;
  provider: string;
  event_type: string;
  provider_event_id: string | null;
  status: string;
  related_subscription_id: string | null;
  received_at: string;
  processed_at: string | null;
  error_message: string | null;
  attempt_count: number | string | null;
  last_attempt_at: string | null;
  outcome: string | null;
}

export function mapAdminBillingWebhookEvent(row: RawBillingWebhookEventRow): AdminBillingWebhookEvent {
  return {
    id: row.id,
    provider: row.provider,
    eventType: row.event_type,
    providerEventId: row.provider_event_id,
    status: row.status,
    relatedSubscriptionId: row.related_subscription_id,
    receivedAt: row.received_at,
    processedAt: row.processed_at,
    errorMessage: row.error_message,
    attemptCount: row.attempt_count == null ? null : billingIntegerValue(row.attempt_count),
    lastAttemptAt: row.last_attempt_at,
    outcome: row.outcome,
  };
}

/**
 * The primitive admin_list_users's own subscription predicate reduces to (083_admin_user_management.sql):
 * active/trialing/authenticated with an unexpired (or absent) period end, OR pending/halted still
 * inside its grace period. Factored out of selectActiveBillingSubscriptionForPlanKey so a second
 * caller (Payments Phase 4, Unit E's catalogue-guardrail subscriber count) can ask the identical
 * question about rows that were never assembled into a full AdminBillingSubscription -- see
 * lib/pricing/catalog-guardrails.shared.ts. Do not write a second version of this; import it.
 */
export function isLiveBillingSubscriptionStatus(
  status: string,
  currentPeriodEnd: string | null,
  gracePeriodEndsAt: string | null,
  now: Date = new Date()
): boolean {
  const nowMs = now.getTime();
  const normalizedStatus = status.toLowerCase();

  if (normalizedStatus === 'active' || normalizedStatus === 'trialing' || normalizedStatus === 'authenticated') {
    if (!currentPeriodEnd) return true;
    const endMs = new Date(currentPeriodEnd).getTime();
    return !Number.isFinite(endMs) || endMs > nowMs;
  }
  if (normalizedStatus === 'pending' || normalizedStatus === 'halted') {
    if (!gracePeriodEndsAt) return false;
    const graceMs = new Date(gracePeriodEndsAt).getTime();
    return Number.isFinite(graceMs) && graceMs > nowMs;
  }
  return false;
}

/**
 * Reproduces admin_list_users's own subscription predicate (083_admin_user_management.sql) in JS,
 * over rows this loader already fetched, so the plan-key disagreement check asks the same question
 * the RPC did rather than a looser one -- see isLiveBillingSubscriptionStatus. Ties break the same
 * way too -- current_period_end DESC NULLS LAST, then updated_at DESC. Nulls sort last in a DESC
 * order, which is the same as treating them as -Infinity here.
 */
export function selectActiveBillingSubscriptionForPlanKey(
  subscriptions: readonly AdminBillingSubscription[],
  now: Date = new Date()
): AdminBillingSubscription | null {
  const candidates = subscriptions.filter((subscription) =>
    isLiveBillingSubscriptionStatus(subscription.status, subscription.currentPeriodEnd, subscription.gracePeriodEndsAt, now)
  );

  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort((left, right) => {
    const leftEnd = left.currentPeriodEnd ? new Date(left.currentPeriodEnd).getTime() : -Infinity;
    const rightEnd = right.currentPeriodEnd ? new Date(right.currentPeriodEnd).getTime() : -Infinity;
    if (leftEnd !== rightEnd) return rightEnd - leftEnd;
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });

  return sorted[0];
}

/**
 * The one comparison §9 calls out by name: does the admin_list_users RPC's currentPlanKey (billing
 * truth per mapAdminUserRow) agree with what this account's own billing_subscriptions rows imply?
 * subscriptionsAvailable must be false whenever that section's read itself failed closed -- a
 * disagreement can only be reported from data actually read, never inferred from its absence.
 */
export function deriveBillingPlanKeyCheck(
  rpcPlanKey: string,
  subscriptionsAvailable: boolean,
  subscriptions: readonly AdminBillingSubscription[],
  now: Date = new Date()
): AdminBillingPlanKeyCheck {
  if (!subscriptionsAvailable) {
    return { rpcPlanKey, subscriptionPlanKey: null, mismatched: false };
  }

  const active = selectActiveBillingSubscriptionForPlanKey(subscriptions, now);
  // Mirrors the RPC's own COALESCE(plan.plan_key, 'free'): no active-looking row is the same
  // as the RPC's own "nothing found" fallback, so the two are directly comparable.
  const subscriptionPlanKey = active === null ? 'free' : active.planKey;

  return {
    rpcPlanKey,
    subscriptionPlanKey,
    mismatched: subscriptionPlanKey !== null && subscriptionPlanKey !== rpcPlanKey,
  };
}

// --- Billing panel: empty / unavailable state, kept as pure data so the component only renders ---

export type AdminBillingSectionKey =
  | 'subscriptions'
  | 'orders'
  | 'payments'
  | 'refunds'
  | 'documents'
  | 'profile'
  | 'webhookEvents';

export interface AdminBillingSectionDisplayState {
  kind: 'unavailable' | 'empty' | 'has_data';
  /** Shown for 'unavailable' or 'empty'; null once there is real data to render instead. */
  message: string | null;
}

const BILLING_SECTION_UNAVAILABLE_MESSAGE =
  'Not available on this environment yet -- the billing migration for this data has not been applied here.';

const BILLING_SECTION_EMPTY_MESSAGES: Record<AdminBillingSectionKey, string> = {
  subscriptions: 'No subscription history for this account yet.',
  orders: 'No orders for this account yet.',
  payments: 'No recorded payments for this account yet.',
  refunds: 'No refunds or disputes for this account.',
  // Deliberately explicit: billing_documents is empty for every account until Phase 6 turns on
  // document issuing, not because this account has no history (see docs/payments/phase-4-plan.md
  // §0). An admin reading a blank panel here should not conclude something is broken.
  documents: 'No receipts or invoices yet -- document issuing ships in a later phase.',
  profile: 'No billing profile on file for this account.',
  webhookEvents: 'No billing webhook events recorded for this account.',
};

export function describeBillingSectionState(
  key: AdminBillingSectionKey,
  status: AdminBillingSectionStatus,
  itemCount: number
): AdminBillingSectionDisplayState {
  if (status === 'unavailable') {
    return { kind: 'unavailable', message: BILLING_SECTION_UNAVAILABLE_MESSAGE };
  }
  if (itemCount <= 0) {
    return { kind: 'empty', message: BILLING_SECTION_EMPTY_MESSAGES[key] };
  }
  return { kind: 'has_data', message: null };
}
