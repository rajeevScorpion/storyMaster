# Payments & billing audit — progress

_Started 2026-09-17 on branch `payments`. Audit only: no code, schema, flag or config changes._

**Deliverables (not yet written):** `billing-audit-2026-09-17.md` (current state) and `billing-plan-2026-09-17.md` (suggested plan), both in this folder.

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
| 05 | Docs vs code, compliance surfaces | resumed (running) |
| 06 | Razorpay capabilities (web) | resumed (running) with 4 targeted questions |
| 07 | India tax and consumer law (web) | paused (notes on disk) — queued next |
| 08 | Billing UX benchmarks, Stripe readiness (web) | paused (notes on disk) — queued |

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
