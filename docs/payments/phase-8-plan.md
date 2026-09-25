# Phase 8 — international readiness

Planned 2026-09-25 on branch `payments`, after the Phase 7 walk. Prompt:
`prompt-packs/kissago-payment-billing-prompt-pack-2026-09-17/10_PHASE_8_INTERNATIONAL_READINESS.md`.
**No international checkout is built here.** The India launch stays India-only.

**Exit (from the prompt):** a second provider can be added through a documented adapter boundary,
without rewriting the billing or entitlement model.

## 0. Scope

**In:**
- A map of what is provider-neutral and what is Razorpay-specific, checked against the code and both
  databases.
- One latent defect fixed: checkout never checks which provider an item belongs to (G1).
- The review doc, `docs/payments/international-readiness.md`:
  - the adapter contract, written down;
  - the checklist of what a second provider must touch;
  - the merchant-of-record vs Stripe fork;
  - the research and CA questions, parked as a decision gate.

**Out:**
- Any Stripe or merchant-of-record code, SDK, webhook or catalog.
- Extracting a runtime adapter interface now (decision I1).
- Re-running the provider research. The prompt says to redo it when international work starts, and not to
  trust the 2026-09-17 findings by then.
- Export-of-services tax documents (LUT, zero-rated IGST).

## 1. Verified current state (2026-09-25)

**Already neutral. A second provider plugs in without changes:**
- **The schema.** Every billing table uses `provider`, `provider_mode` and `provider_*_id` columns; no
  column is named after Razorpay. The provider CHECKs on `billing_customers`, `_orders`,
  `_subscriptions`, `_payments`, `_webhook_events`, `pricing_plan_versions` and `pricing_topup_packs`
  allow `stripe` and `razorpay`.
- **The ledger** (`lib/billing/ledger.ts`). `recordPayment`, `recordRefund`, `recordDispute` and
  `issueDocumentIfEnabled` all take `provider` and `providerMode` as inputs.
- **Entitlements and grants, consumption, the refund-eligibility rules, notifications and emails, the
  billing profile, and the health cards.** They read Kissago's own tables.
- **Catalog routing.** Each plan version and top-up pack carries `provider` and `pricing_market_key`.
  The markets are `pricing_routing_provider_in` / `_row`: IN defaults to `razorpay`, and ROW to
  `stripe`.
  - Dev has 5 published ROW plans and 3 ROW top-ups tagged `stripe`.
  - Prod has 4 published ROW plans tagged `stripe`.
- **The market lock.** `pricing_india_only_beta_enabled` is on in both environments and defaults to on.
  `assertBetaMarketAllowed` (`app/actions/pricing-checkout.ts:491`) refuses any non-IN item.

**Razorpay-specific, called directly with no seam:**

| Operation | Where it's called |
|---|---|
| Create checkout (order or subscription) | `app/actions/pricing-checkout.ts:348`, `:421` |
| Confirm payment (signature verify) | `app/api/billing/razorpay/verify/route.ts` |
| Webhook parse and apply | `app/api/billing/razorpay/webhook/route.ts` → `lib/billing/razorpay-webhook.ts` |
| Map provider state onto our tables | `lib/billing/razorpay-sync.ts` (`settleTopupOrder`, `syncSubscriptionFromProvider`) |
| Cancel a subscription (customer) | `app/actions/billing-account.ts:553`, `:661` |
| Refund and cancel (admin) | `app/actions/admin-billing-actions.ts` |
| Daily reconcile, pending refunds | `lib/billing/razorpay-reconcile.ts`, `lib/pricing/enforcement.ts:483`, `:538` |
| The client checkout window | `components/pricing/checkout/useRazorpayCheckout.ts`, `WalletPage.tsx` |
| Test or live mode | `getRazorpayMode()` becomes `provider_mode` everywhere |

`lib/billing/razorpay.ts` is already the de facto adapter: every Razorpay HTTP call lives there. What's
missing is a seam that the callers above go through.

**India-only by design, and changes for any international sale regardless of provider:**
- tax (`lib/billing/tax.shared.ts`, GST by state);
- document numbering (`KG/26-27/…`) and the Rule 46 content;
- the billing profile's state field.

## 2. Findings

- **G1 — checkout ignores the item's provider (latent defect).**
  - `prepareRazorpayCheckoutInternal` never reads `version.provider` or `topup.provider`. The top-up path
    writes `provider: 'razorpay'` as a literal (`:438`).
  - The only thing that stops a `stripe`-tagged USD item being sent to Razorpay is the market lock. Turn it
    off (for example to let someone abroad pay in INR), and a ROW item goes to Razorpay:
    - in USD;
    - with India GST logic around it;
    - recorded as a Razorpay payment.
  - Fix: refuse unless the item's provider is `razorpay` (P8-A).
- **G2 — no adapter seam.** Covered by the table above. Deliberately not fixed now (I1).
- **G3 — the provider CHECKs name only `stripe` and `razorpay`.** A merchant of record (Paddle, Lemon
  Squeezy, Dodo…) needs a one-line migration per table. Recorded, not done.
- **G4 — `provider_mode` comes from Razorpay's key prefix.** A second provider needs its own mode source.
  This goes in the contract.

**Why not extract the adapter now (I1):**
- The two international routes differ exactly where an interface would sit:
  - **A merchant of record** is the seller. It issues the invoice, owns VAT, and owns the customer's
    payment relationship. Our documents, tax and refund initiation become *its*.
  - **Stripe on a foreign entity** keeps everything ours.
- An interface written now would guess that choice.
- It would also rewire every money path (checkout, refund, cancel, webhook, reconcile) days before live
  money, for no India benefit.
- Documenting the contract and the call sites meets the exit without that risk. The extraction becomes
  step one of the international work, once the route is chosen.

## 3. Owner decisions

| # | Question | Recommended |
|---|---|---|
| I1 | Code scope | **G1 guard + the review doc.** No adapter extraction until the international route is chosen. Alternatives: the doc only (leaves G1 open), or also extract the interface now (rewires every money path before go-live). |
| I2 | Research timing | **Defer.** Park the questions in the doc and run them when international work starts, per the prompt. Alternative: refresh the 2026-09-17 Stripe/MoR findings now (they would be stale again by then). |

## 4. Units

### P8-A — provider guard at checkout (Sonnet; Opus reviews)

- In `prepareRazorpayCheckoutInternal` (`app/actions/pricing-checkout.ts`), after the item is loaded and
  `assertBetaMarketAllowed` runs, for both the plan (`~:211`) and top-up (`~:405`) paths:
  - refuse unless `item.provider === 'razorpay'`, with
    `CheckoutRefusalError("This item can't be bought here yet.", 'provider_unavailable', 400)`;
  - add `'provider_unavailable'` to `CheckoutRefusalCode`;
  - `null` counts as not Razorpay (only free plans carry `null`, and those are never checked out).
- The top-up insert at `:438` then writes `topup.provider` rather than the literal. It's the same value
  once the guard has passed, but it keeps the row truthful if the guard ever moves.
- Put the pure check in `lib/billing/checkout-guard.shared.ts` (`assertCheckoutProvider`), with tests:
  `razorpay` passes; `stripe` and `null` refuse.
- A route-level test: a `stripe` top-up with the market lock mocked off gets a 400 with the sentence, and
  Razorpay is never called.
- Gate: tsc, lint, the full tests, and `build:verify`.

### P8-B — `docs/payments/international-readiness.md` (Opus)

1. **The boundary map:** §1 of this plan, kept current.
2. **The adapter contract,** as a TypeScript sketch in the doc (not code):
   - `createCheckout`, `confirmPayment`, `parseWebhook` → normalized events, `fetchPayment`,
     `fetchSubscription`, `cancelSubscription(atCycleEnd)`, `refund`, `fetchRefund`, `mode()`;
   - the normalized event and status shapes that `razorpay-sync.ts` already maps onto;
   - which of these a merchant of record owns instead.
3. **The second-provider checklist:** each row of the §1 table, with what changes. Plus the migration
   (G3), env and keys, the webhook route, the client window, `provider_mode`, and the catalog rows.
4. **The route fork:** merchant of record vs foreign entity + Stripe vs Razorpay International, showing
   what each moves out of our code (invoices, tax, refunds, disputes).
5. **Parked research:** the prompt's ten comparison points, marked "re-run at start".
6. **CA / legal gate:** export of services (LUT, zero-rated IGST), foreign-currency settlement and FIRC,
   the invoice wording for foreign customers, and whether a merchant of record's invoice replaces ours.

**Order:** P8-A ∥ P8-B. They touch disjoint files. Then Opus reviews P8-A.

## 5. Verification

- P8-A: the gate, plus a read of the diff against §4.
- P8-B: every file and line reference in the doc is checked against the tree at the commit it's written
  on.
- No walk is needed. Nothing a customer sees changes, and G1 is unreachable while the market lock is on.

## 6. The deferred go-live items (runbook §1.1): no Phase 8 blocker

None of them depends on Phase 8, and Phase 8 depends on none of them. All of them need the owner present:

| Item | Needs |
|---|---|
| Unit 0 cycle-end-cancel probe, and the subscribe → cancel → reconcile walk | a test subscription, whose card-save step sends a **real SMS OTP** to the owner's phone |
| Phase 6 step 7, the subscription emails | the same session |
| The checkout sheet and logo on a phone | the owner's phone |
| The six CA answers | the CA |

The OTP items can run as one session: the agent drives Playwright, and the owner reads out the OTP.
