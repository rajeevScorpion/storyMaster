# Phase 8 — international readiness (later)

Do not implement international checkout during the India launch unless the owner explicitly expands scope.

## What to do now

Keep the billing core/provider boundary clean enough that a future provider can plug in without rebuilding:
- billing history;
- invoices/documents;
- plan UI;
- entitlements;
- refunds model;
- admin support;
- consumption quota.

Do not over-engineer a speculative universal payment framework.

## Later investigation

Re-run current research when international work begins.

Do not assume the 2026-09-17 Stripe/MoR status is still current.

Compare, with current official sources:
- Stripe availability for Indian entities;
- merchant-of-record options;
- Razorpay international;
- settlement/currency;
- tax/VAT handling;
- refunds/disputes;
- subscription methods;
- invoice ownership;
- fees;
- compliance/exports.

Bring CA/legal questions about export-of-services and settlement back as a decision gate.

## Exit for this phase
A second provider can be added through a documented adapter boundary without rewriting the user billing/entitlement model.
