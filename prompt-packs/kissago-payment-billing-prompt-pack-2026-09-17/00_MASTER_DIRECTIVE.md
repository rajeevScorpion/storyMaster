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
