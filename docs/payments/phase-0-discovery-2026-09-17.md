# Payments — Phase 0 discovery report

_2026-09-17 · branch `payments` · read-only. Prompt pack: `prompt-packs/kissago-payment-billing-prompt-pack-2026-09-17/`._

Evidence: the audit and `research/01–08` (morning of 2026-09-17), plus two new streams written for this gate:
`research/09-story-consumption-path.md` and `research/10-plan-model-and-entitlements-inventory.md`.

## 1. Audit finding status

**No application code has changed since the audit.** The only commits after it touch `docs/payments/`, and `payments`
already contains everything on `dev` and `main`. Dev DB re-queried: 0 webhook events, 12 orders, 1 subscription, and
**0 duplicate `(source_type, source_ref_id)` grants**, so a unique constraint can go on cleanly. Prod was not re-queried
(the permission classifier blocks prod reads in this session); the audit found every prod billing table empty.

| Finding | Status |
|---|---|
| B1–B7, H2, H3, H5–H10, M1–M9 | **Still valid**; code unchanged. Line anchors in the audit still hold (spot-checked B5, H10, annual block). |
| B8 (draft refund policy), H11 (checkout disclosure) | Still valid. Content/UI, not re-read. |
| H1 (no notifications), H4 (no billing identity/invoice model) | Still valid. Confirmed again: no email provider and no PDF library in `package.json`. |
| H12 (pricing / dev-prod catalog mismatch) | Still valid; superseded in intent by the owner's plan model (Plus/Studio stay admin-priced). |
| H10 (`authenticated` grant) | Still valid. Docs still don't settle per-rail behaviour, so **Phase 1 grants only on a confirmed charge** (`subscription.charged` / captured payment), which removes the ambiguity instead of resolving it. A sandbox card + UPI Autopay trace confirms timing. |

## 2. What the new plan model touches

**Already built, needs configuration only**
- **Free 50-coin trial, once, expiring.** The welcome-grant RPC (084) already honours `expiresAfterDays`, and
  `/admin/policies` already edits amount and expiry. Setting 30 days is the change. Spend order already burns expiring
  grants before top-ups, so top-ups are never lost with the trial.
- **Annual billing in the catalog.** `pricing_plan_versions.billing_interval` allows `annual`; Razorpay plan creation
  already maps it to `yearly`. Only a blanket India-annual block (server + wallet UI) stands in the way, and it must
  become plan-aware so only Audience opens.
- **A fourth plan row.** `pricing_plans.plan_key` has no CHECK; the admin server action accepts new keys.
- **Signed-out visitors.** Already sign in before a story opens (commit 025cea5). Nothing to add.

**Needs building**
- **Viewing entitlement as its own dimension.** `PlanKey` (`free|plus|studio`) is a rank ladder used for creation gates.
  Audience does not fit on it. Recommended: keep an Audience subscriber's creation tier at `free`, and add a separate
  `unlimitedViewing` result to the pricing snapshot (true for active Audience, Plus, Studio, or an admin override).
  This matches the design note already in PROJECT_STATE.
- **Daily unique-story quota.** No quota infrastructure exists. One enforcement point covers every reader: the
  `/storyline/[id]` page (RSC) plus the server action that returns beats and signed media. Count by `stories.id` (stable
  across republishes, same identity the gallery dedupes on). Race safety follows the existing locked
  reserve-and-insert pattern from the coin engine (migration 021). The quota must be checked above the IndexedDB
  fallback, or a story cached on a previous day renders offline past the limit.
- **Admin knobs.** Daily limit as a new `operational_policies` row beside the welcome grant. Audience prices and
  availability in Pricing Studio, whose plan selector is closed to the three known keys today.

**Hardcoded plan-key risks (full list in research/10 §1)**
- Safe: 7 exhaustive `Record<PlanKey,…>` maps. The compiler forces an update if the union ever changes; the
  recommendation above avoids changing it.
- Silent: two duplicate tier-fallback functions whose `else` happens to mean Free; wallet card copy whose `else` renders
  **Studio's** marketing text for any unknown plan; Pricing Studio editor defaults that treat unknown keys as Studio.
- CHECK constraints with the three keys: entitlement overrides (096) and reel style floors (048). Only 096 matters, and
  only if admins can grant Audience-level viewing.

## 3. Proposed data-model delta (not applied)

Next migration number is **124**.

| Phase | Change |
|---|---|
| 1 | Partial unique index on `beat_grants (source_type, source_ref_id)` for purchase grant types; grant paths treat a unique violation as "already granted". |
| 1 | Webhook events: allow reprocessing of `failed` rows (attempt count, last error); mark config/signature failures without payloads. |
| 1 | Checkout attempts: a DB guard against two in-progress subscriptions per user (partial unique index or an intent row). |
| 1 | Provider plan refs keyed by mode (test/live), not one cached column. |
| 1 | Purchase snapshot on orders/subscriptions (plan version, amount, currency, interval, coins promised), if not already complete. |
| 2 | Provider-neutral payments, refunds, billing documents, billing profiles; `ON DELETE` changed from CASCADE to retain + anonymise. |
| 3 | `story_consumption_days` (user, UTC-or-IST day, story_id; unique) + locking RPC; `free_daily_story_limit` policy row; viewing-override axis on 096 if approved. |

## 4. Admin delta

- **Phase 3:** daily-limit and trial settings on `/admin/policies`; Audience plan in Pricing Studio (open the key selector,
  fix Studio-default fallbacks).
- **Phase 4:** a billing panel on user detail (subscriptions, payments, refunds, grants, quota, webhook events);
  cancel, refund, re-sync, reprocess and clawback actions, all audited; guard against archiving a version with
  subscribers.

## 5. UI architecture

- `/wallet` stays the plan surface; no new `/pricing` route. Offers already come from the catalog. Per-plan copy and
  the page-wide interval toggle need to become per-offer.
- The user menu already renders any plan name and shows a manage-billing link for any non-free plan.
- Billing settings (Phase 5) hang off the same menu link.

## 6. Infrastructure

- **Email:** none; provider choice needed by Phase 6.
- **PDF:** none; library choice at Phase 6.
- **Private storage:** private R2 bucket + presigned downloads exist and fit invoices.
- **Scheduling:** one daily Vercel cron (Hobby limit). Billing reconcile rides it, plus an on-demand per-user
  reconcile when a user opens wallet/billing or a subscription looks overdue.

## 7. Test strategy

- Vitest for shared logic and route handlers with mocked Supabase and Razorpay (existing pattern).
- Concurrency invariants enforced in the database (unique indexes, locking RPCs) so they don't rely on timing in unit
  tests; migration verification queries run on dev after the owner applies each file.
- Playwright exists (`test:e2e`) for wallet/checkout surfaces up to the Razorpay modal.
- Razorpay sandbox runbook per phase for what cannot be simulated (renewal, UPI delay, refund).

## 8. Rollback and flags

- `pricing_checkout_enabled` becomes a server-enforced kill switch in Phase 1.
- New flags, all failing closed: Audience purchase, consumption quota enforcement, billing reconcile, invoice email.
- Every migration ships with its `_rollback.sql`. Rollbacks never delete financial rows; after live writes, rollback is
  "disable the flag", not "drop the table".

## 9. Decisions

See the owner-facing summary in the session; the answers are recorded in `audit-progress.md` once given.
