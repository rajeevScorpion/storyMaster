# Phase 1 — make money movement correct

**Live-money gate.**

Use the audit as a checklist, but revalidate each item against current code first.

## Outcomes

### Idempotent grants
Ensure one real payment/cycle can cause at most one corresponding coin grant even when:
- browser verify and webhook race;
- webhook retries;
- reconcile runs simultaneously;
- provider sends duplicates/out-of-order events.

Prefer database-enforced uniqueness over application-only check-then-insert.

Migration must first prove existing data will not violate the constraint.

### Webhook reliability
- failed events must be retryable;
- successfully processed duplicates must remain safe;
- config/signature failures must become observable without storing secrets;
- explicit handling/status for renewal, failed payment, cancellation, refund and dispute;
- no "processed" state for an event that had no intended business effect unless intentionally classified.

### Reconciliation backstop
Build/extend scheduled reconciliation so webhook loss is not equivalent to financial data loss.

Reconcile:
- subscriptions near/past cycle boundary;
- stuck checkout/payment states;
- captured payments without benefits;
- provider vs Kissago subscription state.

All recovery must use the same idempotent core.

### Trusted identifiers
The browser must not choose the authoritative subscription/payment/order identity used to sync ownership or grant benefits.

### Capture certainty
A payment signature is not itself proof of captured funds. Use provider-authoritative state appropriate to the rail.

### Subscription first-charge certainty
Do not grant money-backed recurring benefits merely on an ambiguous `authenticated` state. Verify current Razorpay behavior for card, UPI Autopay and eNACH with official docs + sandbox traces.

### One subscription / checkout safety
Prevent overlapping live/in-progress recurring subscriptions created by double click, second tab, reload or retry.

### Mode-safe provider references
Test and live plan IDs must never be mixed. Make cached provider references mode-aware or otherwise provably safe.

### Server kill switch
When checkout is disabled, server-side prepare/verify/money-benefit paths must enforce it. UI state alone is not a kill switch.

### Purchase snapshot
Snapshot the commercial promise at checkout:
- plan/version;
- amount/currency;
- included coin quantity where relevant;
- interval;
- entitlement identity needed to reproduce what was sold.

Do not grant from a mutable catalog value if the purchase was already created.

## Required tests

At minimum:
- concurrent verify + webhook → one grant;
- failed webhook → retry → succeeds once;
- duplicate successful webhook → no duplicate effect;
- out-of-order subscription events converge;
- missed webhook + reconcile → correct state;
- wrong client-supplied provider ID rejected/ignored;
- kill switch rejects direct server call;
- double subscription preparation blocked safely;
- authorized but uncaptured top-up does not grant;
- captured top-up grants once;
- renewal grants once;
- provider config error is observable;
- test/live plan reference isolation.

## Phase report + gate

Before commit, show:
- exact changes;
- migration + rollback/disable path;
- tests run/results;
- remaining provider-dashboard manual steps;
- unresolved ambiguity.

Commit only after the phase is coherent and tested.
