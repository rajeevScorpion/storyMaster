export const PRICING_MARKET_KEYS = ['IN', 'ROW'] as const;
export type PricingMarketKey = (typeof PRICING_MARKET_KEYS)[number];

export const COINS_PER_BEAT = 10;

export const BILLING_PROVIDERS = ['stripe', 'razorpay'] as const;
export type BillingProvider = (typeof BILLING_PROVIDERS)[number];

export const PLAN_KEYS = ['free', 'plus', 'studio'] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export const BILLING_INTERVALS = ['monthly', 'annual'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const PRICING_CATALOG_STATUSES = ['draft', 'published', 'archived'] as const;
export type PricingCatalogStatus = (typeof PRICING_CATALOG_STATUSES)[number];

export const PROMOTION_MARKET_SCOPES = ['ALL', 'IN', 'ROW'] as const;
export type PromotionMarketScope = (typeof PROMOTION_MARKET_SCOPES)[number];

export const BILLING_ORDER_TYPES = ['subscription_checkout', 'topup_checkout'] as const;
export type BillingOrderType = (typeof BILLING_ORDER_TYPES)[number];

export const BILLING_WEBHOOK_EVENT_STATUSES = ['received', 'processed', 'failed', 'ignored'] as const;
export type BillingWebhookEventStatus = (typeof BILLING_WEBHOOK_EVENT_STATUSES)[number];

export const BEAT_GRANT_SOURCE_TYPES = [
  'subscription',
  'carry_forward',
  'topup',
  'promotion',
  'admin_adjustment',
  'migration_grant',
] as const;
export type BeatGrantSourceType = (typeof BEAT_GRANT_SOURCE_TYPES)[number];

export const BEAT_RESERVATION_STATUSES = ['pending', 'finalized', 'released', 'failed', 'expired'] as const;
export type BeatReservationStatus = (typeof BEAT_RESERVATION_STATUSES)[number];

export const PRICING_ACTION_KEYS = [
  'start_story_initial_beat',
  'continue_story_new_beat',
  'regenerate_image',
  'regenerate_narration',
  'export_video_future',
] as const;
export type PricingActionKey = (typeof PRICING_ACTION_KEYS)[number];

export const PRICING_AUDIT_ENTITY_TYPES = [
  'plan_version',
  'topup_pack',
  'action_cost',
  'promotion',
  'runtime_setting',
] as const;
export type PricingAuditEntityType = (typeof PRICING_AUDIT_ENTITY_TYPES)[number];

export const PRICING_AUDIT_ACTION_TYPES = [
  'create_draft',
  'update_draft',
  'publish',
  'archive',
  'immediate_update',
] as const;
export type PricingAuditActionType = (typeof PRICING_AUDIT_ACTION_TYPES)[number];

export const PRICING_RUNTIME_FLAG_KEYS = [
  'pricing_admin_tab_enabled',
  'pricing_snapshot_enabled',
  'pricing_checkout_enabled',
  'pricing_shadow_metering_enabled',
  'pricing_hard_enforcement_enabled',
  'pricing_story_length_ui_limits_enabled',
  'pricing_default_grace_period_days',
  'pricing_default_carry_forward_cap_multiplier',
  'pricing_reservation_timeout_seconds',
  'pricing_migration_grant_beats',
  'pricing_tester_studio_duration_days',
  'pricing_routing_provider_in',
  'pricing_routing_provider_row',
] as const;
export type PricingRuntimeFlagKey = (typeof PRICING_RUNTIME_FLAG_KEYS)[number];

export function isPricingRuntimeFlagKey(value: string): value is PricingRuntimeFlagKey {
  return (PRICING_RUNTIME_FLAG_KEYS as readonly string[]).includes(value);
}

export type PricingRuntimeSettingKind = 'boolean' | 'integer' | 'text';

export interface PricingRuntimeSettingDefinition {
  key: PricingRuntimeFlagKey;
  kind: PricingRuntimeSettingKind;
  defaultEnabled: boolean;
  defaultValue: string | null;
  label: string;
  description: string;
}

export const PRICING_RUNTIME_SETTING_DEFINITIONS: readonly PricingRuntimeSettingDefinition[] = [
  {
    key: 'pricing_admin_tab_enabled',
    kind: 'boolean',
    defaultEnabled: false,
    defaultValue: null,
    label: 'Pricing Admin Tab',
    description: 'Shows the pricing workspace inside the admin playground.',
  },
  {
    key: 'pricing_snapshot_enabled',
    kind: 'boolean',
    defaultEnabled: false,
    defaultValue: null,
    label: 'Pricing Snapshot Reads',
    description: 'Enables server-side pricing snapshot reads for runtime consumers.',
  },
  {
    key: 'pricing_checkout_enabled',
    kind: 'boolean',
    defaultEnabled: false,
    defaultValue: null,
    label: 'Pricing Checkout',
    description: 'Enables hosted billing checkout entry points.',
  },
  {
    key: 'pricing_shadow_metering_enabled',
    kind: 'boolean',
    defaultEnabled: false,
    defaultValue: null,
    label: 'Shadow Metering',
    description: 'Logs intended coin spend without blocking users.',
  },
  {
    key: 'pricing_hard_enforcement_enabled',
    kind: 'boolean',
    defaultEnabled: false,
    defaultValue: null,
    label: 'Hard Enforcement',
    description: 'Blocks billable actions when spend authorization fails.',
  },
  {
    key: 'pricing_story_length_ui_limits_enabled',
    kind: 'boolean',
    defaultEnabled: false,
    defaultValue: null,
    label: 'Story Length UI Limits',
    description: 'Applies tier-aware story length caps in setup UI.',
  },
  {
    key: 'pricing_default_grace_period_days',
    kind: 'integer',
    defaultEnabled: false,
    defaultValue: '5',
    label: 'Default Grace Period Days',
    description: 'Fallback grace period when a plan version does not override it.',
  },
  {
    key: 'pricing_default_carry_forward_cap_multiplier',
    kind: 'integer',
    defaultEnabled: false,
    defaultValue: '2',
    label: 'Carry Forward Cap Multiplier',
    description: 'Default cap multiplier for carried-forward subscription coins.',
  },
  {
    key: 'pricing_reservation_timeout_seconds',
    kind: 'integer',
    defaultEnabled: false,
    defaultValue: '1800',
    label: 'Reservation Timeout Seconds',
    description: 'How long pending beat reservations remain active before expiry.',
  },
  {
    key: 'pricing_migration_grant_beats',
    kind: 'integer',
    defaultEnabled: false,
    defaultValue: '25',
    label: 'Migration Grant Coins',
    description: 'One-time coin grant for existing non-admin users during rollout.',
  },
  {
    key: 'pricing_tester_studio_duration_days',
    kind: 'integer',
    defaultEnabled: false,
    defaultValue: '90',
    label: 'Tester Studio Duration Days',
    description: 'Temporary Studio access window for testers and admins.',
  },
  {
    key: 'pricing_routing_provider_in',
    kind: 'text',
    defaultEnabled: false,
    defaultValue: 'razorpay',
    label: 'India Billing Provider',
    description: 'Primary checkout provider for India market users.',
  },
  {
    key: 'pricing_routing_provider_row',
    kind: 'text',
    defaultEnabled: false,
    defaultValue: 'stripe',
    label: 'ROW Billing Provider',
    description: 'Primary checkout provider for non-India market users.',
  },
] as const;

export interface PricingPlanFeatureFlags {
  canAccessDownloads?: boolean;
  canAccessUnbrandedExports?: boolean;
  creatorControls?: boolean;
}

export interface BeatAvailability {
  promo: number;
  subscription: number;
  topup: number;
  total: number;
}

export interface PricingRuntimeControls {
  pricingAdminTabEnabled: boolean;
  pricingSnapshotEnabled: boolean;
  pricingCheckoutEnabled: boolean;
  pricingShadowMeteringEnabled: boolean;
  pricingHardEnforcementEnabled: boolean;
  pricingStoryLengthUiLimitsEnabled: boolean;
  defaultGracePeriodDays: number;
  defaultCarryForwardCapMultiplier: number;
  reservationTimeoutSeconds: number;
  migrationGrantBeats: number;
  testerStudioDurationDays: number;
  routingProviderIn: BillingProvider;
  routingProviderRow: BillingProvider;
}

export interface EffectivePricingSnapshot {
  pricingMarketKey: PricingMarketKey;
  routingProvider: BillingProvider;
  planKey: PlanKey;
  planTierRank: number;
  planVersionId: string | null;
  monthlyIncludedBeats: number;
  billingProvider: BillingProvider | null;
  billingInterval: BillingInterval | null;
  billingCountryCode: string | null;
  currencyCode: string;
  billingStatus: string;
  isInGracePeriod: boolean;
  currentPeriodEndsAt: string | null;
  nextResetAt: string | null;
  storyLengthCap: number;
  canAccessDownloads: boolean;
  canAccessUnbrandedExports: boolean;
  availablePromoBeats: number;
  availableSubscriptionBeats: number;
  availableTopupBeats: number;
  availableTotalBeats: number;
}

export interface PricingRuntimeContext {
  userId: string | null;
  controls: PricingRuntimeControls;
  snapshot: EffectivePricingSnapshot;
}

export interface PricingPlanOfferCard {
  planKey: PlanKey;
  name: string;
  description: string | null;
  tierRank: number;
  currencyCode: string;
  monthlyPlanVersionId: string | null;
  annualPlanVersionId: string | null;
  monthlyProvider: BillingProvider | null;
  annualProvider: BillingProvider | null;
  monthlyPriceMinor: number | null;
  annualPriceMinor: number | null;
  monthlyCoins: number;
  storyLengthCap: number;
  canAccessDownloads: boolean;
  canAccessUnbrandedExports: boolean;
  creatorControls: boolean;
  isCurrentPlan: boolean;
}

export interface PricingTopupOfferCard {
  topupPackId: string;
  packKey: string;
  name: string;
  currencyCode: string;
  priceMinor: number;
  coinAmount: number;
  provider: BillingProvider | null;
}

export interface PricingWalletActivityItem {
  id: string;
  kind: 'grant' | 'spend';
  title: string;
  subtitle: string;
  coinsDelta: number;
  occurredAt: string;
}

export interface PricingWalletPageData {
  pricingMarketKey: PricingMarketKey;
  checkoutEnabled: boolean;
  planOffers: PricingPlanOfferCard[];
  topupOffers: PricingTopupOfferCard[];
  recentActivity: PricingWalletActivityItem[];
}

export type RazorpayCheckoutKind = 'subscription' | 'topup';

export interface PrepareRazorpaySubscriptionCheckoutInput {
  kind: 'subscription';
  planVersionId: string;
}

export interface PrepareRazorpayTopupCheckoutInput {
  kind: 'topup';
  topupPackId: string;
}

export type PrepareRazorpayCheckoutInput =
  | PrepareRazorpaySubscriptionCheckoutInput
  | PrepareRazorpayTopupCheckoutInput;

interface PreparedRazorpayCheckoutBase {
  keyId: string;
  internalOrderId: string;
  displayName: string;
  description: string;
  userName: string | null;
  userEmail: string | null;
}

export interface PreparedRazorpaySubscriptionCheckout extends PreparedRazorpayCheckoutBase {
  kind: 'subscription';
  razorpaySubscriptionId: string;
}

export interface PreparedRazorpayTopupCheckout extends PreparedRazorpayCheckoutBase {
  kind: 'topup';
  razorpayOrderId: string;
  amountMinor: number;
  currencyCode: string;
}

export type PreparedRazorpayCheckout =
  | PreparedRazorpaySubscriptionCheckout
  | PreparedRazorpayTopupCheckout;
