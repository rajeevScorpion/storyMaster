# Kissago Payment & Billing Implementation — Combined Prompt Pack

> Convenience copy. Existing audit/research source files are referenced only and are not reproduced here.



---

# Kissago Payment, Billing, Invoicing & Consumption Monetisation — AI Coder Prompt Pack

**Prepared:** 17 September 2026  
**Purpose:** Implement a production-ready payment, billing, invoicing, subscription-management, consumption-entitlement, and billing-support system for Kissago.

## Important packaging rule

This pack **does not contain** the existing audit/research files. They already exist in the repository and must be read **in place**. Do not copy, rename, regenerate, summarize into replacement documents, or bundle them into a new folder.

Required repo references are listed in `SOURCE_REFERENCES.md`.

## How to use this pack

1. Start a fresh coding-agent session on the intended Kissago repository/branch.
2. Paste `STARTER_PROMPT.md`.
3. The agent must complete the discovery/revalidation gate before modifying billing/payment code.
4. If the discovery reveals consequential ambiguity, the agent must stop and ask the owner with:
   - what it found;
   - why the ambiguity matters;
   - 2–3 practical options;
   - its recommended option;
   - codebase/provider consequences.
5. After owner confirmation, run the relevant phase prompt.
6. At the end of every meaningful phase:
   - test;
   - inspect diff;
   - selectively stage only intended files;
   - update the repo's existing project-state/handoff mechanism;
   - commit with a meaningful message;
   - record rollback/disable steps;
   - stop at the phase gate unless the owner explicitly asks to continue.

## Core philosophy

This is a **financially sensitive implementation**. Correctness and premium user experience have equal weight.

The audit/plan are evidence, not commands. The coder must re-check current code, schema, environments, provider behavior, current official documentation, and existing Kissago conventions before choosing implementation details.

The goal is not a rewrite. Preserve sound existing systems and extend them deliberately.


---

# Existing repo sources — references only

These files are **not part of this prompt pack**. They already exist in the Kissago repo and must be read from their existing paths.

Read all of them before implementation:

- `docs/payments/audit-progress.md`
- `docs/payments/billing-audit-2026-09-17.md`
- `docs/payments/billing-plan-2026-09-17.md`
- `docs/payments/research/01-checkout-and-payment-capture.md`
- `docs/payments/research/02-entitlements-grants-and-coin-value.md`
- `docs/payments/research/03-data-model-and-live-db-state.md`
- `docs/payments/research/04-admin-tools-and-operations.md`
- `docs/payments/research/05-docs-vs-code-and-compliance-surfaces.md`
- `docs/payments/research/06-razorpay-capabilities.md`
- `docs/payments/research/07-india-tax-and-consumer-compliance.md`
- `docs/payments/research/08-billing-ux-benchmarks-and-stripe-readiness.md`

## Source hierarchy

When sources disagree, use this order:

1. **Explicit owner decisions in this prompt pack** — newest product intent.
2. **Current code/database/provider reality** — determines what is safely implementable.
3. **2026-09-17 audit/research files above** — evidence and discovered risks.
4. Older project documents — useful context, but may have been superseded.

Never silently reconcile contradictions. If a contradiction can change money movement, entitlement, tax, legal wording, stored financial records, customer experience, or rollout risk, surface it as a decision gate.


---

# Master implementation directive

## Mission

Make Kissago safe to take real money while providing a premium, coherent, in-product billing experience comparable in clarity and confidence to mature AI subscription products, without imitating another product's visual identity.

Scope includes:

- Razorpay India checkout and recurring subscriptions;
- top-up purchases;
- reliable renewals;
- refunds/cancellations/disputes;
- permanent financial records;
- billing identity;
- invoices/receipts/credit notes as legally applicable;
- billing emails;
- user purchase history and subscription management;
- admin/support tools;
- Free/Audience/Plus/Studio entitlements;
- daily story-consumption metering;
- the new Audience monthly + annual plan;
- premium plan comparison and checkout UX;
- safe go-live controls;
- provider abstraction sufficient for a later international provider.

## Non-negotiable working style

### Investigate before changing
Do not assume current files, schema, routes, provider behavior, migrations, feature flags, storage, email provider, or UI architecture. Read first.

### Recommendations are hypotheses, not forced architecture
The audit and this pack contain strong directions, but the implementation must fit the actual codebase. If a cleaner, safer solution exists, propose it with evidence.

### Consequential ambiguity requires owner confirmation
Stop when uncertainty affects:
- money charged;
- frequency/renewal;
- refunds;
- coin grants or clawback;
- story-consumption counting;
- entitlement behavior;
- tax/invoice behavior;
- financial retention/deletion;
- customer-facing legal wording;
- plan pricing/caps;
- production/provider configuration;
- migrations that are destructive or difficult to reverse.

### Preserve what is sound
Do not rewrite the existing wallet/spend engine, server-side pricing, signature verification, pricing audit trail, or existing abstractions merely for aesthetic consistency.

### Server is authoritative
Never rely on UI-only checks for money, entitlement, quotas, cancellation, or kill switches.

### Fail closed
When billing state cannot be proven, do not grant money-backed benefits optimistically unless the existing product explicitly requires a safe temporary state.

### Every money effect must be idempotent
Retries, duplicate webhooks, browser callbacks, reconciliation and concurrency must converge to one financial/entitlement outcome.

### Financial history is append-oriented
Do not delete or mutate historical financial facts merely because the user changes plans, account details, or deletes their account.

### No secret leakage
Never print provider secrets, service-role secrets, raw sensitive payment data, or full personal billing data into logs, docs, handoffs, screenshots, or commits.

### Phase discipline
Each phase must be independently testable, reversible/disableable, documented, and committed.

### Protect unrelated owner work
Inspect git status before staging. Never `git add .` casually. Do not overwrite unrelated modified files.

## Definition of done

"Payment works in sandbox" is not enough.

Done means:
- charges and benefits reconcile correctly under retries/failures;
- user can understand exactly what they are buying;
- admin can resolve normal billing support cases without SQL;
- user can view/manage billing without leaving the Kissago experience;
- invoices/receipts are generated from authoritative stored financial data;
- plan/consumption settings are admin-controlled;
- production can be disabled server-side immediately;
- rollback/incident procedures are documented;
- tests cover concurrency and failure states, not only happy paths.


---

# Owner decisions — current product model

These decisions are newer than conflicting older pricing documents/audit recommendations.

Do not re-open them unless current code/provider constraints make them impossible or unsafe. If that happens, explain the conflict and ask before changing product intent.

## 1. Plan architecture

Kissago has four user-facing levels:

| Plan | Story consumption | Included creation allowance | Creation relationship | Indicative India price |
|---|---|---|---|---|
| **Free** | **3 unique stories/day** by current owner decision; value must be admin-configurable | **50 trial coins once** | Trial creation while coins remain; no recurring free coin refill | ₹0 |
| **Audience** | **Unlimited story consumption** | No recurring included creation coins | Consumption-first. User may buy top-up coins for occasional creation if the existing creation entitlement architecture permits this safely | **₹199/month target** |
| **Plus** | Unlimited story consumption | Existing recurring creation allowance from published catalog | Creator subscription | Existing published/admin price |
| **Studio** | Unlimited story consumption | Existing larger recurring creation allowance from published catalog | Higher creator subscription/premium capabilities | Existing published/admin price |

### Audience annual
Audience must also support an annual India subscription.

Current product target:
- ₹199/month;
- ₹1,799/year (roughly ₹150/month equivalent).

These are launch targets, **not hardcoded constants**. Monthly price, annual price/discount and availability must be admin-configurable using the pricing/catalog architecture.

This decision overrides the old blanket statement that "annual plans are out of scope." It does **not** automatically mean Plus and Studio annual India subscriptions must be enabled now. Do not expand scope unless the existing architecture makes that necessary or the owner approves it.

## 2. Free creation trial

Free receives **50 coins once**, not every month.

Required behavior:
- one-time welcome/trial grant;
- valid for 30 days from the grant unless the owner later changes the admin-configurable setting;
- no automatic replenishment after 30 days;
- any unspent trial balance expires;
- purchased top-up coins remain governed by the existing top-up rules, not by this trial expiry.

Investigate the existing `welcome`/free grant behavior and adapt rather than duplicating another grant mechanism.

## 3. Daily consumption quota

Free currently gets **3 unique stories per day**.

The number must be editable by admin.

Owner-approved counting principle:
- count **unique stories consumed that day**, not every press of Play;
- replaying the same story during the same quota day should not consume another slot.

Do not guess the exact technical "consumed" event (page open vs playback start vs playback threshold) or quota reset timezone if the repo does not already define these. Investigate analytics/player behavior and return a recommendation before implementing if ambiguous.

Audience, Plus and Studio have unlimited normal story consumption in this version.

## 4. Coins and consumption are separate concepts

Do **not** charge story viewing out of the creation coin wallet.

Use:
- coins for creation/generative usage;
- plan entitlements + daily quota accounting for story consumption.

This keeps the user mental model clear and avoids mixing creation economics with viewing access.

## 5. Top-ups

Preserve current one-time top-up behavior unless a code-level entitlement conflict is discovered.

Product direction:
- Free can buy top-ups;
- Audience can buy top-ups for occasional creation;
- Plus/Studio can buy top-ups;
- top-ups do not replace the Audience viewing subscription.

If current tier gates prevent Audience from using purchased coins for creation, investigate the cleanest capability-based model and ask before changing product rights.

## 6. User-facing comparison

A clear plan-comparison surface is mandatory.

It must make the Free → Audience → Plus → Studio progression understandable without reading policy text.

At minimum communicate:
- daily story limit / unlimited viewing;
- one-time Free trial coins and expiry;
- recurring included creator coins for Plus/Studio from the live catalog;
- top-up availability;
- creation-oriented capabilities;
- monthly/annual price where applicable;
- annual effective monthly equivalent;
- auto-renewal and cancellation behavior;
- tax-inclusive total where applicable.

Values must come from the same authoritative pricing/entitlement source used by checkout—not duplicated literals in UI.

Exact placement/design must follow the current Kissago information architecture. The existing `/wallet` plan surface is the obvious candidate, but inspect before creating a new `/pricing` route.

## 7. Naming

Customer-facing name: **Audience** (or "Kissago Audience" where context requires).

Do not use "Audience seat" in consumer UI. "Seat" sounds like team/B2B licensing.

Internal keys may differ if required by migration/backward compatibility, but avoid leaking internal keys to user copy.


---

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


---

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


---

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


---

# Phase 3 — Free/Audience/Plus/Studio entitlements and consumption metering

This phase introduces the newly approved product model.

## Do not solve this by scattering plan-name conditionals

Audit the current `free|plus|studio` hardcoding first.

Prefer a capability/entitlement model where plans describe behavior such as:
- daily unique-story quota;
- unlimited consumption;
- welcome/trial coin grant;
- recurring included coins;
- whether creation is available with purchased top-ups;
- download/export capabilities already used by Kissago;
- existing story-length and premium feature rights.

Preserve existing tier behavior unless this phase explicitly changes it.

## Free

Current owner decision:
- 3 unique stories/day;
- daily limit admin-configurable;
- 50 coins once;
- trial coins expire after 30 days;
- no monthly renewal of those 50 coins;
- top-up purchases remain possible;
- no mixing of viewing quota with creation coins.

Investigate and reuse the existing welcome grant mechanism.

## Audience

Create the consumption-first paid plan.

Owner intent:
- unlimited story consumption;
- no recurring included creation coins;
- monthly target ₹199;
- annual target ₹1,799;
- prices/availability/discount admin-configurable;
- top-ups remain available for occasional creation if compatible with the entitlement architecture.

Do not hardcode ₹199/₹1,799 in checkout logic.

### Annual requirement
Audience annual is **in scope now** even though older documents deferred annual plans.

Investigate:
- current `pricing_plan_versions` annual support;
- the existing explicit Razorpay annual block;
- provider lifecycle/mandate implications;
- renewals;
- invoice cadence/document semantics;
- upgrade/downgrade interactions;
- test/live plan references;
- cancellation at cycle end.

Do not automatically enable annual Plus/Studio India plans unless needed or owner-approved.

## Plus / Studio

- unlimited normal story consumption;
- preserve existing creation coin/feature catalog;
- do not hardcode current price/coin numbers;
- existing admin-published catalog remains authority.

## Consumption accounting

### Owner-approved rule
The daily Free quota counts **unique story IDs**, not play clicks.

A replay of the same story on the same quota day does not consume a second slot.

### Investigate before choosing the event
If the repo has no authoritative consumption event, propose options such as:
- first successful playback start;
- minimum playback threshold;
- explicit story-open.

Recommend the least gameable option that does not punish accidental taps or load failures.

### Reset time
Do not guess whether daily reset means:
- user-local day;
- India day;
- UTC day.

Inspect existing timezone/user-preference infrastructure and ask the owner if no established convention exists.

### Server authority
Enforce quota server-side. Client display may be optimistic but cannot be the only protection.

### Concurrency
Multiple tabs/devices must not allow the Free user to exceed the daily unique quota due to race conditions.

### UX
The user must always know:
- today's allowance;
- stories used;
- remaining;
- when it resets in human terms;
- that replay of an already-counted story is allowed;
- what Audience unlocks.

When quota is exhausted, show a premium, contextual Audience upgrade path—not a generic error.

## Admin controls

At minimum:
- Free daily unique-story limit;
- Free trial coin amount;
- Free trial expiry days;
- Audience availability;
- Audience monthly price;
- Audience annual price;
- Audience annual availability/discount display;
- any required consumption feature flag/kill switch.

Reuse existing audited pricing publish/version history where practical.

## Tests

- first 3 unique stories allowed;
- 4th blocked when configured limit=3;
- replay of story 1 allowed after limit reached;
- next quota day resets correctly;
- two devices racing for final slot cannot over-consume;
- admin changing quota changes future enforcement without redeploy;
- Free 50-coin grant occurs once;
- grant expires as configured and never monthly-refills;
- Audience monthly has unlimited consumption;
- Audience annual has unlimited consumption;
- Plus/Studio unaffected;
- top-up creation behavior matches approved capability model.


---

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


---

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


---

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


---

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


---

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


---

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


---

# Handoff, commits, documentation and rollback protocol

Use the repository's existing working-agreement/handoff files if present. Do not create parallel governance docs unless the repo genuinely lacks them.

## At start of every session
Read:
- working agreements;
- project state;
- decision log;
- test status;
- latest handoff;
- git status/log.

Resume from repository evidence, not chat memory.

## Commit discipline

Before a phase:
- ensure intended branch;
- isolate unrelated owner changes.

During a phase:
- keep changes scoped;
- do not make drive-by refactors.

Before commit:
1. run relevant tests;
2. inspect `git diff`;
3. inspect `git status`;
4. selectively stage intended files;
5. update living docs/handoff;
6. commit with a meaningful phase/result message.

Do not push unless the owner asked.

## Migration discipline

Every migration plan must state:
- why needed;
- data prechecks;
- forward SQL;
- compatibility during rollout;
- backfill;
- verification query;
- rollback or compensating strategy;
- whether rollback is unsafe after live financial writes.

Never delete live financial data as a rollback shortcut.

## Feature flags / disable path

Every risky new surface should have an operational disable strategy where practical:
- checkout;
- new Audience purchase;
- consumption quota;
- invoice email;
- scheduled reconcile.

A flag must be enforced server-side if it controls money/entitlement.

## Decision log

Record:
- owner decisions;
- provider constraints;
- tax/CA confirmations;
- intentional deviations from audit recommendations;
- why a chosen design was selected.

## Session handoff must include

- branch;
- commit hash;
- scope completed;
- files changed;
- migrations applied/pending;
- flags/config required;
- manual provider steps;
- tests/results;
- known issues;
- unanswered decision gates;
- rollback/disable instructions;
- exact next recommended prompt/phase.

Then **STOP**.


---

# System acceptance criteria

The implementation is not complete until these are true or explicitly marked deferred with owner approval.

## Checkout and money
- [ ] New checkout can be disabled server-side.
- [ ] No client-controlled ID can reassign provider objects or benefits.
- [ ] Capture/first-charge semantics are provider-authoritative.
- [ ] Concurrent callback/webhook/reconcile cannot duplicate grants.
- [ ] Missed/failed webhooks recover.
- [ ] Test/live provider references are isolated.
- [ ] Overlapping subscription attempts are prevented.
- [ ] Monthly and Audience annual flows are verified in sandbox.

## Plan model
- [ ] Free: 3 unique stories/day from admin-configured value.
- [ ] Free: 50 trial coins once; configurable amount/expiry; no monthly refill.
- [ ] Audience monthly is configurable and works.
- [ ] Audience annual is configurable and works.
- [ ] Audience has unlimited story consumption.
- [ ] Plus/Studio have unlimited story consumption.
- [ ] Consumption does not spend coins.
- [ ] Replays of same story/day do not consume another Free slot.
- [ ] Audience/Free top-up creation behavior matches approved capability model.
- [ ] No widespread brittle plan-name conditionals were added.

## User UX
- [ ] Clear Free/Audience/Plus/Studio comparison.
- [ ] UI values come from authoritative catalog/entitlements.
- [ ] Annual price is not presented misleadingly as monthly billing.
- [ ] Auto-renewal/tax/cancellation disclosures are visible at purchase.
- [ ] Pending/async payment states are handled.
- [ ] Billing settings show current plan/status.
- [ ] Payment history is in real currency.
- [ ] Invoice/receipt download works.
- [ ] Cancel/resume/recovery works under supported states.
- [ ] Mobile/accessibility pass.

## Admin/support
- [ ] User billing state visible without SQL.
- [ ] Refund/cancel/re-sync/reprocess actions are safe and audited.
- [ ] Negative coin adjustment/clawback exists under approved rules.
- [ ] Failed webhook/reconcile mismatches are visible.
- [ ] Consumption quota/config visible and editable.
- [ ] Active-subscriber safety around catalog changes.

## Records/documents
- [ ] Every charge has a durable payment record.
- [ ] Refunds have durable records.
- [ ] Historical financial records survive user deletion per approved retention.
- [ ] Billing profile changes affect future documents only.
- [ ] Tax/document logic has owner/CA confirmation where required.
- [ ] Generated PDF is access-controlled.
- [ ] Email notifications work or approved fallback is active.

## Operations
- [ ] Test + live webhook setup documented.
- [ ] Capture configuration documented.
- [ ] Reconcile scheduled and observable.
- [ ] Incident kill switches documented.
- [ ] Controlled live smoke test completed.
- [ ] Final handoff/runbook current.


---

# Decision-gate template for the AI coder

Use this only for meaningful ambiguity. Do not ask the owner questions that repo evidence or this pack already answers.

## Decision: <short title>

**What I found**  
Concrete repo/provider facts with files/lines or current official-doc references.

**Why this matters**  
Explain the user, money, data, legal, operational, or migration consequence.

**Option A — <name>**  
- behavior;
- implementation cost;
- risk;
- migration/provider consequence;
- UX consequence.

**Option B — <name>**  
- behavior;
- implementation cost;
- risk;
- migration/provider consequence;
- UX consequence.

**Option C — <name>** (only when materially distinct)

**Recommendation**  
Choose one and explain why it best fits the actual Kissago codebase and product intent.

**What I will implement after approval**  
Exact high-level scope.

**What I will not change**  
Explicit scope guard.

Then stop and wait.


---

# Reusable phase execution prompt

Paste this after approving a specific phase.

---

Proceed with **Phase <N>: <name>** from the Kissago payment/billing prompt pack.

Before editing:
1. re-read the phase prompt;
2. re-read the latest repo handoff/project state/decisions/test status;
3. inspect git status and preserve unrelated work;
4. confirm no new repo changes invalidate the approved plan.

Implement only this phase.

Rules:
- investigate before each consequential edit;
- prefer existing abstractions;
- no speculative rewrite;
- no secret exposure;
- no production/provider mutation unless explicitly part of the approved phase;
- stop and use the decision-gate format if a newly discovered ambiguity affects money, entitlements, tax, retention, legal wording, migrations, or user purchase experience;
- use server-side authority and database-level invariants for financial correctness;
- keep UI coherent with the current Kissago design system;
- add focused tests as you implement;
- update living docs/handoff;
- inspect diff and selectively stage;
- commit after the phase is independently coherent and tested;
- do not push unless asked.

At the end, report:
- findings discovered during implementation;
- changes made;
- migrations/config/provider steps;
- tests and results;
- acceptance criteria met;
- known limitations;
- rollback/disable instructions;
- commit hash;
- exact next recommended phase.

Then STOP.
