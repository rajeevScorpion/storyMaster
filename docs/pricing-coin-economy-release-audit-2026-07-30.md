# Pricing, Coin Economy, and Tier-Gate Release Audit

Audit date: 2026-07-30

Repository: `storyMaster` / Kissago

Scope: pricing catalog, plans, wallet grants, billing, spend enforcement, user-visible coin quotes, vendor-cost telemetry, and tier-gated features.

Implementation update: the beta coin-economy foundation described in the confirmed decisions below has been implemented locally. See `docs/coin-economy-beta-implementation-runbook-2026-07-30.md` for migration, seeded rates, enforcement behavior, validation, and staged activation. No staging or production state was changed.

## 1. Executive conclusion

The project has a solid accounting foundation, but the public-production coin economy is not active yet and several product gates are not authoritative enough for a paid launch.

The most important current facts are:

1. Production has a populated plan, top-up, action-cost, export-preset, and image-model catalog.
2. All production pricing rollout switches are currently off:
   - pricing snapshot off
   - checkout off
   - shadow metering off
   - hard enforcement off
   - story-length tier UI off
   - admin pricing bypass off
3. Production has zero billing customers, subscriptions, orders, wallet grants, reservations, usage events, or usage allocations as of this audit.
4. Therefore, production users are not currently receiving real monthly coin grants and no user actions are currently consuming coins.
5. The reported Free-tier export failure is reproducible from configuration and code:
   - global downloads are on
   - Free `canAccessDownloads` is true
   - the Standard export preset allows Free
   - but both export buttons also require `pricing_snapshot_enabled`
   - production has that switch off, so every non-admin remains locked
6. Once hard enforcement is enabled, the reservation/finalization ledger is atomic and generally well designed.
7. Several costs and tier rules are fragmented across multiple sources of truth. Some UI quotes do not match the amount that the wallet will reserve.
8. Some features create real AI-provider cost without a corresponding user coin debit. Narration regeneration and unlimited narration previews are the clearest examples.
9. Several paid-tier gates are UI-only or accept client-authored settings. Story length, reel style, creator controls, reel narration choices, export entitlement, and character-sheet limits need stronger server-side policy enforcement.
10. Carry-forward, promotions, migration grants, temporary tester Studio grants, and Stripe checkout are represented in design/schema but are not complete operational flows.

The recommended release posture is: do not turn on hard enforcement yet. First fix the export dependency, centralize quotes and tier decisions, settle narration and carry-forward policy, add server-side story-length and export checks, test the ledger in shadow mode, and only then enable checkout and hard charging.

### 1.1 Confirmed beta policy decisions

The following decisions were confirmed after the initial audit and supersede any conflicting recommendation later in this report:

1. The first beta rollout is India-only.
2. Image generation is disabled for Free accounts by default. An administrator must be able to toggle this entitlement on or off without a deployment. Free users can still create prompts and bring externally generated images into the product.
3. Text generation is a metered action for every tier. A plan entitlement does not make the provider operation free.
4. Narration/TTS is never a complimentary action. If TTS is enabled for a tier, including Free, it must pass wallet authorization and incur the configured coin charge.
5. Text-overlay timing is also metered. The current implementation is primarily text/audio alignment rather than speech-to-text transcription; alignment and any future true STT transcription should have separate meter keys.
6. Browser video export consumes coins on every tier.
7. Export quality is tier-gated:
   - Free: SD only
   - Plus: SD and HD
   - Studio: SD and HD
8. Plan rights and wallet funds are independent gates. Purchasing or holding coins must never unlock a tier capability that the plan does not allow.
9. All quoted and charged amounts must come from one server-side coin-economy service and one admin-manageable rate catalog.
10. Composite work must preserve both the total operation cost and its component costs for reporting and reconciliation.

The exact coin amounts and monthly allowances still need to be frozen. They should be data/configuration changes, not code changes.

## 2. Sources and audit method

This report combines:

- current application code
- database migrations and spend RPCs
- historical pricing strategy and rollout documents
- read-only queries against the Supabase projects configured in `.env.local` and `.env.production`

No production or staging data was changed during this audit.

Primary implementation sources include:

- `lib/types/pricing.ts`
- `lib/pricing/snapshot.ts`
- `lib/pricing/enforcement.ts`
- `lib/pricing/image-aware-authorize.ts`
- `lib/pricing/wallet.ts`
- `lib/billing/razorpay-sync.ts`
- `app/actions/pricing-runtime.ts`
- `app/actions/pricing-checkout.ts`
- `app/actions/pricing-enforcement.ts`
- `supabase/migrations/015_pricing_catalog.sql`
- `supabase/migrations/016_billing_core.sql`
- `supabase/migrations/017_wallet_core.sql`
- `supabase/migrations/040_fractional_action_costs.sql`
- story, reel, export, narration, cover, reference, HQ-media, and bulk-image actions

Historical intent was compared with:

- `docs/pricing-strategy.md`
- `docs/pricing-architecture-spec.md`
- `docs/pricing-phase-3-rollout-plan.md`
- `docs/pricing-user-ui-spec.md`
- `docs/pricing-implementation-log.md`
- `docs/razorpay-stage-rollout-runbook.md`
- `docs/production-pricing-rollout-checklist.md`
- `docs/future-subscription-account-management.md`

Database observations in this report are a point-in-time snapshot from 2026-07-30 and should be rechecked immediately before rollout.

## 3. Terminology and sources of truth

### 3.1 Internal beats versus user-facing coins

The database and wallet use an internal unit named a `beat`. The public product uses `coins`.

```text
1 internal beat = 10 user-facing coins
```

The conversion is fixed by `COINS_PER_BEAT = 10` in `lib/types/pricing.ts:4`.

Fractional internal beats are supported to two decimal places. That permits a minimum accounting increment of:

```text
0.01 internal beat = 0.1 coin
```

The admin pricing UI is stricter and is designed around whole user-facing coins.

The user-facing specification explicitly says to use `coins` everywhere. Any UI that shows `beat` as wallet currency is a defect.

### 3.2 There is not one pricing authority

The effective price of an action may currently come from one or more of these places:

1. `pricing_action_costs`
   - fixed base prices such as seed preview, covers, export, and reference adoption
2. `image_model_registry.coin_cost_per_image`
   - the actual image component for story start, continuation, reel generation, image regeneration, and bulk visuals
3. hardcoded formulas
   - prompt-only base plus image count
   - 50% batch multiplier
4. plan feature flags
   - downloads, unbranded exports, creator controls
5. feature-flag JSON
   - export presets, media retention/HQ, reel settings, reference settings, narration settings

This fragmentation is the main reason quotes, entitlements, and actual debits can drift.

### 3.3 Vendor-cost telemetry is separate from wallet charging

`ai_cost_events` estimates what Kissago pays AI providers. It does not debit the user's wallet.

`beat_usage_events` records what the user paid in coins. It does not automatically derive from vendor telemetry.

As a result:

- an action can cost Kissago money but cost the user zero coins
- an action can cost the user coins but have little or no direct vendor cost
- changing a provider's USD cost does not automatically change user coin pricing
- changing an action coin cost does not automatically protect provider margin

This separation is architecturally reasonable, but it requires explicit product policy and margin monitoring.

## 4. Current production state

### 4.1 Production rollout switches

Observed production state:

| Control | State | Current effect |
|---|---:|---|
| Pricing snapshot | Off | Wallet is shown as an allowance preview; Free monthly grants are not materialized by the normal snapshot load |
| Checkout | Off | Plan and top-up purchase buttons remain unavailable |
| Shadow metering | Off | No would-allow/would-deny reservation records |
| Hard enforcement | Off | Authorized actions proceed without a reservation or debit |
| Admin coin bypass | Off | No pricing bypass from this control |
| Story-length tier UI | Off | All normal stories use the generic UI range instead of the plan cap |
| Video download master | On | Export can be considered, subject to other gates |
| Video download admin bypass | On | The configured admin can export even while the pricing snapshot is off |

Important behavior: hard enforcement being off means a signed-in user is allowed through a billable action with no reservation and no spend. A signed-out user is still denied before the rollout-mode check.

### 4.2 Production ledger and billing population

Observed row counts:

| Table | Rows |
|---|---:|
| `billing_customers` | 0 |
| `billing_subscriptions` | 0 |
| `billing_orders` | 0 |
| `billing_webhook_events` | 0 |
| `beat_grants` | 0 |
| `beat_spend_reservations` | 0 |
| `beat_usage_events` | 0 |
| `beat_usage_allocations` | 0 |
| `pricing_promotions` | 0 |

This confirms that the production coin economy is still dormant, not merely hidden.

### 4.3 Production plans

Plan feature flags live on the plan record, not the market-specific plan version. Download, unbranded-export, and creator-control decisions therefore apply to both India and ROW unless the data model is changed.

#### India

| Plan | Price | Monthly coins | Story cap in catalog | Downloads | Unbranded | Creator controls |
|---|---:|---:|---:|---:|---:|---:|
| Free | ₹0 | 50 | 4 | Yes | No | No |
| Plus | ₹1,450/month | 300 | 6 | Yes | Yes | No |
| Studio | ₹3,950/month | 900 | 10 | Yes | Yes | Yes |

#### Rest of world

| Plan | Price | Monthly coins | Story cap in catalog | Downloads | Unbranded | Creator controls |
|---|---:|---:|---:|---:|---:|---:|
| Free | $0 | 120 | 4 | Yes | No | No |
| Plus | $12/month or $108/year | 1,000 | 8 | Yes | Yes | No |
| Studio | $29/month or $290/year | 3,000 | 8 | Yes | Yes | Yes |

The current India and ROW allowances differ materially:

- Free: 50 versus 120 coins
- Plus: 300 versus 1,000 coins
- Studio: 900 versus 3,000 coins

This may be intentional market packaging, but it should be explicitly approved because it changes both customer value and the maximum provider subsidy.

### 4.4 Production top-ups

Only India has published top-ups:

| Pack | Price | Coins | Price per coin |
|---|---:|---:|---:|
| 120 Coins | ₹450 | 120 | ₹3.75 |
| 240 Coins | ₹850 | 240 | ₹3.54 |
| 480 Coins | ₹1,650 | 480 | ₹3.44 |

No ROW top-ups are currently published. Stripe checkout is also not implemented, so paid ROW catalog entries cannot be purchased through the current application.

India subscription price per included coin is:

- Plus: approximately ₹4.83
- Studio: approximately ₹4.39

The top-up coin itself is cheaper than the included subscription coin when plan feature value is ignored. This can be valid, but it weakens the pure volume incentive to upgrade.

## 5. How coins enter a wallet

### 5.1 Free monthly allowance

For a Free user, the system can create one `free_allowance` grant per account-anchored monthly cycle.

Behavior:

- the anniversary anchor is the auth account creation timestamp
- one grant is created per monthly cycle
- the grant expires at the end of that cycle
- it does not carry forward
- it is only ensured when pricing snapshot, shadow metering, or hard enforcement is enabled

With all three production controls off, no Free grant is currently being created.

Turning on `pricing_snapshot_enabled` is therefore not only a display change. It begins materializing real Free allowance rows when signed-in users load pricing context.

### 5.2 Subscription refill

Razorpay subscription sync creates one `subscription` grant for each provider period:

```text
source reference = provider subscription id + current period start
grant amount = plan version monthly_included_beats
expiry = provider current period end
```

The source reference makes repeated verify and webhook calls idempotent for the same cycle.

Only subscriptions with `active` or `authenticated` status receive a grant. Pending or halted subscriptions may retain plan entitlement during grace, but they do not receive a fresh subscription grant through this path.

### 5.3 Top-up purchase

A successfully verified Razorpay top-up creates a non-expiring `topup` grant. The billing order id is the idempotent source reference, so verify/webhook replay should not double-grant the pack.

Top-ups increase volume only. They do not change the user's plan or unlock paid-tier features.

### 5.4 Carry-forward

The schema, plan versions, runtime settings, wallet source types, and strategy documents all support the idea of carry-forward. The documented target is a capped balance, normally up to two times the monthly allowance.

However, no runtime path currently creates a `carry_forward` grant or applies `carry_forward_cap_multiplier`.

Current operational behavior is therefore:

- subscription grants expire at period end
- unused subscription coins do not roll over
- the catalog's carry-forward multiplier is inert

This is a material promise-versus-implementation gap if carry-forward is mentioned publicly.

### 5.5 Promotions

The admin can define promotion catalog records and the wallet can spend promotion grants first.

No production promotions exist, and no application flow was found that:

- evaluates promotion eligibility
- prevents repeat application per user
- creates the associated `promotion` grant

Promotion configuration is currently dormant infrastructure.

### 5.6 Migration grants, tester Studio, and admin adjustments

The source types and runtime settings exist for:

- migration grants
- temporary tester Studio access
- admin adjustment grants

Historical rollout documents planned a 25-internal-beat migration grant and 90-day temporary Studio entitlement. No automatic materialization flow was found.

These controls should not be treated as implemented launch safeguards.

## 6. How coin spending works

### 6.1 Authorization

Every integrated billable action calls the server pricing service with:

- authenticated user
- action key
- idempotency key
- related story/node/storyline identifiers
- optional metadata
- optional calculated cost override

The service then:

1. loads the active action cost
2. uses a dynamic override when supplied
3. resolves the user's current plan and wallet
4. creates the Free allowance if the rollout mode requires it
5. applies admin bypass
6. allows zero-cost actions
7. allows without spend in soft mode
8. logs a would-allow/would-deny result in shadow mode
9. checks balance and atomically creates a reservation in hard mode

### 6.2 Reservation and settlement

Hard mode reserves coins before generation. The reservation defaults to a 30-minute expiry.

After the action:

- success finalizes the reservation
- failure releases it
- stale pending reservations can expire

Finalization atomically:

- creates a `beat_usage_events` row
- consumes one or more grant buckets
- creates `beat_usage_allocations`
- marks the reservation finalized

### 6.3 Spend priority

Grant consumption order is:

1. promotion
2. subscription-like balances:
   - subscription
   - carry-forward
   - admin adjustment
   - migration grant
   - Free allowance
3. top-up

Within a priority class, the earliest-expiring grant is used first, followed by grant date.

This correctly protects non-expiring purchased top-ups.

### 6.4 Concurrency and idempotency

The database RPC locks spendable grants and active reservations before deciding availability. Concurrent actions cannot spend the same balance twice.

Finalization is idempotent after a reservation has already finalized.

One semantic defect remains in authorization replay: if an idempotency key already exists, the RPC returns the old reservation status and reports the requested amount as `available_beats`. The application only accepts an existing `pending` status. A replay after finalization is therefore returned as a denial instead of a successful idempotent result.

Most current call sites use UUIDs or timestamps, so this is not the largest launch risk, but the contract should be corrected before clients intentionally retry the same request.

## 7. Complete user-action coin matrix

All figures below are user-facing coins. “Production effective” assumes hard enforcement is enabled and the current production Gemini image model remains selected at 5 coins per output image.

### 7.1 Story and reel creation

| User action | Catalog/formula | Production effective | Current integration |
|---|---|---:|---|
| Start a generated-image story | prompt base 5 + selected image model × 1 | 10 | Reserved before generation; finalized on success; released on failure |
| Start a prompt-only story | fixed prompt-only base | 5 | Reserved/finalized/released |
| Start a generated reel | prompt base 15 + selected image model × reel beat count | `15 + 5N` | Reserved for the complete reel; finalized/released |
| Start a prompt-only reel | fixed prompt-only base | 15 | Reserved/finalized/released |
| Generate a genuinely new story branch beat | prompt base 5 + selected image model × 1 | 10 | Reserved/finalized/released |
| Generate a new prompt-only branch beat | fixed prompt-only base | 5 | Reserved/finalized/released |
| Reopen an already explored branch | No generation | 0 | Explicitly free |
| Automated story continuation | Same new-beat rule on every generated beat | 10 per generated image beat | Each newly generated beat is charged separately |

For the default two-beat reel, the current effective start price is:

```text
15 + (5 × 2) = 25 coins
```

Character portraits and character sheets generated as part of story continuity do not add a separate wallet charge, even though they create provider cost.

### 7.2 Seeded-authoring actions

| User action | Production effective | Current integration |
|---|---:|---|
| Preview a seed plan | 5 | Reserved before preview; finalized on success; released on failure |
| Materialize the confirmed seeded path | Charged through normal story-start/new-beat actions | Integrated through story flow |

### 7.3 Image actions

| User action | Catalog/formula | Production effective | Current integration |
|---|---|---:|---|
| Regenerate one generated image | selected image model only | 5 | Reserved/finalized/released |
| Prompt-only image recovery/upload | No generated image authorization | 0 | Free |
| Background provider batch | selected model × image count × 50% | `2.5N` | Reserved for all requested images |
| Fast stateful bulk visuals | selected model × image count | `5N` | Reserved for all requested images |
| Generate character portraits/sheets inside story flow | Bundled, no separate action | 0 extra | Provider cost only |

Important discrepancy: `pricing_action_costs` says `regenerate_image = 10 coins`, but the image-aware authorization deliberately replaces that with the selected model's per-image cost. With the current production model, the actual debit is 5 coins.

`batch_image_generation` exists in the TypeScript action-key list and is used with a dynamic override, but it has no active production `pricing_action_costs` row. It therefore does not appear as a normal configurable action in Pricing Studio, even though hard mode will still charge the dynamic amount.

Bulk settlement currently charges the entire reserved amount if at least one image succeeds. If a 20-image job produces one image and 19 failures, all 20 requested images are charged. Only a zero-success job receives a full release.

### 7.4 Narration and audio

| User action | Catalog price | Actual wallet debit | Provider cost |
|---|---:|---:|---|
| Initial narration generated for a beat | No separate action debit | 0 extra | Yes |
| Regenerate narration for a beat | 10 | 0 | Yes |
| Reel narration preview | No action row | 0 | Yes |
| Full/custom reel voice preview | No action row | 0 | Yes |
| ElevenLabs forced alignment for story text overlay | No user action row | 0 | Yes |
| Legacy AI voice selection when enabled | No separate action row | 0 | Yes |

`regenerate_narration` is present in the catalog, UI runtime defaults, activity labels, and vendor-cost telemetry, but no call to coin authorization exists in the narration generation flow.

Narration preview storage is capped, but generation calls are not protected by a wallet debit or an application-level user rate limit. Provider rate-limit errors are handled, but that protects the provider endpoint, not Kissago's spend.

This is one of the highest-priority cost-control gaps.

### 7.5 Covers and thumbnails

| User action | Production effective | Current integration |
|---|---:|---|
| Generate social share cover | 10 | Reserved/finalized/released |
| Generate audio-story cover | 10 | Reserved/finalized/released |
| Generate reel thumbnail | 10 | Reserved/finalized/released |

These use the fixed action cost even when the user-selected image model changes. They do not use the image-aware pricing formula.

### 7.6 Video export

| User action | Production effective | Current integration |
|---|---:|---|
| Successful video export | 20 | Reserved before browser rendering; finalized after success |
| Failed/cancelled export | 0 final debit | Reservation released |
| Admin-bypass export | 0 | Billing skipped |

Export is mostly client-side computation over already-created assets. It has little direct AI-provider cost, though storage reads, bandwidth, and infrastructure still have a cost. Charging coins for it is a product policy, not provider-cost recovery in the same sense as image or narration generation.

### 7.7 Reference personalization

The production master switch is currently off, so none of these are available to users now.

| User action | Production effective | Current integration |
|---|---:|---|
| Analyze one direct prompt-only reference | 5 per reference | Idempotent per source; finalizes on successful analysis; releases on failure |
| Adopt a character reference | 15 | Reserved; background job finalizes/releases |
| Analyze/adopt a world description | 5 | Reserved; background job finalizes/releases |
| Add canonical world visualization | +10 | Separate reservation; background job finalizes/releases |
| World description plus canonical visual | 15 total | Two independently tracked reservations |
| Retry a failed adoption | Same price on eventual success | Fresh reservation because prior failure was released |

### 7.8 Actions that currently do not spend coins

No wallet debit was found for:

- opening or replaying an explored branch
- normal story playback
- normal narration playback
- narration generation/regeneration and previews
- publishing a story or reel
- hosted sharing
- saving or editing story metadata
- uploading prompt-only images
- uploading manual character sheets
- likes and other social interactions
- selecting visual effects or transitions
- selecting a reel visual style
- selecting narration language, voice, or accent
- creating or editing narration presets
- creating a Story Bible / episode continuity summary
- storage retention and HQ retrieval themselves

Some of these generate real provider or storage cost and need an explicit “bundled, tier-limited, coin-metered, or rate-limited” decision.

## 8. What incurs real platform cost

### 8.1 Gemini text generation

Cost telemetry covers tasks such as:

- story beat generation
- reel draft generation
- seed-plan generation
- seeded beat materialization
- Story Bible generation
- visual prompt composition
- reference analysis
- legacy voice selection

The current code's default text model is Gemini 3.5 Flash, with configured estimates of:

- $1.50 per million input tokens
- $9.00 per million output tokens

These are code-configured estimates, not a live provider invoice.

### 8.2 Image generation

Current production default:

- Gemini Flash Image
- 5 user coins per output image
- estimated provider cost $0.067 per 1K output image
- available to Free, Plus, and Studio

Disabled production alternatives:

- OpenAI GPT Image 2: $0.041 estimated output, Studio only, currently 0 configured coins
- xAI Grok Imagine Quality: $0.05 output plus $0.01 per input image, Studio only, currently 0 configured coins

The zero coin prices are harmless while those models are disabled, but they become a loss-control defect if an admin enables them without first setting prices.

Portrait models currently have zero user coin cost. Enabled portrait generation can still cost:

- Gemini: $0.067 per output
- OpenAI: $0.041 per output
- xAI: $0.05 output plus input-image cost

### 8.3 Narration

Gemini TTS has token-based cost telemetry.

ElevenLabs defaults are estimated at:

- Multilingual v2: $0.22 per 1,000 characters
- Flash v2.5: $0.11 per 1,000 characters
- v3: $0.22 per 1,000 characters
- forced alignment: $0.22 per audio hour

Because narration is not currently coin-metered, these costs are absorbed by the platform.

### 8.4 Storage, media, and bandwidth

The provider-cost ledger does not include:

- R2/Supabase object storage
- image/audio/video delivery bandwidth
- signed-URL operations
- database storage and queries
- cleanup jobs
- browser export CPU
- payment-provider fees
- support, refunds, or chargebacks

The coin economy should not be calibrated solely from `ai_cost_events`.

### 8.5 Batch cost reporting caveat

Batch image generation charges the user 50% of the interactive image coin price and records the provider's discounted estimate in metadata.

However, `ai_cost_events.estimated_cost_usd` is intentionally populated with the full regular-price comparison amount, not the discounted expected provider spend. A cost dashboard that simply sums `estimated_cost_usd` will overstate expected batch cash cost.

The dashboard needs separate fields or metrics for:

- actual/discounted expected provider cost
- regular interactive equivalent
- customer coin charge
- savings

## 9. Unit economics warning

For ROW monthly plans, the included-coin revenue equivalent is:

- Plus: $12 / 1,000 = $0.012 per coin
- Studio: $29 / 3,000 = about $0.00967 per coin

A 5-coin Gemini image therefore corresponds to:

- Plus: $0.060 of plan revenue
- Studio: about $0.048 of plan revenue

The configured provider estimate is $0.067 before:

- story text generation
- visual-prompt generation
- portraits
- narration
- alignment
- storage and delivery

Image regeneration is particularly exposed because it charges only 5 coins and directly incurs the $0.067 image estimate.

A normal generated story beat costs 10 coins, so it provides more room:

- Plus: $0.12 revenue-equivalent
- Studio: about $0.0967 revenue-equivalent

But that beat can include image, text, prompt composition, narration, and portraits. The Studio margin can still be thin if a user consumes the full allowance.

Annual economics are undefined until monthly refill behavior exists. The architecture promises monthly grants on annual plans, but there is no Stripe implementation or monthly refill scheduler.

Free subsidy also needs a bound:

- India Free 50 coins can fund up to ten 5-coin image regenerations, or about $0.67 of configured image cost
- ROW Free 120 coins can fund up to twenty-four such regenerations, or about $1.61 of configured image cost

This excludes text, narration, portraits, storage, and failed/retried provider calls.

Recommendation: build an action-level contribution-margin dashboard using both wallet usage and provider-cost events before finalizing allowance sizes.

## 10. Tier-gate audit

### 10.1 Gate-strength definitions

- **Strong**: the server resolves the authenticated user's plan and rejects or downgrades the request.
- **Hybrid**: part of the decision is server-side, but the valuable operation is still client-triggered or another gate is UI-only.
- **Weak**: the browser hides/locks controls or sends a plan-shaped setting, but the server does not independently enforce the entitlement.

### 10.2 Feature matrix

| Feature | Intended/configured tiers | Enforcement | Finding |
|---|---|---|---|
| Monthly coin allocation | Per plan/market | Strong when active | Production snapshot is off, so Free grants are not active |
| Coin balance on spend | All signed-in users | Strong | Atomic database reservation/finalization |
| Story-length cap | IN 4/6/10, ROW 4/8/8 | Weak | UI-only flag is off in production; server normalization only clamps globally to 3-8 |
| Free Standard export | Free/Plus/Studio | Hybrid/blocked | Parent UI incorrectly requires pricing snapshot; production Free is locked |
| HD export | Plus/Studio | Hybrid | Preset availability is server-resolved, but export operation is client-side |
| Download entitlement | All tiers in current production | Weak | Parent UI gate; no centralized server feature authorization |
| Unbranded export | Plus/Studio | Weak | Watermark choice is client-side |
| Creator setup controls | Studio | Weak | Visibility is UI-derived from plan snapshot |
| Compact character sheets | Free/Plus when global flag on | Weak | Story config is client-authored; current flag is on |
| 1K creator character sheets | Studio when creator-sheet flag on | Weak | UI-only; current creator-sheet flag is absent/off |
| Manual character-sheet gallery | Global upload controls | Weak | Server checks ownership, but accepts a client-supplied cap and does not enforce plan |
| Interactive image model access | Registry-defined | Strong | Server re-resolves enabled/configured/allowed model |
| Batch/stateful image model access | Registry-defined | Incorrect | Both bulk paths hardcode plan as Free |
| HQ original download/publishing | Plus/Studio when media settings allow | Strong | Server checks auth, ownership, current plan, and HQ setting |
| Original-image retention | Free/Plus/Studio durations | Strong | Plan is resolved at persistence and expiry is stamped |
| Reel retention | 30/90/180 days | Strong at persistence | Separate policy from normal original-image retention |
| Reference personalization | Tier matrix plus master flag | Strong | Server re-resolves plan, limits, mode, ownership; currently globally off |
| Reel visual styles | `min_plan` per style | Weak | Cards lock in UI, but runtime returns every published style and generation accepts selected id |
| Reel narration languages/voices | Per-tier settings | Weak | UI filters; save/preview/generation do not independently enforce tier |
| Standard-story narration accents | Accent tier map | Stronger | Server resolves plan and allowed accents, but production tier-map flag is off |
| Story/reel publishing | Global flags | Not plan-tiered | Reel and audio publishing are currently off |
| Hosted sharing | Free and above | General auth/ownership rules | Intentionally free |

## 11. Detailed tier findings

### 11.1 Story-length controls are not release-ready

Production catalog:

- India Free 4
- India Plus 6
- India Studio 10
- ROW Free 4
- ROW Plus 8
- ROW Studio 8

Production `pricing_story_length_ui_limits_enabled` is off, so normal setup uses the generic range.

Even if it is enabled, the server-side `normalizeStoryConfig` function clamps every non-reel story to a global maximum of 8. Consequences:

- a Free client can submit up to 8 if it bypasses the tier UI
- an India Plus client can submit up to 8 instead of 6
- India Studio can never receive its advertised 10-beat cap

Required fix: enforce `min(requested length, authenticated plan cap, global technical maximum)` on the server at story creation, continuation/automation, seeded materialization, and episode continuation.

### 11.2 Current Studio character-sheet configuration is worse than Free/Plus

Production has:

- `character_sheet_enabled_free_plus = true`
- `creatorControls = true` for Studio
- no enabled `character_sheet_enabled_creator` row

Landing behavior is:

- non-creator Free/Plus users get a 0.5K character sheet when the Free/Plus flag is on
- Studio only gets the character-sheet path when the creator flag is on
- otherwise Studio falls back to a single portrait

Thus the current production configuration gives Free/Plus compact sheets while Studio gets a single portrait. This contradicts “Everything in Plus” and should be corrected before selling Studio.

### 11.3 Bulk image generation ignores paid plan eligibility

Both background batch and stateful bulk actions call the image-model resolver with:

```text
currentPlanKey: 'free'
```

This means:

- Studio-only selected models cannot be honored
- bulk jobs silently fall back to a Free-eligible model
- the user may be quoted/charged using a different model than expected
- future paid-model differentiation will break in bulk modes

The worker should resolve the authenticated owner's current plan or a signed plan/model snapshot created at submission.

### 11.4 Reel style gating is visual only

The card builder marks a style locked using `min_plan`, but the runtime action returns every published style without filtering. Story generation searches that unfiltered list by client-supplied style id.

All current production published styles are Free, so there is no present loss. Any future Plus/Studio style will be bypassable until the server validates it.

### 11.5 Reel narration fallback can broaden access

The UI filters language and voice presets by tier. If no matching tier-specific voice preset is found, `getReelNarrationVoiceOptions` falls back to the broad gender or global voice list.

The save and preview server actions normalize the supplied settings but do not re-resolve the user's plan and tier-allowed language/voice.

Required fix: one server resolver should validate language, voice, model, provider, expressive options, and preview scope for the current plan before every preview, save, and final generation.

### 11.6 Manual character-sheet caps are client-supplied

The server verifies that the story belongs to the user, but the upload payload includes its own `cap`, and the server checks gallery length against that supplied value.

A modified client can increase the cap. The server also does not verify the plan's creator/character-sheet entitlement for this tool.

The server must load cap and entitlement from trusted settings.

## 12. Free-tier export failure

### 12.1 Current production configuration

All of the intended Free export ingredients are on:

- `video_download_enabled = true`
- Free `canAccessDownloads = true`
- Standard 720×1280 preset allows `free`, `plus`, and `studio`
- Free is branded because `canAccessUnbrandedExports = false`

But:

- `pricing_snapshot_enabled = false`

### 12.2 Exact failing condition

Both export entry points calculate access as:

```text
admin bypass
OR
(pricing snapshot enabled AND plan can access downloads)
```

Relevant locations:

- `components/story/StoryScreen.tsx:2965-2975`
- `components/story/StorylinePlayer.tsx:199-209`

For a normal Free user in production:

```text
false OR (false AND true) = false
```

The admin can appear unaffected because admin video-download bypass is enabled and does not depend on the pricing snapshot.

### 12.3 Misleading lock copy

When a storyline has images but any entitlement gate fails, the button says:

```text
Video export — available on Plus and above
```

That is no longer true because the Free plan is configured for Standard export.

The UI does not distinguish:

- global feature disabled
- pricing rollout not active
- plan not entitled
- only HD locked
- assets not ready

### 12.4 Preset gate cannot repair the parent gate

The export-preset action correctly resolves the authenticated plan server-side:

- Standard: Free/Plus/Studio
- HD: Plus/Studio
- Ultra Smooth: disabled/admin-only

However, the dialog is never opened when the parent button fails. Making Standard available to Free cannot overcome the parent snapshot dependency.

### 12.5 Export coin copy uses the wrong unit

The dialog receives:

```text
pricing.actionCosts.export_video_future
```

That value is in internal beats. The live value is 2, which equals 20 coins.

The dialog displays:

```text
Exporting costs 2 beats.
```

This violates the coin-only UX contract and hides the actual 20-coin price.

Relevant locations:

- `components/story/StoryScreen.tsx:7940-7947`
- `components/story/StorylinePlayer.tsx:1050-1054`
- `components/story/VideoExportDialog.tsx:126-130`

### 12.6 Watermark policy can contradict plan entitlement

`watermarkMode = hidden` always hides the watermark, even if `canAccessUnbrandedExports` is false.

An admin can therefore configure a Free plan with:

- unbranded entitlement false
- preset watermark hidden

and the hidden mode wins.

The system should either reject contradictory configuration or make unbranded entitlement authoritative.

### 12.7 Recommended export policy

Short-term fix:

1. Decide whether turning on production pricing snapshot is acceptable now, knowing it will begin creating Free allowance grants.
2. If it is acceptable, enable snapshot before relying on plan entitlements.
3. If it is not acceptable, remove the generic pricing-snapshot dependency from download access and use a download-specific rollout control.
4. Update lock reasons and display 20 coins, not 2 beats.

Release-grade fix:

- central server `authorizeFeatureUse('video_export', presetId)` decision
- plan, preset, watermark, and global switch resolved together
- a signed or short-lived export authorization returned to the client
- coin quote returned by the same policy service
- Standard Free export branded
- HD Plus/Studio
- unbranded only when plan entitlement is true

Because rendering is client-side, a determined user can always reuse loaded assets. The goal is consistent product enforcement and accounting, not DRM.

## 13. User-visible pricing mismatches

### 13.1 Continue-story quote is not model-aware

The “new path uses X coins” hint uses the fixed action-cost row. The wallet authorization uses:

```text
prompt-only base + selected image model price
```

With current production Gemini, both happen to equal 10 coins. In staging, OpenAI/xAI can cost 10 coins per image, making the actual continuation price 15 while the UI still says 10.

### 13.2 Regenerate-image catalog is not the actual price

Pricing Studio shows 10 coins. Current effective price is 5 because the model registry overrides the row.

### 13.3 Export displays internal beats

Live price: 20 coins. Dialog copy: 2 beats.

### 13.4 Default runtime export price is stale

The browser provider's fallback context uses `export_video_future = 5` internal beats, while production is 2. Before the background refresh completes, UI can briefly reason from 50 coins rather than 20.

### 13.5 Wallet plan comparison does not reflect live entitlements

The plan-card copy is mostly hardcoded:

- Free and Plus do not mention downloads even though both have them
- Plus does not mention unbranded export even though it has it
- Studio copy can imply creator character sheets even when the creator flag is off

Plan comparison should be generated from an explicit benefit catalog, not plan-name branches.

### 13.6 Recent activity lacks names for new actions

Recent wallet activity has friendly labels for the older story, reel, cover, narration, and export actions.

It does not have dedicated labels for:

- reference analysis/adoption
- world visualization
- batch/stateful image generation

These appear as the generic “Used coins in Kissago.”

## 14. Environment drift

Staging and production are not exercising the same economy.

### 14.1 Rollout controls

Staging currently has snapshot, checkout, shadow, hard enforcement, story-length UI, and admin bypass all on. Production has all of them off.

When hard enforcement is on, the code takes the hard path and does not also log the shadow branch. Having both hard and shadow on does not provide parallel shadow telemetry.

### 14.2 Image models

Production:

- Gemini story/reel model is the only enabled visible user option
- 5 coins per image
- Free/Plus/Studio
- OpenAI/xAI story and reel options disabled

Staging:

- Gemini, OpenAI, and xAI story models are visible to all tiers
- OpenAI and xAI story models cost 10 coins
- Reel OpenAI is the default at 10 coins
- Reel xAI is visible to all tiers at 0 coins

The zero-coin visible xAI reel path is a staging loss-control defect and prevents staging from being a faithful rehearsal of production tier/model policy.

Before release, promote a versioned pricing configuration or use an environment-diff check that covers:

- rollout flags
- plan versions and plan features
- action costs
- image models and coin costs
- export presets
- reference matrix
- media/HQ settings
- narration tier settings

## 15. Billing and subscription gaps

### 15.1 ROW checkout is not implemented

ROW plans are configured for Stripe, but all checkout code loads only published Razorpay records.

Current UI explicitly says Stripe comes later. If the platform is publicly available outside India, paid conversion is unavailable there.

### 15.2 Annual monthly refills are not implemented

The architecture says annual plans must grant the monthly included coins every month.

There is:

- no Stripe subscription implementation
- no monthly refill scheduler for annual plans
- no annual Razorpay checkout; it is intentionally blocked

The `monthly_included_beats` field cannot be treated as an annual entitlement implementation by itself.

### 15.3 No self-service subscription management

The application does not currently support:

- cancellation
- plan switching
- immediate upgrade/proration
- downgrade scheduling
- refund management
- invoice history

Overlapping Razorpay subscriptions are blocked and users are directed to manual support.

This is documented honestly in the managed pages, but it is an operational burden for public launch.

### 15.4 Grace entitlement versus wallet refill

Pending/halted users can remain on a paid plan during configured grace if `grace_period_ends_at` is in the future.

Their prior subscription grant expires at provider period end, and the sync path does not issue a new grant for pending/halted status.

This produces a possible grace state with paid features but no fresh subscription coins. That may be intended, but it needs product copy and tests.

## 16. Historical policy drift requiring a new freeze

The historical documents are internally consistent for an earlier version, but the live product has changed.

| Topic | Historical intent | Current implementation/config |
|---|---|---|
| Public wallet word | Older strategy says beats; later UI spec says coins | Code uses coins publicly; one export dialog still leaks beats |
| Free downloads | Explicitly excluded | Production Free downloads are enabled |
| Initial hard-metered actions | Story start and new continuation only | Export, covers, image regeneration, references, batch/stateful are integrated too |
| Image recovery | Free in first rollout | Generated-image regeneration is dynamically charged |
| Narration recovery | Free in first rollout | Still free, despite a 10-coin catalog row |
| Carry-forward | Monthly, capped at 2× | No grant creation or rollover |
| Annual plans | Monthly coin grants | No operational implementation |
| Migration grant | Planned for existing users | Not materialized |
| Tester Studio | Planned temporary entitlement | Not materialized |
| Export price | Suggested 30-50 coins | Production is 20 coins |
| ROW top-ups | Earlier baseline packs | None published now |

Before launch, create a one-page policy freeze that supersedes the older documents. Code, admin defaults, wallet copy, terms, and QA expectations should all point to that policy.

## 17. Prioritized release findings

### P0: must resolve before hard enforcement/public billing

1. **Production economy is dormant**
   - No grants or spends; all rollout controls off.
2. **Free export is blocked by the pricing-snapshot dependency**
   - Exact reported bug.
3. **Story caps are not server-enforced**
   - Free/Plus can exceed tier caps; India Studio cannot receive 10 beats.
4. **Narration has uncontrolled provider cost**
   - Catalog row exists, but regeneration/previews do not spend coins or have a user rate limit.
5. **Carry-forward and annual monthly refills are promised architecture but absent**
   - Must implement or remove from public promises.
6. **ROW monetization is unavailable**
   - Stripe is not implemented.
7. **Quotes can differ from actual debit**
   - Export unit error; dynamic model prices not consistently reflected.
8. **Tier enforcement is not centralized**
   - Several high-value features depend on client UI state.

### P1: fix before broad feature expansion

1. Bulk image actions hardcode Free plan.
2. Partial bulk jobs charge the full request.
3. Studio character-sheet configuration currently regresses below Free/Plus.
4. Reel style and reel narration tier gates are bypassable.
5. Manual character-sheet caps are client-supplied.
6. Watermark hidden mode can override unbranded entitlement.
7. Promotions, migration grants, tester entitlement, and carry-forward controls are inert.
8. Provider models can be enabled with zero coin cost.
9. Pricing changes can remain visible from a browser's cached snapshot until refresh.
10. Recent activity and marketing copy lag current actions/benefits.

### P2: operational hardening

1. Correct authorization idempotency replay semantics.
2. Separate actual batch provider cost from regular-price comparison in analytics.
3. Add durable post-success settlement/reconciliation when client finalization fails.
4. Add self-service subscription management.
5. Add config promotion/diff tooling between staging and production.
6. Add rate limits and abuse controls independently of coin balance.

## 18. Recommended target model

### 18.1 Use tiers for rights and coins for variable consumption

A simple public rule:

- plan controls maximum story length, export quality/branding, creator tools, model access, retention, and reference capabilities
- coins control variable generative consumption
- top-ups add consumption only and never unlock rights

### 18.2 Meter expensive generation, not local operations

Recommended default:

- charge story/reel generation through base text cost plus per-image price
- charge image regeneration and reference visualization
- charge all successful narration/TTS generation, regeneration, and previews that call a provider
- charge text/audio alignment and separately charge any future STT transcription
- charge every successful browser video export
- keep saves, playback, hosted sharing, edits, and already-generated branch replay free
- treat export quality as a tier right: SD for Free, SD and HD for Plus/Studio
- explain export as a metered processing action and return one authoritative quote before rendering

### 18.3 Make the quote service authoritative

Add a server quote/authorization layer that returns:

- action key
- current plan
- allowed/locked reason
- fixed base coins
- selected model coins
- image/reference/beat count
- discounts
- final coin total
- expected watermark/preset
- quote version or expiry

The UI and spend reservation must consume the same quote calculation.

This should be one internal server-side `CoinEconomyService`, not one AI vendor and not the existing browser `PricingRuntimeProvider`. Gemini, ElevenLabs, OpenAI, and other generation providers can remain independent. No provider-facing action should read a price directly or call wallet RPCs directly.

The service should expose a small workflow:

```text
quoteOperation(input)
authorizeOperation(quote, idempotencyKey)
markComponentSucceeded(reservation, component, actualUnits)
markComponentFailed(reservation, component)
finalizeOperation(reservation)
releaseOperation(reservation)
```

For composite actions, authorize one parent reservation for the maximum quoted total, keep component line items, debit only successful components, and release the unused amount. This gives the user one understandable total while preserving text, image, TTS, alignment/STT, and export cost individually.

Suggested meter taxonomy:

| Cost family | Initial meter keys |
|---|---|
| Text | `text.story_beat`, `text.reel_beat`, `text.seed_plan`, `text.reference_analysis`, `text.story_bible` |
| Image | `image.story_output`, `image.reel_output`, `image.regeneration`, `image.cover`, `image.portrait`, `image.reference_visual`, `image.batch_output` |
| TTS | `tts.story_narration`, `tts.reel_narration`, `tts.regeneration`, `tts.preview` |
| Alignment/STT | `alignment.text_audio`, with `stt.transcription` reserved for actual transcription |
| Export | `export.video_sd`, `export.video_hd` |

The service should resolve three separate concerns:

1. Entitlement: may this plan use this feature or quality?
2. Coin rate: how many coins must this user authorize?
3. Provider cost: what did the underlying vendor operation cost Kissago?

These can appear together in one admin workspace, but they must remain distinct fields. This prevents a low coin price from accidentally unlocking a feature and lets finance compare collected coins with actual vendor cost.

### 18.4 Make feature decisions authoritative

Add one server entitlement policy with typed capabilities such as:

- `story.max_beats`
- `export.standard`
- `export.hd`
- `export.unbranded`
- `creator.character_sheet_1k`
- `media.hq`
- `image_model.<key>`
- `reference.character`
- `reference.world`
- `reel_style.<id>`
- `narration.voice.<id>`

Every server mutation/generation should query this policy. Browser locks should render its decision rather than reimplementing the rule.

The initial beta entitlement matrix should be:

| Capability | Free | Plus | Studio | Coin behavior |
|---|---|---|---|---|
| Text generation | Allowed | Allowed | Allowed | Always metered |
| Image generation | Disabled by default via admin toggle | Allowed | Allowed | Meter each successful image |
| External image upload/import | Allowed | Allowed | Allowed | No generation charge |
| TTS narration | Allowed when the tier capability is enabled | Allowed | Allowed | Always metered; no complimentary provider call |
| Text/audio alignment | Allowed when the tier capability is enabled | Allowed | Allowed | Always metered |
| Video export SD | Allowed | Allowed | Allowed | Always metered |
| Video export HD | Locked | Allowed | Allowed | Always metered |

The Free image-generation switch must cover story and reel generation, regeneration, cover generation, portraits/character sheets, reference visualization, bulk jobs, and stateful jobs. When it is off, the server must reject image-generation requests or force an explicitly supported prompt-only flow. Hiding buttons in the browser is insufficient.

### 18.5 Price models from margin targets

For each dynamic image/narration option, set:

```text
coin price >= provider cost + expected text/prompt/portrait/storage cost + failure allowance + margin
```

Do not enable a model whose price is zero unless it is intentionally free and budget-limited.

### 18.6 Central admin control

Create one “Metering and entitlements” admin view backed by authoritative server data. Each row should show:

- meter/event key and billing unit
- user-facing coin price
- enabled/disabled globally
- enabled/disabled for Free, Plus, and Studio
- optional provider/model override
- estimated or measured provider cost
- effective date/version

Suggested persistence:

- `pricing_meter_rates`: authoritative base and model-specific coin rates
- `pricing_plan_meter_entitlements`: per-plan access and limits
- `beat_spend_reservation_components`: quoted/reserved line items
- `beat_usage_event_components`: finalized component usage and provider-cost telemetry

Existing `pricing_action_costs` and the image-model registry should be migrated into this model or made read-only compatibility views. A CI/static check should prevent generation actions from bypassing `CoinEconomyService`.

## 19. Suggested implementation sequence

### Phase 1: policy freeze

Decide and document:

- launch market: India-only for beta
- Free/Plus/Studio monthly coins
- Free SD export branding policy
- SD and HD export coin rates; every export is charged
- story caps
- image-regeneration price
- text, image, TTS, alignment/STT, and export meter rates
- whether TTS preview is a paid provider call or a non-provider sample asset
- carry-forward policy
- annual refill policy
- migration treatment for existing users
- grace-period coin behavior

### Phase 2: correctness fixes

1. Introduce the server-side coin-economy gateway and component ledger.
2. Add the admin meter-rate and tier-entitlement matrix.
3. Enforce the Free image-generation switch on every server image path.
4. Decouple entitled Free SD export from the generic pricing-snapshot lock.
5. Replace stale export copy with the authoritative SD/HD quote.
6. Meter TTS generation, regeneration, and provider-backed previews.
7. Meter text/audio alignment and reserve a separate key for future true STT.
8. Enforce story cap server-side and raise the global technical max if Studio 10 remains.
9. Migrate text and image actions to centralized dynamic quotes.
10. Resolve bulk image plan from the authenticated owner.
11. Settle partial bulk jobs by successful component.
12. Make watermark entitlement authoritative.
13. Move character-sheet cap and entitlement checks to the server.
14. Enforce reel style and narration tier selection on the server.

### Phase 3: wallet and billing completion

1. Implement renewal-time carry-forward or explicitly disable it everywhere.
2. Implement existing-user migration grants if still required.
3. Implement tester entitlement if still required.
4. Implement promotion application or hide the promotion workspace.
5. Hide or disable ROW paid checkout and offers for the India-only beta.
6. Implement annual monthly refill before selling annual plans.
7. Add billing support workflows and reconciliation alerts.

### Phase 4: staged activation

Recommended production sequence:

1. snapshot on, checkout off, hard off
2. confirm Free grants and plan/cap rendering
3. shadow on, hard off
4. compare would-charge events with provider costs and expected UX
5. checkout on for the chosen launch market
6. verify real top-up and subscription grants
7. hard enforcement on for a limited action set
8. expand action set only after failure/refund/retry evidence is clean

Do not rely on having shadow and hard enabled simultaneously; the current hard path bypasses shadow logging.

## 20. Required test matrix

For every metered action:

- signed out
- signed in with zero balance
- balance below cost
- balance exactly equal to cost
- balance above cost
- admin with bypass off
- admin with bypass on
- soft mode
- shadow mode
- hard mode
- provider success
- provider failure
- client cancellation
- finalization failure
- duplicate request/idempotency replay
- concurrent requests using the same wallet

For each tier and market:

- monthly allowance amount
- story cap
- Standard/HD export
- watermark
- creator character sheets
- image-model choices
- HQ media
- retention
- references
- reel styles
- narration language/voice/accent

Billing-cycle tests:

- first Free grant
- Free monthly rollover
- monthly subscription activation
- webhook replay
- top-up verify/webhook race
- paid renewal
- failed renewal/grace
- cancellation at period end
- paid-to-Free downgrade
- carry-forward cap
- top-ups retained after downgrade
- annual monthly refill

Bulk tests:

- all success
- partial success
- zero success
- job expiry
- worker retry
- plan/model change after submission

Export tests:

- Free branded Standard
- Free HD locked with correct reason
- Plus/Studio HD
- SD/HD displayed quote equals the reservation and final usage event
- every successful Free export is charged
- unbranded entitlement
- snapshot rollout states
- missing beat image
- failed/cancelled export reservation release
- displayed quote equals usage event

## 21. Release acceptance criteria

The coin economy is ready for public release when:

1. one written policy freeze matches production configuration
2. every visible price is returned by the same calculation used for reservation
3. no user-facing surface uses internal `beat` wallet terminology
4. every paid-tier mutation has a server-side entitlement decision
5. every vendor-costly repeatable action is coin-metered, rate-limited, or explicitly bundled
6. Free, Plus, and Studio story caps pass server-side tampering tests
7. Free SD export works end to end, applies the chosen branding rule, and consumes the configured coins
8. failed actions reliably release reservations
9. partial actions debit according to documented policy
10. carry-forward and annual refills either work or are removed from offers/copy
11. the chosen launch market has working checkout, webhook idempotency, and support recovery
12. wallet usage and provider-cost dashboards reconcile at action level
13. staging pricing configuration matches the production candidate
14. shadow data has been reviewed before hard enforcement is enabled

## 22. Immediate decision checklist

The following decisions unblock the next implementation pass:

- [x] The first beta launch is India-only.
- [ ] Should Free receive 50 coins in India and 120 in ROW?
- [x] Free can export SD; HD is limited to Plus and Studio.
- [ ] Should Free SD export be branded?
- [x] Every successful browser video export consumes coins.
- [ ] What should SD and HD export cost?
- [x] Free image generation is off by default and controlled by an admin entitlement toggle.
- [ ] Should image regeneration cost the model price (currently 5) or the catalog price (10)?
- [x] TTS is not complimentary on any tier and every provider-backed TTS action must be metered.
- [ ] What should narration generation, regeneration, and preview cost?
- [ ] What should text/audio alignment cost?
- [ ] Is carry-forward part of launch?
- [ ] Are annual ROW plans hidden until monthly refill exists?
- [ ] Should India Studio support 10 beats, requiring the global server max to increase?
- [ ] Should Free/Plus compact character sheets and Studio 1K sheets both be on?
- [ ] Which actions are included in the first hard-enforced set?

Once these are frozen, the technical work is straightforward: consolidate policy, repair the mismatches above, run shadow metering, and activate in controlled stages.

## Appendix A: Exact pricing action-key inventory

This appendix maps every action key currently declared in `PRICING_ACTION_KEYS`. Catalog values are the active production rows observed during this audit.

| Action key | Production catalog | Effective user charge if hard mode is on | Status |
|---|---:|---:|---|
| `start_story_initial_beat` | 1 beat / 10 coins | Prompt-only base plus selected model; currently 10 coins | Integrated |
| `start_story_initial_beat_prompt_only` | 0.5 beat / 5 coins | 5 coins | Integrated |
| `start_reel_full_generation` | 3 beats / 30 coins | 15 base coins plus selected model coins × reel beats; currently `15 + 5N` | Integrated; catalog row is not authoritative |
| `start_reel_full_generation_prompt_only` | 1.5 beats / 15 coins | 15 coins | Integrated |
| `continue_story_new_beat` | 1 beat / 10 coins | Prompt-only base plus selected model; currently 10 coins | Integrated for a new branch only |
| `continue_story_new_beat_prompt_only` | 0.5 beat / 5 coins | 5 coins | Integrated for a new branch only |
| `preview_seed_plan` | 0.5 beat / 5 coins | 5 coins | Integrated |
| `regenerate_image` | 1 beat / 10 coins | Selected model only; currently 5 coins | Integrated; catalog row is not authoritative |
| `regenerate_narration` | 1 beat / 10 coins | 0 coins | Cataloged but not authorized or spent |
| `generate_social_share_cover` | 1 beat / 10 coins | 10 coins | Integrated |
| `generate_audio_story_cover` | 1 beat / 10 coins | 10 coins | Integrated |
| `generate_reel_thumbnail` | 1 beat / 10 coins | 10 coins | Integrated |
| `batch_image_generation` | No active production row | Batch: `2.5N`; stateful: `5N` with current model | Integrated through a dynamic override; missing from normal catalog management |
| `export_video_future` | 2 beats / 20 coins | 20 coins after successful export | Integrated; UI currently displays internal beats |
| `adopt_character_reference` | 1.5 beats / 15 coins | 15 coins | Integrated; feature master currently off |
| `adopt_world_reference` | 0.5 beat / 5 coins | 5 coins | Integrated; feature master currently off |
| `visualize_world_reference` | 1 beat / 10 coins | 10 coins | Integrated as a second world reservation; feature master currently off |
| `analyze_direct_reference` | 0.5 beat / 5 coins | 5 coins per analyzed source | Integrated for prompt-only direct references; feature master currently off |

Actions in provider-cost telemetry but not in the wallet action-key list include `generate_story_text_overlay` and `stateful_image_generation`. Stateful bulk wallet spending is recorded under `batch_image_generation`, while telemetry can use the more specific generation-mode/activity label.
