# Admin tools and billing operations

_Stream 4 · audited 2026-09-17 · branch payments_

## Scope and method

Auditing every admin capability that touches money or coins: pricing studio, user
management, cost dashboards, scheduled/background jobs (cron, reconcile, sync),
and support-desk readiness for live-money operations. Read-only: source code review
plus SELECT-only Supabase queries against both dev and prod. No files modified
except this one; no writes of any kind executed.

Cross-stream context folded in on resume (not independently re-derived here):
- Stream 2 confirmed there is no deduct/revoke RPC — `admin_grant_user_coins` only
  ever grants positive amounts. Matches F3 below exactly.
- Stream 1 confirmed `pricing_checkout_enabled` is enforced only in `WalletPage.tsx`
  client code, not on the server. Noted where relevant below but is stream 1's finding to own.
- Stream 1/2 (reviewer-confirmed): the Razorpay webhook route's duplicate-event
  check ignores `status`, so a webhook that previously failed is never reprocessed
  when Razorpay retries it — a retry of the same `provider_event_id` is short-circuited
  as `duplicate: true` regardless of whether the first attempt succeeded. This folds
  into F4 below (upgraded from HIGH toward BLOCKER-adjacent) and the support-desk table.

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
- `docs/admin-settings-manual.md` (full)
- `lib/pricing/enforcement.ts` lines 350-456 (authorize/finalize/release path)
- `supabase/migrations/021_pricing_enforcement_primitives.sql` lines 26-104 (the
  `pricing_authorize_spend` balance/reservation math)
- `lib/legal/business-config.ts`, `lib/managed-pages/registry.ts` (GSTIN usage, grepped)
- All six `app/admin/pricing/*/page.tsx` wrapper files
- `app/admin/users/[id]/page.tsx` (full), plus line-count/grep checks on
  `app/admin/users/page.tsx` and `app/admin/users/cohorts/page.tsx`
- `components/admin/PricingStudio.tsx` — targeted grep for confirmation dialogs /
  input validation across the full file (not a line-by-line read)
- Directory listings of `app/admin/**`, `app/api/**/route.ts`
- Live row counts via `mcp__supabase__execute_sql` (dev) and `mcp__supabase-prod__execute_sql` (prod)

Remaining known gaps in coverage (not blocking, listed for completeness): the
full plan/topup/promotion editor JSX in `PricingStudio.tsx` (lines 1-1778) was
grep-scanned, not read end-to-end; the `pricing-checkout.ts` file outside the
lazy-plan-creation helper; `app/api/billing/razorpay/verify/route.ts` was never opened
(the likely path by which dev's 12 `billing_orders` rows were actually granted,
since dev's `billing_webhook_events` is empty — see DB evidence below). These are
stream 1's territory (checkout flow) more than stream 4's (admin ops), so left as-is.

## Findings

Severity-ordered. Every row VERIFIED by reading the cited code unless marked INFERRED.

| ID | Severity | Status | Finding | Evidence | Failure scenario | Direction |
|----|----------|--------|---------|----------|-------------------|-----------|
| F1 | BLOCKER | VERIFIED | No refund or subscription-cancellation capability exists anywhere in the code — no admin UI button, no server action, no Razorpay API wrapper. | `lib/billing/razorpay.ts:59-162` exports only `createRazorpayPlan`, `createRazorpaySubscription`, `fetchRazorpaySubscription`, `createRazorpayOrder`, signature helpers — no cancel/refund function. Grep of `app/actions/**` and `lib/billing/**` for cancel\|refund\|chargeback\|dispute found no billing-related hits (only unrelated image/agentic-job "cancel"). `docs/future-subscription-account-management.md:1-48` explicitly defers all cancellation/plan-change implementation and documents that checkout blocks a second subscription with "Subscription changes will stay manual until account management is live" — but no manual admin procedure exists either. | A real customer asks to cancel or disputes a charge; no in-product way to act. Admin must go to the Razorpay dashboard directly and then hand-reconcile Kissago's DB (no documented procedure, no SQL script provided in the repo for this). | Build minimal cancel-subscription and refund-payment admin actions (call Razorpay's cancel/refund APIs, then run the existing reconcile-subscription sync so DB state matches) before taking real payments. |
| F4 | HIGH (borders BLOCKER) | VERIFIED | No admin UI to view or replay webhook events — **and** a webhook that failed processing is never retried, by Razorpay's own retry or by anything in this codebase. | `billing_webhook_events` is written by `app/api/billing/razorpay/webhook/route.ts:59-102` (status `received`→`processed`/`failed`, with `error_message`). The duplicate-event guard (lines 46-57) keys only on `provider_event_id` and ignores `status` — so when Razorpay retries a webhook whose first attempt failed, the retry hits the existing row and short-circuits to `{ok:true, duplicate:true}` **without reprocessing** (reviewer-confirmed by streams 1/2). Repo-wide grep for `billing_webhook_events` found only that route plus two migration files and docs — no admin page reads it. Dev and prod both show **zero rows** in `billing_webhook_events` right now (see DB evidence below) — the webhook path is effectively unexercised by real traffic to date, so this bug has had no chance to surface yet. | A real payment captures, Razorpay fires the webhook, something transient fails (DB hiccup, cold start) → row marked `failed`. Razorpay retries the same event id → silently swallowed as a duplicate, forever. Coins never land, no error surfaces anywhere, and the admin's only workaround (F7's manual reconcile) is a workaround only if someone already suspects a problem for that specific order. | Fix the dedup check to key on `(provider_event_id, status != 'failed')` or similar so retries reprocess; add the F4 webhook-events viewer regardless, since silent one-shot failures can still happen even with retries fixed. |
| F2 | HIGH | VERIFIED | No admin UI shows a user's `billing_orders` or `billing_subscriptions` (payments, orders, subscription status/history) — **and** the one query that comes closest doesn't even `SELECT` the column that would help. | Grep of `app/admin/**` and `components/admin/**` for `billing_orders`\|`billing_subscriptions`: zero hits. `getAdminUserDetailInternal` (`app/actions/admin-users.ts:469-525`) loads only `admin_list_users` RPC, `admin_user_audit_events`, `beat_grants`, `beat_usage_events`, `stories`. Its `beat_grants` query explicitly selects `'id, source_type, beats_total, expires_at, granted_at'` (`admin-users.ts:485-490`) — omitting `metadata_json`, even though `grantTopupIfMissing` (`lib/billing/razorpay-sync.ts:151-168`) stores `billingOrderId`/`providerPaymentId`/`providerOrderId` inside that very column for every top-up grant. `docs/admin-settings-manual.md:302-305` independently lists "Users page... joining `profiles` with `billing_customers`/`billing_subscriptions`" under **Suggested future admin features — none are built yet**, confirming this from the docs side too. `docs/razorpay-stage-rollout-runbook.md:222-254` tells engineers to query these tables directly via raw SQL for stage debugging. | User says "I paid but got no coins." Admin opens the user's page, sees a wallet-activity list with no order/payment reference, and must ask the user for a Razorpay ID they likely don't have, or query the DB by hand. | Two-tier fix: (1) cheap — add `metadata_json` to the existing `beat_grants` select and surface the embedded order/payment id already sitting there for top-up grants; (2) proper — add the billing detail panel the admin manual itself already proposes, joining `billing_orders`/`billing_subscriptions`/`billing_webhook_events` by user id. |
| F3 | HIGH | VERIFIED (also confirmed independently by stream 2) | Admin coin grants are one-directional (positive only) — no way to deduct/claw back coins through the UI. | `normalizeCoinGrantInput` (`lib/admin/user-management.shared.ts:245-247`) throws if `coins <= 0`. The backing RPC `admin_grant_user_coins` (`supabase/migrations/083_admin_user_management.sql:1098-1103`) also requires `p_beat_amount > 0` and `p_coin_amount > 0`. Ceiling is `MAX_ADMIN_COIN_GRANT = 10_000_000` (`lib/admin/user-management.shared.ts:6`) — high but only in the grant direction. Dev has exercised this exactly once (`beat_grants` with `source_type='admin_adjustment'` count = 1). | Admin fat-fingers a grant (e.g. adds three extra zeros) or a user receives coins fraudulently; nothing in the UI can reverse it — requires direct SQL against `beat_grants`. | Add a bounded negative-adjustment path reusing the same idempotency/audit pattern as `admin_grant_user_coins`. |
| F5 | HIGH | VERIFIED | Blocking/suspending a user does not touch their Razorpay subscription — it keeps renewing and granting coins. | `admin_set_user_moderation` (`supabase/migrations/083_admin_user_management.sql:950-1070`) writes only to `user_account_moderation`. `grantSubscriptionCycleIfMissing` (`lib/billing/razorpay-sync.ts:177-230`) grants each renewal cycle based solely on subscription status (`active`/`authenticated`) and a per-cycle idempotency key — no join against moderation status anywhere in the file. | A user is blocked for abuse while on an active Plus/Studio subscription. Razorpay keeps auto-charging them every cycle and the webhook keeps granting monthly coins to a blocked account — money keeps flowing to a banned user with no admin alert or linkage. | Either warn the admin on block that an active subscription exists (once F2's lookup exists) and/or auto-attempt a best-effort cancel (needs F1 first). |
| F14 | MEDIUM | VERIFIED | Archiving a published (live) pricing plan version or top-up pack has no confirmation dialog and no check for active subscribers/recent purchasers of that version. | Grep of `components/admin/PricingStudio.tsx` for `confirm(`/`window.confirm`/"Are you sure" found zero matches anywhere in the file. Server-side `archivePricingPlanVersion` (`pricing-admin.ts:416-453`) and `archivePricingTopupPack` (`pricing-admin.ts:648-685`) flip `status` directly with no check against `billing_subscriptions` for plan versions currently in use. | Admin archives a plan version thinking it's an unused draft; if it was actually the live published version for a plan users are subscribed to, there's no warning before the click and no visible link telling the admin who's on it. | Add a confirmation step naming the impact ("N active subscriptions reference this version") before archiving a `published` row — needs F2's data plumbing to compute N. |
| F6 | LOW (downgraded from MEDIUM) | VERIFIED | Stale coin-reservation expiry (`pricing_expire_stale_reservations`) is reachable only via the admin's manual "Release old holds" button — no cron calls it — but this is a hygiene/bookkeeping gap, not a user-facing blocker. | `vercel.json:1-9`'s only cron (`/api/batch/reconcile`, `0 3 * * *`) never calls `expireStaleReservations()`. **However**, `pricing_authorize_spend` (`supabase/migrations/021_pricing_enforcement_primitives.sql:95-104`) computes the "already held" total from `beat_spend_reservations` with `WHERE status = 'pending' AND expires_at > now()` — an expired-but-not-yet-marked reservation is already excluded from that sum, so it does not block a user's ability to spend or reserve again. The expire job just relabels rows `status='expired'` for clarity/audit; dev currently shows 19 total reservations and 0 stuck pending-and-expired (`reservations_stuck_pending_expired` = 0), consistent with self-healing. | Without the cron, `beat_spend_reservations` accumulates rows stuck at `status='pending'` past their `expires_at` forever (cosmetic/audit-trail clutter, and would make any future "how many reservations are open right now" dashboard over-count) — but does not actually strand a user's coins. | Low priority: add to the daily cron for tidiness, but not launch-blocking. |
| F7 | MEDIUM | VERIFIED | The only admin tooling for "payment succeeded but coins didn't land" / "payment failed, retry" is explicitly labeled internal/stage-testing tooling in both the component copy and the admin manual, and requires already knowing the Razorpay subscription/order/payment ID (no lookup screen — see F2). | `components/admin/PricingStudio.tsx:1778-1786`: "Use these only during internal testing... They do not change your pricing catalog. They only help a user wallet catch up..." `docs/admin-settings-manual.md:240`: "Recovery tools... Repair **test** wallets, checkouts, and stuck reservations." Functionally the tools DO call live Razorpay (`reconcileRazorpaySubscription` calls `fetchRazorpaySubscription`, `lib/pricing/enforcement.ts:489-550`) and are idempotent + audited, so they are more production-capable than the copy in two independent places suggests. | A non-engineer support operator sees "test"/"internal testing" framing in both the UI and the manual and either avoids using the tool or doesn't trust its output for a live customer. | Relabel the copy (component **and** manual) for production use, and pair with the F2 lookup panel so IDs don't have to come from the customer. |
| F8 | MEDIUM | VERIFIED | No revenue or margin visibility anywhere in admin — cost dashboard is spend-only, and the admin manual's own roadmap confirms this is not built. | `app/actions/cost-admin.ts` (full file) computes AI provider spend only, sourced from `ai_cost_events`, with a **hardcoded** FX rate (`const INR_PER_USD = 93`, `cost-admin.ts:8`) rather than a live rate. `app/admin/cost/page.tsx` has zero references to revenue/razorpay/billing_orders/margin (grep confirmed). `docs/admin-settings-manual.md:308-311` lists "Per-user cost rollups... margin per user" under **Suggested future admin features — none are built yet**. | Owner cannot see, from any admin screen, whether a plan or a specific user is profitable — only what was spent on AI generation. | Join `billing_orders`/`billing_subscriptions` revenue against `ai_cost_events` spend for at least a daily/plan-level rollup; replace the hardcoded FX constant with a real rate source if INR reporting matters for accounting. |
| F9 | LOW | VERIFIED (confirmed, no longer inferred) | No GST/tax invoice generation capability exists anywhere. The only GST-related artifact is a static GSTIN string used in Terms-of-Service copy. | Grep for `invoice`\|`GST`\|`receipt`\|`tax_` across the whole repo: the only real hits are `lib/legal/business-config.ts:23` (`export const LEGAL_GSTIN = '24ACLFA8196N1ZN'`), used solely in `lib/managed-pages/registry.ts:231` inside the Terms-of-Service page text ("...registered in ... India (GSTIN ...)"), plus Razorpay's own `receipt` field (an opaque order-reference string Razorpay's API requires, not a customer-facing document) in `lib/billing/razorpay.ts` and `pricing-checkout.ts`. No invoice numbering scheme, no PDF/document generation, nothing per-purchase. | "I need a GST invoice" cannot be resolved in-product today — not by the user, not by an admin. | Needs either a real invoice-generation feature or, at minimum, a documented manual process (and this is also a compliance question — flag to stream 7, India tax/legal). |
| F10 | LOW | VERIFIED | Single hardcoded admin account (`ADMIN_USER_ID` env var), no RBAC — every privileged action (pricing edits, coin grants, user blocking, refund-adjacent tools) requires the same one credential. | `lib/supabase/admin.ts:24-38`. A separate `requireReviewer()` gate exists for content-moderation/agentic-review roles (see `app/admin/authors/layout.tsx`), but nothing scoped to billing/support alone. | Cannot give a support agent access to "resolve billing tickets" without also giving them full pricing-catalog publish and user-moderation power. | Not urgent pre-launch with a single operator; note for when support staff are added. |
| F11 | LOW / INFO | VERIFIED | `docs/production-pricing-rollout-checklist.md` is stale relative to the current `payments` branch. | It references migrations 015–022 only and frames the goal as "pricing stays dormant in prod behind flags off" — CLAUDE.md states 96 numbered migrations exist today, and this branch is actively building real Razorpay checkout. This checklist describes an earlier, more conservative rollout phase. | Following this checklist as-is for the current "take real money" push would miss everything built since migration 022. | Needs a rewrite/supersession note before go-live; flag for stream 5 (docs-vs-code) too. |
| F15 | LOW / INFO | VERIFIED | `docs/admin-settings-manual.md` (the one manual actually kept current — it says "this file is the source of truth" and is rendered live at `/admin/help`) never mentions the `/api/batch/reconcile` cron at all, nor that reservation expiry depends on a manual button. | Full read of `docs/admin-settings-manual.md`; no occurrence of "cron" anywhere in the file; the Recovery Tools row (line 240) describes "stuck reservations" as something the tool repairs without noting there's no automatic expiry. | An operator reading the one doc meant to be authoritative would not learn that reservation cleanup is manual-only, nor that a single daily cron underpins narration/image/reference reconciliation. | Add a short "Scheduled jobs" section to the manual referencing `vercel.json` and what depends on it. |
| F12 | INFO | VERIFIED | Pricing catalog changes (plans, top-ups, action costs, promotions, runtime flags) have a solid audit trail — a genuine strength. | Every mutator in `app/actions/pricing-admin.ts` calls `insertPricingAudit()` (e.g. lines 322-329, 403-411, 555-562, 778-785, 823-830, 928-940), writing to `pricing_publish_audit`, viewable at `/admin/pricing/audit` (`app/admin/pricing/audit/page.tsx`, `getPricingAuditPage` in `pricing-admin.ts:217-258`). `docs/admin-settings-manual.md:288-290` correctly documents this as the *only* audited area: "Global Settings changes are not audited; pricing changes are." Note this means the coin-priced "Seed preview price" control on the Authoring settings page (`GlobalSettings.tsx`, not Pricing Studio) changes a coin cost **without** an audit row, despite touching money. | — | Keep this pattern; extend it to whatever F1's cancel/refund actions add; consider whether the seed-preview coin price should move under the pricing audit trail too. |
| F13 | INFO | VERIFIED | Every sampled admin server action re-checks `verifyAdmin()` itself, not just relying on the `/admin` layout gate. | Grep across `app/actions/*.ts` and `app/admin/**/layout.tsx` for `verifyAdmin()` shows ~200+ call sites, one per exported mutator/query in every admin-actions file touched during this audit (`pricing-admin.ts`, `admin-users.ts`, `cost-admin.ts`, and ~15 other admin action modules). No action found reachable without an explicit check in the files sampled. | — | Good defense-in-depth against direct server-action invocation; no change needed. |

## DB evidence (dev vs prod, SELECT-only)

| Metric | Dev | Prod |
|---|---|---|
| `billing_orders` rows | 12 | **0** |
| `billing_subscriptions` rows | 1 | **0** |
| `billing_webhook_events` rows | **0** | **0** |
| `pricing_publish_audit` rows | 81 | 47 |
| `admin_user_audit_events` rows | 2 | 1 |
| `beat_spend_reservations` total / stuck-pending-expired | 19 / 0 | not queried |
| `beat_grants` with `source_type='admin_adjustment'` | 1 | not queried |

Takeaways: **production has never processed a single billing order or subscription** —
this audit lands before any real money has moved, which is the best possible time to
close F1/F2/F4. Dev's `billing_webhook_events` being empty despite 12 `billing_orders`
means dev's own test purchases were granted through some path other than the webhook
route (most likely `/api/billing/razorpay/verify`, not read in this audit — flagged
to stream 1) — so the webhook route, and the F4 retry bug specifically, has **never
actually run** in this codebase's history yet. That is good news (no customer has been
hurt by it) and bad news (it is completely untested).

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
| View/replay webhook events | **none** | — | — | — (F4; also: retries would currently no-op even if replayed, see F4) |
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
| "I paid but got no coins" | Partially, and fragile | Recovery tools *can* fix it (`reconcilePricingSubscription`/`reconcilePricingTopup`, F7) but only if the admin already has the Razorpay subscription/order/payment ID — no lookup UI (F2) to find it from the user id/email. Worse: if the original cause was a failed webhook, Razorpay's automatic retry will silently no-op (F4), so this case may not even self-heal before it reaches support. |
| "Charged twice" | Not assessed | Out of lane — depends on checkout/idempotency design (stream 1). Webhook dedup via `provider_event_id` and grant dedup via `source_ref_id` prevent a duplicate *webhook* from double-granting, but a genuine double *charge* on Razorpay's side is a stream-1/Razorpay-capabilities question. |
| "Cancel my subscription" | **No** | No cancel action exists at all (F1). |
| "Refund me" | **No** | No refund action exists at all (F1). |
| "I need a GST invoice" | **No** (confirmed) | No invoice/receipt generation exists; GSTIN appears only in static Terms-of-Service copy (F9). |
| "Change my plan" | **No** | Explicitly deferred/unimplemented per `docs/future-subscription-account-management.md`; checkout blocks a second subscription. |
| "Payment failed, retry" | Partially | Same caveat as row 1 — recovery tools can re-pull live Razorpay status, but require the order/subscription ID up front. |
| "Chargeback/dispute received" | **No** | No dispute-handling surface found anywhere. |
| "User blocked for abuse has an active subscription" | **No** | Blocking does not touch the subscription; it keeps renewing and granting coins (F5). |

## Open questions for the owner

- Is there an intended manual runbook (outside the code) for cancellations/refunds today, e.g. "go into the Razorpay dashboard and do X, Y, Z"? None is documented in the repo, and none should be assumed sufficient given F4's retry bug and F5's block/subscription gap.
- Given only one admin account (`ADMIN_USER_ID`) is supported, who is expected to staff support once real money is flowing — the owner alone, or is a second admin identity planned?
- Is the hardcoded `INR_PER_USD = 93` FX rate (`cost-admin.ts:8`) meant to be revisited periodically, or should it be considered a known-rough estimate not to be used for accounting?
- Dev's 12 `billing_orders` were granted without ever touching `billing_webhook_events` (which is empty in both dev and prod) — worth confirming with stream 1 whether `/api/billing/razorpay/verify` is the primary grant path today and the webhook is a secondary/backup path, since that changes how urgent the F4 retry-bug fix is relative to the verify-route's own reliability.

## Status

Audit complete for this stream's assigned scope. Remaining low-value gaps (not
pursued further, none change any finding above): the full plan/topup/promotion
editor JSX in `PricingStudio.tsx` was grep-scanned rather than read line-by-line;
`app/api/billing/razorpay/verify/route.ts` was never opened (stream 1's territory).
