# Pricing Implementation Log

Date started: 2026-04-05
Active branch: `pricing`
Owner: Codex + user
Status: Phase 2 complete

## Working Rules

These rules were explicitly locked before execution:

- Nothing that is working at the time shall break.
- Tradeoffs must always be called out before meaningful decisions are made.
- Crucial decisions must not be taken autonomously.
- A git branch must be created before execution work begins.
- A live markdown log must be maintained and updated after every phase.

## Phase Plan

### Phase 0 — Setup and strategy baseline

Goal:

- create the dedicated execution branch
- establish live docs
- record the current frozen pricing strategy baseline

Status:

- complete

Work completed:

- created and switched to git branch `pricing`
- created `docs/pricing-strategy.md`
- created `docs/pricing-implementation-log.md`
- recorded the current pricing philosophy, consumer ladder, beat economy, admin direction, and execution guardrails

Verification:

- branch switched successfully to `pricing`
- docs are present in `docs/`

Tradeoffs / decisions:

- standardized branch naming on `pricing`
- treated the current pricing strategy as a baseline document, not yet the final implementation spec
- kept the current repo behavior untouched; this phase only added documentation

Open risks / notes:

- the repo still contains unrelated local changes in `.claude/settings.local.json` and `tsconfig.tsbuildinfo`
- `docs/subtitle-cc-research.md` remains uncommitted in the worktree and is currently carried into this branch state
- no runtime pricing, quota, or entitlement code exists yet

### Phase 1 - Freeze implementation scope

Planned focus:

- convert the pricing strategy into an execution-ready product and technical spec
- define entitlement, quota, admin-control, and promo concepts clearly enough for safe implementation

Status:

- complete

Discovery notes:

- there is currently no billing provider integration in the repo
- there is currently no entitlement, quota, credits, or subscription schema
- the cleanest runtime enforcement hooks appear to be:
  - `startStory`
  - `continueStory`
  - `generateNarrationForNode`
  - `regenerateImageForNode`
- admin runtime controls already follow a `feature_flags` pattern and the admin sidebar and settings surfaces can be extended for pricing controls
- the landing flow already requires authentication before story generation begins, which simplifies entitlement enforcement

Work completed:

- aligned the pricing model around a beat-driven subscription plus top-up economy
- froze the dual-gateway billing direction with India routed to Razorpay first and outside India routed to Stripe first
- froze the v1 checkout direction as a minimal single-page flow with provider-hosted billing management
- froze wallet behavior across subscription beats, carried-forward beats, purchased top-ups, and promotional beats
- froze subscription lifecycle behavior for cancellation, failed renewal grace periods, and downgrade outcomes
- froze the admin-playground direction for pricing controls, including story-length limits, carry-forward cap, grace period, and promo controls
- froze the product rule that v1 should not impose a separate regeneration cap and should use beats as the main limiter
- froze the UI requirement that tier-specific story-length limits must surface directly in setup and prompt upgrade when exceeded

Decisions confirmed during Phase 1:

- Phase 1 implementation must include real billing and checkout
- Razorpay is part of the launch billing direction
- Stripe should also be provisioned as an available billing option
- India should route to Razorpay first
- outside India should route to Stripe first
- billing region detection should use an explicit country selection approach
- the explicit country selection step should live on the pricing or checkout page and be prefilled when possible
- checkout should stay as minimal as possible, ideally a single page
- monthly leftover beats should carry forward
- carry-forward behavior should be configurable from the pricing area in admin
- carry-forward should use a cap-based model
- free users should be allowed to buy top-up packs
- the pricing controls should live on the same admin playground page as a pricing tab or equivalent in-page workspace
- beat wallet behavior should use subscription beats first and non-expiring purchased beats second
- v1 subscription management can remain provider-hosted, with a future path to external management
- annual plans should grant beats monthly, not upfront
- subscription beats should refill monthly on the billing anniversary cadence
- top-up purchases should increase volume only, not unlock paid-only features
- promotional bonus beats should be a separate expiring bucket
- promotional bonus beats should be consumed before normal subscription beats
- subscription cancellation should preserve paid access until the paid period ends
- failed renewal should use a grace period before paid features are removed
- grace period should be configurable from the admin pricing controls
- a 5 day grace period is the preferred default
- carried-forward subscription beats should expire when paid access ends or the user downgrades out of the paid plan
- purchased top-up beats should remain available after paid access ends
- broader feature gating is desired, but beats remain the primary controlling factor
- v1 should not impose a separate regeneration cap
- story length limits for all tiers should be configurable from the admin pricing controls
- story length limits should affect the setup UI directly for each tier
- if a user tries to exceed their tier story-length limit, the UI should prompt them to upgrade

Verification:

- strategy decisions from the Phase 1 discussion have been captured in `docs/pricing-strategy.md`
- the remaining unresolved items are implementation-shape questions for later phases, not product-scope blockers for Phase 1

Tradeoffs / decisions:

- v1 favors a simpler hosted billing experience over a fully custom subscription-management surface
- dual gateways improve market coverage but increase implementation and webhook complexity
- carry-forward remains generous for users, but the admin-configurable cap protects liability from growing without bound
- regeneration is intentionally not separately gated in v1 so story completion and recovery flows stay reliable

Open risks / notes:

- the exact entitlement schema and admin-editable pricing data model still need to be designed before Phase 2 and Phase 3 implementation
- dual-provider webhook handling and reconciliation will need careful implementation planning to avoid billing drift
- creator exports and downloads are part of the entitlement model now, but their runtime enforcement will arrive only when those features exist
- no runtime pricing, quota, or entitlement code exists yet

Provider findings noted during Phase 1:

- Stripe Checkout supports hosted subscription and one-time payment flows with low integration effort
- Razorpay supports subscriptions, subscription links, and hosted payment collection options
- a dual-provider implementation is feasible and the routing baseline is now frozen

### Phase 2 - Build admin-side pricing controls

Planned focus:

- add pricing configuration primitives
- expose them safely in admin UI
- preserve fast iteration without code deploys

Status:

- complete

Discovery notes:

- the current admin control pattern is built around `feature_flags` plus server actions in `app/actions/admin.ts`
- `feature_flags` is a good fit for simple global runtime switches and scalar overrides, but it is too weak to act as the full source of truth for plan catalogs, top-up packs, promo windows, and billing metadata
- `/admin/playground` currently renders a single large `PlaygroundStudio` surface, so pricing should likely arrive as an in-page tab or adjacent workspace section rather than a separate route
- the story setup slider in `components/story/AdvancedOptions.tsx` is still hardcoded to `3..8`, so tier-aware story-length limits will need a config-fed UI path rather than static bounds
- there is no existing subscription, wallet, beat ledger, checkout session, or provider webhook persistence model in the database

Recommended direction under refinement:

- keep `feature_flags` for lightweight global overrides and operational toggles
- add dedicated pricing catalog tables for plans, top-up packs, action beat costs, and promotions
- add dedicated billing and entitlement tables for subscription mirror state and beat wallet accounting
- keep `/admin/playground` as the route, but split the UI into internal workspaces such as `Prompt Playground` and `Pricing`
- preserve a clear distinction between:
  - admin-editable business configuration
  - provider lifecycle state mirrored from Stripe and Razorpay
  - user wallet accounting and spend audit history

Open design questions for Phase 2 refinement:

- none blocking Phase 2 scope freeze

Decisions confirmed during Phase 2 refinement:

- launch pricing should use `INR` for India and `USD` for outside India
- admin safety should use a split model:
  - draft and publish for plan prices and top-up definitions
  - immediate save for promo windows, grace period, carry-forward knobs, and other operational controls
- beat wallet architecture should use explicit grant buckets plus usage allocations instead of a single mutable balance counter
- pricing configuration should use a broader `pricing_market` concept such as `IN` and `ROW`, while billing records should still store exact `country_code`
- the `free` plan should live in the same versioned pricing catalog as paid plans
- provider webhook events should be stored in an append-only raw events table in v1
- scheduled activation for future price changes should not be part of v1
- plan and top-up schemas should stay mostly structured, with only small JSONB escape hatches for optional extensions
- `billing_orders` should explicitly store provider checkout or session identifiers in v1
- promotions should be single-application only in v1, not stackable
- live pricing publish should require a two-step confirmation in admin
- launch promotion targeting should stay mostly structured through fields like `pricing_market_scope`, `target_plan_key`, and `target_user_segment`
- beat grant expiry should be governed by database state such as `expires_at`, while application services compute the current spendable snapshot from that source of truth
- pricing publish history should use a separate append-only audit table in v1
- the effective pricing snapshot should be recomputed on demand in v1, with short-term caching and explicit invalidation deferred until needed
- admin pricing publish should show a draft-versus-live diff preview before the final confirmation step
- beat spending should be enforced through an idempotent service layer that wraps transactional writes

Work completed so far during Phase 2 refinement:

- documented the pricing architecture direction in `docs/pricing-architecture-spec.md`
- translated pricing strategy into concrete catalog, billing mirror, wallet, and UI snapshot concepts
- mapped the likely admin-playground split between `Prompt Playground` and `Pricing`
- froze the current schema-safety defaults for catalog structure, checkout traceability, promotion behavior, and publish confirmation
- froze the launch-safe targeting, expiry authority, and pricing-audit directions
- froze the v1 snapshot computation, publish diff-preview, and idempotent spend-enforcement directions

Verification:

- the pricing architecture direction is now captured in `docs/pricing-architecture-spec.md`
- the remaining open items have moved from product-policy ambiguity to implementation-planning detail

Tradeoffs / decisions:

- recomputing the effective pricing snapshot on demand is simpler and safer for v1, but may need caching later if usage grows
- a diff preview adds some admin UI work, but reduces the chance of accidental live pricing mistakes
- an idempotent spend service is more work than raw direct transactions, but it is much safer for retries, webhooks, and checkout completion flows

Open risks / notes:

- Phase 3 will need careful transaction design so beat grants, allocations, and usage events stay consistent under retries
- Phase 2 is frozen at the architecture level, but the exact migration order and rollout sequence still need implementation planning

### Phase 3 — Build runtime enforcement

Planned focus:

- add user entitlements and usage accounting
- enforce beat economy and limits without breaking existing generation flow

Status:

- not started

### Phase 4 — UX and conversion surfaces

Planned focus:

- add user-facing quota messaging, upgrade moments, and purchase hooks
- preserve the warm family-first product feel

Status:

- not started

## Phase 3 Planning Addendum

Current working status:

- Phase 3 planning is complete and the rollout baseline is frozen

Discovery notes:

- `startStory` in `lib/store/story-store.ts` creates beat 1 and already interleaves story generation, storyboard composition, image generation, narration, and early persistence
- `continueStory` has two paths:
  - instant branch navigation when a child already exists
  - expensive new-beat generation when a child does not exist
- `generateNarrationForNode` and `regenerateImageForNode` currently behave like recovery actions for missing assets rather than broad creative-iteration tools
- current orchestration lives mostly in the client store, so pricing enforcement must be introduced incrementally around that flow instead of through a single hard server cutover

Work completed so far during Phase 3 planning:

- documented the runtime rollout direction in `docs/pricing-phase-3-rollout-plan.md`
- mapped the non-breaking rollout sequence from additive schema through shadow metering and later hard enforcement
- identified the recommended first hard-metered actions as:
  - `start_story_initial_beat`
  - `continue_story_new_beat`
- identified existing-branch navigation and repair-style image and narration recovery as non-metered in the first hard-enforced rollout
- froze the legacy-user transition approach with temporary tester/admin `Studio` entitlement and a one-time migration beat grant for existing non-admin users
- froze the reservation-and-release spend-authorization model for v1

Open questions currently blocking the Phase 3 freeze:

- none blocking the Phase 3 rollout freeze

Decisions confirmed during Phase 3 planning:

- the first hard-enforced rollout should meter only `startStory` and new-branch `continueStory`
- repair-style narration and image recovery should remain free in the first hard-enforced rollout
- spend authorization in v1 should use the reservation-and-release model
- internal testers and admins should receive temporary `Studio` entitlement during rollout
- existing non-admin users should receive a one-time migration beat grant

Verification:

- the rollout baseline is now captured in `docs/pricing-phase-3-rollout-plan.md`
- the remaining open questions have moved from rollout-policy decisions to implementation-detail tuning

Tradeoffs / decisions:

- a migration grant softens the monetization transition, but it slightly delays revenue from existing users
- keeping repair-style recovery free reduces pricing risk and support burden, but it also means some generation paths remain unmetered initially
- the reservation-and-release model is operationally safer, but it requires more careful transaction and timeout handling

Open risks / notes:

- the exact grant amount and tester-entitlement duration still need implementation-level tuning
- reservation expiry and cleanup strategy should be defined before runtime enforcement is implemented

## Implementation Planning Addendum

Current working status:

- implementation planning is in progress

Work completed so far during implementation planning:

- documented the execution sequence in `docs/pricing-implementation-sequence.md`
- proposed the migration batch order from pricing catalog through wallet tables and runtime flags
- mapped the recommended feature-flag activation order
- identified the first low-risk code slices and file touch areas
- documented the recommended environment additions for billing and admin operations

Recommended execution order:

- schema and types
- admin pricing data layer
- admin pricing workspace UI
- pricing runtime snapshot
- billing checkout and webhook plumbing
- story setup UI limits
- spend service and shadow metering
- hard enforcement

Open implementation-tuning questions:

- exact one-time migration grant size
- exact temporary `Studio` duration for testers and admins
- exact reservation auto-expiry timeout

## Execution Slice 1 - Schema and Types

Current working status:

- complete locally on branch `pricing`

Goal:

- land the additive pricing foundation without changing runtime story behavior
- keep rollout controls off by default
- prepare the repo for safe stage-first manual migration runs

Work completed:

- added `015_pricing_catalog.sql` plus rollback
- added `016_billing_core.sql` plus rollback
- added `017_wallet_core.sql` plus rollback
- added `018_pricing_runtime_flags.sql` plus rollback
- added `019_pricing_seed_data.sql` plus rollback
- added shared domain types in `lib/types/pricing.ts`
- extended `lib/types/database.ts` with pricing, billing, wallet, and audit table types
- seeded pricing rollout flags with all pricing enforcement and checkout switches off by default
- seeded launch-safe catalog data with:
  - `free` published for `IN` and `ROW`
  - `ROW` paid plans and top-ups published from the current USD strategy baseline
  - `IN` paid plans and top-ups as draft placeholders pending final India pricing

Verification:

- `npx tsc --noEmit`
- `npx eslint lib/types/database.ts lib/types/pricing.ts`

Tradeoffs / decisions:

- India commercial values were not frozen autonomously in SQL; the migration keeps India paid pricing in `draft` with zero-value placeholders so admin can finalize them safely later
- seeded story-length caps stay conservative for now:
  - `free`: `4`
  - `plus`: `8`
  - `studio`: `8`
  This keeps the initial seed aligned with the app's currently proven story-length range until the pricing-aware UI layer is implemented
- pricing, billing, wallet, and audit tables have RLS enabled with no client policies in this slice
  Future reads and writes are expected to flow through verified server-side admin or service-role paths

Open risks / notes:

- the new pricing migrations have not yet been run on `kissagoStage`
- SQL syntax still needs real validation in Supabase SQL editor, especially the seed migration and partial indexes
- provider product and price references are intentionally left empty in the initial seed data
- no runtime snapshot, checkout, wallet mutation, or enforcement code exists yet

Stage validation update:

- `015` through `019` were run manually on `kissagoStage` without SQL errors
- the additive pricing foundation is now validated on the staging database before any runtime pricing code has been introduced

## Execution Slice 2 - Pricing Admin Data Layer

Current working status:

- complete for plan drafts, top-up drafts, action-cost updates, runtime settings, and admin state reads
- promotion mutation behavior intentionally paused pending one schema-level product decision

Goal:

- give the future pricing admin workspace a reliable server-side contract
- support safe draft and publish flows where the schema already supports them
- keep audit coverage in place for commercially sensitive changes

Work completed:

- added `app/actions/pricing-admin.ts`
- added admin read aggregation for:
  - pricing plans and grouped plan versions
  - top-up packs
  - action costs
  - promotions
  - runtime settings
  - recent publish audit history
- added draft-save, publish, and archive actions for plan versions
- added draft-save, publish, and archive actions for top-up packs
- added immediate-update action for pricing action costs
- added immediate-update action for pricing runtime settings backed by `feature_flags`
- added pricing runtime setting definitions and metadata in `lib/types/pricing.ts`
- wired audit writes for plan, top-up, action-cost, and runtime-setting mutations

Verification:

- `npx tsc --noEmit`
- `npx eslint app/actions/pricing-admin.ts lib/types/pricing.ts lib/types/database.ts`

Tradeoffs / decisions:

- promotion reads are included, but promotion write actions are intentionally not implemented yet
- the current `pricing_promotions` schema uses one row per `promo_key`, so it does not support a true simultaneous live-plus-draft promotion model
- plans and top-ups do support safe draft/publish behavior because they are effectively variant-versioned in the current schema

Open risks / notes:

- before Slice 3 pricing UI, we need to choose one promotion direction:
  - accept immediate-save promotion edits in v1
  - or add a follow-up migration to version promotions properly
- provider product and price refs are still unset and expected to be filled from admin later

## Execution Slice 3 - Pricing Admin Workspace UI

Current working status:

- complete locally on branch `pricing`

Goal:

- keep `/admin/playground` as the admin route
- add pricing as an internal workspace beside the existing prompt playground
- give admins a fast, minimal UI for launch pricing operations

Work completed:

- added `components/admin/AdminPlaygroundWorkspace.tsx`
- updated `/admin/playground` to render workspace tabs instead of only the prompt playground
- added `components/admin/PricingStudio.tsx`
- implemented pricing workspace sections for:
  - runtime controls
  - plan draft and publish management
  - top-up draft and publish management
  - action-cost editing
  - promotion management
  - recent audit visibility
- completed the v1 promotion decision in code:
  - promotions are immediate-save
  - promotion archive is immediate
  - plans and top-ups remain draft/publish

Verification:

- `npx tsc --noEmit`
- `npx eslint app/actions/pricing-admin.ts components/admin/AdminPlaygroundWorkspace.tsx components/admin/PricingStudio.tsx app/admin/playground/page.tsx lib/types/pricing.ts lib/types/database.ts`

Tradeoffs / decisions:

- the pricing workspace is visible inside the admin playground now so it can be tested on stage without another manual gating step
- `pricing_admin_tab_enabled` still exists as a runtime setting, but the admin-only workspace itself is not hidden behind that flag in this implementation slice
- promotions are intentionally simpler than plans and top-ups in v1:
  - no parallel draft/live promo versions
  - direct save to the current row

Open risks / notes:

- provider refs, live India commercial values, and future checkout-specific metadata still need to be filled from admin before billing work is useful
- no customer-facing pricing UI, checkout flow, snapshot runtime, or beat enforcement exists yet

Navigation refinement:

- `/admin/playground` now maps back to prompts only
- pricing moved to its own admin route at `/admin/pricing`
- admin sidebar labels now read:
  - `Content`
  - `Backfill`
  - `Prompts Playground`
  - `Pricing and offers`
  - `Global Settings`

Coin display refinement:

- user-facing pricing values in admin now use `coins` while internal storage remains `beats`
- conversion is fixed at `10 coins = 1 beat`
- converted admin editors for:
  - monthly included allowance
  - top-up amounts
  - action costs
  - promotion bonuses
  - migration grant runtime setting
- story-length caps intentionally remain beat-based because they represent story structure, not wallet currency
- updated future seed pack labels in `019_pricing_seed_data.sql` to coin names for fresh environments
- added `020_rename_seeded_topup_pack_labels_to_coins.sql` so already-seeded environments like `kissagoStage` can align their stored pack names through a tracked migration

## Execution Slice 4 - Pricing Runtime Snapshot

Current working status:

- complete locally on branch `pricing`

Goal:

- add a read-only server-side pricing snapshot without changing story generation behavior
- make tier-aware limits and future billing/account views consume one normalized entitlement shape
- keep pricing reads safe for both signed-in and signed-out visitors

Work completed:

- added `app/actions/pricing-runtime.ts`
- added `lib/pricing/snapshot.ts`
- added `lib/pricing/wallet.ts`
- extended `lib/types/pricing.ts` with:
  - `PricingRuntimeControls`
  - richer `EffectivePricingSnapshot`
  - `PricingRuntimeContext`
- implemented a server action that:
  - authenticates the current user when available
  - reads pricing data through the service-role client
  - returns a free-plan fallback snapshot for anonymous users
- implemented runtime control normalization from `feature_flags`
- implemented effective plan selection from:
  - explicit market override when provided
  - active entitled subscription when present
  - billing customer fallback
  - published free plan fallback
- implemented wallet availability aggregation from:
  - `beat_grants`
  - `beat_spend_reservations`
- applied pending reservation hold conservatively in promo -> subscription -> top-up order

Verification:

- `npx tsc --noEmit`
- `npx eslint app/actions/pricing-runtime.ts lib/pricing/snapshot.ts lib/pricing/wallet.ts lib/types/pricing.ts`

Tradeoffs / decisions:

- the runtime snapshot is available even while `pricing_snapshot_enabled` is still off
  This keeps the read layer testable before any consumer starts relying on it
- market resolution is intentionally conservative:
  - explicit market override wins
  - then explicit country hint
  - then active subscription market
  - then billing customer market
  - then `ROW`
- pending reservations are deducted without allocation rows by using the planned wallet-consumption priority
  This gives a safe display value now and can be replaced with exact reservation allocation later if needed
- signed-out users receive a published free-plan snapshot instead of an auth error
  This keeps future setup UI integration fail-safe

Open risks / notes:

- no UI is consuming the runtime snapshot yet
- no checkout, grants, or subscriptions are being created yet, so most users will still resolve to free-plan wallet totals
- temporary tester `Studio` access and migration grants are not yet materialized into the snapshot because the billing and wallet grant slices have not been implemented

## User UI Planning Addendum

Current working status:

- user-facing pricing UX baseline documented before implementation

Work completed:

- added `docs/pricing-user-ui-spec.md`
- froze the recommended V1 user-facing pricing surfaces:
  - story-length limit messaging in setup
  - wallet summary in the user menu
  - future `/wallet` page direction
  - future recent activity / spend history direction
- aligned the user-facing copy and tone around `coins`
- kept the first rollout family-friendly and intentionally non-financial in feel

Tradeoffs / decisions:

- the recommended first implementation slice for customer UI stays intentionally narrow:
  - setup limit messaging
  - wallet summary
- the full wallet page is specified now, but recommended for a later slice after the first user-visible rollout proves stable
- `/wallet` is the recommended route because it feels simpler and warmer than a deeper account billing path

## Execution Slice 5 - User Pricing UI

Current working status:

- complete locally on branch `pricing`

Goal:

- add the first customer-facing pricing surfaces while checkout and billing are still non-live
- make pricing visible inside the product without changing generation enforcement yet
- keep the experience warm and lightweight for internal testing

Work completed:

- added `components/pricing/PricingRuntimeProvider.tsx`
- added `lib/hooks/usePricingRuntime.ts`
- added `app/wallet/page.tsx`
- added `components/pricing/WalletPage.tsx`
- extended `app/actions/pricing-runtime.ts` with wallet page reads for:
  - public plan offers
  - top-up offers
  - recent wallet activity
- extended `lib/types/pricing.ts` and `lib/pricing/snapshot.ts` with:
  - `monthlyIncludedBeats`
  - wallet page DTOs
- updated `components/Providers.tsx` to provide pricing runtime context app-wide
- updated `components/auth/UserMenu.tsx` to show:
  - current plan
  - coin summary
  - `Wallet & Billing` entry
- updated `components/story/AdvancedOptions.tsx` to support:
  - plan-aware story length cap messaging
  - upgrade CTA
- updated `components/story/LandingScreen.tsx` to:
  - consume runtime pricing
  - clamp setup max beats to the active plan cap when the UI limit flag is enabled
  - route plan CTA clicks to `/wallet`

Verification:

- `npx tsc --noEmit`
- `npx eslint app/actions/pricing-runtime.ts components/Providers.tsx components/auth/UserMenu.tsx components/story/AdvancedOptions.tsx components/story/LandingScreen.tsx components/pricing/PricingRuntimeProvider.tsx components/pricing/WalletPage.tsx lib/hooks/usePricingRuntime.ts lib/pricing/snapshot.ts lib/pricing/wallet.ts lib/types/pricing.ts app/wallet/page.tsx`

Tradeoffs / decisions:

- checkout buttons are intentionally disabled until the billing slice is implemented
- story-length UI caps only activate when `pricing_story_length_ui_limits_enabled` is on
- wallet UI falls back to the monthly included allowance when live wallet grants do not yet exist
  This avoids showing a misleading zero balance during internal testing
- recent activity intentionally summarizes grants and spend events without exposing allocation internals

Open risks / notes:

- India paid offers remain draft-only until final values are published from admin, so `IN` market offer coverage is intentionally incomplete
- recent wallet activity will be sparse or empty until billing grants and spend events are live
- the UI is broader than the original narrow rollout recommendation, but this is acceptable for internal-only testing before public launch

## Execution Slice 6 - Razorpay Billing Foundation

Current working status:

- complete locally on branch `pricing`

Goal:

- integrate the first real hosted checkout path using Razorpay only
- keep Stripe deferred without blocking future multi-provider support
- make internal India-market checkout testable through the new wallet UI

Work completed:

- added `lib/billing/razorpay.ts`
  - REST-based Razorpay client helpers
  - signature verification helpers for:
    - order checkout
    - subscription checkout
    - webhooks
- added `lib/billing/razorpay-sync.ts`
  - Razorpay customer upsert
  - subscription state sync into `billing_subscriptions`
  - idempotent top-up grants
  - idempotent initial subscription-cycle grants when current cycle timing is available
- added `app/actions/pricing-checkout.ts`
  - authenticated Razorpay checkout preparation for:
    - subscriptions
    - top-ups
  - lazy Razorpay plan creation for published plan versions without provider refs
- added `app/api/billing/razorpay/verify/route.ts`
  - post-checkout signature verification
  - billing order updates
  - top-up grants
  - subscription sync after successful authorization
- added `app/api/billing/razorpay/webhook/route.ts`
  - webhook signature validation
  - append-only webhook event capture
  - duplicate event suppression via `x-razorpay-event-id`
  - subscription/order follow-up processing
- updated `components/pricing/PricingRuntimeProvider.tsx`
  - persisted market override for internal testing
- updated `components/pricing/WalletPage.tsx`
  - market selector
  - monthly/yearly plan toggle
  - Razorpay checkout script loading
  - live checkout buttons for Razorpay-backed offers
  - success/error feedback after checkout verification
- updated `app/actions/pricing-runtime.ts` and `lib/types/pricing.ts`
  - wallet offers now carry plan version ids, top-up ids, and provider metadata
- updated `.env.example`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `ADMIN_USER_ID`
  - `RAZORPAY_KEY_ID`
  - `RAZORPAY_KEY_SECRET`
  - `RAZORPAY_WEBHOOK_SECRET`

Verification:

- `npx tsc --noEmit`
- `npx eslint app/actions/pricing-checkout.ts app/actions/pricing-runtime.ts app/api/billing/razorpay/verify/route.ts app/api/billing/razorpay/webhook/route.ts components/pricing/PricingRuntimeProvider.tsx components/pricing/WalletPage.tsx lib/billing/razorpay.ts lib/billing/razorpay-sync.ts lib/types/pricing.ts`

Tradeoffs / decisions:

- Razorpay is the only live checkout provider in this slice
  `ROW` offers can still render, but Stripe is intentionally deferred
- the wallet now includes an explicit market selector because the pricing runtime otherwise defaults new users to `ROW`
- top-up grants are applied immediately after successful verification because that path is simple and idempotent
- subscription activation is synced now, and the initial cycle grant is attempted when Razorpay returns current cycle timing
- ongoing renewal-cycle grants are still conservative and will rely on later webhook refinement if edge cases appear

Open risks / notes:

- India paid plan versions and top-up packs still need to be published from admin with final values before Razorpay checkout can be meaningfully tested
- subscription lifecycle management is still intentionally minimal
  Users should not create overlapping live subscriptions until the account-management slice exists
- webhook setup still needs manual configuration in Razorpay test mode, including the signing secret
