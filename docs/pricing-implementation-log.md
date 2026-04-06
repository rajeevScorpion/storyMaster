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
