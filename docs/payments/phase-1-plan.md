# Payments Phase 1 — make money movement correct

_Plan written 2026-09-17 on branch `payments` (Opus). Executed by Sonnet in a fresh session. Prompt:
`prompt-packs/kissago-payment-billing-prompt-pack-2026-09-17/03_PHASE_1_MONEY_CORRECTNESS.md`._

**Outcome:** one payment → at most one coin grant, whatever order the browser verify, webhooks and reconcile run
in; failed webhooks recover; coins and paid-tier access only after Razorpay confirms money; the browser can't choose
which subscription is synced; the checkout switch works on the server; test and live Razorpay objects never mix.

**Not in this phase:** payments/refunds/invoice tables and retention (Phase 2), coin clawback and admin actions
(Phase 4), self-serve cancel / failed-renewal recovery / per-user reconcile on wallet open (Phase 5), email
(Phase 6), Audience and quota (Phase 3).

---

## 1. Verified current-state facts (read 2026-09-17)

| Fact | Where |
|---|---|
| Prepare never reads `pricing_checkout_enabled`; the flag row exists (default `false`) and only the wallet UI reads it. | `app/actions/pricing-checkout.ts:30-162`; `018_pricing_runtime_flags.sql:10`; `lib/pricing/snapshot.ts:63` |
| `getFeatureFlag(key, fallback)` caches for 60 s. | `lib/ai/model-config.ts:21,427` |
| Subscription one-at-a-time guard only reads synced `billing_subscriptions`; in-progress checkouts live only in `billing_orders`. | `pricing-checkout.ts:50-65` |
| India annual checkout is blocked for every plan. Leave as-is in Phase 1 (Phase 3 makes it plan-aware). | `pricing-checkout.ts:46-48` |
| Plan ref cached forever on the version, no mode. | `pricing-checkout.ts:272-306` |
| Subscriptions created with `customer_notify: 0`, `total_count` 100/1200. | `lib/billing/razorpay.ts:99-114` |
| Razorpay wrappers exist only for create plan / create subscription / fetch subscription / create order + signature checks. | `lib/billing/razorpay.ts` |
| Verify (subscription) checks the signature against the stored ID, then fetches and syncs `body.razorpaySubscriptionId`. | `app/api/billing/razorpay/verify/route.ts:59-83` |
| Verify (top-up) grants on signature alone and sets order `paid`. | `verify/route.ts:111-156` |
| Sync rewrites `user_id` on an existing subscription row. | `lib/billing/razorpay-sync.ts:65-83` |
| Grants are check-then-insert; subscription grant fires on `active` or `authenticated`; coin amount read from the live catalog. | `razorpay-sync.ts:128-230` |
| `beat_grants` has no unique constraint on the source. Dev has 0 duplicate `(source_type, source_ref_id)`. | `017_wallet_core.sql:4-15`; dev query 2026-09-17 |
| Webhook: any stored event ID → `duplicate: true` whatever its status; failed events stored `failed` and answered 500; missing secret throws before the try. | `webhook/route.ts:39-105` |
| Webhook acts only on a subscription entity or an order/payment ID; refunds and disputes fall through. | `webhook/route.ts:108-245` |
| Tier access treats `authenticated` as entitled, and `pending`/`halted` inside grace as entitled. | `lib/pricing/snapshot.ts:52-53,346-375` |
| Wallet shows `payload.message` from a 2xx verify response, so a "still confirming" message needs no UI change. | `components/pricing/WalletPage.tsx:1003-1032` |
| Daily reconcile route exists (Vercel's only cron, 03:00 UTC); each job is wrapped in its own `.catch`. | `app/api/batch/reconcile/route.ts:58-110` |
| Next migration number is **124**. Migrations self-record in `schema_migration_ledger`. | `supabase/migrations/123_*.sql` |
| Razorpay `GET /v1/invoices?subscription_id=` returns invoices with `status` (`paid`, …), `payment_id`, `billing_start`, `billing_end`, `paid_at`. | razorpay.com/docs/api/payments/subscriptions/fetch-invoices/ (fetched 2026-09-17) |
| Dev billing data: 12 orders (8 abandoned subscription checkouts), 1 subscription, 0 webhook events. All created with test keys. | dev query 2026-09-17 |

## 2. Design decisions

1. **The database enforces one grant per purchase.** A partial unique index on `beat_grants(source_type, source_ref_id)`
   for `subscription` and `topup`. Grant code inserts directly and treats Postgres `23505` as "already granted".
   Source refs are unchanged (`topup` → billing order id; `subscription` → `<sub_id>:<current_start>`), so the existing
   dev grants still count.
2. **Grants only after confirmed money.**
   - **Top-up:** fetch the payment from Razorpay. If `authorized`, capture it server-side. Grant only when
     `captured`, the amount and currency match the order, and the payment belongs to that order.
   - **Subscription cycle:** grant only when Razorpay lists a `paid` invoice covering the cycle
     (`billing_start <= current_start < billing_end`). This works the same for card, UPI Autopay and eNACH, so no
     per-rail rules are needed.
   - Record `first_charge_confirmed_at` the first time a paid invoice is seen.
3. **Tier access follows the same rule.** `authenticated` is entitled only once `first_charge_confirmed_at` is set;
   grace (`pending`/`halted`) likewise only applies after a confirmed first charge. `active` is unchanged.
4. **Server-side identity only.** Verify uses the subscription ID stored on the order; a different client-supplied ID
   → 400. Sync never changes the owner of an existing row; a mismatch throws. Razorpay `notes.user_id`, when
   present, must match.
5. **One subscription checkout at a time, enforced in SQL.** An RPC takes a per-user advisory lock:
   - It refuses when a live subscription exists.
   - It hands back the same in-progress checkout for the same plan, so double clicks and second tabs converge.
   - A checkout for a different plan supersedes the older one, which is best-effort cancelled at Razorpay.
   - Checkouts older than 30 minutes become `abandoned`.
   - New Razorpay subscriptions carry `expire_by` = now + 30 min, so an abandoned modal can't be paid later.
     **Executor: confirm `expire_by` on Razorpay's Create Subscription API page first.** If it isn't supported, drop
     it and rely on cancelling superseded subscriptions.
6. **Mode-safe references.** `getRazorpayMode()` derives `test`/`live` from the key ID prefix (`rzp_test_` /
   `rzp_live_`, anything else throws). A cached plan ref is reused only when its recorded mode matches. Orders and
   subscriptions record their mode; reconcile skips rows from the other mode. Existing rows are backfilled `test`.
7. **Purchase snapshot at checkout.** `billing_orders.purchase_snapshot_json` holds what was sold (plan version, plan
   key and name, interval, amount, currency, included beats or pack beats, market, mode). Grants read beats from the
   snapshot. Legacy orders without one fall back to the catalog, with `snapshotMissing: true` in grant metadata.
8. **The kill switch blocks new checkouts only.** Prepare refuses when `pricing_checkout_enabled` is off (fallback
   `false`, 60 s cache). Verify, webhook and reconcile keep honouring payments already started, because refusing them
   would take money without delivering. _Deliberate deviation from the pack's wording; recorded in the handoff._
9. **Webhooks are retryable and classified.**
   - `processed`/`ignored` events are true duplicates.
   - `failed` events, and `received` events older than 5 minutes, are reprocessed (`attempt_count` + 1).
   - Every event gets an `outcome` (e.g. `cycle_granted`, `subscription_synced`, `topup_granted`, `topup_pending`,
     `refund_recorded`, `dispute_recorded`, `no_matching_order`, `unhandled_event_type`).
   - Refunds and disputes are recorded on the matching order's status (`refunded`, `partially_refunded`,
     `disputed`). Unmatched ones stay `processed` with the payload kept for Phase 2's ledger backfill. No clawback yet.
10. **Stored payloads are redacted** of `email`, `contact`, `vpa`, `card`, `bank_account` and `notes.address` before
    being written to `payload_json` / `raw_provider_*_json`.
11. **Config errors are observable.** A missing webhook secret or unknown key prefix logs
    `[razorpay.webhook] config_error` with a reason code (never a value) and returns 500 so Razorpay retries.
12. **Reconcile backstop** in the daily cron, behind `billing_reconcile_enabled` (seeded `false`, fallback `false`),
    time-boxed and capped. It uses the same core functions as verify and webhook.
13. **Razorpay stopgap notifications:** `customer_notify: 1` on new subscriptions (owner-approved D5) until Phase 6
    email exists.

## 3. Migration 124

`supabase/migrations/124_billing_money_correctness.sql`:

```sql
-- 124_billing_money_correctness.sql
--
-- Payments Phase 1 (docs/payments/phase-1-plan.md): one grant per purchase, retryable webhooks, test/live-safe
-- provider references, purchase snapshots, and one in-progress subscription checkout per user.
--
-- Precheck (must return no rows, or the unique index fails):
--   select source_type, source_ref_id, count(*) from public.beat_grants
--   where source_type in ('subscription','topup') and source_ref_id is not null group by 1,2 having count(*) > 1;
--
-- Trap: existing billing rows and plan refs are backfilled as 'test'. That is only true while no live Razorpay key
-- has ever been configured in this environment — confirm before applying on prod.
--
-- Verify: select indexname from pg_indexes where indexname = 'uq_beat_grants_purchase_source';

CREATE UNIQUE INDEX IF NOT EXISTS uq_beat_grants_purchase_source
  ON public.beat_grants (source_type, source_ref_id)
  WHERE source_type IN ('subscription', 'topup') AND source_ref_id IS NOT NULL;

ALTER TABLE public.billing_orders
  ADD COLUMN IF NOT EXISTS provider_mode text NOT NULL DEFAULT 'test' CHECK (provider_mode IN ('test', 'live')),
  ADD COLUMN IF NOT EXISTS purchase_snapshot_json jsonb;
ALTER TABLE public.billing_orders ALTER COLUMN provider_mode DROP DEFAULT;

ALTER TABLE public.billing_subscriptions
  ADD COLUMN IF NOT EXISTS provider_mode text NOT NULL DEFAULT 'test' CHECK (provider_mode IN ('test', 'live')),
  ADD COLUMN IF NOT EXISTS first_charge_confirmed_at timestamptz;
ALTER TABLE public.billing_subscriptions ALTER COLUMN provider_mode DROP DEFAULT;

ALTER TABLE public.pricing_plan_versions
  ADD COLUMN IF NOT EXISTS provider_price_ref_mode text CHECK (provider_price_ref_mode IN ('test', 'live'));
UPDATE public.pricing_plan_versions
SET provider_price_ref_mode = 'test'
WHERE provider_price_ref IS NOT NULL AND provider_price_ref_mode IS NULL;

ALTER TABLE public.billing_webhook_events
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome text;

CREATE INDEX IF NOT EXISTS idx_billing_orders_reconcile
  ON public.billing_orders (provider, provider_mode, order_type, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.billing_begin_subscription_checkout(
  p_user_id uuid,
  p_plan_version_id uuid,
  p_provider_mode text,
  p_snapshot jsonb
)
RETURNS TABLE (
  order_id uuid,
  reused boolean,
  provider_checkout_session_id text,
  superseded_session_ids text[],
  blocked_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stale_after constant interval := interval '30 minutes';
  v_version public.pricing_plan_versions%ROWTYPE;
  v_open public.billing_orders%ROWTYPE;
  v_superseded text[] := ARRAY[]::text[];
  v_order_id uuid;
BEGIN
  IF p_provider_mode NOT IN ('test', 'live') THEN
    RAISE EXCEPTION 'Invalid provider mode %', p_provider_mode;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('billing_subscription_checkout:' || p_user_id::text, 0));

  IF EXISTS (
    SELECT 1 FROM public.billing_subscriptions
    WHERE user_id = p_user_id
      AND provider = 'razorpay'
      AND status IN ('authenticated', 'active', 'pending', 'halted')
  ) THEN
    RETURN QUERY SELECT NULL::uuid, false, NULL::text, v_superseded, 'subscription_exists'::text;
    RETURN;
  END IF;

  UPDATE public.billing_orders
  SET status = 'abandoned', updated_at = now()
  WHERE user_id = p_user_id
    AND provider = 'razorpay'
    AND order_type = 'subscription_checkout'
    AND status IN ('preparing', 'created')
    AND created_at <= now() - v_stale_after;

  SELECT * INTO v_open
  FROM public.billing_orders
  WHERE user_id = p_user_id
    AND provider = 'razorpay'
    AND order_type = 'subscription_checkout'
    AND status IN ('preparing', 'created')
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_open.provider_checkout_session_id IS NULL THEN
      RETURN QUERY SELECT NULL::uuid, false, NULL::text, v_superseded, 'checkout_in_progress'::text;
      RETURN;
    END IF;

    IF v_open.plan_version_id = p_plan_version_id AND v_open.provider_mode = p_provider_mode THEN
      RETURN QUERY SELECT v_open.id, true, v_open.provider_checkout_session_id, v_superseded, NULL::text;
      RETURN;
    END IF;

    WITH superseded AS (
      UPDATE public.billing_orders
      SET status = 'superseded', updated_at = now()
      WHERE user_id = p_user_id
        AND provider = 'razorpay'
        AND order_type = 'subscription_checkout'
        AND status = 'created'
      RETURNING provider_checkout_session_id
    )
    SELECT coalesce(array_agg(provider_checkout_session_id) FILTER (WHERE provider_checkout_session_id IS NOT NULL), ARRAY[]::text[])
    INTO v_superseded
    FROM superseded;
  END IF;

  SELECT * INTO v_version FROM public.pricing_plan_versions WHERE id = p_plan_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan version % not found', p_plan_version_id;
  END IF;

  INSERT INTO public.billing_orders (
    user_id, provider, provider_mode, order_type, currency_code, amount_minor, status,
    plan_version_id, purchase_snapshot_json
  )
  VALUES (
    p_user_id, 'razorpay', p_provider_mode, 'subscription_checkout', v_version.currency_code, v_version.price_minor,
    'preparing', v_version.id, p_snapshot
  )
  RETURNING id INTO v_order_id;

  RETURN QUERY SELECT v_order_id, false, NULL::text, v_superseded, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.billing_begin_subscription_checkout(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_begin_subscription_checkout(uuid, uuid, text, jsonb) TO service_role;

INSERT INTO public.feature_flags (flag_key, enabled)
VALUES ('billing_reconcile_enabled', false)
ON CONFLICT (flag_key) DO NOTHING;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (124, '124_billing_money_correctness.sql')
ON CONFLICT (migration_number) DO NOTHING;
```

Checked: `feature_flags.value` is nullable (018), so the two-column insert is valid; `price_minor` / `currency_code`
are the version's column names (`pricing-checkout.ts:42,85-86`).

`supabase/migrations/124_billing_money_correctness_rollback.sql`:

```sql
-- 124_billing_money_correctness_rollback.sql
-- Trap: after live payments, prefer turning checkout off over rolling back — the added columns hold snapshots and
-- modes that later phases rely on. Dropping the index re-opens double grants.

DROP FUNCTION IF EXISTS public.billing_begin_subscription_checkout(uuid, uuid, text, jsonb);
DROP INDEX IF EXISTS public.idx_billing_orders_reconcile;
DROP INDEX IF EXISTS public.uq_beat_grants_purchase_source;
ALTER TABLE public.billing_webhook_events DROP COLUMN IF EXISTS outcome, DROP COLUMN IF EXISTS last_attempt_at, DROP COLUMN IF EXISTS attempt_count;
ALTER TABLE public.pricing_plan_versions DROP COLUMN IF EXISTS provider_price_ref_mode;
ALTER TABLE public.billing_subscriptions DROP COLUMN IF EXISTS first_charge_confirmed_at, DROP COLUMN IF EXISTS provider_mode;
ALTER TABLE public.billing_orders DROP COLUMN IF EXISTS purchase_snapshot_json, DROP COLUMN IF EXISTS provider_mode;
DELETE FROM public.feature_flags WHERE flag_key = 'billing_reconcile_enabled';
DELETE FROM public.schema_migration_ledger WHERE migration_number = 124;
```

The owner applies 124 to **dev** by hand before Unit B's route tests run against dev. Code in this phase requires
the migration; do not deploy it to an environment without 124.

## 4. Code changes

### Unit A — provider wrappers and the idempotent core

**`lib/billing/razorpay.ts`**
- Add `export type RazorpayMode = 'test' | 'live'` and `getRazorpayMode(): RazorpayMode` from the `keyId` prefix;
  unknown prefix throws `RazorpayConfigError('unknown_key_prefix')`.
- Add `class RazorpayConfigError extends Error { reason }`. Throw it from `getRazorpayConfig` (`missing_keys`) and
  `ensureRazorpayWebhookSecret` (`missing_webhook_secret`).
- New wrappers using `razorpayRequest`, each with a typed response:
  - `fetchRazorpayPayment(id)` → `GET /payments/:id`. Fields used: `id, order_id, status, amount, currency,
    amount_refunded, refund_status, invoice_id, captured`.
  - `captureRazorpayPayment({ paymentId, amountMinor, currencyCode })` → `POST /payments/:id/capture`.
  - `fetchRazorpayOrderPayments(orderId)` → `GET /orders/:id/payments` (`{ items }`).
  - `fetchRazorpaySubscriptionInvoices(subscriptionId)` → `GET /invoices?subscription_id=` (`{ items }`). Fields used:
    `id, status, payment_id, billing_start, billing_end, paid_at, amount_paid`.
  - `cancelRazorpaySubscription({ subscriptionId, atCycleEnd })` → `POST /subscriptions/:id/cancel` with
    `cancel_at_cycle_end: 0|1`.
- `createRazorpaySubscription` (`:99-114`): `customer_notify: 1`; accept optional `expireByUnix` and send
  `expire_by` (see decision 5).
- `razorpayRequest` (`:217-222`): stop logging the raw error `body`; log `path`, `status`, `message` only.

**New `lib/billing/razorpay-redact.shared.ts`**
- `redactRazorpayPayload<T>(value: T): T` deep-copies and replaces the keys `email`, `contact`, `vpa`, `card`,
  `bank_account`, `wallet`, `address` (at any depth) with `'[redacted]'`.
- Unit test beside it.

**`lib/billing/razorpay-sync.ts`** — rewrite around three exported functions. Delete the check-then-insert bodies.

- `isUniqueViolation(error)`: `error?.code === '23505'`.

- `settleTopupOrder({ supabase, billingOrderId, paymentIdHint?, source })`
  → `{ state: 'granted' | 'already_granted' | 'pending' | 'failed' | 'refunded', grantedCoins, paymentId }`
  1. Load the order by id; require `order_type = 'topup_checkout'` and `provider_order_id`.
  2. **Pick the payment.**
     - With `paymentIdHint`: `fetchRazorpayPayment`; it must have `order_id === provider_order_id`, otherwise throw
       `payment_order_mismatch`.
     - Without a hint: `fetchRazorpayOrderPayments` and prefer `captured`, then `authorized`.
  3. **Capture if needed.** If `authorized`, call `captureRazorpayPayment` with the order's amount and currency.
     On error, re-fetch the payment. If it is still not `captured`, return `pending` and write nothing.
  4. **Check what was captured.** Require `amount === order.amount_minor` and a case-insensitive currency match,
     otherwise throw `payment_amount_mismatch`. If `amount_refunded >= amount`, set order status `refunded` and
     return `refunded` with no grant.
  5. **Grant.** Beats come from `purchase_snapshot_json.beatAmount`, else the pack's `beat_amount` with
     `snapshotMissing`. Insert into `beat_grants` (`source_type 'topup'`, `source_ref_id = order.id`, metadata
     redacted). On `23505`, result is `already_granted`.
  6. **Record.** Update the order: `status 'paid'` (or keep `refunded` / `partially_refunded` if already set),
     `provider_payment_id`. On `23505` from `uq_billing_orders_provider_payment`, re-read — another path already
     wrote it.
  7. Invalidate the pricing cache for the user and return.

- `syncSubscriptionFromProvider({ supabase, userId, planVersion, providerSubscriptionId, checkoutOrder?, source, rawPayload })`
  → `{ billingSubscriptionId, grantedCoins, firstChargeConfirmed, status }`
  1. **Fetch and check ownership.** `fetchRazorpaySubscription` (authoritative). If `notes.user_id` exists and
     ≠ `userId`, throw `subscription_owner_mismatch`.
  2. **Load the existing row.** If it exists with a different `user_id`, throw `subscription_owner_mismatch`.
     Never update `user_id`.
  3. **Upsert** as today (`:65-110`), plus `provider_mode: getRazorpayMode()` on insert only. Redact
     `rawPayload`.
  4. **Look for the paid invoice.** If `current_start` and `current_end` are set and status is `active`,
     `authenticated`, `pending` or `halted`, call `fetchRazorpaySubscriptionInvoices` and find an invoice with
     `status === 'paid'` and `billing_start <= current_start < billing_end`.
  5. **Grant.** If found:
     - Set `first_charge_confirmed_at = now()` where it is null.
     - Beats come from `checkoutOrder.purchase_snapshot_json.includedBeats` (the checkout order is looked up by
       `provider_checkout_session_id` when not passed), else `planVersion.monthly_included_beats` with
       `snapshotMissing`.
     - If beats > 0, insert the grant (`source_ref_id = <sub_id>:<current_start>`, `expires_at =
       current_end`, metadata includes `invoiceId`, `paymentId`). On `23505`, grant nothing.
  6. Invalidate the cache and return.

- `grantTopupIfMissing` and `syncRazorpaySubscriptionState` are removed; update every import (verify, webhook).

**`lib/pricing/snapshot.ts`** (`:346-375`)
- `isSubscriptionEntitled`: for status `authenticated`, return false unless `first_charge_confirmed_at` is set.
- `isSubscriptionInGracePeriod`: return false unless `first_charge_confirmed_at` is set.
- Add `first_charge_confirmed_at: string | null` and `provider_mode: 'test' | 'live'` to `DbBillingSubscription`,
  and `provider_mode`, `purchase_snapshot_json` to `DbBillingOrder`, in `lib/types/database.ts:715-751`. Add
  `attempt_count`, `last_attempt_at`, `outcome` to `DbBillingWebhookEvent`, and `provider_price_ref_mode` to the
  plan version type.
- There is no snapshot test file today. Export the entitlement check (or the subscription selector that calls it)
  and add `lib/pricing/snapshot.test.ts`; fix any other test fixture typed `DbBillingSubscription` that `tsc` flags.

### Unit B — checkout, verify, webhook, reconcile

**`app/actions/pricing-checkout.ts`**
- **Kill switch.** At the top of `prepareRazorpayCheckoutInternal` (`:34`), before any provider call:
  `if (!(await getFeatureFlag('pricing_checkout_enabled', false))) throw new Error('Checkout is currently unavailable')`.
- **Subscription branch** (`:37-109`). Keep the plan/market/annual checks, then:
  1. Build `snapshot = { kind: 'subscription', planVersionId, planKey, planName, interval, amountMinor,
     currencyCode, includedBeats: version.monthly_included_beats, pricingMarketKey, providerMode }`.
  2. Replace the query at `:50-65` with the RPC `billing_begin_subscription_checkout(userId, version.id,
     getRazorpayMode(), snapshot)`. Map the result:
     - `blocked_reason 'subscription_exists'` → throw today's message.
     - `'checkout_in_progress'` → throw `'A checkout is already opening in another tab'` (maps to 409).
     - `reused` → return the prepared checkout using `provider_checkout_session_id`, with no new Razorpay calls.
  3. For each `superseded_session_ids`, call `cancelRazorpaySubscription({ atCycleEnd: false })` inside a
     try/catch that logs the error and continues.
  4. `ensureRazorpayPlanRef`, then `createRazorpaySubscription({ expireByUnix: now + 30 min, notes })`.
  5. Update the order created by the RPC: `provider_checkout_session_id`, `status: subscription.status`,
     `raw_provider_payload_json` (redacted).
  6. If the Razorpay call throws, update the order to `status 'failed'` before rethrowing.
- **Top-up branch** (`:111-161`). Insert `provider_mode` and `purchase_snapshot_json = { kind: 'topup',
  topupPackId, packKey, packName, beatAmount, amountMinor, currencyCode, pricingMarketKey, providerMode }`.
  Redact the stored order payload.
- **`ensureRazorpayPlanRef`** (`:272-306`):
  - Reuse only when `provider_price_ref && provider_price_ref_mode === mode`.
  - Otherwise create the plan, then run a conditional update with
    `.or(\`provider_price_ref_mode.is.null,provider_price_ref_mode.neq.${mode}\`)` that also sets
    `provider_price_ref_mode`.
  - Re-select the version and return its stored `provider_price_ref`. A losing concurrent request leaves one
    orphan Razorpay plan, which is harmless.

**`app/api/billing/razorpay/prepare/route.ts`** (`:26-31`): map `'currently unavailable'` → 503 and
`'already opening'` → 409.

**`app/api/billing/razorpay/verify/route.ts`**
- **Subscription branch.**
  1. If `body.razorpaySubscriptionId` is present and ≠ `billingOrder.provider_checkout_session_id`, return 400
     `'Subscription does not match this checkout'`.
  2. Keep the signature check (`:59-67`).
  3. Call `syncSubscriptionFromProvider` with the stored ID and `checkoutOrder: billingOrder`.
  4. Update the order status to the fetched subscription status (redacted payload, and never store `body` beyond
     the payment id).
  5. Messages:
     - coins granted → as today;
     - `firstChargeConfirmed` without coins (e.g. a zero-coin plan) → `'Your plan is active.'`;
     - otherwise → `'Payment received. We're confirming it with your bank — your plan and coins will appear
       shortly.'`
- **Top-up branch.** Keep the signature check, then call `settleTopupOrder({ billingOrderId, paymentIdHint:
  body.razorpayPaymentId, source: 'verify' })`. Remove the direct `status: 'paid'` update. Messages by state:
  - `granted` / `already_granted` → as today;
  - `pending` → `'Payment received. We're confirming it — coins will appear shortly.'` (still 200);
  - `refunded` → 409 `'This payment was refunded.'`
- **Errors.** In `catch`, log `[razorpay.verify]` with the message and return a generic `'We couldn't confirm this
  payment yet. If you were charged, it will be applied automatically.'`. No raw provider message goes to the client.

**Move webhook processing to `lib/billing/razorpay-webhook.ts`** so reconcile can reuse it:
- `processRazorpayWebhookEvent({ supabase, payload }) → { status: 'processed' | 'ignored', outcome, relatedUserId,
  relatedSubscriptionId }`.
- **Subscription entity present** (any `subscription.*` event, or `payment.*` carrying one): resolve user and plan
  version as today (`webhook/route.ts:116-143`), call `syncSubscriptionFromProvider`, update the checkout order
  status.
  - outcome `cycle_granted` if coins were granted, else `subscription_synced`;
  - no user/plan found → `ignored` / `no_matching_subscription`.
- **`payment.captured` / `order.paid`** with an order id that matches a `topup_checkout` order → `settleTopupOrder`.
  Outcome: `topup_granted`, `topup_already_granted` or `topup_pending`. No match → `ignored` / `no_matching_order`.
- **`payment.failed`** → matched top-up order to `failed` unless `paid` → `payment_failed_recorded`.
- **`refund.created` / `refund.processed` / `refund.failed`:**
  1. Payment id comes from `payload.refund.entity.payment_id`.
  2. `fetchRazorpayPayment` for `amount_refunded`.
  3. Order matched by `provider_payment_id` → status `refunded` if `amount_refunded >= amount`, otherwise
     `partially_refunded` (skip on `refund.failed`) → `refund_recorded`.
  4. No match → `processed` / `refund_unmatched`.
- **`payment.dispute.*`:** payment id from `payload.dispute.entity.payment_id`; matched order status `disputed` →
  `dispute_recorded`; else `dispute_unmatched`.
- **Anything else** → `ignored` / `unhandled_event_type`.

**`app/api/billing/razorpay/webhook/route.ts`**
1. Wrap signature verification in try/catch. On `RazorpayConfigError`, log
   `console.error('[razorpay.webhook] config_error', { reason })` and return 500.
2. **Existing event:**
   - `processed` / `ignored` → `{ ok: true, duplicate: true }`.
   - `received` and `received_at` within 5 minutes → same duplicate response.
   - otherwise update `status 'received'`, `attempt_count + 1`, `last_attempt_at now()`, `error_message null`, and
     reprocess that row.
3. **New event:** insert with the **redacted** payload and `last_attempt_at`.
4. Call `processRazorpayWebhookEvent`, store `status`, `outcome`, related ids.
5. **Failure:** `status 'failed'`, `error_message` truncated to 500 chars, 500 response.
6. A unique violation on the insert (concurrent first delivery) → duplicate response.

**New `lib/billing/razorpay-reconcile.ts`** — `reconcileRazorpayBilling(): Promise<{ checkouts, subscriptions,
topups, webhooks }>`.
- **Gating.** Returns zeros unless `getFeatureFlag('billing_reconcile_enabled', false)`. Resolves `mode =
  getRazorpayMode()`; on `RazorpayConfigError`, logs and returns zeros. Every query filters `provider_mode = mode`.
- **Budget.** Stops starting new work after 45 s. Each item runs in its own try/catch so one failure never stops the
  batch.

1. **Subscription checkouts:** `billing_orders` with `order_type 'subscription_checkout'`, status `created`,
   `provider_checkout_session_id` not null, created between 10 min and 7 days ago (limit 50). Fetch the
   subscription; if it is no longer `created`, sync it.
2. **Subscriptions:** status in (`authenticated`, `active`, `pending`, `halted`) where `first_charge_confirmed_at is
   null` or `current_period_end < now()` or `last_webhook_at < now() - interval '2 days'` (limit 100). Sync using the
   row's user and plan version.
3. **Top-ups:** `topup_checkout` orders with status in (`created`, `attempted`, `failed`) created within 7 days and
   older than 10 min (limit 50) → `settleTopupOrder` without a hint. Orders older than 7 days still `created` with no
   payment → `abandoned`.
4. **Webhooks:** `billing_webhook_events` with `provider 'razorpay'` and (`status 'failed' and attempt_count < 10`)
   or (`status 'received' and received_at < now() - 15 min`) (limit 50). Reprocess from the stored payload with the
   same bookkeeping as the route. Payloads are redacted, but processing only needs ids.

**`app/api/batch/reconcile/route.ts`** (`:63-87`): add `reconcileRazorpayBilling().catch(...)` to the `Promise.all`
with a zero-result fallback, and add `billingReconcile` to the JSON response.

## 5. Tests (Vitest, mocked Supabase + Razorpay, following `app/actions/pricing-enforcement.test.ts`)

| File | Cases |
|---|---|
| `lib/billing/razorpay-mode.test.ts` (or in a razorpay test) | test/live prefixes; unknown prefix throws config error |
| `lib/billing/razorpay-redact.shared.test.ts` | nested PII keys redacted; ids kept |
| `lib/billing/razorpay-sync.test.ts` | top-up captured → one grant; grant insert `23505` → `already_granted` (verify + webhook race); authorized → capture → grant; capture fails and still authorized → `pending`, no insert; hint payment for another order → throws; amount mismatch → throws; fully refunded → no grant; snapshot beats used over a changed catalog; subscription `authenticated` without paid invoice → no grant, not confirmed; paid invoice → grant + `first_charge_confirmed_at`; renewal (new `current_start`) → second grant once; existing row with other user → throws, no update; `notes.user_id` mismatch → throws |
| `lib/pricing/snapshot` tests | `authenticated` without confirmation not entitled; with confirmation entitled; grace ignored without confirmation |
| `app/api/billing/razorpay/webhook/route.test.ts` | bad signature 400; missing secret → 500 + config log, no DB write; new event processed with outcome; processed duplicate no-op; failed event re-delivered → reprocessed, `attempt_count` 2, single grant; recent `received` → duplicate; refund event marks order; dispute marks order; unknown event ignored with outcome |
| `app/api/billing/razorpay/verify/route.test.ts` | client subscription id ≠ stored → 400 and no Razorpay fetch; top-up pending → 200 with confirming message; provider error → generic message |
| `app/actions/pricing-checkout.test.ts` | flag off → throws before any Razorpay call; RPC `subscription_exists` / `checkout_in_progress`; reused checkout makes no Razorpay calls; superseded ids cancelled; plan ref with other mode → new plan created; Razorpay failure marks order failed |
| `lib/billing/razorpay-reconcile.test.ts` | flag off → zeros; missed webhook top-up captured → granted; stuck failed webhook reprocessed; rows of other mode untouched |

Gates: `npx tsc --noEmit`, `npm run lint`, `npm test` (full suite).

## 6. Verification on dev (after the owner applies 124)

**Database**
1. Precheck query from the migration header returns no rows (before applying).
2. `select indexname from pg_indexes where indexname = 'uq_beat_grants_purchase_source'` → 1 row.
3. In a transaction that is rolled back, insert two `topup` grants with the same `source_ref_id` → the second
   fails with `23505`.
4. `select provider_mode, count(*) from billing_orders group by 1` → all `test`.

**Razorpay sandbox runbook** (owner, test keys, dev deployment URL — manual steps)
1. Register the test webhook at
   `https://kissago-git-payments-rajeevscorpions-projects.vercel.app/api/billing/razorpay/webhook` (the `payments`
   branch's Vercel Preview, which uses the dev database) with the events listed in `research/06` §webhooks,
   including `refund.*` and `payment.dispute.*`. Set `RAZORPAY_WEBHOOK_SECRET` in the Vercel **Preview** env scope
   before pushing, or redeploy after.
2. Turn on `pricing_checkout_enabled` and `billing_reconcile_enabled` on dev.
3. **Top-up:** pay by test card. Expect one grant, order `paid`, a webhook event `processed/topup_already_granted`
   or `topup_granted`, and no second grant. Check about 30 s after paying (newest top-up order, its grants, and the
   webhook events that mention it):
   ```sql
   with o as (
     select id, status, provider_mode, provider_order_id, created_at from billing_orders
     where order_type = 'topup_checkout' order by created_at desc limit 1
   )
   select 'order' as what, o.status::text as status, o.provider_mode as detail, o.created_at as at from o
   union all
   select 'grant', g.source_type::text, g.beats_total || ' beats', g.granted_at
   from beat_grants g join o on g.source_ref_id = o.id::text
   union all
   select 'webhook ' || e.event_type, e.status::text,
          coalesce(e.outcome, '-') || ', attempts ' || e.attempt_count, e.received_at
   from billing_webhook_events e join o on e.payload_json::text like '%' || o.provider_order_id || '%'
   order by at;
   ```
   No webhook rows at all means the webhook is missing, in the wrong Razorpay mode, or its secret doesn't match
   Vercel's.
4. **Subscription (card):** expect coins only once the invoice is paid, `first_charge_confirmed_at` set, and one
   grant after both verify and webhook.
5. **Subscription (UPI Autopay test flow):** record what Razorpay does at authentication (amount, invoice status).
   Coins must not appear before a paid invoice. Write the finding into `research/06` Q1.
6. **Double click / second tab on subscribe:** the same Razorpay subscription is returned.
7. **Turn `pricing_checkout_enabled` off, wait 60 s,** then POST to `/api/billing/razorpay/prepare` directly →
   503.
8. **Refund the top-up from the Razorpay test dashboard:** order becomes `refunded`, event outcome
   `refund_recorded`.
9. **Missed webhook:** temporarily unset the webhook URL, buy a top-up and close the tab before verify, then call
   the reconcile route with `CRON_SECRET`. Expect exactly one grant.

## 7. Rollback and disable

- **Stop new money:** `pricing_checkout_enabled` off (server-enforced, ≤ 60 s).
- **Stop background recovery:** `billing_reconcile_enabled` off.
- **Code rollback:** revert the Phase 1 commits. Migration 124 is additive, and the old code ignores the new
  columns. The rollback SQL exists but should not be run after live payments (see its header).

## 8. Execution units (max 2 agents at once; commit per unit)

1. **Unit A** — §4 Unit A + its tests + migration 124 files. Commit. **Done: `1392121`, reviewed by Opus.**
2. **Unit B** — §4 Unit B + its tests. Commit. **The owner applies 124 on dev only after Unit B**: before it, the
   old checkout insert has no `provider_mode`, and 124 makes that column NOT NULL without a default.
3. **Opus review** of both diffs (not the reports), then sandbox runbook §6 with the owner, then update
   `audit-progress.md` and PROJECT_STATE's migration ledger row for 124.

### What landed (2026-09-17)

- **Unit B `fabea84`.** Also moved the admin manual-recovery actions in `lib/pricing/enforcement.ts` onto the new
  core; they now also require confirmed money before granting.
- **Opus review fixes** (committed after Unit B):
  - Migration 124's RPC reuses an open checkout only within 20 minutes of its creation (Razorpay's `expire_by`
    is 30), and releases a stuck `preparing` row after 2 minutes.
  - A subscription sync never overwrites a checkout order already marked `refunded`, `partially_refunded` or
    `disputed`.
  - Renewal payments no longer replace the checkout order's first payment id.
  - Reconcile also rechecks `abandoned`/`superseded` checkouts, and closes them as `expired`/`cancelled` when
    Razorpay confirms nothing was paid.
- **Gates:** `tsc` clean, eslint clean, full suite 1,510 passed.
- **Not done yet:** migration 124 on dev, sandbox runbook §6.

Units A and B touch the same files' imports, so they run **sequentially**, not in parallel.
