# Razorpay Stage Rollout Runbook

Date: 2026-04-07
Branch: `pricing`
Environment target: `kissagoStage`
Goal: fully test the India-only Razorpay pricing flow end to end without affecting production.

## Guardrails

- Keep production pricing flags off.
- Use Razorpay test mode only.
- Use `kissagoStage` env values in `.env.local`.
- Do not publish India yearly plan variants for this rollout.
- Only `start story` and first-time `continue story` should spend coins in this phase.
- Image and narration regeneration stay free.

## Before You Start

1. Confirm local env includes:
   - `NEXT_PUBLIC_SUPABASE_URL` for `kissagoStage`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` for `kissagoStage`
   - `SUPABASE_SERVICE_ROLE_KEY` for `kissagoStage`
   - `ADMIN_USER_ID` for your stage admin account
   - `RAZORPAY_KEY_ID`
   - `RAZORPAY_KEY_SECRET`
   - `RAZORPAY_WEBHOOK_SECRET`
2. Restart the dev server after env changes.
3. In Razorpay test mode, configure a webhook to your public stage URL or local tunnel:
   - `/api/billing/razorpay/webhook`
4. Run this migration manually on `kissagoStage`:
   - `supabase/migrations/021_pricing_enforcement_primitives.sql`

## Stage Catalog Setup

Use `/admin/pricing` as the stage admin.

### India plans

Publish only these paid variants with non-zero test prices:

- `Plus` monthly
- `Studio` monthly

Keep these unpublished:

- `Plus` yearly
- `Studio` yearly

Recommended test-mode seed values:

- `Plus` monthly: `₹99` -> `price_minor = 9900`
- `Studio` monthly: `₹249` -> `price_minor = 24900`

### India top-ups

Publish all India coin packs with non-zero test prices:

- `250 Coins`
- `800 Coins`
- `2,000 Coins`

Recommended test-mode seed values:

- `250 Coins`: `₹39` -> `price_minor = 3900`
- `800 Coins`: `₹99` -> `price_minor = 9900`
- `2,000 Coins`: `₹199` -> `price_minor = 19900`

## Flag Rollout Order

Turn these on in this exact order from `/admin/pricing`:

1. `Show Live Pricing Info`
2. `Allow Checkout`
3. `Use Plan-Based Story Length Limits`
4. `Let Stage Admin Skip Coin Checks`
5. `Track Coin Use Quietly`

Validate behavior at this point before turning on hard enforcement.

Then turn on:

6. `Require Coins To Continue`

## User Types To Test

Create and use three stage accounts:

1. Stage admin
2. New free non-admin user
3. Paid non-admin user after Razorpay checkout

## Test Sequence

### Test 1: Free user gets a real monthly refill

1. Sign in as a fresh non-admin user.
2. Open `/wallet`.
3. Switch market to `India`.

Expected:

- Wallet shows real free-plan coins, not just a preview.
- Recent activity shows `Free monthly refill`.
- The refill amount matches the published free plan.
- Reopening `/wallet` does not add a second refill in the same cycle.

### Test 2: Free user story-length limit

1. Open the landing screen.
2. Expand `Advanced Options`.
3. Try to increase story length beyond the free cap.

Expected:

- Slider stops at the plan limit.
- Upgrade message is visible.

### Test 3: Free user top-up checkout

1. Stay signed in as the free non-admin user.
2. Open `/wallet`.
3. Choose `India`.
4. Buy the smallest coin pack.

Expected:

- Razorpay test checkout opens.
- On success, wallet refreshes.
- `beat_grants` gets a new `topup` row.
- Recent activity shows a top-up entry.
- Replaying verify/webhook should not double-grant coins.

### Test 4: Monthly subscription checkout

1. Still as a free non-admin user, open `/wallet`.
2. Choose `India`.
3. Subscribe to `Plus` monthly.

Expected:

- Razorpay subscription checkout opens.
- On success, wallet refreshes.
- `billing_orders` row is created/updated.
- `billing_subscriptions` row is active or authenticated.
- Initial subscription refill is granted once.
- Wallet plan changes from `Free` to `Plus`.

### Test 5: Hard enforcement on start story

1. With `Require Coins To Continue` on, sign in as a non-admin user with enough coins.
2. Start a new story.

Expected:

- Story succeeds.
- `beat_usage_events` gets one row for `start_story_initial_beat`.
- Matching `beat_usage_allocations` exist.
- Wallet activity shows `Started a story`.

### Test 6: Hard enforcement on continue story

1. Continue from a beat using a brand-new branch.

Expected:

- New branch creation spends coins once.
- `continue_story_new_beat` usage is recorded.

2. Reopen an already explored branch.

Expected:

- No spend occurs.
- No new usage event is created.

### Test 7: Failure releases held coins

1. Force a failed generation during `start story` or `continue story`.
2. Return to `/wallet`.

Expected:

- No usage event is finalized.
- Temporary reservation is released or later expired.
- Wallet balance does not permanently drop.

### Test 8: Signed-out gating

1. Sign out.
2. Try to start a story while hard enforcement is on.

Expected:

- User is prompted to sign in.
- No spend reservation is finalized.

### Test 9: Admin bypass

1. Sign in as the configured stage admin.
2. Keep `Let Stage Admin Skip Coin Checks` on.
3. Start and continue stories.

Expected:

- Admin can keep testing even if wallet state is insufficient.
- Normal non-admin users remain enforced.

### Test 10: Recovery tools

Use `/admin/pricing` recovery tools to validate:

- `Refresh subscription`
- `Add missing coins`
- `Refresh free refill`
- `Release old holds`

Expected:

- Each tool returns a clear success message.
- No direct SQL edits are needed for routine stage recovery.

## Database Checks

Useful stage queries:

```sql
select id, user_id, source_type, beats_total, beats_remaining, expires_at, granted_at
from beat_grants
order by granted_at desc;
```

```sql
select id, user_id, action_key, requested_beat_cost, status, idempotency_key, created_at, expires_at
from beat_spend_reservations
order by created_at desc;
```

```sql
select id, user_id, action_key, beat_cost, created_at
from beat_usage_events
order by created_at desc;
```

```sql
select id, user_id, provider, order_type, status, provider_order_id, provider_checkout_session_id, provider_payment_id, created_at
from billing_orders
order by created_at desc;
```

```sql
select id, user_id, provider, provider_subscription_id, status, current_period_starts_at, current_period_ends_at, created_at
from billing_subscriptions
order by created_at desc;
```

## Production Hold

Do not copy these flags to production yet:

- `Allow Checkout`
- `Track Coin Use Quietly`
- `Require Coins To Continue`
- `Let Stage Admin Skip Coin Checks`

Production stays safe until stage signoff is complete.
