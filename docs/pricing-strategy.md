# Pricing Strategy

Date: 2026-04-06
Branch: `pricing`
Status: Phase 1 pricing baseline frozen. This document can still be refined before implementation details are finalized.

## Product Positioning

Kissago should feel like a joyful collaborative storytelling platform first, not a hardcore creator playground first.

Primary emotional center:

- parents and young kids spending time together creating and sharing stories

Secondary premium growth lane:

- creators who want more control, downloadable outputs, and unbranded publishing rights

Longer-term expansion lane:

- institutional workshop and classroom packages

This means the pricing ladder should feel like one coherent product:

- `Free` for discovery and hosted sharing
- `Paid core` for repeat family use
- `Top tier` for creator/export power
- `Institutional` later as a separate package family

## Core Pricing Philosophy

### 1. Beat-driven economy

The user-facing unit should be beats, not tokens or raw media cost.

Why:

- easy for families to understand
- matches the story experience directly
- makes future upsells feel natural
- keeps pricing predictable even though internal generation cost varies

### 2. Mostly flat user-visible pricing

The user should be able to anticipate cost easily.

Recommended rule:

- standard story continuation uses a flat beat cost
- only optional premium actions use extra beats

Examples of extra-beat actions:

- image regeneration
- narration regeneration
- future video export
- future advanced creator outputs

Internal complexity like portraits, storyboard generation, or provider mix should stay mostly hidden from the user.

### 3. Subscription plus top-ups

Recurring subscription should be the core monetization model.

Top-ups should exist from day one so:

- power users are not blocked abruptly
- the business is protected from high-cost edge cases
- users can recover from running out without forcing a full plan upgrade

### 4. Free should feel warm, not unlimited

Free should be good enough to let users feel the magic and complete at least one meaningful story journey, but not so generous that recurring usage never converts.

### 5. Hosted sharing should stay free

Free users should be able to create stories and share hosted Kissago links.

Free should not include:

- downloads
- unbranded exports
- creator-style publishing value

Those belong in paid plans, especially the top tier.

## Frozen Strategic Decisions

These decisions were aligned during pricing ideation and should be treated as the current baseline.

### Audience and packaging

- Positioning anchor: balanced dual audience
- Consumer account shape: single account, but product messaging should support collaborative family use
- Creator capability packaging: creator/export power belongs in the top-tier plan
- Workshop/classroom demand: treat as a separate package family later, not just a bigger consumer plan

### Monetization

- Core model: subscription plus top-ups
- User-facing economy: mostly flat beats
- Billing emphasis: monthly and annual
- Market anchor: global blended
- Pricing ambition: balanced middle
- Billing gateway direction: provision both Stripe and Razorpay
- Provider routing direction: India uses Razorpay first, outside India uses Stripe first
- Billing region detection: use an explicit country selection step on the pricing or checkout surface, prefilled when possible
- Checkout philosophy: keep checkout as minimal as possible, ideally a single page
- Subscription management direction for v1: keep management provider-hosted, with a future path to external or in-product management

### Free plan boundaries

- Free should be warm but bounded
- Free users can share hosted Kissago story links
- Free users do not get downloadable or unbranded exports
- Free users can buy top-up beat packs
- story length limits should be tier-specific and admin-configurable

### Admin control philosophy

- pricing must stay quickly configurable by admins
- first admin pricing controls should support global settings plus date-window promotions
- admins should be able to temporarily increase free-user quota for special periods or campaigns
- pricing controls should live in the admin playground workspace, not a separate admin surface

## Recommended Consumer Ladder

These numbers are a strategy starting point, not yet a billing integration spec.

### Free

- 12 beats per month
- hosted creation
- hosted sharing
- Kissago branding remains
- shorter story length ceiling than paid
- generation volume is primarily constrained by beats, not a separate regen cap

### Plus

- $12/month
- $108/year
- 100 beats per month
- main family plan
- designed for repeat collaborative use
- should unlock the normal premium-feeling story experience

### Studio

- $29/month
- $290/year
- 300 beats per month
- creator/export plan
- downloadable outputs
- unbranded exports
- future advanced output controls belong here

## Recommended Top-ups

Starting recommendation:

- 25 beats for $4
- 80 beats for $10
- 200 beats for $20

## Recommended Action Pricing

Keep this simple and predictable:

- continue story by one beat: 1 beat
- regenerate image: 1 beat
- regenerate narration: 1 beat
- future premium export action: 3 to 5 beats depending on output type

Regen policy for v1:

- regeneration should not be separately gated by a dedicated regen cap
- beats remain the main limiting factor
- the current practical need to recover missing image or narration payloads should remain intact
- deeper iterative regeneration can become a future creator-focused feature later

## Recommended Wallet Behavior

Recommended wallet model:

- subscription beats refill monthly on the billing anniversary cadence
- annual plans should still grant beats monthly, not as a full annual pool upfront
- unused subscription beats can carry forward
- carry-forward is capped by admin setting
- default carry-forward cap should be up to 2x the monthly included beats
- carried-forward subscription beats expire when paid access ends or the user downgrades out of the paid plan
- purchased top-up beats do not expire
- promotional bonus beats should live in a separate expiring bucket
- promotional bonus beats should be consumed before normal subscription beats
- when spending beats, subscription beats should be consumed before purchased top-up beats

This keeps the system fair and easy to explain while limiting unbounded carry-forward liability.

Feature entitlement rule:

- top-up beat purchases increase generation volume only
- paid-only product entitlements remain tied to the active plan tier

Subscription lifecycle baseline:

- cancellation preserves paid access until the billing period ends
- failed renewal should trigger a grace period before paid features are removed
- the preferred default grace period is 5 days
- grace period duration should remain admin-configurable

## Conversion Design Principles

Upgrade prompts should be tied to desire and momentum, not frustration.

Best upgrade triggers:

- user wants to keep creating this month
- user wants longer story adventures
- user wants more iterations or retries within their beat budget
- user wants downloads or exports
- user wants unbranded publishing value

Good retention mechanics to support later:

- story completion bonus beats
- seasonal or themed bonus-beat promotions
- referral beats
- family event or holiday campaigns

## Admin Pricing Tab Direction

The first pricing tab should act like a business-control console, not a full billing platform.

Recommended controls:

- plan names
- monthly prices
- annual prices
- included beats per plan
- top-up pack sizes and prices
- per-action beat costs
- free-tier monthly allowance
- free-tier story length limits
- paid-tier story length limits
- promo start and end dates
- temporary free-user beat bonuses
- grace-period duration
- carry-forward cap
- billing region routing defaults
- simple global promotional presets

Tier-aware UI behavior:

- story length limits should affect the story setup UI for the active user tier
- if a user drags the beat slider beyond their allowed tier maximum, the UI should prompt for upgrade instead of silently allowing the higher limit

## Institutional Direction

The workshop/classroom vertical should be shaped as a separate offering later.

Likely shape:

- facilitator or organizer package
- seat-count or cohort-size framing
- fixed usage allocation
- hosted gallery/showcase support
- possible sales-led onboarding

It should not be positioned as “buy multiple family subscriptions.”

## Execution Guardrails

These are non-negotiable for implementation:

- Nothing currently working should break.
- Tradeoffs must be surfaced before meaningful decisions are made.
- Crucial decisions should not be taken autonomously.
- A dedicated git branch must exist before execution.
- A live markdown log must be maintained and updated after every phase.

## Open Areas To Refine Before Full Implementation

- exact entitlement schema
- exact admin-editable pricing data model versus seeded defaults
- how promo overrides should layer against default plan values
- how future institutional packages should coexist with consumer billing primitives
