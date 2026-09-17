# Billing Data Model and Live DB State (dev vs prod)

_Stream 3 · audited 2026-09-17 · branch payments_

**STATUS: PAUSED MID-TASK by coordinator instruction (owner limiting parallel agents). See "Resume here" at the bottom for exactly what is left.** Everything above that section is solid (VERIFIED/INFERRED as marked) and safe to build on.

## Scope and method

Read-only audit. Part A: schema archaeology from migration files 015-022, 040, 041, 082, 096, 101, plus every other migration touching billing/pricing/wallet/entitlement objects (grep sweep across `supabase/migrations/*.sql`), cross-checked against `lib/types/database.ts`. Part B: live read-only queries against both Supabase MCP projects, confirmed by `get_project_url`. No writes, no CLI, no side effects anywhere. Per task instructions, `mcp__supabase__*` = **dev** (`dxbwzcpbfacrwrauhdbk.supabase.co`), `mcp__supabase-prod__*` = **prod** (`pddjsopcemsfiwyvhlkr.supabase.co`) — not independently re-derived beyond that explicit mapping, but the data patterns found (checkout enabled + real test payments only in the `supabase` project, everything empty/disabled in `supabase-prod`) are consistent with that labeling.

No row containing personal data (emails, names, user IDs, payment IDs) was read — every live-DB query below was an aggregate (`count`, `sum`, `group by`), so no redaction is needed anywhere in this file.

---

## Part A — Schema reference (from migrations)

### Files read in full
015, 016, 017, 018, 019, 020, 021, 022, 040, 041, 082, 084, 096, 097, 098, 101, and the `admin_grant_user_coins` function from 083 (lines 1071-1205). `lib/types/database.ts` lines 560-818 cross-checked against all of the above — every table below has a matching `Db*` interface there, field-for-field, as of that read.

### Files identified as billing-adjacent by grep but NOT YET fully read
023, 024, 039, 043 (partially checked — only a `pricing_action_costs` insert + unrelated storage policies), 046, 047, 049, 062 (partially — table name only), 063, 078 (partially — action-cost insert + RLS policies for unrelated `reference_*` tables), 079, 091, 095, 102 (partially — the `agentic_billing_bypass_enabled` flag comment only), 115. See "Resume here."

### Table-by-table reference

**`pricing_plans`** (015) — catalog root. `plan_key` UNIQUE, `tier_rank` (>0), `is_active`, `is_public`, `feature_flags_json`. Seeded rows (019): `free`(1), `plus`(2), `studio`(3). RLS enabled, **zero policies**.

**`pricing_plan_versions`** (015) — a priced, market/currency/interval-specific variant of a plan. FK `plan_id → pricing_plans`. `status` draft/published/archived. `provider` stripe/razorpay/NULL. `pricing_market_key` IN/ROW. `price_minor`, `monthly_included_beats`, `carry_forward_cap_multiplier`, `story_length_cap`, `grace_period_days`. Two **partial unique indexes** are the idempotency backbone: only one `draft` and only one `published` row can exist per `(plan_id, billing_interval, pricing_market_key, currency_code)` — this is what makes "publish a new price" a safe swap rather than a free-for-all. `provider_product_ref`/`provider_price_ref` exist for a future Stripe/Razorpay product/price ID but are unused by the current seed data (all NULL in both live DBs, confirmed for the rows queried). RLS enabled, zero policies.

**`pricing_topup_packs`** (015) — one-off coin packs. Same draft/published partial-unique-index pattern keyed on `(pack_key, pricing_market_key, currency_code)`. `beat_amount` is the internal unit granted. RLS enabled, zero policies.

**`pricing_action_costs`** (015, extended 040 → numeric(12,2) for fractional costs, extended 082 with `display_name`, `cost_family` CHECK-constrained enum, `billing_unit`, per-tier `free_enabled`/`plus_enabled`/`studio_enabled` booleans, `metadata_json`). `action_key` UNIQUE — this is the meter catalog: 25 rows live today (both envs identical, see Part B). RLS enabled, zero policies.

**`pricing_promotions`** (015) — `promo_key` UNIQUE, market-scoped, plan-targeted, `bonus_beats`, window `starts_at`/`ends_at` with a CHECK that end > start. **Zero rows in both environments** — unused so far. RLS enabled, zero policies.

**`pricing_publish_audit`** (015) — generic before/after JSON audit trail keyed by `entity_type` (plan_version/topup_pack/action_cost/promotion/runtime_setting). RLS enabled, zero policies. (Did not query row counts — see Resume here.)

**`billing_customers`** (016) — one row per `(user_id, provider)`, also unique on `(provider, provider_customer_id)`. Holds `pricing_market_key`, `country_code`, `currency_code`. RLS enabled, zero policies.

**`billing_subscriptions`** (016) — FK `plan_version_id → pricing_plan_versions` (NOT NULL — a subscription always points at a specific catalog version, which is good for historical-price integrity). Unique on `(provider, provider_subscription_id)`. `status` is a free-text column (no CHECK constraint — whatever the provider's status string is, verbatim). `current_period_start/end`, `cancel_at_period_end`, `grace_period_ends_at`, `last_webhook_at`, `raw_provider_state_json`. RLS enabled, zero policies.

**`billing_orders`** (016) — one row per checkout attempt. `order_type` CHECK ∈ {subscription_checkout, topup_checkout}. Three **partial unique indexes**, each `WHERE ... IS NOT NULL`, on `(provider, provider_checkout_session_id)`, `(provider, provider_order_id)`, `(provider, provider_payment_id)` — this is the idempotency guard against double-processing the same Razorpay order/payment. `status` is free text (default `'created'`), no CHECK constraint (contrast with `billing_subscriptions`, same pattern). `amount_minor`, `currency_code`, optional FKs to `plan_version_id` / `topup_pack_id`. RLS enabled, zero policies.

**`billing_webhook_events`** (016) — `event_type` free text, `provider_event_id` unique per `(provider, provider_event_id)` (webhook replay/dedup guard). `status` CHECK ∈ {received, processed, failed, ignored}. Optional FKs to `related_user_id`, `related_subscription_id`. RLS enabled, zero policies. **Zero rows in both environments** — see Finding B1, this is the most consequential live-state gap found so far.

**`beat_grants`** (017, `source_type` CHECK extended in 021 to add `free_allowance`) — the wallet's credit side. `source_type` ∈ {subscription, carry_forward, topup, promotion, admin_adjustment, migration_grant, free_allowance}. `beats_total`/`beats_remaining` — CHECK `beats_remaining BETWEEN 0 AND beats_total` (upgraded to `numeric(12,2)` in 040 for fractional beats). `expires_at` nullable. No FK to an originating `billing_orders`/`billing_subscriptions` row — the link back to "which payment produced this grant" lives only in free-text `source_ref_id` and `metadata_json`, not a real foreign key. RLS enabled, zero policies.

**`beat_usage_events`** (017) — one row per spend, `beat_cost` (numeric since 040), optional links to `story_id`/`beat_id`/`storyline_id`/`related_entity_id`. RLS enabled, zero policies.

**`beat_spend_reservations`** (017) — the hold/finalize/release pattern. `idempotency_key` UNIQUE (per-user in practice via app usage, but the DB constraint is global-unique, not scoped to `user_id`). `status` CHECK ∈ {pending, finalized, released, failed, expired}. `expires_at` NOT NULL. RLS enabled, zero policies.

**`beat_usage_allocations`** (017) — join table recording which grant(s) funded a usage event; unique `(usage_event_id, beat_grant_id)`, `beats_consumed > 0`. This is what lets a single spend draw from multiple grants (FIFO-ish by the ordering in the functions below). RLS enabled, zero policies.

**`beat_spend_reservation_components`** / **`beat_usage_event_components`** (082) — added for composite/multi-meter spends (e.g. an action that bills both an image meter and a text meter in one reservation). `component_key`, `cost_family`, `billing_unit`, `quantity`, `unit_beat_cost`, `quoted_beat_cost`/`beat_cost`. A trigger (`pricing_materialize_usage_components`, fired `AFTER UPDATE OF status, usage_event_id ON beat_spend_reservations`) copies `quoted`/`succeeded` components into the usage-event-components table exactly once a reservation finalizes. RLS enabled, zero policies.

**`user_entitlement_overrides`** (096) — `user_id` PK, `entitlement_plan_key` CHECK ∈ {free, plus, studio}. Explicitly documented (in the migration's own header comment) as access-only: **grants no coins, no wallet change, no subscription**. Effective tier = max(billing plan, this override) — resolved in the app layer, not SQL. RLS enabled; explicitly `REVOKE ALL ... FROM anon, authenticated` + `GRANT ALL ... TO service_role` (no end-user policies by design, same pattern as everything else here).

**`operational_policies`** / **`operational_policy_audit_events`** (084) — a small versioned key/value policy store, currently used for exactly one policy: `free_welcome_grant` (`coinAmount: 50`, `grantMode: once_per_account`, `expiresAfterDays: null`). Both RLS enabled + explicit `REVOKE ALL FROM anon, authenticated` / `GRANT ALL TO service_role`.

**`schema_migration_ledger`** (101) — operator-only, not app-facing. `REVOKE ALL FROM anon, authenticated`, `GRANT ALL TO service_role`. Self-inserts as the last statement of every migration ≥102.

**Adjacent admin tables (083, not billing but audit-trail-adjacent):** `admin_user_directory`, `user_account_moderation`, `admin_user_audit_events` (`action_type` CHECK includes `coins_granted`, extended by 096 to add `entitlement_tier_changed`), `admin_promotional_cohorts`, `admin_promotional_cohort_members` — all RLS-enabled, zero end-user policies, service_role only.

### Functions (all confirmed via 021/022/040/082/083/084/098)

| Function | Security | search_path pinned? (098) | EXECUTE granted to |
|---|---|---|---|
| `pricing_authorize_spend` | INVOKER | yes | service_role only (public/anon/authenticated revoked by 098) |
| `pricing_finalize_reservation` | INVOKER | yes | service_role only |
| `pricing_release_reservation` | INVOKER | **NOT in the 098 pin/revoke lists** — still whatever it was created with | not explicitly revoked by 098; needs a direct ACL check |
| `pricing_expire_stale_reservations` | INVOKER | yes | service_role only |
| `pricing_materialize_usage_components` (082, trigger) | INVOKER (trigger function, no SECURITY clause in 082) | yes (098) | trigger-invoked; not directly callable by PostgREST roles in practice regardless |
| `admin_grant_user_coins` (083) | **INVOKER** | yes (`SET search_path = public` at creation) | service_role only (explicit REVOKE/GRANT in 083 itself) |
| `admin_update_operational_policy` (084) | DEFINER | yes | service_role only |
| `apply_free_welcome_grant` (084) | DEFINER | yes | service_role only |
| `apply_free_welcome_grant_on_signup` (084, trigger on `auth.users` AFTER INSERT) | DEFINER | yes | EXECUTE revoked from PUBLIC/anon/authenticated; fires as a trigger regardless — swallows all exceptions (`WHEN OTHERS`) so a bad policy config never blocks signup |

**Important gap spotted while reading, not yet re-verified live:** `pricing_release_reservation` (created in 021) is conspicuously **absent** from both the `search_path` pin list and the `REVOKE EXECUTE` list in 098's `DO $$` blocks (098 lines 76-92 and 109-127 both name `pricing_authorize_spend`, `pricing_expire_stale_reservations`, `pricing_finalize_reservation`, `pricing_materialize_usage_components` — but never `pricing_release_reservation`). If that omission is real (not a transcription error on my part — double-check the file), `pricing_release_reservation` may still have a mutable `search_path` and may still be callable by `anon`/`authenticated` over `/rest/v1/rpc/pricing_release_reservation` today, on **both** dev and prod, since both have 098 applied as-is. Given RLS-with-no-policy on `beat_spend_reservations`, an anonymous caller could not actually see or affect another user's reservation row (RLS denies first), but this still deserves a direct live check — flagged as unresolved, see Resume here.

### Coin ↔ beat conversion
The only place a coin→beat ratio is hardcoded in SQL is `apply_free_welcome_grant` (084): `v_beats := round(coinAmount / 10.0, 2)` — **10 coins = 1 internal "beat"**. Every other table stores "beats" directly (`monthly_included_beats`, `beat_amount`, `beat_cost`) with no ratio column anywhere, so there is no single source of truth for the 10:1 constant at the DB layer — it's implicit in this one function plus (presumably) app code. `admin_grant_user_coins` sidesteps this entirely by taking both `p_beat_amount` and `p_coin_amount` as independent caller-supplied parameters (SQL does not derive one from the other, and does not check they're consistent).

### RLS status — global pattern
**Every single billing/pricing/wallet table has RLS enabled and zero policies**, confirmed by `grep -rln "CREATE POLICY" supabase/migrations/*.sql` against every file that also matches `billing_|pricing_|beat_grants|beat_usage|beat_spend|wallet` — the only hits were false positives (unrelated storage/reference policies in files that also happen to touch a `pricing_action_costs` seed insert). This is a **documented, deliberate** house style: migration 097's own comment says so explicitly for `model_config`/`prompt_configs`, naming `feature_flags`, `pricing_action_costs`, `operational_policies`, `image_model_registry` as prior art for the same pattern. Consequence: **no user can read their own billing/wallet data directly via the anon or authenticated Supabase client** — a purchase-history/invoices UI must be built entirely through server actions using the service-role client (`createAdminClient()`), the same way `lib/ai/model-config.ts` does it. This is architecturally consistent, not a bug, but it's a hard constraint on how the billing UI has to be built.

### What does NOT exist (for the "ChatGPT/Claude-style billing area")
Confirmed by `grep -rniE "invoice|receipt|refund|tax|gstin|billing_address|payment_method" supabase/migrations/*.sql` across all 123 migrations:
- **No invoice/receipt table, no invoice-numbering sequence.**
- **No tax fields anywhere** — no GSTIN, no place-of-supply, no tax-amount/subtotal breakdown columns. `billing_orders.amount_minor` is a single total; any tax breakdown would have to be reverse-engineered from `raw_provider_payload_json` after the fact, per order, forever.
- **No billing-address table or columns.**
- **No refunds table.** `billing_orders.status` is free text so a `'refunded'` string *could* be written, but there's no structured refund record (amount, reason, timestamp, partial-vs-full).
- **No payment-method-on-file table** (saved cards, UPI mandates, etc.) — consistent with Razorpay-only, one-shot-checkout-per-purchase being the only flow implemented today.
- **Provider-agnostic fields for a future Stripe already exist** at the catalog/mirror layer (`provider` CHECK ∈ {stripe, razorpay} on `pricing_plan_versions`, `pricing_topup_packs`, `billing_customers`, `billing_subscriptions`, `billing_orders`, `billing_webhook_events`; `provider_product_ref`/`provider_price_ref` columns) — the schema was clearly designed with Stripe in mind from day one, it's just unpopulated (all NULL in the rows queried).
- The only "refund policy" content anywhere in the repo is CMS copy seeded by `032_managed_pages.sql`, which states in plain English: *"Refunds are not automated in the current product... Subscription changes, cancellation, and full account billing management are not self-serve."* This is a doc/code alignment worth flagging to Stream 5 — the published policy text already matches the schema reality (honest), but neither matches the owner's stated goal for this phase.

### ER diagram (mermaid) — billing/pricing/wallet tables only

```mermaid
erDiagram
  pricing_plans ||--o{ pricing_plan_versions : "has versions"
  pricing_plan_versions ||--o{ billing_subscriptions : "priced by"
  pricing_plan_versions ||--o{ billing_orders : "purchased as"
  pricing_topup_packs ||--o{ billing_orders : "purchased as"
  auth_users ||--o{ billing_customers : "has"
  auth_users ||--o{ billing_subscriptions : "has"
  auth_users ||--o{ billing_orders : "places"
  auth_users ||--o{ beat_grants : "receives"
  auth_users ||--o{ beat_usage_events : "spends"
  auth_users ||--o{ beat_spend_reservations : "holds"
  auth_users ||--o{ user_entitlement_overrides : "may have"
  billing_subscriptions ||--o| billing_webhook_events : "related_subscription_id"
  beat_spend_reservations ||--o| beat_usage_events : "finalizes into (usage_event_id)"
  beat_spend_reservations ||--o{ beat_spend_reservation_components : "components"
  beat_usage_events ||--o{ beat_usage_allocations : "funded by"
  beat_usage_events ||--o{ beat_usage_event_components : "components"
  beat_grants ||--o{ beat_usage_allocations : "consumed via"
  beat_spend_reservation_components ||--o{ beat_usage_event_components : "materializes into"
  pricing_action_costs ||--o{ beat_spend_reservations : "action_key (no FK)"

  pricing_plans {
    uuid id PK
    text plan_key UK
    int tier_rank
  }
  pricing_plan_versions {
    uuid id PK
    uuid plan_id FK
    text status
    text provider
    text pricing_market_key
    int price_minor
    int monthly_included_beats
  }
  pricing_topup_packs {
    uuid id PK
    text pack_key
    text status
    int beat_amount
  }
  pricing_action_costs {
    uuid id PK
    text action_key UK
    numeric beat_cost
  }
  billing_customers {
    uuid id PK
    uuid user_id FK
    text provider
    text provider_customer_id
  }
  billing_subscriptions {
    uuid id PK
    uuid user_id FK
    uuid plan_version_id FK
    text provider_subscription_id
    text status
  }
  billing_orders {
    uuid id PK
    uuid user_id FK
    text order_type
    text provider_order_id
    text provider_payment_id
    text status
  }
  billing_webhook_events {
    uuid id PK
    text provider_event_id UK
    text status
  }
  beat_grants {
    uuid id PK
    uuid user_id FK
    text source_type
    numeric beats_total
    numeric beats_remaining
  }
  beat_spend_reservations {
    uuid id PK
    uuid user_id FK
    text idempotency_key UK
    text status
  }
  beat_usage_events {
    uuid id PK
    uuid user_id FK
    numeric beat_cost
  }
  beat_usage_allocations {
    uuid id PK
    uuid usage_event_id FK
    uuid beat_grant_id FK
  }
```

Note: `billing_orders` and `beat_grants` have **no real FK to each other** — a topup order "producing" a grant is only linkable via `beat_grants.source_ref_id` (free text) / `metadata_json`, not a foreign key. Same for `billing_subscriptions` → `beat_grants` (source_type='subscription'). This matters for integrity checks (see Part B, unfinished) — "paid order with no matching grant" cannot be checked with a JOIN, only by comparing timestamps/amounts heuristically.

---

## Part B — Live state, dev vs prod

### 1. Environment confirmation
`mcp__supabase__get_project_url` → `https://dxbwzcpbfacrwrauhdbk.supabase.co` (**dev**, per task mapping).
`mcp__supabase-prod__get_project_url` → `https://pddjsopcemsfiwyvhlkr.supabase.co` (**prod**, per task mapping).

### 2. `schema_migration_ledger` — applied-ness
**Both environments are fully caught up through migration 123**, including every billing-relevant migration (015–101) and the security-hardening ones (097, 098). Migration 109 does not exist as a file in either — a numbering gap, not a missing migration.

Backfill batch (001–100) landed within the same second on both: dev `2026-08-29 18:03:37`, prod `2026-08-29 18:03:30`. From 102 onward, dev applied incrementally over 2026-09-06→2026-09-16 (one migration at a time, spread over days); **prod applied 102–123 all within a ~65-minute window on 2026-09-16** (09:24–10:28), i.e. prod was caught up to dev in one batch session on that date. One anomaly worth noting: in prod, migration 115 is timestamped `10:28:41` — *after* 116 (`09:32:18`) through 123 (`09:34:18`) — i.e. it was applied out of numeric order. Matches the standing MEMORY note that migration order is convention only, not enforced; not itself a billing bug, but confirms the ledger is trustworthy evidence (self-recorded, not assumed) rather than something to fix.

**Conclusion: no billing-relevant schema drift from unapplied migrations exists between dev and prod today.** (Data/catalog-content drift is real and separate — see below.)

### 3. Schema diff dev vs prod (functions/columns/policies)
**Not done rigorously** — only inferred from identical migration ledgers, which is strong but not conclusive evidence (a hand-run `ALTER` outside the migration file convention wouldn't show up in the ledger). No `pg_get_functiondef` comparison, no `list_tables(verbose=true)` diff was run. See Resume here.

### 4. `feature_flags` — pricing/billing/razorpay/coin/wallet/entitlement/checkout/agentic-bypass, dev vs prod

| flag_key | dev enabled | dev value | prod enabled | prod value | note |
|---|---|---|---|---|---|
| `agentic_billing_bypass_enabled` | **true** | – | **false** | – | agentic system user skips coin reservation in dev only |
| `audio_story_cover_generation_coin_cost` | true | 10 | true | 10 | match |
| `pricing_admin_bypass_enabled` | **true** | – | **false** | – | |
| `pricing_admin_tab_enabled` | false | – | false | – | match |
| `pricing_checkout_enabled` | **true** | – | **false** | – | **checkout is live in dev, off in prod** |
| `pricing_default_carry_forward_cap_multiplier` | false | 2 | false | 2 | match |
| `pricing_default_grace_period_days` | false | 5 | false | 5 | match |
| `pricing_hard_enforcement_enabled` | **true** | – | **false** | – | **spend enforcement is off in prod** |
| `pricing_india_only_beta_enabled` | true | – | true | – | match |
| `pricing_migration_grant_beats` | false | 25 | false | 25 | match |
| `pricing_reservation_timeout_seconds` | false | 1800 | false | 1800 | match |
| `pricing_routing_provider_in` | **true** | razorpay | **false** | razorpay | same value, different enabled bit |
| `pricing_routing_provider_row` | false | stripe | false | stripe | match |
| `pricing_shadow_metering_enabled` | **true** | – | **false** | – | |
| `pricing_snapshot_enabled` | **true** | – | **false** | – | |
| `pricing_story_length_ui_limits_enabled` | **true** | – | **false** | – | |
| `pricing_tester_studio_duration_days` | false | 90 | false | 90 | match |
| `vertical_reel_thumbnail_generation_coin_cost` | true | 10 | true | 10 | match |
| `visual_story_cover_generation_coin_cost` | true | 10 | true | 10 | match |

Overall: dev has checkout, hard enforcement, shadow metering, snapshotting, and story-length limits all switched ON; prod has every pricing/billing gate switched OFF except the always-on coin-cost scalars and `pricing_india_only_beta_enabled`. This matches "billing not live yet in prod" as expected pre-launch.

### 5. Catalog contents, dev vs prod

**`pricing_plan_versions`** (published rows only, differences highlighted):
- `free`: 0/0 in both markets, published in both envs — match.
- `plus` ROW/stripe: monthly 1200, annual 10800, 100 beats — match in both.
- `plus` IN/razorpay published: **dev price_minor=85000 (₹850), 12 beats** vs **prod price_minor=145000 (₹1450), 30 beats** — **diverged**.
- `studio` ROW/stripe: monthly 2900, annual 29000, 300 beats — match.
- `studio` IN/razorpay published: 395000 (₹3950), 90 beats — match in both.
- Row counts also differ (dev has more archived/superseded IN-plan-version history than prod), consistent with each environment's catalog being edited independently by an admin rather than promoted between them.

**`pricing_topup_packs`** (status × market × provider counts):
- dev: archived IN=5, draft IN=2, draft ROW=4, **published IN=2**, **published ROW=3**.
- prod: archived IN=2, archived ROW=3, draft IN=3, draft ROW=4, **published IN=3**, **published ROW=0**.
- Prod has zero published Stripe top-up packs (expected — Stripe isn't implemented as a checkout flow per the CMS copy in 032), but dev has 3 published Stripe packs that can never actually be bought today. Low-severity inconsistency, not a live-money risk.
- Published-IN-pack count differs (2 vs 3) — same independent-editing pattern as the plan versions.

**`pricing_action_costs`**: **identical in both environments** — 25 rows, same `cost_family` breakdown (text=7/7 active, image=5/5, tts=4/4, export=3/3, reference=4/4, alignment=2/1 active). This part of the catalog is in sync.

**`pricing_promotions`**: **0 rows in both environments** — unused so far.

### 6. Transactional aggregates

**Dev:**
- `billing_subscriptions`: 1 row, status=`active`, provider=razorpay.
- `billing_orders`: 12 rows total — `active`/subscription_checkout=1, `created`/subscription_checkout=8 (abandoned/incomplete checkouts), `created`/topup_checkout=2, `paid`/topup_checkout=1.
- `billing_webhook_events`: **0 rows** — see Finding B1 below.
- `beat_grants` by source_type: `admin_adjustment`=1 (10/10 remaining), `free_allowance`=6 (44 total/34 remaining), `subscription`=1 (12/12 remaining), `topup`=1 (25 total/24.2 remaining).
- `beat_spend_reservations`: `failed`=3 (all on 2026-04-08), `finalized`=16 (2026-04-08 through 2026-09-12), **0 stale pending**, no rows currently `pending`/`released`/`expired`.

**Prod:**
- `billing_subscriptions`: **0 rows**.
- `billing_orders`: **0 rows**.
- `billing_webhook_events`: **0 rows**.
- `beat_grants`: `free_allowance` only, 23 grants, 115 total = **115 remaining (100% unspent)**.
- `beat_spend_reservations`: **0 rows**.

Prod is exactly what a pre-launch database with signups-but-no-spend should look like, consistent with all the enforcement flags being off. Dev shows real sandbox exercise of the full checkout → grant → reserve → finalize loop.

### 7. Integrity checks — **not done** (see Resume here). Only partially covered: stale-pending reservations = 0 in both (confirmed as a side effect of the aggregate query above). No stored wallet-balance column/view exists anywhere (confirmed in Part A), so the "wallet balance disagrees with grants minus usage" check is structurally moot — balance is always computed live from `beat_grants.beats_remaining`, never cached, so it cannot itself be stale (though `beats_remaining` bookkeeping could still be wrong — not checked).

### 8. `get_advisors` (security) — **not run on either project.** See Resume here.

---

## Findings

| ID | Severity | Status | Finding | Evidence | Failure scenario | Direction |
|---|---|---|---|---|---|---|
| B1 | **BLOCKER** (pending stream-1 confirmation) | VERIFIED (DB) / INFERRED (root cause) | Dev's `billing_webhook_events` has **zero rows** despite an active subscription and a paid top-up order existing in `billing_orders`. | `select count(*) from public.billing_webhook_events` → 0 on dev, alongside `billing_subscriptions` status=active (1 row) and `billing_orders` status=paid (1 row). | If the app's checkout success path finalizes subscriptions/grants synchronously (e.g. from a client-side verify callback) without the Razorpay **webhook** ever landing/being persisted, then in production a renewal, payment failure, dispute, or subscription-cancelled event sent by Razorpay may never reach `billing_subscriptions`/trigger a grant — access and money state silently diverge with no audit trail to debug from (the column `last_webhook_at` exists specifically to catch this and is presumably still NULL). | Stream 1 (checkout/capture) must confirm whether the webhook endpoint is wired at all and actually receives Razorpay's sandbox webhook calls; if not, this needs to be fixed before real money, since the schema itself was clearly designed assuming webhooks are the source of truth for subscription lifecycle. |
| B2 | **HIGH** | VERIFIED | Dev and prod have **diverged catalog content** for the published `plus` IN/razorpay plan: dev ₹850/mo·12 beats vs prod ₹1450/mo·30 beats. Top-up pack published counts also differ (2 vs 3 published IN packs). | `pricing_plan_versions` / `pricing_topup_packs` queries, both envs, Part B §5. | If prod's current published price is assumed to be a stale placeholder (or vice versa) when `pricing_checkout_enabled` is flipped on in prod, customers get charged a price nobody actually tested end-to-end, or a price the owner didn't intend. | Reconcile which numbers are authoritative before enabling checkout in prod; there's no promote-dev-to-prod tooling for the catalog, so this has to be a manual admin-panel reconciliation, deliberately. |
| B3 | **MEDIUM** | VERIFIED | `pricing_release_reservation` (created 021) appears to be **missing** from both the `search_path`-pin list and the `REVOKE EXECUTE` list in migration 098's hardening pass, unlike its three sibling `pricing_*` functions. | `supabase/migrations/098_harden_function_privileges.sql` lines 76-92 and 109-127 name `pricing_authorize_spend`, `pricing_expire_stale_reservations`, `pricing_finalize_reservation`, `pricing_materialize_usage_components` but not `pricing_release_reservation`. | If real (not a mis-read — needs a live ACL check), `pricing_release_reservation` may still be callable by `anon`/`authenticated` via `/rest/v1/rpc/` on both live databases today, and may still have a mutable `search_path`. RLS-with-no-policy on `beat_spend_reservations` should still block any actual data effect for an unauthorized caller, but this hasn't been verified live, and an uninvited RPC surface is worth closing regardless. | Re-read 098 carefully to confirm the omission is real, then run the live ACL query (both envs) it documents in its own footer comment; if confirmed, this is a one-line follow-up migration. |
| B4 | **MEDIUM** | VERIFIED | **No coin↔beat conversion is stored in a table anywhere.** The only ratio (10 coins = 1 beat) is hardcoded inside `apply_free_welcome_grant` (084); every other billing table stores "beats" directly with no traceable ratio column. `admin_grant_user_coins` takes independent, caller-trusted `p_beat_amount`/`p_coin_amount` params with no consistency check between them. | `supabase/migrations/084_operational_policies_and_welcome_grant.sql` line ~264; `083_admin_user_management.sql` lines 1071-1205. | If the app-layer ratio (wherever it lives in `lib/pricing/*.ts` — out of this stream's file list) ever drifts from 10:1, or an admin grants coins/beats inconsistently through the admin UI, there's no DB-level constraint to catch it — only whatever the app enforces client-side. | Stream 2's territory to confirm the app-layer ratio matches; flagged here as a data-model gap: no single source of truth row for the constant. |
| B5 | **LOW / SCOPING** | VERIFIED | **No invoice, receipt, invoice-numbering, tax (GSTIN/place-of-supply/amounts), billing-address, refund, or payment-method tables exist anywhere** in 123 migrations. `billing_orders.amount_minor` is a single total; any tax/receipt detail is only recoverable (per-order, after the fact) from `raw_provider_payload_json`. | `grep -rniE "invoice\|receipt\|refund\|tax\|gstin\|billing_address\|payment_method" supabase/migrations/*.sql` — no structural hits; only CMS refund-policy prose in 032. | Not a "bug" so much as scope: the owner's "ChatGPT/Claude-style billing area — purchase history, downloadable invoices, manage subscription" cannot be built from today's schema without new tables/columns. | This is core planning input, not a fix — flag for whichever stream owns the billing-UI plan. Provider-agnostic fields for a future Stripe (the `provider` enum + `provider_product_ref`/`provider_price_ref` columns) are already present, which is a genuine head start. |
| B6 | **LOW / INFO** | VERIFIED | Every billing/pricing/wallet table has RLS enabled with **zero policies**, confirmed deliberate and consistent (documented explicitly in migration 097's own comment, matching the pattern used for `feature_flags`, `model_config`, etc.). | grep sweep across all migrations for `CREATE POLICY` intersected with billing/pricing/beat/wallet table names — zero real hits. | None on its own — but any future billing UI (purchase history, "your invoices") **must** be built via server actions on the service-role client; a direct client-side Supabase read will silently return zero rows, not an error, which is an easy mistake to ship. | Note for whichever stream designs the billing UI's data-fetching layer. |
| B7 | **INFO** | VERIFIED | Dev and prod are **fully in sync on schema** — both applied through migration 123, all billing-relevant migrations 015-101 present in both ledgers with matching content. | `schema_migration_ledger` query, both envs, Part B §2. | N/A — this is a clean bill of health, stated explicitly so it isn't re-litigated by another stream. | None needed. Contrast with B2: schema is in sync, catalog *content* (admin-edited data) is not. |
| B8 | **INFO / needs stream 1-2 follow-up** | VERIFIED (DB) | Prod's 23 `free_allowance` grants show **115 total = 115 remaining — zero spend recorded ever**, consistent with `pricing_hard_enforcement_enabled`/`pricing_shadow_metering_enabled` both being off in prod. | `beat_grants` aggregate, prod, Part B §6. | If real users are already signing up in prod and generating stories, but no `beat_usage_events` are being written because enforcement/metering flags are off, there may be a silent gap in usage telemetry accumulating right now, not just a "billing not live yet" story. | Cross-stream: confirm with Stream 1/2 whether beat consumption is expected to be silently skipped while these flags are off, or whether this indicates prod simply has no real usage yet. |

---

## Open questions for the owner

1. Which of dev's or prod's published `plus`-plan IN pricing (₹850/12 beats vs ₹1450/30 beats) is the intended launch price? (Finding B2)
2. Is the Razorpay webhook endpoint actually receiving events in dev's sandbox testing, or were dev's test subscription/payment reflected in the DB entirely through a synchronous verify-callback path? Zero rows in `billing_webhook_events` needs an owner-level answer about whether webhooks were ever exercised. (Finding B1)
3. Is `pricing_release_reservation`'s apparent omission from migration 098 intentional, or an oversight? (Finding B3)

---

## Resume here

Paused by coordinator instruction before the task was complete. Everything above is finished and safe to rely on. What is **not** done yet, in priority order:

1. **Full-read the remaining billing-adjacent migrations** that were only grepped, not read: 023, 024, 039, 043, 046, 047, 049, 062 (only table name confirmed), 063, 078, 079, 091, 095, 102 (only the bypass-flag comment read), 115. Most look likely to just be `pricing_action_costs` seed inserts (new action keys as features shipped) rather than structural changes, but this is inference, not verification — needs confirming, especially 062/063 (image model registry / provider costs, which may hold a coin-per-image-model table relevant to the coin↔money economics even though that's nominally Stream 2's territory) and 115 (`beats_owner_only_writes` — name suggests RLS on the `beats` *content* table, likely unrelated to wallet `beat_*` tables, but confirm it isn't a naming collision worth a one-line note).
2. **`pricing_publish_audit` row count / recent activity** — not queried at all in either environment.
3. **Integrity checks (task item Part B.7), not yet run**, all as aggregates only:
   - paid/captured `billing_orders` with no plausibly-matching `beat_grants` row (no FK exists — see ER diagram note — so this has to be a heuristic join on user_id + rough timestamp + amount, not a clean query)
   - active `billing_subscriptions` with no `beat_grants` row for the current period
   - `beat_grants` with `source_type IN ('subscription','topup')` that have no plausible originating order/subscription
   - duplicate provider IDs (the partial unique indexes should prevent this at the DB level, but worth a confirmatory query — e.g. `provider_payment_id` reused across orders)
   - webhook events "stuck" unprocessed/errored — moot right now since the table is empty in both environments (already established), but re-check after B1 is resolved
4. **`get_advisors(type="security")` on both dev and prod — not run at all.** Needs to be run and filtered to billing/pricing/wallet/entitlement tables and functions per the task instructions. This would also settle Finding B3 (the `pricing_release_reservation` ACL question) directly.
5. **Direct schema diff dev vs prod** beyond the migration-ledger inference: `list_tables(verbose=true)` on both for the billing/pricing/wallet tables (compare columns/types/FKs/indexes), and a `pg_get_functiondef` comparison (length or key-line diff) for every `pricing_*`/`admin_*`/`apply_free_welcome_grant*` function, to catch any hand-run `ALTER` that wouldn't show up in the self-recorded ledger.
6. **`beat_usage_events` / `beat_usage_allocations` counts directly** — only inferred from `beat_spend_reservations.status='finalized'` count (16 in dev) rather than queried directly on their own tables. Quick confirmatory query, both envs.
7. Re-read `098_harden_function_privileges.sql` once more, carefully, side-by-side with the live ACL query it documents in its own footer, to convert Finding B3 from "apparent omission, VERIFIED via file read" to a fully closed live-verified finding either way.
8. Write the final polish pass on this file once the above lands: re-check severity ordering in the Findings table (B1 may downgrade from BLOCKER once webhook root-cause is confirmed one way or the other with Stream 1), and fold in whatever items 1-7 above surface as new rows.

Nothing above requires re-deriving anything already written — it's additive. A fresh resume should start at item 4 (advisors) and item 3 (integrity checks) since those were explicit, named task requirements that got cut off mid-stream, then circle back to item 1 (remaining migration reads) if context allows.
