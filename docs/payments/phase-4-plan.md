# Phase 4 — admin billing, support operations and incident tooling

**Status: plan, awaiting owner decisions. No code written.**
Source of scope: `prompt-packs/kissago-payment-billing-prompt-pack-2026-09-17/06_PHASE_4_ADMIN_SUPPORT_OPERATIONS.md`.
Written 2026-09-19, after Phase 3 went code-complete and the watch quota went live on dev.

The pack calls this a **live-money gate**, and the sentence that defines the phase is:

> A live billing system is not ready if routine support requires SQL or provider-dashboard archaeology.

That is the acceptance test. Not "an admin *can* find out" — "an admin can resolve it without SQL".

---

## 0. Scope boundary — what this phase is NOT

Read this first; the pack's Phase 4 list mentions words that belong to later phases.

| Belongs to | What |
|---|---|
| **Phase 4 (here)** | Admin-side visibility, safe admin actions, auditability, pricing-admin guardrails, incident surfaces. |
| **Phase 5** | Everything the *customer* sees: plan comparison, checkout UX, self-serve subscription management. |
| **Phase 6** | The financial-document *engine* — generating invoices/receipts/credit notes, PDFs, billing email. |

So when the pack says the admin panel shows "invoices/receipts/credit notes", Phase 4 **renders the
`billing_documents` rows that exist**; it does not generate them. `billing_documents` has **0 rows on dev**
and issuing sits behind `billing_document_issuing_enabled`, so that section of the panel will be
legitimately empty until Phase 6. Build it to show emptiness honestly rather than to look finished.

---

## 1. Verified current-state facts

Read from the code and the dev database on 2026-09-19. Where a previous audit was wrong, that is called out
— two of its findings have gone stale.

### What already exists and must be extended, not duplicated

1. **`admin_user_audit_events` (migration 083) already has exactly the audit shape this phase needs.**
   `target_user_id`, `actor_user_id`, `action_type`, `reason` (NOT NULL), `request_key`, `before_json`,
   `after_json`, `metadata_json`, `created_at`, plus indexes on target and actor
   (`supabase/migrations/083_admin_user_management.sql:173-203`). There is no reason to invent a billing
   audit table. **But `action_type` carries a hardcoded CHECK**, so every new admin action in this phase is
   a `23514` until the constraint is widened — the same defect class as migration 129's plan-key CHECKs.

   **There is already a precedent for widening it: migration 096.** 083 defined five values; the live
   constraint on dev has **six**, because `096_user_entitlement_tier_overrides.sql:66-76` dropped and
   re-added it with `entitlement_tier_changed`. Verified against the dev database, not inferred. Unit A
   copies 096's shape exactly, including its `DO` block that finds the existing constraint by name before
   dropping it.

   **096's rollback is the part to read before copying it.** Narrowing the CHECK cannot coexist with rows
   already written under the new values, so 096's rollback *deletes that slice of history*
   (`096_..._rollback.sql:9-11`). That was acceptable for a tier change. It is **not** acceptable here: the
   same move would delete refund and cancellation audit rows, which are financial history in a record kept
   eight years. Unit A's rollback must therefore **leave the widened CHECK in place** and revert only what
   else it adds. A CHECK that permits more values than any code writes is harmless; deleting money history
   to tidy a constraint is not.

2. **`request_key` already provides idempotency**, via
   `uq_admin_user_audit_request_key` — a UNIQUE partial index on non-null keys
   (`083_admin_user_management.sql:194-196`). The master directive requires every money effect to be
   idempotent; the mechanism is already here and already used by the coin-grant flow. Provider mutations
   added in this phase must ride it rather than invent a second scheme.

3. **`cancelRazorpaySubscription` exists** (`lib/billing/razorpay.ts:186`). This **corrects
   `research/04-admin-tools-and-operations.md` finding F1**, which said no cancel capability existed
   anywhere; it was true when written and was added later for the account-deletion flow.

4. **No refund wrapper exists.** `lib/billing/razorpay.ts` exports plan/subscription/order/payment
   create-and-fetch helpers, capture, the signature verifiers, and cancel — and nothing that calls
   Razorpay's refund API. Grepping the file for `refund` returns nothing. **A refund action is therefore
   new provider-mutation code, not a UI wiring job**, and it is the single riskiest item in this phase.

5. **Re-sync from provider already exists**, as "Recovery Tools" in the pricing studio
   (`components/admin/PricingStudio.tsx:2168+`, section `recovery-tools`, reached at
   `/admin/pricing/recovery-tools`). It reconciles a subscription or a top-up payment. Two things are
   wrong with it for support use rather than testing: its own banner says *"Use these only during internal
   testing"*, and it is **ID-driven** — you must already know the Razorpay subscription id or the internal
   billing order id, which is exactly the archaeology this phase exists to remove. Phase 4 should reach
   these same actions from the user's record, not re-implement them.

6. **Webhook reprocessing already exists**, in `lib/billing/razorpay-reconcile.ts` (`:313`, `:329`) and the
   webhook route (`app/api/billing/razorpay/webhook/route.ts:70`), driven by the daily cron at
   `app/api/batch/reconcile/route.ts`. What does not exist is an **admin-triggered reprocess of one named
   event**, or any **visibility** into failed events at all.

7. **Migration 124 already added the incident columns.** `billing_webhook_events` carries `attempt_count`,
   `last_attempt_at` and `outcome` on top of 016's `status`
   (`received`/`processed`/`failed`/`ignored`), `error_message`, `payload_json`, `related_user_id` and
   `related_subscription_id`. **An incident dashboard needs no new schema** — only a read.

### The gap

8. **The admin user detail page shows no billing data whatsoever.**
   `components/admin/users/AdminUserDetail.tsx` (632 lines) shows the plan key, coin balance, lifetime
   grants and a coin-grant form. It never reads `billing_orders`, `billing_subscriptions`,
   `billing_payments`, `billing_refunds`, `billing_documents`, `billing_webhook_events` or
   `billing_profiles`. Every support question in the pack's "exit support cases" list currently requires
   SQL.

9. **Phase 3's watch quota has no admin surface at all.** `user_daily_watch_slots` and
   `consume_watch_slot` shipped in migration 129 and the quota is live on dev, but nothing anywhere
   answers "why did this Free user hit the limit" — which the pack lists explicitly as an exit case. The
   data is one indexed read away (`user_daily_watch_slots` is indexed on `(user_id, local_day)`).

### Live dev data — what a panel will actually show today

| Table | Rows on dev | Consequence for this phase |
|---|---|---|
| `billing_orders` | 17 | The only billing table with real history to render. |
| `billing_subscriptions` | 1 | One test subscription. |
| `billing_payments` | **0** | **The Phase 2 ledger has never been exercised.** |
| `billing_refunds` | 0 | Nothing to render until a refund or dispute runs. |
| `billing_documents` | 0 | Empty until Phase 6, by design. |
| `billing_profiles` | 0 | Nobody has entered billing details. |
| `billing_webhook_events` | 3, **0 failed** | The webhook is landing. No incident to look at. |
| `beat_grants` | 10 | Purchase→coin links exist. |
| `admin_user_audit_events` | 2 | The audit trail is live and in use. |
| `user_daily_watch_slots` | 0 | Quota is live; nobody has watched yet today. |

**This is the most important row in the table: `billing_payments` is empty.** A payments panel built and
"verified" against dev will be verified against nothing. Either the money walk on the preview
(`phase-2-plan.md` §6, still owner-pending) happens first, or this phase's verification is explicitly
seeded — see §6.

---

## 2. Owner decisions needed before any code

The master directive requires a stop when ambiguity touches refunds, clawback, or provider configuration.
These are those points. **None of the units below that depend on a decision should start until it is
answered.**

**D1 — Full refunds only, or partial too?**

The "who" half of this question turns out to be already answered, and not by choice: **`verifyAdmin` is a
single environment variable.** `lib/supabase/admin.ts:24-38` compares the session user to
`process.env.ADMIN_USER_ID` and throws `Forbidden` otherwise — there is no role table, no allow-list, no
DB-backed permission anywhere. `isAdminUserId` (`lib/pricing/enforcement.ts:686-689`) is the same env var
as a bare predicate. So there is exactly one admin account, and "which admins may refund" cannot be
designed without first building a role system — which the owner **deferred on 2026-09-14** along with the
role audit. Phase 4 should not quietly reopen that.

What is left to decide is the **amount**: full-refund-only, or partial allowed? Full-only is materially
simpler — it needs no proration UI, no "how much is left" arithmetic, and it cannot produce a partial
refund larger than the payment. Partial is what real support cases ask for. *Blocks Unit C.*

**D2 — Does a refund claw back coins, and what if they are already spent?**
`research/06-razorpay-capabilities.md` §4 and `research/01` F5 both flag this as an open business-risk gap:
today a refund reverses money and leaves granted coins alone. Options: revoke unspent `beats_remaining`;
revoke nothing; flag the account for review; allow a bounded negative adjustment the admin chooses. The
pack asks for "bounded negative coin adjustment/clawback", which implies a bound — the bound is a decision.
*Blocks Unit C. Also the unanswered half of the dispute work already shipped in Phase 3.*

**D3 — "Cancel immediately" — what happens to the paid-for remainder?**
Cancel-at-cycle-end is unambiguous. Cancel-immediately can either keep entitlement to the period end
(cancel the renewal, keep the access paid for) or end access now (and imply a pro-rata refund, which drags
in D1/D2). *Blocks Unit C.*

**D4 — May an admin act on a plan/version that has active subscribers?**
The pack says prevent dangerous archival/deactivation "or require an explicit, informed confirmation".
Hard block or informed confirmation? *Blocks Unit E.*

**D5 — Where do incident alerts go, if anywhere?**
The pack asks for "owner-facing alerts, actionable and non-spammy". There is no notification
infrastructure for this, and notifications were deliberately deferred by the owner on 2026-09-14.
Recommendation: Phase 4 ships **a dashboard only**, no push — which keeps that deferral intact.
*Shapes Unit F; does not block it, since the dashboard is the same work either way.*

---

## 3. Unit split

Sized so each unit is independently committable and independently reviewable, and ordered so the
read-only work lands before anything that can mutate money.

| Unit | What | Depends on | Risk |
|---|---|---|---|
| **A** | Migration 131 — widen `admin_user_audit_events.action_type`; any index the panel needs | — | low |
| **B** | The read-only billing panel on the admin user record | — | low |
| **C** | Safe admin actions: cancel, refund, re-sync, reprocess, clawback | A, **D1–D3** | **high** |
| **D** | Quota inspection — "why did this user hit the limit" | — | low |
| **E** | Pricing-admin guardrails around archival/deactivation | **D4** | medium |
| **F** | Incident dashboard | — (D5 shapes it, does not block) | low |

**A, B, D and F need no decision and can start cold.** Only C and E wait.

**Unit B is the one that pays for itself fastest** and carries no money risk: it is reads only. If this
phase has to stop early, stopping after B leaves real value and nothing half-built.

**Unit C is the dangerous one.** It introduces the first code in this codebase that can move money *out*.
It should be built last among the mutating units, behind its own kill switch, and reviewed against the
failure matrix in `11_QA_SECURITY_FAILURE_MATRIX.md`.

---

## 4. Migration 131 (Unit A) — shape

Full SQL is written when D1–D3 settle which actions exist. The shape is fixed:

- Drop and re-add `admin_user_audit_events_action_type_check` with the six existing values **plus** the new
  ones. Copy 096's `DO` block, which looks the constraint up by name rather than assuming it.
- Add nothing else unless a panel query proves it needs an index. `billing_webhook_events` already has
  `idx_billing_webhook_events_status (provider, status, received_at DESC)` from 016 and
  `idx_billing_orders_reconcile` from 124; `user_daily_watch_slots` already has `(user_id, local_day)`
  from 129. **Measure before adding an index** — the tables this phase reads are small and already
  indexed on the columns a support lookup filters by.
- The rollback widens nothing back. See fact 1.

Candidate `action_type` values, to be finalised with D1–D3:
`subscription_cancelled_at_cycle_end`, `subscription_cancelled_immediately`, `payment_refunded`,
`subscription_resynced`, `webhook_reprocessed`, `coins_clawed_back`.

## 5. The failure modes this phase must survive

From `11_QA_SECURITY_FAILURE_MATRIX.md`, the four that are Phase 4's own. The first is the one that
decides Unit C's architecture.

**"Refund API succeeds but local write initially fails."** The classic dual-write. Money has left, and our
ledger does not know. **The design answer is already in the codebase and must be used rather than
re-solved:** the admin action *initiates* the refund at Razorpay; the `refund.processed` webhook is the
source of truth for the record, and `recordRefund` is idempotent on `(provider, provider_mode,
provider_refund_id)` (`lib/billing/ledger.ts`). So the local write after the API call is a
convergence optimisation, not the record — and if it fails, the webhook or the daily reconcile still lands
it. **Unit C must not report success to the admin on the strength of its own write**, and must not treat a
failed local write as a failed refund, which would invite a second refund of the same payment. The
`request_key` idempotency in fact 2 is what stops that second attempt.

**"Subscription cancels at provider but webhook missed."** Covered by the existing reconcile backstop; Unit
C's re-sync action is the manual trigger for the same path.

**"Plan disabled while existing subscriber active."** Unit E, gated on D4.

**"Account blocked/deleted while subscription active."** Already handled — Phase 2 Unit C cancels a live
subscription with the provider before deletion proceeds. Verify, do not rebuild.

Security requirements that apply to every action in Unit C, from the same file: admin permission is
re-checked **server-side** on every action; no provider mutation is ever made from the browser; no
client-trusted amount, plan or owner; logs redact PII and secrets.

## 6. Verification gate — and the problem with it

The acceptance criteria this phase must meet (`13_ACCEPTANCE_CRITERIA.md`, "Admin/support"):

- [ ] User billing state visible without SQL
- [ ] Refund/cancel/re-sync/reprocess actions are safe and audited
- [ ] Negative coin adjustment/clawback exists under approved rules
- [ ] Failed webhook/reconcile mismatches are visible
- [ ] Consumption quota/config visible and editable
- [ ] Active-subscriber safety around catalog changes

**`billing_payments` has 0 rows on dev, `billing_refunds` 0, `billing_profiles` 0, and there are 0 failed
webhook events.** A panel built against this database renders empty in every section that matters, and
"it rendered without crashing" is not evidence that it renders the right thing. There are only two honest
ways to close this, and the choice is the owner's:

1. **Do the Phase 2 §6 money walk on the preview first** — buy a top-up, subscribe, refund one from the
   Razorpay dashboard. That produces real payment, refund and webhook rows, and Phase 4 is then verified
   against real data. This is the better answer and it is already an outstanding owner action.
2. **Seed dev deliberately**, with a documented script that writes known rows and is reverted after. Faster,
   but it verifies the panel against data we invented, which is exactly how a wrong `subject_ref` or a
   wrong join survives review.

Recommendation: **(1)**, and it is a reason to do the money walk before this phase rather than after.

## 7. Kill switch

Unit C's mutating actions ship behind a new operational flag, off by default, alongside
`account_deletion_enabled` in `lib/admin/operational-flags.shared.ts` — the registry added in Phase 2 that
already carries `defaultEnabled: false` for every entry and now supports a `beforeEnabling` pre-flight note.
Units B, D and F are read-only and need no switch.

## 8. Still open, carried from earlier phases

- **Phase 2 §6's money walk** and a throwaway-account deletion test are still owner-pending. See §6 — this
  phase's verification depends on the first of them.
- **Audit finding 11**: dev Plus ₹850 vs prod ₹1,450.
- **ROW prices are unsettled** (owner, 2026-09-19: a future decision). Audience ROW is published at
  $300.00 and Plus ROW monthly at $0.00, both masked today because `pricing_india_only_beta_enabled` is on.
  Unit E's archival guards are the surface that would eventually make changing them safe.

---

## 9. Per-unit design

The existing patterns every unit below must follow, established by reading `app/actions/admin-users.ts`:

- **Guard first, always server-side.** Every exported admin action opens with `await verifyAdmin()`, then
  `createAdminClient()` for the work. Actions needing the actor destructure it:
  `const { user: actor } = await verifyAdmin();`.
- **Validate with a pure normalizer** in a `.shared.ts` module that throws user-facing `Error` text —
  `normalizeCoinGrantInput` (`lib/admin/user-management.shared.ts:235-273`) is the model — plus the local
  `assertUuid` / `assertRequestKey` / `normalizeReason` helpers (`admin-users.ts:743-765`).
- **Revalidate and reload**: `revalidatePath('/admin/users')` and `/admin/users/[id]`, then return a freshly
  loaded detail object rather than patching client state.
- **Confirm destructive things with `ConfirmDialog`** (`components/ui/ConfirmDialog.tsx`) — a portal
  `alertdialog` with `tone: 'default' | 'danger'` and a `busy` prop that blocks Escape and backdrop
  dismissal. Already used in eight components, including twice in `AdminUserDetail.tsx`.

**Two audit styles already coexist, and the choice matters.** Coins, moderation and cohorts are audited
*inside* their SQL function; the entitlement-tier change audits with an explicit TS insert whose failure is
logged rather than thrown, on the reasoning that *"the tier change already landed; losing its audit row
must not fail the call"* (`admin-users.ts:335-338`). **For Unit C, invert that.** A refund whose audit row
is lost is a money movement with no record, in a system that must keep eight years of them. Write the audit
row **before** the provider call, with the outcome patched in after — so a crash mid-flight leaves evidence
that an attempt happened, rather than silence.

### Unit A — migration 131 (unblocked)

Widen `admin_user_audit_events_action_type_check` per §4. Copy 096's `DO` block. Rollback does not narrow.

### Unit B — the read-only billing panel (unblocked, highest value)

`AdminUserDetailData` (`lib/admin/user-management.shared.ts:109-114`) has exactly four fields today:
`user`, `walletActivity`, `auditEvents`, `recentStories`. `getAdminUserDetailInternal`
(`app/actions/admin-users.ts:469-525`) fills them with five parallel reads — the `admin_list_users` RPC,
`admin_user_audit_events`, `beat_grants`, `beat_usage_events` and `stories` — plus
`loadEntitlementOverrides`. **It reads no billing table at all.**

Add a fifth field, `billing`, loaded by additional parallel reads in the same `Promise.all`, and render it
as new sections in `AdminUserDetail.tsx`:

| Section | Source | Note |
|---|---|---|
| Subscription | `billing_subscriptions` | status, plan version, interval, provider ids, `current_period_end`, `first_charge_confirmed_at`, cancel state |
| Orders | `billing_orders` | the only table with real history on dev (17 rows) |
| Payments | `billing_payments` | **empty on dev** — see §6 |
| Refunds & disputes | `billing_refunds` | `initiated_by = 'dispute'` is how a dispute appears |
| Documents | `billing_documents` | empty until Phase 6, by design |
| Billing profile | `billing_profiles` | GSTIN/address; empty on dev |
| Webhook events | `billing_webhook_events` | filtered by `related_user_id` |

Two things to get right rather than assume: `currentPlanKey` already comes from the `admin_list_users` RPC
rather than from a billing read, so the panel must not contradict it — if the RPC and
`billing_subscriptions` disagree, **that disagreement is itself the support finding** and should be shown,
not hidden by preferring one. And every section needs a deliberate empty state, because most of them will
be empty on dev.

**No new indexes on spec.** These tables are small and already indexed on the columns a support lookup
filters by. Measure first.

### Unit C — safe admin actions (blocked on D1–D3)

New Razorpay wrapper: a refund call, which does not exist today (fact 4). Everything else composes what is
already there — `cancelRazorpaySubscription` (`lib/billing/razorpay.ts:186`), and the four recovery actions
in `app/actions/pricing-admin.ts`: `reconcilePricingSubscription` (`:946`), `reconcilePricingTopup`
(`:964`), `ensureUserFreeWelcomeGrant` (`:981`), `expirePricingReservations` (`:1003`). **Reach those from
the user's record instead of re-implementing them**, and drop the "internal testing only" framing once they
are support tools.

**Idempotency is not optional and the mechanism exists.** `admin_grant_user_coins`
(`083_admin_user_management.sql:1071-1197`) takes `pg_advisory_xact_lock(hashtextextended(request_key, 83))`,
looks the key up in `admin_user_audit_events`, returns the prior result with `already_applied = true` if
found, and raises if the key was reused for a different target. Cohorts do the same with salt `84`.
**Unit C's mutations need their own salt** — pick the next one and record it here so nobody reuses 83.
The client supplies the key: `manual:${crypto.randomUUID()}`
(`components/admin/users/AdminUserDetail.tsx:396`).

Refund architecture is decided by the failure matrix, not by preference — see §5. The webhook is the record;
the action initiates. Never report success on the strength of the local write.

Every mutating action here is behind the §7 kill switch and a `ConfirmDialog` with `tone="danger"`.

### Unit D — quota inspection (unblocked)

"Why did this Free user hit the limit" is one read of `user_daily_watch_slots` for the user's current IST
day, joined to storyline titles, plus the resolved policy: is this account exempt, and what limit applied.
`peekWatchQuota` (`lib/pricing/watch-quota.ts`) already computes exactly that shape for the reader; the
admin view is the same question asked about someone else, so extract rather than duplicate. Show the IST
day boundary explicitly — "hit the limit" is a question about *which day*, and IST-for-everyone is an owner
decision (11) a support person will not have memorised.

### Unit E — catalogue guardrails (blocked on D4)

**There is no subscriber guard anywhere, and the archive buttons do not even confirm.** Verified:
`archivePricingPlanVersion` (`app/actions/pricing-admin.ts:416-453`) guards only `verifyAdmin`, existence,
and already-archived, then writes blindly. `publishPricingPlanVersion` (`:334-414`) *silently archives the
currently published version* of the same plan/interval/market. `upsertPricingPlanBase` (`:1103-1124`)
writes `is_active` with no guard at all. A grep of that whole file for billing tables returns zero matches.
On the UI side, `PricingStudio.tsx` **does not import `ConfirmDialog`** — "Archive Current" (`:1411-1427`)
fires immediately on click, as do the legacy-pack, top-up, promotion and tax-rule archive buttons.

So Unit E is two things: a subscriber count consulted before the write, and a confirmation in front of it.
D4 decides whether the count hard-blocks or merely informs.

*Not ruled out by this pass: a database-side trigger or constraint enforcing something. Nothing in
application code does. Check the schema before concluding there is no guard at all.*

### Unit F — incident dashboard (shaped by D5)

**This needs new server actions; it cannot read existing helpers.** `lib/billing/razorpay-reconcile.ts`
exports only `reconcileRazorpayBilling()` and its result interface — four counts of items *processed*. The
predicates that define an incident live in **private** functions in that file and are not callable:

| Incident | Predicate, from `razorpay-reconcile.ts` |
|---|---|
| Failed webhooks | `status='failed' AND attempt_count < 10`, or `status='received' AND received_at < now-15min` (`:290`) |
| Stuck subscription checkouts | `order_type='subscription_checkout'`, `status in ('created','abandoned','superseded')`, age 10min–7d (`:86-170`) |
| Subscriptions past their boundary | `first_charge_confirmed_at is null OR current_period_end < now OR last_webhook_at < now-2d` (`:186`) |
| Stuck top-ups | `order_type='topup_checkout'`, `status in ('created','attempted','failed')` (`:229-281`) |

Extract those predicates into a shared module so the cron and the dashboard cannot drift apart — a
dashboard that counts "failed webhooks" differently from the job that fixes them is worse than no
dashboard. Read-only, `verifyAdmin`-guarded, no new schema.

Note the cron route is **not** `verifyAdmin`-guarded — `app/api/batch/reconcile/route.ts:16-22` uses a
`CRON_SECRET` bearer and is permissive when the secret is unset outside production. Do not copy that
pattern into an admin surface.

---

## 10. Execution order for a fresh session

1. **Unit A**, then **Unit B** — neither needs a decision, and B is what removes SQL from support.
2. **Unit D**, then **Unit F** — still read-only, still no decisions.
3. Stop. Get D1–D4 answered before **C** and **E**, which are the only units that can change money or
   break a live subscriber.

Commit per unit. Review the diff, not the report — every agentic phase in this project has had defects the
suite passed over, and Phase 3 found four of them by reading.
