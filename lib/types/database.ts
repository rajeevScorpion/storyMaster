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
  PricingCostFamily,
  PricingMarketKey,
  PromotionMarketScope,
} from './pricing';
import type { ManagedPageAccessLevel, ManagedPageType } from '../managed-pages/types';
import type { BeatMediaStatus } from './beat-media';
import type { ReelPanelCaption, StoryAspectRatio, StoryboardNarrationTiming, StoryKind } from './story';
import type { StoryEffectConfig } from '@/lib/story-effects/settings';
import type { ImageProviderKey } from '@/lib/ai/image-models.shared';
import type {
  StoryTextOverlayAlignment,
  StoryTextOverlayCaption,
  StoryTextOverlayMode,
  StoryTextOverlayStyle,
} from '@/lib/story-overlay/types';

export type StorylineShareCoverSource =
  | 'custom_generated'
  | 'uploaded'
  | 'fallback_beat'
  | 'branded_default'
  | 'migrated_existing';

export type StorylineShareCoverStatus = 'missing' | 'generating' | 'ready' | 'failed';
export type StorylineFormat = 'visual_story' | 'audio_story';
export type StorylineVisualMode = 'with_images' | 'without_images';
export type StorylineOrientation = 'landscape' | 'portrait';

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
  story_kind?: StoryKind;
  is_vertical_story: boolean;
  aspect_ratio: StoryAspectRatio;
  story_map: Record<string, unknown>;
  characters: Record<string, unknown>[] | null;
  setting: Record<string, unknown> | null;
  status: string;
  narrator_voice: string | null;
  narration_voice_mode: string | null;
  narration_voice_gender_bucket: string | null;
  narration_language_code: string | null;
  is_archived: boolean;
  current_node_id: string | null;
  cover_image_url: string | null;
  reel_length_key?: string | null;
  reel_retention_days?: number | null;
  reel_expires_at?: string | null;
  reel_cleanup_status?: string | null;
  reel_deleted_at?: string | null;
  reel_cleanup_last_error?: string | null;
  image_provider_key?: ImageProviderKey | null;
  image_model_key?: string | null;
  image_model_snapshot?: Record<string, unknown> | null;
  visual_profile?: Record<string, unknown> | null;
  episode_branch_id?: string | null;
  episode_number?: number | null;
  parent_story_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbCharacterMaster {
  id: string;
  user_id: string;
  name: string;
  normalized_name: string;
  type: string;
  appearance_summary: string;
  personality_summary: string;
  role_notes: string | null;
  portrait_url: string | null;
  portrait_storage_key: string | null;
  reference_sheet_url: string | null;
  reference_sheet_storage_key: string | null;
  source_type: 'generated_from_story' | 'manual';
  origin_story_id: string | null;
  origin_character_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface DbCharacterNoveltyUsage {
  id: string;
  user_id: string;
  story_id: string;
  character_id: string;
  display_name: string;
  normalized_name: string;
  appearance_signature: string | null;
  name_source: 'ai_generated' | 'user_provided' | 'character_library' | 'episode_carry' | 'legacy';
  language: string | null;
  setting_country: string | null;
  created_at: string;
  last_used_at: string;
}

export interface DbEpisodeBranch {
  id: string;
  user_id: string;
  root_story_id: string | null;
  branch_name: string;
  status: 'active' | 'archived';
  latest_story_id: string | null;
  latest_episode_number: number;
  created_at: string;
  updated_at: string;
}

export interface DbStoryBible {
  id: string;
  branch_id: string;
  user_id: string;
  title: string;
  bible_text: string;
  config_snapshot: Record<string, unknown>;
  generated_model_id: string | null;
  last_generated_at: string | null;
  last_edited_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DbEpisodeJournalEvent {
  id: string;
  branch_id: string;
  user_id: string;
  story_id: string | null;
  event_type: string;
  summary: string;
  payload: Record<string, unknown>;
  sequence_no: number;
  created_at: string;
}

export interface DbStoryline {
  id: string;
  story_id: string;
  user_id: string;
  title: string;
  beat_count: number;
  cover_image_url: string | null;
  is_vertical_story: boolean;
  aspect_ratio: StoryAspectRatio;
  story_kind?: StoryKind;
  node_path: string[];
  beats: Record<string, unknown>[];
  choices: Record<string, unknown>[];
  author_name: string | null;
  is_public: boolean;
  path_hash: string | null;
  like_count: number;
  view_count: number;
  share_cover_url: string | null;
  share_cover_source: StorylineShareCoverSource | null;
  share_cover_status: StorylineShareCoverStatus;
  share_cover_width: number | null;
  share_cover_height: number | null;
  share_cover_mime_type: string | null;
  share_cover_updated_at: string | null;
  share_cover_version: string | null;
  youtube_thumbnail_url: string | null;
  youtube_thumbnail_source: StorylineShareCoverSource | null;
  youtube_thumbnail_status: StorylineShareCoverStatus;
  youtube_thumbnail_width: number | null;
  youtube_thumbnail_height: number | null;
  youtube_thumbnail_mime_type: string | null;
  youtube_thumbnail_updated_at: string | null;
  youtube_thumbnail_version: string | null;
  reel_thumbnail_url: string | null;
  reel_thumbnail_source: StorylineShareCoverSource | null;
  reel_thumbnail_status: StorylineShareCoverStatus;
  reel_thumbnail_width: number | null;
  reel_thumbnail_height: number | null;
  reel_thumbnail_mime_type: string | null;
  reel_thumbnail_updated_at: string | null;
  reel_thumbnail_version: string | null;
  social_cover_prompt: string | null;
  youtube_thumbnail_prompt: string | null;
  reel_thumbnail_prompt: string | null;
  audio_cover_prompt: string | null;
  story_format: StorylineFormat;
  story_visual_mode: StorylineVisualMode;
  orientation: StorylineOrientation;
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
  is_vertical_story: boolean;
  aspect_ratio: StoryAspectRatio;
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
  image_status: BeatMediaStatus;
  image_error: string | null;
  image_provider_key?: ImageProviderKey | null;
  image_model_key?: string | null;
  image_generation_metadata?: Record<string, unknown> | null;
  image_synced_at: string | null;
  image_gallery: Array<{
    url: string;
    storage_key: string;
    uploaded_at: string;
    optimization_metadata?: Record<string, unknown> | null;
  }> | null;
  audio_url: string | null;
  audio_status: BeatMediaStatus;
  audio_error: string | null;
  audio_synced_at: string | null;
  narration_voice_id: string | null;
  narration_metadata?: Record<string, unknown> | null;
  active_narration_preview_id?: string | null;
  is_storyboard: boolean;
  reel_captions?: ReelPanelCaption[] | null;
  storyboard_narration_timing?: StoryboardNarrationTiming | null;
  story_text_overlay_enabled?: boolean | null;
  story_text_overlay_mode?: StoryTextOverlayMode | null;
  story_text_overlay_style?: StoryTextOverlayStyle | null;
  story_text_overlay_captions?: StoryTextOverlayCaption[] | null;
  story_text_overlay_alignment?: StoryTextOverlayAlignment | null;
  story_effects?: StoryEffectConfig | null;
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
  generation_mode: string;
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

export interface DbNarrationVoiceSample {
  id: string;
  voice_id: string;
  gender_bucket: string;
  language_code: string;
  sample_text_hash: string;
  sample_text: string;
  storage_bucket: string;
  storage_path: string | null;
  file_url: string | null;
  duration_ms: number | null;
  generation_status: string;
  generation_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbNarrationPreset {
  id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  provider: 'elevenlabs' | 'gemini_tts';
  model: string;
  voice_id: string;
  language_mode: 'reel_language' | 'auto' | 'custom';
  speed: number;
  stability: number;
  similarity_boost: number;
  style: number;
  speaker_boost: boolean;
  tone: string;
  emotional_intensity: number;
  pacing: string;
  delivery_style: string;
  narration_instruction: string;
  preset_scope: 'system' | 'user';
  preset_visibility: 'private' | 'public';
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbReelNarrationSettings {
  story_id: string;
  user_id: string;
  provider: 'elevenlabs' | 'gemini_tts';
  fallback_provider: 'gemini_tts';
  language: string;
  language_source: 'reel_language' | 'user_selected' | 'auto_detected';
  detected_language: string | null;
  is_mixed_language: boolean;
  voice_id: string;
  model: string;
  preset_id: string | null;
  speed: number;
  stability: number;
  similarity_boost: number;
  style: number;
  speaker_boost: boolean;
  emotional_intensity: number;
  pacing: string;
  tone: string;
  delivery_style: string;
  narration_instruction: string;
  language_mode: 'reel_language' | 'auto' | 'custom';
  use_expressive_tags: boolean;
  use_pronunciation_dictionary: boolean;
  pause_style: string;
  created_at: string;
  updated_at: string;
}

export interface DbNarrationGenerationLog {
  id: string;
  user_id: string | null;
  story_id: string | null;
  node_id: string | null;
  generation_mode: 'preview' | 'final';
  provider_used: 'elevenlabs' | 'gemini_tts';
  fallback_used: boolean;
  selected_voice: string | null;
  selected_model: string | null;
  language: string | null;
  detected_language: string | null;
  is_mixed_language: boolean;
  preset_id: string | null;
  generation_duration_ms: number | null;
  error_message: string | null;
  generated_audio_storage_path: string | null;
  estimated_cost_metadata: Record<string, unknown>;
  created_at: string;
}

export interface DbManagedPage {
  page_key: string;
  title: string;
  slug: string;
  enabled: boolean;
  show_in_footer: boolean;
  footer_order: number;
  open_in_new_tab: boolean;
  access_level: ManagedPageAccessLevel;
  page_type: ManagedPageType;
  seed_version: number;
  content: string;
  excerpt: string | null;
  metadata_json: Record<string, unknown>;
  is_system_page: boolean;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

// Gallery types

export interface GalleryItem {
  id: string;
  /**
   * Retained as a discriminator so cards/keys stay stable, but discovery is
   * storyline-only — raw story trees are no longer surfaced in the feed.
   */
  type: 'storyline';
  title: string;
  coverImageUrl: string | null;
  coverIsStoryboard: boolean;
  isVerticalStory: boolean;
  aspectRatio: StoryAspectRatio;
  authorName: string | null;
  storyId: string;
  beatCount: number | null;
  /** Stored catalogue intro, or a deterministic beat-1 fallback. */
  intro: string | null;
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

export type GalleryLane = 'storylines' | 'vertical';

export interface GalleryFilters {
  search: string;
  type: GalleryLane;
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

/** Card shape a rail renders: 16:9 landscape or 9:16 portrait. */
export type GalleryRailLayout = 'wide' | 'portrait';

export interface GalleryRail {
  key: string;
  title: string;
  layout: GalleryRailLayout;
  items: GalleryItem[];
}

export interface GalleryRailsResponse {
  hero: GalleryItem | null;
  rails: GalleryRail[];
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
  display_name: string | null;
  cost_family: PricingCostFamily;
  billing_unit: string;
  free_enabled: boolean;
  plus_enabled: boolean;
  studio_enabled: boolean;
  metadata_json: Record<string, unknown>;
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
