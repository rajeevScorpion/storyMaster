# QA, security and failure matrix

Happy-path sandbox success is insufficient.

## Financial invariants

Prove through tests and/or DB constraints:

1. One captured payment maps to one durable payment record.
2. One subscription cycle maps to at most one recurring grant.
3. One top-up payment maps to at most one top-up grant.
4. Refund/dispute state cannot silently leave Kissago believing payment is fully settled.
5. Server-side price/plan/version controls what is charged.
6. User cannot attach another user's provider object.
7. Existing financial records survive account deletion per approved retention design.
8. Retry/reconcile are safe to run more than once.
9. Test-mode provider refs cannot be used with live credentials.
10. Checkout disabled means server refuses new checkout.

## Consumption invariants

1. Free daily limit uses unique story IDs.
2. Replay does not consume another slot.
3. Multiple tabs/devices cannot race past cap.
4. Admin-configured limit is authoritative.
5. Audience/Plus/Studio consumption is not accidentally metered by Free quota.
6. Consumption does not debit creation coins.
7. Free trial coins are granted once, expire once, never monthly-refill.
8. Top-up coins are not accidentally expired with the Free trial.

## Security tests

- auth required where appropriate;
- webhook signature raw-body verification preserved;
- CSRF/server-action conventions followed;
- no IDOR on invoices/payments/subscriptions;
- no client-trusted amount/plan/owner;
- admin actions re-check admin permission server-side;
- invoice storage is private/authenticated;
- logs redact PII/secrets;
- rate limit/abuse controls where existing architecture supports them.

## Failure scenarios

Test or simulate:
- webhook endpoint unavailable;
- DB transient failure during webhook;
- duplicate webhook;
- out-of-order events;
- verify timeout;
- browser closes after payment;
- UPI completes late;
- payment authorized but uncaptured;
- payment captured but grant fails;
- grant succeeds but response to browser fails;
- email provider down;
- PDF generation fails;
- invoice storage upload fails;
- reconcile runs during webhook;
- refund API succeeds but local write initially fails;
- subscription cancels at provider but webhook missed;
- annual Audience renewal;
- plan disabled while existing subscriber active;
- account blocked/deleted while subscription active.

## UI regression

Verify:
- signed out;
- Free;
- Audience monthly;
- Audience annual;
- Plus;
- Studio;
- cancelled-at-period-end;
- grace/failed payment;
- mobile;
- keyboard/focus;
- slow connection;
- empty history;
- long history;
- invoice download failure.

## Required build checks

Use existing repo tooling:
- focused unit/integration tests;
- database/migration verification;
- Playwright/e2e for billing flows if Playwright already exists;
- typecheck;
- lint;
- build;
- relevant regression suites.

Do not introduce a new testing framework if current tooling can cover the need.
