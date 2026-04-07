# Pricing User UI Spec

Date: 2026-04-06
Branch: `pricing`
Status: Pre-implementation UX baseline

## Purpose

This document defines the recommended user-facing pricing and wallet experience before implementation begins.

It is designed to keep Kissago:

- warm and family-friendly
- simple to understand
- gradually monetized without feeling transactional too early
- flexible enough to later support creator and institutional expansion

## Core UX Principles

### 1. Lead with creation, not billing

Pricing should support storymaking, not dominate it.

Users should feel:

- how much they can still create
- what happens when they want more
- where to go if they need to upgrade or top up

Users should not feel:

- like they are inside a finance dashboard
- like every click is charged in a scary way
- like the product is optimizing for extraction instead of delight

### 2. Use `coins` everywhere user-facing

Internal accounting remains beat-based.

User-facing wording should stay consistent:

- `coins`
- `plan`
- `top up`
- `refills on`
- `low on coins`

Avoid exposing internal storage or ledger terminology in primary UI.

### 3. Keep the first wallet experience reassuring

The first wallet surfaces should answer:

- How many coins do I have?
- What plan am I on?
- When do I refill?
- What have I spent recently?
- How do I get more?

## Recommended V1 User-Facing Surfaces

### A. Story Setup Limit Visibility

Primary placement:

- inside the advanced story setup experience
- directly adjacent to the story-length slider

Purpose:

- make plan limits visible before the user hits friction
- reduce surprise when free users cannot choose long stories

Recommended behavior:

- show the allowed story-length cap for the current user tier
- stop the slider at the allowed maximum when pricing UI limits are enabled
- if the user tries to go beyond the cap, show an upgrade prompt instead of allowing overflow

Recommended copy:

- `Your plan allows up to 4 beats per story.`
- `Upgrade for longer story adventures.`

Upgrade CTA options:

- `See plans`
- `Upgrade`

V1 note:

- do not show wallet balances here yet
- keep this surface focused on plan-based story-length allowance

### B. Wallet Summary in User Menu

Primary placement:

- inside the existing user menu opened from the top-right avatar in [UserMenu.tsx](/d:/AiCoding/storyMaster/components/auth/UserMenu.tsx)

Purpose:

- give users an at-a-glance understanding of plan and remaining creation capacity
- provide the softest path into billing and wallet details

Recommended content block:

- current plan name
- remaining coin balance
- next refill date if applicable
- link to wallet page

Recommended menu additions:

- `Wallet & Billing`
- `My Stories`
- `Sign out`

Recommended compact summary copy:

- `Free plan`
- `120 coins remaining`
- `Refills on May 6`

If user is on free:

- `Free plan`
- `120 coins remaining this month`

If user has top-up only and no subscription:

- `Free plan`
- `250 top-up coins available`

If user is low:

- `Low on coins`
- `Top up or upgrade to keep creating`

### C. Wallet & Billing Page

Recommended route:

- `/wallet`

Why this is recommended:

- simpler and friendlier than a nested account billing path
- feels product-native instead of enterprise-accounting-oriented
- easy to reference in upgrade and low-balance prompts

Purpose:

- act as the main user-facing pricing hub
- explain balance, plan, refill timing, and recent activity

Recommended top section:

- current plan badge
- total remaining coins
- refill date
- grace-period badge when relevant
- primary CTA:
  - `Upgrade`
  - `Top up`
  - or `Manage subscription`

Recommended secondary breakdown:

- `Subscription coins`
- `Top-up coins`
- `Bonus coins`

Recommended visual structure:

- one large balance card
- one smaller plan/status card
- one recent activity section below

Recommended balance copy:

- `1,000 coins remaining`
- `Your Plus plan refills on May 6`

If in grace period:

- `Payment issue detected`
- `Your plan stays active until May 11`

If free:

- `Free plan`
- `120 coins available this month`

### D. Recent Activity / Spend History

Primary placement:

- on the wallet page below the summary cards

Purpose:

- build trust
- reduce support questions
- make the wallet feel understandable without exposing internal accounting complexity

Recommended scope for V1:

- recent 10 to 20 events only
- reverse chronological
- simple human-readable labels

Recommended event language:

- `Started a story`
- `Added a new beat`
- `Image regeneration`
- `Narration regeneration`
- `Top-up purchased`
- `Bonus coins added`
- `Monthly refill`

Recommended display format:

- `Started a story`
  `-10 coins`
  `Today, 4:12 PM`

- `Top-up purchased`
  `+250 coins`
  `Yesterday, 9:05 AM`

Do not show in V1:

- allocation breakdown by bucket
- internal reservation ids
- raw provider IDs
- internal beat ledger terminology

## Recommended Upgrade and Top-Up Entry Points

### 1. Story-length limit prompt

Trigger:

- user tries to exceed their tier story-length cap

Recommended modal copy:

- `Want longer story adventures?`
- `Upgrade to unlock longer stories and more monthly coins.`

Primary action:

- `See plans`

Secondary action:

- `Keep this length`

### 2. Low-balance prompt after expensive action attempt

Trigger:

- user is low on coins or out of coins

Recommended modal copy:

- `You’re low on coins`
- `Top up to keep creating right away, or upgrade for more monthly coins.`

Primary actions:

- `Top up`
- `Upgrade`

Secondary action:

- `Maybe later`

### 3. Wallet page CTAs

Recommended actions:

- `Upgrade plan`
- `Buy coins`
- `Manage subscription`

V1 note:

- subscription management can still go to provider-hosted flows

## Family-Friendly Copy Direction

Recommended tone:

- warm
- encouraging
- plain-language
- no billing jargon

Use:

- `Keep creating`
- `longer stories`
- `coins`
- `refills`
- `bonus`

Avoid:

- `quota`
- `consumption`
- `ledger`
- `allocation`
- `entitlement`
- `insufficient balance`

## Creator-Facing Positioning Inside Consumer UI

Creator value should appear, but only where relevant.

Recommended placement:

- pricing plan comparison page
- wallet page plan upsell blocks

Recommended Studio messaging:

- `Great for creators who want unbranded exports and more control.`

Do not let the entire main app feel creator-first.

## Recommended Rollout Order

### Phase A

- story-length limit messaging in setup

### Phase B

- wallet summary inside user menu

### Phase C

- `/wallet` page with balance, plan, refill date, and recent activity

### Phase D

- upgrade and top-up modals wired to checkout

### Phase E

- spend-history refinement and richer account detail

## V1 Deliberately Out of Scope

- full billing-management center inside Kissago
- downloadable invoice history
- advanced creator analytics
- bucket allocation detail
- stacked promo logic UI
- classroom or workshop-specific dashboards

## Recommended UI Data Contract

These surfaces should primarily rely on the server snapshot and lightweight derived data.

Needed for V1:

- current plan
- plan tier rank
- pricing market
- total remaining coins
- remaining subscription coins
- remaining top-up coins
- remaining bonus coins
- next refill date
- grace-period state
- story-length cap

Needed for later:

- recent spend events
- recent grant events
- provider checkout state

## Proposed Freeze for Next Implementation Slice

If we proceed with user-facing pricing UI, the next slice should implement only:

- story-length cap messaging and slider limiting
- wallet summary in the user menu

That keeps the first user-facing pricing rollout light, helpful, and low-risk.
