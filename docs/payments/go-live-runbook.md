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

### 1.2 The CA's answers

Phase 6 was built on assumed answers. Ask the CA, and change the code or the switch plan wherever an
answer differs:
1. The numbering `KG/26-27/000001` (invoices) and `KGC/26-27/000001` (credit notes) is acceptable.
2. "Computer-generated, authorised signatory" is enough, with no digital signature.
3. One PDF marked "Original for recipient", plus our retained record, satisfies Rule 48.
4. A credit note is issued when the refund is processed, worded "Refund against invoice …".
5. Turnover is under ₹5 crore (so no e-invoicing), and SAC 998439 at 18% is right for coins and plans.
6. The live series starts at 000001 on go-live day.

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

---

## 2. Merge and deploy

Following WORKING_AGREEMENTS:
- merge `payments` → `dev` with `--no-ff`;
- let the dev Preview build;
- then merge `dev` → `main` with `--no-ff`.

Write the merge commit hash into the report (§11). `git revert -m 1 <that hash>` is the code rollback.

**Check:** the Production deployment is Ready in Vercel, and `/wallet` loads signed in.

---

## 3. The production database

Prod is at **124**. Apply **125 through 137, one at a time, in numeric order**, from the Supabase
dashboard (prod project) → SQL editor → paste the whole file → Run.

`125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137`

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

**After 137, check the switches exist and are all off:**
```sql
select flag_key, enabled, value from public.feature_flags
where flag_key in ('pricing_checkout_enabled','billing_checkout_allowlist','billing_reconcile_enabled',
  'billing_document_issuing_enabled','billing_emails_enabled','billing_admin_actions_enabled')
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
Migrations applied on prod (ledger top row after each): 125 … 137
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
