# Phase 6 — invoices, receipts, credit notes and billing email

Do not let Razorpay invoice objects become the sole financial-document source.

The audit found Razorpay's automated invoice capability insufficient for automated GST invoicing; reverify official docs before implementation.

## Financial-document engine

Generate documents from Kissago's durable billing records.

Requirements:
- deterministic document record;
- immutable issued snapshot;
- downloadable PDF;
- durable object-storage location if consistent with current infrastructure;
- access-controlled download;
- user billing-history link;
- admin access;
- resend/re-email ability without changing the issued financial facts.

## Tax/legal decision gate

Before coding final tax calculations/document labels:
- inspect current business config and GSTIN;
- confirm the actual billing entity;
- confirm with owner/CA:
  - GST registration status;
  - applicable SAC/rate;
  - whether subscription/top-up coin timing differs;
  - invoice/receipt timing;
  - refund credit-note rules;
  - place-of-supply/state requirements;
  - B2B GSTIN handling.

Do not invent tax logic from general assumptions.

Build the schema/rendering boundary so confirmed tax rules can be implemented without rewriting checkout.

## Numbering

If invoice/credit-note numbering is required, implement concurrency-safe issuance with the exact format/financial-year rules confirmed for Kissago.

Do not create "gap free" or sequence-reset behavior solely because an old plan suggested it if CA/actual accounting requirements differ.

## Billing details

At purchase, collect the minimum required information with excellent UX.

Use progressive disclosure:
- ordinary consumer sees minimal required fields;
- business buyer can add company/GSTIN fields.

Historical issued documents do not silently update when profile changes.

## Email

Use the provider that already exists if one was added after audit. Otherwise present practical provider options and ask owner before adding a new vendor.

Templates:
- payment confirmation/receipt;
- renewal receipt/document;
- failed payment with recovery action;
- cancellation scheduled/confirmed;
- refund;
- plan change;
- annual renewal reminder if required/appropriate;
- invoice/credit note.

Emails must link back into Kissago, not strand the user in a provider dashboard unless the provider action genuinely requires it.

## Security/privacy
- signed/authenticated invoice downloads;
- no sequential public document URLs;
- no secrets/full payment payloads;
- billing email change must not rewrite historical invoice identity.

## Exit
For each paid transaction class in scope:
payment → durable record → correct document → billing history → downloadable PDF → email notification.

For refund:
refund → durable refund → benefit adjustment as approved → credit-note/document behavior as confirmed → user/admin visibility.
