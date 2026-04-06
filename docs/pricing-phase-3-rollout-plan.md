# Pricing Phase 3 Rollout Plan

Date: 2026-04-06
Branch: `pricing`
Status: Phase 3 rollout baseline frozen

## Purpose

This document turns the frozen pricing architecture into a non-breaking rollout sequence.

The goal is to introduce:

- pricing catalogs
- billing providers
- wallet accounting
- beat spending
- tier-aware limits

without breaking the current story creation flow.

## Current Runtime Seams

The current story experience is orchestrated primarily from the client store in `lib/store/story-store.ts`.

Important behavior today:

- `startStory` creates the first beat and kicks off voice, narration, image generation, and early persistence
- `continueStory` either navigates an existing explored branch or generates a brand-new beat
- `generateNarrationForNode` is used when a node is missing audio
- `regenerateImageForNode` is only exposed when the image is missing
- story persistence is already asynchronous and partially fire-and-forget

This means pricing enforcement cannot be introduced as a single hard cutover without risking breakage.

## Phase 3 Decisions Frozen So Far

- internal testers and admins should receive temporary `Studio` entitlement during rollout
- existing non-admin users should receive a one-time migration beat grant
- the first hard-enforced rollout should meter only:
  - `start_story_initial_beat`
  - `continue_story_new_beat`
- repair-style narration and image recovery should remain free in the first hard-enforced rollout
- spend authorization in v1 should use the reservation-and-release model

## Recommended V1 Metered Actions

### Meter in the first hard-enforced rollout

- `start_story_initial_beat`
- `continue_story_new_beat`

These are the clearest user-intent actions and they align best with the beat-driven economy.

### Do not meter in the first hard-enforced rollout

- navigating to an already explored branch
- loading a saved story
- exploring an existing story tree
- playback or narration toggle actions
- cloud save
- publish / auto-publish
- signed URL refresh
- `generateNarrationForNode` when it is being used as recovery for missing audio
- `regenerateImageForNode` when it is being used as recovery for missing image output

Reason:

- these recovery and navigation flows should remain safe and non-blocking while pricing enforcement is new
- earlier product decisions already favored keeping repair-style regeneration outside a separate gating model in v1

## Recommended Enforcement Semantics

### Existing branch navigation

If `continueStory` finds an already-generated child branch, it should never spend a beat.

### New beat generation

If `continueStory` must generate a new child node, it should spend 1 beat.

### Initial story creation

Starting a brand-new story should spend 1 beat because it creates beat 1.

### Recovery generation

If image or narration is missing for an existing beat, recovery generation should not spend beats in the first hard-enforced rollout.

## Recommended Spend Lifecycle

### V1 frozen rule

Use a reservation-style flow inside the idempotent spend service:

1. preflight wallet check
2. create or lock a spend reservation
3. run generation
4. finalize usage allocation on success
5. release or compensate on failure

This is more work than charging only after success, but safer.

Why:

- prevents two tabs from overspending the same balance
- avoids giving away generated beats when the user truly has no spendable wallet
- gives us a deterministic place to recover from generation failures

## Recommended Non-Breaking Rollout Sequence

### Phase 3A - Add schema with no runtime enforcement

Ship additive database changes only:

- pricing catalog tables
- billing mirror tables
- wallet tables
- pricing publish audit
- webhook event audit

No user-facing behavior should change here.

### Phase 3B - Seed initial catalog and runtime defaults

Seed:

- free, plus, studio plans
- monthly and annual plan versions
- India and ROW market variants
- top-up packs
- action costs
- initial pricing feature flags

Still no enforcement.

### Phase 3C - Build read-only effective pricing snapshot

Introduce a server action or service that computes:

- active plan
- story-length cap
- wallet totals
- next reset
- grace-period state

This stage should be read-only and should not affect generation.

### Phase 3D - Connect billing and wallet grants

Introduce:

- minimal hosted checkout
- Stripe and Razorpay webhook ingestion
- subscription mirror updates
- top-up purchase recording
- beat grant creation

Still no spend enforcement.

### Phase 3E - Shadow metering

Integrate pricing checks into story actions in observe-only mode.

Recommended behavior:

- compute whether the action would be allowed
- record intended spend attempts
- do not block users yet
- compare expected behavior against actual story flow

This is the safest place to catch edge cases before users are blocked.

### Phase 3F - UI gating with fallback-safe behavior

Enable:

- tier-aware story-length slider limits
- pricing snapshot in the UI
- upgrade prompt when the selected beat count exceeds the user tier cap

Fallback rule:

- if pricing snapshot is unavailable, the UI should fall back safely instead of breaking story start

### Phase 3G - Hard enforcement on core beat generation only

Turn on hard spend enforcement for:

- starting a new story
- generating a new continuation beat

Keep repair-style narration and image recovery outside hard charging for this first production rollout.

### Phase 3H - Expand monetized actions later

Only after the core flow is stable should we consider charging for:

- explicit creative regenerations
- export flows
- future creator controls

## Recommended Code Integration Points

### Client-store integration

For v1 non-breaking rollout, keep orchestration in `lib/store/story-store.ts` and insert pricing service calls around it.

Recommended touch points:

- before `startStory` kicks off expensive generation
- before `continueStory` generates a brand-new beat
- never on existing-branch navigation

### New pricing runtime service

Add a dedicated server-side pricing runtime action layer responsible for:

- loading effective wallet state
- authorizing spend
- finalizing spend
- releasing failed reservations
- creating beat grants from billing events

This should become the only supported write path for wallet mutations.

### Longer-term improvement

Later, the full start and continue orchestration could move server-side, but that is not required for the first pricing rollout and would add unnecessary change risk right now.

## Failure and Recovery Rules

### Generation failure after reservation

Recommended behavior:

- mark the reservation as failed or released
- do not leave the user charged for failed generation
- write an audit trail so the failure can be investigated

### Wallet service failure before generation

Recommended behavior:

- fail closed for hard-enforced actions
- show a clean pricing error rather than beginning generation

### Wallet finalization failure after successful generation

Recommended behavior:

- the idempotent service should retry safely
- unresolved cases should be visible in admin or logs
- the system should avoid silently drifting into untracked free generation

## Observability Requirements

Before hard enforcement, we should log and monitor:

- pricing snapshot load failures
- authorization failures
- reservation release failures
- webhook processing failures
- drift between provider state and wallet grants
- spend attempts by action key
- upgrade-prompt impressions for story-length cap

## Rollback Strategy

The first enforced rollout should be guarded by feature flags.

Recommended flags:

- `pricing_snapshot_enabled`
- `pricing_checkout_enabled`
- `pricing_shadow_metering_enabled`
- `pricing_hard_enforcement_enabled`
- `pricing_story_length_ui_limits_enabled`

This gives us a clean rollback path without schema rollback.

## Legacy User Transition

Recommended launch handling:

- internal testers and admins receive temporary `Studio` entitlement
- existing non-admin users receive a one-time migration beat grant

Why:

- protects launch goodwill
- reduces surprise for users who were already using the product before monetization
- gives us a softer transition while pricing enforcement stabilizes

## Recommended First Production Scope

If we want the lowest-risk first production scope, I recommend:

- additive schema
- admin pricing tab
- read-only pricing snapshot
- checkout plus webhook plumbing
- wallet grant creation
- shadow metering on `startStory` and `continueStory`
- UI story-length cap prompts
- later, hard enforcement on `startStory` and new-branch `continueStory`

## Remaining Implementation Questions

- how large the one-time migration grant should be for existing non-admin users
- how long temporary tester and admin `Studio` entitlement should last before normal policy applies
- whether spend reservations should expire automatically after a fixed timeout if finalization never arrives
