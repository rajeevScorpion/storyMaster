# Phase 4 — admin billing, pricing and support operations

**Live-money gate.**

A live billing system is not ready if routine support requires SQL or provider-dashboard archaeology.

## User billing panel for admin

From the existing user-detail/admin experience, make it possible to inspect:

- current subscription(s);
- plan/version/interval;
- provider state;
- current period;
- scheduled cancellation;
- payments;
- refunds;
- invoices/receipts/credit notes;
- coin grants linked to purchases;
- consumption entitlement/quota state;
- relevant webhook/reconciliation events;
- billing profile;
- failed/stuck states.

## Safe admin actions

Where supported/approved:
- cancel at cycle end;
- cancel immediately with strong confirmation;
- refund full/partial;
- re-sync from provider;
- retry/reprocess failed webhook;
- reconcile payment/subscription;
- bounded negative coin adjustment/clawback;
- correct an operational state through an auditable path;
- inspect why a Free user hit consumption quota.

Never make a provider mutation from the browser directly.

## Auditability

Every consequential admin action must record:
- actor;
- timestamp;
- reason;
- target user/payment/subscription;
- before/after state or provider response reference;
- related coin adjustment;
- success/failure.

Do not log secrets or sensitive payment payloads unnecessarily.

## Pricing admin

Extend existing pricing/admin architecture rather than creating a parallel configuration system.

Admin must be able to understand and control:
- Free consumption cap;
- Free one-time trial coins + expiry;
- Audience monthly/annual published versions;
- Audience consumption rights;
- Plus/Studio existing versions;
- which plan/version has active subscribers;
- test/live provider plan reference safety;
- checkout/consumption kill switches.

Prevent dangerous plan archival/deactivation when active subscribers depend on it, or require an explicit, informed confirmation.

## Incident tooling

Surface:
- failed webhook count;
- reconcile mismatches;
- stuck payments;
- subscriptions past expected renewal boundary;
- duplicate-risk anomalies;
- provider connectivity/config failures.

Owner-facing alerts should be actionable and non-spammy.

## Exit support cases

Admin can resolve without SQL:
- paid, no coins;
- paid, wrong subscription state;
- duplicate charge;
- cancellation request;
- refund request;
- failed renewal;
- blocked/deleted user with subscription;
- chargeback/dispute;
- invoice missing;
- wrong current billing details for future invoice;
- Free consumption quota confusion;
- Audience monthly/annual entitlement mismatch.
