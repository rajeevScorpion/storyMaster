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

- **G1 — corrected 2026-09-25 by unit AC's review. It was not a live defect.**
  `loadPlanVersionForCheckout` and `loadTopupPackForCheckout` already filter `.eq('provider',
  'razorpay')`, so a `stripe` item failed as "not found" and never reached Razorpay. AC's explicit
  guard is a second layer with a clearer code. The original text follows.
- `prepareRazorpayCheckoutInternal` never reads the item's `provider`. The top-up insert writes
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

## 8. Execution spec, batch 1 — anchored at the commit that adds this section (2026-09-25)

**Already done (Opus):**
- **Migration 138** (`138_international_checkout_us.sql` + rollback): the `in_export_lut` regime, a
  draft ROW rule, `billing_profiles.region`, and flag `billing_international_countries` (off, value
  `US`).
- **`lib/billing/international.shared.ts`:**
  - `SUPPORTED_BILLING_COUNTRIES` (IN, US), `isSupportedBillingCountry`, `isForeignBillingCountry`,
    `billingCountryName`, `parseInternationalCountries`;
  - `FOREIGN_PLACE_OF_SUPPLY_CODE = '96'`, `INDIA_COUNTRY_CODE`.
- **`lib/billing/international.ts`** (`server-only`): `getInternationalCheckoutCountries()` returns `[]`
  unless the flag is on. Tests for both.

**Plan change:** units A and C merge into **AC**, because the country gate and the tax choice both
live in `resolveCheckoutTax`. **AC ∥ B**, with disjoint files. D follows.

**Both agents:**
- Commit as you go, `git add` your own files by name only (never `-A`).
- The other agent is editing the same working tree. A tsc error in a file you don't own is theirs:
  note it, don't fix it.
- Before the final commit, run the full gate: tsc, lint, the full test suite, and `npm run
  build:verify`.
- Commit prefix: `feat(payments): Phase 8 AC --` / `Phase 8 B --`.

### AC — checkout guard and export tax (Sonnet)

**Files:**
- `app/actions/pricing-checkout.ts`
- `app/actions/billing-account.ts` (the quote only)
- `lib/billing/checkout-guard.shared.ts`
- `lib/billing/tax.shared.ts`, `lib/billing/tax-rules.ts`, `lib/billing/tax-rules-admin.ts`
- `lib/billing/razorpay-sync.ts` (the tax fallback and capture evidence only)
- `lib/billing/billing-incidents.shared.ts`, `app/actions/billing-incidents.ts`, the billing-incidents
  admin page
- their tests

1. **Tax types** (`tax.shared.ts`):
   - `taxRegime` gains `'in_export_lut'` on `TaxRuleInput` and `TaxBreakdown`.
   - `GstSupplyType` gains `'export'`.
   - In `computeTax` and `computeTaxFromGross`, `in_export_lut` gives tax 0, supply type `'export'`,
     and all components 0.
   - `in_gst` behaviour is unchanged. `'none'` stays `'none'`.
   - Also update the `DbBillingTaxRule` type and anything that maps it or switches on the regime.
2. **Pure guards** (`checkout-guard.shared.ts`):
   - `CheckoutRefusalCode` gains `'provider_unavailable'`, `'country_not_supported'` and
     `'market_country_mismatch'`.
   - `assertCheckoutProvider(provider: string | null)`: anything but `'razorpay'` refuses, with "This
     item can't be bought here yet."
   - `assertMarketMatchesCountry({ itemMarketKey, profileCountryCode, internationalCountries })`:
     - an `IN` item needs profile country `IN`. Otherwise: "This price is for customers in India.
       Please choose the price for your country." (`market_country_mismatch`)
     - a non-IN item needs a profile country in `internationalCountries`. Otherwise: "Payments from
       your country aren't open yet." (`country_not_supported`)
     - A null profile country counts as `IN`: every profile saved before 138 is Indian.
   - Tests for each pass and each refusal.
3. **`resolveCheckoutTax`** (`pricing-checkout.ts:~96`) gains an `itemMarketKey` input:
   - Load the profile **before** the rule. The rule market is `'IN'` when the profile country is IN
     (or null), else `'ROW'`.
   - Call `assertMarketMatchesCountry` with `getInternationalCheckoutCountries()` before any tax maths.
   - **Schema-unavailable path:** for a non-IN item, refuse with `billing_schema_unavailable` instead of
     charging the net.
   - A ROW rule `not_found` (the seeded rule is a draft) gives the existing `tax_rules_unavailable`
     refusal, unchanged.
   - `placeOfSupplyStateCode` for a foreign profile is its stored `'96'`.
   - Pass `itemMarketKey` from both prepare paths and both quote paths (`billing-account.ts:184`,
     `:214`).
4. **Provider guard:**
   - After each `assertBetaMarketAllowed` (`pricing-checkout.ts:211`, `:405`), call
     `assertCheckoutProvider(version.provider)` / `(topup.provider)`, and the same in `quoteCheckout`'s
     two paths.
   - The top-up insert's `provider: 'razorpay'` (`:438`) becomes `topup.provider`.
   - **The annual refusal stays** for every Razorpay item: US launches on monthly plans and top-ups.
5. **The renewal fallback** (`razorpay-sync.ts:~422`): when there's no checkout snapshot, pick the rule
   market from the profile country, as in step 3. No gate here: the charge has already happened.
6. **Capture evidence:**
   - Where a payment is recorded from a Razorpay payment entity (`settleTopupOrder` and the
     subscription payment path in `razorpay-sync.ts`), store the entity's `international` (boolean)
     and `card.country` if present, as `cardInternational` and `cardCountry`.
   - Read `ledger.ts`'s write-once rules first, and choose the place that is actually written at
     capture: the purchase snapshot, or the payment's raw payload. Say which in the commit body.
7. **Billing-incidents card:** "Export sales on a domestic card".
   - It lists payments whose `tax_breakdown_json->>'supplyType' = 'export'` and whose captured
     evidence says `cardInternational` is false.
   - It follows the four Phase 7 cards' pattern: a pure mapper in `billing-incidents.shared.ts`, and
     fail-closed to "unavailable".
8. **Tests:**
   - the regime maths;
   - the rule market chosen by country, never by the chosen market;
   - an India profile buying a ROW item is refused;
   - a US profile with the flag off is refused;
   - a `stripe` item is refused and Razorpay is never called;
   - the renewal fallback picks ROW for a US profile;
   - the card's mapper.

### B — international billing details (Sonnet)

**Files:**
- `lib/billing/billing-profile.shared.ts`, `lib/billing/billing-profile.ts`
- `components/pricing/billing-details-form.shared.ts`, `components/pricing/BillingDetailsDialog.tsx`
- `app/actions/billing-profile.ts`
- `components/billing/BillingAccountPage.tsx` (the profile display only)
- `lib/types/pricing.ts` (`BillingProfileInput` / `DTO` only), `lib/types/database.ts`
  (`DbBillingProfile` only)
- a new `lib/billing/us-states.shared.ts`
- their tests

1. **Types:**
   - `BillingProfileInput` gains `countryCode?: string` (absent means `'IN'`, for old clients) and
     `region?: string | null`.
   - `BillingProfileDTO` gains `region`.
   - `DbBillingProfile` gains `region: string | null`.
2. **`us-states.shared.ts`:** the 50 states plus DC, as `{ code: 'CA', name: 'California' }`.
3. **Validation** (`validateBillingProfile`), branching on the resolved country:
   - **IN, or absent:** exactly today's rules.
   - **US:**
     - Personal only: a GSTIN or company name gives "Business billing is available for Indian GST
       registrations only."
     - `region` must be a code from `us-states.shared.ts`.
     - The postal code matches `^\d{5}(-\d{4})?$`.
     - The phone goes through `normalizeUsPhone`: 10 digits, or 11 starting with 1, or `+1…`, gives
       `+1XXXXXXXXXX`, and the area code can't start with 0 or 1.
     - The name, email and city rules are as India's.
     - `stateCode` is ignored.
   - **Any other country:** "We can't bill addresses in that country yet."
   - Add `normalizeBillingPhone(raw, countryCode)`. Keep `normalizeIndianPhone` exported and unchanged.
4. **Save** (`saveBillingProfile`):
   - `country_code` comes from the input.
   - For a foreign profile, `state_code = FOREIGN_PLACE_OF_SUPPLY_CODE` and `region` = the US state
     code.
   - For IN, `region = null`.
   - The phone uses `normalizeBillingPhone`.
   - Write `region` only when the column exists. Follow the file's existing missing-schema latch
     pattern, so a pre-138 database still saves Indian profiles.
   - `toBillingProfileDTO` maps `region`.
   - `buildCustomerSnapshot` adds `region` and `countryName` (`billingCountryName`). For a foreign
     profile, `stateName` is the US state's name.
5. **Which countries the dialog offers:**
   - Add a server action `getBillingCountryOptions()` in `app/actions/billing-profile.ts`. It returns
     `['IN', ...getInternationalCheckoutCountries()]`.
   - **The dialog shows the country `FilterDropdown` only when that list has more than one entry, or
     the saved profile is already foreign.** With the flag off (the state at the India launch), the
     dialog looks exactly as it does today.
6. **The form** (`billing-details-form.shared.ts` + dialog):
   - `countryCode` and `region` go in the form state.
   - **US:** hide the Personal/Business toggle, GSTIN and company fields. Show a US-state
     `FilterDropdown` in place of the India one. Label the postal code "ZIP code" and the phone "Mobile
     number (US)".
   - Switching country clears the state or region and re-validates.
   - All logic lives in the `.shared.ts` file, with tests (the repo has no DOM test environment).
7. **The profile display** (`BillingAccountPage.tsx`): show "City, CA 94103, United States" for a US
   profile. India's display is unchanged.
8. **Tests:**
   - US validation: each field;
   - the phone normaliser;
   - an IN input without `countryCode` still validates exactly as before, checked against the existing
     tests;
   - the save row for US (`state_code` 96, `region`) and for IN (`region` null);
   - the form's country switching.

## 9. Execution spec, batch 2 (unit D) — anchored after AC (`f466522`) and B (`02bb926`)

**Accepted from batch 1:**
- AC and B were reviewed and accepted.
- Combined gates: tsc clean, **2,601 tests / 198 files**.
- Review notes, not changed:
  - India's validation now reports a missing city before a missing phone. Only the first message
    differs.
  - The server accepts a US profile while the flag is off. The customer can only lock themselves out
    of IN prices.

**U3 default:** export invoices share the `KG/` series until the CA says otherwise.

**The LUT ARN** is a constant, `LEGAL_LUT_ARN = ''`, in `lib/legal/business-config.ts`.
- The invoice prints "LUT ARN: <value>" only when it is set.
- Setting it is on the US switch-on checklist. Issuing never refuses over it.

### D — documents, emails and copy (Sonnet)

**Files:**
- `lib/billing/documents/document-view.shared.ts` (+ test)
- `lib/billing/documents/render-pdf.ts`
- `lib/legal/business-config.ts`
- `lib/billing/email/templates.shared.ts` and its callers in `lib/billing/notifications/`
- `lib/billing/checkout-quote.shared.ts`
- `components/pricing/checkout/CheckoutSummarySheet.tsx`
- `components/pricing/WalletPage.tsx`
- `components/pricing/PlansComparison.tsx`
- `components/billing/BillingAccountPage.tsx` (the `+ GST` label only)
- `components/admin/PricingStudio.tsx` (`defaultProviderForMarket` only)
- tests

1. **Documents** (`document-view.shared.ts`), when `tax_breakdown_json.supplyType === 'export'` (or
   `taxRegime === 'in_export_lut'`):
   - **Place of supply:** "Other Countries (96)". It is never looked up as an Indian state.
   - **The endorsement:** a view field `exportEndorsement`, "Supply meant for export under LUT without
     payment of IGST". Add "LUT ARN: …" when `LEGAL_LUT_ARN` is set. `render-pdf.ts` prints it under the
     totals, above the amount in words, with `wrapLine`. Credit notes carry it too.
   - **The buyer block:**
     - its city line uses the snapshot's `region`, where India uses the state name: "Austin, TX,
       78701";
     - add a country line (`countryName`) for any non-IN customer.
   - **The amount in words:**
     - `amountInWordsUsd`: "US Dollars Twenty-Nine and Fifty Cents Only", in Western grouping
       (thousand, million);
     - choose by `currency_code`. INR keeps `amountInWordsIndian`, unchanged.
   - **The tax rows:** for an export, a single row "IGST @ 0%" at 0.00, so the zero-rating is explicit
     on the face of the invoice.
   - India documents must render **byte-identical** to before. Add a test: render a current IN row
     before and after, and compare.
2. **Emails** (`templates.shared.ts`):
   - `formatInr` becomes `formatMoney(amountMinor, currencyCode)`: en-IN for INR, en-US otherwise,
     always two decimals.
   - Update its callers to pass the payment or document's `currency_code`.
   - Keep a `formatInr` wrapper only if a caller can't reach a currency, and say which.
3. **The checkout quote and sheet:**
   - `taxLinesFromBreakdown` returns `[]` for `'export'`.
   - The sheet shows no tax line or "+ IGST" text for an export quote, just the total, plus the muted
     line "No GST: export of services."
   - The renewal line already formats by currency. Check it reads "at $29.00".
4. **The wallet and the plans table:**
   - "+ GST" only when the currency is INR: `PlansComparison.tsx:162` and the monthly label wherever it
     is built, and `BillingAccountPage.tsx:319`.
   - `yearlyCheckoutDeferred` (`WalletPage.tsx:266`) becomes `usingRazorpayMarket`, whatever the
     market: the server refuses annual for every Razorpay item.
   - The "Stripe comes next" copy (`:895`) becomes "Coming soon in your country".
5. **Admin catalog:** `defaultProviderForMarket` (`PricingStudio.tsx:604`) returns `'razorpay'` for
   every market. Existing rows are not touched. The walk re-tags them by hand.
6. **The `'INR'` literals:** the other seven are locale or default choices and are correct. Leave
   them.
7. **Tests:**
   - the view for an export row (place of supply, the endorsement with and without an ARN, the buyer
     country, USD words);
   - `amountInWordsUsd` edge cases (0, 1 cent, 1,000, 1,000,000);
   - `formatMoney`;
   - `taxLinesFromBreakdown` for an export;
   - the IN-unchanged render test.

**Rules:** as batch 1 (commit your files by name, the full gate before the final commit, no push, no
Supabase CLI). Prefix: `feat(payments): Phase 8 D --`.
