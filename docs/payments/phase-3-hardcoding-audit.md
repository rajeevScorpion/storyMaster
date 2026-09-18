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

**Audience is not orderable in that scale.** It is above Free on watching and below Plus on creation. Any
rank given to it is wrong for one of the two axes, and `resolveEffectiveEntitlementTier`'s promote-only
rule (`override > billing`) silently does the wrong thing at whichever rank is chosen — promoting a
paying Audience user to Plus would be refused, or promoting to Audience would appear to be an upgrade from
Plus. This is the strongest single argument for capability-based entitlements over a tier rank, and it
should be stated that way when the owner is asked.

### E — False positive (1)

`lib/admin/nav.ts:514` — `id: 'studio'` is an admin nav section id, unrelated to plans.

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

## Open — for the owner, alongside the brief's five

The brief's decisions 1-5 stand. This audit adds one that has to be answered before unit A is cut:

**Do the three per-plan shapes move to a plan-keyed representation, or does Audience just get a fourth
member of each?** The fourth-member route is far cheaper now and pays again at every future tier; the
plan-keyed route is a migration of `pricing_action_costs` plus two settings normalizers. This is a cost
question the owner should price, not an executor's call.
