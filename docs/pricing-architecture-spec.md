# Pricing Architecture Spec

Date: 2026-04-06
Branch: `pricing`
Status: Phase 2 architecture baseline frozen

## Purpose

This document translates the frozen pricing strategy into a concrete architecture direction for implementation planning.

It does not start coding work. Its job is to reduce ambiguity around:

- admin pricing configuration
- billing-provider integration shape
- user entitlement modeling
- beat wallet accounting
- tier-aware UI behavior

## Phase 2 Decisions Frozen So Far

- India should use `INR` pricing and route to Razorpay first
- outside India should use `USD` pricing and route to Stripe first
- pricing configuration should use a broader `pricing_market` concept such as `IN` and `ROW`
- catalog-style pricing changes should use `draft` and `publish`
- operational controls should save immediately
- wallet accounting should use explicit beat-grant buckets plus usage allocations
- the `free` plan should live in the same versioned catalog as paid plans
- provider webhook events should be stored in an append-only raw events table in v1
- scheduled activation for future price changes is not required in v1
- catalog schemas should stay mostly structured, with only small JSONB escape hatches for optional extensions
- `billing_orders` should explicitly store provider checkout or session identifiers in v1
- promotions should be single-application only in v1, not stackable
- live pricing publish should require a two-step confirmation in admin
- launch promotion targeting should stay mostly structured through fields like `pricing_market_scope`, `target_plan_key`, and `target_user_segment`
- beat grant expiry should be governed by database state such as `expires_at`, while application services compute the current spendable snapshot from that source of truth
- pricing publish history should use a separate append-only audit table in v1
- the effective pricing snapshot should be recomputed on demand in v1
- admin pricing publish should show a draft-versus-live diff preview before the final confirmation step
- beat spending should be enforced through an idempotent service layer that wraps transactional writes
- regeneration should not get a separate cap in v1
- tier limits should affect setup UI directly

## Architecture Principles

### 1. Separate business configuration from billing state

Admin-managed plan definitions should not be the same thing as provider subscription records.

We need a clear split between:

- pricing catalog controlled by admins
- provider lifecycle state mirrored from Stripe and Razorpay
- user wallet and beat accounting

### 2. Avoid a single mutable beat balance

A single `balance` integer is too fragile for:

- carry-forward caps
- expiring promo beats
- non-expiring purchased beats
- plan downgrades
- post-facto billing reconciliation

The safer model is:

- beat grants define where beats came from
- usage events define what spent beats
- usage allocations show which grants funded which usage

### 3. Keep the admin experience fast

The admin playground should remain the main surface, but pricing needs its own internal workspace.

Recommended workspace sections:

- `Plans`
- `Top-ups`
- `Action Costs`
- `Promotions`
- `Wallet Rules`
- `Billing Routing`

### 4. Let the UI consume an effective entitlement snapshot

The frontend should not stitch together raw plans, grants, and provider state on its own.

Instead, server-side pricing actions should return an effective user pricing snapshot such as:

- current plan tier
- active billing status
- effective story-length cap
- available spendable beats
- upcoming reset date
- whether the user is in grace period
- whether paid-only export rights are active

## Recommended Data Model

### A. Pricing catalog

These tables are admin-authored.

#### `pricing_plans`

One row per plan family.

Recommended fields:

- `id`
- `plan_key`
- `name`
- `tier_rank`
- `is_active`
- `is_public`
- `description`
- `feature_flags_json`
- `created_at`
- `updated_at`

Structured-column rule:

- core commercial and entitlement fields should remain first-class columns
- JSONB should only be used for optional future extensions that are not needed in launch queries or validations

Example `plan_key` values:

- `free`
- `plus`
- `studio`

#### `pricing_plan_versions`

Versioned commercial definition for a plan.

Recommended fields:

- `id`
- `plan_id`
- `status` (`draft`, `published`, `archived`)
- `billing_interval` (`monthly`, `annual`)
- `currency_code`
- `pricing_market_key`
- `price_minor`
- `monthly_included_beats`
- `carry_forward_cap_multiplier`
- `story_length_cap`
- `grace_period_days`
- `provider_product_ref`
- `provider_price_ref`
- `extensions_json`
- `published_at`
- `published_by`
- `created_at`
- `updated_at`

Notes:

- `IN` and `ROW` are the recommended launch pricing-market keys
- `INR` variants would map to `IN`
- `USD` variants would map to `ROW`
- annual plans still grant beats monthly, so `monthly_included_beats` remains the operational grant amount

#### `pricing_topup_packs`

Admin-defined one-time purchasable beat packs.

Recommended fields:

- `id`
- `pack_key`
- `status` (`draft`, `published`, `archived`)
- `name`
- `currency_code`
- `pricing_market_key`
- `price_minor`
- `beat_amount`
- `provider_product_ref`
- `provider_price_ref`
- `extensions_json`
- `published_at`
- `published_by`
- `created_at`
- `updated_at`

#### `pricing_action_costs`

Defines beat cost for spendable actions.

Recommended fields:

- `id`
- `action_key`
- `beat_cost`
- `is_active`
- `effective_from`
- `effective_to`
- `updated_at`
- `updated_by`

Example `action_key` values:

- `continue_story`
- `regenerate_image`
- `regenerate_narration`
- `export_video_future`

#### `pricing_promotions`

Date-window or campaign-based overrides.

Recommended fields:

- `id`
- `promo_key`
- `name`
- `status`
- `pricing_market_scope`
- `target_plan_key`
- `target_user_segment`
- `bonus_beats`
- `starts_at`
- `ends_at`
- `promo_config_json`
- `created_at`
- `updated_at`

Good uses:

- free-user holiday bonus beats
- limited-time top-up boosts
- classroom event windows later

Promotion rule for v1:

- promotions should be single-application only
- no stackable promo logic in v1
- launch targeting should stay mostly structured through the existing market, plan, and segment fields
- `promo_config_json` should be reserved for future niche targeting or campaign metadata

### B. Operational pricing controls

These are admin-tuned knobs and can stay immediate-save.

Two implementation options are reasonable:

1. Keep them in `feature_flags` for v1.
2. Move them into a dedicated `pricing_runtime_settings` table.

My recommendation:

- keep simple global controls in `feature_flags` for v1 to reduce surface area
- reserve dedicated tables for catalog data and user accounting

Good candidates to stay in `feature_flags` initially:

- default grace-period days
- carry-forward default cap
- billing region routing defaults
- temporary free-user bonus toggles

### C. Billing provider mirror state

These tables should represent what Stripe and Razorpay say happened, without forcing provider logic into the plan catalog.

#### `billing_customers`

Recommended fields:

- `id`
- `user_id`
- `provider` (`stripe`, `razorpay`)
- `provider_customer_id`
- `pricing_market_key`
- `country_code`
- `currency_code`
- `created_at`
- `updated_at`

#### `billing_subscriptions`

Recommended fields:

- `id`
- `user_id`
- `plan_version_id`
- `provider`
- `provider_subscription_id`
- `provider_customer_id`
- `status`
- `billing_interval`
- `currency_code`
- `current_period_start`
- `current_period_end`
- `cancel_at_period_end`
- `grace_period_ends_at`
- `last_webhook_at`
- `raw_provider_state_json`
- `created_at`
- `updated_at`

Important rule:

- this table mirrors provider lifecycle
- it does not directly replace wallet accounting

#### `billing_orders`

Recommended fields:

- `id`
- `user_id`
- `provider`
- `order_type` (`subscription_checkout`, `topup_checkout`)
- `provider_checkout_session_id`
- `provider_order_id`
- `provider_payment_id`
- `currency_code`
- `amount_minor`
- `status`
- `plan_version_id`
- `topup_pack_id`
- `raw_provider_payload_json`
- `created_at`
- `updated_at`

This gives us a clean audit trail for one-time top-up purchases and hosted checkout sessions.

Session-traceability rule:

- hosted checkout and provider session identifiers should be stored explicitly in v1
- this makes support, webhook replay, and payment reconciliation easier

#### `billing_webhook_events`

Append-only raw event storage for webhook safety and reconciliation.

Recommended fields:

- `id`
- `provider`
- `event_type`
- `provider_event_id`
- `provider_account_id`
- `status` (`received`, `processed`, `failed`, `ignored`)
- `related_user_id`
- `related_subscription_id`
- `payload_json`
- `received_at`
- `processed_at`
- `error_message`

Why this belongs in v1:

- webhook debugging is much easier
- replay and reconciliation become safer
- dual-provider billing drift is easier to trace

#### `pricing_publish_audit`

Append-only audit history for commercially sensitive admin pricing changes.

Recommended fields:

- `id`
- `entity_type` (`plan_version`, `topup_pack`, `action_cost`, `promotion`, `runtime_setting`)
- `entity_id`
- `action_type` (`create_draft`, `update_draft`, `publish`, `archive`, `immediate_update`)
- `performed_by`
- `before_json`
- `after_json`
- `reason`
- `created_at`

Why this belongs in v1:

- pricing changes are commercially sensitive and deserve a dedicated audit trail
- version rows alone do not cleanly capture all admin actions or immediate-save runtime updates
- support and finance investigations become much easier

### D. Beat wallet and accounting

This is the most important part of the design.

#### `beat_grants`

Each row is a grant bucket.

Recommended fields:

- `id`
- `user_id`
- `source_type` (`subscription`, `carry_forward`, `topup`, `promotion`, `admin_adjustment`)
- `source_ref_id`
- `currency_code`
- `beats_total`
- `beats_remaining`
- `expires_at`
- `granted_at`
- `metadata_json`

Behavior examples:

- monthly subscription grant: expiring or capped by carry-forward policy
- carry-forward grant: separate bucket created at renewal time
- top-up grant: non-expiring
- promotion grant: expiring

Expiry authority rule:

- database state on each grant bucket is the source of truth for expiry
- application services should compute the effective spendable wallet view from that database state
- expiry should not depend on client-side inference

#### `beat_spend_reservations`

Reservation records for pre-authorized spend attempts.

Recommended fields:

- `id`
- `user_id`
- `action_key`
- `requested_beat_cost`
- `status` (`pending`, `finalized`, `released`, `failed`, `expired`)
- `idempotency_key`
- `related_story_id`
- `related_node_id`
- `related_storyline_id`
- `usage_event_id`
- `expires_at`
- `metadata_json`
- `created_at`
- `updated_at`

Why this belongs in the design:

- the reservation-and-release model needs a first-class record of attempted spend
- retries become much safer when idempotency is anchored to a reservation row
- failed or abandoned generation attempts can be released cleanly without mutating usage history

#### `beat_usage_events`

Each row is a spend attempt that succeeded.

Recommended fields:

- `id`
- `user_id`
- `action_key`
- `beat_cost`
- `story_id`
- `beat_id`
- `storyline_id`
- `related_entity_id`
- `metadata_json`
- `created_at`

This gives product and finance a clean spend history.

#### `beat_usage_allocations`

Maps one spend event across one or more grant buckets.

Recommended fields:

- `id`
- `usage_event_id`
- `beat_grant_id`
- `beats_consumed`
- `created_at`

This is what makes the wallet safe.

It lets us:

- consume promo beats first
- then consume subscription beats
- then consume purchased top-up beats
- explain exactly where every spent beat came from

Spend enforcement rule:

- beat spending should flow through an idempotent service layer
- that service should wrap transactional writes for usage events, grant updates, and allocation rows
- direct ad hoc writes from app code should be avoided

## Effective User Pricing Snapshot

The app should compute and use a normalized view for the current user.

Snapshot rule for v1:

- recompute the effective pricing snapshot on demand from the source tables
- do not introduce long-lived cached pricing snapshots in v1
- short-term server-side caching with explicit invalidation can be added later if it becomes necessary

Recommended fields in the server-computed snapshot:

- `planKey`
- `planTierRank`
- `billingProvider`
- `billingCountryCode`
- `currencyCode`
- `billingStatus`
- `isInGracePeriod`
- `currentPeriodEndsAt`
- `nextResetAt`
- `storyLengthCap`
- `canAccessDownloads`
- `canAccessUnbrandedExports`
- `availablePromoBeats`
- `availableSubscriptionBeats`
- `availableTopupBeats`
- `availableTotalBeats`

Primary consumers would later include:

- story setup slider
- upgrade prompts
- checkout surfaces
- account and billing UI
- future export actions

## Admin Playground Direction

The route should remain `/admin/playground`, but pricing should become a first-class internal tab.

Recommended structure:

- `Prompt Playground`
- `Pricing`

Recommended pricing tab sections:

### `Catalog`

- plans
- annual vs monthly variants
- region/currency variants
- top-up packs
- draft vs published state

### `Action Costs`

- beat cost per action
- future export action pricing

### `Promotions`

- date windows
- target segments
- bonus beats
- structured targeting fields first

### `Wallet Rules`

- grace-period default
- carry-forward cap default
- bucket-consumption order display

### `Routing`

- India -> Razorpay default
- outside India -> Stripe default
- future admin override knobs

Publish safety rule:

- publishing live plan and top-up changes should require a second explicit confirmation step
- immediate-save controls should remain reserved for operational runtime knobs
- the publish flow should show a human-readable diff between draft and live values before final confirmation

## Recommended UI Impact Areas

### Story setup

- replace hardcoded beat slider bounds with pricing-context bounds
- when free users exceed their tier cap, show upgrade prompt instead of accepting the change

### Checkout

- minimal single-page purchase screen
- explicit country selection
- provider chosen based on region rule

### Account status

- show current plan
- available beats
- reset date
- grace-period status when relevant

## Tradeoffs

### Why not keep everything in `feature_flags`?

Because:

- versioned pricing is awkward there
- provider references become messy
- top-up packs and promotions need structured lifecycle handling
- auditability becomes weak

### Why not a single wallet balance?

Because:

- expiry logic becomes brittle
- carry-forward becomes opaque
- top-up and promo behavior becomes hard to reason about
- support and finance lose traceability

### Why not derive everything from a pure immutable ledger only?

That is viable, but more expensive to query repeatedly in app code.

The recommended compromise is:

- immutable spend history
- explicit remaining amounts on grant buckets
- deterministic allocation records for auditability

## Open Questions For Next Refinement Pass

- which existing runtime actions should be metered in the very first spend-enforced rollout
- whether grant-consumption priority should stay fixed in code for v1 or become admin-configurable later
- how renewal-time carry-forward grants should be created operationally: webhook-driven, scheduled job, or hybrid fallback
