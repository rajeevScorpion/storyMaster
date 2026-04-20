import type {
  BeatGrantSourceType,
  BeatReservationStatus,
  BillingInterval,
  BillingOrderType,
  BillingProvider,
  BillingWebhookEventStatus,
  PlanKey,
  PricingActionKey,
  PricingAuditActionType,
  PricingAuditEntityType,
  PricingCatalogStatus,
  PricingMarketKey,
  PromotionMarketScope,
} from './pricing';

export interface DbProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface DbStory {
  id: string;
  user_id: string;
  title: string;
  user_prompt: string;
  genre: string | null;
  tone: string | null;
  visual_style: string | null;
  target_age: string | null;
  story_config: Record<string, unknown> | null;
  story_map: Record<string, unknown>;
  characters: Record<string, unknown>[] | null;
  setting: Record<string, unknown> | null;
  status: string;
  narrator_voice: string | null;
  is_archived: boolean;
  current_node_id: string | null;
  cover_image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbStoryline {
  id: string;
  story_id: string;
  user_id: string;
  title: string;
  beat_count: number;
  cover_image_url: string | null;
  node_path: string[];
  beats: Record<string, unknown>[];
  choices: Record<string, unknown>[];
  author_name: string | null;
  is_public: boolean;
  path_hash: string | null;
  like_count: number;
  view_count: number;
  created_at: string;
}

export interface GalleryStoryline {
  id: string;
  title: string;
  cover_image_url: string | null;
  cover_is_storyboard: boolean;
  beat_count: number;
  author_name: string | null;
  story_id: string | null;
  like_count: number;
  view_count: number;
  created_at: string;
}

export interface DbBeat {
  id: string;
  story_id: string;
  node_id: string;
  beat_number: number;
  parent_node_id: string | null;
  selected_option_id: string | null;
  generated_by: string | null;
  title: string;
  is_ending: boolean;
  story_text: string;
  scene_summary: string | null;
  options: Record<string, unknown>[] | null;
  characters: Record<string, unknown>[] | null;
  continuity_notes: string[] | null;
  image_prompt: string | null;
  clues: string[] | null;
  next_beat_goal: string | null;
  ending_forecast: string[] | null;
  image_url: string | null;
  audio_url: string | null;
  is_storyboard: boolean;
  origin_kind: string | null;
  seed_plan_beat_index: number | null;
  canonical_option_id: string | null;
  created_at: string;
}

export interface DbStorylineBeat {
  id: string;
  storyline_id: string;
  beat_id: string;
  position: number;
  choice_label: string | null;
}

export interface DbSavedStoryline {
  id: string;
  user_id: string;
  storyline_id: string;
  saved_at: string;
}

export interface DbExploredStory {
  id: string;
  user_id: string;
  story_id: string;
  last_node_id: string | null;
  explored_at: string;
  updated_at: string;
}

export interface DbAiCostEvent {
  id: string;
  user_id: string | null;
  story_id: string | null;
  beat_id: string | null;
  storyline_id: string | null;
  node_id: string | null;
  story_session_id: string | null;
  activity_key: string;
  task_key: string;
  provider: string;
  model_id: string;
  status: 'success' | 'failed';
  input_tokens: number;
  output_tokens: number;
  image_count: number;
  image_size: string | null;
  audio_seconds: number | null;
  estimated_cost_usd: number;
  latency_ms: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// Gallery types

export interface GalleryItem {
  id: string;
  type: 'tree' | 'storyline';
  title: string;
  coverImageUrl: string | null;
  coverIsStoryboard: boolean;
  authorName: string | null;
  storyId: string;
  beatCount: number | null;
  genre: string | null;
  ageGroup: string | null;
  settingCountry: string | null;
  likeCount: number;
  viewCount: number;
  createdAt: string;
}

export interface DbStorylineLike {
  id: string;
  user_id: string;
  storyline_id: string;
  created_at: string;
}

export interface DbStorylineView {
  id: string;
  user_id: string;
  storyline_id: string;
  viewed_at: string;
}

export interface GalleryFilters {
  search: string;
  type: 'storylines' | 'trees';
  genre: string;
  ageGroup: string;
  country: string;
  language: string;
}

export interface GalleryPage {
  items: GalleryItem[];
  total: number;
  hasMore: boolean;
}

export interface GenreSection {
  genre: string;
  items: GalleryItem[];
}

export interface DbPricingPlan {
  id: string;
  plan_key: PlanKey;
  name: string;
  tier_rank: number;
  is_active: boolean;
  is_public: boolean;
  description: string | null;
  feature_flags_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DbPricingPlanVersion {
  id: string;
  plan_id: string;
  status: PricingCatalogStatus;
  provider: BillingProvider | null;
  billing_interval: BillingInterval;
  currency_code: string;
  pricing_market_key: PricingMarketKey;
  price_minor: number;
  monthly_included_beats: number;
  carry_forward_cap_multiplier: number;
  story_length_cap: number;
  grace_period_days: number;
  provider_product_ref: string | null;
  provider_price_ref: string | null;
  extensions_json: Record<string, unknown>;
  published_at: string | null;
  published_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbPricingTopupPack {
  id: string;
  pack_key: string;
  status: PricingCatalogStatus;
  provider: BillingProvider | null;
  name: string;
  currency_code: string;
  pricing_market_key: PricingMarketKey;
  price_minor: number;
  beat_amount: number;
  provider_product_ref: string | null;
  provider_price_ref: string | null;
  extensions_json: Record<string, unknown>;
  published_at: string | null;
  published_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbPricingActionCost {
  id: string;
  action_key: PricingActionKey | string;
  beat_cost: number;
  is_active: boolean;
  effective_from: string;
  effective_to: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface DbPricingPromotion {
  id: string;
  promo_key: string;
  name: string;
  status: PricingCatalogStatus;
  pricing_market_scope: PromotionMarketScope;
  target_plan_key: PlanKey | null;
  target_user_segment: string | null;
  bonus_beats: number;
  starts_at: string | null;
  ends_at: string | null;
  promo_config_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DbPricingPublishAudit {
  id: string;
  entity_type: PricingAuditEntityType;
  entity_id: string | null;
  action_type: PricingAuditActionType;
  performed_by: string | null;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}

export interface DbBillingCustomer {
  id: string;
  user_id: string;
  provider: BillingProvider;
  provider_customer_id: string;
  pricing_market_key: PricingMarketKey;
  country_code: string | null;
  currency_code: string;
  created_at: string;
  updated_at: string;
}

export interface DbBillingSubscription {
  id: string;
  user_id: string;
  plan_version_id: string;
  provider: BillingProvider;
  provider_subscription_id: string;
  provider_customer_id: string;
  status: string;
  billing_interval: BillingInterval;
  currency_code: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  grace_period_ends_at: string | null;
  last_webhook_at: string | null;
  raw_provider_state_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DbBillingOrder {
  id: string;
  user_id: string;
  provider: BillingProvider;
  order_type: BillingOrderType;
  provider_checkout_session_id: string | null;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  currency_code: string;
  amount_minor: number;
  status: string;
  plan_version_id: string | null;
  topup_pack_id: string | null;
  raw_provider_payload_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DbBillingWebhookEvent {
  id: string;
  provider: BillingProvider;
  event_type: string;
  provider_event_id: string;
  provider_account_id: string | null;
  status: BillingWebhookEventStatus;
  related_user_id: string | null;
  related_subscription_id: string | null;
  payload_json: Record<string, unknown>;
  received_at: string;
  processed_at: string | null;
  error_message: string | null;
}

export interface DbBeatGrant {
  id: string;
  user_id: string;
  source_type: BeatGrantSourceType;
  source_ref_id: string | null;
  currency_code: string | null;
  beats_total: number;
  beats_remaining: number;
  expires_at: string | null;
  granted_at: string;
  metadata_json: Record<string, unknown>;
}

export interface DbBeatSpendReservation {
  id: string;
  user_id: string;
  action_key: PricingActionKey | string;
  requested_beat_cost: number;
  status: BeatReservationStatus;
  idempotency_key: string;
  related_story_id: string | null;
  related_node_id: string | null;
  related_storyline_id: string | null;
  usage_event_id: string | null;
  expires_at: string;
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DbBeatUsageEvent {
  id: string;
  user_id: string;
  action_key: PricingActionKey | string;
  beat_cost: number;
  story_id: string | null;
  beat_id: string | null;
  storyline_id: string | null;
  related_entity_id: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
}

export interface DbBeatUsageAllocation {
  id: string;
  usage_event_id: string;
  beat_grant_id: string;
  beats_consumed: number;
  created_at: string;
}
