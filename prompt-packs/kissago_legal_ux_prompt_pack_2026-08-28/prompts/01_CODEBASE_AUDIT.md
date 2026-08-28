# Prompt 01 — Codebase, Auth, Legal and Data-Flow Audit

You are working on the existing Kissago production codebase. **Do not begin by rewriting UI. First investigate and document the current implementation.**

## Objective
Build a factual implementation map that will be used to redesign authentication and legal/compliance flows without breaking production behaviour.

## Investigate

### A. Authentication and account lifecycle
Find and document:
- auth framework/provider and environment-specific configuration;
- email/password sign-up, sign-in, password reset and email verification;
- Google/OAuth sign-in and whether OAuth automatically creates a user record before onboarding completes;
- where profile/account records are created;
- existing account deletion and sign-out flows;
- native/web differences, if any;
- current age, DOB, parent/guardian, educator or child-profile handling;
- whether a child can independently create an account;
- all redirects after sign-up/sign-in;
- all auth guards and protected routes.

### B. Current legal/footer system
Locate:
- footer component(s);
- current items: Policies, Terms, Support, News, AI and Rights, plus any others;
- routes/pages/modals for each item;
- backend/admin/CMS source from which the content is fetched;
- API calls, caching, loading states and formatting renderer;
- reasons for slow load, if visible from code/network architecture;
- whether legal content is accessible before login;
- any existing versioning/effective-date fields;
- any prior acceptance/consent fields in the database.

### C. Data inventory
Create a practical data map from code/schema/config. Identify only what actually exists:
- identity/account data;
- email and OAuth identifiers;
- user profile fields;
- story prompts, stories, beats, characters and story bibles;
- generated images, narration/audio, video/books or exports;
- user uploads;
- public/private/shareable content;
- subscriptions, entitlements and payments;
- analytics/telemetry;
- crash/error logging;
- device/IP/session logs;
- support messages;
- notification tokens;
- content moderation/safety records;
- parental/age-verification data, if any;
- deletion/retention logic.

### D. Vendors and processors
From package files, server code, environment-variable names and integrations, identify:
- database/auth provider;
- hosting/storage/CDN;
- AI text/image/audio/video providers;
- payment processor(s);
- analytics;
- email/notification providers;
- observability/logging;
- moderation/safety services.

Do not expose secret values. Record service names and purpose only.

### E. AI/content flow
Document:
- where AI-generated text/images/audio/video are created;
- whether generated assets carry labels, metadata or identifiers;
- whether users can publish/share/upload content to a public gallery or community;
- moderation and report/remove flows;
- whether user content is sent to third-party AI providers;
- whether any vendor is configured to retain or use submitted content for model training;
- whether Kissago itself trains or fine-tunes models on user content.

### F. Subscription and cancellation flow
Identify:
- current plan names/prices from source-of-truth;
- web vs app-store billing;
- renewal behaviour;
- cancellation flow;
- refund handling;
- invoice/tax receipt implementation;
- payment data actually stored by Kissago versus the payment provider.

## Required output
Create `/docs/legal-auth-audit.md` with:
1. Current architecture summary.
2. File/component/schema map.
3. Auth flow diagrams in Mermaid.
4. Current legal-content flow.
5. Data/vendor inventory table.
6. Child/minor account findings.
7. AI-generated-content findings.
8. Risks/blockers.
9. Exact implementation recommendations for the next prompts.
10. A section named **UNVERIFIED LEGAL FACTS** listing every fact that cannot be confirmed from code/config.

## Stop conditions
Stop and flag before implementation if any of these are found:
- minors can independently create accounts but there is no parent/guardian verification architecture;
- policy acceptance is assumed from a pre-checked box;
- OAuth can fully activate a new account while bypassing the required agreement gate;
- the product claims private content is not used for AI training but code/vendor configuration does not support that claim;
- legal pages contain hardcoded corporate/contact details that conflict across environments;
- legal content is unavailable to logged-out users.

Do not make speculative fixes in this audit prompt.
