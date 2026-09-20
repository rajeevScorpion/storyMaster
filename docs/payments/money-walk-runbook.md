# The money walk — end-to-end runbook

**Purpose:** put real payment, refund and webhook rows into the dev database by actually spending
money through the product, so the billing ledger and every Phase 4 admin surface are verified against
real rows instead of against query shape and unit tests.

**Why it matters more than it sounds:** `billing_payments` has **0 rows on dev**. Nothing has ever
exercised the Phase 2 ledger. Every panel built in Phase 4 renders correctly-shaped emptiness today,
and "it rendered without crashing" is not evidence it renders the *right* thing. This walk is the
only thing that converts the whole payments project from "correct by construction" to "seen working".

**Who runs it:** the owner. It needs a real card and a Razorpay dashboard login, so it cannot be
delegated to an agent.

**Roughly:** 45–70 minutes, most of it waiting on webhooks.

---

## 0. Before you start

### 0.1 Which environment

Run this on a **Preview deployment**, never locally and never on production.

- Preview URL: `https://kissago-git-<branch>-rajeevscorpions-projects.vercel.app`
- Preview uses **Preview-scoped env vars** and the **dev database** — which is what you want.
- Preview addresses are public with no Vercel login in front, so **Razorpay's webhooks can reach
  them directly.** This is the whole reason not to do this on localhost: on localhost no webhook
  ever arrives, and the webhook is the half that has never been tested.

Push the `payments` branch so it has a Preview deployment, and note the URL.

### 0.2 Use Razorpay TEST mode

Use **test keys**, not live. Razorpay's test cards produce real payment objects, real invoices and
real webhooks — everything this walk is verifying — without real money.

Confirm the Preview environment's Razorpay env vars are the **test** ones before you begin. A changed
env var only reaches new builds, so if you change anything, redeploy before starting.

### 0.3 The switches

| Flag | Where | Set to |
|---|---|---|
| `pricing_checkout_enabled` | `/admin/pricing/runtime-controls` | **on** (checkout refuses otherwise) |
| `billing_reconcile_enabled` | `/admin/settings/billing-operations` | **on** (so step 6 works) |
| `billing_document_issuing_enabled` | same | **off** — document issuing is Phase 6 |
| `billing_admin_actions_enabled` | same | **off for now.** Only turn it on at step 7, and only if migration 132 is applied |

### 0.4 Prerequisites

- **Migration 132 applied on dev** if you intend to do step 7 (the in-app refund). If it is not
  applied, skip step 7 and refund from the Razorpay dashboard instead (step 5) — that still produces
  the webhook and the ledger row, which is most of the value.
- A throwaway account you are willing to delete, if you also want to close the deletion test in §8.
- The Razorpay dashboard open in another tab, on **Test mode**.

### 0.5 Write down the baseline

Before spending anything, record the current counts so you can tell what the walk actually created:

```sql
select
  (select count(*) from billing_orders)         as orders,
  (select count(*) from billing_payments)       as payments,
  (select count(*) from billing_refunds)        as refunds,
  (select count(*) from billing_subscriptions)  as subscriptions,
  (select count(*) from billing_webhook_events) as webhook_events,
  (select count(*) from beat_grants)            as grants;
```

Expected today: orders 17, payments **0**, refunds 0, subscriptions 1, webhook_events 3, grants 10.

---

## 1. Buy a top-up

This is the simplest money path and the one most likely to just work.

1. Sign in on the Preview as a normal (non-admin) test user.
2. Go to `/wallet`.
3. Note the coin balance and the displayed price **before** you click.
4. Buy the smallest top-up pack. Razorpay's checkout opens.
5. Pay with a Razorpay **test card** (from their test card list — any success card).

### What to check immediately, in the UI

- [ ] The amount Razorpay asked for is **price + GST**, not the bare price. Prices are GST-exclusive
      (owner decision 8), so a ₹450 pack should charge about ₹531 at 18%.
- [ ] Coins arrived in the wallet, and the increase matches the pack.

### What to check in the database

```sql
select id, order_type, status, amount_minor, provider_mode, created_at
from billing_orders order by created_at desc limit 3;

select id, kind, status, net_minor, tax_minor, gross_minor, method_category, captured_at
from billing_payments order by created_at desc limit 3;

select id, source_type, source_ref_id, beats_total, beats_remaining, expires_at
from beat_grants order by granted_at desc limit 3;
```

- [ ] **`billing_payments` has its first row ever.** This is the single most important line in the
      whole runbook.
- [ ] `net_minor + tax_minor = gross_minor`, and `gross_minor` matches what you were charged.
- [ ] The `beat_grants` row has `source_type = 'topup'` and **`expires_at` is null** — top-up coins
      never expire, by design.
- [ ] `provider_mode` is `test`.

**If `billing_payments` is still empty but coins arrived:** the browser verify call granted the coins
and the ledger write did not happen. That is a real finding — record it and do not paper over it.

---

## 2. Confirm the webhook actually arrived

This is the part that has never been proven end to end. The browser's verify call and the webhook
both credit, and until now only the verify call has ever run.

```sql
select id, event_type, status, outcome, attempt_count, received_at, error_message
from billing_webhook_events order by received_at desc limit 10;
```

- [ ] New rows appeared **beyond the baseline 3**.
- [ ] Their `status` is `processed`, not `failed` or stuck at `received`.
- [ ] `error_message` is null.

Cross-check against Razorpay: **Dashboard → Settings → Webhooks → your endpoint → recent deliveries.**
Razorpay shows its own delivery log with response codes.

- [ ] Razorpay reports **2xx** for each delivery.

**If Razorpay shows deliveries but our table is empty:** the webhook URL or the signing secret is
wrong for this environment. **If Razorpay shows no deliveries at all:** the webhook is not configured
to point at this Preview URL.

- [ ] **No double credit.** The verify call and the webhook both grant; migration 124's
      `uq_beat_grants_purchase_source` is what stops two grants for one purchase. Confirm the user's
      coin balance increased by **one** pack, not two, and that `beat_grants` has one new row, not two.

---

## 3. Check it through the new admin panel

Now use the thing Phase 4 built, as a support person would.

1. Sign in as the admin account.
2. Go to `/admin/users`, find the test user, open their record.
3. Scroll to **Billing**.

- [ ] **Payments** now shows the real payment, with the right gross and method.
- [ ] **Orders** shows the order.
- [ ] **Webhook events** shows the events from step 2.
- [ ] No amber **plan key disagreement** banner (there should be none — a top-up is not a plan).
- [ ] Sections that should be empty say so honestly: Refunds, Documents ("document issuing ships in a
      later phase"), Billing profile.

This is the acceptance test for the whole phase: **could you have answered "did this person's payment
go through, and what were they charged" without writing SQL?**

---

## 4. Subscribe

1. As the same test user, buy the cheapest **monthly** subscription.
2. Pay with a test card.

- [ ] Charged price + GST again.
- [ ] Subscription coins arrived.

```sql
select id, status, billing_interval, current_period_start, current_period_end,
       first_charge_confirmed_at, cancel_at_period_end, provider_mode
from billing_subscriptions order by created_at desc limit 3;

select id, source_type, beats_total, expires_at from beat_grants order by granted_at desc limit 3;
```

- [ ] `first_charge_confirmed_at` is **set**. If it is null, the subscription was authorised but its
      first invoice was never confirmed paid — that is exactly the state the reconcile cron exists to
      fix, and step 6 will test it.
- [ ] The subscription's `beat_grants` row **has an `expires_at`** (cycle end) — unlike the top-up's.
- [ ] In the admin panel, the user's plan now shows the subscribed tier, and **no plan-key
      disagreement banner** appears. If one does appear, that is a genuine finding: the directory RPC
      and `billing_subscriptions` disagree, and the panel is doing its job.

---

## 5. Refund from the Razorpay dashboard

Do this one **from Razorpay**, not from the app. It tests the inbound path: a refund we did not
initiate must still land correctly in our ledger.

1. Razorpay Dashboard → Transactions → Payments → find the **top-up** payment from step 1.
2. Issue a **full refund**.
3. Wait for the webhook (usually seconds; give it a couple of minutes).

```sql
select id, payment_id, provider_refund_id, amount_minor, net_minor, tax_minor,
       status, initiated_by, processed_at
from billing_refunds order by created_at desc limit 3;

select id, status from billing_payments order by created_at desc limit 3;
```

- [ ] A `billing_refunds` row exists.
- [ ] Its `amount_minor` **matches the payment's `gross_minor`** — the full amount including GST.
- [ ] `net_minor + tax_minor = amount_minor` — the tax was reversed too, not just the base price.
- [ ] `initiated_by` is `provider` (or `admin`) — **not** `dispute`.
- [ ] The payment's status reflects the refund.
- [ ] The admin panel's **Refunds & disputes** section now shows it.

**Known and expected:** the coins are **not** clawed back by this path. A dashboard refund is not our
refund action, and decision 12's clawback only runs through the in-app action in step 7. Note the
user's balance now — they have coins from a purchase that was refunded. That is the gap step 7 closes,
and it is worth seeing once with your own eyes.

---

## 6. Test the reconcile backstop

The daily cron is the safety net for every missed webhook. Vercel only runs crons on Production, so
on a Preview you trigger it by hand.

```bash
curl -X POST "https://kissago-git-<branch>-rajeevscorpions-projects.vercel.app/api/batch/reconcile" \
  -H "Authorization: Bearer $CRON_SECRET"
```

- [ ] It returns 200 with counts, and does not error.
- [ ] Run it **twice.** The second run must not double-grant coins or create duplicate rows. This is
      the idempotency check that matters most.
- [ ] Check `/admin/pricing/billing-incidents` — the new incident dashboard. After a clean walk it
      should read **Healthy** across the board. If it flags something, that is the dashboard working.

---

## 7. Refund through the app — only if migration 132 is applied

**Skip this step entirely if 132 is not applied on dev.** Without it the refund action refuses, by
design, rather than refunding money it cannot claw back.

**Note:** Unit C's browser UI is **not built yet**, so there is no button for this today. This step
becomes runnable once that UI ships. Recorded here so the runbook is complete.

When it is runnable:

1. Turn `billing_admin_actions_enabled` **on** at `/admin/settings/billing-operations`.
2. From the test user's admin record, refund the **subscription** payment from step 4.
3. Give a reason of at least a few words.

- [ ] It **refuses** if more than ~20% of that purchase's coins have been spent (decision 12). To test
      the refusal deliberately, spend a few coins first and try again.
- [ ] On success: money refunded **and** the unspent coins clawed back — check `beat_grants`
      `beats_remaining` dropped.
- [ ] An `admin_user_audit_events` row exists with `action_type = 'payment_refunded'`, plus one with
      `coins_clawed_back`.
- [ ] Pressing the button twice with the same request does **not** refund twice.
- [ ] **Turn the flag back off when you are done.**

---

## 8. Optional: the account-deletion test

Still outstanding from Phase 2 §6. Needs a throwaway account that has made a purchase.

1. Turn on `account_deletion_enabled`.
2. As the throwaway user, delete the account from `/account/delete`.

```sql
select id, user_id, subject_ref, gross_minor from billing_payments where subject_ref = '<the user id>';
```

- [ ] The billing rows **survive** with `user_id` null and `subject_ref` still populated — that is the
      8-year retention design (decisions 6 and 9).
- [ ] Their published stories are still in the gallery, under the same author name (decision 10).
- [ ] Turn the flag back off.

---

## 9. When you're done — what to report back

Paste the final counts:

```sql
select
  (select count(*) from billing_orders)         as orders,
  (select count(*) from billing_payments)       as payments,
  (select count(*) from billing_refunds)        as refunds,
  (select count(*) from billing_subscriptions)  as subscriptions,
  (select count(*) from billing_webhook_events) as webhook_events,
  (select count(*) from billing_webhook_events where status = 'failed') as failed_webhooks;
```

And say, in whatever form is easiest:

1. Which steps passed and which failed.
2. **Any checkbox above that did not hold** — those are the real output of this exercise. A walk that
   finds two defects is a better walk than one that finds none.
3. Whether anything in the admin panel showed something you knew to be wrong.
4. Whether you had to write any SQL to answer a question the panel should have answered. That is the
   phase's actual acceptance test.

---

## 10. If something goes wrong mid-walk

- **Stop new checkouts:** turn `pricing_checkout_enabled` **off**. Server-enforced within 60s. It
  blocks *new* checkouts only — verify, webhook and reconcile keep honouring payments already started,
  which is deliberate.
- **Stop the backstop:** turn `billing_reconcile_enabled` off.
- **Stop admin money actions:** turn `billing_admin_actions_enabled` off.
- Nothing here touches production. The dev database is safe to leave in a messy state — the rows this
  walk creates are *wanted*, and the Phase 4 panels are better tested with a few odd rows in them.
