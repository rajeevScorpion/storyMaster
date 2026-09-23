# Phase 5 — user billing, checkout UX and self-serve management

**Status (2026-09-23): PLANNED, not started. All seven owner decisions answered (§3), all as recommended.**
Nothing is blocked. The only open item is the P6 checkbox wording, which the owner approves at E2 review.
Source of scope: `prompt-packs/kissago-payment-billing-prompt-pack-2026-09-17/07_PHASE_5_USER_BILLING_CHECKOUT_UX.md`.
**Binding input:** `phase-5-owner-requirements.md` (the owner's notes from the money walk). Where the two differ,
the owner's notes win.
Living handoff: `audit-progress.md`. Written by Opus after the money walk passed steps 1-7.

| Unit | What | Depends on | Risk |
|---|---|---|---|
| **0** | Razorpay sandbox probe: what a cycle-end cancel looks like, and whether it can be undone | — | none (no code) |
| **A** | Ledger correctness: write-once payment fields, subscription payment method, customer snapshot | — | **high** (money records) |
| **B** | `billing-profile.shared.ts`: one validation authority for client and server | — | low |
| **C** | `FilterDropdown`: keyboard support for all, `searchable` opt-in | — | low (28 callers) |
| **M** | Migration 134: record who asked for a cancellation, and when | — | low |
| **D** | Billing-details dialog redesign: Personal/Business, sections, inline validation | B, C, **P1, P7** | low |
| **E1** | Checkout plumbing: timing, Razorpay options, failure handling, kids gate, attestation | **P6** | medium |
| **E2** | Checkout UI: pre-payment summary, branded opening and confirming states | E1 | low |
| **F** | Settings → Billing at `/account/billing`, with self-serve cancel | A, M, D, E1, **P3, P5** | medium |
| **G** | Plan comparison page | E2, **P2, P4** | low |

---

## 0. Scope boundary

| Belongs to | What |
|---|---|
| **Phase 5 (here)** | Everything the customer sees and does: billing details, checkout, payment states, plan comparison, the billing area, self-serve cancel. Plus the ledger fixes those screens depend on. |
| **Phase 6** | The document engine: invoices, receipts, credit notes, PDFs, billing email. Phase 5's "invoices" section **lists `billing_documents` rows honestly** (there are none) and links nothing it can't produce. |
| **Deferred (owner, 2026-09-14)** | Notifications. Nothing in Phase 5 sends email or push. Razorpay's `customer_notify` stays as it is. |

Do not start plan-change mechanics beyond what P2 approves. The prompt pack is explicit: offer the owner
options rather than ship hidden rules that differ by payment rail.

---

## 1. Verified current-state facts

Read from the code and the dev database on 2026-09-23 at `c95f06a`. Line numbers are on that commit.

### Dev data
- `billing_profiles`: **1 row, missing phone, city, PIN or email**, and no GSTIN. Any tightened required set
  has to cope with profiles saved under the old rules (P7).
- `billing_payments`: 3 rows. 2 top-ups record `card`; the 1 `subscription_first` records **`unknown`**.
  **0 rows have `customer_snapshot_json`.**
- Published IN catalogue: Audience ₹200/mo (0 beats), Plus ₹850/mo (12 beats), Studio ₹3,950/mo (90 beats).
  **No IN annual version is published**. Plus and Studio annual are drafts at ₹0, and checkout refuses annual
  outright (`app/actions/pricing-checkout.ts` guard at 167-169).
- Flags: `pricing_checkout_enabled`, `billing_reconcile_enabled`, `billing_admin_actions_enabled` and
  **`billing_document_issuing_enabled` are all ON on dev.** The last does nothing today, since
  `issueDocumentIfEnabled` has no caller. Phase 6 would start issuing the moment it gets one. See §8.
- Highest migration: **133** (ledger and files agree). Next is **134**.

### Billing details
- `components/pricing/BillingDetailsDialog.tsx` (334 lines) is a hand-rolled portal and motion dialog. It does
  **not** use the shared `components/ui/Modal.tsx`, so it has no focus trap or focus return.
  `STATE_OPTIONS` at 26-29 prepends a `''` placeholder, because `FilterDropdown` otherwise shows the first
  option's label when the value is empty. State is a `FilterDropdown` at 196-204. `canSubmit` is at 84 and
  submit at 86-124, calling `saveMyBillingProfile`.
- Its only caller is `components/pricing/WalletPage.tsx:479-487`. It opens from the wallet row
  (`WalletPage.tsx:625-643`, shown when `walletData.taxPreview` is non-null, meaning tax is deployed) and
  automatically before checkout when `requiresBillingDetails` is true (`WalletPage.tsx:343-344`: published
  rule **and** no `stateCode`). The queued checkout resumes on save.
- Server: `app/actions/billing-profile.ts`, `getMyBillingProfile` 29-39 and `saveMyBillingProfile` 41-51 →
  `lib/billing/billing-profile.ts`. `validateBillingProfileInput` is at 82-93: legal name required, a valid
  state, and a GSTIN that passes the **regex only**. `saveBillingProfile` is at 101-142 and is an upsert on
  `user_id`.
- `lib/billing/india-states.shared.ts`: `INDIA_GST_STATE_CODES` is at 20-58 (codes 25 and 28 retired and
  deliberately absent). `GSTIN_REGEX` is at 73 and mirrors the DB CHECK in migration 125.
  **No checksum, and no state-from-GSTIN, anywhere in the repo.**
- `billing_profiles` columns (migration 125): `legal_name, billing_email, phone, company_name, gstin,
  state_code NOT NULL, country_code, address_line_1, address_line_2, city, postal_code`. There is no
  personal/business column.
- `lib/types/pricing.ts`: `BillingProfileInput` starts at 696, and `PreparedRazorpayCheckout` is at 667-690.

### The look to match
- `components/ui/Modal.tsx`: backdrop `bg-black/70 backdrop-blur-md` (59). The panel's motion variants follow
  reduced motion (69-72). Surface: `rounded-[28px] border border-white/10 bg-neutral-950/95 shadow-2xl` (73).
  Focus trap, focus return, Escape and scroll lock come from `components/ui/useDialogBehavior.ts` (84 lines).
- `components/auth/AuthDialog.tsx` uses `Modal` with `showCloseButton={false}` and adds its glow at 189-204:
  two blurred blobs (emerald and indigo), a top sheen, and a looping radial `motion.div` skipped under
  `prefersReducedMotion`.

### FilterDropdown
- `components/ui/FilterDropdown.tsx` (305 lines). Props are at 39-57 (`value, options, onChange, fullWidth,
  size, mode, ariaLabel, contextLabel`). Placement is at 82-116 and the portal at 196. It closes only on
  option click or an outside `mousedown` (70-78). **There are zero `onKeyDown` handlers**: no arrows, no
  Escape, no typeahead, and focus never moves into the menu. **28 files** use it.

### Checkout
- Client, all in `WalletPage.tsx` (1,104 lines): the script loads at 457-464 (`next/script`,
  `afterInteractive`, only when checkout is on and the market is Razorpay). `requestPreparedRazorpayCheckout`
  (191-231) POSTs `/api/billing/razorpay/prepare`. `runPlanCheckout` and `runTopupCheckout` are at 346-436.
  `openRazorpayCheckout` is at 1007-1102, with options at 1029-1087: `key, name, description,
  prefill.{name,email}, theme.color #10b981, modal.ondismiss, handler`, plus `subscription_id` or
  `order_id/amount/currency`. **No `image`, no `theme.backdrop_color`, no `prefill.contact`, no
  `modal.confirm_close`.**
- Between click and modal, the user sees only the button label change. After a successful verify, a green
  banner shows the server's message (689-693). A dismiss is swallowed silently (387-390, 430).
- **Defect: `payment.failed` settles the promise** (1090-1098). Razorpay keeps its window open after a failed
  attempt so the customer can retry. If the retry succeeds, `settleResolve` is a no-op: the page shows
  **failure for a payment that went through**. The handler's verify call still runs, so the grant lands
  anyway. **Defect: the failure text is Razorpay's raw `error.description`**, which the pack forbids.
- Server: `app/actions/pricing-checkout.ts`, `prepareRazorpayCheckoutInternal` 147-391. For a subscription:
  flag → auth → load version and plan → `resolveCheckoutTax` (67-122; profile read at 92, "add your billing
  details" at 101-103) → snapshot (179-191) → RPC `billing_begin_subscription_checkout` (193-198) → a reused
  session returns early (215-230) → cancel superseded sessions (232-241) → `ensureRazorpayPlanRef`
  (501-596; **creates the Razorpay plan lazily** on first subscribe per version and gross) →
  `createRazorpaySubscription` (267-276) → update the order → return (306-315). A top-up: tax →
  `createRazorpayOrder` (333-342) → insert the order (344-377) → return (379-390).
  **There is no timing instrumentation anywhere.**
- `verify/route.ts` messages: subscription 110-113 (113 is the "confirming with your bank" pending case) and
  top-up 153-156. Unexpected errors fall back to `GENERIC_VERIFY_ERROR` (28-29), which is already sanitised.
  **There is no polling after a pending message.**
- The RPC blocks a new subscription checkout while any subscription is `authenticated, active, pending,
  halted` (`supabase/migrations/130_subscription_checkout_provider_mode.sql:52-59`). **So a halted
  subscription, or a cancelled-at-cycle-end one that is still active, blocks resubscribing.**
- **Kids and adult:** nothing. `resolveActiveViewerProfile` (`lib/viewer-profile/index.ts:83-108`,
  server-only) is called only by `app/actions/gallery.ts`. No billing file reads it, and there is no
  attestation field anywhere. Owner decision 6 ("adult attestation and no checkout from kids mode") is
  **unimplemented**.

### Ledger
- `lib/billing/ledger.ts` `recordPayment` 113-204. On insert, every field is written. **On a duplicate, the
  update (165-173) unconditionally rewrites `status, tax_breakdown_json, method_category,
  provider_fee_minor, provider_tax_minor, webhook_event_id`.** It is the same defect class `d42622b` fixed in
  `recordRefund` (236):
  - a re-observe without a method or fee blanks them to `unknown` / null;
  - `tax_breakdown_json` on a **renewal** is re-derived from the **live** profile on every sync
    (`lib/billing/razorpay-sync.ts:378`, inside `resolveSubscriptionPaymentMoney`). So if the customer
    changes state, a reconcile rewrites a past charge's CGST/SGST↔IGST split, while `net_minor`/`tax_minor`
    stay put. That is exactly what the owner's "edits apply to future invoices only" forbids.
- Callers: `settleTopupOrder` (`razorpay-sync.ts:177-199`) passes `rawMethod` and `purchaseSnapshot`, but
  no `customerSnapshot`. The subscription path (`razorpay-sync.ts:558-579`) passes **neither `rawMethod` nor
  either snapshot**. It has `paidInvoice.payment_id` (the invoice fetch is at 521) but never fetches the
  payment.
- `billing_orders.purchase_snapshot_json` exists. There is no customer column on orders, so the customer
  snapshot goes **inside** the purchase snapshot as `customer`.

### Subscription state
- The sync writes `cancel_at_period_end: subscription.status === 'cancelled'` (`razorpay-sync.ts:477`, `:500`).
  Razorpay keeps a cycle-end cancellation **`active` until the cycle ends** (its Cancel API docs, fetched
  2026-09-23). **So the next sync after any cycle-end cancel records "not cancelling"**, and the app cannot
  show "Cancels on <date>". The flag is also set `true` on a subscription that ended **immediately**: dev's
  `sub_TfC9ViXijNEVkZ`, ended by decision 15, reads `cancel_at_period_end = true`.
- `raw_provider_state_json` is redacted to the event name, so dev data cannot show what fields Razorpay
  returns after a cycle-end cancel. Unit 0 finds out.
- The only cycle-end cancel is admin: `app/actions/admin-billing-actions.ts` `cancelBillingSubscriptionAtCycleEnd`
  488-589, which audits first, then calls Razorpay and a best-effort reconcile. `cancelRazorpaySubscription`
  is at `lib/billing/razorpay.ts:186-196`. **There is no self-serve cancel, resume, plan change or
  re-authorise.** `WalletPage.tsx:141-143` labels downgrades "Downgrade support coming soon", and the
  prepare path refuses a second subscription with "Subscription changes will stay manual until account
  management is live" (`pricing-checkout.ts:208`).

### Surfaces
- `components/auth/UserMenu.tsx:232-241`: "Wallet & Billing" → `/wallet`. There is no `/settings`.
  `/account/delete` exists, and `/account/billing` sits naturally beside it.
- **There is no user-facing payment history and no plans page.** No non-admin file reads `billing_payments`
  or `billing_documents`. Plan cards live only inside `/wallet`.
- There are no component tests for the wallet or the dialog. `e2e/` is signed-out only; `smoke.spec.ts:49-76`
  checks `/wallet`'s COOP/COEP headers.

### Razorpay, from its docs (2026-09-23)
- Checkout accepts `image`, `theme.color`, `theme.backdrop_color`, `prefill.{name,email,contact,method}`,
  `readonly`, `modal.{escape,backdropclose,confirm_close,animation}` and `config.display.language`. It
  does not accept fonts, dark mode or layout.
- Cancel: `cancel_at_cycle_end` true means the status stays active until the cycle ends. **The docs name no
  way to undo a scheduled cancellation.** A cancelled subscription is terminal.
- Update (plan change): domestic **card** subscriptions can only change their offer, not their plan
  (`research/06` §1). So a Razorpay-side plan swap would work for UPI/eNACH and not for cards.
- GSTIN check digit (verified against `LEGAL_GSTIN` `24ACLFA8196N1ZN` and `27AAPFU0939F1ZV`; a one-character
  typo is rejected): map `0-9A-Z` to 0-35. For i = 0..13, take `p = value × (i odd ? 2 : 1)` and
  `sum += floor(p/36) + p mod 36`. The check character is `(36 − sum mod 36) mod 36`.

---

## 2. Defects found while planning

Not in the owner's requirements, but found in the code Phase 5 builds on. All are fixed inside the units
below.

| # | Defect | Fixed in |
|---|---|---|
| 1 | `recordPayment`'s update blanks the method and fees, and rewrites a past renewal's tax split from the live profile | A |
| 2 | The sync clears `cancel_at_period_end` on a scheduled cancel, and sets it on an immediate one | A + M |
| 3 | `payment.failed` settles the checkout, so a successful retry in the same window shows as failed | E1 |
| 4 | The raw Razorpay failure text is shown to the customer | E1 |
| 5 | Closing Razorpay's window during a UPI approval resets silently, though the payment may still settle | E1/E2 |
| 6 | Owner decision 6 (adult attestation, no checkout from kids mode) was never built | E1 |
| 7 | The billing dialog has no focus trap or focus return | D |

---

## 3. Owner decisions

**Answered by the owner 2026-09-23, every one as recommended below:**
- **P1:** the proposed field set.
- **P2:** (a), no plan change in Phase 5.
- **P3:** `/account/billing`.
- **P4:** a public `/plans` page.
- **P5:** "Restart your plan".
- **P6:** a kids block plus a checkbox on every purchase. Default wording, for the owner to approve at E2:
  "I'm 18 or older and I'm the one paying for this purchase."
- **P7:** complete the missing fields at the next checkout.

The options as they were put:

**P1 — Confirm the required field set** (`phase-5-owner-requirements.md` §1c), as proposed there.
Recommendation: accept it as written. One addition: for **Business**, "Full name" is the buyer and
**company legal name is the invoice recipient** (B2B invoices are addressed to the GSTIN holder), so
Phase 6 reads `company_name` for business profiles. *Blocks D.*

**P2 — Plan change (Audience → Plus and the reverse), the item decision 7 deferred to Phase 5.**
Today it cannot happen at all. The RPC blocks a second subscription, and Razorpay cannot swap a card
subscription's plan.
- **(a) No plan change in Phase 5. Recommended.** Settings explains: cancel (you keep access to <date>),
  then subscribe to the new plan once it ends. Top-ups give coins immediately in the meantime.
  Decisions 11 and 13 stay intact, and nothing new touches money. Audience is ₹200/month, so the longest
  wait is one cycle.
- (b) "Upgrade now": end the current subscription immediately with **no refund**, forfeiting the rest of
  the cycle, with the forfeit stated before paying, then subscribe to the new plan. It's simple, but it
  contradicts the spirit of decision 13 (the paid period is kept) and invites chargebacks at Plus → Studio
  (up to ₹850 lost).
- (c) Razorpay's Update API: prorated, but UPI/eNACH only. Cards can't. That is the "inconsistent hidden
  rules" the pack forbids. **Not recommended.**
*Shapes F and G.*

**P3 — Where the billing area lives.** Recommendation: **`/account/billing`**, beside `/account/delete`.
Linked from the account menu (a new "Billing" item under "Wallet & Billing") and from `/wallet` (the
billing-details row becomes "Manage billing →"). `/wallet` stays the place to buy. *Blocks F.*

**P4 — The plan comparison.** Recommendation: a **public `/plans` page** that signed-out visitors can
see, since they already browse the catalogue. `/wallet`'s plan cards link to it. The alternative keeps it
inside `/wallet`, visible only when signed in. *Blocks G.*

**P5 — A failed renewal.** `pending` (Razorpay retrying, once a day for 3 days) shows a notice and no action.
`halted` blocks resubscribing (§1). Razorpay offers no self-serve card update while `customer_notify` is off.
Recommendation: a halted subscription gets **"Restart your plan"**. It cancels the halted subscription
immediately (it grants nothing once halted), then opens a fresh checkout. If the customer abandons the
checkout, they are no worse off than halted. *Shapes F.*

**P6 — Adult payer (decision 6, now built).** Recommendation:
- **The server refuses checkout when the active viewer profile is kids** ("Switch to an adult profile to
  buy"). The client shows the same thing up front.
- **One checkbox on the pre-payment summary, required to continue:** "I'm 18 or older and I'm the one
  paying." It sits next to the Terms and Refund Policy links. It is recorded **per purchase** in the order's
  `purchase_snapshot_json` as `adultAttestedAt`, so there is no migration.
- The owner approves the exact wording. *Blocks E1.*

**P7 — Profiles saved under the old rules.** Recommendation: the old rows stay untouched. The next
checkout opens the dialog pre-filled and asks only for the missing fields: the gate becomes "profile
complete for its type", not just "has a state". *Shapes D and E1.*

---

## 4. Migration 134 (Unit M) — BUILT `b8e3131`, applied on dev 2026-09-23, frozen

Complete SQL. The owner applies it by hand, dev first. **Not on prod.**

`supabase/migrations/134_subscription_cancel_request.sql`:

```sql
-- Records who asked for a subscription to end at its period end, and when, so "Cancels on <date>"
-- survives a re-sync. Razorpay keeps a cycle-end cancellation `active` until the cycle ends; the sync
-- derived cancel_at_period_end from status alone, so it cleared a scheduled cancel on the next webhook.
-- cancel_at_period_end now means "still running, will not renew": terminal rows are reset to false.
-- Trap: the sync must never set these columns -- only a cancel action does. The sync may only clear
-- cancel_at_period_end once the subscription is terminal.
-- Verify: cancel a test subscription at cycle end, run reconcile, and the row still reads
-- cancel_at_period_end = true with cancel_requested_at set.

ALTER TABLE public.billing_subscriptions
  ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_requested_by text
    CHECK (cancel_requested_by IS NULL OR cancel_requested_by IN ('user', 'admin'));

UPDATE public.billing_subscriptions
SET cancel_at_period_end = false
WHERE status IN ('cancelled', 'completed', 'expired') AND cancel_at_period_end;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (134, '134_subscription_cancel_request.sql')
ON CONFLICT (migration_number) DO NOTHING;
```

`supabase/migrations/134_subscription_cancel_request_rollback.sql`:

```sql
-- The cancel_at_period_end reset is not reversed: the pre-134 sync re-derives it on the next webhook.
ALTER TABLE public.billing_subscriptions
  DROP COLUMN IF EXISTS cancel_requested_by,
  DROP COLUMN IF EXISTS cancel_requested_at;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 134;
```

**Fail closed:** every writer of the two columns retries without them on `42703`/`PGRST204`, the same
pattern `insertBillingSubscriptionRow` uses for `subject_ref` (`razorpay-sync.ts:403`). Without
134, a cancel still reaches Razorpay and still sets `cancel_at_period_end = true`. Only the who and when are
lost. Admin and Phase 4 surfaces reading `cancelAtPeriodEnd` (`lib/admin/user-management.shared.ts:595,620`)
keep working. After 134, "cancelling" is true only for live subscriptions, which fits Unit C's
"re-sync only on active, not-cancelling" rule.

---

## 5. Per-unit design

Each unit is one committable piece. The executing agent commits before reporting. Opus reviews **the diff,
not the report**.

### Unit 0 — Razorpay sandbox probe (no code, run first, in parallel with B/C)

On the Preview with test keys, as a throwaway test user:
1. Subscribe to Audience (₹236). Then, from the **Razorpay dashboard or API**, cancel it with
   `cancel_at_cycle_end = 1`.
2. `GET /subscriptions/<id>` and save the **whole** entity to `docs/payments/research/11-cycle-end-cancel-probe.md`.
   Look for any field that marks the scheduled cancel (`ended_at`, `has_scheduled_changes`,
   `change_scheduled_at`, anything else). Also save the webhook Razorpay sends at that moment, if any
   (`billing_webhook_events`).
3. Try to undo it: Razorpay support / docs search for "cancel scheduled cancellation". Record the answer.
4. Tidy up: cancel it immediately.

**How the answer changes the build:** if the entity marks the scheduled cancel, the sync in Unit A also
**derives** `cancel_at_period_end` from it, which catches cancellations made in the dashboard too. If it
does not, only our own cancel actions set it, and a dashboard cancel shows as "renews" until the period
ends. That gap is recorded in PROJECT_STATE. **If there is no undo, Phase 5 offers no "resume"** (see F).

### Unit A — ledger correctness (Sonnet; Opus reviews line by line; no UI)

1. **`lib/billing/ledger.ts` `recordPayment` update path (165-173) becomes fill-only**, modelled on
   `d42622b`'s `recordRefund`:
   - `status`: written, but a settled status (`refunded`, `partially_refunded`) is never regressed to
     `captured`. Mirror the refund fix's rule.
   - `method_category`: written only when the incoming value is not `unknown`.
   - `provider_fee_minor`, `provider_tax_minor`, `webhook_event_id`: written only when non-null.
   - `tax_breakdown_json`: **never updated.** Write-once, like `captured_at` (see the comment at 181-184).
     Fill it only where the stored value is `{}`, via a guarded `.eq('tax_breakdown_json', {})` update.
   - `customer_snapshot_json`: **never updated.** Fill it only where it is null (`.is('customer_snapshot_json', null)`).
2. **The customer snapshot.** Add `buildCustomerSnapshot(profile: DbBillingProfile | null)` to
   `lib/billing/billing-profile.ts`. It returns
   `{ profileType, legalName, companyName, gstin, billingEmail, phone, stateCode, stateName, countryCode,
   addressLine1, addressLine2, city, postalCode, profileUpdatedAt, capturedAt }` or null. `profileType` is
   `'business'` iff `gstin` is set (Unit B's rule).
   - Checkout: `resolveCheckoutTax` (`pricing-checkout.ts:67-122`) already loads the profile at 92. It should
     return it. Both snapshots (subscription 179-191, top-up where the order is inserted at 344-377) gain
     `customer: buildCustomerSnapshot(profile)`.
   - Top-up settle (`razorpay-sync.ts:177-199`): pass `customerSnapshot: order.purchase_snapshot_json?.customer ?? null`.
   - Subscription (`razorpay-sync.ts:558-579`): **first charge** takes `checkoutOrder.purchase_snapshot_json.customer`.
     A **renewal** takes the live profile at the moment the row is first written. Change
     `resolveSubscriptionPaymentMoney` to return the profile it loaded at 378, so the tax split and the
     snapshot come from **one read**. With the write-once rule above, a later edit can no longer reach a
     recorded charge.
3. **The subscription payment method.** In `razorpay-sync.ts` before 558, when `paidInvoice.payment_id` is set
   and **no ledger row exists yet** for it, call `fetchRazorpayPayment(paidInvoice.payment_id)` once (it
   exists in `lib/billing/razorpay.ts`). Pass `rawMethod: payment.method`, `providerFeeMinor: payment.fee` and
   `providerTaxMinor: payment.tax`. On a fetch failure, fall back to the subscription entity's own
   `payment_method` (Razorpay sends it on every subscription webhook, e.g. `"card"`; seen in dev's
   `billing_webhook_events` 2026-09-23). Log the failure, and record `unknown` only if both are missing.
   Never throw: a method is not worth failing a grant over. Skip the fetch when the row exists, so reconcile doesn't make an
   API call per renewal per day.
4. **`cancel_at_period_end` in the sync** (`razorpay-sync.ts:477`, `:500`): stop deriving it from status.
   - Insert: `false`.
   - Update: omit the field while the status is live (`authenticated, active, pending, halted`), and write
     `false` once it is terminal.
   - If Unit 0 found a marker field, set `true` from it as well.
5. **The admin cancel** (`admin-billing-actions.ts:551-575`): after Razorpay succeeds, update the row with
   `cancel_at_period_end = true, cancel_requested_at = now(), cancel_requested_by = 'admin'`, with a 134
   fail-closed retry.
6. **Backfill note, not code:** the two existing payments keep `unknown` and a null snapshot. A snapshot
   taken now would be today's profile, not the one at purchase time, and so untrue. Record this in the
   handoff.

**Tests:** extend `lib/billing/ledger.test.ts` for the fill-only update: a second call with `rawMethod`
undefined must not blank `card`; a second call with a different `taxBreakdown` must not change it;
`customerSnapshot` fills once. `razorpay-sync.test.ts` covers: the first charge takes the order's customer; a
renewal takes the live profile; the payment is fetched only when no row exists; `cancel_at_period_end` is
omitted while active.

### Unit B — `lib/billing/billing-profile.shared.ts` (Sonnet)

This is one pure module that both the dialog and the server import. **The rules exist once.**
- `normalizeIndianPhone(raw)` → `'+91XXXXXXXXXX' | null`. It accepts `+91`, `91`, a leading `0`, spaces and
  dashes. The number must be 10 digits starting with 6-9.
- `isValidPin(pin)`: `/^[1-9][0-9]{5}$/`.
- `isValidEmail(email)`: a pragmatic single-`@` check. Don't try for RFC 5322.
- `gstinCheckDigit(first14)` and `isValidGstinWithChecksum(gstin)`: the §1 algorithm, plus the existing
  `GSTIN_REGEX`.
- `stateCodeFromGstin(gstin)` → the first two digits if they are in `INDIA_GST_STATE_CODES`, else null
  (25, 28 and anything unknown). The dialog then says "This GSTIN's state code isn't a current one. Please
  contact support."
- `pinStateHint(pin, stateCode)` → `'ok' | 'mismatch' | 'unknown'`. **Optional, last, and never blocking.**
  It uses a conservative table from 2-digit PIN prefix to a *set* of states. When a prefix spans states, all
  of them are included, so it warns only on a clear mismatch. If the table can't be sourced reliably from
  India Post's circle list within the unit, ship `'unknown'` everywhere and say so.
- `validateBillingProfile(input: BillingProfileInput)` → `{ field: keyof BillingProfileInput; message }[]`
  (field-level, so the dialog can show errors inline). It applies P1's required set per `profileType`.
  - **Business:** `stateCode` must equal `stateCodeFromGstin`. The server ignores any state the client sent.
  - **Personal:** `companyName` and `gstin` must be empty. Switching Business → Personal clears them.
- `isBillingProfileComplete(profile: BillingProfileDTO | null)` → boolean. It is the P7 gate, used by the
  wallet and by checkout.

Changes around it:
- `BillingProfileInput` (`lib/types/pricing.ts:696`) gains `profileType?: 'personal' | 'business'`. If it is
  absent (an old client), treat the profile as business iff a GSTIN is present.
- `BillingProfileDTO` gains a derived `profileType`.
- `lib/billing/billing-profile.ts:82-93` becomes a thin wrapper: it returns the first message from
  `validateBillingProfile`, so existing callers and tests keep their shape.
- `saveBillingProfile` stores the normalised phone, the upper-cased GSTIN and the derived state.
- **No DB change.** The GSTIN CHECK stays a shape check; the checksum lives in the app.
**Tests:** `billing-profile.shared.test.ts` covers each rule: the checksum against `LEGAL_GSTIN` and a typo,
retired state codes, phone forms, Business/Personal required sets, and the business state override.

### Unit C — `FilterDropdown` keyboard + `searchable` (Sonnet)

`components/ui/FilterDropdown.tsx`:
- **For every caller, a behaviour gain with no API change:** focus moves to the selected option on open.
  ArrowUp/ArrowDown move, Home/End jump, Enter/Space select, Escape closes and returns focus to the trigger,
  and Tab closes. `role="listbox"`/`option`, `aria-activedescendant` and `aria-expanded` are set.
- **`searchable?: boolean`, opt-in:** a text input pinned at the top of the portaled menu, focused on open.
  The options are filtered case-insensitively on their label (a "starts with" match ranks above a
  "contains" match), with a highlighted index. Enter picks the highlighted option. There is a "No matches"
  row. `updatePlacement` and `updateScrollIndicator` (82-116) must size off the **filtered** list.
- `placeholder?: string`: shown when `value` matches no option, which retires the `''` pseudo-option hack in
  `BillingDetailsDialog.tsx:26-29`.
- **Risk:** 28 callers. Opus's review must read through at least three of them: an admin panel, the story
  form, and the dialog. Add `e2e/filter-dropdown.spec.ts` against a signed-out page that already renders one,
  if one does. Otherwise cover it with a small vitest + testing-library spec, if the repo has the dependency;
  check `package.json` first.

### Unit D — the billing-details dialog (Sonnet; the owner reviews visually on the Preview)

Rewrite `components/pricing/BillingDetailsDialog.tsx`. Keep its props (`open, profile, onClose, onSaved`) so
`WalletPage` and Unit F both use it unchanged.
- **Shell:** `Modal` with `showCloseButton={false}`, plus AuthDialog's glow layer (189-204). Extract that into
  `components/ui/DialogGlow.tsx` so both use one copy, and **change AuthDialog to import it**. That brings the
  focus trap, focus return and reduced motion.
- **Header:** the title, then a two-way segmented **Personal | Business** toggle. Reuse AuthDialog's tab
  pattern (roving tabindex, arrow keys; `handleTabKeyDown` 93-106).
- **Sections**, each a subtle card with a small caption:
  - **You:** name, email (prefilled from the account), phone.
  - **Business** (Business only, animated in): company legal name, GSTIN. As soon as the GSTIN passes, the
    state below fills and **locks**, with a lock icon and "From your GSTIN".
  - **Address:** state (`FilterDropdown searchable`), city, PIN, line 1 and line 2. Line 1 carries
    "(optional)" for Personal only.
- **Validation:** `validateBillingProfile` runs on blur for the touched field, and on submit for all of them.
  Errors show inline under the field. The PIN hint is an amber "doesn't look like <state>" line, never a
  block.
- The submit label says what happens next: "Save and continue to payment" when opened from checkout, "Save"
  otherwise. Add a prop `context?: 'checkout' | 'manage'`.
- `WalletPage.tsx:343-344`: `requiresBillingDetails` becomes `requiresBillingState &&
  !isBillingProfileComplete(profile)` (P7).
- Motion only through `motion` variants that honour `useReducedMotion`. No new animation library.

### Unit E1 — checkout plumbing (Sonnet; Opus reviews)

1. **Extract** `requestPreparedRazorpayCheckout` and `openRazorpayCheckout` out of `WalletPage.tsx`
   (191-231, 1007-1102) into `components/pricing/checkout/useRazorpayCheckout.ts`, so `/wallet`, `/plans` and
   `/account/billing` share one implementation. `WalletPage` must behave the same afterwards.
2. **Measure first.** In `app/api/billing/razorpay/prepare/route.ts` and `prepareRazorpayCheckoutInternal`,
   time each step (auth, catalogue load, tax, RPC, `ensureRazorpayPlanRef`, Razorpay create, order update)
   with `performance.now()`. Return a `Server-Timing` header and log one line: `[checkout-timing]` with kind,
   `reused` and ms per step, with no ids beyond the internal order id. **No optimisation in this unit.** The
   owner runs three subscribes and three top-ups on the Preview and reads the numbers from the Vercel logs.
   Only then decide whether to pre-create the plan ref when a version is published (only worth it if
   `ensureRazorpayPlanRef` dominates).
3. **Razorpay options:**
   - `image`: an absolute URL to the Kissago mark. Add `public/brand/kissago-checkout-mark.png`, square and at
     least 256px. `public/` holds no logo today (checked 2026-09-23), so the owner supplies the art. Without
     it, omit `image` rather than ship a placeholder.
   - `theme.backdrop_color`: `'#0a0a0a'` (neutral-950).
   - `prefill.contact`: the normalised phone from the profile.
   - `modal.confirm_close: true`.
   The server adds `userPhone` to `PreparedRazorpayCheckoutBase` (`lib/types/pricing.ts:667`), read from the
   profile `resolveCheckoutTax` already loads.
4. **Failure handling** (defects 3 and 4): `payment.failed` **records** the last failure and does not settle.
   Only the handler (success) or `ondismiss` settles. On a dismiss after a recorded failure, show copy from a
   new `lib/billing/checkout-errors.shared.ts` that maps Razorpay's `error.reason`/`error.code` to Kissago
   sentences. The default is "That payment didn't go through, and you haven't been charged for it. You can
   try again." Raw provider text never renders.
5. **Dismiss is not "cancelled"** (defect 5): on `ondismiss`, poll the new status action (below) for up to
   ~20s before concluding. A UPI approval finished in the customer's app after they closed the window then
   lands as success, not silence.
6. **New `app/actions/billing-account.ts`** (`'use server'`, functions only):
   `getMyCheckoutStatus(internalOrderId)`. It authenticates, reads `billing_orders` by id **and user_id**,
   plus the subscription's `first_charge_confirmed_at` for a subscription order. It returns
   `{ state: 'open' | 'confirming' | 'paid' | 'failed' | 'abandoned' }`. There is no provider call; the
   webhook and verify already converge the row.
7. **Kids and attestation (P6):**
   - `prepare/route.ts` calls `resolveActiveViewerProfile()`. When `audienceMode === 'kids'` it returns a 403
     with the kids message.
   - The request body gains `adultAttested: boolean`. The server refuses when it is false, and writes
     `adultAttestedAt` into both snapshots (179-191, 344-377).
   - `getPricingWalletPageData` (`pricing-runtime.ts:210`) returns `audienceMode`, so the UI can explain up
     front.
**Tests:** `checkout-errors.shared.test.ts`. A route test for the kids and attestation refusals, if the prepare
route has a test harness (check); otherwise test a pure `assertCheckoutAllowed({audienceMode, adultAttested})`.

### Unit E2 — checkout UI (Sonnet; the owner reviews on the Preview)

1. **`quoteCheckout({ kind, planVersionId | topupPackId })`** in `app/actions/billing-account.ts`. It is
   read-only: it runs the same catalogue load and `resolveCheckoutTax` as prepare, creates nothing, and
   returns net, tax, gross, the tax label (IGST, or CGST+SGST), the included coins, the interval, the next
   charge date (today plus one interval) and whether a profile is needed. **Refactor `resolveCheckoutTax`
   out so prepare and quote share it**. Do not copy it.
2. **`components/pricing/checkout/CheckoutSummarySheet.tsx`** (`Modal` plus the glow) shows the pack's list:
   - plan, interval, net + GST = **total**;
   - "Renews monthly on the <day>. Cancel anytime; you keep access until the period ends";
   - viewing entitlement; coins included and when they reset (they do not roll over, per decision 6);
   - top-ups: "never expire";
   - links to the Refund Policy and Terms;
   - the P6 checkbox.
   The primary action is "Continue to secure payment".
   - **Annual:** annual amount plus a monthly equivalent. Latent today, since no annual plan is published
     and checkout refuses annual. Build the copy, and gate the display on data.
3. **The states around the Razorpay window**, one component, `CheckoutProgress`, in the same sheet:
   - from click to window: **"Opening secure checkout…"** (branded, animated, reduced-motion aware);
   - after the handler: **"Confirming your payment…"**, which polls `getMyCheckoutStatus` every 3s for up to
     90s;
   - then **success** (coins/plan in plain terms), **still confirming** ("This can take a few minutes with
     UPI. It will be applied automatically, and you can leave this page"), or **didn't go through** (E1's
     mapped copy).
   **Never "failed" while the order is `confirming`.**
4. `WalletPage`'s plan and pack buttons open the sheet instead of calling prepare directly. The old banners
   (677-700) are removed once the sheet owns the messaging.

### Unit F — Settings → Billing, `/account/billing` (Sonnet; Opus reviews the cancel path line by line)

- `app/account/billing/page.tsx`: a server shell. Sign-in is required, and signed-out visitors are redirected
  the way `/account/delete` does it (check its pattern). It renders `components/billing/BillingAccountPage.tsx`.
- **`getMyBillingOverview()`** in `app/actions/billing-account.ts`. Admin client, **always filtered by the
  authenticated user id**. It returns DTOs only, and never raw provider JSON:
  - the subscription: plan name, interval, status, `current_period_end`, `cancel_at_period_end`,
    `cancel_requested_at`, `grace_period_ends_at`;
  - balances, reusing the wallet's existing reads;
  - payments: date, what was bought (from `purchase_snapshot_json` or the plan version), gross and the tax
    line, `method_category` in words, status, and any refund with its date;
  - `billing_documents` for the user (expected empty);
  - the billing profile.
  Each section degrades on its own when the schema is missing, following `lib/billing/schema-availability.shared.ts`.
- **Page cards:**
  1. **Your plan:** name, price, status. It carries one clear state banner:
     - "Renews on <date>" or "Cancels on <date>";
     - `pending`: "We couldn't take this month's payment. Razorpay will retry daily for 3 days";
     - `halted`: P5's "Restart your plan";
     - cancelled or refunded: "Ended on <date>".
     Benefits come from the live catalogue.
  2. **Coins:** subscription, top-up and bonus balances, and the monthly reset date for subscription coins.
  3. **Payment history:** real money, newest first, with the method, the tax split and refund rows. Paginated
     at 20.
  4. **Invoices & receipts:** lists whatever `billing_documents` holds. When it is empty: "Tax invoices will
     appear here." **No fake download buttons.**
  5. **Billing details:** a read-only summary, Personal/Business, and "Edit". It opens Unit D's dialog with
     `context="manage"` and the line "Changes apply to future invoices".
- **Self-serve cancel (`cancelMySubscription({ requestKey })`)** in `billing-account.ts`. It returns its
  outcome **as data**, following `admin-billing-ui-actions.ts`, because thrown errors are redacted in
  production:
  - authenticate; load the user's live subscription (`authenticated | active | pending`);
  - if it is already `cancel_at_period_end`, return `alreadyApplied`;
  - `cancelRazorpaySubscription({ atCycleEnd: true })`; this is **never client-controlled** (decision 13);
  - then write `cancel_at_period_end = true, cancel_requested_at, cancel_requested_by = 'user'` (134
    fail-closed), then a best-effort `reconcilePricingSubscription`.
  **The UI** is one confirm dialog that states the end date and what is kept. There are no retention
  screens and no guilt copy; the pack forbids manipulative retention. It is **two clicks, the same as
  subscribing**. **No kill switch** hides cancel while checkout is on.
- **No "resume"** unless Unit 0 found a real undo. The cancelled state says "You can subscribe again after
  <date>" (the RPC blocks it before then; §1).
- **Halted recovery (P5):** `restartMyHaltedSubscription({ requestKey })` cancels the halted subscription
  immediately, then the client opens the checkout summary for the same plan.
- **Links:**
  - `UserMenu.tsx`: a new "Billing" item → `/account/billing`, after 241.
  - `WalletPage.tsx:625-643`: the row becomes "Manage billing →".
  - The success state in `CheckoutProgress`: "View receipt and billing".

### Unit G — plan comparison, `/plans` (Sonnet)

- `app/plans/page.tsx`, a server component that is public. It reads the published catalogue for the viewer's
  market, IN when signed out (reuse `getPricingRuntimeContext`, `pricing-runtime.ts:52`). It renders the
  pack's comparison as **content**:
  - a table at `md` and up, stacked cards below that;
  - the watch quota read from its setting, not typed in;
  - coins from `monthly_included_beats`;
  - prices as GST-exclusive plus "+ GST";
  - **annual only if published** (none are).
- CTAs: signed out → sign in. Signed in → `/wallet?checkout=<planVersionId>`, which opens E2's sheet for that
  version.
  - The current plan shows "Your plan".
  - Under **P2(a)**, other plans show "Switch after <date>" with a one-line explanation.
  - Under P2(b), they show "Upgrade now" with the forfeit notice.
- `e2e/plans.spec.ts`, signed-out: the page renders, lists four plans, shows no ₹0 paid plan, and the table
  collapses at a phone width.

---

## 6. Verification

**Every unit:** `npx tsc --noEmit`, `npm run lint` (zero warnings), `npm test`, `npm run build:verify`, and
`npm run test:e2e` for C and G. Opus reads the diff before accepting.

**Money walk additions**, appended to `money-walk-runbook.md` when A, E1 and F land. On the Preview:
- **9. Top-up with a business profile:** the payment row has `customer_snapshot_json` with the GSTIN. Edit the
  profile to another state and run reconcile: the snapshot and `tax_breakdown_json` are **unchanged**.
- **10. Subscribe:** the payment's `method_category` is not `unknown`.
- **11. Self-cancel from `/account/billing`:** Razorpay shows the scheduled cancel. Run reconcile: the row
  still reads `cancel_at_period_end = true`, and the page says "Cancels on <date>".
- **12. A deliberately failed card, then a retry in the same window:** the page ends on success.
  Close the window mid-UPI: the page shows "Confirming", not nothing.
- **13. Switch to a kids profile:** checkout refuses. Unticked attestation: Continue stays disabled, and the
  server refuses a crafted request.
- **14. Timing:** record the three-and-three `[checkout-timing]` lines in `audit-progress.md`.

**Not verifiable here:** e2e is signed-out only, so every signed-in surface is proven by unit tests plus the
owner's walk. Say so in each unit's report.

---

## 7. Kill switches

There are no new flags. The checkout parts sit behind `pricing_checkout_enabled`, as they do today.
**Self-serve cancel and the billing page are deliberately not flagged.** Cancel must never be harder to reach
than subscribe. The page degrades per section on a missing schema.

---

## 8. Carried in, and owner actions

- **Owner: turn `billing_document_issuing_enabled` off on dev.** It is on, and harmless only because nothing
  calls it. Phase 6 would issue on its first caller.
- **Owner: `billing_admin_actions_enabled` off** (walk done). This is still open from the handoff.
- The refund policy copy (`lib/managed-pages/registry.ts:315`) must state decisions 11-16. E2's summary sheet
  links to it, so it becomes customer-facing at checkout. **Phase 5 should not ship to prod before that
  copy is final.**
- Known, not fixed: `processRefundEvent` marks a pending `refund.created` as processed (see `audit-progress.md`).
  Phase 5's history would show "Refunded" early in live mode. It is out of scope here; fix before live money.
- Unit C's admin-UI scope call (re-sync only on non-cancelling subscriptions) becomes accurate once A and 134
  land.

---

## 9. Execution order for a fresh session

1. Post the phase brief (owner rule). Get **P1-P7** answered, at least P1, P3 and P6 before D, E1 and F.
2. **Unit 0** (the owner, on the Preview) while **B** and **C** run as two Sonnet agents in parallel (**max 2
   at once**).
3. **A** (alone: it touches the money path, so Opus reviews it line by line). **M** in the same slot: write
   the files and have the owner apply 134 on dev.
4. **D** and **E1** in parallel. Then **E2**. Then **F**. Then **G**.
5. After each unit: update this file's table and `audit-progress.md`. Ask the owner for session usage at each
   boundary, and stop delegating at 90%.
