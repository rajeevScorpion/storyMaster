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
  'free_allowance',
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
  'pricing_admin_bypass_enabled',
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
  enabledHelp: string;
  disabledHelp: string;
}

export const PRICING_RUNTIME_SETTING_DEFINITIONS: readonly PricingRuntimeSettingDefinition[] = [
  {
    key: 'pricing_admin_tab_enabled',
    kind: 'boolean',
    defaultEnabled: false,
    defaultValue: null,
    label: 'Show Pricing Workspace',
    description: 'Controls whether admins can see the Pricing and offers area.',
    enabledHelp: 'When this is on, admins can open the Pricing and offers page and make pricing changes.',
    disabledHelp: 'When this is off, the pricing workspace stays hidden from admins.',
  },
  {
    key: 'pricing_snapshot_enabled',
    kind: 'boolean',
    defaultEnabled: false,
    defaultValue: null,
    label: 'Show Live Pricing Info',
    description: 'Controls whether the app reads live plan and wallet information while people use it.',
    enabledHelp: 'When this is on, users can see live plan details like wallet balances, pricing markets, and limits.',
    disabledHelp: 'When this is off, the app behaves as if pricing is not live yet and falls back to the safe defaults.',
  },
  {
    key: 'pricing_checkout_enabled',
    kind: 'boolean',
    defaultEnabled: false,
    defaultValue: null,
    label: 'Allow Checkout',
    description: 'Controls whether users can start a payment from the wallet page.',
    enabledHelp: 'When this is on, users can open checkout for any published paid plan or coin pack that is ready for their market.',
    disabledHelp: 'When this is off, payment buttons stay in coming soon mode and no one can start checkout.',
  },
  {
    key: 'pricing_shadow_metering_enabled',
    kind: 'boolean',
    defaultEnabled: false,
    defaultValue: null,
    label: 'Track Coin Use Quietly',
    description: 'Lets Kissago count coin usage in the background without stopping anyone.',
    enabledHelp: 'When this is on, Kissago records what users would have spent, but it still lets them keep creating.',
    disabledHelp: 'When this is off, Kissago does not record this test usage data.',
  },
  {
    key: 'pricing_hard_enforcement_enabled',
    kind: 'boolean',
    defaultEnabled: false,
    defaultValue: null,
    label: 'Require Coins To Continue',
    description: 'Controls whether a paid action can be stopped when the wallet does not allow it.',
    enabledHelp: 'When this is on, users can be blocked from paid actions if they do not have enough coins.',
    disabledHelp: 'When this is off, no one is blocked for coin reasons.',
  },
  {
    key: 'pricing_admin_bypass_enabled',
    kind: 'boolean',
    defaultEnabled: false,
    defaultValue: null,
    label: 'Let Stage Admin Skip Coin Checks',
    description: 'Gives the configured admin account a safe escape hatch during internal testing.',
    enabledHelp: 'When this is on, the stage admin can keep testing story creation even if coins or checkout are not in the right state.',
    disabledHelp: 'When this is off, the admin account is treated like any other user for coin checks.',
  },
  {
    key: 'pricing_story_length_ui_limits_enabled',
    kind: 'boolean',
    defaultEnabled: false,
    defaultValue: null,
    label: 'Use Plan-Based Story Length Limits',
    description: 'Controls whether story setup shows different length limits for different plans.',
    enabledHelp: 'When this is on, free and paid users see story length choices based on their current plan.',
    disabledHelp: 'When this is off, everyone sees the same story length choices.',
  },
  {
    key: 'pricing_default_grace_period_days',
    kind: 'integer',
    defaultEnabled: false,
    defaultValue: '5',
    label: 'Extra Days After Payment Trouble',
    description: 'Sets how many extra days a paid plan can stay active after a renewal problem.',
    enabledHelp: 'When this is on, Kissago uses the number below as the extra time users keep access after a payment issue.',
    disabledHelp: 'When this is off, Kissago uses the built-in default instead of the number below.',
  },
  {
    key: 'pricing_default_carry_forward_cap_multiplier',
    kind: 'integer',
    defaultEnabled: false,
    defaultValue: '2',
    label: 'Unused Coin Carry Limit',
    description: 'Sets how much unused monthly balance can roll over into the next cycle.',
    enabledHelp: 'When this is on, Kissago uses the number below to limit how much monthly balance can carry forward.',
    disabledHelp: 'When this is off, Kissago uses the built-in carry-forward limit.',
  },
  {
    key: 'pricing_reservation_timeout_seconds',
    kind: 'integer',
    defaultEnabled: false,
    defaultValue: '1800',
    label: 'Coin Hold Timeout',
    description: 'Sets how long coins stay temporarily held before they are released again.',
    enabledHelp: 'When this is on, Kissago uses the number below to decide how long a temporary coin hold stays active.',
    disabledHelp: 'When this is off, Kissago uses the built-in timeout for temporary coin holds.',
  },
  {
    key: 'pricing_migration_grant_beats',
    kind: 'integer',
    defaultEnabled: false,
    defaultValue: '25',
    label: 'Welcome Coins For Existing Users',
    description: 'Sets the one-time coin gift for existing non-admin users during rollout.',
    enabledHelp: 'When this is on, Kissago uses the number below as the welcome coin grant for existing users.',
    disabledHelp: 'When this is off, Kissago uses the built-in rollout grant instead.',
  },
  {
    key: 'pricing_tester_studio_duration_days',
    kind: 'integer',
    defaultEnabled: false,
    defaultValue: '90',
    label: 'Temporary Studio Access Length',
    description: 'Sets how long testers and admins keep temporary Studio access during rollout.',
    enabledHelp: 'When this is on, Kissago uses the number below for temporary Studio access.',
    disabledHelp: 'When this is off, Kissago uses the built-in Studio access length.',
  },
  {
    key: 'pricing_routing_provider_in',
    kind: 'text',
    defaultEnabled: false,
    defaultValue: 'razorpay',
    label: 'India Checkout Provider',
    description: 'Chooses which payment service Kissago should use for users in India.',
    enabledHelp: 'When this is on, Kissago uses the provider below for India checkout.',
    disabledHelp: 'When this is off, Kissago uses the built-in India checkout provider.',
  },
  {
    key: 'pricing_routing_provider_row',
    kind: 'text',
    defaultEnabled: false,
    defaultValue: 'stripe',
    label: 'Outside India Checkout Provider',
    description: 'Chooses which payment service Kissago should use for users outside India.',
    enabledHelp: 'When this is on, Kissago uses the provider below for outside-India checkout.',
    disabledHelp: 'When this is off, Kissago uses the built-in outside-India checkout provider.',
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
  pricingAdminBypassEnabled: boolean;
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
  gracePeriodEndsAt: string | null;
  nextResetAt: string | null;
  storyLengthCap: number;
  canAccessDownloads: boolean;
  canAccessUnbrandedExports: boolean;
  creatorControls: boolean;
  availablePromoBeats: number;
  availableSubscriptionBeats: number;
  availableTopupBeats: number;
  availableTotalBeats: number;
}

export interface PricingRuntimeContext {
  userId: string | null;
  controls: PricingRuntimeControls;
  snapshot: EffectivePricingSnapshot;
  actionCosts: Record<string, number>;
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
  freePlusCharacterSheetsEnabled: boolean;
  creatorCharacterSheetsEnabled: boolean;
  planOffers: PricingPlanOfferCard[];
  topupOffers: PricingTopupOfferCard[];
  recentActivity: PricingWalletActivityItem[];
}

export type PricingAuthorizationDeniedReason =
  | 'sign_in_required'
  | 'insufficient_balance'
  | 'checkout_unavailable';

export type PricingAuthorizationMode = 'soft' | 'shadow' | 'hard';

export interface PricingBillableActionAllowedResult {
  status: 'allowed';
  mode: PricingAuthorizationMode;
  reservationId: string | null;
  beatCost: number;
  coinCost: number;
  availableBeats: number;
  availableCoins: number;
  expiresAt: string | null;
}

export interface PricingBillableActionDeniedResult {
  status: 'denied';
  reason: PricingAuthorizationDeniedReason;
  beatCost: number;
  coinCost: number;
  availableBeats: number;
  availableCoins: number;
}

export interface PricingBillableActionBypassedResult {
  status: 'bypassed';
  reason: 'admin_bypass';
  beatCost: number;
  coinCost: number;
}

export type PricingBillableActionAuthorization =
  | PricingBillableActionAllowedResult
  | PricingBillableActionDeniedResult
  | PricingBillableActionBypassedResult;

export interface AuthorizeBillableActionInput {
  actionKey: PricingActionKey;
  idempotencyKey: string;
  relatedStoryId?: string | null;
  relatedNodeId?: string | null;
  relatedStorylineId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface FinalizeBillableActionInput {
  reservationId: string;
  storyId?: string | null;
  storylineId?: string | null;
  relatedEntityId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ReleaseBillableActionInput {
  reservationId: string;
  reason: string;
  releaseStatus?: 'released' | 'failed' | 'expired';
  metadata?: Record<string, unknown>;
}

export interface FinalizeBillableActionResult {
  reservationId: string;
  usageEventId: string;
  beatCost: number;
  coinCost: number;
}

export interface ReleaseBillableActionResult {
  reservationId: string;
  released: boolean;
  finalStatus: string;
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
