# 11 — Razorpay cycle-end cancel probe (Phase 5 Unit 0)

**Run 2026-09-26** on the `payments` Preview, Razorpay test mode, as `testuser`.

## What was done

1. Subscribed to Audience monthly (₹236, INR plan `plan_TfC9TZGLwvhHKK`) with the international test card
   `5104 0600 0000 0008`. Subscription `sub_TgNsjQ1NgKLjNy`.
2. Cancelled it from **Billing** in the app, which calls Razorpay's cancel with `cancel_at_cycle_end = 1`
   (19:26:45 UTC).
3. Watched `billing_webhook_events`, ran the daily reconcile by hand, and read the subscription back from
   Razorpay's API (`GET /v1/subscriptions/sub_TgNsjQ1NgKLjNy`, 19:3x UTC).

The same pattern was seen once before, on the Phase 8 walk's USD subscription (`sub_TgM4RjDskWb52c`,
2026-09-25).

## The entity after a cycle-end cancel

`plan` and `customer_contact` are left out.

```json
{
  "id": "sub_TgNsjQ1NgKLjNy",
  "entity": "subscription",
  "plan_id": "plan_TfC9TZGLwvhHKK",
  "customer_id": null,
  "status": "active",
  "current_start": 1790364328,
  "current_end": 1792953000,
  "ended_at": null,
  "quantity": 1,
  "charge_at": 1792953000,
  "start_at": 1790364328,
  "end_at": 4943356200,
  "auth_attempts": 0,
  "total_count": 1200,
  "paid_count": 1,
  "customer_notify": false,
  "created_at": 1790364300,
  "expire_by": 1790366098,
  "has_scheduled_changes": false,
  "change_scheduled_at": null,
  "source": "api",
  "payment_method": "card",
  "offer_id": null,
  "halted_at": null,
  "remaining_count": 1199
}
```

## Findings

1. **Nothing in the entity marks the scheduled cancel.** `status` stays `active`, `has_scheduled_changes` is
   `false`, `change_scheduled_at` and `ended_at` are `null`, and `charge_at` still shows the next charge
   date. A scheduled cancel looks exactly like a subscription that will renew.
2. **No webhook fires when the cancel is scheduled.** Both probes: the next event after the cancel was the
   one that ended the subscription.
3. **So `cancel_at_period_end` can only come from our own actions** (the customer's cancel and the admin
   "Cancel at cycle end"). A cancel made in the Razorpay dashboard shows as "Renews on" in the app until the
   period ends, when the `subscription.cancelled` webhook or the reconcile catches it. This is the gap
   `phase-5-plan.md` Unit 0 anticipated.
4. **The daily reconcile leaves a scheduled cancel alone.** It only picks subscriptions near a period
   boundary, so "Cancels on <date>" survived a hand-run reconcile (runbook §1.1: done).
5. **No undo.** Razorpay's "Cancel an Update" API revokes a pending *update* (`has_scheduled_changes`), and a
   cycle-end cancel doesn't register as one. There's no documented way to revoke it
   ([Cancel a Subscription](https://razorpay.com/docs/api/payments/subscriptions/cancel-subscription/),
   [Cancel an Update](https://razorpay.com/docs/api/payments/subscriptions/cancel-update/), read
   2026-09-26). Phase 5's "no resume; subscribe again after the date" stands.

## Not yet seen

That Razorpay actually stops at `current_end` and doesn't charge on `charge_at`. That needs the period to
run out (a month in test mode). The walk's subscription was refunded, which ends it at once, so this one
can't show it either.
