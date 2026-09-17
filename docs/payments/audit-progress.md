# Payments & billing — progress and handoff

**This is the living handoff for all payments work.** A fresh session reads this section first, then
`prompt-packs/kissago-payment-billing-prompt-pack-2026-09-17/` (the phase prompts; owner decisions in `01_…`).

## Next session starts here (written 2026-09-17, owner at 70% usage, away from desk)

**State:** branch `payments`, last commit is the handoff commit after `6685db5`, working tree clean. Phase 1 code is
complete and reviewed (tsc, eslint, 1,510 tests green) but **not verified against Razorpay** and **migration 124 is not
applied anywhere**. Nothing is merged to `dev`/`main`, nothing deployed.

**Step 1 — close Phase 1 with the owner (Opus, no agents needed):**
1. Ask the owner for session usage.
2. Owner applies `supabase/migrations/124_billing_money_correctness.sql` on **dev** (run the precheck in its header
   first; dev had 0 duplicate grants on 2026-09-17). Then verify read-only on dev (plan §6 "Database" 2 and 4) and
   update the 124 row in PROJECT_STATE's ledger.
3. **Open question to ask first:** where does the `payments` branch run against the dev database with a public
   URL (Vercel preview? other)? Razorpay test webhooks need it. Don't guess.
4. Owner does the dashboard steps: register the test webhook (events listed in `research/06`, including
   `refund.*` and `payment.dispute.*`), set `RAZORPAY_WEBHOOK_SECRET` on that deployment, and turn on
   `pricing_checkout_enabled` and `billing_reconcile_enabled` on dev.
5. Walk the sandbox runbook, `phase-1-plan.md` §6, steps 3–9. Record results here. The UPI Autopay step answers the
   long-open question in `research/06` Q1: write the finding there.
6. When §6 passes, mark Phase 1 **done** in the table below and commit.

**Step 2 — plan Phase 2** (durable payment/refund/document records, billing profile, retention-safe deletion) from
`prompt-packs/…/04_PHASE_2_DURABLE_BILLING_LEDGER.md`. Write `docs/payments/phase-2-plan.md` to the same
standard as `phase-1-plan.md` (verified facts, full migration SQL, per-file edits, tests, verification). Stop for
owner approval before any code. Owner decisions that bear on it: #5 (GSTIN from business config) and #6 (8-year
retention, anonymise on delete) below. Phase 1 deliberately left refunds of **renewal** payments unmatched
(outcome `refund_unmatched`, payload kept); Phase 2's ledger should backfill from `billing_webhook_events`.

**If something fails in the sandbox:** checkout can be stopped with `pricing_checkout_enabled` off (server-enforced
within 60 s), and the backstop with `billing_reconcile_enabled` off. Plan §7 has the rest.

**Working rules:** Opus plans and reviews, Sonnet agents execute (at most 2 at once, sequential when files
overlap), review diffs rather than agent reports, commit per unit, keep this section current, and advise a fresh
session at natural checkpoints.

## Implementation status

| Phase | Status |
|---|---|
| 0 Discovery | **done 2026-09-17** — `phase-0-discovery-2026-09-17.md`; new streams `research/09`, `research/10` |
| 1 Money correctness | **code complete, not yet sandbox-verified** — `phase-1-plan.md`. Unit A `1392121`, Unit B `fabea84`, Opus review fixes `6685db5`. Next: owner applies 124 on dev, then sandbox runbook (plan §6). Phase 1 closes only after §6 passes |
| 2–8 | not started |

**Delegation:** Opus plans/reviews, Sonnet executes; **at most 2 agents at once**; ask the owner for session usage at each phase boundary.

**Owner answers so far (2026-09-17)**
- Billing entity is **Aavriti Design Studio** (GST-registered parent). GSTIN: see decision 5 below.
- Signed-out visitors browse the whole catalogue and must sign in to watch anything (already built). The daily quota only concerns signed-in users.
- Phase 0 kept light: the audit is same-day and no billing code changed since.

**Owner decisions from Phase 0 (2026-09-17)**
1. **Images on coins:** Free (trial coins) and Audience (top-ups) may generate images. Must be an admin setting so it can be switched off later. Today only Plus/Studio can. → Phase 3.
2. **Daily slot:** used when a story opens and its content loads. Failed loads don't count. Show "N of 3 left today"; confirm only before the last slot. → Phase 3.
3. **Replays are free all day:** the same story watched any number of times that day counts once (kids loop content; never block that). → Phase 3.
4. **Reset:** midnight in **each user's own timezone**. No timezone is stored today; capture it from the browser. Guard against timezone switching being used to reset early. → Phase 3.
5. **GSTIN:** invoices use the value in `lib/legal/business-config.ts` (supersedes the placeholder instruction). → Phase 6.
6. **Audit D3–D7 approved as recommended:** refund within 7 days if < ~20% of that purchase's coins used, unused coins clawed back; no subscription-coin rollover; Resend or Postmark for email, with Razorpay `customer_notify` on as a stopgap; adult attestation and no checkout from kids mode; block → cancel at cycle end and stop grants, delete → cancel immediately, anonymise, keep billing records 8 years.
7. **Defaults accepted without objection:** kids and adult mode on one login share one daily limit; admins can grant unlimited watching; republishing doesn't give readers a new slot; Audience → Plus upgrade rules decided at Phase 5.

**Deliberate deviation from the pack:** the checkout kill switch blocks new checkouts only. Verify, webhook and reconcile still honour payments already started (see `phase-1-plan.md` decision 8).

---

# Audit (2026-09-17)

_Audit only: no code, schema, flag or config changes._

**Deliverables:** audit and plan written; `billing-audit-2026-09-17.md` (current state) and `billing-plan-2026-09-17.md` (suggested plan), both in this folder.

**Owner's framing:** coins track internal consumption; billing is real money. Users buy a subscription tier, get a limited number of coins per cycle, and spend them. Top-up packs also exist. Razorpay now (sandbox-tested, a few test payments in dev and prod); Stripe later for international.

**Delegation limit:** at most 2 research agents at once (owner, 2026-09-17).

## Research streams

Notes live in `research/`. Each paused stream has a `## Resume here` section listing what is left.

| # | Stream | Status |
|---|---|---|
| 01 | Checkout and payment capture | done — reviewed; 2 false "safe" claims corrected (F-R1, F-R2) |
| 02 | Entitlements, grants, coin↔money value | done — reviewed; per-coin pricing table corrected, Plus-vs-top-up value inversion added |
| 03 | Data model and live DB state, dev vs prod | done — reviewed; webhook and row counts re-queried and confirmed |
| 04 | Admin tools and operations | done — reviewed; no cancel/refund wrapper confirmed in `lib/billing/razorpay.ts` |
| 05 | Docs vs code, compliance surfaces | done — reviewed; draft refund-policy seed confirmed at `lib/managed-pages/registry.ts:315` |
| 06 | Razorpay capabilities (web) | done — answers folded into audit H1/H9/H10 and plan Phases 1, 4, 6 |
| 07 | India tax and consumer law (web) | done — folded into audit H3/H4/H11/M8 |
| 08 | Billing UX benchmarks, Stripe readiness (web) | paused by owner usage limit — Part 1 and 4.1 used in the plan; the rest is needed before plan Phase 7 |

## Findings verified directly by the reviewer (Opus)

These were confirmed by reading the code, independent of agent reports.

1. **Failed webhooks are never reprocessed.** `app/api/billing/razorpay/webhook/route.ts:46-57` returns `duplicate: true` for any event ID already stored, whatever its status. A failed event is stored as `failed` (`:93-104`) and answered with 500. Razorpay retries with the same event ID, and the retry is acknowledged as a duplicate. The grant never happens unless the verify call already did it.
2. **Coin grants have no database-level idempotency.** `beat_grants` (`supabase/migrations/017_wallet_core.sql:4-15`) has no unique constraint on `(source_type, source_ref_id)`. `grantTopupIfMissing` and `grantSubscriptionCycleIfMissing` (`lib/billing/razorpay-sync.ts:137-168`, `:192-226`) check and then insert. The browser's verify call and Razorpay's webhook usually arrive within moments of each other, so both can pass the check and both insert → double coins.
3. **Subscription verify trusts a client-supplied subscription ID.** `app/api/billing/razorpay/verify/route.ts:59-63` checks the signature against the stored subscription ID, but `:70` fetches `body.razorpaySubscriptionId` from the request and syncs that one. `syncRazorpaySubscriptionState` then updates or inserts that subscription under the caller's `user_id` (`lib/billing/razorpay-sync.ts:65-83`) and grants against it, with the idempotency check scoped to the caller's user. A user holding one valid signature can attach a different subscription ID. The direction is to always use the stored ID.
4. **Account deletion erases payment records.** `billing_customers`, `billing_subscriptions` and `billing_orders` reference `auth.users` with `ON DELETE CASCADE` (`016_billing_core.sql:6,20,41`), and so do `beat_grants`. Deleting a user deletes their payment history, which conflicts with tax record retention. Stream 07 will confirm the retention period.
5. **Top-up verify grants coins without confirming capture.** `verify/route.ts:115-132` grants on a valid signature alone. A valid signature proves authorisation, not capture, so if auto-capture is off or authorisation arrives late, coins are granted for money not yet captured. Severity depends on the account's capture setting (stream 06).
6. **No refund or dispute handling.** The webhook only acts on payloads with a subscription entity or an order/payment ID (`webhook/route.ts:116-244`). `refund.*` and `payment.dispute.*` events fall through to `ignored` or are processed as plain order updates, and coins are never clawed back.
7. **Razorpay sends no customer notifications for subscriptions.** `lib/billing/razorpay.ts:110` sets `customer_notify: 0`, and the app has no email of its own yet (stream 05 to confirm). Pre-debit and receipt obligations need checking (streams 06/07).
8. **Test-mode plan IDs are cached in the catalog.** `ensureRazorpayPlanRef` (`app/actions/pricing-checkout.ts:272-306`) stores the Razorpay plan ID on the plan version and reuses it forever. Switching to live keys fails on every subscription until those refs are cleared. Two first-time checkouts at the same moment can also create duplicate Razorpay plans.
9. **A halted or pending subscription locks the user out.** The guard at `pricing-checkout.ts:59-65` blocks new checkout for `created/authenticated/active/pending/halted`, and there is no self-serve cancel. A user whose renewal failed cannot fix it themselves.
10. **The checkout kill switch is UI-only.** `pricing_checkout_enabled` is read by `components/pricing/WalletPage.tsx` only; `prepareRazorpayCheckoutInternal` (`app/actions/pricing-checkout.ts:30-162`) never checks it, so the prepare route and server action create real orders and subscriptions with the flag off. Confirms stream 01's F3.
11. **In India, subscription coins cost more than top-up coins, in both environments.** Published catalogs, 2026-09-17:
    - **Prod:** Plus ₹1,450 → 300 coins/month (₹4.83/coin); Studio ₹3,950 → 900 (₹4.39); top-ups 120/240/480 coins at ₹450/₹850/₹1,650 (₹3.75/₹3.54/₹3.44).
    - **Dev:** Plus ₹850 → 120 coins (₹7.08/coin), so the ₹850 top-up gives twice Plus's coins.

    Subscription grants expire at cycle end, while top-ups never expire (`razorpay-sync.ts:151-168` sets no `expires_at`). A subscription is only worth it for its tier-gated features. This is an owner pricing decision. The dev and prod catalogs also disagree on Plus, so the launch price needs to be named.
12. **The displayed continuation price and the actual charge come from different sources** (stream 02, display side verified). `lib/pricing/story-continuation.shared.ts:24-33` shows the flat `continue_story_new_beat` catalog row. Stream 02 reports that runtime authorization composes prompt-only cost plus the live image-model coin cost, so the two drift apart when an image model's price is tuned.
13. **No webhook has ever been received, in either environment** (re-queried 2026-09-17). Dev: 12 checkout orders (8 abandoned subscription checkouts, 1 active subscription, 1 paid and 2 abandoned top-ups), 1 subscription grant, 1 top-up grant, **0** `billing_webhook_events`. Prod: 0 rows in every billing table. Everything credited so far came through the browser's verify call. Renewals, halts, cancellations, refunds and the webhook route itself are untested end to end. The dev subscription's second cycle, if already due, will not have been granted.
14. **Support desk cannot handle money problems without SQL** (stream 04, wrapper list confirmed). `lib/billing/razorpay.ts` wraps only create-plan, create-subscription, fetch-subscription and create-order: no cancel, refund, fetch-payment or fetch-invoice. There is no admin view of a user's orders and subscriptions, grants cannot be clawed back, and blocking a user leaves their subscription renewing.
15. **Customer-facing surfaces are not ready for Razorpay live activation** (stream 05). The public Refund & Cancellation page still opens with "Starter Draft - Review Before Rollout" (seed at `lib/managed-pages/registry.ts:315`; stream 05 reports the published copy is the same in dev and prod). There is no Shipping/Delivery policy, no transactional email, and no billing identity (name, state, GSTIN). Checkout discloses neither auto-renewal nor tax. There is also no account-deletion code at all, and a manual user deletion would cascade away the records of a subscription Razorpay keeps charging.

## Handoff — if this session ends before the deliverables exist

_Written at owner-reported 80% session usage._

- Streams 01–05 are **done and reviewer-checked**. Their notes are the evidence base, and the reviewer corrections are inline, marked "Reviewer correction/check (Opus)".
- Streams 06 (Razorpay) and 07 (India tax/law) were told to wrap up. Anything unfinished is under `## Resume here` in their notes.
- Stream 08 is **paused**. Part 1 (ChatGPT/Claude billing) and Part 4.1 (Stripe India status) are written; the rest is listed under `## Resume here`. It isn't needed for the first plan draft.
- **Next:** write `billing-audit-2026-09-17.md` from findings 1–15 above plus the Findings tables in `research/01–05`, then `billing-plan-2026-09-17.md` using 06/07/08 as well.
- **Owner decisions already surfaced:** the India launch price for Plus (dev and prod differ), and whether subscription coins should cost more per coin than top-ups and expire monthly.
- Everything stays on branch `payments`. Nothing is merged or changed outside `docs/payments/`.
