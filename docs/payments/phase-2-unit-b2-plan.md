# Phase 2 — Unit B2 plan (wallet billing details, admin tax rules, backfill trigger)

Written 2026-09-18 (Opus). Executes the last outstanding piece of `phase-2-plan.md` §4 Unit B — the half
deliberately held back so it could be built against B1's finished server actions.

**Why it matters more than "some UI":** migration 125 seeds a **published** GST rule, so the moment 125 is
applied, checkout computes tax and refuses anyone without a declared billing state. Nothing in the app can
set that state today. Until B2a ships, 125 cannot be applied anywhere. See `audit-progress.md`.

---

## 1. Verified current-state facts

Checked by reading the code on 2026-09-18, at `f461e03`. Do not re-derive these; do verify anything you
intend to rely on that is *not* listed here.

**Server side is finished and unused.**
- `app/actions/billing-profile.ts` exports `getMyBillingProfile(): Promise<GetBillingProfileResult>` and
  `saveMyBillingProfile(input: BillingProfileInput): Promise<SaveBillingProfileResult>`. Both are
  `'use server'`, both resolve the caller from the session themselves. **Neither has a single caller.**
- `app/actions/billing-backfill.ts` exports `runBillingPaymentsBackfill({ limit?, afterId? })`, admin-guarded
  by `verifyAdmin()`, returning `{ scanned, inserted, skippedAlreadyRecorded, skippedIneligible, hasMore,
  lastOrderId }`. Page through it with `afterId = lastOrderId` while `hasMore`. **No caller.**
- `lib/billing/india-states.shared.ts` exports `INDIA_GST_STATE_CODES` (readonly `{ code, name }[]`),
  `isValidIndiaStateCode`, `indiaStateName`, `GSTIN_REGEX`, `isValidGstin`. Pure and isomorphic — the client
  form imports these directly.
- `lib/billing/billing-profile.ts` (server-only) exports `validateBillingProfileInput(input): string | null`
  — returns the error message, or null when valid. The dialog should mirror its rules for inline feedback,
  but the action's answer is the authority.
- Types already exist in `lib/types/pricing.ts`: `BillingProfileInput`, `BillingProfileDTO`,
  `GetBillingProfileResult`, `SaveBillingProfileResult`. `status: 'unavailable'` means migration 125 is
  absent — the UI must treat that as "billing details cannot be edited yet", not as an error.

**Tax rules.**
- `lib/billing/tax-rules.ts` exports `getPublishedTaxRule(marketKey, appliesTo: 'subscription' | 'topup')`
  → `{ status: 'ok', rule }` | `{ status: 'unavailable' }` (125 absent) | `{ status: 'not_found' }`.
  It caches positive results for 60s and latches permanently once the table is known missing.
  **Publishing a rule takes effect on the next lookup; un-publishing can take up to 60s.**
- `billing_tax_rules` columns (125): `id`, `market_key` (default `'IN'`), `applies_to` in
  `('all','subscription','topup')`, `tax_regime` in `('in_gst','none')`, `rate_percent numeric(5,2)` 0–100,
  `sac_code`, `supplier_state_code` (NOT NULL), `status` in `('draft','published','archived')` default
  `'draft'`, `effective_from` default now(), `effective_to`, `notes`, timestamps.
- **A partial unique index enforces one live rule per market+kind:**
  `uq_billing_tax_rules_live ON (market_key, applies_to) WHERE status = 'published' AND effective_to IS NULL`.
  Publishing a second rule for the same `(market_key, applies_to)` raises **23505** unless the incumbent is
  archived (or given an `effective_to`) **first**. The publish action must do that in the right order.
- `getPublishedTaxRule` prefers an exact `applies_to` match over the `'all'` fallback row
  (`tax-rules.ts:76,93`), so a `subscription` rule and an `all` rule can coexist.
- 125 seeds `('IN','all','in_gst',18.00,'998439','24','published')`.

**Wallet.**
- `components/pricing/WalletPage.tsx` (1061 lines, `'use client'`). Loads through
  `getPricingWalletPageData({ pricingMarketKey, currentPlanKey })` in `loadWalletData`, re-run on the
  `PRICING_RUNTIME_REFRESH_EVENT` window event.
- Two checkout entry points, both of which call `requestPreparedRazorpayCheckout(...)` then
  `openRazorpayCheckout(checkout)`: `handlePlanCheckout` (~line 377) and `handleTopupCheckout` (~line 428).
- `formatPrice(currencyCode, amountMinor)` at line 33 is the existing money formatter. Reuse it.
- Prices render at line ~770 (plan offers) and ~830 (top-up packs).
- `app/actions/pricing-runtime.ts:206` `getPricingWalletPageData` returns `PricingWalletPageData`
  (`lib/types/pricing.ts:521`).

**Admin.**
- `app/admin/pricing/<section>/page.tsx` files are 5-liners: `<PricingStudio section="..." />`.
- `components/admin/PricingStudio.tsx` (2103 lines) switches on `section` (`PricingStudioSection` union at
  line 145); each section is `{section === 'x' && ( ... )}`. `INPUT_CLASS` (line 154) is the shared input
  style. `WORKSHOP_CARD_GROUPS` (line 158) builds the hub cards.
- `lib/admin/nav.ts:266` `PRICING_CHILD_GROUP.items` is the nav registry; `PRICING_NAV_ITEMS` is derived.
- **`lib/admin/nav.test.ts` will fail unless it is updated with the new entry:** `EXPECTED_PRICING_HREFS`
  (line 32) is an exact-equality list, every item needs a `description` and a **unique** `icon` (there are
  tests for both), and hrefs must be unique.
- The draft→publish convention is `publishPricingTopupPack` (`app/actions/pricing-admin.ts:571`): verify
  admin, load the draft, refuse if it is not a draft, **archive the incumbent published row first** (writing
  a `pricing_publish_audit` row for it), then publish the draft and write a second audit row.
  `insertPricingAudit` takes `{ entityType, entityId, actionType, performedBy, beforeJson, afterJson, reason }`.

**Conventions that have bitten this repo before** (CLAUDE.md, GOTCHAS):
- Never export a non-function value — types included — from a `'use server'` file.
- Never import a plain value from a `'use client'` module into server code.
- All dropdowns use `@/components/ui/FilterDropdown` (`value`, `options: {value,label,hint?}[]`, `onChange`).
  Never a native `<select>`.
- `*.shared.ts` is pure and isomorphic; unit tests target the `.shared.ts` half.
- Code must **fail closed** when a migration is absent, and behave exactly as today until 125 is applied.

---

## 2. Execution order

**B2a and B2b both touch `lib/types/pricing.ts`, so they run sequentially, not side by side** (working
agreement: sequential when files overlap). B2a first — it is the legal requirement and the blocker on 125.

---

## 3. Unit B2a — wallet billing details and GST-inclusive pricing

### Files

| File | Change |
|---|---|
| `lib/billing/wallet-tax.shared.ts` | **new**, pure. The price-line maths and labels. |
| `lib/billing/wallet-tax.shared.test.ts` | **new**. Tests for the above. |
| `lib/types/pricing.ts` | extend `PricingWalletPageData`; add `WalletTaxPreview`. |
| `app/actions/pricing-runtime.ts` | `getPricingWalletPageData` also returns the profile and tax preview. |
| `components/pricing/BillingDetailsDialog.tsx` | **new**, `'use client'`. The form. |
| `components/pricing/WalletPage.tsx` | gate both checkouts; render "+ GST" lines; open the dialog. |

### `lib/billing/wallet-tax.shared.ts`

Pure, no imports from server modules. Export:

```ts
export interface WalletTaxPreview {
  /** null when no tax applies (no rule, or a zero-rate/'none' regime): show bare prices. */
  ratePercent: number | null;
  /** 'GST' today; carried so the label is not hardcoded at three call sites. */
  taxLabel: string;
  /** True when migration 125 is applied and a rule is published, i.e. checkout WILL demand a state. */
  requiresBillingState: boolean;
}

/** net + tax, rounded half-up to the paisa, matching lib/billing/tax.shared.ts's computeTax exactly.
 *  Display must never disagree with what is charged. */
export function previewGrossMinor(netMinor: number, ratePercent: number | null): number;

/** "₹1,450 + 18% GST" / "₹1,450" when no tax applies. */
export function formatPriceWithTaxLine(...): string;
```

`previewGrossMinor` must reproduce `roundHalfUpTax` from `lib/billing/tax.shared.ts:106`
(`Math.floor((netMinor * ratePercent * 100 + 5000) / 10000)`) rather than inventing its own rounding — a
display that disagrees with the charge by a paisa is a support ticket. **Test that both agree** by importing
`computeTax` in the test and comparing across a spread of amounts and rates including 18%.

### `lib/types/pricing.ts`

Add to `PricingWalletPageData` (line 521):

```ts
  billingProfile: BillingProfileDTO | null;
  /** null when migration 125 is absent -- the wallet then behaves exactly as it does today. */
  taxPreview: WalletTaxPreview | null;
```

Re-export `WalletTaxPreview` from `lib/billing/wallet-tax.shared.ts` or declare it here; do not duplicate it.

### `app/actions/pricing-runtime.ts`

In `getPricingWalletPageData`, alongside the existing `Promise.all`, and **only when there is a `userId`**:
- `getPublishedTaxRule(input.pricingMarketKey, 'topup')` — the wallet's headline is top-ups; if a market ever
  carries different rates per kind, the subscription cards can ask separately later.
- `loadBillingProfile(supabase, userId)`.

Map to `taxPreview`:
- rule `'unavailable'` → `taxPreview: null` (125 absent: the wallet renders exactly as today).
- rule `'not_found'` → `{ ratePercent: null, taxLabel: 'GST', requiresBillingState: false }`. Checkout will
  refuse, but that is the existing "tax rules are being configured" message; do not invent a second one.
- rule `'ok'` → `{ ratePercent: rule.taxRegime === 'in_gst' ? rule.ratePercent : null, taxLabel: 'GST',
  requiresBillingState: true }`.

`billingProfile` is the DTO or null; a profile lookup of `'unavailable'` is also null.
**Neither lookup may throw out of the wallet load** — wrap and fall back to `null`, logging server-side. The
wallet failing to open is worse than a missing tax line.

### `components/pricing/BillingDetailsDialog.tsx`

A modal, in the wallet's existing visual language (`bg-neutral-950`, `border-white/10`, glassmorphism, emerald
accents, `motion` for the transition — copy the idiom from an existing wallet modal rather than inventing one).

- Fields: **Legal name** (required), **State** (required, `FilterDropdown` over `INDIA_GST_STATE_CODES`,
  `{ value: code, label: name }`), Company name (optional), **GSTIN** (optional, validated with
  `isValidGstin` on blur; a wrong one blocks save, an empty one does not), Billing email, Phone, Address 1,
  Address 2, City, Postal code (all optional).
- Prefill from the existing profile when there is one.
- Submit calls `saveMyBillingProfile`. `status: 'invalid'` → show `message` inline. `status: 'unavailable'` →
  "Billing details aren't available yet" and disable the form (125 absent).
- Explain *why* in one line: the state is the GST place of supply and is required before payment.
- On success, call an `onSaved(profile)` prop; the wallet re-runs `loadWalletData` and continues.

### `components/pricing/WalletPage.tsx`

1. **Gate both checkout handlers.** At the top of `handlePlanCheckout` and `handleTopupCheckout`, if
   `walletData?.taxPreview?.requiresBillingState` and there is no `walletData?.billingProfile?.stateCode`,
   open the dialog and **remember the pending action**, so that after a successful save the checkout the user
   asked for continues on its own. Do not make them click twice.
2. **Price lines.** Where prices render (≈770 for plans, ≈830 for packs), when `taxPreview.ratePercent` is
   non-null show the net price as today plus a smaller line beneath: `+ 18% GST · ₹1,711 total`, using
   `previewGrossMinor` and the existing `formatPrice`. When `taxPreview` is null or the rate is null, render
   **exactly what renders today** — no empty element, no layout shift.
3. **An edit entry point.** A "Billing details" row near the wallet's account area showing the saved legal
   name and state, or "Add billing details" when there is none. Opens the same dialog.
4. Do not touch `openRazorpayCheckout`, the Razorpay script loading, or the COOP/COEP wallet exemption.

### Tests (B2a)

`lib/billing/wallet-tax.shared.test.ts`: the display gross equals `computeTax`'s gross across amounts and
rates; a null rate returns the net unchanged; the zero-rate and `'none'` regimes show no tax line; the label
formatter for both branches.

Component behaviour is covered by the verification walk below, not by a rendering test — this repo does not
render-test wallet components.

---

## 4. Unit B2b — admin tax rules and the backfill trigger

Starts only after B2a is committed.

### Files

| File | Change |
|---|---|
| `lib/billing/tax-rules-admin.ts` | **new**, `server-only`. List/save-draft/publish/archive against `billing_tax_rules`. |
| `lib/billing/tax-rules-admin.test.ts` | **new**. |
| `app/actions/pricing-tax-rules.ts` | **new**, `'use server'`. Admin-guarded wrappers. Functions only. |
| `lib/types/pricing.ts` | the admin DTO and result types. |
| `lib/admin/nav.ts` | a `tax-rules` entry in `PRICING_CHILD_GROUP.items`. |
| `lib/admin/nav.test.ts` | add the href to `EXPECTED_PRICING_HREFS`. |
| `app/admin/pricing/tax-rules/page.tsx` | **new**, the 5-line `<PricingStudio section="tax-rules" />`. |
| `components/admin/PricingStudio.tsx` | the `tax-rules` section, plus the hub card and the union member. |

### Behaviour

- **List** every rule for a market, grouped by `applies_to`, showing status, rate, SAC, supplier state,
  effective dates and notes. Published rows are read-only; drafts are editable.
- **Save draft** — create or update a `status: 'draft'` row. Validate: rate 0–100, `applies_to` and
  `tax_regime` within their CHECK sets, `supplier_state_code` a real GST state code
  (`isValidIndiaStateCode`), SAC optional.
- **Publish** — follow `publishPricingTopupPack` exactly: refuse a non-draft; **archive the incumbent
  published row for the same `(market_key, applies_to)` first**, or the partial unique index raises 23505;
  audit both writes through `insertPricingAudit` with a new `entityType: 'tax_rule'`.
  **Confirm `pricing_publish_audit.entity_type` has no CHECK constraint restricting its values before using a
  new one** — if it does, the value must be added by a migration and that is a decision to raise, not to make.
- **Archive** a published rule. Warn in the UI: with no published rule, checkout **refuses** rather than
  charging the net. That is `getPublishedTaxRule`'s `not_found`, and it is deliberate.
- Note in the panel that a change can take up to 60 seconds to reach checkout (the rule cache).
- **Backfill trigger** — a clearly-labelled operations button calling `runBillingPaymentsBackfill`, looping on
  `hasMore` with `afterId`, reporting the running totals. Say plainly that it is safe to re-run.

### Fail-closed

Every read must survive migration 125 being absent: a missing-table error (`42P01`, `PGRST205`) renders
"Tax rules need migration 125" instead of throwing. Mirror the latch in `lib/billing/tax-rules.ts`.

### Tests (B2b)

`lib/billing/tax-rules-admin.test.ts` with a mocked Supabase, in the style of
`lib/billing/razorpay-sync.test.ts`: publishing archives the incumbent first and in that order; publishing a
non-draft is refused; a 23505 on publish surfaces as a clear message, not a raw Postgres error; validation
rejects an out-of-range rate and an unknown state code; a missing table reports unavailable rather than
throwing. Update `lib/admin/nav.test.ts` for the new destination.

---

## 5. Verification

Gates, run by the executing agent before it commits, and **re-run by the reviewer** (agent gate reports have
been wrong before — `audit-progress.md`):

```
npx tsc --noEmit
npm run lint
npm test
```

On dev, after 125/126/127 are applied (owner, later — **not** part of this unit):
1. A user with no billing profile clicks Buy: the dialog appears, saving continues into checkout unprompted.
2. The Razorpay amount equals the "total" line the wallet showed.
3. Admin edits the rate to 5%, publishes: within 60s the wallet lines and the charged amount both move.
4. Archiving the last published rule makes checkout refuse — it does not silently charge the net.
5. The backfill run reports inserted counts and re-running inserts nothing further.

## 6. Out of scope

Rendering or sending tax documents (Phase 6), invoice numbering, Stripe, the full billing surface (Phase 5),
and any change to `lib/billing/tax.shared.ts`, `ledger.ts`, `razorpay-*.ts` or migrations 125/126/127 — those
are reviewed and frozen. If B2 appears to need a change there, stop and raise it.
