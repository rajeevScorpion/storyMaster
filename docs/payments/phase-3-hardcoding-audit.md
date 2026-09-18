# Phase 3 — the plan-key hardcoding audit

Written 2026-09-18 (Opus), the session after `phase-3-brief.md`. This is step 1 of that brief's §4: the
audit the pack asks for before the entitlement model is designed. **It is an audit, not a plan** — it
records what the 47 references are and what happens to each when `'audience'` joins `PLAN_KEYS`.

Method: every `'plus'`/`'studio'` string literal in non-test `.ts`/`.tsx`, read in context. Counts below
are exact, not estimated.

---

## The headline: the entitlement model already exists, and four capabilities already use it

The brief asked whether `extensions_json` on `pricing_plan_versions` is the intended home for capabilities.
**It is not.** `extensions_json` is written (`pricing-admin.ts:290,523`) and **never read anywhere** — no
consumer outside test fixtures.

The real mechanism is **`pricing_plans.feature_flags_json`**, and it is already a working entitlement model:

```
admin toggles (PricingStudio.tsx:1271-1273)
  → normalizePricingPlanFeatureFlags (pricing-admin.ts:1055-1057)
  → pricing_plans.feature_flags_json
  → pricing snapshot (lib/pricing/snapshot.ts:173-176, pricing-runtime.ts:391-394)
  → client via PricingRuntimeProvider
```

Four capabilities already ride it — `canAccessDownloads`, `canAccessUnbrandedExports`, `creatorControls`,
`videoExportPreset` — with **no plan-name conditional anywhere in that path**, admin-editable, and failing
closed (`?? false`). That is precisely the shape the pack demands.

**So Phase 3 item 1 is not "design an entitlement model". It is "move the remaining capabilities onto the
one that already shipped".** That materially shrinks the phase and should be settled before any unit is cut.

## The second headline: adding `'audience'` fails closed almost everywhere

Every capability site that branches on a plan key ends in a Free-shaped fallback — `default:`,
`return false`, `return policy.free_enabled`, `: row.free_enabled`. Verified individually at
`retention.ts:14-22,37-40`, `reel/settings.ts:278-281`, `coin-economy.shared.ts:154-157`,
`pricing-runtime.ts:547-556`.

Consequence: **an Audience user is treated as Free by every existing gate the moment the key is added.**
That is correct for creation capabilities (Audience has no creation coins) and harmless for the rest,
because Audience's one selling point — unlimited watching — is a quota that does not exist yet and will be
built in this phase. The quota must therefore test for an explicit *capability*, never for "not Free".

The practical effect is that **Audience can ship as a catalogue tier before the capability migration is
finished**, which un-blocks unit C from unit A in the brief's suggested split. Worth confirming as the
plan is written.

---

## Classification of all 47

### A — Capability wearing a plan name (13). These are the migration.

| Site | Reads as | Note |
|---|---|---|
| `lib/media/retention.ts:15,17` | original retention duration | needs a **number**, not a boolean |
| `lib/media/retention.ts:38,39` | HQ download/publish right | boolean |
| `lib/reel/settings.ts:279,280` | reel retention days | number |
| `lib/pricing/coin-economy.shared.ts:155,156` | per-action tier gate | **DB columns**, see below |
| `app/actions/pricing-runtime.ts:549,551` | same gate, server side | same columns |
| `components/story/PublishDialog.tsx:94` | HQ publish eligibility | duplicates `isHqEntitled`; should read the snapshot |
| `app/admin/graphic-styles/page.tsx:188` | "paid" vs "free" style | already thinks in capabilities, spells it as a plan |
| `components/admin/PricingStudio.tsx:594,595,596` | defaults for a new plan | defaults, not gates — but must answer for `audience` |

**The expensive one is not TypeScript, it is the schema.** `pricing_action_costs` carries
`free_enabled` / `plus_enabled` / `studio_enabled` as three **columns** (`082_coin_economy_gateway.sql:9-11`).
A fourth plan means a fourth column, plus every read site and the admin panel — or a migration to a
plan-keyed shape. Two admin JSON settings have the same per-plan-key shape and the same problem:
`MediaPipelineSettings.{freeRetentionHours,plusRetentionDays,studioRetentionDays,allowPlusHighQuality,allowStudioHighQuality}`
and `ReelStorySettings.retentionDays.{free,plus,studio}`. **Three parallel per-plan shapes, each needing a
fourth member.** That is the true size of item A, and it is a migration question, not a refactor question.

### B — List-shaped, already right (10). Adding a member is data, not structure.

`lib/reel/narration.ts:518,527,536,545,554` (`availableForTiers`), `lib/video-export/presets.ts:49,66,83`
(`allowedTiers`), `lib/ai/image-models.ts:44,48`.

These are the good pattern — a capability owning a list of plan keys. **One trap:**
`image-models.ts:48` filters with a hardcoded triple, so an `'audience'` entry stored by an admin is
silently dropped and the list falls back to *all plans* (`:49`) — the one place the fallback is
permissive rather than closed. Widen that filter in the same change that adds the key.

### C — Genuine plan identity (13). Legitimate, but each must widen.

`lib/types/pricing.ts:20` (the definition), `lib/admin/user-management.shared.ts:116,277,278,346`
(cohort filter), `components/admin/users/AdminPromotionalCohorts.tsx:34,35`,
`components/pricing/WalletPage.tsx:96,123` (Plus-specific copy),
`components/admin/PricingStudio.tsx:589` (display name), `lib/reel/narration.ts:669`,
`lib/reel/styles.ts:253` (parse guards).

**`lib/reel/narration.ts:13` is the one to watch:** `NarrationVoiceTier = 'free' | 'plus' | 'studio'` is a
**parallel union that does not derive from `PlanKey`**. Widening `PLAN_KEYS` will not widen it and **tsc
will not say a word**. `normalizeVoiceTier` then coerces an Audience user to `null` and `normalizeTierList`
falls back to `['free']` — closed, but silently, and no admin toggle can ever offer that user a voice.
Redefine it as `PlanKey` or the divergence is permanent.

### D — `'studio'` as a "no restriction" sentinel (7). The real design hazard.

`app/actions/admin-prompt-compiler.ts:19`, `app/actions/image-models.ts:51,130`,
`app/actions/pricing-admin.ts:1017`, `app/actions/video-export.ts:70,116`,
`lib/pricing/entitlement-tier.shared.ts:41`.

These pass `'studio'` to mean *"admin context, show everything"*, which works only because
`free < plus < studio` is a **total order** — encoded literally as `PLAN_TIER_RANK` in
`entitlement-tier.shared.ts:16-20` and relied on by `resolveEffectiveEntitlementTier`.

**Corrected 2026-09-18, while writing the plan.** This section first claimed Audience is not orderable in
that scale and that any rank breaks the override logic. That was too strong, and the plan depends on the
accurate version:

`free < audience < plus < studio` **works**, because Plus is a superset of Audience on every axis —
Audience's one advantage over Free is unlimited watching, and Plus has that too. The promote-only rule then
behaves correctly at every pair: Free→Audience promotes, Audience→Plus promotes, and a paying Plus account
is never pulled down to Audience. The seven sentinel sites keep working because Studio remains the maximum.

What survives is a **constraint, not a breakage**: the rank is only safe while no capability belongs to
Audience that Plus lacks. The moment one does, the scale stops being a scale and every sentinel site is
wrong at once. So capabilities must be read from the plan's feature flags, never derived from rank — which
is what the existing mechanism already does, and what the plan holds to.

### E — False positive (1)

`lib/admin/nav.ts:514` — `id: 'studio'` is an admin nav section id, unrelated to plans.

### F — In the schema, invisible to the grep above (2). Queried on dev 2026-09-18.

A `'plus'`/`'studio'` sweep of `.ts`/`.tsx` cannot see a CHECK constraint. Two hardcode the triple in SQL,
and an insert that violates one raises `23514` at runtime with nothing failing at compile time:

| Constraint | Effect if not widened |
|---|---|
| `user_entitlement_overrides_entitlement_plan_key_check` | **An admin cannot promote anyone to Audience at all.** Directly disables the override path. |
| `reel_visual_styles_min_plan_check` | A reel style can never be gated to Audience. |

The three other plan-key-bearing columns are clear: **`pricing_plans.plan_key` has no CHECK**, so adding
the Audience plan row is pure catalogue data with no migration; `pricing_promotions.target_plan_key` has
none either; and `image_model_registry.allowed_plan_keys` is an array with no constraint (its filtering is
the TypeScript trap already noted in category B).

Confirmed on dev at the same time: `pricing_plans` holds exactly three rows (free/plus/studio, ranks 1-3),
and `feature_flags_json` is populated and live on all three — including `canAccessDownloads: true` on
**Free**, which is direct evidence the capability mechanism is already decoupled from tier in production
use, not just in principle.

---

## What tsc will and will not catch when `'audience'` is added

Worth knowing before scoping, because it decides how much of this is mechanical:

- **Caught, loudly.** `Record<PlanKey, …>` literals. `PricingStudio.tsx:582` (`defaultsByPlan`) and
  `entitlement-tier.shared.ts:16` (`PLAN_TIER_RANK`) both become missing-property errors. Note
  `defaultsByPlan` is then indexed unchecked at `:586` and dereferenced at `:590`, so without the type
  it would be a runtime `TypeError`, not a fallback — the annotation is doing real work.
- **Not caught.** Every `if (planKey === 'studio') … else <free>` chain (they stay valid and silently
  mean "Free"), parallel unions like `NarrationVoiceTier`, hardcoded filters like `image-models.ts:48`,
  and every per-plan *key* in an admin JSON settings object.

So the union widening is safe but almost entirely silent. A plan that relies on "tsc will show us the
sites" will miss category A and B.

---

## Appendix — the watch path, and where a slot is actually consumed

Not hardcoding, but verified in the same session and it settles the brief's decision 1 ("pin slot
consumption to a specific call site"), so it is recorded here rather than rediscovered.

**The existing view recorder cannot be the quota ledger.** `recordView` (`app/actions/engagement.ts:107`)
is called from exactly one place — `components/story/StorylinePlayer.tsx:417`, a mount `useEffect`, client
side, fire-and-forget (`.catch(() => {})`), logged-in only. It is analytics. It cannot refuse anything, it
fires on *mount* rather than on a successful load (so Phase 0 decision 2's "failed loads don't count" is not
expressible there), and being client-initiated it is trivially skippable — which fails the pack's
"enforced server-side, race-safe across devices" outright.

**Corrected 2026-09-18, while writing the plan.** This section first said the storyline page fetches the
content server-side and is therefore the enforcement point. **It does not.** `app/storyline/[id]/page.tsx`
passes `storylineId`, `storyId`, `userId`, `title` and `beatCount` — **not** `beats`.
`StorylinePersistenceLoader` is a `'use client'` component that loads the content itself.

**The real choke point is `loadStorylineWithBeats` (`app/actions/exploration.ts:440`)** — a server action,
already authenticated at `:462-463` (it throws for signed-out callers, which matches "the quota only
concerns signed-in users"), and it has exactly **one** caller:
`StorylinePersistenceLoader.tsx:55`. It is the moment beats are served, on the server, unskippable.

Two properties of that loader the plan must respect:

- **The network call always fires.** `:55` starts `loadStorylineWithBeats` unconditionally, in parallel with
  the IndexedDB cache read, so enforcement there always runs — the cache cannot route around it.
- **But the cache can win the race for display.** `:57-73` paints a cached payload as soon as it resolves.
  So on a refusal the reader may already be looking at the story. The loader must therefore *discard* a
  displayed cached payload when the server refuses, not merely decline to replace it.

`/explore/[id]` is not a second choke point: it is `'use client'` and renders `StoryScreen` from the store —
the authoring/branching surface, coin-gated, not a watch surface. Every watch entry point in the gallery
(`GalleryHero:271`, `StorylineCard:229`, `StorylineCardPanel:119`, `SeriesEpisodeList:41`,
`MyStoriesDrawer:497`, `ReviewHistory:81`) links to `/storyline/[id]`, so all watching funnels through the
one action. `recordView` stays exactly as it is — analytics, not a ledger.

## Open — for the owner, alongside the brief's five

The brief's decisions 1-5 stand. This audit adds one that has to be answered before unit A is cut:

**Do the three per-plan shapes move to a plan-keyed representation, or does Audience just get a fourth
member of each?** The fourth-member route is far cheaper now and pays again at every future tier; the
plan-keyed route is a migration of `pricing_action_costs` plus two settings normalizers. This is a cost
question the owner should price, not an executor's call.
