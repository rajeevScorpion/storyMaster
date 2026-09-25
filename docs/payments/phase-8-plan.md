# Phase 8 — international readiness: the US on Razorpay

Planned 2026-09-25 on branch `payments`, after the Phase 7 walk. Prompt:
`prompt-packs/kissago-payment-billing-prompt-pack-2026-09-17/10_PHASE_8_INTERNATIONAL_READINESS.md`.

**The owner widened the prompt's scope (2026-09-25):** the US market goes through **Razorpay
International**, not a second provider. It is built now, behind the existing India-only lock, while the
India go-live goes ahead. **Switching the US on is a separate, later owner step.**

## 0. Scope

**In:**
- US customers can pay in USD, for top-ups and for monthly and annual plans, through the same Razorpay
  account.
- Billing details that work outside India: country, international phone, no Indian state.
- Export-of-services tax (zero-rated under an LUT) and a matching invoice.
- A country allowlist, so "international" means the US only (§2, U1).
- A provider guard at checkout (G1).
- `docs/payments/international-readiness.md`: why Razorpay, the written provider contract, and the CA
  gate.

**Out:**
- **A runtime provider adapter.** The owner dropped it on 2026-09-25, because Razorpay covers the US. The
  contract lives in the doc only, and gets extracted if a second provider is ever chosen.
- Stripe, or any merchant of record.
- Countries other than the US (§2).
- PayPal (it's a Razorpay dashboard switch; later, if wanted).
- An EEFC account (a banking choice; the code doesn't change).
- **Switching the US on.** The owner does that from the runbook, after §6's gates.

## 1. Owner decisions so far (2026-09-25)

| # | Decision |
|---|---|
| I1 | **No adapter extraction.** Guard, plus the doc. The contract is documented, not coded. |
| I2 | **Razorpay International for the US**, mostly the US market. |
| I3 | **Build now, launch the US later.** Everything sits behind `pricing_india_only_beta_enabled`, which stays on until the owner switches the US on. |

## 2. Verified facts (2026-09-25)

**Razorpay International** (official docs and pricing, read 2026-09-25):
- **Payments:** Visa, Mastercard and Amex, in 100+ currencies including USD (amounts in cents). PayPal is
  optional.
- **Subscriptions:** can be priced in USD, cards only. *"The RBI guidelines apply only to domestic cards
  and not international cards"*: no AFA and no pre-debit notice for US cards.
- **Fees:** up to 3% platform fee, plus 18% GST on the fee. Subscriptions on cards add 0.9%.
- **Settlement:** in INR, at the rate when the payment was created. The default is T+7 working days, or
  USD into an EEFC account.
- **e-FIRA:** Razorpay generates one for every international payment (the proof of export).
- **Activation:** Dashboard → Account & Settings → International payments → International Cards, which
  Razorpay reviews. *"Your international payment will fail if you send us a dummy email id and phone
  number."*

**Why the US only, not all of ROW.** Razorpay isn't a merchant of record, so Kissago is the seller
everywhere it sells.
- **EU and UK:** a non-resident selling digital services to consumers there owes VAT from the **first
  sale** (EU non-Union OSS; UK VAT registration).
- **Canada and Australia:** they have registration thresholds.
- **US:** sales tax on digital goods is by state, owed past each state's economic-nexus threshold.
- Opening all of ROW would create EU/UK obligations on day one. **Confirm with the CA (§6).**

**The code:**
- **Catalog:**
  - Published ROW items are tagged `stripe` in USD: dev has 5 plans and 3 top-ups, prod has 4 plans.
  - Dev's ROW prices are placeholders (Audience $300/mo, Plus monthly $0).
- **Razorpay calls:** they already pass the item's currency through (`lib/billing/razorpay.ts`
  `createRazorpayPlan` / `createRazorpayOrder`).
- **Market resolution** (`lib/pricing/snapshot.ts:279`):
  - It takes an explicit market from the client first. So an India-based user can pick ROW.
  - **Export status must come from the billing country, never from the chosen market.**
- **Tax:**
  - `billing_tax_rules.tax_regime` allows only `in_gst` and `none`. The only rule is IN / `in_gst` / 18%.
  - Checkout (`app/actions/pricing-checkout.ts:139`) and renewals (`lib/billing/razorpay-sync.ts:431`)
    both compute GST from `profile.state_code`.
- **Billing profile:**
  - `billing_profiles.country_code` exists, but the form and its validation assume India.
  - `normalizeIndianPhone` rejects anything but +91.
  - The state is required.
- **`'INR'` literals** in nine files: snapshot, wallet-tax, email templates, render-pdf,
  billing-admin-ui, admin-payments-list, WalletPage, PricingRuntimeProvider, PricingStudio.
- **Provider-neutral already:**
  - the schema (`provider*` columns; the CHECKs allow `stripe` and `razorpay`);
  - the ledger (`recordPayment` / `recordRefund` take `provider`);
  - entitlements, notifications and the health cards.
- **Razorpay called directly, with no seam** (for P8-F's contract):

| Operation | Where it's called |
|---|---|
| Create checkout | `app/actions/pricing-checkout.ts:348`, `:421` |
| Confirm payment | `app/api/billing/razorpay/verify/route.ts` |
| Webhook | `app/api/billing/razorpay/webhook/route.ts` → `lib/billing/razorpay-webhook.ts` |
| Map provider state | `lib/billing/razorpay-sync.ts` |
| Cancel (customer) | `app/actions/billing-account.ts:553`, `:661` |
| Refund and cancel (admin) | `app/actions/admin-billing-actions.ts` |
| Reconcile | `lib/billing/razorpay-reconcile.ts`, `lib/pricing/enforcement.ts:483`, `:538` |
| Client window | `components/pricing/checkout/useRazorpayCheckout.ts` |
| Test or live mode | `getRazorpayMode()` → `provider_mode` |

- **G1:** `prepareRazorpayCheckoutInternal` never reads the item's `provider`. The top-up insert writes
  `'razorpay'` as a literal (`:438`). Only the market lock stops a `stripe`-tagged item going to Razorpay.

## 3. Open owner decisions

| # | Question | Recommended |
|---|---|---|
| U1 | Countries at US launch | **The US only**, through a country allowlist (see §2). Adding a country later is a value change, after the CA confirms its tax position. |
| U2 | USD prices, per plan and pack | **Not needed to build.** The owner sets them in `/admin/pricing` before switch-on. P8-E needs placeholders on dev only. |
| U3 | The export invoice's series | **The same `KG/` series,** with the export wording (Rule 46 allows one series). The CA can say otherwise (§6). |

## 4. Units

**Order:**
- **M** first. Opus writes it; the owner applies it on dev.
- Then **A ∥ B ∥ C** (Sonnet). Their files are disjoint.
- Then **D** (Sonnet), which needs B and C.
- Then **E**, the walk.
- **P8-F** (the doc, Opus) can run any time.

An execution spec with line anchors, as in Phase 7 §8, is written at the start of each batch against the
tree at that point.

### M — migration 138 (Opus writes; the owner applies)

- Widen the `billing_tax_rules.tax_regime` CHECK to add **`in_export_lut`**.
- Seed a **draft** rule: `ROW` / `all` / `in_export_lut` / 0%, with the same SAC.
  - Draft means checkout refuses ROW with "tax rules unavailable" until the owner publishes it after
    the CA's answer. That's fail-closed twice, with the market lock.
- A flag, **`billing_international_countries`**: `enabled=false`, `value='US'`.
  - Off means no international checkout for anyone, even with the market lock off.
  - It fails closed when the row is missing.
- The ledger row, and a rollback.

### P8-A — provider and country guard at checkout (Sonnet)

- **G1:** refuse unless `item.provider === 'razorpay'`, with `CheckoutRefusalError("This item can't be
  bought here yet.", 'provider_unavailable', 400)`.
  - The pure check goes in `checkout-guard.shared.ts`.
  - The top-up insert writes `topup.provider`.
- **The country gate:** for an item whose market isn't `IN`, refuse unless:
  - `billing_international_countries` is on;
  - the profile's `country_code` is in its list;
  - and that country isn't `IN`.
  - The code is `'country_not_supported'`.
- **Market-consistency rule:**
  - An `IN` item needs a profile country of `IN`.
  - A ROW item needs a listed non-IN country.
  - This stops an India-based customer from buying the zero-rated USD price.
- Tests for each refusal and each pass.

### P8-B — international billing details (Sonnet)

- **Profile form** (`billing-details-form.shared.ts` and the dialog):
  - A country field, a `FilterDropdown` of the allowlisted countries plus India.
  - **India:** the current rules, unchanged.
  - **Other countries:** no state or GSTIN; a free-text region; the postal code in that country's
    format.
  - **Phone:** E.164. Keep `normalizeIndianPhone` for IN, and add `normalizeInternationalPhone`.
- **`isBillingProfileComplete`:** country-aware.
- **Razorpay prefill:** send the real phone in E.164 (Razorpay refuses dummy contact details).
- Tests in the `.shared.ts` files. Plus an e2e check that the dialog opens and saves for a US address.

### P8-C — export tax (Sonnet)

- **`computeTax`** (`lib/billing/tax.shared.ts`): the `in_export_lut` regime gives tax 0 and supply type
  `'export'`.
  - `GstSupplyType` gains `'export'`.
  - The breakdown carries the regime, so the documents can word it.
- **The checkout tax context** (`pricing-checkout.ts:~100-160`):
  - pick the rule by **profile country**: IN gives the IN rule, and a listed country gives the ROW rule;
  - never pick it by the client's chosen market.
- **The renewal path** (`razorpay-sync.ts:431`): the same selection. A renewal's split is written once
  (the Phase 5 rule), so a customer who changes country mid-subscription keeps the original split
  until the next charge.
- **Verification at capture:**
  - Razorpay's payment entity carries `international: true` for a foreign-issued card.
  - Record it in the purchase snapshot.
  - An export sale whose card is **not** international shows on the billing-incidents page (a new card),
    because it may be an India-resident customer claiming a US address.
- Tests: the regime maths, rule selection by country, and the mismatch card's mapper.

### P8-D — documents, emails and copy (Sonnet; needs B and C)

- **Invoice** (`document-content.shared.ts`, `render-pdf.ts`):
  - For an export supply, the endorsement "Supply meant for export under LUT without payment of IGST",
    with the LUT ARN (a business-config constant, empty until the owner files the LUT; issuing refuses
    an export invoice while it's empty).
  - The customer's country and address.
  - Amounts in USD.
  - Whether an INR value at the payment-date rate is also needed waits on CA question 4 (§6).
- **Credit notes:** the same endorsement.
- **Emails** (`templates.shared.ts`): currency from the payment, not `'INR'`.
- **The nine `'INR'` literals:** each becomes the row's own `currency_code`, or stays with a comment
  when it is genuinely India-only.
- **Checkout sheet and wallet:**
  - No "+ GST" and no IGST line for an export quote.
  - The price reads "$29 / month", with the renewal line from Phase 7 in USD.
  - The wallet's "Stripe comes next" copy goes.
  - `yearlyCheckoutDeferred` stays IN-only.
- **Policy text:** the Refund Policy and Terms get a short "Customers outside India" section on the
  currency, the tax and how refunds reach a foreign card. Opus drafts it, and the owner publishes it with
  the US switch-on.

### P8-E — walk on the Preview (Opus, with Playwright)

On dev, with the switches on for the walk only:
- the market lock **off**;
- `billing_international_countries` **on**;
- the ROW rule **published** on dev only;
- ROW items re-tagged `razorpay`, with dev USD prices and USD Razorpay plans created from PricingStudio.

The walk:
- **Top-up:** a US profile pays with a Razorpay test **international** card. Check that:
  - the order is USD;
  - the payment records `international: true`;
  - the invoice carries the export wording and 0 tax;
  - the email shows USD;
  - a refund issues a USD credit note.
- **Subscription:** the monthly USD plan, on an international test card. There's no RBI mandate for a
  foreign card, so **it should need no SMS OTP**. That's worth confirming, and it unblocks walking
  subscriptions without the owner's phone.
- **Refusals:**
  - an India profile trying to buy a ROW item;
  - a US profile with the countries flag off;
  - a `stripe`-tagged item.
- Put everything back afterwards, as in the Phase 6 and Phase 7 walks.
- **Needs:** Razorpay's **test-mode** international cards. Test mode may need International Cards
  enabled on the test account. Check it first; if it's off, the owner enables it from the dashboard.

### P8-F — `docs/payments/international-readiness.md` (Opus)

- **Why Razorpay International:** the facts in §2, with the sources and the date read.
- **The provider contract** as a TypeScript sketch:
  - `createCheckout`, `confirmPayment`, `parseWebhook`, `fetchPayment`, `fetchSubscription`,
    `cancelSubscription`, `refund`, `fetchRefund`, `mode`;
  - the call sites that bypass it today (the §2 table);
  - what a merchant of record would own instead.
- **The country ladder:** what adding a country takes (the CA's tax answer, the allowlist value, the tax
  rule, the policy text).
- **The US switch-on checklist,** folded into `go-live-runbook.md` as a new section.

## 5. Verification

- **Each unit:** tsc, lint, the full tests, and `build:verify`. Opus reviews each diff against the
  execution spec.
- **P8-E is the acceptance walk.**
- **Before merge:** with the lock back on and the flag off, India checkout behaves exactly as it did at
  the Phase 7 walk. Re-run the Phase 7 renewal and allowlist steps.

## 6. Gates for switching the US on (not for building)

**Owner, with Razorpay:** International Cards approved on the **live** account.

**The CA, added to the runbook §1.2 list:**
1. Is Kissago's service (online, automated, "OIDAR") an **export of services** for a US consumer, with
   a US billing address and a foreign card? Is the place-of-supply evidence enough?
2. Do we **file an LUT** and supply without IGST, or pay IGST and claim a refund?
3. May the export invoices share the `KG/` series? What must they say?
4. Must an export invoice also show an INR value? At what rate?
5. **US sales tax:** at what volume do state economic-nexus thresholds bite for a foreign digital
   seller? Does any state reach it from the first sale?
6. Confirm the EU/UK position that justifies the US only (U1).

**Owner setup:**
- the LUT ARN in business config;
- USD prices;
- the ROW tax rule published on prod;
- the policy text published.

**Then:** the lock off, and the countries flag on, with `US`.

## 7. The deferred India go-live items (runbook §1.1): no blocker either way

| Item | Needs |
|---|---|
| Unit 0 cycle-end-cancel probe, and subscribe → cancel → reconcile | a test subscription. On an Indian card, the card-save step sends a **real SMS OTP** to the owner. P8-E may show that an international test card avoids it. |
| Phase 6 step 7, the subscription emails | the same session |
| The checkout sheet and logo on a phone | the owner's phone |
| The six CA answers | the CA. Send §6's questions in the same message. |
