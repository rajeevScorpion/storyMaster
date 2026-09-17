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
