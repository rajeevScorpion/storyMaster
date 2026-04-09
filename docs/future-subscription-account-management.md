# Future Subscription Account Management

This note captures the current limitation in the Razorpay rollout and the intended follow-up work.

## Current behavior

- A user can start their first Razorpay subscription.
- A user can buy top-up coin packs.
- A user cannot self-serve switch from one active Razorpay subscription plan to another.
- If a user already has a Razorpay subscription in a live or in-progress state, checkout blocks a second subscription and shows:
  - `You already have a Razorpay subscription in progress. Subscription changes will stay manual until account management is live.`

This guard is intentional in the current implementation and lives in the subscription checkout path.

## Why it is blocked today

We have not yet implemented subscription account-management rules for:

- immediate upgrade from `Plus` to `Studio`
- downgrade scheduling
- cancellation and replacement flows
- proration or billing-credit handling
- remaining subscription-coin carryover behavior during plan changes
- user-facing subscription management UI

## Proposed future rule set

Recommended default behavior:

- `Upgrade`
  - applies immediately
  - keeps already granted leftover coins in the wallet
  - future monthly refills come from the new plan
- `Downgrade`
  - schedules for the next billing cycle
  - keeps current-cycle access and remaining coins intact until the cycle ends
- `Top-up coins`
  - always remain untouched by plan changes

## Implementation follow-up

Future implementation should include:

- Razorpay subscription-change orchestration
- wallet/grant migration rules for plan switches
- account-management UI in wallet/billing
- clear user messaging for upgrade and downgrade timing
- admin/manual reconcile support for plan-change edge cases
