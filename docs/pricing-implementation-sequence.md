# Pricing Implementation Sequence

Date: 2026-04-06
Branch: `pricing`
Status: Implementation-ready sequence draft

## Purpose

This document converts the frozen pricing strategy, architecture, and rollout policy into an execution sequence that can be implemented safely.

The sequence is optimized for:

- no breakage of the current story flow
- additive schema first
- feature-flagged rollout
- minimal irreversible changes early

## Non-Breaking Execution Rules

- do not change current story behavior until pricing snapshot and wallet plumbing exist behind flags
- keep all first-pass pricing reads server-side
- keep hard enforcement off until shadow metering has been observed
- keep repair-style image and narration recovery outside hard charging in the first rollout
- every slice should be shippable with user-facing pricing enforcement still disabled

## Recommended Numeric Defaults To Confirm Before Coding

These are proposed defaults, not yet frozen launch policy.

- one-time migration grant for existing non-admin users: `25 beats`
- temporary `Studio` entitlement for internal testers and admins: `90 days`
- reservation auto-expiry timeout: `30 minutes`

Why these are reasonable:

- `25 beats` is generous enough to feel meaningful, but still bounded
- `90 days` gives internal users time to validate the billing and wallet rollout thoroughly
- `30 minutes` is long enough for slow generation or webhook lag without leaving stale reservations around indefinitely

## Migration Batch Order

Recommended next migration numbers:

### `015_pricing_catalog.sql`

Create admin-authored pricing catalog tables:

- `pricing_plans`
- `pricing_plan_versions`
- `pricing_topup_packs`
- `pricing_action_costs`
- `pricing_promotions`
- `pricing_publish_audit`

Also create indexes for:

- `plan_key`
- `(pricing_market_key, currency_code, billing_interval, status)`
- active top-up packs by market
- active promotions by market and time window

### `016_billing_core.sql`

Create provider-mirror and payment-trace tables:

- `billing_customers`
- `billing_subscriptions`
- `billing_orders`
- `billing_webhook_events`

Also add uniqueness and trace indexes for:

- provider customer IDs
- provider subscription IDs
- provider order IDs
- provider event IDs

### `017_wallet_core.sql`

Create wallet and spend-accounting tables:

- `beat_grants`
- `beat_spend_reservations`
- `beat_usage_events`
- `beat_usage_allocations`

Also add indexes for:

- spendable grants by user and expiry
- reservations by `idempotency_key`
- usage events by user and action
- allocations by usage event and grant

### `018_pricing_runtime_flags.sql`

Seed feature flags and scalar runtime values:

- `pricing_admin_tab_enabled`
- `pricing_snapshot_enabled`
- `pricing_checkout_enabled`
- `pricing_shadow_metering_enabled`
- `pricing_hard_enforcement_enabled`
- `pricing_story_length_ui_limits_enabled`
- `pricing_default_grace_period_days`
- `pricing_default_carry_forward_cap_multiplier`
- `pricing_reservation_timeout_seconds`
- `pricing_migration_grant_beats`

All enforcement-related booleans should default to `false`.

### `019_pricing_seed_data.sql`

Seed initial commercial data:

- `free`, `plus`, `studio` plans
- monthly and annual plan versions
- `IN` and `ROW` market variants
- initial top-up packs
- initial action costs
- initial free-user promo structure if needed

### Rollback guidance

Each migration should have a rollback pair, but operational rollback should primarily rely on flags rather than destructive schema rollback once data starts accumulating.

## Recommended RLS and Write Model

### Catalog and provider-mirror tables

Recommended write path:

- admin or service-role only

Recommended read path:

- server actions only

Reason:

- avoids leaking commercial data shape directly to clients
- keeps draft versus live behavior easier to control

### Wallet tables

Recommended write path:

- pricing runtime service only

Recommended read path:

- server-side effective snapshot only

Reason:

- wallet mutation logic should stay centralized
- direct writes from app code would increase drift risk

## Environment Additions

These should be documented in `.env.example` when implementation begins.

### Already used in code but missing from `.env.example`

- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_USER_ID`

### Stripe

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Optional later:

- `STRIPE_PUBLISHABLE_KEY`

### Razorpay

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`

### Pricing runtime

Optional if we keep values in Supabase:

- none required beyond provider secrets

If we later add environment-based rollout overrides:

- `PRICING_MARKET_DEFAULT`
- `PRICING_BILLING_LOG_LEVEL`

## Feature Flag Rollout Order

Recommended activation order:

1. `pricing_admin_tab_enabled`
2. `pricing_snapshot_enabled`
3. `pricing_checkout_enabled`
4. `pricing_story_length_ui_limits_enabled`
5. `pricing_shadow_metering_enabled`
6. `pricing_hard_enforcement_enabled`

Reason:

- admin tools should exist before runtime reads
- runtime reads should exist before billing UI
- billing UI should exist before enforcement
- shadow metering should exist before hard blocking

## Code Slice Order

### Slice 1 - Types and schema plumbing

Target files:

- [lib/types/database.ts](/d:/AiCoding/storyMaster/lib/types/database.ts)
- new `lib/types/pricing.ts`
- new pricing SQL migrations under `supabase/migrations/`

Goal:

- add database and domain types with zero runtime behavior change

### Slice 2 - Pricing admin data layer

Target files:

- new `app/actions/pricing-admin.ts`
- [app/actions/admin.ts](/d:/AiCoding/storyMaster/app/actions/admin.ts) only if we decide to keep small shared helpers there
- [lib/supabase/admin.ts](/d:/AiCoding/storyMaster/lib/supabase/admin.ts)

Goal:

- read and write pricing catalog data
- support draft and publish
- support publish audit writes

Recommendation:

- use a new dedicated `pricing-admin` action file instead of bloating `admin.ts`

### Slice 3 - Admin playground pricing workspace

Target files:

- [components/admin/PlaygroundStudio.tsx](/d:/AiCoding/storyMaster/components/admin/PlaygroundStudio.tsx)
- new `components/admin/PricingStudio.tsx`
- possibly new smaller editor components under `components/admin/`

Goal:

- keep `/admin/playground`
- add internal workspace switch between prompt playground and pricing
- support draft/live diff preview before publish

### Slice 4 - Pricing runtime read layer

Target files:

- new `app/actions/pricing-runtime.ts`
- new `lib/pricing/snapshot.ts`
- new `lib/pricing/wallet.ts`

Goal:

- compute effective user pricing snapshot
- expose story-length cap and wallet totals
- no spend enforcement yet

### Slice 5 - Billing checkout and webhook layer

Target files:

- new `app/actions/billing.ts`
- new `app/api/billing/stripe/webhook/route.ts`
- new `app/api/billing/razorpay/webhook/route.ts`

Goal:

- create hosted checkout sessions or payment intents
- ingest provider webhooks
- mirror subscription and order state
- create beat grants on successful billing events

Recommendation:

- use API routes for webhooks
- use server actions or server-side route handlers for checkout creation

### Slice 6 - Story setup pricing read integration

Target files:

- [components/story/AdvancedOptions.tsx](/d:/AiCoding/storyMaster/components/story/AdvancedOptions.tsx)
- [components/story/LandingScreen.tsx](/d:/AiCoding/storyMaster/components/story/LandingScreen.tsx)
- [app/page.tsx](/d:/AiCoding/storyMaster/app/page.tsx)

Goal:

- replace hardcoded beat slider bounds with effective pricing snapshot values
- show upgrade prompt when tier cap is exceeded
- fail safe if pricing snapshot is unavailable

### Slice 7 - Runtime spend service

Target files:

- new `lib/pricing/spend-service.ts`
- new `lib/pricing/idempotency.ts`
- new `app/actions/pricing-runtime.ts`

Goal:

- authorize spend
- create reservations
- finalize or release reservations
- keep wallet mutations centralized

### Slice 8 - Story flow integration with shadow metering

Target files:

- [lib/store/story-store.ts](/d:/AiCoding/storyMaster/lib/store/story-store.ts)

Primary integration points:

- before expensive work in `startStory`
- before new-beat generation in `continueStory`
- never on existing-branch navigation

Goal:

- observe intended spend behavior without blocking users yet

### Slice 9 - Hard enforcement on core beat generation

Target files:

- [lib/store/story-store.ts](/d:/AiCoding/storyMaster/lib/store/story-store.ts)
- new pricing runtime service files

Goal:

- hard block only when:
  - a new story starts
  - a new child beat must be generated

Keep repair-style recovery free in this slice.

## First File Touch Areas

If implementation started today, I would expect the first code changes to land in:

- `supabase/migrations/015_pricing_catalog.sql`
- `supabase/migrations/016_billing_core.sql`
- `supabase/migrations/017_wallet_core.sql`
- `supabase/migrations/018_pricing_runtime_flags.sql`
- `supabase/migrations/019_pricing_seed_data.sql`
- [lib/types/database.ts](/d:/AiCoding/storyMaster/lib/types/database.ts)
- new `lib/types/pricing.ts`
- new `app/actions/pricing-admin.ts`
- new `app/actions/pricing-runtime.ts`
- new `components/admin/PricingStudio.tsx`

These are the lowest-risk starting points because they do not need to alter the live story flow yet.

## Recommended Verification Gates

### After schema and seed slices

- admin pricing reads work with empty and seeded data
- no existing story flow regression
- no auth regression

### After snapshot slice

- free user receives correct story-length cap
- paid and free snapshots differ correctly
- missing pricing data falls back safely

### After billing slice

- Stripe checkout can create a session
- Razorpay checkout can create an order/session
- webhook replay is idempotent
- successful payments create grants exactly once

### After shadow metering slice

- `startStory` logs intended spend without blocking
- new-branch `continueStory` logs intended spend without blocking
- existing branch navigation logs no spend
- repair-style image or narration recovery logs no spend

### After hard enforcement slice

- insufficient beats block only the intended actions
- successful generation finalizes the reservation correctly
- failed generation releases or compensates correctly
- two-tab duplicate spend attempts do not double-charge

## Known Implementation Risks

- client-store orchestration means pricing checks must not be injected in a way that races with current loading state updates
- narration and image generation currently run in parallel with some persistence, so reservation finalization timing needs careful handling
- webhook timing may lag behind checkout completion, so snapshot reads must be robust during short sync windows
- additive schema is safe, but wallet mutation bugs could still create silent spend drift if observability is weak

## Suggested PR / Slice Boundaries

Recommended slice boundaries for manageable review:

1. schema + types
2. admin pricing data layer
3. admin pricing workspace UI
4. pricing runtime snapshot
5. billing checkout + webhook plumbing
6. story setup UI limits
7. spend service + shadow metering
8. hard enforcement

## Remaining Tuning Inputs

These do not block implementation sequencing, but they should be confirmed before enforcement ships:

- exact migration grant size
- exact temporary `Studio` duration
- exact reservation expiry timeout
