# Plan model and entitlements inventory — Audience tier feasibility

_Stream 10 · read-only discovery · branch payments · 2026-09-17_

Scope: given the owner-approved plan model in
`prompt-packs/kissago-payment-billing-prompt-pack-2026-09-17/01_OWNER_DECISIONS_AND_PRODUCT_MODEL.md`
and `.../05_PHASE_3_PLANS_ENTITLEMENTS_CONSUMPTION.md` (Free: 3 unique stories/day + 50-once
trial coins expiring in 30 days; **Audience**: unlimited watching, no included coins, ₹199/mo
+ ₹1,799/yr targets; Plus/Studio unchanged + unlimited watching), find every place code/SQL/UI
assumes exactly `free|plus|studio`, how entitlements actually resolve today, and what already
exists vs. needs building. Builds on stream 2
(`02-entitlements-grants-and-coin-value.md`) and stream 4 (`04-admin-tools-and-operations.md`)
— not repeated here except where directly relevant. Stream 9
(`09-story-consumption-path.md`) owns the daily-quota mechanism itself (still in progress at
time of writing); this doc only covers where its admin knob would live.

All facts below are read-only: static code + migrations, plus SELECT-only queries against the
**dev** Supabase project (`dxbwzcpbfacrwrauhdbk`).

## 1. Hardcoded plan-key inventory

**Single source of truth type:** `PLAN_KEYS = ['free','plus','studio']` /
`PlanKey` (`lib/types/pricing.ts:15-16`). ~58 files import `PlanKey`. Two shapes of usage matter
differently for a 4th key:

**A. Exhaustive `Record<PlanKey, X>` literals — safe, TS forces an update.** Adding `'audience'`
to the union breaks the build at every one of these until filled in, which is a feature, not a
risk:
- `lib/pricing/entitlement-tier.shared.ts:15-19` `PLAN_TIER_RANK` (free:0, plus:1, studio:2)
- `lib/reel/styles.ts:246-250` `PLAN_RANK`
- `lib/references/reference-settings.ts:52` `DEFAULT_REFERENCE_TIER_LIMITS`
- `components/admin/PricingStudio.tsx:491` `defaultsByPlan`
- `components/admin/ReferenceSettingsPanel.tsx:33` `TIER_LABELS`
- `components/admin/VideoExportPresetStudio.tsx:21` `PLAN_LABELS`
- `components/admin/GlobalSettings.tsx:878` `narrationPlanLabels`

**B. If/else-if chains with an implicit "else" — silent misbehavior risk.** These do **not**
force a compile error; an unhandled key falls through to whichever branch is last:
- `lib/pricing/coin-economy.shared.ts:154-158` `isTierEnabled` — `if (studio) ... else if
  (plus) ... else return policy.free_enabled`. A 4th `PlanKey` that isn't `plus`/`studio` falls
  to `free_enabled` **by accident of branch order**, not by design.
- `app/actions/pricing-runtime.ts:497-509` `buildMeterEntitlementMap` — **an independent,
  duplicate copy of the exact same three-way fallback**, used to build the wallet page's
  feature-entitlement map. Two places would need the same fix, not one.
- `lib/reel/styles.ts:252-254` `normalizePlanKey` — collapses anything not `'plus'|'studio'`
  to `'free'`. Same fallthrough shape, but here it's arguably *correct* behavior for a plan
  that should be treated like Free for creation gating.
- `components/pricing/WalletPage.tsx:84-124` `buildPlanFeatures` / `getPlanDescription` — `if
  free / if plus / else` with **hardcoded Studio marketing copy** in the else branch
  ("Everything in Plus", "richer control"). A 4th plan iterated by `offers.map`
  (`WalletPage.tsx:715`) would render Studio's sales copy on an Audience card. Concrete,
  user-visible break.
- `app/actions/pricing-checkout.ts:42` — `plan.plan_key === 'free'` blocks purchase; harmless
  for a distinct `'audience'` key.

**C. DB CHECK constraints — hard runtime rejection, not silent, needs a migration:**
- `supabase/migrations/096_user_entitlement_tier_overrides.sql:17-18` — `entitlement_plan_key
  CHECK (... IN ('free','plus','studio'))`. Needed only if an admin should be able to
  *promote* someone's entitlement to `'audience'` — see §2 open question.
- `supabase/migrations/048_reel_playground_image_styles.sql:49` — `min_plan CHECK (...)`, same
  three values. Only matters if a reel style should ever require `'audience'` as its floor.

**D. Not restrictive — no migration needed:**
- `pricing_plans.plan_key` is `text NOT NULL UNIQUE`, **no CHECK constraint at all**
  (`supabase/migrations/015_pricing_catalog.sql:4-15`) — a fourth plan_key row is a pure data
  insert.
- `image_model_registry.allowed_plan_keys TEXT[]` (`062_image_model_registry.sql:28`) has no
  CHECK on element values, only "array is non-empty" — resolved via array containment at
  runtime, not a switch, so a new key just works if added to a row's array.
- `app/actions/pricing-admin.ts:91,1097-1118` — `savePricingPlanDraft`'s
  `SavePricingPlanDraftInput.planKey` is typed `PlanKey | string` and `upsertPricingPlanBase`
  does a plain `.trim().toLowerCase()` upsert keyed on `plan_key` with **no allow-list check**.
  The server action already accepts an arbitrary new plan key today.

**E. Admin UI gap (not code-breaking, but blocks the workflow):** `components/admin/
PricingStudio.tsx:1047` renders the plan-key selector as `PLAN_KEYS.map(...)` — closed to the
three known keys — and `:662` types `selectedPlanKey` as `useState<PlanKey>`. Even though the
server action (D above) would accept `'audience'`, **the admin UI provides no way to type or
select it.** `defaultPlanEditor` (`:490-511`) also hardcodes `name: planKey === 'free' ? 'Free'
: planKey === 'plus' ? 'Plus' : 'Studio'` and defaults `canAccessDownloads`/
`canAccessUnbrandedExports`/`creatorControls` to `planKey === 'studio'` — another else-fallback
that would mislabel a 4th key as Studio-like.

## 2. Entitlement model

Resolution chain (already documented in depth by stream 2 §1; only what's new/relevant here):
`snapshot.ts` picks the newest "entitled" subscription → `planKey` (billing truth); `entitlement-
tier.shared.ts`'s `resolveEffectiveEntitlementTier` (`:35-52`) computes `entitlementPlanKey`
(admin promote-only, never lowers, never touches coins). **Both fields are typed `PlanKey`** —
so today there is exactly one linear ladder (`free < plus < studio`) driving both "what you pay
for" and "what admin can promote you to."

**Can a Free (or would-be Audience) user with only purchased top-up coins create stories
today?**
- **Text (prompt-only story generation): yes.** Verified live (dev DB):
  `start_story_initial_beat_prompt_only`, `continue_story_new_beat_prompt_only`,
  `start_reel_full_generation_prompt_only`, `preview_seed_plan`, `regenerate_image` are all
  `free_enabled = true`. Balance is the only gate (`pricing_authorize_spend`), so any coins —
  welcome grant or top-up — work.
- **Images: no, categorically, regardless of coin balance.** `image_generation`'s
  `free_enabled = false` (confirmed live). The gate fires *before* any balance check:
  `lib/pricing/image-aware-authorize.ts:78-97` — when `pricing.entitlementPlanKey === 'free'`,
  it runs a pure entitlement probe (`unitBeatCostOverride: 0`) against the `image_generation`
  meter, which denies with `tier_locked` via `isTierEnabled` (§1B) purely because
  `free_enabled` is false. No amount of top-up coin fixes this for a `'free'`-resolving user.
- **This is the load-bearing fact for Audience.** The owner's plan explicitly wants Audience to
  "buy top-up coins for occasional creation" (`01_OWNER_DECISIONS...md` §5), which in practice
  means image generation. If Audience is ever represented internally as anything that isn't
  literally `'plus'` or `'studio'` in `pricing.entitlementPlanKey`, the *exact same hard block*
  that stops Free today silently (or loudly, via `tier_locked`) also stops Audience — whether or
  not they have coins. Whether that's the intended product behavior (Audience = Free's creation
  rights, plus unlimited watching) or a gap to close (Audience should get image generation via
  top-ups) is the single decision that determines whether `image_generation.free_enabled` (or an
  analogous new column) needs to change at all. See open questions.

**Tier- vs. balance-gated features, summarized:** `is_active` / `free_enabled` / `plus_enabled`
/ `studio_enabled` on `pricing_action_costs` (082) are **capability gates**, checked first and
independent of balance; `pricing_authorize_spend`/`finalize` (021, 040) are **balance gates**,
checked second. A plan can be capability-unlocked and still balance-denied, but never the
reverse.

## 3. Welcome / free grant — mostly already built

**Current live config** (dev, `operational_policies` row `free_welcome_grant`):
`{grantMode: 'once_per_account', coinAmount: 50, expiresAfterDays: null}` — 50 coins, granted
once, **never expires**. Matches stream 2 §7 exactly.

**What "50 once, expires in 30 days, never refills" requires: nothing new.** The RPC already
supports a configurable expiry — `apply_free_welcome_grant`
(`supabase/migrations/084_operational_policies_and_welcome_grant.sql:210-309`) reads
`config_json->>'expiresAfterDays'` and, if set, computes `expires_at = now() +
make_interval(days => ...)` (`:269-272`); its sibling admin-update validator
`admin_update_operational_policy` (`:147-168`) already range-checks a new `expiresAfterDays`
value (1–3650) before it's saved. **The admin UI already exposes both fields**:
`/admin/policies` (`app/admin/policies/page.tsx`) →
`components/admin/OperationalPoliciesStudio.tsx:29-78` has live `coinAmount` and `expiryDays`
inputs wired to `updateFreeWelcomeGrantPolicy` (`app/actions/admin-policies.ts:44`). **Setting
`expiresAfterDays = 30` in that one admin page is the entire code change needed** to satisfy the
owner's requirement — verified by reading the RPC, the validator, and the UI, not inferred.

**Spend order already protects top-up coins from trial expiry** (stream 2 §2, restated because
it's exactly what the owner asked to confirm): consumption priority is `promotion` →
`subscription/carry_forward/admin_adjustment/migration_grant/free_allowance` (tie-broken by
soonest expiry first) → `topup` **last**
(`supabase/migrations/040_fractional_action_costs.sql:107-116,262-271`). Once `free_allowance`
carries a real `expires_at`, it will naturally be prioritized for spend *ahead of* the
never-expiring top-up grant (soonest-expiry-first tie-break), and `topup` is spent only after
every non-topup grant is exhausted — so trial coins are used or lost before top-ups are ever
touched, exactly the ordering the owner wants, with zero code change.

## 4. Annual support

`pricing_plan_versions.billing_interval CHECK (... IN ('monthly','annual'))` already exists
(`015_pricing_catalog.sql:22`) and is plan-key-agnostic — any plan (including a future
`'audience'` row) can have a published annual version with zero schema change. Live dev catalog
already has ROW annual rows for Plus/Studio (stream 2 §1).

**Razorpay plan/subscription creation is already interval-generic** — not a blocker:
`createRazorpayPlan` (`lib/billing/razorpay.ts:81`) maps `interval === 'annual' ? 'yearly' :
'monthly'` directly to Razorpay's `period`, and `:108` sets `total_count: annual ? 100 : 1200`
(effectively unbounded either way). `grantSubscriptionCycleIfMissing`
(`lib/billing/razorpay-sync.ts`) keys its idempotency off `subscription.id + current_start`
regardless of interval — an annual cycle just grants once a year instead of once a month, and
for Audience that grant would simply be 0 included beats.

**The actual blocks, both plan-key-blind (this is what must change, not the DB/provider
layer):**
- **Server, hard throw:** `app/actions/pricing-checkout.ts:46-48` — `if (version.provider ===
  'razorpay' && version.billing_interval === 'annual') throw new Error('Yearly checkout is not
  available yet for the India market...')`. This fires for *any* plan on Razorpay+annual, not
  just Plus/Studio. Enabling Audience annual (India) without also silently enabling Plus/Studio
  annual (India) requires this check to become plan-key-aware, e.g. `&& plan.plan_key !==
  'audience'`, or driven by a new per-plan/per-version flag rather than a blanket
  provider+interval rule.
- **Client, blanket market gate:** `components/pricing/WalletPage.tsx:346-354` —
  `yearlyCheckoutDeferred = usingRazorpayMarket && pricingMarketKey === 'IN'`, applied uniformly
  to the whole plan grid (disables the Yearly toggle at `:698`, shows one blanket banner at
  `:708-711` for every plan card). Same fix needed: this needs to become per-offer rather than a
  single page-level boolean, or Audience's card needs its own interval toggle independent of the
  others.
- Both gates are **provider+market** conditions today, with no `plan_key` dimension at all —
  confirms the owner's framing ("does not automatically mean Plus and Studio annual must be
  enabled") is not yet expressible in the current code; it would need to be added.

## 5. Admin pricing surfaces

Three existing, independently-audited admin surfaces, each a good fit for a different piece of
the Audience requirement — no new admin infrastructure pattern needed, only new rows/fields:

| New setting needed | Natural home | Evidence it already fits |
|---|---|---|
| Audience monthly/annual price, availability, coins-per-cycle (0) | Pricing Studio (`/admin/pricing/plans`) — `savePricingPlanDraft` → `publishPricingPlanVersion` (`app/actions/pricing-admin.ts:260-453`) | Generic plan/version upsert (§1D); full draft→publish→archive lifecycle; every mutation audited to `pricing_publish_audit` (stream 4 F12) |
| Free trial coin amount, trial expiry days | `/admin/policies` → `OperationalPoliciesStudio.tsx` | Already built and wired (§3) — not a gap at all |
| Free daily unique-story limit | **New** — no existing quota/rate-limit infrastructure found anywhere in `lib/` (grepped for `quota`, `rateLimit`, `dailyLimit` — zero relevant hits) | Best fit is a new `operational_policies` row (same shape as `free_welcome_grant`) or a new `pricing_*` numeric runtime flag (`PRICING_RUNTIME_SETTING_DEFINITIONS`, `lib/types/pricing.ts:142-293`) — both patterns already give admin-editable, fail-closed-by-default numeric knobs. Stream 9 owns the enforcement mechanism; this is only about where the *number* lives. |

**Admin UI gap to close regardless of data-model choice:** PricingStudio's plan-key dropdown is
closed to `PLAN_KEYS` (§1E) — creating an Audience plan row through the admin UI (as opposed to
a one-off migration seeding it) needs that dropdown changed to either include the new key or
accept free text, plus `defaultPlanEditor`'s else-branch defaults fixed so Audience doesn't
inherit Studio's `canAccessDownloads`/`canAccessUnbrandedExports`/`creatorControls` defaults.

## 6. User-facing plan surfaces

- **`/wallet`** (`components/pricing/WalletPage.tsx`) is the only real plan-comparison surface.
  `offers.map` (`:715`) iterates whatever `pricing_plans` rows exist — **structurally generic**,
  will pick up a new plan automatically. But per-card copy is not: `buildPlanFeatures`,
  `getPlanDescription`, `getPlanCtaLabel` (§1B) hardcode marketing text per plan key with an
  else-fallback to Studio's copy — these need explicit Audience branches, they will not "just
  work."
  - Numeric values (`storyLengthCap`, `monthlyCoins`, prices) come from the catalog via
    `buildPlanOffers` (`app/actions/pricing-runtime.ts:314-351`), not literals — good, this part
    already satisfies the owner's "values must come from the same authoritative source" rule
    (`01_OWNER_DECISIONS...md` §6).
  - Interval toggle is the one exception (§4) — currently page-wide, not per-offer.
- **User menu** (`components/auth/UserMenu.tsx:77,83`): plan badge is built generically
  (`` `${planKey.charAt(0).toUpperCase()}${planKey.slice(1)} plan` ``) and the "show
  billing-management link" condition is `planKey !== 'free'` — both already correct for a 4th
  key with zero code change, confirmed by reading the exact lines.
- No other account/settings page surfaces plan comparison — grepped `components/**` for
  `planKey`/`currentPlan`; the only other hits are admin-only surfaces (§1).

## 7. Infra present or absent

- **Transactional email: absent.** No email dependency anywhere in `package.json` (grepped for
  nodemailer/resend/sendgrid/postmark/ses/mailgun — zero hits). Matches PROJECT_STATE's own
  note that notifications are a from-scratch design job, deliberately deferred by the owner
  2026-09-14 (agentic reviewer-assignment notifications) — same gap applies to any Audience
  purchase-confirmation or trial-expiry email.
- **PDF generation: absent.** No pdfkit/jspdf/puppeteer/pdf-lib in `package.json`. Matches
  stream 4's F9 (no invoice/receipt generation anywhere; only a static GSTIN string in Terms
  copy).
- **Scheduled jobs: one cron only.** `vercel.json` registers exactly `/api/batch/reconcile`
  (daily `0 3 * * *`) — the Hobby plan allows only one (PROJECT_STATE.md). Any new scheduled
  need (trial-expiry sweep, annual-renewal reminder) has to piggyback this same cron rather than
  register a new one, same pattern already used for the agentic worker queue.
- **Private object storage + presigned URLs: present and reusable.** `lib/media/r2-server.ts:
  41-45` — `getR2Bucket(access: 'public' | 'private')` already resolves a genuinely separate
  private R2 bucket, and `GetObjectCommand`-based presigned download already exists
  (`:136,153`), exercised today via `app/api/media/r2/presign/route.ts` and
  `.../r2/complete/route.ts` for reference-image uploads. **If invoices are ever built, the
  storage/delivery primitive needs no new plumbing** — only a PDF-generation step and an
  invoice-numbering/record feature are net-new, confirming stream 4's F9 gap is specifically
  "no invoice generation," not "no private storage."

## Proposed direction

- **Do not add `'audience'` to `PLAN_KEYS`/`PlanKey`.** The type is a linear rank ladder
  (`PLAN_TIER_RANK`, `PLAN_RANK`) used for "is this plan at least as good as that plan" checks;
  Audience is not comparable on that axis (more viewing than Plus, less creation than Free-plus-
  topups intends). This matches the design note already recorded in PROJECT_STATE.md (~line
  219-226): a viewer entitlement should be a parallel dimension, not a repurposing of `PlanKey`.
- **Keep `snapshot.planKey` exactly `free|plus|studio`.** An Audience-only subscriber's
  creation/coin-tier behavior (action-cost gates, story-length cap, image eligibility) should
  continue to resolve as `'free'` — this is *already* what the owner asked for ("top-up coins
  remain governed by the existing top-up rules") and requires zero change to §1's `Record<PlanKey,…>`
  sites, the two duplicate `isTierEnabled` functions, or any CHECK constraint.
- **Add a new, orthogonal "viewing entitlement" resolved independently in `snapshot.ts`** — e.g.
  `unlimitedViewing: boolean` (true for an active Audience/Plus/Studio subscription) — computed
  as a separate MAX-like check over the user's subscription, not derived from `planKey`. This is
  the one real architectural addition; everything else in this doc is either already generic
  or a small, well-scoped fix.
- **Represent Audience as an ordinary `pricing_plans`/`pricing_plan_versions` row** (a data
  insert only — no CHECK blocks this, §1D) so it inherits the existing draft/publish/audit
  workflow, checkout flow, and Razorpay plan lazy-creation for free. Tag it (e.g.
  `feature_flags_json.isViewerOnlyPlan: true`) so `snapshot.ts` knows to route its subscription
  into `unlimitedViewing` rather than `planKey`.
- **Fix the two duplicate tier-fallback functions to be explicit, not accidental**
  (`lib/pricing/coin-economy.shared.ts:154-158`, `app/actions/pricing-runtime.ts:497-509`) —
  today they happen to do the right thing for a non-plus/non-studio key only by branch order;
  make that intentional and, ideally, de-duplicate into one shared function.
- **Fix `WalletPage.tsx`'s copy functions** (`:84-124` and friends) so a viewer-only plan gets
  its own marketing copy instead of falling into Studio's.
- **Make the Razorpay-annual India block plan-aware**, not provider+market-blanket
  (`pricing-checkout.ts:46-48`, `WalletPage.tsx:346-354`) — needed specifically because the
  owner wants Audience annual now but not automatically Plus/Studio annual.
- **Open the Pricing Studio plan-key selector past the closed `PLAN_KEYS` list**
  (`PricingStudio.tsx:1047,662,490-511`) so admins can actually create/edit an Audience plan
  through the UI the server action already supports.
- **New Free daily-quota setting**: no existing infra to build on; add as a new
  `operational_policies` row (reuse the `free_welcome_grant` shape) rather than inventing a
  different config surface. Actual enforcement mechanism is stream 9's territory.
- **If Audience users should be able to spend top-up coins on images**, `pricing_action_costs.
  image_generation.free_enabled` (or an Audience-specific equivalent) must change from its
  current hard `false` — this is a product decision, not a technical constraint (see open
  questions).

## Open questions for owner

1. Should a purchased Audience subscription (no Plus/Studio) unlock image generation via
   top-up coins, or should Audience's creation rights stay identical to Free (text/narration/
   alignment/SD-export only, no images, per §2)? This single decision determines whether
   `pricing_action_costs.image_generation` needs a new tier column/value at all.
2. Should an admin be able to *promote* a user's entitlement to Audience-level viewing the same
   way `user_entitlement_overrides` promotes creation tier today? If yes,
   `096_user_entitlement_tier_overrides.sql`'s CHECK needs a migration and the promote-only
   rank logic needs a second (viewing) axis, not just the existing creation axis.
3. Is a single active subscription per user (today's model — a second Razorpay subscription is
   blocked outright, `pricing-checkout.ts:50-65`) still fine once Audience exists, i.e. is
   "Plus already includes unlimited viewing" sufficient, or will a user ever need to hold an
   Audience subscription *and* separately buy occasional Plus/Studio-only capability? The owner
   decisions doc implies no (Plus/Studio already include unlimited watching), but worth
   confirming before the checkout single-subscription block is left as-is for a 4th plan.
4. Should the India-annual Razorpay block be lifted specifically for Audience only (owner's
   stated intent) with Plus/Studio staying monthly-only in India for now — confirming there is
   no timeline pressure to also unblock Plus/Studio annual India in the same change?
