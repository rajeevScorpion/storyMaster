# Phase 7 — compliance, go-live readiness and the release runbook

Planned 2026-09-24 on branch `payments`, while Phase 6 C2/D were building. Prompt:
`prompt-packs/kissago-payment-billing-prompt-pack-2026-09-17/09_PHASE_7_COMPLIANCE_AND_GO_LIVE.md`.
**It is the live-money gate.** Nothing here turns on real money: the owner does that, by hand, from the
runbook this phase writes.

## 0. Scope

**In:**
- Customer-facing policy text brought in line with what the code does.
- One disclosure gap fixed at checkout.
- The 7-day refund window made visible to the admin.
- A named-account rollout switch.
- Phase 6 health signals on the existing billing-incidents page.
- **The go-live runbook:** the Razorpay dashboard checklist, the prod migration order, env vars, exact
  flag values, the smoke ladder, emergency stops, and a go-live report template.

**Out:**
- Anything international (Phase 8).
- An on-call or paging system. Monitoring is the admin page plus the daily reconcile.
- Automated legal review. The text is written to match the code, not signed off by counsel.

## 1. Owner decisions (2026-09-24, all as recommended)

| # | Decision |
|---|---|
| R1 | **The 7-day window: warn and override.** Past 7 days from capture, the admin refund dialog shows "Outside the 7-day refund window" and needs a ticked confirmation. The server refuses without it. |
| R2 | **The Terms update is published as *minor*,** so no re-accept prompt. It only adds rights and points to the Refund Policy. |
| R3 | **Named accounts first.** A switch restricts checkout to a listed set of accounts. Switching it off opens checkout to everyone. |

## 2. Verified current-state facts (2026-09-24)

**Refund rules in code:**
- `lib/billing/refund-eligibility.shared.ts` refuses above 20% used and caps refunds at 2 per account
  (the `billing_refund_cap_per_account` flag value).
- **There is no date check anywhere.** `refundBillingPayment` (`app/actions/admin-billing-actions.ts:148`)
  never reads `captured_at`.

**The checkout sheet** (`components/pricing/checkout/CheckoutSummarySheet.tsx:256-320`) already shows:
- the total with GST, and the net plus tax lines;
- the renewal date ("Renews monthly on the 24th." / "Renews yearly on …");
- "Cancel anytime; you keep access until the period ends";
- coins that reset each cycle with no rollover, and top-up coins that never expire;
- the age and payer attestation;
- links to the Terms and the Refund Policy.

**The one gap:** the renewal line never states the **amount** that renews, and an annual plan's
"≈ ₹X / month" line could read as monthly billing.

**Policy pages** (`lib/managed-pages/registry.ts`; the database holds the live text, and admins publish
versions):
- `refund-policy` (`:305`) is headed "Starter Draft - Review Before Rollout". It says there is no
  self-serve cancel and no refunds; both exist.
- `terms` §7-8 (`:260-266`) say the same.
- `privacy` must add **Resend** (billing email addresses) as a processor, plus the billing-record
  retention.

**Checkout:**
- The gate is `pricing_checkout_enabled`, checked first in `prepareRazorpayCheckoutInternal`
  (`app/actions/pricing-checkout.ts`).
- The kids and attestation refusal is `assertCheckoutAllowed` (`lib/billing/checkout-guard.shared.ts:25`),
  which throws `CheckoutRefusalError` with a fixed sentence.

**Admin incidents:** `app/admin/pricing/billing-incidents/page.tsx` + `app/actions/billing-incidents.ts` +
`lib/billing/billing-incidents.shared.ts` (Phase 4).

**Prod is at migration 124.** Payments migrations 125-135 are applied on dev only.

## 3. Units

The order is **P7-A (Opus) ∥ P7-B (Sonnet) → P7-C (Opus) → owner walk**.

### P7-A — policy text (Opus writes; the owner publishes)

Rewrite the seeds in `lib/managed-pages/registry.ts`. The live text changes only when the owner publishes a
version from `/admin` → Pages (§5).

**Refund / Cancellation Policy.** Drop the draft header and `policyPlaceholder`, and state what the code
does:
- **Cancelling:** from Settings → Billing at any time. The plan runs to the end of the paid period and
  doesn't renew. Nothing is refunded for the unused part of a period (decision 13).
- **Refunds:**
  - on request, within 7 days of the payment, if no more than 20% of that purchase's coins have been used;
  - full refunds only (decision 11);
  - the purchase's unused coins are removed first (decision 12);
  - at most 2 refunds per account;
  - a plan with no coins is refundable within 7 days (decision 16);
  - refunding the current period's subscription payment ends the plan straight away (decision 15).
- **How:**
  - email support with the payment date;
  - the money returns to the original method, and banks take 5-7 working days;
  - a credit note is emailed.
- **Coins:** subscription coins reset every cycle and don't roll over; top-up coins never expire; spent
  coins are not refundable.
- **Delivery of digital services** (Razorpay's website review asks for this): coins are credited and plans
  start immediately after payment; nothing is shipped.
- **Failed renewals:** Razorpay retries for about 3 days; access continues through the grace period, then
  the plan pauses.
- **Chargebacks:** unused coins from that purchase are removed, and the account may be reviewed.
- **Grievances:** the grievance officer contact, as on the other legal pages.

**Terms:**
- §7: add "Prices are exclusive of GST; the total including GST is shown before you pay. Subscriptions
  renew automatically until cancelled."
- §8: replace it with a short paragraph pointing to the self-serve cancel and to the Refund / Cancellation
  Policy.

**Privacy:**
- add Resend (transactional billing email) to the processors list;
- add billing records (payments, invoices, credit notes) kept for 8 years for tax law, anonymised after
  account deletion.

**Account deletion:** check that it already says billing records stay for 8 years, anonymised (Phase 2).
Align the wording if not.

**Tests:** the existing registry/seed tests stay green; add one asserting the refund policy no longer
contains "Starter Draft".

### P7-B — code (Sonnet; Opus reviews)

1. **The disclosure fix** (`lib/billing/checkout-quote.shared.ts:78` `formatRenewalLine` and its caller):
   - the renewal line carries the amount: "Renews monthly on the 24th at ₹531." / "Renews yearly on
     September 24, 2027 at ₹5,310.";
   - for annual, change "≈ ₹X / month" to "Billed once a year (≈ ₹X / month)";
   - update the tests.
2. **The 7-day window (R1):**
   - a pure `isOutsideRefundWindow(capturedAt, now, days = 7)` in `refund-eligibility.shared.ts`;
   - `refundBillingPayment` gains `confirmOutsideWindow?: boolean`. Outside the window without it, throw
     "This payment is outside the 7-day refund window. Confirm to refund anyway.";
   - record `outsideWindow: true` in the audit row's `before_json`;
   - in the admin refund dialog (`components/admin/users/AdminUserDetail.tsx`), show the warning and a
     checkbox when outside the window;
   - tests for the helper and the refusal.
3. **Named-account rollout (R3):**
   - A new flag row `billing_checkout_allowlist` (the Phase 7 migration **137**, §4). **`enabled` = the
     restriction is on**, and `value` = a comma-separated list of user ids.
   - In `prepareRazorpayCheckoutInternal`, after the kill-switch check and the auth lookup: if the flag is
     enabled and the user id is not in the list, throw `CheckoutRefusalError("Payments aren't open yet.
     We'll let you know when they are.", 'not_in_rollout', 403)`.
   - **A missing flag row means no restriction** (today's behaviour); the kill switch is the brake.
   - The pure parser `parseCheckoutAllowlist(value)` lives in `checkout-guard.shared.ts`, with tests.
   - Add it to `lib/admin/operational-flags.shared.ts`. The value is edited in SQL for now (runbook
     step); a list editor is deferred.
4. **Phase 6 health** on the billing-incidents page: count cards for
   - billing jobs `failed`;
   - jobs `pending` older than 1h;
   - refunds `pending` older than 24h;
   - captured payments in the last 7 days with no issued invoice, while issuing is on.
   - Each reads fail-closed (a missing table shows "unavailable").
   - Pure mappers go in `billing-incidents.shared.ts`, with tests.

### P7-C — the go-live runbook (Opus): `docs/payments/go-live-runbook.md`

A checklist for the owner, each item with the exact page or command and a check query:
1. **Before anything:**
   - the carried items (§6);
   - the CA's answers replacing the assumptions (audit-progress, "CA questions");
   - the Refund Policy published.
2. **Prod database:**
   - apply 125 → 137 **in numeric order**, one at a time;
   - after each, `select migration_number from public.schema_migration_ledger order by 1 desc limit 3;`;
   - a pre-check for 124's backfill note (no live key ever set).
3. **Prod env vars (Vercel Production):**
   - `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` (live), `RAZORPAY_WEBHOOK_SECRET` (live), `RESEND_API_KEY`,
     `CRON_SECRET`, `APP_URL`, `R2_PRIVATE_BUCKET_NAME` (prod), `SUPPORT_EMAIL`;
   - each named, with where it comes from.
4. **The Razorpay live dashboard:**
   - KYC approved;
   - Subscriptions enabled;
   - the payment methods;
   - auto-capture on;
   - the **live** webhook registered separately, to the prod URL, with the same event list as test;
   - the live plan refs are created by the app at first checkout (`provider_price_ref_mode = live`).
     Confirm that no test ref is reused.
5. **Flags on prod, exact values, in order:**
   - `billing_checkout_allowlist` on, with the owner's id;
   - `billing_reconcile_enabled` on;
   - `billing_document_issuing_enabled` on (after the CA);
   - `billing_emails_enabled` on;
   - `billing_admin_actions_enabled` on;
   - `pricing_checkout_enabled` on, last.
6. **The smoke ladder:**
   - on prod with the owner's own account: a ₹ top-up, an invoice, the email, a refund, a credit note;
   - Audience monthly: subscribe, then cancel;
   - Audience annual: subscribe, then refund;
   - each step names its `money-walk-runbook.md` step and its check query.
7. **Open to testers:** add their ids. **Then everyone:** turn the allowlist off.
8. **Emergency stops:**
   - **New checkouts:** `pricing_checkout_enabled` off.
   - **Renewals** continue at Razorpay; to stop one, cancel it from the admin page or the Razorpay
     dashboard.
   - **Audience only:** archive its plan version, which doesn't touch existing subscribers (decision 14).
   - **Emails:** `billing_emails_enabled` off.
   - **Documents:** `billing_document_issuing_enabled` off. Issued ones stay valid.
   - **The quota:** its own flag.
   - **After a provider outage:** run the reconcile manually (the POST route).
   - **A code rollback:** `git revert -m 1 <merge>`. Issued documents and ledger rows are never rolled
     back; a bad document is voided, not deleted.
9. **The go-live report template:** flags, migrations, env, dashboard checks, test results, known limits,
   open CA items, the final commit hash.

## 4. Migration 137 — `137_billing_checkout_allowlist.sql`

```sql
-- Phase 7: a named-account rollout switch. enabled = checkout restricted to the user ids in value
-- (comma-separated); disabled or absent = open to everyone. The global kill switch is still
-- pricing_checkout_enabled.
-- Verify: select flag_key, enabled, value from public.feature_flags where flag_key = 'billing_checkout_allowlist';

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES ('billing_checkout_allowlist', false, '')
ON CONFLICT (flag_key) DO NOTHING;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (137, '137_billing_checkout_allowlist.sql')
ON CONFLICT (migration_number) DO NOTHING;
```

The rollback:

```sql
DELETE FROM public.feature_flags WHERE flag_key = 'billing_checkout_allowlist';
DELETE FROM public.schema_migration_ledger WHERE migration_number = 137;
```

## 5. Owner actions

**Publish the policies**, after P7-A lands and deploys to the Preview:
- `/admin` → Pages → Refund / Cancellation Policy → "Reset to seed" → review → Publish version `1.0.0`
  (minor).
- The same for Terms (a new version, **minor**, R2), Privacy (minor) and Account Deletion if it changed.
- **Check:** `/refund-policy` no longer shows "Starter Draft".

**Apply 137 on dev** (the SQL editor). Check with the query in the file header.

## 6. Carried into the go-live checklist (none may be dropped)

**The five deferred Phase 5 items:**
- the Unit 0 cycle-end-cancel probe;
- the subscribe → cancel → reconcile walk;
- the Razorpay logo and the checkout sheet on the Preview;
- the final Refund Policy copy (P7-A writes it; the owner publishes it);
- 134 on prod.

**The six CA answers** assumed in Phase 6 (audit-progress, "CA questions").

**Known limits:**
- `refund.created` flips the legacy `billing_orders.status` early;
- there is no in-place plan change;
- there is no document void/reissue tool;
- the worker runs only on kicks and the daily cron until Vercel is on a paid plan.

## 7. Verification

- **Code:** tsc, lint, the tests, `build:verify`, and e2e smoke.
- **The disclosure fix:** Playwright on the local agent server as `testuser`, reading the sheet's renewal
  line for monthly and annual.
- **The allowlist:** with it on and `testuser` not listed, prepare refuses with the sentence; with
  `testuser` listed, it passes.
- **The policy pages** render: e2e `legal-pages.spec.ts` plus a read of `/refund-policy` after reseeding
  on dev.
