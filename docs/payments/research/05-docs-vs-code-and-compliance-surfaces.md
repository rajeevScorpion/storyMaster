# Stream 5 — Existing docs vs code, and customer-facing compliance surfaces

_Stream 5 · audited 2026-09-17 · branch payments_

## Scope and method

Read the pricing/coin-economy planning docs in `docs/`, cross-checked "shipped" claims against
code via Grep/Read (no writes; two read-only DB queries against dev and prod `managed_pages` via
`mcp__supabase__execute_sql` / `mcp__supabase-prod__execute_sql`; no servers/builds run).
Investigated customer-facing compliance surfaces (legal pages, pricing page, email infra, consent,
account deletion) in the codebase and DB.

**Status: COMPLETE.** Resumed after a coordinator pause; all originally-open items were closed this
session (see the old `Resume here` list, now folded into the sections below with results). Context
supplied by other streams on resume (not re-derived by me, cited where used): no invoice/receipt/
tax/billing-address/payment-method tables exist in either DB (stream 3); billing tables cascade-delete
with `auth.users` (stream 3, reviewer-confirmed); `pricing_checkout_enabled` is on in dev / off in
prod and enforced only in `WalletPage.tsx` (streams 1/3); `lib/billing/razorpay.ts:110` sets
`customer_notify: 0` on subscriptions; dev and prod published catalogs differ for the IN Plus plan
(stream 3).

## Part 1 — Decisions already made by the owner (doc + heading)

- **Beat-driven internal economy, `coins` as the only user-facing word.** `docs/pricing-strategy.md`
  ("Core Pricing Philosophy" §1) sets beats internal / coins external; `docs/pricing-user-ui-spec.md`
  ("Core UX Principles" §2, "Use coins everywhere") froze the coins-only user language. **Decided**,
  and code enforces the conversion `COINS_PER_BEAT = 10` (`lib/types/pricing.ts:4`, per the
  2026-07-30 audit §3.1).
- **Subscription + top-ups, India→Razorpay first / outside-India→Stripe first.**
  `docs/pricing-strategy.md` ("Frozen Strategic Decisions" → Monetization). **Decided** for direction;
  Stripe side is **not implemented** (see Claimed vs actual).
- **Free plan: warm but bounded, no downloads/unbranded exports, can buy top-ups.**
  `docs/pricing-strategy.md` ("Free plan boundaries"). **Decided as policy**, but current *production*
  config contradicts one clause — Free downloads are currently `true` in production catalog (see
  finding table; flagged explicitly as a drift in
  `docs/pricing-coin-economy-release-audit-2026-07-30.md` §16, "Free downloads: Explicitly excluded →
  Production Free downloads are enabled").
- **Wallet consumption order:** promotional bonus → subscription (incl. carry-forward/admin
  adjustment/migration/free-allowance) → top-up; promo beats expire and are spent first.
  `docs/pricing-strategy.md` ("Recommended Wallet Behavior"), architecture in
  `docs/pricing-architecture-spec.md` ("D. Beat wallet and accounting"). **Decided and implemented**
  per the 2026-07-30 audit §6.3 (VERIFIED by that audit, not re-verified by me from source this pass).
- **Grace period default 5 days, admin-configurable; cancellation preserves access to period end.**
  `docs/pricing-strategy.md` ("Recommended Wallet Behavior" → Subscription lifecycle baseline).
  **Decided as policy.** Implementation status: partially — grace-period *display* logic exists and
  was bug-fixed 2026-04-09 (`pricing-implementation-log.md`, "Grace Period Billing Warning Accuracy
  Fix"), but self-serve cancellation itself does not exist (see below).
- **India-only beta launch; confirmed beta policy matrix (image gen off for Free by default, text
  generation always metered on every tier, TTS/narration never complimentary on any tier, alignment
  metered, SD export on all tiers / HD Plus+Studio only, plan rights and wallet funds are independent
  gates).** `docs/pricing-coin-economy-release-audit-2026-07-30.md` §1.1 "Confirmed beta policy
  decisions" — this explicitly **supersedes any conflicting recommendation** in the earlier strategy/
  architecture docs. This is the single most current, owner-confirmed policy document in the set.
- **No self-serve plan switching in v1; overlapping Razorpay subscriptions are blocked.**
  `docs/future-subscription-account-management.md` — proposed future rule set (upgrade immediate,
  downgrade scheduled) is **proposed, not decided/implemented**.
- **Regeneration not separately gated; beats/coins remain the only limiter in v1.**
  `docs/pricing-strategy.md` ("Regen policy for v1"). **Decided**, but narration regeneration's
  *actual* metering contradicts this decision in the other direction — see Claimed vs actual.

## Part 1 — Claimed vs actual

Primary source for this table is the 2026-07-30 audit pair, which already did a rigorous code
spot-check; I treat its conclusions as VERIFIED-by-proxy (a prior, methodical audit) rather than
re-deriving them from scratch, and I independently re-verified the DB/legal-page claims myself this
pass (marked VERIFIED-05).

| Claim | Source | Status | Evidence |
|---|---|---|---|
| "Production has all pricing rollout switches off" | release-audit §4.1 | Stated TRUE as of 2026-07-30; **not re-checked by me this pass** (see Resume here) | — |
| "Free image generation is off by default, admin-togglable" | beta runbook | Implemented per runbook (migration 082); **not re-verified this pass** | — |
| "Legal pack: 4 documents published, consent gate ON on both dev and prod" | PROJECT_STATE.md line 378, 2026-09-16 | **TRUE — VERIFIED-05** | DB query (both `mcp__supabase__execute_sql` and `-prod`) 2026-09-17: `terms`, `privacy_policy`, `ai_disclosure`, `content_usage_policy` all `doc_version='1.0.0'`, `published_at` set 2026-08-29, `terms.requires_acceptance=true`. Matches PROJECT_STATE.md exactly on both environments. |
| "Refund/Cancellation policy exists" (implied by Razorpay-readiness need) | — | **FALSE / PLACEHOLDER — VERIFIED-05** | DB query both envs: `refund_policy` is `enabled=true`, `access_level='public'` (i.e. **live and publicly routable at `/refund-policy` right now**), but `doc_version=null`, `published_at=null` (never went through the versioning/publish workflow used for the other four), and `content` literally begins `"## Starter Draft - Review Before Rollout"` on **both dev and prod**. Seed source: `lib/managed-pages/registry.ts:302-334`, `metadata: { requiresLegalReview: true, policyPlaceholder: true }`. |
| "No self-serve account deletion" | legal-auth-audit.md §5 "Retention/deletion" | **TRUE — VERIFIED-05** | Grep for `deleteAccount`/`deleteUser`/self-serve deletion action across `app`,`lib` found no such action. DB query: `account_deletion` managed page has `enabled=false` on **both** dev and prod (not even routable), content also still `"## Starter Draft - Review Before Rollout"`. |
| "No transactional email beyond Supabase Auth" | legal-auth-audit.md §5 vendor table | **TRUE — VERIFIED-05** | `package.json` has no `resend`/`sendgrid`/`postmark`/`nodemailer`/`mailgun` dependency; `.env.example` has no email-provider credential, only `SUPPORT_EMAIL` (a mailto target). |
| "Stripe is schema-only, not implemented" | legal-auth-audit.md §5 vendor table; release-audit §15.1 | **TRUE — VERIFIED-05** | No `stripe` npm dependency in `package.json`. Every code hit for "stripe" is either a type-union literal (`BILLING_PROVIDERS = ['stripe','razorpay']`, `lib/types/pricing.ts:12`), a default-value fallback (`lib/pricing/snapshot.ts:437`), or a doc comment. `lib/managed-pages/registry.ts:477` states outright: "Outside-India Stripe routing exists in configuration but is not implemented as a checkout flow in this codebase." |
| "No age assurance / minor can create an account freely" | legal-auth-audit.md §6; PROJECT_STATE.md "Deferred / known gaps" | Consistent across two docs, both explicit deliberate deferrals, not contradicted by anything found | Confirmed no age/kids/minor check anywhere in `app/actions/pricing-checkout.ts` either (grepped) — the gap extends to checkout specifically, not just signup. |
| "No self-serve subscription plan switching" | future-subscription-account-management.md | Consistent with release-audit §15.3 ("No self-service subscription management") — same conclusion from two docs 6 weeks apart | — |
| "Production pricing rollout stays dormant" (release-audit §4.1, 2026-07-30) | release-audit | **STILL TRUE today (2026-09-17) — VERIFIED-05, freshly queried** | `feature_flags` on prod: `pricing_snapshot_enabled`, `pricing_checkout_enabled`, `pricing_shadow_metering_enabled`, `pricing_hard_enforcement_enabled`, `pricing_story_length_ui_limits_enabled`, `pricing_admin_bypass_enabled`, `pricing_routing_provider_in` are **all `false`**. Only `pricing_india_only_beta_enabled=true`. **Dev has since moved far past its 2026-07-30 state**: on dev, `pricing_snapshot_enabled`, `pricing_checkout_enabled`, `pricing_hard_enforcement_enabled`, `pricing_shadow_metering_enabled`, `pricing_story_length_ui_limits_enabled`, `pricing_admin_bypass_enabled`, and `pricing_routing_provider_in` are **all `true`** — dev is now live-testing real hard-enforced coin spending and checkout, prod is not. I did not re-run the full July-30 P0 test matrix against dev's now-active state (out of this stream's scope; flagging for streams 1/2/3). |
| Migration `082_coin_economy_gateway.sql` applied | coin-economy beta runbook | **TRUE on both envs — VERIFIED-05** | `beat_spend_reservation_components` and `beat_usage_event_components` tables exist on both dev and prod (`to_regclass` query). |
| India Plus plan price — `docs/pricing-coin-economy-release-audit-2026-07-30.md` §4.3 says ₹1,450/month, 300 coins | release-audit | **Matches PRODUCTION only** | Prod published `plus`/`IN`/`monthly`: `price_minor=145000` (₹1,450), `monthly_included_beats=30` (=300 coins). **Dev's published row has since diverged**: `price_minor=85000` (₹850), `monthly_included_beats=12` (=120 coins) — a lower test price, not a data-entry error, but it means anyone reading the July audit's India-pricing table and checking it against dev today will see a mismatch. Studio/IN matches on both envs (₹3,950/month, 90 beats/900 coins). |

## Part 1 — Open TODOs, deferred items and known gaps still recorded

Still open per the docs read (I did not re-verify implementation status of most of these — this
pass ran out of budget before reaching that check; see Resume here):

- Carry-forward: designed, schema exists, **no runtime path materializes a `carry_forward` grant** (release-audit §5.4). Public promise vs implementation gap if mentioned externally.
- Promotions: schema + admin UI exist, **no application flow evaluates/applies a promotion** (release-audit §5.5).
- Migration grants / temporary tester Studio entitlement: planned, **not materialized** (release-audit §5.6).
- Annual plans: architecture promises monthly refills on annual billing; **no Stripe, no scheduler** exists (release-audit §15.2).
- ROW/ Stripe checkout: **not implemented at all** — India-only in practice right now (release-audit §15.1, beta runbook confirms India-only beta flag).
- Self-serve subscription management (upgrade/downgrade/cancel/proration): **not implemented**; overlapping Razorpay subscriptions are blocked and users told to wait for manual account management (`future-subscription-account-management.md`).
- `docs/pricing-phase-3-rollout-plan.md` "Remaining Implementation Questions" (migration grant size, tester duration, reservation auto-expiry) — no evidence in later docs that these were ever explicitly frozen as final numbers (30-minute reservation timeout is stated as implemented in release-audit §6.2, so at least that one is resolved).
- Release-audit's own "Immediate decision checklist" (§22) has **9 of 15 items still unchecked** as of 2026-07-30 (Free coin amounts, SD/HD export price, image-regen price source, narration/alignment pricing, carry-forward inclusion, ROW hiding, India Studio 10-beat cap, character-sheet tier config, first hard-enforced action set). Unknown whether these have since been resolved — **not re-checked this pass.**

## Part 1 — Doc hygiene

- **`docs/pricing-strategy.md` (2026-04-06) is the oldest and most superseded document.** Its dollar
  figures for ROW plans (Plus $12/mo, Studio $29/mo) still match production, but its beat counts
  (100/300) only reconcile with production's coin counts (1000/3000) via the later `COINS_PER_BEAT=10`
  conversion — a reader of this doc alone would not know that. Its entire coin-economy meter model
  (what's metered, what's free) is superseded by the 2026-07-30 pair, which explicitly says it
  supersedes conflicting earlier recommendations.
- **`docs/pricing-architecture-spec.md` and `docs/pricing-phase-3-rollout-plan.md` (both 2026-04-06)
  are still structurally accurate** (the schema/table design they proposed is what got built — table
  names match what the later audit references), but several of their "recommended" operational
  behaviors (carry-forward, promotions, migration grants, tester Studio) remain **undelivered four
  months later** per the 2026-07-30 audit. These docs read as forward-looking recommendations that
  should not be mistaken for "done."
- **`docs/pricing-implementation-log.md` is a chronological build log, accurate as history**, useful
  for tracing *why* something is the way it is, but it is not a current-state document — e.g. it
  records "Execution Slice 9" believing wallet surfaces are "live" without the entitlement/metering
  corrections the July audit later found necessary.
- **`docs/pricing-coin-economy-release-audit-2026-07-30.md` + `docs/coin-economy-beta-implementation-runbook-2026-07-30.md`
  are the closest-to-current-truth pair** — most recent, most rigorous, explicitly supersede earlier
  docs, and include a real prioritized P0/P1/P2 list. Caveat: they are now **~7 weeks old** relative
  to this audit (2026-09-17) and I did not verify whether their P0 items have since been fixed or
  whether migration `082_coin_economy_gateway.sql` is applied on dev/prod — **open, see Resume here.**
- **`docs/agent-context/PROJECT_STATE.md` has no dedicated pricing/billing section** — billing state
  has to be pieced together from the coin-economy audit docs rather than from the canonical
  shipped-vs-pending state file the project otherwise relies on for this purpose. This is itself a
  doc-hygiene gap worth flagging to the owner: PROJECT_STATE.md's migration ledger table (grepped)
  lists entries up to 101, and 099/100 (legal) explicitly, but I did not confirm whether 082 (coin
  economy gateway) or later pricing migrations (each numbered independently, e.g. 040 fractional
  action costs) appear in that ledger at all.
- **`docs/production-pricing-rollout-checklist.md` and `docs/razorpay-stage-rollout-runbook.md`** are
  accurate *as procedure* (migration order, flag names) but both predate the July 30 audit and its
  P0 findings, so following them literally today would re-enable a coin economy the July audit said
  was not release-ready (e.g. the checklist's migration list stops at `022`, predating `082`).

## Part 2 — Customer-facing compliance and billing surfaces

### 1. Policy pages (`lib/managed-pages/registry.ts`, 11 seed definitions; DB-verified both envs)

| pageKey | slug | Live/routable | Versioned & published | Content state |
|---|---|---|---|---|
| `terms` | `/terms` | yes, public | yes, `1.0.0`, 2026-08-29, `requires_acceptance=true` | Final — mentions coin-based usage, "does not currently offer self-serve subscription cancellation or automated refunds," Razorpay for India checkout, GSTIN, consumed-coin non-refundability |
| `privacy_policy` | `/privacy` | yes, public | yes, `1.0.0` | Final — discloses payment-related data collection incl. Razorpay payment references; explicit "Kissago does not store your card or bank details" |
| `content_usage_policy` | `/content-usage-policy` | yes, public | yes, `1.0.0` | Final — **names the Grievance Officer under IT (Intermediary Guidelines) Rules 2021 Rule 3(2)**, with a dedicated grievance email |
| `ai_disclosure` | `/ai-disclosure` | yes, public | yes, `1.0.0` | Final |
| `refund_policy` | `/refund-policy` | **yes, public, live** | **no — never published/versioned** | **Content is literally `"## Starter Draft - Review Before Rollout"` on both dev and prod**, states plainly it "must be finalized before live billing rollout" |
| `copyright_licensing` | `/copyright-licensing` | yes, public | no | Still "Starter Draft - Review Before Rollout" on both envs |
| `account_deletion` | `/account-deletion` | **no — `enabled=false` on both envs** | no | Content also still "Starter Draft," but page isn't routable so this is lower-stakes than refund_policy |
| `contact_support` | `/contact` | yes, public | n/a (not a legal/versioned doc) | Functions as Contact Us; asks users to set `SUPPORT_EMAIL` |
| `faq` | `/faq` | gated: `access_level='billing_enabled_only'` (`lib/managed-pages/access.ts:18`) | n/a | Only visible when the billing feature flag is on |
| `blog_news` | `/blog` | yes, but unlinked from nav (PROJECT_STATE.md) | n/a | — |
| `documentation` | `/docs` | admin-only | n/a | — |

**No dedicated Shipping/Delivery policy page exists at all** — not in the registry, not referenced
elsewhere. For an all-digital product this is sometimes folded into the refund policy, but that
document is itself unfinished, so there is currently no delivery-terms disclosure anywhere.

**Legal entity facts** (from `lib/legal/business-config.ts`, referenced by the registry; owner-supplied
per `docs/legal-auth-audit.md` §10): Aavriti Design Studio, a partnership firm registered in India,
GSTIN `24ACLFA8196N1ZN`; registered address in Gandhinagar, Gujarat; governing law India, courts at
Gandhinagar; role-based contact emails (support/legal/privacy/security/grievance/report/copyright)
all `@kissago.cc`; named Grievance Officer per IT Rules 2021. These facts are consistent between the
audit doc and the live registry constant names (`LEGAL_ENTITY_NAME`, `LEGAL_GSTIN`, etc.) — I did not
open `business-config.ts` directly this pass to confirm the literal values still match (medium
confidence, not full VERIFIED).

### 2. Public pricing page

**No dedicated `/pricing` marketing route exists.** Plans and top-ups are shown at **`/wallet`**
(`app/wallet/page.tsx` → `components/pricing/WalletPage.tsx`), which has **no auth gate** — the page
renders for signed-out visitors too; the only auth-dependent behavior is the CTA button text
(`"Sign in to choose {plan}"` when `userId` is null, `WalletPage.tsx:179-181`). So prices **are**
visible signed-out.

Currency formatting: `Intl.NumberFormat` with locale `en-IN` for INR / `en-US` for USD,
`maximumFractionDigits: 0` (`WalletPage.tsx:33-44`, `formatPrice`). **No tax-inclusive label and no
auto-renewal disclosure found anywhere in `WalletPage.tsx`** — grepped for
`tax|GST|auto-renew|inclusive|recurring|cancel anytime`; the only hit was marketing copy ("Made for
recurring family story creation"), not a legal/billing disclosure. Recurring-charge and cancellation
information exists only in the Terms document, not at the point of purchase.

The India-only beta hides the ROW/outside-India market selector in the wallet UI per
`coin-economy-beta-implementation-runbook-2026-07-30.md` ("User-facing behavior"): "The wallet hides
the outside-India market selector while India-only beta is enabled. Checkout also rejects non-India
purchases server-side." (Doc claim; not independently re-verified in code this pass.)

### 3. Transactional email

**Confirmed: no email-sending infrastructure beyond Supabase Auth's built-in transactional mail**
(signup confirmation, password reset). No `resend`/`sendgrid`/`postmark`/`nodemailer`/`mailgun`
dependency in `package.json`; no matching provider credential in `.env.example` (only
`SUPPORT_EMAIL`, a mailto target for the Contact page, not a sending credential). This means: **no
payment receipt, invoice, or purchase-confirmation email can be sent today.** For the owner's stated
goal of a ChatGPT/Claude-style billing area with downloadable invoices, this is a real gap — even a
purely in-app invoice history would need building, and emailed receipts need a provider integrated
from scratch.

### 4. Billing identity fields

**VERIFIED — no billing identity fields are collected or stored anywhere.** Stream 3 confirms no
invoice, receipt, tax, billing-address, or payment-method tables exist in either database. I
independently read `lib/billing/razorpay.ts` and `lib/billing/razorpay-sync.ts` this pass:
`createRazorpaySubscription`/`createRazorpayOrder`/`createRazorpayPlan` never take or send a
customer name, email, phone, or address — the only "name" field anywhere in `razorpay.ts` (line 89)
is the **plan item's display name** ("Plus Monthly"), not a customer identity. No `customer_id` is
even passed when creating a subscription; Razorpay's own hosted Checkout.js widget is what
collects payment details directly in the browser. `billing_customers` upserts in
`razorpay-sync.ts:32-44` write only `user_id`, `provider`, `provider_customer_id` — nothing
identity-shaped. The one place a name/email does travel client-side is `WalletPage.tsx:989-993`,
which passes `prefill: { name: checkout.userName, email: checkout.userEmail }` to the Razorpay
Checkout.js widget purely for autofill — this goes directly from the browser to Razorpay, never
through a Kissago server route or table. **Conclusion: Kissago has no place-of-supply, billing
name/address, phone, or GSTIN capture anywhere**, and relies entirely on Razorpay to hold whatever
billing/payment-instrument data exists.

### 5. Consent at checkout

No purchase-specific consent capture: grepped `WalletPage.tsx` and `app/actions/pricing-checkout.ts`
for `consent|terms|agree|checkbox` — no matches. However, the **general legal-consent gate is ON on
both dev and prod** (`legal_consent_gate_enabled`, verified by DB query this pass and consistent with
PROJECT_STATE.md 2026-09-16). I read `proxy.ts` directly this pass (not just the doc description):
the exempt route pattern is
`^\/(terms|privacy|content-usage-policy|ai-disclosure|refund-policy|account-deletion|contact|help-legal)$`
(`proxy.ts:18`), used both for the moderation-restriction allowlist and (with `/auth/*`, `/signed-out`
added) for the consent-gate skip list. **`/wallet` is not in this pattern — VERIFIED, not just
doc-inferred** — so a signed-in user who hasn't accepted Terms is redirected to
`/auth/accept-terms?next=/wallet` before ever reaching checkout. This is still a general
Terms-acceptance gate (satisfied once, at signup/re-consent time), not a purchase-specific "I agree
to auto-renewal for this plan/price" disclosure at the moment of paying.

### 6. Account deletion and moderation interaction with an active subscription

**VERIFIED.** There is no deletion code path of any kind, self-serve or admin: grepped `app` and
`lib` for `auth.admin.deleteUser`, `admin.deleteUser(`, `deleteUser(` — zero matches anywhere in the
codebase. The only way a user row could be removed today is a human deleting it directly in the
Supabase dashboard, outside the application entirely. Stream 3 confirms billing tables cascade-delete
with `auth.users`. Putting these two facts together: **if an account with a live Razorpay
subscription were ever deleted this way, `billing_subscriptions`/`billing_orders`/`beat_grants` rows
would vanish from Kissago's database, but nothing in that path calls Razorpay to cancel the actual
subscription first** — no code exists to do so, since no deletion code exists at all. The
subscription would keep renewing and charging the customer's card on Razorpay's side with no local
record left to reconcile against, and (per finding S5-2/S5-9 below) no email trail either. This is
recorded as a new finding (S5-9) rather than left as an open question, since the underlying facts
(cascade behavior, absence of any deletion code) are now both confirmed. Moderation (suspend/block
via `user_account_moderation`) is a separate, existing mechanism that does **not** delete the account
or its rows — I did not find any code linking a suspend/block action to Razorpay subscription
cancellation either, so a suspended user's subscription likely continues renewing untouched, but I
did not exhaustively trace the moderation action handlers to confirm this negative — flagged as a
narrower residual gap below.

### 7. Minors / kids mode and checkout

Not independently deep-dived this pass beyond what's already thoroughly documented elsewhere: **no
age gate exists at any layer** (`docs/legal-auth-audit.md` §6, confirmed by that audit's own code
reading, and repeated as a deliberate deferral in `PROJECT_STATE.md`). `/gallery/kids` is a public
URL with no account/PIN requirement — it filters *content shown*, not *who may view or transact*.
`viewer_profiles.age_band` exists as a column but is written and read nowhere. Since any signed-in
account (regardless of the actual age of the person behind it) can reach `/wallet`, and there is no
separate "kids/minor account" type, nothing in the current design would stop a minor's account from
initiating checkout. This matches the project's own documented policy stance (adult-account-holder
policy, not an age-verification system) — it is a known, named deferral rather than an undiscovered
gap, but it is directly relevant to "ready to take real money."

### 8. Currency and locale

India-only in practice right now: `pricing_india_only_beta_enabled` flag (beta runbook), server-side
rejection of non-India purchases in checkout (doc claim, not re-verified in code this pass), and the
UI's `IN`/`ROW` market concept with `ROW` effectively non-purchasable since Stripe isn't implemented.
Currency formatting uses `Intl.NumberFormat('en-IN'|'en-US', {style:'currency', currency: 'INR'|'USD'})`
in `WalletPage.tsx`. No broader country-detection/geo-IP logic was found or looked for beyond the
explicit market selector — **not exhaustively searched this pass.**

## Findings

| ID | Severity | Status | Finding | Evidence | Failure scenario | Direction |
|----|----------|--------|---------|----------|-------------------|-----------|
| S5-1 | **BLOCKER** | VERIFIED | Refund/Cancellation policy is live and publicly routable at `/refund-policy` on both dev and prod, but was never published/versioned and its content literally says "Starter Draft - Review Before Rollout" and "must be finalized before live billing rollout." | DB query (dev+prod) `managed_pages.refund_policy`: `doc_version=null`, `published_at=null`, content head `"## Starter Draft..."`; `lib/managed-pages/registry.ts:302-334`, `metadata.policyPlaceholder=true` | Razorpay's live-activation review (or a card-network chargeback dispute, or a state consumer-protection complaint) finds a "refund policy" page that admits on its face it isn't a real policy yet — this can block Razorpay activation and weakens any refund-denial position. | Finalize and publish `refund_policy` through the same admin versioning workflow used for `terms`/`privacy_policy`/`ai_disclosure`/`content_usage_policy` before requesting Razorpay live activation. |
| S5-2 | **HIGH** | VERIFIED | No transactional email infrastructure exists beyond Supabase Auth's built-in mail — no receipt/invoice email is possible today. | `package.json` (no resend/sendgrid/postmark/nodemailer/mailgun dep), `.env.example` (no such provider var), consistent with `legal-auth-audit.md` §5 vendor table | A real Razorpay payment succeeds and the payer receives zero email confirmation of the charge; the owner's stated "downloadable invoices" billing-area goal has no email leg to stand on. | Integrate a transactional email provider (Resend/Postmark/SES) and build a receipt template before enabling real checkout broadly. |
| S5-3 | **HIGH** | VERIFIED | No Shipping/Delivery policy page exists anywhere in the managed-pages registry, and the one document that might cover "digital delivery" (refund_policy) is itself an unpublished placeholder. | `lib/managed-pages/registry.ts` full pageKey scan — no such page | A reviewer (Razorpay or a user) looking for delivery/fulfillment terms for a digital product finds nothing. | Add explicit digital-delivery language once `refund_policy` is finalized, or as its own short page. |
| S5-4 | **MEDIUM-HIGH** | VERIFIED | No purchase-specific disclosure (auto-renewal terms, next-charge date, tax treatment) appears on the `/wallet` checkout UI itself — only in the Terms document, accepted generically at signup/re-consent time, not tied to the specific purchase being made. | Grep of `components/pricing/WalletPage.tsx` for `tax|GST|auto-renew|inclusive|recurring|cancel anytime` — only marketing copy matched | A recurring subscriber later disputes not having been told about auto-renewal at the moment of paying, which is a real friction point under Indian e-commerce/RBI recurring-payment expectations even though a general Terms acceptance exists. | Add an explicit recurring-billing / price-breakdown disclosure directly in the plan-selection/checkout UI. |
| S5-5 | **MEDIUM** | INFERRED | Billing identity fields (legal name, billing address, place-of-supply/state, phone, GSTIN, company name) do not appear to be collected anywhere — `billing_customers`'s documented schema and `profiles`'s actual schema both lack them. Not independently verified against the live table or `razorpay-sync.ts` this pass. | `docs/pricing-architecture-spec.md` §C `billing_customers` field list; `docs/legal-auth-audit.md` §2 `profiles` columns | If Kissago ever needs to issue its own GST-compliant invoice (rather than relying solely on Razorpay's), there is no place-of-supply or billing-name data to put on it. | Verify the live schema and `razorpay-sync.ts` payload directly (not done this pass); decide whether Razorpay-side invoicing is sufficient or Kissago needs its own billing-identity capture. |
| S5-6 | **MEDIUM** | VERIFIED | `copyright_licensing` (live, public) and `account_deletion` (disabled, not routable) managed pages are also unfinished "Starter Draft — Review Before Rollout" placeholders on both dev and prod. | DB query both envs, content head for both pages | Lower stakes than refund_policy since these aren't Razorpay-mandated, but still customer-facing legal surfaces (IP ownership, data retention) left as drafts. | Finalize or unpublish/hide before wide launch. |
| S5-7 | **LOW-MEDIUM** | VERIFIED | No dedicated `/pricing` marketing page; pricing lives only at `/wallet`, which is functionally correct (reachable signed-out) but not discoverable/SEO-friendly as a "pricing page," and the FAQ page (which explains billing) is gated behind `access_level='billing_enabled_only'` so it's invisible whenever the billing flag is off. | `app/wallet/page.tsx`, `components/pricing/WalletPage.tsx:179-181`, `lib/managed-pages/access.ts:18` | Minor UX/discoverability gap, not a compliance blocker. | Consider a static `/pricing` route or explicitly link `/wallet` from marketing surfaces. |
| S5-8 | **LOW** | VERIFIED | `docs/pricing-strategy.md` and `docs/pricing-architecture-spec.md`/`docs/pricing-phase-3-rollout-plan.md` (all 2026-04-06) are superseded in important ways by the 2026-07-30 audit pair but nothing marks them deprecated; a reader following the reading list in this task's own instructions would hit the stale docs first. | Doc dates and content comparison (this pass) | Wasted effort / wrong assumptions carried forward if someone treats the April docs as current without also reading the July pair. | Add a short "superseded by" pointer at the top of the April docs, or fold their still-valid architecture content into a single current doc. |
| S5-9 | **HIGH** | VERIFIED | No account-deletion code exists at all (self-serve or admin), yet billing tables cascade-delete with `auth.users` (stream 3). If a user row is ever removed directly (e.g. via Supabase dashboard, the only way it could happen today), the local subscription record disappears with no code path that cancels the real Razorpay subscription first — it would keep renewing and charging with no local record left to reconcile. | Grep for `deleteUser`/`admin.deleteUser` across `app`,`lib` — zero matches; stream 3's cascade-delete confirmation | Support deletes a user row to satisfy a privacy request; the customer's card keeps getting charged by Razorpay for a subscription Kissago no longer has any record of, discovered only when the customer complains. | Before any account-deletion feature (self-serve or admin) ships, it must first look up and cancel any live Razorpay subscription for that user, in that order. |
| S5-10 | **HIGH** | VERIFIED | Razorpay subscriptions are created with `customer_notify: 0` (`lib/billing/razorpay.ts:110`), meaning Razorpay itself will not notify the customer of subscription lifecycle events. Combined with S5-2 (no Kissago transactional email), **a real, successful subscription charge currently produces zero email notification to the payer from either system.** | `lib/billing/razorpay.ts:110`; S5-2 evidence | A customer is charged on renewal, receives no email from Kissago and none from Razorpay, and the first they hear of it is the card-statement line item — a strong driver of chargebacks and support complaints once real money is involved. | Either flip `customer_notify` to `1` for subscriptions as a stopgap, or (better) build Kissago's own receipt email and keep Razorpay's notification off deliberately once that exists. |

## Open questions for the owner

- Is the `refund_policy` placeholder content (S5-1) intentionally left unfinished pending owner
  legal review, or was it simply missed in the 2026-08-29 legal-pack publish pass that finalized the
  other four documents?
- Same question for `copyright_licensing` and `account_deletion`.
- Does the owner want emailed receipts/invoices for v1 real-money launch, or is an in-app-only
  purchase history (no email leg) acceptable initially given no email provider is wired up? Note
  Razorpay's own `customer_notify` is also currently off (S5-10), so today the answer is "no
  notification at all," not "Razorpay covers it."
- What should happen to a live Razorpay subscription when an account is deleted or suspended? No code
  handles either case today (S5-9) — this needs an explicit answer before any deletion feature ships.
- Should GST-compliant invoicing be Kissago's own responsibility, or is relying on Razorpay's
  transaction/invoice data sufficient for the owner's compliance posture? (Affects whether billing
  identity fields in S5-5 need to be built.)

## Resolved on resume (2026-09-17, second pass)

All items from the original `Resume here` list were closed this session:

1. Production pricing rollout flags re-queried fresh: still all `false` except
   `pricing_india_only_beta_enabled` — the July 30 audit's "dormant" conclusion still holds for
   **production**. Dev, however, has since flipped `pricing_snapshot_enabled`,
   `pricing_checkout_enabled`, `pricing_hard_enforcement_enabled`, `pricing_shadow_metering_enabled`,
   `pricing_story_length_ui_limits_enabled`, and `pricing_admin_bypass_enabled` all to `true` — dev is
   now live-testing real hard-enforced spend. A full re-run of the July audit's P0 test matrix against
   dev's current state is out of this stream's scope (belongs to streams 1/2/3) and was not attempted.
2. Stripe: confirmed no SDK/dependency, config-only — see Claimed vs actual table.
3. `lib/legal/business-config.ts` read directly — matches `docs/legal-auth-audit.md` §10 exactly.
4. `proxy.ts` read directly — confirmed `/wallet` is not in the legal-slug exempt pattern.
5. Account deletion / subscription interaction — answered, see Part 2 §6 and finding S5-9.
6. `lib/billing/razorpay.ts` and `razorpay-sync.ts` read directly — no billing identity data
   collected or sent; see Part 2 §4 (upgraded from INFERRED to VERIFIED) and finding S5-10.
7. Migration `082` confirmed applied on both dev and prod via its component tables' existence.
8. Kids-mode/minor checkout gating — confirmed no age/kids/minor check anywhere in
   `pricing-checkout.ts`.
9. IN Plus plan price cross-checked: production matches the July audit's ₹1,450/300-coin figures;
   dev has since diverged to a lower ₹850/120-coin test price — noted in Claimed vs actual.
10. Findings table re-ordered with two new entries (S5-9, S5-10) added in severity position.

No items remain open for this stream at completion time, beyond the standing "Open questions for the
owner" below (which are genuinely for the owner, not further research).
