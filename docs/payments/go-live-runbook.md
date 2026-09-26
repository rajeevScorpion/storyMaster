# Go-live runbook — live money on kissago.cc

For the owner, done by hand, in order. Every step has a place to do it and a check. Do not skip a check
because the step "obviously worked"; most billing defects so far were found by a check, not by a failure.

Written 2026-09-25 (Payments Phase 7, P7-C). Plan: `phase-7-plan.md`. History: `audit-progress.md`.

**The rule that governs everything below:** real money starts only at §7, and only for your own
account. Everyone else waits for §8.

---

## 1. Before anything touches production

Every item here gates the release. None may be dropped. If one is still open, stop here.

### 1.1 Carried items

| Item | From | Done when |
|---|---|---|
| Unit 0: the Razorpay cycle-end-cancel probe | Phase 5 | `research/11-cycle-end-cancel-probe.md` exists |
| The subscribe → cancel → reconcile walk (money-walk §4, then cancel from Billing, then §6) | Phase 5 | "Cancels on <date>" survives a reconcile |
| The Razorpay logo and the checkout sheet, seen on the Preview | Phase 5 | you have looked at both on a phone |
| Phase 6 walk step 7: the subscription emails (receipt, cancel, ended, failed) | Phase 6 | each arrives once, walked with the OTP session above |
| The Refund Policy, Terms, Privacy, Account Deletion and FAQ published (§1.3) | Phase 7 | `/refund-policy` has no "Starter Draft" |
| The six CA answers (§1.2) | Phase 6 | each assumption replaced by a real answer |
| Server location: the owner decides where prod's servers and database live (§1.4) | 2026-09-26 | §1.4's decision is written down |

### 1.2 The CA's answers

Phase 6 was built on assumed answers. Ask the CA, and change the code or the switch plan wherever an
answer differs:
1. The numbering `KG/26-27/000001` (invoices) and `KGC/26-27/000001` (credit notes) is acceptable.
2. "Computer-generated, authorised signatory" is enough, with no digital signature.
3. One PDF marked "Original for recipient", plus our retained record, satisfies Rule 48.
4. A credit note is issued when the refund is processed, worded "Refund against invoice …".
5. Turnover is under ₹5 crore (so no e-invoicing), and SAC 998439 at 18% is right for coins and plans.
6. The live series starts at 000001 on go-live day.

**The CA's answers, 2026-09-26** (with the US questions in `international-readiness.md` §6):
- **Jurisdiction:** print "Subject to Gandhinagar Jurisdiction" in the footer. **Done:** every invoice and
  credit note carries it.
- **Question 2 (signature):** the CA suggests a stamp and a digital signature. **Owner: stay with
  computer-generated documents for now.** No change.
- **Still open:** questions 1, 3, 4, 5 and 6.

**Until the CA confirms, `billing_document_issuing_enabled` stays off on prod** (§6). Receipts still
email without an attachment.

### 1.3 Publish the policy pages (after the release reaches Production)

The code only carries seed text. **"Reset seed" makes the new text live at once**: public pages render
the saved text. Publishing then records a numbered version of it for consent. A version number can't
be published twice, so Publish stays disabled until the version is set and saved. (Walked on dev,
2026-09-25.)

For each page, in `/admin/settings/pages`:
1. Select the page → **Reset seed** → OK. You see "Starter seed restored.", and the page is live.
2. Read it on the site.
3. Under **Version & consent**, set **Document version** and **Acceptance kind** as in the table.
   Set **Effective date** to today. Then **Save**.
4. **Publish (minor)**. Never Publish (material): decision R2, so nobody is asked to re-accept.

| Page | Version now (dev) | Set to | Acceptance kind |
|---|---|---|---|
| Refund / Cancellation Policy | never versioned | 1.0.0 | Acknowledged |
| Terms | 1.0.0 | 1.1.0 | Accepted |
| Privacy | 1.0.0 | 1.1.0 | Acknowledged |
| Account Deletion | never versioned | 1.0.0 | Acknowledged |
| FAQ | check on the page | next minor | as it is now |

Prod's versions may differ from dev's. Read "Published vX" on each page first, and bump the middle
number.
- **Check:** `/refund-policy` shows "Cancelling a plan" and no "Starter Draft".
- **If `billing_refund_cap_per_account` is ever set**, the policy's "two refunds per account" must change
  with it. Today the row doesn't exist, and the code default is 2.
- Not part of this release, but still draft: the **Copyright / Licensing** page opens "Starter Draft".

### 1.4 Server location (owner, 2026-09-26: "very important, and code cannot solve this")

**Why it matters.** Each page makes several database queries one after another. Every query crosses from
the Vercel function to the Supabase database and back. When the two are far apart, each crossing costs about
a quarter of a second, and a page pays it many times over. Neither Vercel nor Supabase is slow on its own;
the distance between them is. Measured on 2026-09-26 with the same code, where only the function region
changed (dev database in Singapore):

| Page | Functions in Washington (iad1) | Tokyo (hnd1) | Singapore (sin1) |
|---|---|---|---|
| Gallery, first byte | 4.0 s | 1.8 s | 0.7 s |
| Wallet, activity shown | 6.8 s | 3.4 s | 1.3 s |
| Billing, history shown | 13.5 s | 7.0 s | 1.8 s |

**Where things are today:**
- Dev database: Singapore. Dev and Preview functions: `sin1`, set in `vercel.json` since 2026-09-26.
- Prod database: **Tokyo**. Prod functions: Washington until this release.

**Owner's direction:**
- Put the servers and the database together, and near the customers:
  - customers in India → **Singapore**, for both Vercel (`sin1`) and Supabase (ap-southeast-1);
  - customers in the US → **Washington** (`iad1`, Supabase us-east-1) or another suitable US region.
- This applies to dev and prod alike.

**Decide before the production push:**
1. **Move prod's database to Singapore, or keep it in Tokyo for now?**
   - Supabase can't move an existing project. Moving means a new project in Singapore, applying every
     migration, copying the data and auth users, and switching the prod keys.
   - This is cheapest before go-live, while prod has little data and no paying customers.
2. **Set prod's function region to match the prod database in the §2 merge.** Singapore database → `sin1`,
   which is already in `vercel.json`. Tokyo database → `hnd1`.
3. **Before the US opens (§12, GTM):** one database can't be close to both India and the US. Decide
   between accepting the slower market, a separate US deployment and database, or read replicas. Plan it
   before US marketing starts.

---

## 2. Merge and deploy

Following WORKING_AGREEMENTS:
- merge `payments` → `dev` with `--no-ff`;
- let the dev Preview build;
- then merge `dev` → `main` with `--no-ff --no-commit`. Before committing, set `"regions"` in `vercel.json`
  to the region next to **prod's** database (§1.4): `hnd1` while it's in Tokyo, and `sin1` if it moved to
  Singapore. The `sin1` that `dev` carries would otherwise reach prod with no conflict to stop it.

Write the merge commit hash into the report (§11). `git revert -m 1 <that hash>` is the code rollback.

**Check:** the Production deployment is Ready in Vercel, and `/wallet` loads signed in. In Vercel, open the
deployment. Its region must be the one chosen in §1.4, not `iad1` and not `dev`'s `sin1` by accident.

---

## 3. The production database

Prod is at **124**. Apply **125 through 138, one at a time, in numeric order**, from the Supabase
dashboard (prod project) → SQL editor → paste the whole file → Run.

`125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138`

After **each** one:
```sql
select migration_number, file_name, applied_at
from public.schema_migration_ledger order by migration_number desc limit 3;
```
The file you just ran must be the top row. If it isn't, stop and don't run the next.

Notes:
- **125** includes a backfill. It is safe because no live Razorpay key has ever been set on prod.
- **130** must be in place before the first live checkout. Without it, a tester holding a test-mode
  subscription is refused a live one.
- **132** is the refund clawback. Admin refunds refuse without it.
- **134** stops the sync from clearing a scheduled cancel.
- **138** is the US groundwork (Phase 8). It opens nothing: its flag ships off and its tax rule as a draft.
  The India release doesn't need it, but applying it now keeps prod in step with dev.

**After 138, check the switches exist and are all off:**
```sql
select flag_key, enabled, value from public.feature_flags
where flag_key in ('pricing_checkout_enabled','billing_checkout_allowlist','billing_reconcile_enabled',
  'billing_document_issuing_enabled','billing_emails_enabled','billing_admin_actions_enabled',
  'billing_international_countries')
order by flag_key;
```
A missing row reads as off, except `billing_checkout_allowlist`, whose missing row means "no
restriction". It must exist.

---

## 4. Production environment (Vercel → Project → Settings → Environment Variables → Production)

| Variable | Value | Why it matters |
|---|---|---|
| `RAZORPAY_KEY_ID` | the **live** key, `rzp_live_…` | The key prefix is how the app knows it is live |
| `RAZORPAY_KEY_SECRET` | the live secret | |
| `RAZORPAY_WEBHOOK_SECRET` | the **live** webhook's secret (§5) | A mismatch shows as signature failures |
| `APP_URL` | `https://kissago.cc` | **Email links use it.** On Preview it names the dev deployment, which is why Preview email links point there |
| `CRON_SECRET` | any long random string | The daily reconcile and the worker route |
| `RESEND_API_KEY` | a sending key | |
| `BILLING_EMAIL_FROM` | `Kissago Billing <billing@kissago.cc>` | Without it, the code default applies |
| `SUPPORT_EMAIL` | the real support inbox | The policy pages and emails show it |
| `R2_PRIVATE_BUCKET_NAME` | the prod private bucket | Invoice PDFs are cached here |

Resend: the `kissago.cc` domain must show **Verified**. Until it does, Resend delivers only to the account
owner.

**Check:** redeploy Production after changing env vars, since they apply at build/boot. Then run the
reconcile once:
```bash
curl -X POST -H "authorization: Bearer <CRON_SECRET>" https://kissago.cc/api/batch/reconcile
```
It must answer `{"ok":true,…}`.

---

## 5. The Razorpay live dashboard

Switch the dashboard to **Live mode** first. Test and live settings are separate.
1. **KYC** is approved, and settlements go to the right bank account.
2. **Subscriptions** are enabled on the account.
3. **Payment methods:** the ones you want (UPI, cards, netbanking) are on.
4. **Auto-capture** is on (Settings → Payment capture).
5. **The live webhook:** Settings → Webhooks → Add:
   - URL `https://kissago.cc/api/billing/razorpay/webhook`;
   - a new secret (put it in `RAZORPAY_WEBHOOK_SECRET`, §4);
   - events: `payment.captured`, `payment.failed`, `order.paid`, `refund.created`, **`refund.processed`**,
     **`refund.failed`**, `subscription.activated`, `subscription.charged`, `subscription.pending`,
     `subscription.halted`, `subscription.cancelled`, `subscription.completed`, and every
     `payment.dispute.*`.
   - The test webhook stays as it is.
6. **Plans:** don't create any by hand. The app creates each live Razorpay plan at the first checkout,
   and a test plan ref is never reused for live.
   ```sql
   select id, provider_price_ref, provider_price_ref_mode from public.pricing_plan_versions
   where provider_price_ref is not null;
   ```
   Before the first live checkout, any row here is `test`. Afterwards, the one you bought is `live`.

---

## 6. The switches on prod, in this order

From `/admin/settings/billing-operations`. Check each with the query in §3.

1. **`billing_checkout_allowlist`** on, with only your own user id:
   ```sql
   update public.feature_flags set enabled = true, value = '<your auth user id>'
   where flag_key = 'billing_checkout_allowlist';
   ```
   **On means restricted.** Turned on with an empty list, it closes checkout to everyone.
2. `billing_reconcile_enabled` **on**.
3. `billing_emails_enabled` **on**.
4. `billing_admin_actions_enabled` **on**. This is the switch that can move money out. It is needed for
   the refund in §7.
5. `billing_document_issuing_enabled` **on only after the CA (§1.2)**. Turning the switches on never
   replays old payments: the catch-up sweep reaches back only to when the switch went on.
6. `pricing_checkout_enabled` **on, last**. Signed-out visitors and unlisted accounts still see
   "coming soon" on the wallet and `/plans`.

---

## 7. The smoke ladder, on prod, with your own account and real money

Stop at the first failure. The money-walk runbook (`money-walk-runbook.md`) has the database checks for
each step.

1. **A top-up**, the smallest pack (money-walk §1-2):
   - the coins arrive;
   - one `billing_payments` row with the right GST split;
   - `payment.captured` is in `billing_webhook_events` as `processed`;
   - the receipt email arrives. With issuing on, it has the PDF, numbered `KG/26-27/000001` with **no
     TEST band**.
2. **The admin view** (money-walk §3): the payment shows on your admin user record, and the billing
   emails list shows the job as sent.
3. **An admin refund of that top-up** (money-walk §7):
   - the refund goes `processed`;
   - the coins are removed;
   - the refund email arrives, with credit note `KGC/26-27/000001` when issuing is on.
4. **Audience monthly: subscribe, then cancel** from Billing (money-walk §4, then the reconcile of §6). The receipt and the
   "cancellation scheduled" email arrive, and "Cancels on <date>" survives a reconcile.
5. **Audience annual: subscribe, then refund.**
   - The refund ends the plan at once (decision 15).
   - The "plan ended" email arrives.
   - **Check in the Razorpay dashboard that the subscription is cancelled**, so it can't renew.
6. `/admin/pricing/billing-incidents` reads healthy. Failed jobs, stuck jobs and stuck refunds are all 0.

---

## 8. Opening up

1. **Testers:** add their user ids to the allowlist value (comma-separated), then have each do one
   top-up.
2. **Everyone:** turn `billing_checkout_allowlist` **off**.

---

## 9. Emergency stops

| To stop | Do | Notes |
|---|---|---|
| All new checkouts | `pricing_checkout_enabled` off | Existing subscriptions keep renewing at Razorpay |
| One subscription's renewals | Cancel it on the admin user record, or in the Razorpay dashboard | |
| New Audience sign-ups only | Archive its plan version in the pricing studio | Existing subscribers are untouched (decision 14) |
| Billing emails | `billing_emails_enabled` off | Jobs record `skipped_disabled`; documents still issue |
| Invoice numbering | `billing_document_issuing_enabled` off | Issued documents stay valid |
| The daily watch quota | its own setting in the pricing studio | |
| Refunds and cancellations by admins | `billing_admin_actions_enabled` off | |
| After a Razorpay outage | Run the reconcile by hand (the `curl` in §4) | |
| Bad code | `git revert -m 1 <merge hash>` on `main` | Ledger rows and issued documents are never rolled back; a wrong document is voided, not deleted, and there is no void tool yet |

---

## 10. Known limits at go-live

- **The billing worker** runs when an event queues a job, and in the daily 03:00 UTC reconcile. There is
  no 15-minute cron until Vercel moves off Hobby. A job whose run fails waits for its retry or the daily
  run.
- **An email rejected for a bad address** retries all 5 times before failing.
- **`refund.created`** flips the old `billing_orders.status` to `refunded` before the refund completes.
  The ledger waits for `processed`.
- **No in-place plan change.** Customers are told to email support.
- **No document void or reissue tool.**
- **A lost chargeback does not remove coins automatically.**
- **The image-job worker's re-kick** uses the same `APP_URL` pattern that broke billing's kick on Preview.
  That is harmless on prod, where `APP_URL` is prod itself.
- **Before the India-only beta switch ever comes off:** Plus ROW monthly is published at $0.00.
- **Catalogue questions, still open:**
  - `/plans` shows Downloads on Free but not on Audience, while Audience says "Everything in Free".
  - Every tier says "720p vertical video".

---

## 11. The go-live report

Fill this in and keep it with the release.

```
Date / time (IST):
Merge commit on main:
Migrations applied on prod (ledger top row after each): 125 … 138
Env vars set (names only):
Razorpay live: KYC ☐  Subscriptions ☐  Auto-capture ☐  Webhook URL + events ☐
Switches, final values:
  pricing_checkout_enabled =        billing_checkout_allowlist = (on/off, ids)
  billing_reconcile_enabled =       billing_emails_enabled =
  billing_document_issuing_enabled = billing_admin_actions_enabled =
CA answers received (1-6):
Smoke ladder: 1 ☐ 2 ☐ 3 ☐ 4 ☐ 5 ☐ 6 ☐   (payment ids, document numbers)
Anything that failed, and what was done:
Open items carried forward:
```

---

## 12. Switching the US on (Phase 8; after India is live and stable)

Background: `international-readiness.md`. Do these in order. Every step has a check.

**First, server location for US customers (§1.4, owner 2026-09-26).** Prod's servers and database sit in
Asia. A US customer would feel that on every page. Decide the US setup (Washington or another US region,
a separate deployment, or replicas) before US marketing starts.

1. **The CA's answers** to `international-readiness.md` §6 are in, and nothing contradicts the build.
   - **Check:** each answer is written into that doc, next to its question.
2. **The LUT is filed.** The CA says it can be filed any time before the first export invoice. Put its ARN
   in `LEGAL_LUT_ARN` (`lib/legal/business-config.ts`) and deploy.
   - **Check:** a test-mode export invoice on the Preview prints "LUT ARN: …".
   - **Ask Razorpay** whether the card-currency offer (Dynamic Currency Conversion) can be turned off,
     or can default to USD. Today a card issued outside the US is offered its own currency first, with
     Razorpay's markup. There is no Checkout option for it.
     - **Check:** a test payment with a non-USD card (`5104 0600 0000 0008`) opens straight on USD.
3. **Razorpay live:** International Cards is approved (Dashboard → Account & Settings → International
   payments).
   - **Check:** the dashboard shows it active.
4. **Prices.** In `/admin/pricing`, publish the US (ROW) plan versions and top-ups with provider
   **Razorpay** and your USD prices. Archive the old `stripe` ROW rows.
   - **Check:**
     ```sql
     select provider, currency_code, count(*) from public.pricing_plan_versions
     where pricing_market_key = 'ROW' and status = 'published' group by 1, 2;
     ```
     Only `razorpay`/`USD`, plus the free plan's null.
5. **Routing:** set `pricing_routing_provider_row` to `razorpay`, enabled (`/admin/settings`, the pricing
   runtime panel).
6. **The tax rule:** publish the ROW `in_export_lut` rule.
   ```sql
   update public.billing_tax_rules set status = 'published', effective_from = now(), updated_at = now()
   where market_key = 'ROW' and tax_regime = 'in_export_lut' and status = 'draft';
   ```
   - **Check:** `select status from public.billing_tax_rules where market_key = 'ROW';` returns
     `published`.
7. **The policy text** for customers outside India is published (§1.3's steps: reset, version, save,
   publish minor).
8. **Your own account first.** In this order:
   1. Turn `billing_checkout_allowlist` on, with only your user id. This closes checkout to everyone
      else, India included, for the minutes this takes.
   2. Turn `billing_international_countries` on, with value `US`.
   3. Turn `pricing_india_only_beta_enabled` **off**. The allowlist still keeps everyone but you out.
9. **Smoke:** one USD top-up, with a US billing profile, on a real foreign card if you have one.
   - **Check:** the payment is `captured` in USD, and its invoice has the export wording and IGST 0%.
   - **Check:** `/admin/pricing/billing-incidents` → "Export sales on a domestic card" is empty, or
     shows it if you used an Indian card. That is expected, and it proves the card works.
   - Refund it from admin, and check the credit note.
10. **Open:** turn `billing_checkout_allowlist` off.

**To stop US sales only:** set `billing_international_countries` off. India is untouched.
