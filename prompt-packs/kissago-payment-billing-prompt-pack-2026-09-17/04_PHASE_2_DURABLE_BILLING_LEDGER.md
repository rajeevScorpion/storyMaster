# Phase 2 — durable financial records and billing identity

**Live-money gate.**

Goal: every charge/refund/invoice-worthy event is reconstructable from Kissago's own records without depending on a mutable provider dashboard.

## Principle

Razorpay is the payment provider. Kissago needs its own provider-neutral billing ledger.

Do not duplicate tables blindly. Inspect current schema and add only the minimum normalized structures required.

## Required capabilities

### Payment record
One durable row per actual charge, including renewals.

Store enough to support:
- amount/currency;
- tax components when applicable;
- status;
- payment method category without forbidden/raw card data;
- provider IDs;
- plan/order/subscription relationships;
- invoice/receipt relationship;
- immutable purchase snapshot references;
- timestamps.

### Refund record
Support:
- full/partial amount;
- provider refund ID;
- status;
- reason;
- related payment;
- benefit/coin adjustment relationship;
- timestamps/audit actor.

### Invoice/document record
Support document type without prematurely hardcoding a legally incorrect choice:
- receipt;
- tax invoice;
- credit note;
- other future document type if required.

Store an immutable customer/business snapshot used when the document was issued.

### Billing profile
Support current billing details for future purchases/documents:
- legal/customer name;
- billing email;
- phone where genuinely needed;
- declared state;
- country;
- company name;
- GSTIN where applicable;
- address as required.

Do not mutate historical invoices when the billing profile later changes.

### Retention-safe deletion
Financial/tax records must not cascade away with account deletion.

Design a retention/anonymisation strategy grounded in:
- current schema;
- current deletion flow;
- `07-india-tax-and-consumer-compliance.md`;
- owner's/CA's confirmed requirement.

Cancel or otherwise resolve live subscription state before destructive account deletion.

## Critical tax-status gate

Do **not** blindly implement the old plan's "plain receipt before GST registration" assumption.

The audit/research indicates the repo's business configuration may already contain a GSTIN. Before finalizing document behavior:
1. inspect current `lib/legal/business-config.ts` and managed business/legal config;
2. establish current intended billing entity;
3. surface any contradiction to the owner;
4. require owner/CA confirmation for tax-document timing/classification questions.

The coder should implement a flexible document engine/schema, but must not invent tax treatment.

## Backfill

If historical dev/test billing rows exist, propose a safe backfill. Never fabricate missing provider facts.

## Exit

A payment can be traced:
Provider event → Kissago payment → subscription/order → benefit/grant → billing document.

Account deletion test must demonstrate the financial record survives in the intended anonymised/retained form.
