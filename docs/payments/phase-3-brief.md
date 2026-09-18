# Phase 3 — brief, not yet a plan

Written 2026-09-18 (Opus), at the end of the session that finished Phase 2.

**Read this as a starting point, not as an implementation plan.** `WORKING_AGREEMENTS.md` requires a plan to be
a self-contained handover — exact files, line-anchored edits, complete migration SQL, a verified-facts section.
This is not that. It is the scope, the facts that were cheap to verify today, and the questions that must be
answered before a plan can be written. It exists so the next session starts from something rather than nothing.

Authoritative scope: `prompt-packs/kissago-payment-billing-prompt-pack-2026-09-17/05_PHASE_3_PLANS_ENTITLEMENTS_CONSUMPTION.md`.
Note the numbering clash: `billing-plan-2026-09-17.md` calls support tooling "Phase 3". **The pack wins** — the
handoff has always treated the pack as the source, and owner decisions 1-4 and 7 were filed against the pack's
Phase 3.

---

## 1. What Phase 3 actually is

Four things, and it is bigger than Phase 2:

1. **An entitlement model** replacing plan-name conditionals. The pack is explicit: *"do not solve this by
   scattering plan-name conditionals"*. Plans should describe capabilities (daily quota, unlimited consumption,
   trial grant, recurring coins, whether top-ups permit creation, export rights, story-length rights).
2. **A new tier, Audience** — consumption-first: unlimited watching, no recurring creation coins, target ₹199
   monthly and ₹1,799 annual, all admin-configurable.
3. **Annual billing**, now in scope, which the code currently refuses outright.
4. **A daily watch quota for Free** — 3 unique stories a day, admin-configurable, counted by unique story, with
   replays free, enforced server-side, race-safe across devices.

## 2. Verified today (facts, checked in the code — everything else is unverified)

- **`PLAN_KEYS = ['free', 'plus', 'studio']`** (`lib/types/pricing.ts:20`) is a const union that `PlanKey` derives
  from. Adding `'audience'` widens a type used across the app: **47 hardcoded `'plus'`/`'studio'` comparisons in
  22 non-test files**. That count is the real size of item 1 above, and it is why the pack says to audit the
  hardcoding before designing.
- **Annual is already modelled, only refused.** `BILLING_INTERVALS` already contains `'annual'`
  (`lib/types/pricing.ts:23`) and `pricing_plan_versions.billing_interval` carries it. The block is a single
  explicit refusal at `app/actions/pricing-checkout.ts:167` for Razorpay + annual. Unblocking it is not a schema
  problem; the open questions are provider-side (mandate lifecycle, renewal cadence, invoice semantics,
  upgrade/downgrade, cancel-at-cycle-end) and were never tested.
- **A welcome grant mechanism already exists and should be reused, not rebuilt.** `apply_free_welcome_grant`
  (migration `084_operational_policies_and_welcome_grant.sql`), called from `lib/pricing/enforcement.ts:193`,
  with an admin entry point `ensureUserFreeWelcomeGrant` (`app/actions/pricing-admin.ts:981`). Free's 50 trial
  coins, their 30-day expiry and their never-refilling belong here.
- **There is no user timezone anywhere in this codebase.** The only IST-aware code is
  `lib/billing/financial-year.shared.ts`, written in Phase 2 for financial years. Owner decision 4 (reset at
  midnight in each user's own timezone) therefore needs new storage, browser capture, and an anti-gaming rule,
  with nothing to build on.
- **The closest existing consumption event is `storyline_views`** (`007_storyline_likes_views.sql:16`), written
  only from `app/actions/engagement.ts:116`. It is **`UNIQUE(user_id, storyline_id)` — a lifetime unique view,
  not a daily one**, so it cannot serve as the quota ledger as it stands: a replay on a later day writes no row.
  It is also `ON DELETE CASCADE` from `auth.users` and is removed by account deletion.

## 3. Decisions the owner must make before a plan can be written

1. **Which event consumes a slot.** The pack asks for the least gameable option that does not punish accidental
   taps or failed loads. Decision 2 already says "when a story opens and its content loads", which reads as
   first successful content load. That still needs pinning to a specific call site, and it interacts with the
   `storyline_views` shape above.
2. **Where the daily counter lives.** A new per-day table keyed `(user_id, local_day, storyline_id)` is the
   obvious shape and makes the unique-per-day rule a unique index — which is also what makes the two-device
   race safe rather than hopeful. Confirm before anyone builds a counter column.
3. **How a user's timezone is captured and how switching it is policed.** Decision 4 named the rule; nothing
   implements it. Options range from "store the browser offset at sign-in and only ever let the day boundary
   move forward" to "IST for everyone in the India-only beta, revisit at international". The second is far
   cheaper and may be right for now — it is an owner call, not an executor's.
4. **Whether Audience ships with annual from day one**, given that no annual subscription has ever been run
   through Razorpay in this codebase, in any environment.
5. **The Audience launch prices**, and whether the dev and prod catalogues are finally reconciled — audit
   finding 11 (dev Plus ₹850 vs prod ₹1,450) is still open.

## 4. What a fresh session should do first

In this order, and **not** as a single agent handoff:

1. **The hardcoding audit the pack asks for** — the 47 references above, classified into "really means a
   capability" versus "really means that plan". That audit is the input to the entitlement model, and doing it
   second means designing blind.
2. **Decide the entitlement representation.** `pricing_plan_versions` already carries per-plan columns
   (`monthly_included_beats`, `story_length_cap`, `carry_forward_cap_multiplier`, `extensions_json`).
   `extensions_json` may already be the intended home for capabilities; check before adding columns.
3. **Take decisions 1-5 above to the owner in one pass**, the way Phase 2's decision gate worked.
4. **Then** write `docs/payments/phase-3-plan.md` to the Phase 2 standard and split it into units.

A likely unit split, offered only as a starting shape: (A) entitlement model and the hardcoding migration,
no behaviour change; (B) the daily quota ledger, server enforcement and the race guard; (C) Audience as a
catalogue tier plus the annual unblock; (D) the quota UX and upgrade path; (E) admin controls. A and B are
independent; C depends on A; D depends on B.

## 5. Why this is a brief and not a plan

The session that wrote it ended Phase 2 at roughly 75% of its window. Writing a self-contained Phase 3 plan
means auditing 47 call sites, settling the entitlement representation, and resolving five owner decisions —
that is a session's work on its own, and a plan written without it would be intent dressed as a plan, which
`WORKING_AGREEMENTS.md` explicitly rejects. The facts above were verified so that work does not start from
zero.
