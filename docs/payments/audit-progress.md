# Payments & billing — progress and handoff

**This is the living handoff for all payments work.** A fresh session reads this section first, then
`prompt-packs/kissago-payment-billing-prompt-pack-2026-09-17/` (the phase prompts; owner decisions in `01_…`).

## Next session starts here (updated 2026-09-24 — E1, E2 and F done, G next)

**Phase 5 is planned: `phase-5-plan.md`.** Ten units (0, A-G, M), migration 134 written out in full inside the
plan (not yet as files). **Seven owner decisions, P1-P7 (plan §3), gate D, E1, F and G.** B, C and the Razorpay
probe (Unit 0) can start cold, and A needs no decision.
**Planning found seven defects** (plan §2), two of them in money records:
- `recordPayment`'s duplicate update blanks the method and fees, and rewrites a past renewal's tax split
  from the live profile.
- The sync clears `cancel_at_period_end` on a scheduled cancel.

Also: `payment.failed` settles the checkout, so a successful retry shows as failed. Raw Razorpay error text
reaches the customer. Decision 6 (adult attestation, no checkout from kids mode) was never built.
**P1-P7 answered 2026-09-23, all as recommended** (plan §3). Nothing in Phase 5 is blocked now.
**Done 2026-09-23:**
- `billing_document_issuing_enabled` and `billing_admin_actions_enabled` are **off** on dev (verified).
- **Migration 134 (`b8e3131`) applied on dev** 17:44 UTC. Verified: the ledger row, both columns, and the
  terminal rows reset. **Frozen.** Not on prod.
- Session usage at planning end: **32%**.
**Phase 5 execution, 2026-09-23:**
- **Unit B** `c2f0e9c`: diff-reviewed and accepted.
- **Unit C** `b818493`: the review found it broke **every** dropdown. The list was `absolute` inside an
  auto-height wrapper, so menus opened **8px tall** (measured in Chromium; unit tests and plain
  `toBeVisible` both passed over it). Escape inside a Modal also closed the dialog, and Tab left its
  focus trap. All fixed in `549b40c`, and the e2e now asserts real height and scrolling.
- **Unit D** `6a1f661`: diff-reviewed and accepted. The Business state shows as a locked static box
  (`FilterDropdown` has no `disabled` prop). The vitest environment is `node` with no DOM library, so the
  form logic lives in `billing-details-form.shared.ts` with its tests. **Owner:** look at it on the
  Preview (wallet → Billing details → Edit), both Personal and Business, and on a phone.
- **Unit A** `4da23f5`: reviewed line by line and accepted.
  - Payment updates are fill-only. The status never moves back from refunded or disputed.
  - The tax split and customer snapshot are written once, under their own guards.
  - The subscription method is fetched once per payment, falling back to the entity's `payment_method`.
  - The sync no longer derives `cancel_at_period_end`.
  - The admin cancel records `cancel_requested_*` (134, fail-closed).
  - Renewals deliberately carry no purchase snapshot.
  - The "set true from a marker field" clause waits on Unit 0.
- **Gates on the final tree (`4da23f5` + docs):** tsc clean, lint clean, **2,084 tests / 170 files**,
  `build:verify` compiled. e2e: 37/38; the one failure is the storyline item below, not Phase 5.
- **Owner call at 67% usage: no new agents.** The session stopped after A.

**E1 re-planned, 2026-09-23 (usage 79%, owner: plan only, no subagents).** The plan's E1 line numbers
predated A and D. The new **"E1 execution spec"** in plan §5 is anchored at `7c00672` and is what to execute.
It adds three things the plan missed:
- **An unused exported server action, `prepareRazorpayCheckout`, would bypass a route-only kids/attestation
  gate.** Delete it, and gate inside the internal function.
- **The prepare route returns raw error text on 500s**, so Razorpay API errors reach the customer.
  Customer-facing errors become a typed class; everything else gets a generic sentence.
- **A top-up order goes `failed` on the `payment.failed` webhook and back to `paid` on a successful retry**,
  so the dismiss poll must not stop on `failed`.

Two scope calls in the spec, **both approved by the owner 2026-09-24**:
- A server-side P7 gate ("complete for its type", matching D's client gate).
- An interim attestation checkbox on `/wallet`, because the server refuses unattested checkouts and E2's
  sheet isn't built yet. E2 removes it.
**Razorpay's `image` (owner, 2026-09-24):** the favicon's "k" mark, rendered at 256px from the same drawing as
`app/icon.tsx` (spec step 7). No binary file.
**Owner, 2026-09-24:** the billing dialog visual review on the Preview **passed**. Usage at the start of E1: **83%**.
**E1 done, 2026-09-24.** The server half is `5b53b21` (Sonnet). The agent was cut off mid-client, and Opus
reviewed the server half, finished the client half, and committed both follow-ups.
Review found three things:
- **`pricing-checkout.ts` was still `'use server'`.** So `prepareRazorpayCheckoutInternal` was itself a
  public server action that trusted a caller-supplied `audienceMode`, and the kids gate could be skipped.
  It is now `server-only` (its one caller is the prepare route).
- A non-JSON prepare response (a platform timeout page) rendered its raw body. It now shows the generic
  sentence, and so does a network error.
- At the dismiss-poll timeout, an `abandoned` order read as "Payment received". It now counts as
  dismissed. The rule lives in `checkout-status.shared.ts` with tests.
Steps 9-10 (the attestation row and the kids line on `/wallet`) were written fresh.
**Gates:** tsc and lint clean, **2,141 tests / 175 files**, `build:verify` compiled, `e2e/smoke.spec.ts` 8/8.
`/brand/checkout-mark` serves a 256px PNG with a one-year cache.
**E2 done, 2026-09-24.** The E2 execution spec (plan §5) was written at `eaa6d02` and built by Sonnet in
`6d88270`. Opus reviewed it and fixed four things in `6e3c9de`:
- The sheet could get stuck on "Complete the payment" if Razorpay's `open()` threw.
- A poll left running from a closed sheet could write into a reopened one.
- The success line now comes from the quote. When the webhook lands first, verify says "already applied".
- A watch-only plan showed "0 coins".
**Gates:** tsc and lint clean, 2,169 tests / 177 files, `build:verify` compiled, smoke e2e 8/8.
**Opus drove it signed in** (Playwright on the local agent server, dev DB, Razorpay test mode, as `testuser`).
These all worked:
- The sheet's price: ₹450 + IGST ₹81 = ₹531. The ₹200 plan shows ₹236.
- At 360px wide, there is no horizontal scroll.
- Continue stays disabled until the box is ticked.
- An account without billing details gets the billing dialog first.
- The phone number is prefilled, and `confirm_close` works.
- A card top-up went through end to end. Order `9b8ce364…` has one payment, one grant, and `adultAttestedAt`.
- A failed card, then closing the window: the sheet waits ~20s, then shows our own sentence, not
  Razorpay's. While the window stays open after a failure, the sheet stays on "complete the payment".
**Timing (local → Razorpay test):**
- A top-up prepare takes ~0.8s. Of that, creating the order at Razorpay is 0.18s.
- A subscribe prepare: `plan_ref` 0.3ms (cached), and creating the subscription at Razorpay **1.7s**.
  **So pre-creating plan refs at publish time is not worth it.** A reused session skips the provider.
**Not verified, still open:**
- **The Razorpay logo**: Razorpay's https page can't fetch it from `http://localhost`. Check on the Preview.
- **The subscribe walk:** Razorpay's card-save step sends a **real SMS OTP** to the profile's phone, even in
  test mode, and `testuser`'s profile holds the owner's real number. Before a subscribe is walked again,
  the owner should put a dummy phone on the `testuser` profile, or be present for the OTP.
- A real UPI approval after closing the window. It needs a phone.
- The Refund Policy copy must be final before Phase 5 ships to prod (plan §8). The sheet links to it.

**F done, 2026-09-24.** The F execution spec (plan §5) is at `cef290f`, Sonnet built it in `360b28b`, and
Opus fixed two things in `c8ff6e5`:
- An immediately ended plan said "Ended on" a future date and still showed its price and benefits. It now
  reads as the free plan.
- The plan price came from today's catalogue. It now comes from the subscription's own version.
The cancel path was reviewed line by line and accepted:
- every query is scoped to the user;
- `atCycleEnd` is a literal;
- only fixed sentences reach the client;
- the 134 marker write mirrors the admin action;
- the sync never clears a scheduled cancel (`cancelAtPeriodEndPatch`);
- restart awaits the sync.
The spec itself had two corrections:
- `reconcilePricingSubscription` is admin-gated, so F uses `syncSubscriptionFromProvider`.
- `billing_documents` has no `provider_mode`.
**Gates:** tsc and lint clean, 2,197 tests / 179 files, `build:verify` and smoke 8/8 (agent run).
**Opus walked `/account/billing` signed in as `testuser`:**
- signed out, it shows the sign-in card;
- plan, coins, 4 payments with IGST lines and 2 refunds, the empty invoices state and billing details all
  render;
- at 360px there is no horizontal scroll;
- the account menu has "Billing" and the wallet has "Manage billing".
**Subscribe walk attempted 2026-09-24, deferred by the owner (OTP SMS limit hit).** For the next attempt:
- **The card must be Razorpay's recurring test card, Visa 4718 6091 0820 4366.** The domestic test
  Mastercard 5267… is refused with "This card is not eligible for recurring payments".
- Subscriptions force "Save this card", which texts a **real OTP** to the profile phone (the owner's). The
  code is reused for a few minutes.
- "Skip OTP" leaves Razorpay stuck on "Confirming Payment", and nothing is charged.
- While Razorpay showed its failure screen, our sheet correctly stayed on "Complete the payment".
- The walk script (`.agent/sheet-walk/pay.pw.ts`, gitignored) waits for the OTP in `otp.txt` and retries if
  a code is rejected.
- Each attempt leaves a `created` subscription checkout order, which the next attempt supersedes.
**The cancel and restart clicks are not walked:** `testuser` has no live test subscription. Creating one
texts the owner's real phone (see the E2 notes). Owner's call: a dummy phone on `testuser`'s profile, or
be present for the OTP. After that: subscribe, cancel from `/account/billing`, check "Cancels on <date>"
survives a reconcile (money-walk step 11).

**Next session starts with:**
1. The phase brief.
2. **G** (`/plans`, plan §9). Re-anchor its spec to the current tree first, execute on Sonnet, and have Opus
   review the diff and walk it.
3. If the owner has run **Unit 0** by then, read the new subscription's `subscription.*` webhook rows in
   `billing_webhook_events`, then write `research/11-cycle-end-cancel-probe.md`. They keep the full entity:
   look at `charge_at`, `ended_at`, `has_scheduled_changes` and `change_scheduled_at` after a cycle-end
   cancel. Then tell the owner to cancel the test subscription immediately.
**Owner, still open:**
- Unit 0 (steps in this session's chat, repeated in plan §5 Unit 0).
- **Unit 0** (the Razorpay cycle-end-cancel probe) is waiting on the owner.
- Usage was **60%** when C was reviewed.
**Open, not Phase 5:** `e2e/storyline-signin-return.spec.ts:36` fails every time on this branch. Clicking
"Start watching" signed out navigates to `/storyline/<id>` instead of opening sign-in on `/`. The other 37
e2e tests pass. No gallery or auth code has changed on `payments` since 2026-09-15, so the failure
predates Phase 5. This was not proven against a clean tree, because an agent was mid-edit.

## Previous entry (2026-09-23, night — money walk steps 1-7 all pass)

**State.** Migrations 124-133 applied on dev, none on prod. `payments` is pushed through `27cdd32`
(the refund-row fix). Gates at `27cdd32`: tsc clean, lint clean,
**1,977 tests / 167 files**, `build:verify` compiled. The billing-incidents dashboard reads Healthy; its four
amber "stuck top-ups" are the unpaid 2026-09-17 orders and age out to `abandoned` after 7 days.

**Walk step 7, 2026-09-23: pass (in-app refund, on `27cdd32`).** A ₹1,003 top-up (₹850 + ₹153 GST,
24 beats) refunded from the admin record. Audit: `payment_refunded` then `coins_clawed_back` −24 beats,
grant left at 0. Razorpay's `refund.created` and `refund.processed` both processed. The refund row kept
`initiated_by = admin`, the reason, `coin_adjustment_json` and the actor, and gained the net/tax split
from the webhook. `processed_at` was set once and not moved by the second webhook. Payment `refunded`.
This is the refund-row fix proven live. **Owner: turn `billing_admin_actions_enabled` off** (walk done).

**Decision 15, dashboard path, 2026-09-23: pass.** Re-running the `refund.processed` event ended
`sub_TfC9ViXijNEVkZ`: outcome `refund_recorded_subscription_ended`, subscription `cancelled`, and
Razorpay's own `subscription.cancelled` webhook came back 8 s later and processed. The owner got
Razorpay's cancellation SMS. `billing_admin_actions_enabled` is **on** on dev; the row did not exist
until the owner first toggled it, which is why Re-run was greyed out at first.

**Walk step 6, 2026-09-23: pass.** Reconcile run twice on the Preview; both 200. Ledger counts unchanged
across both (orders 19, payments 2, refunds 1, subscriptions 2, webhook events 15, grants 11).
`topups: 4` both times: four unpaid `created` top-up orders from 2026-09-17, re-checked and left
unpaid. Two stale ones (April, June) were marked `abandoned`. The same cron also cleared a media-retention
backlog on dev (24 originals, 5 reference sources) on the first run, since crons never run on Preview.

**Fixed 2026-09-23 (`d42622b` + review follow-up): `recordRefund`'s update path blanked fields.** When
several writers hit one refund row (in-app refund, refund webhook, dispute webhook), the second nulled the
first's `reason`, `coin_adjustment_json` and `payment_id`, and every re-run moved `processed_at`. The
update now fills only what its caller supplies; `pending` never overwrites a settled status;
`processed_at` is set once via a guarded update. It also now fills `net_minor`/`tax_minor`, which an
in-app refund never had. The test refund's `processed_at` (2026-09-23 15:48, refunded 2026-09-22) was
moved before the fix and is left as is.
**Related, known, not fixed:** `processRefundEvent` records any non-failed refund event as `processed`,
so a pending `refund.created` marks the ledger refund and payment refunded early. Test mode processes
instantly, so the walk won't show it; live mode can.

**Walk steps 4-5, 2026-09-23: pass.** Audience subscribe charged ₹236 (₹200 + IGST). First charge
confirmed; no grant, correctly, since Audience includes no coins. Dashboard full refund recorded with the
tax split reversed, `initiated_by = provider`, and payment and order marked refunded. **Found:** the
refunded subscription stayed `active` and would have renewed. That became decision 15. An in-app refund of
any Audience payment would have been refused for want of a coin grant. That became decision 16.
**Decision 15 only acts on Razorpay's `processed`:** a pending refund.created must not end a plan (review fix).

**Money walk, 2026-09-22, steps 1-2: pass.** A ₹450 top-up charged ₹531 (IGST, supplier 24 → place of
supply 27). One `billing_payments` row. One grant of 12 beats (= 120 coins; `beat_grants` stores beats).
`payment.captured` granted; the verify call and `order.paid` both saw "already granted". No double credit.
**Step 3 failed on findability, not data.** The payment sat only at the bottom of the user record, with
no admin-wide view. Fixed by the payments list and a jump bar on the user record.

**Defects the walk found, all fixed:**
- **133:** no writer set `subject_ref`, so every grant and billing profile since 125 would have been
  orphaned by an account deletion. Now a BEFORE INSERT trigger on all seven tables.
- **Review of Unit C's UI:** thrown server-action errors are redacted in production builds, so refund
  refusal reasons would have read "an error occurred". The UI now goes through
  `app/actions/admin-billing-ui-actions.ts`, which returns the reason as data. **Use that pattern for any
  admin action whose error text matters.** The existing grant and moderation actions still throw and have
  the same blind spot; they are not fixed, and it is not recorded elsewhere.
- **Also from the review:** the refund notice showed beats labelled as coins, and the payments list's
  refund lookup would have overflowed its URL at a few hundred payments.

**Known and not a defect:** `billing_payments.customer_snapshot_json` is always null; no caller passes it.
It matters once billing details are editable. It is recorded as a Phase 5 requirement.

**Do next, in order:**
1. **Owner: turn `billing_admin_actions_enabled` off.** Optional: walk step 8 (account deletion).
2. **Owner: the refund policy copy.** It must now also state decisions 15-16.
3. **Plan Phase 5.** Binding input: `phase-5-owner-requirements.md`, including the Razorpay-window and
   payment-method notes. The required-field set is a proposal awaiting the owner.

One scope call in Unit C's UI: re-sync is offered only on active, not-cancelling subscriptions, a
literal reading of the build brief. Widen it if support needs to re-sync a cancelling one.

## Previous entry (2026-09-20 — Phase 4 is code-complete; two things block it closing)

**All six Phase 4 units are built, reviewed and committed on `payments`.** Nothing is merged to `dev`
or `main`. Prod is untouched and stays that way until the whole feature is tested (owner, 2026-09-17).

| Unit | Commit | Reviewed | Note |
|---|---|---|---|
| A — migration 131 | `27a9fcd` | yes | **Applied on dev 2026-09-20, frozen.** Not on prod |
| B — billing panel | `3bf3de5` | yes | seven read-only sections on the admin user record |
| D — quota inspection | `05cb6d3` + fix `56abc41` | yes | "why did this user hit the limit", IST day shown |
| F — incident dashboard | `c6f1725` + fix `89dbabf` | yes | `/admin/pricing/billing-incidents` |
| E — catalogue guardrails | `6a5355b` | yes | informed confirmations carrying a live subscriber count |
| C — refund/cancel/re-sync | `28b4ef4` | yes | **migration 132 applied NOWHERE. UI not built.** See below |

**Gates, run directly against `28b4ef4` (not taken from any agent report):** `npx tsc --noEmit` clean,
`npm run lint` clean with zero warnings, **1,887 tests across 160 files**, `npm run build:verify`
compiled successfully.

### The two things that block Phase 4 closing

1. **Migration 132 is not applied on any environment.** Until it is, the refund action refuses rather
   than refunding money it cannot claw back — deliberate, and the correct direction. Apply on dev
   first, by hand, as always.
2. **Unit C has no UI.** `app/actions/admin-billing-actions.ts` exposes five server actions, but
   nothing in `AdminUserDetail.tsx` calls them: the `ConfirmDialog`s and the
   `manual:${crypto.randomUUID()}` wiring were deliberately dropped when the session hit its window.
   So **no admin can trigger a refund from a browser today** — which, with the kill switch off and 132
   unapplied, means the money path is triple-locked. Building that UI is the next unit of work, and it
   is small: the server side and its confirmations are fully specified.

### Unit C, in the detail a fresh session needs

- **Kill switch `billing_admin_actions_enabled`** (`lib/admin/operational-flags.shared.ts`),
  `defaultEnabled: false`, **deliberately not enabled anywhere.** Every mutating action checks it
  server-side after `verifyAdmin()`.
- **Ordering, which is the whole design** (decision 12): audit row written with
  `outcome: 'attempting'` **before** any mutation → clawback RPC → Razorpay → on provider failure, a
  compensating restore → audit patched with the final outcome. On success, `recordRefund` is
  **best-effort in a try/catch**: the `refund.processed` webhook stays the record, and a failed local
  write is never reported as a failed refund.
- **Clawback and restore use SEPARATE request keys** (`:clawback` / `:compensate`). This matters:
  migration 132 audits both directions under `coins_clawed_back` (131's vocabulary is frozen and has
  no "restored" verb; `metadata_json.direction` carries the distinction), so a shared key would make
  the restore replay as a no-op and strand the user's coins. Checked, and correct as built.
- **Migration 132 uses advisory-lock salt 85.** 83 (coin grants, target-user lock) and 84 (cohorts)
  are taken — verified in 083's function bodies. **Record the next salt here when one is used.**
- **The per-account refund cap** reads feature flag `billing_refund_cap_per_account`, falling back to
  `DEFAULT_REFUND_CAP_PER_ACCOUNT = 2`. A misconfigured flag cannot silently disable the cap. There is
  **no admin UI** for it — edit the flag's `value` column, as several other numeric settings already do.
- **The riskiest unverified thing:** `resolvePurchaseGrantSourceRef` reconstructs
  `beat_grants.source_ref_id` in reverse from a payment row (top-up: `billing_order_id`; subscription:
  `${providerSubscriptionId}:${cycleStartUnix}`). It was verified by reading `razorpay-sync.ts`, never
  round-tripped against a real subscription payment. If it is wrong, the refund fails to find the
  grant and **refuses** — it fails closed, but it would refuse a legitimate refund. The money walk is
  what would catch this.

### Do next, in order

1. **Apply migration 132 on dev** by hand.
2. **Build Unit C's UI** (`getBillingAdminActionsEnabled` already exists for it, commit `bd05baa`;
   the page wiring and the component work are NOT done) — `ConfirmDialog` with `tone="danger"` per action in `AdminUserDetail.tsx`,
   showing the amount, what gets clawed back, and what the user keeps.
3. **The §6 money walk** on the preview — **step-by-step runbook: `money-walk-runbook.md`**, written
   2026-09-20. This is now the highest-value action in the whole project:
   `billing_payments`, `billing_refunds`, `billing_documents`, `billing_profiles` and
   `user_daily_watch_slots` are **all still 0 rows on dev**, so every Phase 4 surface is correct by
   construction and unproven against real rows. It is owner-only.
4. **Rewrite the public Refund / Cancellation Policy** (`lib/managed-pages/registry.ts:315`). It still
   opens "Starter Draft - Review Before Rollout" and tells readers refunds are ad-hoc manual review;
   decisions 11-14 now say something far more specific. **Shipping live money against a policy page
   that contradicts the code is the kind of thing that costs more than it saves.** Copy decision, not
   code.

### What this phase cost, and the lesson worth keeping

**Three defects were found by reading diffs; none would ever have been caught by a gate.** All three
were the same shape — *a surface telling a support person something untrue about why it had no data*:
Unit F blamed a missing migration for an unconfigured Razorpay; Unit D's strict resolver blanked the
entire admin user page instead of degrading its own section; and Unit E's confirmation copy made an
access-safety claim that had to be verified against two separate query paths before it could stand.
That copy turned out to be true — but only because it was checked. **Keep reviewing diffs, not
reports.** One agent also cited a commit hash that was superseded by its own amend.

### Production reality check, verified 2026-09-20

Prod's ledger holds **nothing >= 124**. Direct probes: `billing_payments` → **42P01** (table absent),
`billing_subscriptions.provider_mode` → **42703** (column absent) — both in the classifier every new
panel degrades on. So on `main` today, **every** billing section, the quota section and three of four
incident sections would render "unavailable" **by design**. Do not read that as breakage during
promotion.

## Previous entry (2026-09-19 — Phase 3 done; Phase 4 planned, awaiting 5 decisions)

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
- **`PLAN_TIER_RANK` is a total order, and `free < audience < plus < studio` fits it** — *corrected while
  writing the plan; the audit first claimed the rank breaks, and it does not.* Plus is a superset of
  Audience at every pair, so the promote-only override rule stays correct and the seven `'studio'`-as-
  "unrestricted" sentinels keep working. What survives is a **constraint**: capabilities must be read from
  the plan's feature flags, never derived from rank, or the scale stops being a scale.

### Phase 3 owner decisions (2026-09-18) — four of six answered

These were put to the owner in one pass with the audit's findings and **answered**. They are binding input
to `phase-3-plan.md`.

11. **Quota reset is IST for everyone**, not per-user timezone — superseding Phase 0 decision 4 for now, to
    be revisited when the product goes international. No timezone storage, no browser capture, no
    anti-gaming rule. `lib/billing/financial-year.shared.ts` already has the IST handling to build on.
12. **Audience adds no member to any of the three per-plan shapes.** It inherits Free by the existing
    fallback, which the audit verified is already the correct behaviour for every one of them — Audience is
    Free-like on creation coins, retention, HQ and action gates. No migration of `pricing_action_costs`, no
    new settings keys. Revisit only when a capability must genuinely differ.
13. **Audience ships monthly only.** Annual becomes its own unit after a sandbox walk, since no annual
    subscription has ever run through Razorpay here and the mandate lifecycle is untested.
14. **The quota ledger is a new table, unique on `(user_id, local_day, storyline_id)`**, making "replays are
    free all day" a unique index and the cross-device race safe by construction. `storyline_views` is not
    extended — its `UNIQUE(user_id, storyline_id)` is a lifetime view and changing it would rewrite the
    meaning of every existing row.

15. **Audience launch prices do not gate the work** (owner, 2026-09-18): prices are catalogue data,
    configurable in the pricing studio and changeable after launch. Audit finding 11 (dev Plus ₹850 vs prod
    ₹1,450) should still be reconciled when the Audience row is created, but no unit waits on it.

### Phase 3 execution — started 2026-09-18

**Approved by the owner ("take the call") with requirement 16: an admin must be able to promote a user to
any tier from the backend without hassle.**

| Unit | Commit | Status |
|---|---|---|
| Migration 129 — quota table, `consume_watch_slot`, the two Audience CHECKs | `e5c0b3d`, race fix `40ff401` | **applied and walked on dev** 2026-09-19 (8/8 PASS); not on prod |
| Migration 130 — `provider_mode` on the subscription-checkout RPC | `aaaf71b` | **applied on dev** 2026-09-19; not on prod |
| C — Audience tier: wallet copy, plan-card layout | `97b1c0f` | done; catalogue created on dev 2026-09-19 |
| D — the quota's reader surfaces: upsell, last-slot confirm | `717f9bc` | done |
| E — `pricing_free_daily_watch_quota` as an admin setting | `db410ef` | done |
| A — `'audience'` as a plan key, the capability tidy-up | `04c0ce4` | done, reviewed |
| B — quota ledger, enforcement, the `unlimitedWatching` capability | `e7cea4d`, defect fix below | done, reviewed |
| C, D, E | — | not started |

### Start here next session

**Read `docs/payments/phase-4-plan.md` first.** Phase 3 is done; Phase 4 is planned and not started.

**Phase 3, closed.** Units A-E built, reviewed and committed. Migrations 129 and 130 applied and verified
on dev, neither on prod. 129's behavioural walk passed 8/8. The catalogue is created and the quota is
**live on dev**: four plans at four distinct ranks, `unlimitedWatching` false on Free and true on the other
three, Audience at ₹200/month IN. ROW prices are deliberately unsettled (owner: a future decision).

**Phase 4 needs five owner decisions before most of it can start.** They are §2 of the plan, and the master
directive requires the stop — all five touch refunds, clawback, or provider configuration:

| | Decision | Blocks |
|---|---|---|
| D1 | Who may refund, and full-only or partial? | Unit C |
| D2 | Does a refund claw back coins, and what if already spent? | Unit C |
| D3 | "Cancel immediately" — keep the paid-for remainder or end access now? | Unit C |
| D4 | Hard-block or informed-confirm when archiving a plan with active subscribers? | Unit E |
| D5 | Do incident alerts push anywhere, or is a dashboard enough? | Unit F |

**Three units need none of them and can start cold:** B (the read-only billing panel on the admin user
record), D (quota inspection), F (the incident dashboard). Unit A is the migration and is also unblocked.
**Unit B is the one that pays for itself fastest** — reads only, no money risk, and it is what removes the
SQL from routine support. If Phase 4 has to stop early, stopping after B leaves real value and nothing
half-built.

**One thing to settle before Unit B is verified, not after:** `billing_payments` has **0 rows on dev**, and
so do `billing_refunds`, `billing_profiles` and `billing_documents`. A panel built against that database
renders empty everywhere that matters, and "it did not crash" is not evidence. The honest fix is the
**Phase 2 §6 money walk on the preview**, which is already an outstanding owner action — doing it *before*
Phase 4 turns it from a chore into this phase's test data. Plan §6 has the alternative and why it is worse.

Gates at the end of the Phase 3 session: `npx tsc --noEmit` clean, `npm run lint` clean, **1,775 tests**
across 155 files, `npm run build` succeeds. Run them yourself before trusting any report.

### Units D and E — what the code does now### Units D and E — what the code does now

**E — the number is an admin setting.** `pricing_free_daily_watch_quota` joined the pricing runtime
settings (default `'3'`) and appears in the studio on its own, because that panel renders from
`PRICING_RUNTIME_SETTING_DEFINITIONS`. `FALLBACK_FREE_DAILY_WATCH_QUOTA` is gone. The capability and the
number now resolve together — `resolveUnlimitedWatchingForUser` became `resolveWatchQuotaPolicyForUser` and
returns both from one `loadPricingState`, so the limit costs nothing beyond the exemption check.

A **non-positive limit reads as unrestricted, not as a total block.** Zero is what a misconfigured row looks
like, not an admin asking for "no watching at all", and locking every reader out on a bad setting is the
worse failure — the same inversion as the absent-migration latch beside it.

**D — the reader surfaces.** Two of them, both in `components/story/WatchQuotaNotice.tsx`:

- **The refusal**, replacing Unit B's one-line placeholder. It names the plan that actually lifts the limit,
  resolved from the catalogue by tier rank in `app/actions/watch-quota.ts` — never written as the literal
  "Audience". If Audience is unpublished in a market, or an admin turns its capability off, the offer moves
  to whatever really grants it; if nothing does, no offer is shown rather than a dead one.
- **The last-slot confirmation**, and only that one. It appears when opening a storyline would spend the
  final slot, never on a replay (decision 3) — a replay spends nothing, and warning there would train
  readers to dismiss the one prompt that matters.

**Why the peek is a separate call, and why it runs *before* the load rather than beside it:**
`loadStorylineWithBeats` spends the slot, so there is no way to ask "use your last one on this?" after the
call that would already have used it. `peekWatchQuota` answers without spending. It short-circuits
server-side for an admin or an exempt plan before it ever reads the slots table, so a reader with no limit
pays for one cheap call and nothing more. Every failure path in it reports unrestricted: a quota lookup that
errors must not stop someone reading, and the server still enforces the real limit either way.

Slots remaining clamps at zero, so a limit an admin lowers below what someone has already spent cannot
render as a negative allowance.

### Unit C — what the code does now

- **The wallet's plan copy moved to `lib/pricing/plan-copy.shared.ts`** so it could be unit-tested without
  mounting `WalletPage` (16 tests). It was three `if`s ending in a bare `return`, which meant *any* plan key
  that was not free or plus got Studio's feature list — Audience would have advertised creator tools,
  downloads and unbranded exports it does not have. Every tier now has an explicit arm and the fallthrough
  says only what the offer itself carries.
- **"Everything in X" is computed, not written.** Plus said the literal `'Everything in Free'`, which
  Audience sitting between them makes wrong — and hardcoding `'Everything in Audience'` would be wrong again
  in a market where Audience is not published. It now names the nearest lower tier actually on offer.
- **The unlimited-watching line appears on the lowest tier that grants it, and only while some tier on offer
  lacks it.** Read off `offer.unlimitedWatching`, never off the rank (the constraint in §4). Two consequences
  worth knowing: before Free is set to false nothing advertises it at all (correct — it is not a feature
  until something is limited), and if an admin ever turns it off for Audience the line moves to Plus on its
  own. A test pins each.
- **The plan grid follows the catalogue.** It was `lg:grid-cols-3`, so a fourth tier wrapped alone onto a
  second row.

Not done here, deliberately: **no quota messaging on the Free card.** Saying "3 stories a day" would hardcode
the number Unit E exists to make configurable, and Unit D owns how the limit is communicated.

### Owner actions waiting

**1. ~~Finish Unit C in the pricing studio~~ — done 2026-09-19.** Verified on dev: four plans, four distinct
ranks, free 1 / audience 2 / plus 3 / studio 4.

**2. ~~Set `unlimitedWatching` false on Free~~ — done 2026-09-19.** False on Free, true on audience, plus and
studio. **The quota is live on dev.**

**2a. ~~Name the Audience price~~ — done 2026-09-19: ₹200/month** (`price_minor` 20000), verified. Audit
finding 11 is still open in the same area (dev Plus ₹850 vs prod ₹1,450).

**2c. Before the india-only beta flag ever comes off: Plus ROW monthly is published at $0.00.** Same
zero-price trap Audience had — it would render as "Free" with an enabled button that throws
`This plan is not purchasable`. Harmless today because `pricing_india_only_beta_enabled` is on and ROW is
blocked, so this is a go-live item, not a now item.

**2b. Walk the quota as a real Free account on the preview.** Open three distinct stories, confirm the
third asks before it goes, confirm the fourth is refused and shows the upsell, re-open one of the three and
confirm it is free and never warns. Confirm an admin account is never metered. The database behaviour is
already proven (8/8 above); this is the UI half.

**3. ~~Run the `consume_watch_slot` walk on dev~~ — done 2026-09-19, 8/8 PASS.** Only the two-tab race check
at the bottom of `docs/payments/verify-129-watch-quota.sql` is left, and it is optional: the advisory lock it
would exercise is already in the deployed function body, confirmed by reading `prosrc`.

**4. Prod, when the time comes:** 129 and 130 both, plus the COOP/COEP checkout-frame fix and the
old-Razorpay-account cleanup already recorded under Phase 1. 130 matters **before the first live checkout**,
or a tester holding a test-mode subscription is refused a live one.

**5. Reseeding the Terms and /docs pages is now a note in the product, not just here.** The
`account_deletion_enabled` toggle at `/admin/settings/billing-operations` carries a "Before you turn this on"
line, shown only while the flag is off, telling whoever flips it to reset those two managed pages to seed in
the same sitting. Why it is tied to the flag rather than to a deploy: the registry is only a *seed*, the live
copy is the `managed_pages` row, and the old wording ("self-serve deletion does not exist") is **correct**
while the flag is off. Reseeding early would create the contradiction rather than fix it. On dev the `terms`
and `documentation` rows still carry the old sentence; the FAQ row did not. Terms is a published,
acceptance-requiring document at `1.0.0`, so treat it as a version change. Prod could not be checked from a
session — production reads are blocked — so check it directly.

### Open, and genuinely the owner's call

These are decisions, not defects — each one has a defensible answer either way, which is why none of them was
taken on your behalf.

- **What a deleted author's story keeps.** `beat_revisions`, `timeline_rewrite_events` and
  `episode_journal_events` still CASCADE, so a story that survives its author loses its edit and series
  history. That is either correct (the person's data goes) or a defect (the kept work is mutilated), and
  which one it is depends on how you read the retention promise. `billing_profiles` moved CASCADE→SET NULL in
  127, going beyond the plan's text, and is worth a second look in the same pass.
- **Google-only re-authentication** accepts a 15-minute-old sign-in rather than a fresh OAuth round trip
  before an irreversible deletion. A security-posture call.
- **Phase 1 never closed**: runbook steps 4-9 (`phase-1-plan.md` §6) are still owner-pending. The top-up test
  passed.
- **Audit finding 11 is still open**: dev Plus is ₹850 and prod ₹1,450, and subscription coins cost more per
  coin than top-up coins in both. A launch price has to be named.

### Defects fixed 2026-09-19

- **The watch-quota refusal crossed the boundary as a thrown error.** Now returned as data; write-up in
  `phase-3-plan.md` §5, above B5, and `app/actions/exploration.test.ts` pins the channel — the refusal must
  *resolve* while "not authenticated" and "storyline not found" must still *reject*.
- **Every `payment.dispute.*` event was handled identically**, so `won` and `closed` left the payment
  `disputed` and the `billing_refunds` row `pending` for good, in a record kept eight years. Razorpay debits
  the merchant only when a dispute is **lost** (research 06 §4), so the outcome now decides what is written:
  lost settles the reversal as `processed` and sizes the payment `refunded`/`partially_refunded`; won marks
  the reversal `failed` (this vocabulary's "it did not happen") and returns the payment to whatever Razorpay
  says it is now — deliberately not a hardcoded `captured`, so an ordinary partial refund issued alongside
  the dispute is not erased. `lib/billing/dispute-status.shared.ts` reads the outcome from the dispute
  entity's own `status`, falling back to the event name.
  **A close writes nothing at all.** It is terminal but says nothing about which way the dispute went, and it
  normally arrives *after* the won/lost event that did — so collapsing it into either would write a wrong
  money fact, and passing `pending` through would have *overwritten* the settlement. The same reasoning
  covers a redelivered `created`: a still-pending event never overwrites a resolution already recorded
  (`dispute_already_settled`). Webhooks retry, so this is not hypothetical.
  **Still not done, and still a policy question: no coin clawback.** A lost dispute reverses the money and
  leaves the granted coins alone (research 06 §4, and F5 in research 01). Whether to revoke unspent
  `beats_remaining`, flag the account, or do nothing is a business call, so nothing was invented here.
- **`billing_begin_subscription_checkout` ignored `provider_mode`** when deciding a user already had a
  subscription, so a tester's test-mode subscription would refuse their first live purchase with
  `subscription_exists`. Migration **130** scopes all four cross-row queries to the mode the checkout is
  running in; the rollback twin restores 124's text exactly (verified line by line, not by eye). Not applied
  anywhere yet.
- **The terms, /docs and FAQ page seeds** said self-serve deletion did not exist. Seed text fixed; the live
  `managed_pages` rows still need a reseed, and the sequencing is under "Owner actions waiting" above.

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
- ~~**Starting a subscription is refused if the user has any open Razorpay subscription, in either mode**~~
  — **fixed 2026-09-19 in migration 130**, which scopes the `subscription_exists` check and the three
  open-order queries around it to `provider_mode`. Not applied anywhere yet; prod needs it before its first
  live checkout, or a tester's test-mode subscription will refuse their live purchase.

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
| 3 Plans, entitlements, consumption | **code-complete 2026-09-19** — `phase-3-plan.md`. A `04c0ce4`, B `e7cea4d` (+ defect fix `7b5669b`), C `97b1c0f`, D `717f9bc`, E `db410ef`. Migrations 129 and 130 applied and verified on dev, neither on prod; 129 walked 8/8. Catalogue created and the quota switched on for dev. Outstanding: the Audience price is ₹0, so the upsell cannot be walked end to end |
| 4 Admin, support ops, incident tooling | **unblocked half built 2026-09-20** — `phase-4-plan.md`. A `27a9fcd`, B `3bf3de5`, D `05cb6d3`+`56abc41`, F `c6f1725`+`89dbabf`. Migration 131 written, **applied nowhere**. **C and E deliberately not started** — blocked on owner decisions D1-D4. Nothing verified against real money data; dev's payment/refund/document/profile/watch-slot tables are all empty |
| 5 User billing & checkout UX | **planned 2026-09-23** — `phase-5-plan.md`. Owner decisions P1-P7 answered, all as recommended; nothing blocked. Migration 134 designed, not yet written as files |
| 6–8 | not started |

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

**Owner decisions for Phase 4 (2026-09-20)** — these unblock Units C and E.

11. **Full refunds only.** One payment, all of it, or nothing. No partial amounts and no proration in
    Phase 4. Rationale: the eligibility test (decision 6) is already binary, full-only cannot refund
    more than was paid, and GST credit notes for partial reversals need the Phase 6 document engine.
    Revisit partials when that exists.
12. **Clawback confirms decision 6, with a cap added.** A refund claws back the *unspent* coins of
    that purchase's own grant and refuses outright when more than ~20% of it has been used. The
    schema already bounds this: `beat_grants.beats_remaining >= 0` makes a negative balance
    impossible, so clawback can only ever reach zero — there is no "user owes us coins" state and
    none is to be built. **New:** refunds are capped per account (see below), closing a loophole
    decision 6 left open.
    **Order is part of the decision:** claw back first, then call Razorpay. "Coins removed, refund
    failed" is visible and fixable; "money refunded, coins still spendable" is a silent loss.
13. **"Cancel immediately" keeps paid access to the period end** — it cancels the *renewal*, nothing
    more. The user paid for the period and keeps it. A separate **terminate** path ends access at
    once with no refund, and exists only for fraud and abuse. Rationale: early cutoff without a
    refund is what turns a support ticket into a chargeback, which costs more than the refund.
14. **Catalogue changes take an informed confirmation, not a hard block** — showing the live
    subscriber count. A hard block would guard a failure the data model already prevents (see the
    finding below) and would make sunsetting a plan impossible while anyone was still on it.
15. **A full refund of a current-cycle subscription payment ends the subscription now** (owner,
    2026-09-23): an immediate cancel at Razorpay, and access ends. It applies to in-app and
    Razorpay-dashboard refunds alike. Decision 13's "keep access to period end" covers cancelling
    *without* a refund; once the money is returned, ending access carries no chargeback risk. Found by
    the walk: the refunded ₹236 Audience subscription stayed active and would have renewed.
16. **A plan that includes no coins is refundable, with nothing to claw back** (owner, 2026-09-23).
    Before this, every Audience refund was refused for want of a coin grant. A coin-bearing purchase
    with a missing grant still refuses.

**The repeat-refund loophole (found 2026-09-20, not previously named).** Nothing limits how often an
account may be refunded. Buy a top-up → use 19% → refund → rebuy → use 19% → refund: each purchase
resets both the 7-day window and the usage test, netting ~19% of a pack free every cycle. Decision 12
therefore caps refunds per account. **This is sharpened by the coin spend order**
(`040_fractional_action_costs.sql:256`): grants are consumed promotion → subscription → **top-up
last**, and top-up coins never expire, so a top-up sits at ~100% unused indefinitely and passes the
"<20% used" test almost forever. **The 7-day window is the only thing containing that** — it is
load-bearing, not cosmetic, and must not be quietly relaxed without re-deciding 12.

**Finding that reframes decision 14: archiving does NOT strip a live subscriber.** Both paths that
decide entitlement resolve the subscriber's plan **by id with no status filter** — the snapshot
loader (`lib/pricing/enforcement.ts:853` selects every version, archived included) and
`admin_list_users`' lateral join. Razorpay bills against its own plan id, so renewals continue as
well. The real gap in the pricing studio is narrower than "dangerous archival": the buttons fire
instantly with no confirmation and no sense of blast radius.

**Still owed before live money:** the public Refund / Cancellation Policy page
(`lib/managed-pages/registry.ts:315`) is still headed "Starter Draft - Review Before Rollout".
Decisions 11-14 must be written into it, or the published policy contradicts the code. Also note
there is exactly one admin account (`ADMIN_USER_ID`, an env var — no roles), so **none of these
actions has a maker-checker**; the kill switch and the confirmations are the only brakes.

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
