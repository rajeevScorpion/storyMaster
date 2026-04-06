# Pricing Implementation Log

Date started: 2026-04-05
Active branch: `pricing`
Owner: Codex + user
Status: Phase 1 complete

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

### Phase 2 — Build admin-side pricing controls

Planned focus:

- add pricing configuration primitives
- expose them safely in admin UI
- preserve fast iteration without code deploys

Status:

- not started

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
