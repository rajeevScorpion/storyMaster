# Starter prompt — paste this into the AI coder

You are implementing Kissago's production-ready payment, billing, invoicing, consumption-entitlement, subscription-management, and billing-support system.

Treat this as high-risk financial work.

## First action: investigate, do not implement yet

Before changing code:

1. Read the repository's existing agent working agreements, project state, decisions, test status, changelog, and latest handoff mechanism.
2. Read every existing payment/billing source listed in:
   `SOURCE_REFERENCES.md`
   from its **existing repo path**.
3. Read this entire prompt pack.
4. Inspect the current branch, git status, recent billing/payment commits, schema/migration state, pricing/entitlement architecture, billing code, admin surfaces, design system, account/settings surfaces, story-consumption surfaces, scheduled jobs, email/storage infrastructure, and current feature flags.
5. Revalidate every blocker/high-severity audit finding against the current code. The audit is dated 2026-09-17 and may already be partially stale.
6. Inspect the actual dev/prod environment separation without exposing secrets.
7. For Razorpay behavior that materially affects implementation, verify against current **official Razorpay documentation** and sandbox behavior. Do not rely on an audit note where it was explicitly marked unconfirmed.
8. Do not perform schema writes, payment calls, refunds, cancellations, provider mutations, production changes, or code changes during this discovery gate.

## Your discovery response to the owner

Return a concise but complete implementation-readiness report containing:

- current branch + working-tree state;
- what from the audit is still true / already fixed / changed;
- architecture pieces worth preserving;
- conflicts between this pack, old docs, current code, or provider constraints;
- exact migrations likely required (do not apply yet);
- exact areas/files likely to change;
- test/rollback strategy;
- decisions that genuinely require owner input.

For every owner decision required, present:
**Finding → Options → Recommendation → Why → Consequences**.

Do not ask questions that the code or this pack already answers.

Do not make consequential assumptions.

**STOP after this discovery report and wait for owner approval before implementing Phase 1.**
