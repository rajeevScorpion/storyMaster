// Type-only: lib/agentic/reviewers.shared.ts is pure/isomorphic (no server-only,
// no 'use client', no network -- see that file's own header), so importing just
// its type here is erased at build time and safe on either side of the
// client/server boundary, exactly like every other type in this file.
import type { AgentReviewerRole } from '@/lib/agentic/reviewers.shared';
// Payments Phase 2, Unit B2a: the wallet's GST display maths live in wallet-tax.shared.ts (pure,
// isomorphic) so both the server action and the client wallet import the same arithmetic. Imported
// (not redeclared) and re-exported below, so there is exactly one definition.
import type { WalletTaxPreview } from '@/lib/billing/wallet-tax.shared';
export type { WalletTaxPreview };

export const PRICING_MARKET_KEYS = ['IN', 'ROW'] as const;
export type PricingMarketKey = (typeof PRICING_MARKET_KEYS)[number];

export const COINS_PER_BEAT = 10;

export const BILLING_PROVIDERS = ['stripe', 'razorpay'] as const;
export type BillingProvider = (typeof BILLING_PROVIDERS)[number];

export const PLAN_KEYS = ['free', 'audience', 'plus', 'studio'] as const;
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

// Payments Phase 2 (docs/payments/phase-2-plan.md, migration 125): the durable payment/refund/
// document ledger and its GST rules.
export const BILLING_TAX_RULE_APPLIES_TO = ['all', 'subscription', 'topup'] as const;
export type BillingTaxRuleAppliesTo = (typeof BILLING_TAX_RULE_APPLIES_TO)[number];

export const BILLING_TAX_REGIMES = ['in_gst', 'none'] as const;
export type BillingTaxRegime = (typeof BILLING_TAX_REGIMES)[number];

export const BILLING_PAYMENT_KINDS = ['topup', 'subscription_first', 'subscription_renewal'] as const;
export type BillingPaymentKind = (typeof BILLING_PAYMENT_KINDS)[number];

export const BILLING_PAYMENT_STATUSES = ['captured', 'failed', 'refunded', 'partially_refunded', 'disputed'] as const;
export type BillingPaymentStatus = (typeof BILLING_PAYMENT_STATUSES)[number];

export const BILLING_METHOD_CATEGORIES = [
  'card', 'upi', 'netbanking', 'wallet', 'emi', 'paylater', 'other', 'unknown',
] as const;
export type BillingMethodCategory = (typeof BILLING_METHOD_CATEGORIES)[number];

export const BILLING_REFUND_STATUSES = ['pending', 'processed', 'failed'] as const;
export type BillingRefundStatus = (typeof BILLING_REFUND_STATUSES)[number];

export const BILLING_REFUND_INITIATORS = ['user', 'admin', 'provider', 'dispute'] as const;
export type BillingRefundInitiator = (typeof BILLING_REFUND_INITIATORS)[number];

export const BILLING_DOCUMENT_TYPES = ['receipt', 'tax_invoice', 'credit_note'] as const;
export type BillingDocumentType = (typeof BILLING_DOCUMENT_TYPES)[number];

export const BILLING_DOCUMENT_STATUSES = ['issued', 'void'] as const;
export type BillingDocumentStatus = (typeof BILLING_DOCUMENT_STATUSES)[number];

export const ACCOUNT_DELETION_ACTORS = ['user', 'admin'] as const;
export type AccountDeletionActor = (typeof ACCOUNT_DELETION_ACTORS)[number];

export const ACCOUNT_DELETION_STATUSES = ['started', 'completed', 'failed'] as const;
export type AccountDeletionStatus = (typeof ACCOUNT_DELETION_STATUSES)[number];

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
  'start_story_initial_beat_prompt_only',
  'start_reel_full_generation',
  'start_reel_full_generation_prompt_only',
  'continue_story_new_beat',
  'continue_story_new_beat_prompt_only',
  'preview_seed_plan',
  'regenerate_image',
  'regenerate_narration',
  'generate_social_share_cover',
  'generate_audio_story_cover',
  'generate_reel_thumbnail',
  'batch_image_generation',
  'export_video_future',
  'adopt_character_reference',
  'adopt_world_reference',
  'visualize_world_reference',
  'analyze_direct_reference',
  'image_generation',
  'generate_story_narration',
  'generate_reel_narration',
  'generate_narration_preview',
  'align_story_text_overlay',
  'transcribe_audio_stt',
  'export_video_sd',
  'export_video_hd',
] as const;
export type PricingActionKey = (typeof PRICING_ACTION_KEYS)[number];

export const PRICING_COST_FAMILIES = [
  'text',
  'image',
  'tts',
  'alignment',
  'export',
  'reference',
  'other',
] as const;
export type PricingCostFamily = (typeof PRICING_COST_FAMILIES)[number];

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
  'pricing_india_only_beta_enabled',
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
  {
    key: 'pricing_india_only_beta_enabled',
    kind: 'boolean',
    defaultEnabled: true,
    defaultValue: null,
    label: 'India-Only Beta',
    description: 'Limits paid beta checkout to India while the first public test is running.',
    enabledHelp: 'When this is on, only India plan and coin-pack checkout can start.',
    disabledHelp: 'When this is off, checkout availability follows the configured market providers.',
  },
] as const;

export const VIDEO_EXPORT_VERTICAL_RESOLUTIONS = ['720x1280', '1080x1920'] as const;
export type VideoExportVerticalResolution = (typeof VIDEO_EXPORT_VERTICAL_RESOLUTIONS)[number];

export const VIDEO_EXPORT_WATERMARK_MODES = ['auto', 'always', 'hidden'] as const;
export type VideoExportWatermarkMode = (typeof VIDEO_EXPORT_WATERMARK_MODES)[number];

export const VIDEO_EXPORT_WATERMARK_POSITIONS = ['top-left', 'top-right'] as const;
export type VideoExportWatermarkPosition = (typeof VIDEO_EXPORT_WATERMARK_POSITIONS)[number];

export const VIDEO_EXPORT_WATERMARK_SIZES = ['small', 'medium', 'large'] as const;
export type VideoExportWatermarkSize = (typeof VIDEO_EXPORT_WATERMARK_SIZES)[number];

export interface VideoExportPreset {
  verticalResolution: VideoExportVerticalResolution;
  watermarkMode: VideoExportWatermarkMode;
  watermarkPosition: VideoExportWatermarkPosition;
  watermarkSize: VideoExportWatermarkSize;
}

export const DEFAULT_VIDEO_EXPORT_PRESET: VideoExportPreset = {
  verticalResolution: '720x1280',
  watermarkMode: 'auto',
  watermarkPosition: 'top-left',
  watermarkSize: 'medium',
};

export interface PricingPlanFeatureFlags {
  canAccessDownloads?: boolean;
  canAccessUnbrandedExports?: boolean;
  creatorControls?: boolean;
  videoExportPreset?: Partial<VideoExportPreset> | null;
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
  indiaOnlyBetaEnabled: boolean;
}

export interface EffectivePricingSnapshot {
  pricingMarketKey: PricingMarketKey;
  routingProvider: BillingProvider;
  /** Billing truth: what the user actually pays for. Drives plan/wallet display. */
  planKey: PlanKey;
  /**
   * What every free/plus/studio feature gate reads. Equals `planKey` unless an
   * admin promoted the account (or it is the admin account). Access only —
   * coin costs and wallet balance are unaffected.
   */
  entitlementPlanKey: PlanKey;
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
  videoExportPreset: VideoExportPreset;
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
  meterEntitlements: Record<string, boolean>;
  /**
   * The CURRENT user's own reviewer standing (D20,
   * docs/agentic-creator-phase9c-plan.md section 4.1), or `null` for everyone
   * else -- almost everyone. Rides this already-fetched, already-cached payload
   * on purpose so UserMenu's badge, count bubble, and "Review queue" link cost
   * zero additional requests; resolved by lib/agentic/reviewers.ts's
   * resolveMyReviewerStanding(), which fails closed to `null` rather than
   * throwing. Carries ONLY `{ role, assignedCount }` -- never `notes`, never
   * another account's standing (see `245588e`).
   *
   * `assignedCount` (Phase 10 Round 3, 5.4) is the number of this reviewer's own
   * active assignments whose run is still awaiting review -- not an all-time
   * total. It degrades to 0 on its own failure paths (see
   * resolveMyReviewerStanding's doc comment) rather than making `reviewer` itself
   * `null` -- a count failure costs the bubble, never the badge.
   */
  reviewer: { role: AgentReviewerRole; assignedCount: number } | null;
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
  videoExportPreset: VideoExportPreset;
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

function isStringArrayValue<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && options.includes(value as T);
}

export function normalizeVideoExportPreset(value: unknown): VideoExportPreset {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};

  return {
    verticalResolution: isStringArrayValue(input.verticalResolution, VIDEO_EXPORT_VERTICAL_RESOLUTIONS)
      ? input.verticalResolution
      : DEFAULT_VIDEO_EXPORT_PRESET.verticalResolution,
    watermarkMode: isStringArrayValue(input.watermarkMode, VIDEO_EXPORT_WATERMARK_MODES)
      ? input.watermarkMode
      : DEFAULT_VIDEO_EXPORT_PRESET.watermarkMode,
    watermarkPosition: isStringArrayValue(input.watermarkPosition, VIDEO_EXPORT_WATERMARK_POSITIONS)
      ? input.watermarkPosition
      : DEFAULT_VIDEO_EXPORT_PRESET.watermarkPosition,
    watermarkSize: isStringArrayValue(input.watermarkSize, VIDEO_EXPORT_WATERMARK_SIZES)
      ? input.watermarkSize
      : DEFAULT_VIDEO_EXPORT_PRESET.watermarkSize,
  };
}

export function resolveVideoExportWatermarkVisibility(
  preset: VideoExportPreset,
  canAccessUnbrandedExports: boolean
): boolean {
  if (preset.watermarkMode === 'always') return true;
  if (preset.watermarkMode === 'hidden') return false;
  return !canAccessUnbrandedExports;
}

export interface PricingWalletPageData {
  freePlusCharacterSheetsEnabled: boolean;
  creatorCharacterSheetsEnabled: boolean;
  storyCount: number;
  storylineCount: number;
  planOffers: PricingPlanOfferCard[];
  topupOffers: PricingTopupOfferCard[];
  recentActivity: PricingWalletActivityItem[];
  // Payments Phase 2, Unit B2a: only populated for a signed-in user (see getPricingWalletPageData).
  billingProfile: BillingProfileDTO | null;
  /** null when migration 125 is absent -- the wallet then behaves exactly as it does today. */
  taxPreview: WalletTaxPreview | null;
}

export type PricingAuthorizationDeniedReason =
  | 'sign_in_required'
  | 'account_restricted'
  | 'insufficient_balance'
  | 'checkout_unavailable'
  | 'tier_locked'
  | 'feature_disabled'
  | 'pricing_unavailable';

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
  reason: 'admin_bypass' | 'agentic_system';
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

// Payments Phase 2 (docs/payments/phase-2-plan.md §4, Unit B): the billing profile a customer fills
// in once -- required before checkout so tax has a place of supply, and reused later for issued
// documents (Phase 6). Defined here, not in lib/billing/billing-profile.ts (server-only) or the
// 'use server' action, so Unit B2's client-side form can import the same shapes.
export interface BillingProfileInput {
  legalName: string;
  billingEmail?: string | null;
  phone?: string | null;
  companyName?: string | null;
  /** Validated against lib/billing/india-states.shared.ts's GSTIN_REGEX before it ever reaches the DB. */
  gstin?: string | null;
  /** A code from lib/billing/india-states.shared.ts's INDIA_GST_STATE_CODES -- the checkout place of supply. */
  stateCode: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  postalCode?: string | null;
}

export interface BillingProfileDTO {
  id: string;
  legalName: string;
  billingEmail: string | null;
  phone: string | null;
  companyName: string | null;
  gstin: string | null;
  stateCode: string;
  countryCode: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postalCode: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 'unavailable' means migration 125 hasn't run on this database yet (plan §4/§7) -- the caller
 * should treat this the same as "no profile filled in yet" for display purposes, but must not offer
 * to save one until 125 is applied. */
export type GetBillingProfileResult =
  | { status: 'ok'; profile: BillingProfileDTO | null }
  | { status: 'unavailable' };

export type SaveBillingProfileResult =
  | { status: 'ok'; profile: BillingProfileDTO }
  | { status: 'unavailable' }
  | { status: 'invalid'; message: string };

// Payments Phase 2, Unit B2b: the admin tax-rules panel over billing_tax_rules (migration 125).
// Camel-cased DTO mirrors BillingProfileDTO above -- lib/billing/tax-rules-admin.ts (server-only)
// maps DbBillingTaxRule rows to this shape so the 'use server' action and the admin panel never need
// to import lib/types/database.ts directly.
export interface TaxRuleAdminRecord {
  id: string;
  marketKey: string;
  appliesTo: BillingTaxRuleAppliesTo;
  taxRegime: BillingTaxRegime;
  ratePercent: number;
  sacCode: string | null;
  supplierStateCode: string;
  status: PricingCatalogStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Input to create (no `id`) or update (`id` of an existing *draft*) a tax rule. */
export interface TaxRuleDraftInput {
  id?: string | null;
  marketKey: PricingMarketKey;
  appliesTo: BillingTaxRuleAppliesTo;
  taxRegime: BillingTaxRegime;
  ratePercent: number;
  sacCode?: string | null;
  /** A code from lib/billing/india-states.shared.ts's INDIA_GST_STATE_CODES. */
  supplierStateCode: string;
  notes?: string | null;
}

/** 'unavailable' means migration 125 hasn't run on this database yet -- mirrors GetBillingProfileResult. */
export type TaxRuleAdminListResult =
  | { status: 'ok'; rules: TaxRuleAdminRecord[] }
  | { status: 'unavailable' };

export type TaxRuleAdminMutationResult =
  | { status: 'ok'; rules: TaxRuleAdminRecord[]; rule: TaxRuleAdminRecord }
  | { status: 'unavailable' }
  | { status: 'invalid'; message: string }
  /** A concurrent publish already took the (market_key, applies_to) slot -- uq_billing_tax_rules_live
   * (125_billing_ledger_and_retention.sql) raised 23505. Surfaced as a message, never a raw PG error. */
  | { status: 'conflict'; message: string };
