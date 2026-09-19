# Phase 3 — plans, entitlements, consumption

Written 2026-09-18 (Opus). Authoritative scope:
`prompt-packs/kissago-payment-billing-prompt-pack-2026-09-17/05_PHASE_3_PLANS_ENTITLEMENTS_CONSUMPTION.md`.

Inputs this plan is built on, and does not restate:
- `phase-3-hardcoding-audit.md` — all 47 plan-key references classified, the two schema CHECKs, the watch path.
- `audit-progress.md` — owner decisions 11-14 (2026-09-18) and Phase 0 decisions 1-4, 7.

**Read the audit's two "Corrected 2026-09-18" notes before executing.** Both corrections change where code
goes, and both were wrong in the first draft of that document.

---

## 1. What the decisions removed

Phase 3 looked bigger than Phase 2. After decisions 11-14 it is smaller:

| Was in scope | Status |
|---|---|
| Per-user timezone capture, storage, anti-gaming rule | **Gone** — decision 11, IST for everyone |
| `pricing_action_costs` migration + two settings-object migrations | **Gone** — decision 12, Audience inherits Free |
| Annual billing, mandate lifecycle, interval upgrade/downgrade | **Gone** — decision 13, its own unit later |
| Quota ledger design | **Settled** — decision 14, new table, unique index |

What remains: the tier, the quota, and a capability tidy-up.

## 2. Verified current-state facts

Everything here was checked in the code or queried on the dev database on 2026-09-18. Anything not listed
is unverified.

**The entitlement mechanism already exists and is live.**
`pricing_plans.feature_flags_json` → `normalizePricingPlanFeatureFlags` (`app/actions/pricing-admin.ts:1055-1057`)
→ `lib/pricing/snapshot.ts:173-176` and `app/actions/pricing-runtime.ts:391-394` → client via
`components/pricing/PricingRuntimeProvider.tsx`. Admin toggles at `components/admin/PricingStudio.tsx:1271-1273`.
Four capabilities ride it today, it fails closed (`?? false`), and dev shows `canAccessDownloads: true` on
Free — so it is already decoupled from tier in practice. **`extensions_json` is written and never read; it is
not the home.**

**The plan catalogue.** Dev `pricing_plans` holds exactly three rows: free/plus/studio at `tier_rank` 1/2/3,
all active and public. `pricing_plans.plan_key` has **no CHECK constraint**, so the Audience row is catalogue
data created through the pricing studio — no migration for the row itself.

**Two schema CHECKs do hardcode the triple** (audit §F): `user_entitlement_overrides_entitlement_plan_key_check`
and `reel_visual_styles_min_plan_check`. The first blocks admin promotion to Audience entirely.

**The tier rank is safe, under a constraint.** `PLAN_TIER_RANK` (`lib/pricing/entitlement-tier.shared.ts:16-20`)
is a total order consumed by `resolveEffectiveEntitlementTier`'s promote-only rule. `free < audience < plus <
studio` is correct at every pair because Plus is a superset of Audience. It stays correct only while no
capability belongs to Audience that Plus lacks — see audit §D.

**Adding `'audience'` fails closed.** Every capability gate ends in a Free-shaped fallback, verified at
`lib/media/retention.ts:14-22,37-40`, `lib/reel/settings.ts:278-281`,
`lib/pricing/coin-economy.shared.ts:154-157`, `app/actions/pricing-runtime.ts:547-556`. One exception, which
fails **open**: `lib/ai/image-models.ts:48` filters with a hardcoded triple and `:49` falls back to *all
plans*.

**The watch choke point.** `loadStorylineWithBeats` (`app/actions/exploration.ts:440`), a server action,
authenticated at `:462-463`, with exactly one caller: `components/story/StorylinePersistenceLoader.tsx:55`.
The network call always fires (`:55`, unconditional), but a cached payload can paint first (`:57-73`).
`/explore/[id]` is the authoring surface, not a watch surface.

**Runtime settings are the home for the quota number.** `PRICING_RUNTIME_FLAG_KEYS` (`lib/types/pricing.ts:148-164`),
`PRICING_RUNTIME_SETTING_DEFINITIONS` (`:184`), resolved in `lib/pricing/snapshot.ts:61-76` via
`getIntegerControl`, typed on `PricingRuntimeControls` (`lib/types/pricing.ts:377-393`), client fallbacks at
`components/pricing/PricingRuntimeProvider.tsx:85-90`. Integer settings already exist —
`pricing_reservation_timeout_seconds` (`lib/types/pricing.ts:276-284`) is the template. This is a different
mechanism from `feature_flags`/`getFeatureFlag`, and `lib/admin/operational-flags.shared.ts:1-18` explains
why they are not interchangeable.

**Existing server-side helpers to reuse, not rebuild:** `resolveEntitlementPlanKeyForUser`
(`lib/pricing/enforcement.ts:602`), `isAdminUserId` (`:642`), `invalidatePricingRuntimeCacheForUser`.
`apply_free_welcome_grant` (migration 084, called at `lib/pricing/enforcement.ts:193`) already owns Free's
50 trial coins and their 30-day expiry — Audience must not disturb it.

**IST handling exists.** `lib/billing/financial-year.shared.ts:14` — `IST_OFFSET_MINUTES = 5*60+30`, applied
by shifting epoch ms and reading UTC parts. IST has no DST, so a fixed offset is correct. Reuse the
technique, not the function.

## 3. Unit split

| Unit | What | Depends on |
|---|---|---|
| A | `'audience'` as a plan key; the capability tidy-up; migration 129's CHECK widening | — |
| B | The quota ledger, the RPC, server enforcement, the loader's refusal path | — |
| C | `unlimitedWatching` capability; the Audience catalogue row; wallet offer | A |
| D | Quota UX — "N of 3 left today", the last-slot confirm, the upsell | B, C |
| E | Admin: the quota runtime setting and its panel wiring | B |

A and B are independent and may run in parallel. **One agent at a time in long sessions** (owner's standing
rule), so sequence A → B → C → E → D unless the window is comfortable.

---

## 4. Unit A — Audience as a plan key

No behaviour change for existing tiers. After this unit an Audience account behaves exactly as Free
everywhere, which is decision 12's intent.

**A1. `lib/types/pricing.ts:20`** — `export const PLAN_KEYS = ['free', 'audience', 'plus', 'studio'] as const;`
Order is display order in admin lists; between free and plus is right.

**A2. `lib/pricing/entitlement-tier.shared.ts:16-20`** — add `audience: 1`, renumber `plus: 2`, `studio: 3`.
tsc forces this edit (`Record<PlanKey, number>`). Extend the file's header comment with the constraint from
audit §D: the scale is valid only while Plus remains a superset of Audience.

**A3. `components/admin/PricingStudio.tsx:582-585`** — add `audience: { beats: 0, cap: 4, tier: 2 }` and
renumber plus/studio to 3/4. tsc forces this too (`Record<PlanKey, …>`), and without it `:586` would index
`undefined` and `:590` would throw.

**A4. `components/admin/PricingStudio.tsx:589`** — replace the nested name ternary with a lookup keyed by
plan. A fourth arm in a ternary chain is how this gets wrong on the fifth tier.

**A5. `lib/reel/narration.ts:13`** — `export type NarrationVoiceTier = PlanKey;` (import from
`@/lib/types/pricing`). This is the parallel union tsc will never connect on its own; leaving it is how the
divergence becomes permanent.

**A6. `lib/reel/narration.ts:669`** — `normalizeVoiceTier` uses `isPlanKey`
(`lib/pricing/entitlement-tier.shared.ts:21`) instead of the hardcoded triple.

**A7. `lib/reel/styles.ts:253`** — same treatment; keep the `'free'` fallback.

**A8. `lib/ai/image-models.ts:48`** — replace the inline triple with `isPlanKey`. **This is the fails-open
one**: today an `'audience'` entry stored by an admin is dropped and `:49` falls back to every plan.

**A9. `lib/admin/user-management.shared.ts:116,277-278,291,346`** — add `'audience'` to
`AdminCohortPlanFilter` (`:116`), to `ENTITLEMENT_TIER_OPTIONS` (`:277-278`), to the cohort filter tuple
(`:346`), and fix the validator's error text at `:291`, which names "free, plus, or studio".

**This is owner requirement 16 (2026-09-18): an admin must be able to promote a user to any tier from the
backend without hassle.** It is not one edit but a path, and every link must widen or the promotion fails at
a different layer:

| Link | Where | Covered by |
|---|---|---|
| The dropdown's options | `ENTITLEMENT_TIER_OPTIONS`, `lib/admin/user-management.shared.ts:277-278` | A9 |
| Input validation | `normalizeEntitlementTierInput:285-300`, via `isPlanKey` | A1 (automatic) |
| The database write | `app/actions/admin-users.ts:313-321` upsert | **migration 129** — without the widened CHECK this raises `23514` |
| The promotion taking effect | `PLAN_TIER_RANK` | A2 |
| The UI itself | `components/admin/users/AdminUserDirectory.tsx:268` | nothing — it renders the shared options constant |

Note the existing semantics, which are correct and must not be "fixed": setting a user to `'free'` **clears**
the promotion rather than pinning them to Free (`app/actions/admin-users.ts:303-310`), and the promote-only
rule means an override never lowers a paying account. An admin can therefore grant any tier's access to
anyone; the only thing refused is taking away what someone paid for. That is the feature, not the hassle.

**A10. `components/admin/users/AdminPromotionalCohorts.tsx:34-35`** — add the Audience option.

**A11. `components/admin/ImageModelRegistryStudio.tsx:52`** — delete the local
`const PLAN_KEYS: PlanKey[] = [...]` and import the real one. A second copy of the list is the bug this unit
exists to stop repeating.

**A12. Migration 129** — the two CHECKs (SQL in §7).

Deliberately **not** touched, per decision 12: `pricing_action_costs`' three columns,
`MediaPipelineSettings`' per-plan keys, `ReelStorySettings.retentionDays`. Audience takes the Free branch in
all three, which is the intended behaviour.

**Verification.** `npx tsc --noEmit` must be clean — and note that tsc catches only A2/A3; everything else is
silent, so each edit needs its own eye. Add a unit test asserting `PLAN_KEYS` contains `'audience'` and that
`resolveEffectiveEntitlementTier` promotes free→audience, promotes audience→plus, and refuses to pull
plus→audience.

## 5. Unit B — the quota ledger and enforcement

**B0. The `unlimitedWatching` capability.** Built here rather than in Unit C, because B is its consumer and
a capability that arrives after its reader is worse than useless: B3's check would find the field absent,
fail closed, and **quota Plus and Studio accounts too**. Add it alongside the four existing capabilities —
`app/actions/pricing-admin.ts:1055-1057` (normalizer), `lib/pricing/snapshot.ts:173-176`,
`app/actions/pricing-runtime.ts:391-394`, `EffectivePricingSnapshot` (`lib/types/pricing.ts:419-422`), the
admin toggle (`components/admin/PricingStudio.tsx:1271-1273`), and the client fallback in
`PricingRuntimeProvider.tsx`.

**It must default `true`, not `false` — the one capability in this codebase that does.** Every other one
defaults false because absence should mean "no access". Here absence means "no quota row configured yet",
and defaulting false would switch a daily limit on for every paying account the moment this ships, before
any admin has set anything. The quota is a restriction being added, so its default must be the unrestricted
state. Say so in a comment at the normalizer, or someone will "fix" it to match its neighbours.

Unit C then flips it off for Free alone.

**B1. Migration 129** — `user_daily_watch_slots` plus `consume_watch_slot` (SQL in §7). **Already written
and committed** (`e5c0b3d`, race fix in `40ff401`); not applied on any environment.

**B2. `lib/pricing/watch-quota.shared.ts`** (new, pure/isomorphic). One export:
`istLocalDay(date: Date): string` returning `YYYY-MM-DD` in IST, by the `financial-year.shared.ts:24-27`
technique. Both the server enforcement and the client "left today" display must agree on the day, which is
exactly why this is `.shared`. Unit-test the boundary: `2026-09-18T18:29:59Z` is still 2026-09-18 IST;
`18:30:00Z` is 2026-09-19.

**B3. `lib/pricing/watch-quota.ts`** (new, `import 'server-only'`).
`consumeWatchSlot({ userId, storylineId }): Promise<WatchSlotResult>` where the result carries
`{ allowed, used, limit, isReplay, unlimited }`.

Order of checks, cheapest and most permissive first:
1. `isAdminUserId(userId)` → `{ allowed: true, unlimited: true }`, no ledger write (Phase 0 decision 7).
2. Plan capability `unlimitedWatching` (Unit C) → same. **Read the capability, never the rank** (audit §D).
3. Otherwise call `consume_watch_slot` with the limit from `controls.freeDailyWatchQuota`.

**An absent migration must not block watching.** (This heading previously read "Fail closed on absence, not
open", which contradicted the paragraph under it and the executing agent had to guess. It meant what the
paragraph says.) If migration 129 has not run, the RPC is missing and the call throws.
Catch that specific case and **allow the watch**, logging once — this is the one place where failing open is
right, because a missing migration must never make the product unusable for everyone (`WORKING_AGREEMENTS.md`,
and the `069_narration_accent.sql` outage that motivated the rule). Structurally probe, exactly as
`provider_price_ref_gross_minor` does at `lib/types/database.ts:631-635`.

**B4. `app/actions/exploration.ts`, inside `loadStorylineWithBeats`** — after the auth guard at `:462-463`
and before the storyline fetch at `:469`. On refusal **return** `{ status: 'watch_quota_exhausted' }`; the
action's return type is the discriminated `LoadStorylineWithBeatsResult` (`lib/types/story.ts`), and its
success arm carries `status: 'ok'`. Genuine failures — not authenticated, storyline not found, a network
fault — keep throwing, and must: the loader's cached-copy fallback is right for those and wrong for a
refusal, which is exactly why the two cannot share a channel.

Place it **after** auth so signed-out callers still get `Not authenticated`, and **before** the fetch so a
refused watch costs one indexed query rather than the whole payload.

> **DEFECT, FOUND AND FIXED (2026-09-19).** Unit B first shipped the refusal as a *thrown* `Error` whose
> `message` the loader matched by exact equality. `GOTCHAS.md:484-486` says plainly: *"Next.js recommends
> returning expected errors from server functions; don't rely on a thrown action's message reaching the
> browser in production."* Production builds redact server-action error messages to a generic string plus a
> digest, so the match succeeded only on a local dev server and failed everywhere deployed — **the Vercel
> preview included**, which is a production build.
>
> What made it dangerous is that it failed *silently*. With the match missed, control fell to the generic
> `catch`, which sets an error only when nothing is on screen. **A reader holding a cached copy was
> therefore shown the story the server had just refused** — the beats came from the cache, not from the
> refused call, so the refusal was real and invisible.
>
> Nothing was ever live: migration 129 is unapplied everywhere, so the missing-RPC latch allowed every watch
> and the quota was entirely inert. No environment was ever bypassable.
>
> **The fix** is the pattern GOTCHAS names: `loadStorylineWithBeats` now **returns** the refusal as data (B4
> above), and the loader switches on it inside the `try` rather than pattern-matching a caught error. One
> caller, so the change stayed contained. `WATCH_QUOTA_EXHAUSTED_MARKER` is deleted along with its test — a
> marker that cannot cross the boundary is worse than none, because it reads as though it handles the case.
> `app/actions/exploration.test.ts` pins the channel: the refusal must *resolve*, and "not authenticated"
> and "storyline not found" must still *reject*. That last pair is the guard — the day someone tidies this
> back into a throw, it is what fails.

**B5. `components/story/StorylinePersistenceLoader.tsx`** — the refusal path, and the subtle half of this
unit. The catch keeps a displayed cached payload and only sets an error when nothing was shown. For a quota
refusal that is wrong: the cache may already have painted the story (`:57-73`). On
`status === 'watch_quota_exhausted'` the loader must **clear `payload`** and render the upsell, whether or
not the cache won the race — and set `hasDisplayedPayload = true` on the way, which is what stops a cache
read still in flight from painting the story *after* the refusal. Everything else in the catch keeps its
current behaviour — a network failure with a cached copy must still show the cached copy.

**B6. `recordView` is not touched.** It stays the fire-and-forget analytics it is
(`components/story/StorylinePlayer.tsx:415-419`).

**Verification.** Unit-test `istLocalDay` boundaries and `consumeWatchSlot`'s branch order with the RPC
mocked. On dev, after applying 129: watch three distinct stories on a Free account and confirm the fourth is
refused; re-watch one of the three and confirm it is still allowed and writes no new row; confirm an admin
account is never refused. The two-device race is the RPC's job — assert it with two concurrent calls for
*different* storylines at limit-minus-one and confirm exactly one wins.

## 6. Units C, D, E

**C — the Audience tier.**
- The `unlimitedWatching` capability is built in **Unit B**, not here — see B0. C only sets it, true on
  audience/plus/studio and false on free, through the pricing studio.
- The Audience plan row and its published monthly version are created in the studio. **Monthly only**
  (decision 13). Prices are catalogue data and the owner can change them after launch, which is why they do
  not gate this unit.
- **`tier_rank` must be renumbered when the Audience row is created — this is a required step, not a tidy-up.**
  Found reviewing Unit A. `pricing_plans.tier_rank` has **no unique constraint** (only `> 0`), and dev holds
  free=1, plus=2, studio=3. Unit A's new-plan default gives Audience rank 2, which collides with the live
  Plus row, and nothing rejects it. The consequence is not cosmetic:
  `components/pricing/WalletPage.tsx:180` computes `isUpgrade = offer.tierRank > currentTierRank`, so at
  equal ranks **Plus would stop presenting as an upgrade from Audience** — the exact conversion path the
  tier exists to feed. When creating Audience, set it to 2 and move the existing Plus row to 3 and Studio to
  4, in the studio's Tier Rank field (`components/admin/PricingStudio.tsx:1240`). Verify afterwards with
  `select plan_key, tier_rank from public.pricing_plans order by tier_rank` — four rows, four distinct ranks.
- `components/pricing/WalletPage.tsx:96,123` currently special-cases the Plus offer for copy; Audience needs
  its own arm.

**D — the quota UX.** "N of 3 left today" (Phase 0 decision 2), confirm only before the last slot, replays
never warn (decision 3). Read the count from the snapshot; do not re-query per render. The refusal surface
from B5 is the upsell: it is the one moment a Free watcher is most likely to convert, and it should offer
Audience, not Plus.

**E — admin.** New integer runtime setting `pricing_free_daily_watch_quota`, default `'3'`:
add to `PRICING_RUNTIME_FLAG_KEYS` (`lib/types/pricing.ts:148-164`), a definition alongside
`pricing_reservation_timeout_seconds` (`:276-284`), `freeDailyWatchQuota` on `PricingRuntimeControls`
(`:377-393`), resolution via `getIntegerControl` in `lib/pricing/snapshot.ts:61-76`, and a client fallback in
`PricingRuntimeProvider.tsx:85-90`. It is a pricing runtime setting, **not** a `feature_flags` row — see
`lib/admin/operational-flags.shared.ts:1-18` for why that distinction is load-bearing.

---

## 7. Migration 129 — complete SQL

`supabase/migrations/129_watch_quota_and_audience_tier.sql`:

```sql
-- 129_watch_quota_and_audience_tier.sql
--
-- Payments Phase 3. Two things the Audience tier and the Free daily watch quota cannot ship without.
--
-- The CHECKs: both hardcode free/plus/studio, so without widening them an admin cannot promote anyone
-- to Audience at all (23514), and no reel style can be gated to it. pricing_plans.plan_key has no
-- CHECK, so the Audience row itself is catalogue data and is not created here.
--
-- The quota: unique (user_id, local_day, storyline_id) is what makes "replays are free all day" a
-- constraint rather than application logic, and what makes two devices at the last slot safe. local_day
-- is an IST calendar day supplied by the caller (owner decision 11) -- deliberately not computed from
-- now() here, so the server's timezone can never silently redefine a user's day.
--
-- Trap: do not reuse storyline_views. It is UNIQUE(user_id, storyline_id) for a LIFETIME view, so a
-- replay on a later day writes no row and it can never count a day.
--
-- Verify: select count(*) from public.user_daily_watch_slots;  -- 0, and the table exists
--   select public.consume_watch_slot('<uuid>'::uuid, current_date, '<storyline uuid>'::uuid, 3);

ALTER TABLE public.user_entitlement_overrides
  DROP CONSTRAINT IF EXISTS user_entitlement_overrides_entitlement_plan_key_check;
ALTER TABLE public.user_entitlement_overrides
  ADD CONSTRAINT user_entitlement_overrides_entitlement_plan_key_check
  CHECK (entitlement_plan_key IN ('free', 'audience', 'plus', 'studio'));

ALTER TABLE public.reel_visual_styles
  DROP CONSTRAINT IF EXISTS reel_visual_styles_min_plan_check;
ALTER TABLE public.reel_visual_styles
  ADD CONSTRAINT reel_visual_styles_min_plan_check
  CHECK (min_plan IN ('free', 'audience', 'plus', 'studio'));

CREATE TABLE IF NOT EXISTS public.user_daily_watch_slots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_day date NOT NULL,
  storyline_id uuid NOT NULL REFERENCES public.storylines(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_daily_watch_slots_unique UNIQUE (user_id, local_day, storyline_id)
);

CREATE INDEX IF NOT EXISTS user_daily_watch_slots_user_day_idx
  ON public.user_daily_watch_slots (user_id, local_day);

ALTER TABLE public.user_daily_watch_slots ENABLE ROW LEVEL SECURITY;

-- Service-role only, like every Phase 2 billing table: the quota is decided on the server and a client
-- that could read its own rows could also count them, which is not the same as being allowed to spend one.

CREATE OR REPLACE FUNCTION public.consume_watch_slot(
  p_user_id uuid,
  p_local_day date,
  p_storyline_id uuid,
  p_limit integer
)
RETURNS TABLE (allowed boolean, used integer, is_replay boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted uuid;
  v_used integer;
BEGIN
  -- Serialise this user's day. The unique index alone is NOT enough: it stops the same storyline
  -- being counted twice, but two devices opening DIFFERENT storylines are two different rows, and
  -- under READ COMMITTED each transaction's count sees only committed rows -- so both would insert,
  -- both would count themselves as the last slot, and both would be allowed. The lock is per
  -- (user, day) and released at transaction end, so it costs nothing across users.
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text), hashtext(p_local_day::text));

  INSERT INTO public.user_daily_watch_slots (user_id, local_day, storyline_id)
  VALUES (p_user_id, p_local_day, p_storyline_id)
  ON CONFLICT (user_id, local_day, storyline_id) DO NOTHING
  RETURNING id INTO v_inserted;

  SELECT count(*)::integer INTO v_used
  FROM public.user_daily_watch_slots
  WHERE user_id = p_user_id AND local_day = p_local_day;

  -- Already watched today: free, and never counted twice (owner decision 3).
  IF v_inserted IS NULL THEN
    RETURN QUERY SELECT true, v_used, true;
    RETURN;
  END IF;

  -- The slot was taken above, so the count already includes it. Over the limit means this watch is the
  -- one that went too far: give the slot back and refuse. Two devices racing for the last slot both
  -- insert, both count, and exactly one sees a count within the limit.
  IF v_used > p_limit THEN
    DELETE FROM public.user_daily_watch_slots WHERE id = v_inserted;
    RETURN QUERY SELECT false, v_used - 1, false;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_used, false;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_watch_slot(uuid, date, uuid, integer) FROM public, anon, authenticated;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (129, '129_watch_quota_and_audience_tier.sql')
ON CONFLICT (migration_number) DO NOTHING;
```

`supabase/migrations/129_watch_quota_and_audience_tier_rollback.sql`:

```sql
-- Rollback for 129_watch_quota_and_audience_tier.sql
--
-- Narrowing the CHECKs fails if any row already carries 'audience'. That is deliberate: reassign those
-- accounts and styles first, as a decision, rather than having a rollback silently strand them.

DROP FUNCTION IF EXISTS public.consume_watch_slot(uuid, date, uuid, integer);
DROP TABLE IF EXISTS public.user_daily_watch_slots;

ALTER TABLE public.reel_visual_styles
  DROP CONSTRAINT IF EXISTS reel_visual_styles_min_plan_check;
ALTER TABLE public.reel_visual_styles
  ADD CONSTRAINT reel_visual_styles_min_plan_check
  CHECK (min_plan IN ('free', 'plus', 'studio'));

ALTER TABLE public.user_entitlement_overrides
  DROP CONSTRAINT IF EXISTS user_entitlement_overrides_entitlement_plan_key_check;
ALTER TABLE public.user_entitlement_overrides
  ADD CONSTRAINT user_entitlement_overrides_entitlement_plan_key_check
  CHECK (entitlement_plan_key IN ('free', 'plus', 'studio'));

DELETE FROM public.schema_migration_ledger WHERE migration_number = 129;
```

**Account deletion.** `user_daily_watch_slots` cascades from `auth.users` — correct, and the opposite of the
billing tables' SET NULL. A watch slot is not a financial record and has no retention obligation. Add it to
`lib/account/deletion-tables.ts` alongside `storyline_progress` (`:54`) so the deletion flow's own accounting
stays complete.

## 8. Verification gate

Per `WORKING_AGREEMENTS.md`, before any unit is called done:

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build:verify
npm run test:e2e
```

Plus, per unit, the checks in §4-§5. Migration 129 is applied **by the owner, by hand, on dev only** — prod
stays untouched until the whole feature is built and tested (owner, 2026-09-17). Confirm with
`select * from public.schema_migration_ledger where migration_number = 129` on each environment; the ledger
is the source of truth over this document.

## 9. Kill switch

The quota has no flag of its own by design: `pricing_free_daily_watch_quota` is an integer runtime setting,
so setting it absurdly high disables enforcement within the runtime cache's life, and B3's missing-RPC path
means an unapplied migration allows every watch. Those are the two ways it comes off, and neither needs a
deploy.

## 10. Still open

- **Audience launch prices.** Owner-set catalogue data; does not gate any unit. Audit finding 11 (dev Plus
  ₹850 vs prod ₹1,450) is still unreconciled and should be settled when the Audience row is created.
- **Annual billing** (decision 13) — its own unit, after a Razorpay sandbox walk.
- **Phase 1 §6 steps 4-9** remain owner-pending and are unaffected by this phase.
