# Admin tools and billing operations

_Stream 4 · audited 2026-09-17 · branch payments_

## Scope and method

Auditing every admin capability that touches money or coins: pricing studio, user
management, cost dashboards, scheduled/background jobs (cron, reconcile, sync),
and support-desk readiness for live-money operations. Read-only: source code review
plus (planned but not yet used) SELECT-only Supabase queries. No files modified
except this one. No DB queries were actually run yet (ran out of turn on code
reading first) — see Resume section.

Sources fully read:
- `lib/supabase/admin.ts` (verifyAdmin gate)
- `app/admin/layout.tsx`, `app/admin/page.tsx`
- `app/actions/pricing-admin.ts` (full file, 1418 lines)
- `app/actions/admin-users.ts` (full file, 782 lines)
- `lib/admin/user-management.shared.ts` (partial — grant/tier normalization functions)
- `lib/pricing/enforcement.ts` (partial — reconcile/expire/welcome-grant functions, lines ~460-640)
- `lib/billing/razorpay-sync.ts` (full file, 252 lines)
- `lib/billing/razorpay.ts` (export list only, lines 1-162)
- `app/actions/cost-admin.ts` (full file, 360 lines)
- `app/api/batch/reconcile/route.ts` (full file — the only Vercel cron)
- `app/api/billing/razorpay/webhook/route.ts` (full file)
- `vercel.json` (full — only one cron registered)
- `app/admin/pricing/recovery-tools/page.tsx`, `app/admin/pricing/audit/page.tsx`
- `components/admin/PricingStudio.tsx` lines 1778-2057 (Recovery Tools section + editor builders only)
- `supabase/migrations/083_admin_user_management.sql` (the RPCs: `admin_grant_user_coins`,
  `admin_set_user_moderation`, partial read of others)
- `docs/razorpay-stage-rollout-runbook.md` (full)
- `docs/production-pricing-rollout-checklist.md` (full)
- `docs/future-subscription-account-management.md` (full)
- `app/actions/pricing-checkout.ts` lines 240-310 (Razorpay plan lazy-creation only)
- Directory listings of `app/admin/**`, `app/api/**/route.ts`

Sources NOT yet read — see `## Resume here`.

## Findings

Severity-ordered. Every row VERIFIED by reading the cited code unless marked INFERRED.

| ID | Severity | Status | Finding | Evidence | Failure scenario | Direction |
|----|----------|--------|---------|----------|-------------------|-----------|
| F1 | BLOCKER | VERIFIED | No refund or subscription-cancellation capability exists anywhere in the code — no admin UI button, no server action, no Razorpay API wrapper. | `lib/billing/razorpay.ts:59-162` exports only `createRazorpayPlan`, `createRazorpaySubscription`, `fetchRazorpaySubscription`, `createRazorpayOrder`, signature helpers — no cancel/refund function. Grep of `app/actions/**` and `lib/billing/**` for cancel\|refund\|chargeback\|dispute found no billing-related hits (only unrelated image/agentic-job "cancel"). `docs/future-subscription-account-management.md:1-48` explicitly defers all cancellation/plan-change implementation and documents that checkout blocks a second subscription with "Subscription changes will stay manual until account management is live" — but no manual admin procedure exists either. | A real customer asks to cancel or disputes a charge; no in-product way to act. Admin must go to the Razorpay dashboard directly and then hand-reconcile Kissago's DB (no documented procedure, no SQL script provided in the repo for this). | Build minimal cancel-subscription and refund-payment admin actions (call Razorpay's cancel/refund APIs, then run the existing reconcile-subscription sync so DB state matches) before taking real payments. |
| F2 | HIGH | VERIFIED | No admin UI shows a user's `billing_orders` or `billing_subscriptions` (payments, orders, subscription status/history). | Grep of `app/admin/**` and `components/admin/**` for `billing_orders`\|`billing_subscriptions`: zero hits. Those tables are only queried in `app/actions/pricing-runtime.ts`, `app/actions/pricing-checkout.ts`, `app/api/billing/razorpay/{verify,webhook}/route.ts` — all non-admin runtime paths. `getAdminUserDetailInternal` (`app/actions/admin-users.ts:469-525`) loads only `admin_list_users` RPC, `admin_user_audit_events`, `beat_grants`, `beat_usage_events`, `stories` — no billing tables. `docs/razorpay-stage-rollout-runbook.md:222-254` tells engineers to query `billing_orders`/`billing_subscriptions` directly via raw SQL for stage debugging, confirming the gap is known and currently accepted only for stage. | User says "I paid but got no coins." Admin has no lookup screen for that user's orders/payments/subscription status and must ask the user for a Razorpay payment/subscription ID they likely don't have, or query the DB by hand. | Add a billing detail panel to the admin user page joining `billing_orders` + `billing_subscriptions` + `billing_webhook_events` by user id. |
| F3 | HIGH | VERIFIED | Admin coin grants are one-directional (positive only) — no way to deduct/claw back coins through the UI. | `normalizeCoinGrantInput` (`lib/admin/user-management.shared.ts:245-247`) throws if `coins <= 0`. The backing RPC `admin_grant_user_coins` (`supabase/migrations/083_admin_user_management.sql:1098-1103`) also requires `p_beat_amount > 0` and `p_coin_amount > 0`. Ceiling is `MAX_ADMIN_COIN_GRANT = 10_000_000` (`lib/admin/user-management.shared.ts:6`) — high but only in the grant direction. | Admin fat-fingers a grant (e.g. adds three extra zeros) or a user receives coins fraudulently; nothing in the UI can reverse it — requires direct SQL against `beat_grants`. | Add a bounded negative-adjustment path reusing the same idempotency/audit pattern as `admin_grant_user_coins`. |
| F4 | HIGH | VERIFIED | No admin UI to view or replay webhook events. | `billing_webhook_events` is written by `app/api/billing/razorpay/webhook/route.ts:59-102` (status `received`→`processed`/`failed`, with `error_message`). Repo-wide grep for `billing_webhook_events` found only that route plus two migration files and docs — no admin page reads it. | A webhook silently fails (`status='failed'`); nothing surfaces this to an admin — discoverable only via Vercel function logs or direct SQL. The manual reconcile tool (see F7) is a workaround only if the admin already knows *which* order/subscription is broken. | Add a read-only webhook-events list (status, event_type, error_message, related_user_id) with a "replay" action that re-runs `processWebhookPayload` from the stored `payload_json`. |
| F5 | HIGH | VERIFIED | Blocking/suspending a user does not touch their Razorpay subscription — it keeps renewing and granting coins. | `admin_set_user_moderation` (`supabase/migrations/083_admin_user_management.sql:950-1070`) writes only to `user_account_moderation`. `grantSubscriptionCycleIfMissing` (`lib/billing/razorpay-sync.ts:177-230`) grants each renewal cycle based solely on subscription status (`active`/`authenticated`) and a per-cycle idempotency key — no join against moderation status anywhere in the file. | A user is blocked for abuse while on an active Plus/Studio subscription. Razorpay keeps auto-charging them every cycle and the webhook keeps granting monthly coins to a blocked account — money keeps flowing to a banned user with no admin alert or linkage. | Either warn the admin on block that an active subscription exists (once F2's lookup exists) and/or auto-attempt a best-effort cancel (needs F1 first). |
| F6 | MEDIUM | VERIFIED (gap) / INFERRED (impact) | Stale coin-reservation expiry (`pricing_expire_stale_reservations`) is reachable only by an admin manually clicking "Release old holds" — no cron calls it. | `vercel.json:1-9` defines exactly one cron, `/api/batch/reconcile` at `0 3 * * *`. Its handler (`app/api/batch/reconcile/route.ts:58-117`) reconciles image/narration/reference jobs, drains the agentic queue, and runs retention cleanup — it never calls `expireStaleReservations()`/`pricing_expire_stale_reservations`. That function is called only from `expirePricingReservations()` in `app/actions/pricing-admin.ts:1003-1007`, wired to the recovery-tools "Release old holds" button. | Did **not** confirm whether the reserve/spend path in `lib/pricing/enforcement.ts` lazily treats expired-but-unreleased reservations as inert at read time — if it does, the operational risk here is smaller (stale rows just sit unused) rather than actively blocking a user's balance. Flagged for follow-up. | Add reservation expiry to the daily cron (or a dedicated more-frequent cron) rather than relying on an admin remembering to click a button; confirm the lazy-read behavior either way. |
| F7 | MEDIUM | VERIFIED | The only admin tooling for "payment succeeded but coins didn't land" / "payment failed, retry" is explicitly labeled internal/stage-testing tooling, and requires already knowing the Razorpay subscription/order/payment ID (no lookup screen — see F2). | `components/admin/PricingStudio.tsx:1778-1786`: "Use these only during internal testing when a payment or wallet event needs a manual nudge... They do not change your pricing catalog. They only help a user wallet catch up..." Functionally the tools DO call live Razorpay (`reconcileRazorpaySubscription` calls `fetchRazorpaySubscription`, `lib/pricing/enforcement.ts:489-550`) and are idempotent + audited, so they are more production-capable than the copy suggests. | A non-engineer support operator sees "internal testing" framing and either avoids using the tool or doesn't trust its output for a live customer. | Relabel the copy for production use, and pair with the F2 lookup panel so the IDs don't have to come from the customer. |
| F8 | MEDIUM | VERIFIED | No revenue or margin visibility anywhere in admin — cost dashboard is spend-only. | `app/actions/cost-admin.ts` (full file) computes AI provider spend only, sourced from `ai_cost_events`, with a **hardcoded** FX rate (`const INR_PER_USD = 93`, `cost-admin.ts:8`) rather than a live rate. `app/admin/cost/page.tsx` has zero references to revenue/razorpay/billing_orders/margin (grep confirmed). No per-plan or per-user margin (revenue − cost) view exists. | Owner cannot see, from any admin screen, whether a plan or a specific user is profitable — only what was spent on AI generation. | Join `billing_orders`/`billing_subscriptions` revenue against `ai_cost_events` spend for at least a daily/plan-level rollup; replace the hardcoded FX constant with a real rate source if INR reporting matters for accounting. |
| F9 | LOW | INFERRED — not fully verified | No GST/tax invoice generation capability appears to exist. | Not yet specifically grepped for `invoice`/`GST`/`receipt` — this is a gap in my own coverage, not a confirmed absence. Do not cite as fact without the grep below. | "I need a GST invoice" support case likely cannot be resolved in-product today, but confirm before reporting to the owner as fact. | Re-run the grep listed in Resume section before finalizing. |
| F10 | LOW | VERIFIED | Single hardcoded admin account (`ADMIN_USER_ID` env var), no RBAC — every privileged action (pricing edits, coin grants, user blocking, refund-adjacent tools) requires the same one credential. | `lib/supabase/admin.ts:24-38`. A separate `requireReviewer()` gate exists for content-moderation/agentic-review roles (see `app/admin/authors/layout.tsx`), but nothing scoped to billing/support alone. | Cannot give a support agent access to "resolve billing tickets" without also giving them full pricing-catalog publish and user-moderation power. | Not urgent pre-launch with a single operator; note for when support staff are added. |
| F11 | LOW / INFO | VERIFIED | `docs/production-pricing-rollout-checklist.md` is stale relative to the current `payments` branch. | It references migrations 015–022 only and frames the goal as "pricing stays dormant in prod behind flags off" — CLAUDE.md states 96 numbered migrations exist today, and this branch is actively building real Razorpay checkout. This checklist describes an earlier, more conservative rollout phase. | Following this checklist as-is for the current "take real money" push would miss everything built since migration 022. | Needs a rewrite/supersession note before go-live; flag for stream 5 (docs-vs-code) too. |
| F12 | INFO | VERIFIED | Pricing catalog changes (plans, top-ups, action costs, promotions, runtime flags) have a solid audit trail — a genuine strength. | Every mutator in `app/actions/pricing-admin.ts` calls `insertPricingAudit()` (e.g. lines 322-329, 403-411, 555-562, 778-785, 823-830, 928-940), writing to `pricing_publish_audit`, viewable at `/admin/pricing/audit` (`app/admin/pricing/audit/page.tsx`, `getPricingAuditPage` in `pricing-admin.ts:217-258`). | — | Keep this pattern; extend it to whatever F1's cancel/refund actions add. |
| F13 | INFO | VERIFIED | Every sampled admin server action re-checks `verifyAdmin()` itself, not just relying on the `/admin` layout gate. | Grep across `app/actions/*.ts` and `app/admin/**/layout.tsx` for `verifyAdmin()` shows ~200+ call sites, one per exported mutator/query in every admin-actions file touched during this audit (`pricing-admin.ts`, `admin-users.ts`, `cost-admin.ts`, and ~15 other admin action modules). No action found reachable without an explicit check in the files sampled. | — | Good defense-in-depth against direct server-action invocation; no change needed. |

## Capability inventory (task requirement #1) — partial

| Capability | UI | Server action / route | Writes | Audit trail |
|---|---|---|---|---|
| Edit/publish pricing plans, versions | `/admin/pricing/plans` (PricingStudio) | `savePricingPlanDraft`, `publishPricingPlanVersion`, `archivePricingPlanVersion` (`pricing-admin.ts:260-453`) | `pricing_plans`, `pricing_plan_versions` | Yes — `pricing_publish_audit` |
| Edit/publish top-up packs | `/admin/pricing/top-up-packs` | `savePricingTopupDraft`, `publishPricingTopupPack`, `archivePricingTopupPack`, `archiveLegacyTopupPacks` (`pricing-admin.ts:455-743`) | `pricing_topup_packs` | Yes |
| Edit action costs | `/admin/pricing/action-costs` | `savePricingActionCost` (`pricing-admin.ts:745-789`) | `pricing_action_costs` | Yes (immediate_update) |
| Edit promotions | `/admin/pricing/promotions` | `savePricingPromotion`, `archivePricingPromotion` (`pricing-admin.ts:791-872`) | `pricing_promotions` | Yes |
| Toggle runtime flags (checkout on/off, hard enforcement, etc.) | `/admin/pricing/runtime-controls` | `updatePricingRuntimeSettings` (`pricing-admin.ts:880-944`) | `feature_flags` | Yes |
| Create/link Razorpay plans | *(no dedicated admin control)* | implicit — `ensureRazorpayPlanRef` (`pricing-checkout.ts:272-306`), runs lazily on first real checkout of a plan version | `pricing_plan_versions.provider_product_ref/provider_price_ref` | No (not an admin action) |
| Manual coin grant | `/admin/users/[id]` | `grantAdminUserCoins` (`admin-users.ts:227-276`) → `admin_grant_user_coins` RPC | `beat_grants` | Yes — `admin_user_audit_events`, idempotent via request key |
| Coin deduction / clawback | **none** | — | — | — (F3) |
| Tier/entitlement override (access only, no coins) | `/admin/users/[id]` | `setAdminUserEntitlementTier` (`admin-users.ts:286-351`) | `user_entitlement_overrides` | Yes (best-effort; logged, not thrown, on audit-insert failure) |
| Promotional cohort bulk grant | `/admin/users/cohorts` | `previewAdminPromotionalCohort`, `executeAdminPromotionalCohort` (`admin-users.ts:358-439`) | `beat_grants` (bulk), `admin_promotional_cohorts` | Yes, capped 1-1000 recipients, idempotent |
| Block/suspend/reactivate a user | `/admin/users/[id]` | `updateAdminUserModeration` (`admin-users.ts:169-225`) → `admin_set_user_moderation` RPC + Supabase Auth ban sync | `user_account_moderation`, Supabase Auth ban | Yes — does **not** touch subscription (F5) |
| View a user's subscription/orders/payments | **none** | — | — | — (F2) |
| Refund a payment | **none** | — | — | — (F1) |
| Cancel a user's subscription | **none** | — | — | — (F1) |
| Reconcile/sync a subscription from Razorpay | `/admin/pricing/recovery-tools` | `reconcilePricingSubscription` (`pricing-admin.ts:946-962`) → `reconcileRazorpaySubscription` (`lib/pricing/enforcement.ts:489-550`), calls live Razorpay | `billing_subscriptions`, `beat_grants`, `billing_orders` | No dedicated audit row (relies on `billing_orders.raw_provider_payload_json` breadcrumb) |
| Reconcile/sync a top-up from Razorpay | `/admin/pricing/recovery-tools` | `reconcilePricingTopup` (`pricing-admin.ts:964-979`) → `reconcileRazorpayTopup` (`enforcement.ts:552-605`) | `billing_orders`, `beat_grants` | Same as above |
| View/replay webhook events | **none** | — | — | — (F4) |
| Cost dashboard (AI provider spend) | `/admin/cost` | `getCostDashboardData` (`cost-admin.ts:210-359`) | read-only | n/a |
| Revenue / margin dashboard | **none** | — | — | — (F8) |

## Scheduled/background jobs (task requirement #3)

- **Only one Vercel cron exists**: `/api/batch/reconcile`, daily `0 3 * * *` (`vercel.json:1-9`).
- Auth: `CRON_SECRET` bearer header; if unset, the route allows unauthenticated calls **only** when `NODE_ENV !== 'production'` — fails closed in prod (`app/api/batch/reconcile/route.ts:15-21`).
- What it does (all wrapped so one failure can't block the rest, see file's own header comment): reconciles active image batches, narration jobs, stateful image-generation jobs, reference-adoption jobs; drains the agentic run queue (time-boxed to 30s); retention cleanup of expired originals and abandoned reference setups.
- What it does **not** do: expire stale coin reservations (F6), sync/poll subscription status as a fallback to webhooks (subscription state is otherwise purely webhook-driven or admin-manual-reconcile-driven — no scheduled poll if a webhook is missed and no one manually reconciles).
- Webhook processing itself (`/api/billing/razorpay/webhook/route.ts`) is not a cron — it's the live Razorpay webhook endpoint, idempotent via `provider_event_id` uniqueness check (lines 46-57), logs every event to `billing_webhook_events` with status received/processed/failed.

## Support-desk readiness (task requirement #4) — partial

| Case | Admin can resolve today without SQL? | Notes |
|---|---|---|
| "I paid but got no coins" | Partially | Recovery tools *can* fix it (`reconcilePricingSubscription`/`reconcilePricingTopup`, F7) but only if the admin already has the Razorpay subscription/order/payment ID — no lookup UI (F2) to find it from the user id/email. |
| "Charged twice" | Not assessed | Out of lane — depends on checkout/idempotency design (stream 1). Webhook dedup via `provider_event_id` and grant dedup via `source_ref_id` prevent a duplicate *webhook* from double-granting, but a genuine double *charge* on Razorpay's side is a stream-1/Razorpay-capabilities question. |
| "Cancel my subscription" | **No** | No cancel action exists at all (F1). |
| "Refund me" | **No** | No refund action exists at all (F1). |
| "I need a GST invoice" | Likely no, unconfirmed | No invoice/receipt generation found in the code read so far; needs the grep in Resume section before asserting (F9). |
| "Change my plan" | **No** | Explicitly deferred/unimplemented per `docs/future-subscription-account-management.md`; checkout blocks a second subscription. |
| "Payment failed, retry" | Partially | Same caveat as row 1 — recovery tools can re-pull live Razorpay status, but require the order/subscription ID up front. |
| "Chargeback/dispute received" | **No** | No dispute-handling surface found anywhere. |
| "User blocked for abuse has an active subscription" | **No** | Blocking does not touch the subscription; it keeps renewing and granting coins (F5). |

## Open questions for the owner

- Is there an intended manual runbook (outside the code) for cancellations/refunds today, e.g. "go into the Razorpay dashboard and do X, Y, Z"? None is documented in the repo.
- Given only one admin account (`ADMIN_USER_ID`) is supported, who is expected to staff support once real money is flowing — the owner alone, or is a second admin identity planned?
- Is the hardcoded `INR_PER_USD = 93` FX rate (`cost-admin.ts:8`) meant to be revisited periodically, or should it be considered a known-rough estimate not to be used for accounting?

## Resume here

Not yet done — pick up in this order:

1. **Finish reading `lib/pricing/enforcement.ts`** — specifically the reserve/finalize/spend path (not yet read) to confirm/deny whether stale reservations are lazily treated as inert even without the cron/manual-button expiry (affects F6's severity). I had only read lines ~460-640 (the release/expire/reconcile/welcome-grant functions) before pausing.
2. **Grep for `invoice`, `GST`, `receipt`, `tax`** across `app/`, `lib/`, `components/` to confirm/deny F9 (GST invoice capability) — currently marked INFERRED/unverified, should not be reported to the owner as a confirmed finding until this runs.
3. **Read `docs/admin-settings-manual.md`** — was explicitly in the task's "Start from" list and has not been opened at all yet. Check it against what was found here (especially recovery-tools section and cost dashboard) for doc/code drift, to add to F11-style findings.
4. **Open the remaining `app/admin/pricing/*/page.tsx` files** individually (`plans`, `top-up-packs`, `promotions`, `action-costs`, `runtime-controls`) — currently only inferred their behavior from `PricingStudio.tsx`'s recovery-tools section and `pricing-admin.ts`. Low priority since the server-side logic (the part that actually matters for a money audit) is already fully read.
5. **Read the rest of `components/admin/PricingStudio.tsx`** (lines 1-1778) — only the Recovery Tools section and the bottom editor-builder helpers were read. Check for any client-side validation or safety gaps not visible from the server action alone (e.g., can the UI submit a negative price, does it warn before archiving a live published plan that users are actively subscribed to).
6. **Open `app/admin/users/[id]/page.tsx`, `app/admin/users/page.tsx`, `app/admin/users/cohorts/page.tsx`** directly — inferred their shape from `admin-users.ts` and `user-management.shared.ts` types only, never read the actual page/component rendering them. Confirm the wallet-activity UI truly does not surface `beat_grants.metadata_json` (which does contain `billingOrderId`/`providerPaymentId` for topup grants per `razorpay-sync.ts:160-167`) — I found `buildWalletActivity()` in `admin-users.ts:669-699` maps grants to a shape that excludes `metadata_json`, which would mean the raw IDs needed for F7's recovery tools are present in the DB but invisible in the admin UI even on the one screen that's closest to surfacing them. This is a strong lead worth confirming and would sharpen F2/F7 into a single "the data exists, just isn't rendered" finding with an easy fix.
7. **Run the planned SELECT-only Supabase MCP queries** (dev via `mcp__supabase__*`) — none has been run yet. Useful checks: row counts on `billing_orders`, `billing_subscriptions`, `billing_webhook_events`, `pricing_publish_audit`, `admin_user_audit_events` to see if any real/test traffic has exercised these paths yet; confirm RLS grants on the admin RPCs are service_role-only as the migration text claims.
8. **Write the final `## Summary` reply** (≤250 words) and top-5-by-severity list once the above is done — not started.
9. Re-scan `vercel.json` / cron section against `docs/admin-settings-manual.md` once read (step 3) in case the manual documents a cron this audit missed.

Everything above F1-F13 and the two partial tables (capability inventory, support-desk readiness) is safe to reuse as-is; nothing found so far needs to be walked back, only extended.
