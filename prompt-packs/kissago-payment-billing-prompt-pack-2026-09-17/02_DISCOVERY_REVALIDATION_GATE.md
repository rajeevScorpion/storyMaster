# Phase 0 — discovery and revalidation gate

**No implementation in this phase.**

## Read first

Read all paths in `SOURCE_REFERENCES.md` from the repo.

Then inspect:

### Git/context
- current branch;
- current uncommitted changes;
- relevant recent commits;
- existing project-state/handoff/decision docs;
- working agreements.

### Billing/payment
- `app/actions/pricing-checkout.ts`;
- Razorpay prepare/verify/webhook routes;
- `lib/billing/**`;
- billing migrations and current generated DB types;
- current cron/reconcile jobs;
- flags and runtime settings.

### Pricing/coins/entitlements
- plan keys and any hardcoded `free|plus|studio` assumptions;
- tier-rank logic;
- feature flags;
- plan versions and annual support;
- welcome/free grant;
- top-up behavior;
- wallet spend order;
- capability gates that may block Audience users who buy top-ups.

### Consumption
Trace the story/video consumption experience end-to-end:
- gallery/feed;
- story player;
- play/start/progress events;
- signed-in vs signed-out;
- kids mode;
- any analytics/event tables;
- repeat views;
- caching/offline behavior;
- user timezone/profile data;
- server-side endpoints suitable for authoritative quota checks.

### User/account UX
- `/wallet`;
- account/user menu;
- Settings;
- design tokens/components;
- mobile/responsive conventions;
- loading/pending/error/success patterns.

### Admin
- Pricing Studio;
- user detail/admin tools;
- runtime settings/flags;
- audit logs;
- recovery tools;
- existing confirmation dialogs.

### Financial data
- actual schema;
- dev/prod parity;
- current billing rows;
- invoice/refund/payment/billing-profile tables if any were added after audit;
- deletion FKs and retention behavior.

### Infrastructure
- transactional email provider if any;
- PDF generation;
- object storage;
- scheduled jobs;
- alerting/observability.

### Provider
Using current official Razorpay docs + sandbox:
- recurring lifecycle;
- annual subscription support;
- UPI Autopay/eNACH/card first-charge semantics;
- capture;
- refund;
- cancellation;
- failed-payment recovery;
- plan changes;
- webhook retry behavior;
- test/live separation;
- any restrictions relevant to Audience annual.

## Required output

Produce:
1. Audit finding status matrix: still valid / fixed / changed / cannot verify.
2. New Audience/consumption impact map.
3. Hardcoded-plan-key inventory.
4. Proposed data-model delta.
5. Proposed admin delta.
6. Proposed UI architecture.
7. Test strategy.
8. Rollback/flags strategy.
9. Decision gates.

Do not ask the owner to repeat decisions already in `01_OWNER_DECISIONS_AND_PRODUCT_MODEL.md`.

**STOP and wait for approval.**
