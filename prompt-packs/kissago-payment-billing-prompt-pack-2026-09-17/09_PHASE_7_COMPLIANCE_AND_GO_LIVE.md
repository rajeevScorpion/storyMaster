# Phase 7 — compliance, operational readiness and go-live

**Live-money gate.**

## Policy surfaces

Reconcile customer-facing policy text with what the product actually does.

At minimum inspect/finalize:
- Refund & Cancellation;
- digital delivery / fulfillment statement;
- Terms purchase language;
- privacy/retention wording affected by billing data;
- grievance/support contact;
- account deletion wording;
- any draft/placeholder managed pages that can undermine payment-provider review.

Do not let policy claim a refund/cancellation behavior different from implemented behavior.

## Purchase disclosure

Verify customer sees before paying:
- recurring nature;
- amount/frequency;
- tax-inclusive total or legally correct treatment;
- cancellation;
- coin reset/expiry where relevant;
- Audience annual billed annually;
- refund-policy link.

## Razorpay dashboard manual gate

Create an explicit runbook and require human confirmation for:
- test webhook registered + secret configured;
- required test events observed;
- capture setting confirmed;
- subscription product/payment methods enabled;
- live account/KYC approved;
- live webhook separately registered;
- live secrets present in correct environment;
- test/live provider plan references isolated;
- live checkout initially behind server-side flag.

Never automate or fake a dashboard confirmation the coder cannot actually verify.

## Smoke-test ladder

1. local/unit/integration;
2. dev sandbox;
3. sandbox renewal simulation;
4. refund/cancel sandbox;
5. Audience monthly;
6. Audience annual;
7. Free quota and trial;
8. controlled live low-value transaction;
9. receipt/invoice/download/email;
10. refund + adjustment + document;
11. subscription cancel;
12. failed-renewal recovery.

## Closed rollout

Use the existing feature-flag/admin conventions.

Start with a restricted production cohort if practical.

Monitor:
- payment success;
- verify/webhook latency;
- webhook failures;
- reconciliation mismatches;
- duplicate-prevention conflicts;
- failed renewals;
- refund failures;
- invoice generation failures;
- email delivery;
- consumption quota denial rate;
- upgrade conversion.

## Emergency behavior

Document:
- how to stop new checkouts server-side;
- whether existing renewals continue and how to stop them;
- how to disable Audience purchase without corrupting existing subscribers;
- how to disable consumption enforcement if it malfunctions;
- how to reconcile after provider outage;
- how to restore invoice/email jobs;
- how to rollback app code without rolling back already-issued financial facts.

## Final go-live report

Must contain:
- exact production flags;
- manual dashboard checks;
- migrations applied;
- rollback/disable steps;
- tests;
- known limitations;
- unresolved legal/CA items;
- links to current runbook/handoff;
- final commit hash.
