# Phase 5 — premium user billing, plan comparison and checkout UX

User trust is part of payment correctness.

The experience must feel like Kissago from plan discovery through post-payment management.

## Design principles

- inspect/reuse the current Kissago design system;
- do not create a generic SaaS admin-looking billing page;
- do not visually imitate ChatGPT/Claude;
- use them only as interaction benchmarks;
- keep typography, spacing, surface treatment, controls, motion and responsive behavior coherent with Kissago;
- minimize the sense of leaving the product when Razorpay Checkout appears;
- prefill safely;
- show deliberate pending/processing states;
- never dump raw provider error objects into customer UI.

## Mandatory plan comparison

Create a clear user-facing comparison surface driven by live catalog/entitlement data.

Conceptual content:

| Capability | Free | Audience | Plus | Studio |
|---|---|---|---|---|
| Story consumption | 3 unique/day (current setting) | Unlimited | Unlimited | Unlimited |
| Creation coins | 50 once, expires after trial window | None included | Live catalog allowance | Live catalog allowance |
| Top-up coins | Available | Available | Available | Available |
| Best for | Trying Kissago | Watching stories | Regular creation | Higher-volume/premium creation |
| Monthly | Free | Live Audience monthly price | Live catalog | Live catalog |
| Annual | — | Live Audience annual price + monthly equivalent | Show only if actually published | Show only if actually published |

This table is a **content requirement**, not a fixed visual component. On small screens it may become stacked comparison cards or another accessible pattern.

Do not hardcode caps/prices.

## Checkout summary before provider modal

Before payment, show the actual purchase promise:
- plan;
- billing interval;
- total charge;
- tax treatment/total as legally confirmed;
- recurring nature;
- next charge date/frequency;
- cancellation behavior;
- viewing entitlement;
- creation coins included, if any;
- when included coins reset/expire;
- top-up behavior;
- refund-policy link;
- terms/adult attestation as approved.

Annual Audience must clearly show:
- annual billed amount;
- effective monthly equivalent;
- annual renewal, not misleading "₹150/month billed monthly" language.

## Payment states

Design for:
- opening checkout;
- user dismisses checkout;
- payment pending;
- UPI delayed completion;
- payment captured but app still reconciling;
- success;
- failure;
- failed renewal;
- halted subscription;
- cancelled at period end;
- refunded/partially refunded.

Never tell the user "failed" when payment may still settle asynchronously.

## Settings → Billing

Build/extend a coherent billing area accessible from the account menu and relevant wallet/plan surfaces.

At minimum:
- current plan + interval + status;
- renewal/cancel date;
- benefits relevant to the plan;
- creation coin balances/reset where applicable;
- Free/Audience consumption status where useful;
- payment history in real-money terms;
- invoices/receipts download;
- billing details;
- cancel;
- resume scheduled cancellation if supported;
- fix failed payment / reauthorise as provider constraints allow;
- change plan only under approved, tested rules.

### Plan-change caution
The old plan contains proposed upgrade/downgrade mechanics, but provider constraints differ by rail. Revalidate before implementation. If a single safe, understandable plan-change flow cannot be guaranteed, present options to owner rather than shipping inconsistent hidden rules.

## Cancellation
Cancellation must be easy to find and roughly as easy as subscription.

No manipulative retention UX.

## Kids/minors
Do not let a minor/kids-mode surface become the contracting/payment party. Implement the approved adult-payer model only after checking current account/kids architecture.

## Accessibility/responsive
Billing and comparison UI must remain usable:
- keyboard;
- screen reader labels;
- focus trap/return around payment modal;
- narrow mobile viewport;
- long plan names/currency values;
- network slowness;
- reduced motion where applicable.
