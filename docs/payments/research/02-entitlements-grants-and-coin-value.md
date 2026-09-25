# Entitlements, Coin Grants, and Coin↔Money Value

_Stream 2 · audited 2026-09-17 · branch payments_

## Scope and method

Static code audit (read-only) of `lib/pricing/`, `lib/agentic/billing-identity*` + `flags.ts`,
`lib/ai/pricing.ts`, `lib/ai/image-models.shared.ts`, `app/actions/pricing-*.ts`, `lib/types/pricing.ts`,
`lib/billing/razorpay-sync.ts`, `app/api/billing/razorpay/webhook/route.ts`, `lib/media/image-job-runner.ts`,
`app/actions/beat-bundle.ts`, and the SQL migrations that define the coin/grant/reservation schema and RPCs
(015–022, 040, 062–064, 082–084, 098, plus everything grep turned up beyond that range). Cross-checked
against **live dev DB state** via `mcp__supabase__execute_sql` (SELECT-only): feature flag values, the
published plan/top-up catalog, the image-model registry, and actual `pricing_action_costs` /
`beat_grants` / `beat_spend_reservations` rows. No prod queries were needed for this stream. No files
modified, no writes issued, no payments made, no servers run.

Two apparent bugs I found by reading the migrations in isolation turned out to already be fixed by a
later migration once I checked live data — noted inline where that happened, as a caution against
trusting migration N without checking whether N+k superseded it.

## Glossary (terms as actually used in code, oldest-to-newest layer)

| Term | Meaning |
|---|---|
| **Beat** | The internal accounting unit. `COINS_PER_BEAT = 10` is the only place beats and coins relate (`lib/types/pricing.ts:10`). Beats are stored with 2 decimal places (`numeric(12,2)` since migration 040) — fractional beats are normal, not an error. |
| **Coin** | The user-facing currency. Always `beats × 10`. Every admin/user-facing price is quoted in coins; every DB column and RPC parameter is in beats. |
| **Grant** (`beat_grants` row) | An allotment of beats from one source (subscription cycle, top-up, free welcome, promo, admin adjustment), with its own `beats_remaining`, optional `expires_at`. |
| **Reservation** (`beat_spend_reservations` row) | A temporary hold created by `pricing_authorize_spend`, keyed by a caller-supplied `idempotency_key`, terminal states `finalized` / `released` / `failed` / `expired`. |
| **Usage event** (`beat_usage_events` row) | The permanent, immutable record created when a reservation is finalized — this is "the charge really happened." |
| **Allocation** (`beat_usage_allocations` row) | Which grant(s) funded a usage event, in spend-priority order (FIFO-ish, see §2). |
| **Component** (`beat_spend_reservation_components` / `beat_usage_event_components`, migration 082) | Sub-line-items inside one reservation/usage event — e.g. a beat generation is `text` + `image` components summed into one reservation. |
| **Action key** | A `PricingActionKey` (e.g. `continue_story_new_beat`) — the catalog key. Some action keys are charged directly from their catalog row; others (image-bearing ones) are only ever used as a *label*, and the real cost is the sum of separately-quoted components (§3). |
| **Entitlement tier** vs **billing plan** | `planKey` = what was actually paid for. `entitlementPlanKey` = what feature gates read (can be lifted by admin promotion or the admin account itself, never lowered, never affects coins). See `lib/pricing/entitlement-tier.shared.ts:1-12`. |

## 1. Plans and tiers

**Plan keys:** `free`, `plus`, `studio` (`lib/types/pricing.ts:15`, tier ranks 0/1/2 in
`entitlement-tier.shared.ts:15-19`). Each plan has per-market (`IN`/`ROW`) × per-interval
(`monthly`/`annual`) **plan versions** with independent price/coins/caps, going through
`draft → published → archived` (`pricing_plan_versions.status`, migration 015). A partial unique index
enforces at most one `draft` and one `published` version per (plan, interval, market, currency)
tuple (`015_pricing_catalog.sql:107-113`).

**Live published catalog (dev DB, queried 2026-09-17):**

| Plan | Market | Interval | Price | Coins/cycle | Story-length cap | Downloads | Unbranded export |
|---|---|---|---|---|---|---|---|
| free | IN/ROW | monthly | ₹0 / $0 | 0 | 4 | yes (watermarked) | no |
| plus | IN | monthly | ₹850.00 | 120 | 8 | yes | no |
| plus | ROW | **annual only** | $108.00/yr | 100/cycle | 8 | yes | no |
| studio | IN | monthly | ₹3,950.00 | 900 | **12** | yes | yes |
| studio | ROW | monthly | $29.00 | 300 | **8** | yes | yes |
| studio | ROW | annual | $290.00/yr | 300/cycle | 8 | yes | yes |

Evidence: live query joining `pricing_plans`/`pricing_plan_versions` filtered to `status='published'`,
and `pricing_plans.feature_flags_json`. `plus`/`ROW` has **no published monthly version** (only an
`archived` one) — a ROW user cannot self-serve monthly Plus today. IN has **no published annual version
at all** for either paid plan (only `draft` placeholders at ₹0, and `prepareRazorpayCheckoutInternal`
explicitly refuses annual+Razorpay checkout regardless: `app/actions/pricing-checkout.ts:46-48`, message
*"Yearly checkout is not available yet for the India market"*). Studio's `story_length_cap` differs
12 (IN) vs 8 (ROW) for the same tier — likely a data-entry inconsistency worth an owner check, not a code
bug (the code just renders whatever is configured).

**Effective tier resolution** (`lib/pricing/snapshot.ts:99-182`): pick the newest subscription that is
"entitled" — status in `{active, trialing, authenticated}`, or in grace (`{pending, halted}` with
`grace_period_ends_at` still future) — else fall back to the market's published free plan, else a
hardcoded zero-coin fallback snapshot (`buildFallbackFreeSnapshot`, lines 184-219) if even the free plan
row is missing. **`entitlementPlanKey`** is then computed separately
(`resolveEffectiveEntitlementTier`, `entitlement-tier.shared.ts:35-52`): admin's own account always
resolves to `studio`; an admin-set `user_entitlement_overrides` row can lift (never lower) the tier. This
is deliberately promote-only and **never touches coins or `planKey`** — billing truth and entitlement are
two different fields on the same snapshot (`EffectivePricingSnapshot.planKey` vs `.entitlementPlanKey`,
`lib/types/pricing.ts:356-364`), and the coin cost charged to a promoted account is identical to what a
real subscriber on that tier pays (`lib/pricing/coin-economy.ts:79-87`, comment makes this explicit).

**Where billing truth and entitlement diverge:** only when an admin override exists, or for the admin
account itself. Both are read from `user_entitlement_overrides` (`enforcement.ts:680-696`) — a missing
row or a read error both resolve to "no promotion," fail-closed by design (never widens access on a
DB error).

## 2. Grants

Seven declared `source_type`s (`BEAT_GRANT_SOURCE_TYPES`, `lib/types/pricing.ts:33-41`); **two are dead
code** — see finding G-1.

| Source | Creates it | Amount | Expiry | Verified live? |
|---|---|---|---|---|
| `subscription` | `grantSubscriptionCycleIfMissing` (`lib/billing/razorpay-sync.ts:177-230`), called from every Razorpay subscription webhook/verify event that resolves a user+plan version | `planVersion.monthly_included_beats`, flat, admin-set | `subscription.current_end` | yes (1 row in dev) |
| `topup` | `grantTopupIfMissing` (`razorpay-sync.ts:128-175`) | `topupPack.beat_amount`, flat | none | yes (1 row) |
| `free_allowance` | `apply_free_welcome_grant` RPC (`084_operational_policies_and_welcome_grant.sql:210-304`), fired once at signup via an `AFTER INSERT ON auth.users` trigger, and again defensively at first authorize (`enforcement.ts:258-280`) | config-driven, `operational_policies.free_welcome_grant.config_json.coinAmount` — **currently 50 coins**, `once_per_account` | `expiresAfterDays` in policy config — **currently `null` (never expires)** | yes (6 rows, dev) |
| `promotion` | `admin_execute_promotional_cohort` (bulk, `083_admin_user_management.sql:~830-880`) | admin-set beats + expiry, per cohort | admin-set | 0 rows yet |
| `admin_adjustment` | `admin_grant_user_coins` (`083_admin_user_management.sql:1071-1199`) | admin-set, capped at 1,000,000 beats, requires reason ≥3 chars + idempotent `request_key` | admin-set, must be future | 1 row |
| `carry_forward` | **nothing creates this** — dead source type | — | — | 0 rows |
| `migration_grant` | **nothing creates this** — dead source type | — | — | 0 rows |

**Consumption order** (both `pricing_authorize_spend` and `pricing_finalize_reservation`, e.g.
`040_fractional_action_costs.sql:107-116, 262-271`): `promotion` first, then
`subscription`/`carry_forward`/`admin_adjustment`/`migration_grant`/`free_allowance` together (tie-broken
by soonest expiry, then oldest `granted_at`, then `id`), then `topup` last. So a subscriber's monthly
coins and a signup grant are spent before a purchased top-up — reasonable, though it does mean a top-up
purchase is "last resort" money that can sit unused for a long time if the user keeps renewing.

**Monthly refill trigger:** any Razorpay webhook event that carries a `subscription` entity id is routed
through `syncRazorpaySubscriptionState` unconditionally (`app/api/billing/razorpay/webhook/route.ts:110-155`
— note it does **not** switch on `payload.event` at all before calling this), which then calls
`grantSubscriptionCycleIfMissing`. That function only inserts when status is `active` or `authenticated`
(`razorpay-sync.ts:188`), and is idempotent via `source_ref_id = "{subscriptionId}:{current_start}"`
(`razorpay-sync.ts:192-205`) — so repeated webhook deliveries for the same cycle correctly grant once.
**Open question (cross-stream with #1 checkout):** granting on `authenticated`, not only `active`, means
the exact payment-capture semantics of that Razorpay status need confirming — see risk R-1.

**G-1 — `carry_forward` and `migration_grant` are schema-only, never created.** `VERIFIED`. Both source
types are declared in the CHECK constraint and referenced in every ORDER BY priority clause
(`021_pricing_enforcement_primitives.sql:13,83`, repeated through 040), `pricing_plan_versions` carries a
real `carry_forward_cap_multiplier` column threaded all the way into `EffectivePricingSnapshot`'s type,
and `pricing_default_carry_forward_cap_multiplier` / `pricing_migration_grant_beats` are live, documented
runtime flags with UI labels (`lib/types/pricing.ts:224-252`) — but a full-codebase grep for any `INSERT`
against `beat_grants` with `source_type IN ('carry_forward','migration_grant')` finds nothing, in `.ts` or
`.sql`. **Failure scenario:** a subscriber who doesn't spend their monthly coins believes (per the "carry
forward cap" language in flags/schema) unused coins roll over; they don't — the per-cycle grant simply
expires at `current_period_end` with whatever is left unspent. **Direction:** either implement the
rollover grant at cycle-renewal time, or remove the dead columns/flags so nothing implies a feature that
isn't there. Severity **MEDIUM** — not a fund-safety bug, but a real gap between what the schema/flags
promise and what happens, and it's exactly the kind of thing a support ticket surfaces post-launch.

## 3. Coin ↔ money

**There is no single, explicit "1 coin = X money" conversion stored anywhere.** `COINS_PER_BEAT = 10`
(`lib/types/pricing.ts:10`) is the *only* fixed ratio in the system, and it relates beats to coins, not
coins to currency. Every plan price and every top-up price is an admin-entered `price_minor` on its own
row, independent of every other row. I confirmed this by computing the implied per-coin price from live
published data:

| Product | Market | Implied price/coin |
|---|---|---|
| Top-up "120 Coins" | IN | ₹3.75 |
| Top-up "240 Coins" | IN | ₹3.54 |
| Studio subscription | IN | ₹4.39 |
| Plus subscription | IN | ₹7.08 |
| Top-up "250 Coins" | ROW | $0.016 |
| Top-up "2,000 Coins" | ROW | $0.010 |
| Studio subscription | ROW | $0.0967 |

**R-2 — the implied India price-per-coin is roughly 3–7× the USD-equivalent ROW price-per-coin, not
lower.** `VERIFIED` (arithmetic on live DB rows above; ₹3.5–7/coin ≈ $0.042–0.084 at ~₹83/$1, vs.
$0.010–0.097 ROW). SaaS pricing for India is conventionally *discounted* relative to US/ROW for
purchasing-power reasons; here it's the opposite for top-ups specifically. This may be intentional
(Razorpay fees, GST pass-through, a deliberate India-first pricing test) but it reads as an inversion
worth an explicit owner decision before it's live with real money, not something the code enforces on
purpose. Severity **MEDIUM** (business/margin risk, not a correctness bug).

> **Reviewer check (Opus, dev DB, published rows, 2026-09-17).** Direction confirmed; two corrections.
>
> | Product | Market | Price | Coins | Per coin |
> |---|---|---|---|---|
> | Plus monthly | IN | ₹850 | 120 / month | ₹7.08 |
> | Studio monthly | IN | ₹3,950 | 900 / month | ₹4.39 |
> | 120 Coins top-up | IN | ₹450 | 120 | ₹3.75 |
> | 240 Coins top-up | IN | ₹850 | 240 | ₹3.54 |
> | Studio monthly | ROW | $29 | 3,000 / month | $0.0097 |
> | Studio annual | ROW | $290 | 3,000 / month | ≈ $0.0081 |
> | Plus annual | ROW | $108 | 1,000 / month | ≈ $0.0090 |
> | 250 / 800 / 2,000 Coins top-ups | ROW | $4 / $10 / $20 | — | $0.016 / $0.0125 / $0.010 |
>
> 1. The "Studio subscription ROW $0.0967" figure above divides the **annual** price by **one month's**
>    coins. Annual plans grant `monthly_included_beats` per month, so the real figure is ≈ $0.008.
>    Top-up to top-up, India costs ≈ 3–4.5× ROW per coin (at ~₹83/$), not 3–7×.
> 2. **Missed and more important: in India the subscription is worse value than a top-up.** Plus costs
>    ₹850 for 120 coins a month; the ₹850 top-up gives 240 coins, twice as many, and top-ups don't
>    expire at cycle end the way subscription grants do. Unless Plus carries features worth the gap, no
>    informed user subscribes to Plus. This needs an owner pricing decision before launch.
> 3. There is no published ROW Plus **monthly** version. Prod catalog may differ — stream 03 compares.

**Per-action coin costs** come from `pricing_action_costs` (admin-editable, `beat_cost numeric(12,2)`,
plus `free_enabled`/`plus_enabled`/`studio_enabled` per-tier gates and an `effective_from`/`effective_to`
window for scheduled price changes). Live dev values include genuinely fractional beats: e.g.
`align_story_text_overlay = 0.30`, `export_video_sd = 0.20`, `generate_narration_preview = 0.00`
(free), `regenerate_image = 0.80`. One row, `image_generation`, is a pure **tier gate with `beat_cost = 0`**
and `metadata_json.rateStrategy = 'image_model_registry'` (`082_coin_economy_gateway.sql:93-104`) — its
real per-image price comes from `image_model_registry.coin_cost_per_image` (admin-editable
`NUMERIC(10,2)`, `062_image_model_registry.sql:29`), converted via `coinsToBeatCost()` = `coins / 10`
(`lib/ai/image-models.shared.ts:115-117`).

**A note on a bug that looked real but wasn't:** the *default, live, user-visible* image model
(`gemini-3.1-flash-image`, `image_generation` task) is priced at **5 coins/image = 0.5 beats** (confirmed
live in dev DB). Migration `017_wallet_core.sql` originally typed every beat column (`beat_cost`,
`beats_total`, `beats_remaining`, `requested_beat_cost`) and the `pricing_authorize_spend`/
`pricing_finalize_reservation` RPC parameters as `integer` — which would make a 0.5-beat authorize call
fail with a Postgres cast error the moment hard enforcement is on. **This was already fixed**: migration
`040_fractional_action_costs.sql:5-51` drops and recreates both functions with `numeric` parameters and
`ALTER COLUMN ... TYPE numeric(12,2)` on every beat column. I confirmed live `beat_spend_reservations`
rows with `requested_beat_cost = 0.50` and `0.30` in `finalized` status, so fractional beats genuinely
work end-to-end today. Flagging this only so a future reader doesn't re-derive the same false alarm from
reading migration 017/021 in isolation — **check 040 before concluding a beat-typing bug exists.**

**Worked example — one beat with one storyboard image**, using live dev values, default image model,
default `start_story_initial_beat`:

- Charged components (`authorizeImageModelBillableActionForUser`,
  `lib/pricing/image-aware-authorize.ts:106-127`): `start_story_initial_beat_prompt_only` (0.50 beats,
  from `pricing_action_costs`) + `image_generation` × 1 (`coinsToBeatCost(5) = 0.50` beats, from the
  image model registry) = **1.00 beat = 10 coins** total.
- Provider cost (from `lib/ai/pricing.ts:34-45,95-111`): `gemini-3.1-flash-image` at the default `1K`
  size costs **$0.067/image**. Text generation for the beat itself is a separate model call not modeled
  in this file with exact token counts for this pipeline stage, so it's excluded here rather than
  guessed — the image alone is the dominant, verifiable cost.
- Coin value at the point of sale: **10 coins** is worth ₹35.4–37.5 if bought via an India top-up, or
  ₹43.9 if drawn from a Studio-India subscription balance; $0.10–0.16 if bought via a ROW top-up, or
  $0.97 drawn from a ROW Studio balance (§3 table above).
- Gross margin on the image alone (India top-up basis): (₹35.4 − $0.067×~₹83) / ₹35.4 ≈ **84%**. On the
  ROW top-up basis: ($0.10 − $0.067) / $0.10 ≈ **33%**, materially thinner — another angle on R-2:
  ROW top-up pricing leaves much less room over provider cost than India top-up pricing does.
- **What the admin can tune:** `pricing_action_costs.beat_cost` per action (with effective-date
  scheduling), per-tier enable flags, and `image_model_registry.coin_cost_per_image` per model/task.
  There is **no margin calculator or cost-to-price helper anywhere in `lib/pricing/` or
  `app/actions/pricing-admin.ts`** (grepped for `margin`, `perCoin`, `costPerCoin`, `exchangeRate` —
  zero hits outside unrelated UI-CSS "margin"). `components/admin/ImageModelRegistryStudio.tsx` does show
  provider cost alongside the coin price for images specifically, so there's *some* cost-awareness UI for
  that one cost family, but nothing cross-cutting and nothing for text/TTS/alignment/export costs.

**R-3 — the pre-charge "sticker price" shown to users can silently drift from what's actually charged.**
`VERIFIED`. `resolveStoryContinuationDisplayQuote` (`lib/pricing/story-continuation.shared.ts:14-35`),
used by `components/story/StoryScreen.tsx`, quotes the flat `continue_story_new_beat` catalog row
(currently 1.00 beat) as the price shown *before* the user continues a story. But the actual charge — via
`authorizeImageModelBillableActionForUser` — is the **sum of `continue_story_new_beat_prompt_only` (0.50)
+ the selected image model's live coin cost**, which today happens to also total 1.00 beat by
coincidence (0.50 + 0.50). The two numbers are computed from **completely different code paths** and
nothing keeps them in sync. **Failure scenario:** an admin raises the default image model's
`coin_cost_per_image` from 5 to 10 coins (a one-field edit in `ImageModelRegistryStudio`) — the displayed
"continue costs 10 coins" quote goes stale immediately (still reads the flat catalog row, now wrong),
while the real charge silently becomes 15 coins. No error, no warning — just a UI that understates price
after the very next admin pricing change. The reverse (overstating) is equally possible. Same
decoupling exists for `start_story_initial_beat`/`start_reel_full_generation`'s flat rows vs. their
composed real cost, and `regenerate_image`'s flat row (0.80 beats) is **entirely unused** for the actual
charge (`getPromptOnlyBaseActionKey` returns `null` for it,
`lib/pricing/image-aware-authorize.ts:23-24`, so its cost comes 100% from the image model, 0% from its own
catalog row) — worth checking whether any UI surface still quotes it. Also noticed: `start_reel_full_generation`
(1.00) is priced *lower* than `start_reel_full_generation_prompt_only` (1.50) in the catalog — backwards
for a "with images costs more than without" intuition; harmless today only because nothing reads that
row for the real charge, but a trap for whoever wires up a reel price display next. Severity **HIGH** —
this is a customer-facing price-integrity bug that gets worse every time pricing is tuned, and pricing
tuning is explicitly something the owner wants to do routinely. **Direction:** derive every pre-charge
quote from the same `buildCoinEconomyQuote` component composition used at authorize time, never from a
flat catalog row for an image-bearing action.

## 4. Spend lifecycle

**Authorize → reserve → finalize / release**, all in `lib/pricing/enforcement.ts` calling three SQL RPCs
(current versions in `040_fractional_action_costs.sql`, hardened for privileges in `098`):

- `pricing_authorize_spend` (`enforcement.ts:383-410`): idempotent on `(user_id, idempotency_key)` —
  a retry with the same key returns the existing reservation rather than double-reserving
  (`040_...sql:86-99`). Locks every spendable grant row and every pending-reservation row `FOR UPDATE`
  before computing `available_beats`, so two concurrent authorize calls for the same user genuinely
  serialize on Postgres row locks rather than racing in application code — this is real concurrency
  safety, not just an appearance of it. Inserts the reservation only if `available_beats ≥ requested`.
- `pricing_finalize_reservation` (`enforcement.ts:428-456`): re-locks the reservation, re-checks
  `expires_at` (raises if already past, marking it `expired` first), writes the `beat_usage_events` row,
  then walks grants in the same priority order **again** (not from a cached snapshot) deducting
  `beats_remaining`, raising if the total falls short (defends against a grant expiring in the gap
  between authorize and finalize). A trigger (`pricing_materialize_usage_components`,
  `082_coin_economy_gateway.sql:238-290`) copies the reservation's components into
  `beat_usage_event_components` on the same transaction, so component-level reporting (§ task item 4,
  "082") always matches the reservation that funded it.
- `pricing_release_reservation`: only transitions a still-`pending` reservation; anything already
  terminal returns `released:false` with the actual current status rather than erroring — safe to call
  from a `.catch()` cleanup path, which every caller does.
- **Stale-reservation expiry**: `pricing_expire_stale_reservations()` sweeps *every* user's overdue
  pending reservations (no `user_id` filter — `021_...sql:350-368`). **Nothing runs it on a schedule.**
  It's invoked opportunistically: once per signed-in user's pricing-runtime-context load
  (`app/actions/pricing-runtime.ts:71`), from an admin "sweep now" action
  (`app/actions/pricing-admin.ts:1005`), and from one more manual action
  (`app/actions/pricing-enforcement.ts:284`). Grepped every `app/api/**/route.ts` for it — **no cron/worker
  route calls it.** This is **not a correctness bug**: both `pricing_authorize_spend` and
  `computeWalletAvailability` (`lib/pricing/wallet.ts:79-88`) independently re-check `expires_at > now()`
  directly, so an unswept-but-expired reservation can never block a new authorize or inflate a displayed
  hold. It **is** a data-hygiene gap: reporting/analytics that groups by `status='pending'` can be
  inflated indefinitely if traffic is low, and abandoned reservations never reach a terminal status for
  audit purposes without a visit. Severity **LOW**. **Direction:** add it to the existing daily
  `/api/batch/reconcile` cron rather than relying on user traffic.

**Can a balance go negative?** No — enforced at the SQL layer, not just in application code.
`beat_grants` carries `CHECK (beats_remaining >= 0 AND beats_remaining <= beats_total)`
(`017_wallet_core.sql:11`), and `pricing_finalize_reservation` only ever deducts
`LEAST(grant.beats_remaining, remaining_needed)`, raising an exception rather than deducting past zero if
the sum falls short. `pricing_authorize_spend` denies (returns `insufficient_balance`, no row inserted)
rather than reserving past what's available. I did not find any code path that writes `beat_grants` or
`beat_usage_events` outside these RPCs and `admin_grant_user_coins`/`admin_execute_promotional_cohort`
(both grant-only, `CHECK (p_beat_amount > 0)` — **there is no admin "deduct/revoke coins" RPC anywhere**;
see R-4 below, this matters for refunds).

**What leaks when a job dies mid-way:** two layers, both self-healing, evidence in
`app/actions/beat-bundle.ts:164-206` and `lib/media/image-job-runner.ts:150-190`.
1. Synchronous failure inside `generateBeatCore` (text/composer gateway throws): the `catch` block
   releases the reservation before returning/rethrowing (`beat-bundle.ts:189-194`) — no orphaned hold.
2. Async image job failure/crash: `markJobFailed` releases the reservation
   (`image-job-runner.ts:174-183`, `settleReservation(..., 'release', ...)`) on terminal failure; a
   `reclaimStaleImageJobs` pass (`STALE_CLAIM_MINUTES = 5`, `image-job-runner.ts:34,60`) resets jobs stuck
   in `processing` back to `pending` so a crashed worker doesn't strand a job forever, and retries only
   settle the reservation once attempts are exhausted (`retryOrFail`, lines 191-203).
   **Worst case** (the worker itself is never re-invoked at all, e.g. the cron stops entirely): the
   reservation still self-heals via the *separate*, job-independent 30-minute reservation expiry
   (`pricing_reservation_timeout_seconds`, default 1800s — confirmed disabled/using-default in dev flags)
   plus the next opportunistic sweep (§ above) — bounded, but not instant, and never a permanent coin
   loss (no `beat_usage_events` row is ever written for a released/expired reservation). Severity **LOW**.

**Moderation timing gap.** `VERIFIED`, minor. The blocked/suspended check
(`getEffectiveUserModeration`) lives only in `lib/pricing/coin-economy.ts:100-110` — the wrapper every
real end-user path goes through — **not** inside `authorizeBillableAction` itself
(`lib/pricing/enforcement.ts`) or inside `pricing_finalize_reservation`. The one caller that goes around
the wrapper, `lib/agentic/story-assembly.ts:396`, is the autonomous-pipeline system account, not a
moderatable human account, so this isn't exploitable today. But nothing stops a future direct caller of
`authorizeBillableAction` from silently skipping moderation, and a user suspended in the ~30-minute window
between authorize and finalize still gets their action finalized (finalize never re-checks moderation).
Severity **LOW**. **Direction:** move the moderation gate into `enforcement.ts` itself so it can't be
forgotten by a new call site.

## 5. Lifecycle effects on entitlements

Derived from `lib/pricing/snapshot.ts:52-53, 104, 346-380` and `razorpay-sync.ts`:

- **Cancelled**: Razorpay reports `status='cancelled'` typically only once the paid period actually ends
  (`cancel_at_period_end` is tracked separately, `razorpay-sync.ts:77`). `cancelled` is in neither
  `ACTIVE_SUBSCRIPTION_STATUSES` nor `GRACE_PERIOD_SUBSCRIPTION_STATUSES`, so the moment it's reported the
  snapshot falls back to the free plan for tier/feature purposes. The final cycle's already-granted
  `beat_grants` row is untouched and stays spendable until its own `expires_at` — cancelling does not claw
  back that cycle's coins, it just stops the next one.
- **Payment failed / halted**: status `halted` is in `GRACE_PERIOD_SUBSCRIPTION_STATUSES`. While
  `grace_period_ends_at` (= `current_period_end + plan.grace_period_days`, 5 days in every live plan
  version) is still future, the user stays "entitled" for tier/feature gating — but
  `grantSubscriptionCycleIfMissing` only fires for `active`/`authenticated`, so **no new coins are issued**
  during a halted grace period; the user is coasting on whatever's left of the previous grant. After grace
  expires, falls back to free tier same as cancellation.
- **Paused**: `VERIFIED absence` — grepped every pricing/billing file for a `'paused'` status string:
  zero matches. If Razorpay ever reports a `paused` subscription state, it falls into neither the active
  set nor the grace set, so the user drops to free-tier entitlement immediately, with no distinct
  "your subscription is paused" handling anywhere in this layer. **Open question for the owner**: is
  `paused` a state Razorpay subscriptions can actually enter here, and if so, is immediate free-tier
  fallback the intended behavior?
- **Plan change**: `VERIFIED` self-service is entirely blocked today, on purpose. Any active/pending/
  halted/authenticated/created Razorpay subscription makes `prepareRazorpayCheckoutInternal` throw
  *"You already have a Razorpay subscription in progress. Subscription changes will stay manual until
  account management is live."* (`app/actions/pricing-checkout.ts:50-65`). No upgrade/downgrade/switch
  path exists in this codebase; it's a known, explicit gap (matches the owner's own framing of the item).
  This directly blocks the "manage subscription" UX goal stated in the brief until built.
- **Refund** (subscription or top-up): `VERIFIED absence` — grepped the webhook route and every billing
  file for `refund`: **zero matches, anywhere.** No webhook listener for a refund/dispute event, no
  automatic coin clawback, and (see §4) **no admin RPC exists to deduct or revoke coins from a wallet at
  all** — `admin_grant_user_coins` only grants (`CHECK (p_beat_amount > 0)`,
  `083_admin_user_management.sql:1097`). **R-4 — refunding a payment today has zero effect on the coins
  already granted for it, and there is no clean tool to fix that by hand.** Failure scenario: a customer
  disputes a charge or gets a manual refund via the Razorpay dashboard; the coins from that grant remain
  fully spendable indefinitely; the only way to remove them is a raw, unaudited DB `UPDATE` against
  `beat_grants.beats_remaining`, bypassing every audit-trail mechanism this system otherwise has
  (`admin_user_audit_events`). Severity **BLOCKER** for taking real money — this is exactly the kind of
  gap that turns a single chargeback into free coins.
- **Account suspended/blocked (moderation)**: `getEffectiveUserModeration` denies new authorizations with
  `reason: 'account_restricted'` (`coin-economy.ts:100-109`) — blocks *new spend*, does not touch existing
  grants or subscription status. A suspended user's subscription keeps renewing/billing unless separately
  cancelled — worth a cross-check with stream 4/1 on whether moderation ever triggers a Razorpay
  cancellation (I found no such link in this stream's files).
- **Account deletion**: `VERIFIED`, significant. Every financial table cascades on `auth.users` deletion:
  `beat_grants`, `beat_usage_events`, `beat_spend_reservations` all declare `ON DELETE CASCADE` on
  `user_id` (`017_wallet_core.sql:6,19,32`), as do `billing_customers`, `billing_subscriptions`,
  `billing_orders` (`016_billing_core.sql:6,20,41`). Deleting an `auth.users` row **permanently destroys
  that user's entire billing and usage history** — no coins, no grants, no usage events, no billing
  orders survive. `billing_webhook_events.related_user_id` is the one exception (`ON DELETE SET NULL`),
  so the raw webhook payload survives but loses its user link. **R-5**: this is very likely a compliance
  problem (India GST/invoice retention typically requires years of retention regardless of account
  deletion) — flagging the data-model fact here; the compliance judgment belongs to stream 7. Severity
  **HIGH**, cross-stream.

## 6. Flags and bypasses

All fifteen `pricing_*` runtime flags are defined in one place
(`PRICING_RUNTIME_SETTING_DEFINITIONS`, `lib/types/pricing.ts:142-293`) with an explicit
`defaultEnabled`/`defaultValue`, and every reader (`buildPricingRuntimeControls`, `snapshot.ts:55-77`)
throws if a flag key it needs isn't in that definition table — but falls back to the coded default
(never throws to the user) if the flag's *row* is simply missing from the DB
(`getBooleanControl`/`getIntegerControl`/`getProviderControl`, `snapshot.ts:391-438`). Every flag except
`pricing_india_only_beta_enabled` defaults `enabled: false` — i.e. **missing migration ⇒ pricing
enforcement, checkout, and the admin tab are all off**, matching the "fail closed" doctrine in CLAUDE.md.
`pricing_india_only_beta_enabled` defaults **true**, so an un-migrated/flag-absent environment fails
closed toward *India-only*, not toward *open globally* — also fail-closed, just the other direction, and
worth knowing when reasoning about a fresh environment.

**Live dev flag state** (queried, 2026-09-17): `pricing_hard_enforcement_enabled = true`,
`pricing_shadow_metering_enabled = true`, `pricing_checkout_enabled = true`,
`pricing_admin_bypass_enabled = true`, `pricing_snapshot_enabled = true`,
`pricing_india_only_beta_enabled = true`, `pricing_routing_provider_in = razorpay` (enabled),
`pricing_routing_provider_row` (disabled → falls back to coded default `stripe`).
**Dev is running with real enforcement on** — this matters for streams 3/4's "dev vs prod" comparison.

| Flag | Effect when OFF/absent |
|---|---|
| `pricing_admin_tab_enabled` | Admin pricing workspace hidden |
| `pricing_snapshot_enabled` | App treats pricing as "not live," uses hardcoded safe defaults |
| `pricing_checkout_enabled` | Checkout buttons show "coming soon"; denial reason becomes `checkout_unavailable` instead of `insufficient_balance` when the wallet is also short |
| `pricing_shadow_metering_enabled` | No shadow-mode usage logging |
| `pricing_hard_enforcement_enabled` | **No one is ever blocked for coin reasons** — every authorize call returns `allowed` in `soft` or `shadow` mode, no reservation created, no coins ever actually deducted (`enforcement.ts:342-369`) |
| `pricing_admin_bypass_enabled` | The configured `ADMIN_USER_ID` gets no special bypass |
| `pricing_story_length_ui_limits_enabled` | Everyone sees the same story-length choices regardless of plan |
| `pricing_default_grace_period_days` / `pricing_default_carry_forward_cap_multiplier` / `pricing_reservation_timeout_seconds` / `pricing_migration_grant_beats` / `pricing_tester_studio_duration_days` | Numeric knobs; each falls back to a coded default value when the flag row is off, not to zero |
| `pricing_routing_provider_in` / `_row` | Falls back to coded default provider (`razorpay` / `stripe`) |
| `pricing_india_only_beta_enabled` | **Defaults ON** — checkout restricted to India regardless of routing provider config, until explicitly turned off |

**Agentic billing bypass** (`agentic_billing_bypass_enabled`, `lib/agentic/flags.ts:22-63`): fails closed
via `getFeatureFlags(..., false)` — an unapplied migration 102 or any Supabase read error means the flag
reads `false`, bypass unreachable. Reachability requires **three** independent things to align
(`enforcement.ts:284-315`): `actorKind === 'agentic_system'` (server-derived, see below —
never client-supplied), the flag enabled, **and** `input.userId === process.env.AGENTIC_SYSTEM_USER_ID`
exactly. `actorKind` itself is resolved server-side from whether the *story* has an `agentPersonaId`
(`lib/agentic/billing-identity.shared.ts:44-56`), never taken as a raw parameter from a caller — so even
a bug that mislabeled a request's `actorKind` could only ever matter for the one specific system account,
not for an arbitrary user. This is solid, deliberately-tested design (the file's own header cites a real
historical defect it was built to prevent, commit `57b516b`). A bypassed spend still writes a
`beat_spend_reservations` row with `status: 'finalized'` and `agenticBypass: true` in metadata purely for
reporting — no balance moves (`enforcement.ts:834-889`).

## 7. Free users

A signed-up-but-never-paying user gets: **50 coins once** (`operational_policies.free_welcome_grant`,
live dev config: `{grantMode: 'once_per_account', coinAmount: 50, expiresAfterDays: null}` — never
expires), the `free` plan's feature set (story-length cap 4, downloads allowed but **watermarked** —
`canAccessUnbrandedExports: false`, no `creatorControls`), and access to every action whose
`free_enabled = true` in `pricing_action_costs` — which is nearly everything except `image_generation`
itself (`free_enabled: false`, `082_coin_economy_gateway.sql:100`) and `export_video_hd`
(`free_enabled: false`). So a free user can generate story text, narration, alignment, and SD video
export, but **cannot generate a storyboard image at all** without coins (the tier gate denies before any
image-model cost is even quoted, `lib/pricing/image-aware-authorize.ts:79-97`) — they're spending their
50-coin welcome grant on images specifically, or nothing.

The welcome grant is **idempotent under concurrency** — `apply_free_welcome_grant` takes a
`pg_advisory_xact_lock` keyed on the user id before checking for an existing grant
(`084_...sql:230-231`), specifically to stop the signup trigger and the runtime fallback call
(`enforcement.ts:258-280`) from racing into two grants for one account. The signup trigger swallows any
error (`EXCEPTION WHEN OTHERS THEN ... RAISE WARNING`, `084_...sql:320-324`) so a policy/DB problem never
blocks account creation — the runtime fallback exists precisely to catch that case retroactively.

## 8. Money-integrity risks for going live — consolidated

Severity-ordered; several are cross-referenced above with full evidence.

| ID | Severity | Status | Finding |
|---|---|---|---|
| R-4 | **BLOCKER** | VERIFIED | No refund handling anywhere (webhook or admin) and no admin RPC to deduct/revoke coins — a refunded payment leaves its coins fully spendable forever, with no clean way to fix it by hand. §5 |
| R-5 | HIGH | VERIFIED | Account deletion `CASCADE`s away all billing/usage history (grants, usage events, subscriptions, orders) — likely conflicts with financial record-retention obligations. Cross-stream with 3/7. §5 |
| R-3 | HIGH | VERIFIED | Pre-charge "sticker price" for continuing a story (and likely starting one) is computed from a different, unsynced code path than the actual charge — drifts silently the next time an admin edits an image model's coin cost. §3 |
| R-1 | HIGH | INFERRED | Subscription coin grants fire on Razorpay status `authenticated`, not only `active` — needs confirming against Razorpay's actual payment-capture semantics for the configured payment methods; if `authenticated` can precede a captured charge for any flow in use, coins are granted before money is captured. Cross-stream with #1 (checkout/capture). §2 |
| R-2 | MEDIUM | VERIFIED | India top-up price-per-coin (₹3.5–3.75) is ~3–7× the ROW top-up price-per-coin in USD-equivalent terms — pricing is inverted relative to typical India-discount SaaS pricing; may be intentional but reads as unreviewed. §3 |
| G-1 | MEDIUM | VERIFIED | `carry_forward` and `migration_grant` source types, their DB columns, and their runtime flags exist end-to-end but no code path ever creates such a grant — a silently unimplemented rollover feature. §2 |
| — | MEDIUM | VERIFIED | Studio plan's `story_length_cap` is 12 (IN) vs 8 (ROW) for the same tier/rank — likely unreviewed data inconsistency, not a code bug. §1 |
| — | LOW | VERIFIED | `pricing_expire_stale_reservations()` has no dedicated cron — runs opportunistically off user traffic and manual admin action only. Not a correctness bug (expiry is re-checked directly everywhere it matters) but a reporting-hygiene gap. §4 |
| — | LOW | VERIFIED | Moderation check lives only in the `coin-economy.ts` wrapper, not in `enforcement.ts` itself or in finalize — currently safe because every human-facing path goes through the wrapper, but easy to bypass by accident in a future direct caller. §4 |
| — | LOW | VERIFIED | `'paused'` Razorpay subscription status has no distinct handling — falls through to immediate free-tier entitlement same as cancellation, with no "your subscription is paused" messaging path. §5 |

No evidence found of: double-granting under concurrency (SQL row-locking is real, not just app-level),
balance going negative (enforced by CHECK constraints + RPC arithmetic, not just application logic), or
grants attributable to the wrong user (every grant insert I traced keys off a server-resolved `user_id`,
never a client-supplied one).

## Open questions for the owner

1. Is `authenticated` (a Razorpay subscription status) guaranteed to mean "first payment captured" for
   every payment method Kissago will actually offer, or can it precede capture for some (e.g. UPI
   Autopay/e-mandate registration)? This determines whether R-1 is real. (Cross-check with stream 1.)
2. Is the India vs. ROW top-up price-per-coin gap (R-2) intentional?
3. Is `carry_forward` (unused coins rolling into next cycle) something you actually want, or should the
   schema/flags for it just be removed? (G-1)
4. Should Studio's story-length cap really differ between IN (12) and ROW (8)?
5. What should happen to a `paused` Razorpay subscription's entitlement, if that state is reachable at
   all in your configured plans?
6. Confirm intended refund policy (full coin clawback? none? case-by-case?) so R-4's fix can be scoped —
   right now there's neither an automated nor a clean manual path.
