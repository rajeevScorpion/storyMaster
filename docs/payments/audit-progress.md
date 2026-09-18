# Payments & billing — progress and handoff

**This is the living handoff for all payments work.** A fresh session reads this section first, then
`prompt-packs/kissago-payment-billing-prompt-pack-2026-09-17/` (the phase prompts; owner decisions in `01_…`).

## Next session starts here (updated 2026-09-18 — Phase 2 done; Phase 3 audited, not planned)

**Phase 2 is complete: every unit built, reviewed, and its migrations applied on dev.** Nothing is merged to
`dev` or `main`; everything is on branch `payments`. Prod is untouched and stays that way until the whole
feature is built and tested (owner, 2026-09-17).

### State

| Unit | Commit | Status |
|---|---|---|
| A — tax engine, rule loader, ledger writer, migration 125 | `1ed8c6f` + review `218a9b6` | done, reviewed |
| B1 — checkout charges tax, every charge recorded, migration 126 | `e1d476c` + review `ea0db01` | done, reviewed |
| B2a — wallet billing details, GST-inclusive prices | `fb56e4c` + review `d199685` | done, reviewed |
| B2b — admin tax-rules panel, backfill trigger | `f89ddda` | done, reviewed |
| C — self-serve account deletion, migration 127 | `ca318c2` + kill switch in `f213092` | done, reviewed |
| Loose ends — kill switch, backfill gap, tax-rule audit | `f213092` + review `d12b4e5` | done, reviewed |
| Admin flags panel | `99b71e2` | done |

**Migrations 125, 126, 127 and 128 are all applied on dev** (confirmed in `schema_migration_ledger`), and
**none of them on prod**. Gates at the end of the session: `npx tsc --noEmit` clean, `npm run lint` clean,
**1,704 tests** across 149 files. Run them yourself before trusting any report — every agentic phase here has
had defects the suite passed over.

### Do these first

1. **Turn on `account_deletion_enabled` when you want deletion live.** It ships **off**. The new panel at
   `/admin/settings/billing-operations` flips it, along with `billing_reconcile_enabled` and
   `billing_document_issuing_enabled`.
2. **Run the payments backfill once on dev**, from the tax-rules/backfill section of the pricing studio.
   Expect `inserted: 2, skippedIneligible: 1` — the two paid top-ups land; the April subscription order is
   correctly refused because its first charge was never confirmed by a paid invoice and belongs to the
   decommissioned Razorpay account.
3. **Finish `phase-2-plan.md` §6.** The database half passes (recorded below). What is left needs a person:
   - a throwaway account deleted on dev, to prove billing rows survive with `user_id` null;
   - the money walk on the preview — buy a top-up and check the charge is price + GST with one correctly split
     payment row; subscribe; refund from the Razorpay dashboard and check the refund matches its payment.
   **Tax is armed on dev now**: checkout demands a billing state, and the seeded 18% / SAC 998439 rule is what
   is charged. It still says "confirm rate and SAC with the CA".

### §6 database verification — passed on dev (2026-09-18)

Checked against the dev database directly, not inferred:

| Check (`phase-2-plan.md` §6) | Result |
|---|---|
| The seven new tables exist, RLS on, **no** policies | pass — all 7, RLS true, 0 policies each (service-role only, by design) |
| Delete rules converted | pass — all ten SET NULL: 125's billing/wallet keys and 127's six admin-attribution keys |
| `subject_ref` backfilled everywhere it was added | pass — 0 nulls: `billing_orders` (17 rows), `billing_subscriptions` (1), `beat_grants` (10) |
| The seeded tax rule is live and resolvable | pass — IN / all / in_gst / 18.00 / SAC 998439 / supplier state 24, published, `effective_from` set when 125 ran so it is not future-dated |
| Cached Razorpay plan refs | none — every published plan version has `provider_price_ref` null (cleared at the Razorpay account move), so each subscription checkout creates a fresh plan at the gross |

`billing_payments` was still empty at the end of the session: nothing has exercised the ledger yet.

### Then Phase 3

**Step 1 of the brief's §4 is done: `phase-3-hardcoding-audit.md`** (2026-09-18). All 47 references read in
context and classified. Three findings change the shape of the phase and should be read before planning:

- **The entitlement model already exists.** `pricing_plans.feature_flags_json` already carries four
  capabilities end to end (admin toggle → normalizer → snapshot → client) with no plan-name conditional.
  `extensions_json` is written and **never read**. Phase 3 item 1 is a migration onto an existing
  mechanism, not a design.
- **Adding `'audience'` fails closed everywhere** — every gate falls through to the Free branch — so the
  tier can ship before the capability migration finishes. That decouples the brief's unit C from unit A.
- **`PLAN_TIER_RANK` is a total order and Audience does not fit it** (above Free on watching, below Plus
  on creation). Whatever rank it is given is wrong on one axis, which breaks the seven sites that pass
  `'studio'` to mean "unrestricted". This is the case for capability entitlements over a tier rank.

The audit adds a sixth owner decision to the brief's five, and it gates unit A: whether the three parallel
per-plan shapes (`pricing_action_costs`'s three **columns**, plus two admin JSON settings objects) move to a
plan-keyed representation or just get a fourth member each.

**Read `phase-3-brief.md` next** — it is deliberately a brief, not a plan, and it says why.
Scope is the pack's `05_PHASE_3_PLANS_ENTITLEMENTS_CONSUMPTION.md`: an entitlement model replacing plan-name
conditionals, the new Audience tier, annual billing, and the Free daily watch quota. The brief carries the
facts verified today — including that adding a fourth plan key touches **47 hardcoded references in 22 files**,
that there is **no user timezone infrastructure at all**, and that `storyline_views` is unique per *lifetime*,
not per day, so it cannot be the quota ledger as it stands. It also lists the five owner decisions needed
before any code.

Note the numbering clash: `billing-plan-2026-09-17.md` calls support tooling "Phase 3". **The pack wins.**

### Open, and genuinely the owner's call

- **Unit C's deletion behaviour**, unchanged since it was built: `billing_profiles` moved CASCADE→SET NULL in
  127, going beyond the plan's text; `beat_revisions`, `timeline_rewrite_events` and `episode_journal_events`
  still cascade, so a kept story loses its edit and series history when its author goes; Google-only accounts
  re-authenticate by a 15-minute-old sign-in rather than a fresh OAuth round trip; and the terms, help-legal
  and FAQ pages still say self-serve deletion does not exist, which now contradicts the flow.
- **Every `payment.dispute.*` event is treated identically**, so `won` and `closed` leave the payment marked
  `disputed` for good and the `billing_refunds` row `pending` forever, in a record kept eight years.
- **Phase 1 never closed**: runbook steps 4-9 (`phase-1-plan.md` §6) are still owner-pending. The top-up test
  passed.
- **Audit finding 11 is still open**: dev Plus is ₹850 and prod ₹1,450, and subscription coins cost more per
  coin than top-up coins in both. A launch price has to be named.

**Working rules:** Opus plans and reviews, Sonnet agents execute (at most 2 at once, and the owner asked for
**one at a time** in long sessions so a crash cannot lose two units); review diffs rather than agent reports;
commit per unit; snapshot an in-flight agent's tree to `refs/wip/<unit>` if a session has to end mid-flight;
keep this section current.

---

## Phase 1 handoff (written 2026-09-17, end of the sandbox-setup session)

**State:** branch `payments`, working tree clean. Local commits after `cd5cd0c` are docs only and not pushed; the
preview runs `cd5cd0c`. Phase 1 code is complete and reviewed, plus the checkout-frame fix (1,517 unit tests,
e2e smoke green). **Migration 124 is applied and verified on dev**, not on prod. Nothing is merged to `dev`/`main`.
The `payments` preview is live on the dev database, the Razorpay test webhook points at it, both flags are on, and
old-account data on dev is cleared. A headless run confirmed **checkout opens** on the preview, and the owner
then **paid a test top-up there and reports it worked** (the §6 step 3 check query was not run). Steps 4–9 are
still to do, so Phase 1 is not closed. Phase 2 planning started in the same session (owner at 10% usage).

**Release decision (owner, 2026-09-17):** nothing from this work goes to production until the whole feature is
built and tested. Iterate on the `payments` preview, merge to `dev`, and promote to `main` once, at the end. That
includes the checkout-frame fix.

**Step 1 — close Phase 1 with the owner (Opus, no agents needed):**
1. Ask the owner for session usage.
2. ~~Owner applies 124 on dev and verifies~~ — **done 2026-09-17** (§6 "Database" 2 and 4 pass; ledger row updated).
3. **Answered:** `payments` runs against the dev database as a Vercel Preview deployment, at
   `https://kissago-git-payments-rajeevscorpions-projects.vercel.app` once pushed. Previews are public, so Razorpay
   needs no bypass. See PROJECT_STATE "Deployment".
4. Owner does the dashboard steps: set `RAZORPAY_WEBHOOK_SECRET` in the Vercel **Preview** scope (before the push,
   or redeploy after), register the test webhook at that address + `/api/billing/razorpay/webhook` (events listed
   in `research/06`, including `refund.*` and `payment.dispute.*`), and turn on `pricing_checkout_enabled` and
   `billing_reconcile_enabled` on dev. The reconcile cron doesn't run on previews; runbook step 9 calls the route by
   hand. **Done 2026-09-17**, flags included. Add a second test webhook
   for the `dev` branch preview only **after** `payments` merges into `dev`: until then `dev` runs the old webhook
   code against the same database, and two handlers racing on each event would spoil the sandbox results.
5. Walk the sandbox runbook, `phase-1-plan.md` §6, steps 3–9. Record results here. The UPI Autopay step answers the
   long-open question in `research/06` Q1: write the finding there. **Owner-pending** (deferred 2026-09-17). Step 3
   now carries the check query. The Supabase MCP didn't connect that session; with it back, the agent can run the
   checks itself.
6. When §6 passes, mark Phase 1 **done** in the table below and commit.

**Found during the sandbox run (2026-09-17):**
- **Checkout could not open anywhere, production included.** The site-wide COOP/COEP headers (for video export)
  made Chrome block Razorpay's checkout frame. Fixed in `cd5cd0c`: `/wallet` is exempt, with a reload at the
  boundary and new-tab wallet links on story surfaces. See GOTCHAS "Cross-origin isolation blocks Razorpay
  Checkout". **Production needs this fix before any real checkout.**
- **The owner moved Kissago to a new Razorpay account** the same day (new keys and webhook; whether prod's Vercel keys changed too is unconfirmed). Data
  from the old account breaks the new one: saved plan IDs on `pricing_plan_versions` (reused because the mode
  still matches) and old subscriptions still `active` (they block that user's new subscription and fail every
  reconcile run). Dev had 2 plan IDs and 1 active subscription (the test user's); the owner cleared both by
  SQL. **Prod needs the same check before its first checkout on the new account.**
- **Starting a subscription is refused if the user has any open Razorpay subscription, in either mode** (the
  `subscription_exists` check in 124's checkout RPC ignores `provider_mode`). At go-live, a tester's test-mode
  subscription on prod would block their live purchase. Fix in a later migration, or close test subscriptions
  at cutover.

**Step 2 — plan Phase 2** (durable payment/refund/document records, billing profile, retention-safe deletion) from
`prompt-packs/…/04_PHASE_2_DURABLE_BILLING_LEDGER.md`. Write `docs/payments/phase-2-plan.md` to the same
standard as `phase-1-plan.md` (verified facts, full migration SQL, per-file edits, tests, verification). Stop for
owner approval before any code. Owner decisions that bear on it: #5 (GSTIN from business config) and #6 (8-year
retention, anonymise on delete) below. Phase 1 deliberately left refunds of **renewal** payments unmatched
(outcome `refund_unmatched`, payload kept); Phase 2's ledger should backfill from `billing_webhook_events`.

**If something fails in the sandbox:** checkout can be stopped with `pricing_checkout_enabled` off (server-enforced
within 60 s), and the backstop with `billing_reconcile_enabled` off. Plan §7 has the rest.

**Working rules:** Opus plans and reviews, Sonnet agents execute (at most 2 at once, sequential when files
overlap), review diffs rather than agent reports, commit per unit, keep this section current, and advise a fresh
session at natural checkpoints.

## Implementation status

| Phase | Status |
|---|---|
| 0 Discovery | **done 2026-09-17** — `phase-0-discovery-2026-09-17.md`; new streams `research/09`, `research/10` |
| 1 Money correctness | **code complete, not yet sandbox-verified** — `phase-1-plan.md`. Unit A `1392121`, Unit B `fabea84`, Opus review fixes `6685db5`. 124 applied on dev 2026-09-17. Checkout-frame fix `cd5cd0c`. Next: sandbox runbook (plan §6), in progress. Phase 1 closes only after §6 passes |
| 2 Durable billing ledger | **done 2026-09-18** — every unit reviewed; migrations 125-128 applied on dev, none on prod. `phase-2-plan.md` §6 database half verified; the money walk and a throwaway deletion still owner-pending |
| 3 Plans, entitlements, consumption | **not started; audit done 2026-09-18** — `phase-3-hardcoding-audit.md` (all 47 references classified) and `phase-3-brief.md` (a brief, not a plan). Next: the six owner decisions, then `phase-3-plan.md` |
| 4–8 | not started |

**Delegation:** Opus plans/reviews, Sonnet executes; **at most 2 agents at once**; ask the owner for session usage at each phase boundary.

**Owner answers so far (2026-09-17)**
- Billing entity is **Aavriti Design Studio** (GST-registered parent). GSTIN: see decision 5 below.
- Signed-out visitors browse the whole catalogue and must sign in to watch anything (already built). The daily quota only concerns signed-in users.
- Phase 0 kept light: the audit is same-day and no billing code changed since.

**Owner decisions from Phase 0 (2026-09-17)**
1. **Images on coins:** Free (trial coins) and Audience (top-ups) may generate images. Must be an admin setting so it can be switched off later. Today only Plus/Studio can. → Phase 3.
2. **Daily slot:** used when a story opens and its content loads. Failed loads don't count. Show "N of 3 left today"; confirm only before the last slot. → Phase 3.
3. **Replays are free all day:** the same story watched any number of times that day counts once (kids loop content; never block that). → Phase 3.
4. **Reset:** midnight in **each user's own timezone**. No timezone is stored today; capture it from the browser. Guard against timezone switching being used to reset early. → Phase 3.
5. **GSTIN:** invoices use the value in `lib/legal/business-config.ts` (supersedes the placeholder instruction). → Phase 6.
6. **Audit D3–D7 approved as recommended:** refund within 7 days if < ~20% of that purchase's coins used, unused coins clawed back; no subscription-coin rollover; Resend or Postmark for email, with Razorpay `customer_notify` on as a stopgap; adult attestation and no checkout from kids mode; block → cancel at cycle end and stop grants, delete → cancel immediately, anonymise, keep billing records 8 years.
7. **Defaults accepted without objection:** kids and adult mode on one login share one daily limit; admins can grant unlimited watching; republishing doesn't give readers a new slot; Audience → Plus upgrade rules decided at Phase 5.

**Owner decisions for Phase 2 (2026-09-17)**
8. **GST tax invoices from day one.** Prices are **GST-exclusive, now and always**; tax is calculated as applicable
   and added on top, so the amount charged changes, not just the paperwork. Tax settings must be configurable from
   admin. This moves tax calculation at checkout into Phase 2; Phase 6 still renders and sends the documents.
9. **Self-serve account deletion is built in Phase 2** (a must for the mobile app). Billing records stay after
   deletion, anonymised, for 8 years (decision 6).
10. **Deletion removes access, not the work.** Stories and published storylines survive the account, still showing
    the author name they were published with, so the content tables move to ownerless rather than cascading away.
    Media is therefore untouched and no storage deletion is built. Consent records are kept, anonymised. The tax
    point is the **purchase**, for every purchase, never coin redemption. 18% and SAC 998439 are the seeded editable
    rule. Document issuing stays off until Phase 6. The privacy and account-deletion pages must disclose that
    published stories and author names remain.

**Deliberate deviation from the pack:** the checkout kill switch blocks new checkouts only. Verify, webhook and reconcile still honour payments already started (see `phase-1-plan.md` decision 8).

---

# Audit (2026-09-17)

_Audit only: no code, schema, flag or config changes._

**Deliverables:** audit and plan written; `billing-audit-2026-09-17.md` (current state) and `billing-plan-2026-09-17.md` (suggested plan), both in this folder.

**Owner's framing:** coins track internal consumption; billing is real money. Users buy a subscription tier, get a limited number of coins per cycle, and spend them. Top-up packs also exist. Razorpay now (sandbox-tested, a few test payments in dev and prod); Stripe later for international.

**Delegation limit:** at most 2 research agents at once (owner, 2026-09-17).

## Research streams

Notes live in `research/`. Each paused stream has a `## Resume here` section listing what is left.

| # | Stream | Status |
|---|---|---|
| 01 | Checkout and payment capture | done — reviewed; 2 false "safe" claims corrected (F-R1, F-R2) |
| 02 | Entitlements, grants, coin↔money value | done — reviewed; per-coin pricing table corrected, Plus-vs-top-up value inversion added |
| 03 | Data model and live DB state, dev vs prod | done — reviewed; webhook and row counts re-queried and confirmed |
| 04 | Admin tools and operations | done — reviewed; no cancel/refund wrapper confirmed in `lib/billing/razorpay.ts` |
| 05 | Docs vs code, compliance surfaces | done — reviewed; draft refund-policy seed confirmed at `lib/managed-pages/registry.ts:315` |
| 06 | Razorpay capabilities (web) | done — answers folded into audit H1/H9/H10 and plan Phases 1, 4, 6 |
| 07 | India tax and consumer law (web) | done — folded into audit H3/H4/H11/M8 |
| 08 | Billing UX benchmarks, Stripe readiness (web) | paused by owner usage limit — Part 1 and 4.1 used in the plan; the rest is needed before plan Phase 7 |

## Findings verified directly by the reviewer (Opus)

These were confirmed by reading the code, independent of agent reports.

1. **Failed webhooks are never reprocessed.** `app/api/billing/razorpay/webhook/route.ts:46-57` returns `duplicate: true` for any event ID already stored, whatever its status. A failed event is stored as `failed` (`:93-104`) and answered with 500. Razorpay retries with the same event ID, and the retry is acknowledged as a duplicate. The grant never happens unless the verify call already did it.
2. **Coin grants have no database-level idempotency.** `beat_grants` (`supabase/migrations/017_wallet_core.sql:4-15`) has no unique constraint on `(source_type, source_ref_id)`. `grantTopupIfMissing` and `grantSubscriptionCycleIfMissing` (`lib/billing/razorpay-sync.ts:137-168`, `:192-226`) check and then insert. The browser's verify call and Razorpay's webhook usually arrive within moments of each other, so both can pass the check and both insert → double coins.
3. **Subscription verify trusts a client-supplied subscription ID.** `app/api/billing/razorpay/verify/route.ts:59-63` checks the signature against the stored subscription ID, but `:70` fetches `body.razorpaySubscriptionId` from the request and syncs that one. `syncRazorpaySubscriptionState` then updates or inserts that subscription under the caller's `user_id` (`lib/billing/razorpay-sync.ts:65-83`) and grants against it, with the idempotency check scoped to the caller's user. A user holding one valid signature can attach a different subscription ID. The direction is to always use the stored ID.
4. **Account deletion erases payment records.** `billing_customers`, `billing_subscriptions` and `billing_orders` reference `auth.users` with `ON DELETE CASCADE` (`016_billing_core.sql:6,20,41`), and so do `beat_grants`. Deleting a user deletes their payment history, which conflicts with tax record retention. Stream 07 will confirm the retention period.
5. **Top-up verify grants coins without confirming capture.** `verify/route.ts:115-132` grants on a valid signature alone. A valid signature proves authorisation, not capture, so if auto-capture is off or authorisation arrives late, coins are granted for money not yet captured. Severity depends on the account's capture setting (stream 06).
6. **No refund or dispute handling.** The webhook only acts on payloads with a subscription entity or an order/payment ID (`webhook/route.ts:116-244`). `refund.*` and `payment.dispute.*` events fall through to `ignored` or are processed as plain order updates, and coins are never clawed back.
7. **Razorpay sends no customer notifications for subscriptions.** `lib/billing/razorpay.ts:110` sets `customer_notify: 0`, and the app has no email of its own yet (stream 05 to confirm). Pre-debit and receipt obligations need checking (streams 06/07).
8. **Test-mode plan IDs are cached in the catalog.** `ensureRazorpayPlanRef` (`app/actions/pricing-checkout.ts:272-306`) stores the Razorpay plan ID on the plan version and reuses it forever. Switching to live keys fails on every subscription until those refs are cleared. Two first-time checkouts at the same moment can also create duplicate Razorpay plans.
9. **A halted or pending subscription locks the user out.** The guard at `pricing-checkout.ts:59-65` blocks new checkout for `created/authenticated/active/pending/halted`, and there is no self-serve cancel. A user whose renewal failed cannot fix it themselves.
10. **The checkout kill switch is UI-only.** `pricing_checkout_enabled` is read by `components/pricing/WalletPage.tsx` only; `prepareRazorpayCheckoutInternal` (`app/actions/pricing-checkout.ts:30-162`) never checks it, so the prepare route and server action create real orders and subscriptions with the flag off. Confirms stream 01's F3.
11. **In India, subscription coins cost more than top-up coins, in both environments.** Published catalogs, 2026-09-17:
    - **Prod:** Plus ₹1,450 → 300 coins/month (₹4.83/coin); Studio ₹3,950 → 900 (₹4.39); top-ups 120/240/480 coins at ₹450/₹850/₹1,650 (₹3.75/₹3.54/₹3.44).
    - **Dev:** Plus ₹850 → 120 coins (₹7.08/coin), so the ₹850 top-up gives twice Plus's coins.

    Subscription grants expire at cycle end, while top-ups never expire (`razorpay-sync.ts:151-168` sets no `expires_at`). A subscription is only worth it for its tier-gated features. This is an owner pricing decision. The dev and prod catalogs also disagree on Plus, so the launch price needs to be named.
12. **The displayed continuation price and the actual charge come from different sources** (stream 02, display side verified). `lib/pricing/story-continuation.shared.ts:24-33` shows the flat `continue_story_new_beat` catalog row. Stream 02 reports that runtime authorization composes prompt-only cost plus the live image-model coin cost, so the two drift apart when an image model's price is tuned.
13. **No webhook has ever been received, in either environment** (re-queried 2026-09-17). Dev: 12 checkout orders (8 abandoned subscription checkouts, 1 active subscription, 1 paid and 2 abandoned top-ups), 1 subscription grant, 1 top-up grant, **0** `billing_webhook_events`. Prod: 0 rows in every billing table. Everything credited so far came through the browser's verify call. Renewals, halts, cancellations, refunds and the webhook route itself are untested end to end. The dev subscription's second cycle, if already due, will not have been granted.
14. **Support desk cannot handle money problems without SQL** (stream 04, wrapper list confirmed). `lib/billing/razorpay.ts` wraps only create-plan, create-subscription, fetch-subscription and create-order: no cancel, refund, fetch-payment or fetch-invoice. There is no admin view of a user's orders and subscriptions, grants cannot be clawed back, and blocking a user leaves their subscription renewing.
15. **Customer-facing surfaces are not ready for Razorpay live activation** (stream 05). The public Refund & Cancellation page still opens with "Starter Draft - Review Before Rollout" (seed at `lib/managed-pages/registry.ts:315`; stream 05 reports the published copy is the same in dev and prod). There is no Shipping/Delivery policy, no transactional email, and no billing identity (name, state, GSTIN). Checkout discloses neither auto-renewal nor tax. There is also no account-deletion code at all, and a manual user deletion would cascade away the records of a subscription Razorpay keeps charging.

## Handoff — if this session ends before the deliverables exist

_Written at owner-reported 80% session usage._

- Streams 01–05 are **done and reviewer-checked**. Their notes are the evidence base, and the reviewer corrections are inline, marked "Reviewer correction/check (Opus)".
- Streams 06 (Razorpay) and 07 (India tax/law) were told to wrap up. Anything unfinished is under `## Resume here` in their notes.
- Stream 08 is **paused**. Part 1 (ChatGPT/Claude billing) and Part 4.1 (Stripe India status) are written; the rest is listed under `## Resume here`. It isn't needed for the first plan draft.
- **Next:** write `billing-audit-2026-09-17.md` from findings 1–15 above plus the Findings tables in `research/01–05`, then `billing-plan-2026-09-17.md` using 06/07/08 as well.
- **Owner decisions already surfaced:** the India launch price for Plus (dev and prod differ), and whether subscription coins should cost more per coin than top-ups and expire monthly.
- Everything stays on branch `payments`. Nothing is merged or changed outside `docs/payments/`.
