# Phase 6 — tax invoices, credit notes and billing email

Planned 2026-09-24 at `99e52da` (branch `payments`). Prompt: `prompt-packs/kissago-payment-billing-prompt-pack-2026-09-17/08_PHASE_6_INVOICES_RECEIPTS_EMAILS.md`.
Owner decisions Q1-Q3 are in `audit-progress.md` ("Phase 6 owner decisions").

## 0. Scope boundary

**In:**
- Every captured payment gets a GST **tax invoice**, and every processed refund a **credit note**.
- Documents are numbered, frozen as snapshots, and rendered to PDF. They are stored privately and downloaded
  signed in.
- They are listed on `/account/billing` and on the admin user page.
- Billing emails go through **Resend** from our own templates: receipt, renewal receipt, failed renewal,
  cancel scheduled, plan ended, refund, and the annual renewal reminder.
- Admins can see billing jobs, retry them and resend emails.
- **Fixed first:** the refund-status defect.

**Out, recorded in PROJECT_STATE when the phase closes:**
- A "plan changed" email. There is no in-place plan change (P2); a change is a cancel plus a new
  subscription, and both of those already email.
- Voiding and reissuing a document. Revised invoices under Rule 53 are an admin tool for later.
- Partial-refund credit notes. Refunds are full-only (decision 11).
- E-invoicing (IRN/QR). That needs aggregate turnover over ₹5 crore, which is a CA question.
- Consolidated daily B2C invoices.
- International documents (Phase 8).

**Switches:**
- `billing_document_issuing_enabled` (exists) gates numbering.
- `billing_emails_enabled` (new, 135) gates sending.
- Both are **off** on prod until the CA confirms. Dev may turn both on for the walk: test-mode payments number
  in a separate `TEST-` series, so dev can never produce something that looks like a real invoice.

---

## 1. Verified current-state facts (checked 2026-09-24)

**Ledger and hooks:**
- `recordPayment` returns `{state:'inserted', id} | {state:'already_recorded', id} | {state:'unavailable'}`.
  `'inserted'` is the fire-once signal.
- **There are exactly two call sites**, both in `lib/billing/razorpay-sync.ts`:
  - `settleTopupOrder` at `:192` (the result is discarded today);
  - `syncSubscriptionFromProvider` at `:684`, with `kind` `subscription_first` or `subscription_renewal`
    (the result is discarded).
  - Both are reached from the verify route, the webhook and the reconcile.
- **Failed charges never reach the ledger.** A failed top-up only sets `billing_orders.status='failed'`
  (`razorpay-webhook.ts` `processTopupFailureEvent`).
- **Every `subscription.*` event goes through one handler.** It re-fetches the subscription live and writes
  `billing_subscriptions.status` (`razorpay-sync.ts:558-578` update, `:581-599` insert). The previous row is
  `existing` (`:541`). Emails must key on **status transitions**, not event names.
- **The refund defect, `razorpay-webhook.ts:254`:** `status = event === 'refund.failed' ? 'failed' :
  'processed'`.
  - So `refund.created` records `processed` and stamps `processed_at`.
  - It also flips the payment to `refunded` (`:282`).
  - The decision-15 subscription end is already correctly gated on `entity.status === 'processed'`
    (`:291`).
  - The admin path maps correctly (`admin-billing-actions.ts:417`).
- **Nothing re-checks a pending refund.** The reconcile (`lib/billing/razorpay-reconcile.ts`) never touches
  refunds.
- `recordRefund` (`ledger.ts:319`) moves status forward only. `pending` never overwrites, and `processed_at`
  is written once.
- **The cancel markers:**
  - self-serve: `app/actions/billing-account.ts:609-616`;
  - admin: `app/actions/admin-billing-actions.ts:574-580`.
- `customer_notify: 1` is set only at `lib/billing/razorpay.ts:178` (subscription creation).

**Documents (migration 125):**
- `billing_documents` has `document_type` in (`receipt`, `tax_invoice`, `credit_note`), `status` in
  (`issued`, `void`), and an unused `storage_ref`.
- There is no line-item column and no `provider_mode`.
- `billing_next_document_number` allocates in one call; the row is inserted in another
  (`ledger.ts:476-509`). **A failed insert burns a number**, which leaves a gap in a series the law wants
  consecutive.
- The already-issued check is check-then-insert (`:456-472`). Two concurrent issuers can issue twice.
- `issueDocumentIfEnabled` (`ledger.ts:446`) has **no callers**.
- The sequences table is empty on dev. Prod does not have 125 at all.
- The current number format is `INV/2026-27/000001`. `lpad` **truncates** past 999,999.

**Dev data:**
- 4 payments, 2 refunds, 0 documents, 1 billing profile.
- Two older payments have `customer_snapshot_json = null`.
- Top-up snapshots carry `packName` (for example "120 Coins"). Subscriptions have `cycle_start`/`cycle_end`,
  plus a plan name via `pricing_plan_versions.plan_id → pricing_plans.name` and a `billing_interval`.
- **The tax breakdown shape:** `{ruleId, sacCode:'998439', ratePercent:18, supplyType, cgstMinor, sgstMinor,
  igstMinor, supplierStateCode:'24', placeOfSupplyStateCode}`.
- **The customer snapshot shape:** `{profileType, legalName, companyName, gstin, billingEmail, phone,
  stateCode, stateName, countryCode, addressLine1, addressLine2, city, postalCode, capturedAt,
  profileUpdatedAt}`.
- The seller block comes from `lib/legal/business-config.ts`: Aavriti Design Studio, GSTIN
  `24ACLFA8196N1ZN`, Gandhinagar, Gujarat.

**Infrastructure:**
- **Private R2 works today:**
  - `lib/media/r2-server.ts` provides `putR2Object({access:'private'})` at `:81`, `getR2ObjectBuffer` at
    `:141` and `createR2SignedGetUrl` at `:124`.
  - The bucket is `R2_PRIVATE_BUCKET_NAME`.
  - `app/api/media/r2/object/route.ts` is the model for an authenticated proxy download.
- **Nothing exists yet for PDFs, fonts or email:**
  - There is no PDF library, no font file in the repo, and `next.config.ts` has no `serverExternalPackages`.
  - There is no email package and no `RESEND_*` variable.
- **The queue to copy:** `image_generation_jobs` + `app/api/media/jobs/run/route.ts` +
  `lib/media/image-job-runner.ts`.
  - The route checks the `CRON_SECRET` bearer, answers 202, and does the work in `after()`.
  - A conditional-update claim (`:80`), stale reclaim (`:60`), retry-or-fail (`:195`) and self-rekick (`:43`)
    complete the pattern.
  - The app URL comes from `APP_URL || NEXT_PUBLIC_APP_URL` (`image-job-runner.ts:37`).
- **Crons:** `vercel.json` has one, `/api/batch/reconcile` daily at 03:00. The route takes GET (cron) and
  POST.
- **Flags and admin:** `getFeatureFlag` fails closed. The admin flag panel is a registry
  (`lib/admin/operational-flags.shared.ts`), so a new flag is one object there.
- **Surfaces:**
  - `/account/billing` lists documents (`billing-account.ts:451-481` →
    `BillingAccountPage.tsx:453-474`) without `document_type` and without a download.
  - The admin user page already selects `document_type` and `storage_ref` (`admin-users.ts:581-588`).

**Law (CGST Rules 46/48/53, via ClearTax; the CBIC site's certificate failed):**
- **Invoice numbers:** at most 16 characters, consecutive, unique per financial year, using `-` and `/`.
  `KGC/26-27/000001` is exactly 16.
- **An invoice carries:**
  - the supplier's name, address and GSTIN;
  - the number and date;
  - the recipient's GSTIN if registered; for an unregistered recipient, name, address and state only at
    ₹50,000 and above;
  - SAC, description, quantity, taxable value, rate, and CGST/SGST or IGST;
  - the place of supply (state and code);
  - a reverse-charge line;
  - a signature or digital signature.
- **A credit note carries** the same, plus the **original invoice's number and date**.
- **Rule 48:** a service invoice is made in duplicate, marked "Original for recipient" and "Duplicate for
  supplier".

**Resend:**
- `POST https://api.resend.com/emails` takes `{from, to, subject, html, text, reply_to, attachments:
  [{filename, content(base64)}], tags}`.
- An `Idempotency-Key` header (≤256 characters) lasts 24h.
- The response is `{id}`. There is no SDK needed; use `fetch`.

---

## 2. Design

**A durable job queue, not inline side effects.**
- The hooks run inside verify, the webhook, the reconcile and server actions. A PDF render or an email call
  there would slow checkout and could fail halfway through.
- So each hook only **enqueues** a row in `billing_notification_jobs`, which has a `UNIQUE dedupe_key`
  (`ON CONFLICT DO NOTHING`), then kicks the worker.
- The worker issues the document, renders and stores the PDF, sends the email, and records the outcome.
- "Exactly once" comes from the dedupe key plus the database-side issue function. It never depends on the
  caller being lucky.

**Enqueue only while at least one switch is on.** Otherwise switching on later would send a backlog of old
emails. The worker also skips any email for a job older than **72h** (`skipped_stale`), though it still issues
the document.

**Where to send:**
- the payment's `customer_snapshot_json.billingEmail`;
- else the live `billing_profiles.billing_email`;
- else the auth email.
- **Never send to a deleted account:** `user_id` null gives `skipped_deleted`.

**Numbering happens in one database transaction** (`billing_issue_document`):
- the financial year is computed from `now()` in IST;
- the series is locked, the number allocated and the row inserted, all together;
- a failure rolls back the number too;
- a partial unique index makes a double issue impossible.
- **Test-mode payments get the `TEST-KG` / `TEST-KGC` series**, on the database's own sequence rows, and the
  PDF carries a "TEST — not a tax document" band.

**The snapshot is the record.**
- `line_items_json`, `customer_snapshot_json`, `business_snapshot_json` and `tax_breakdown_json` are frozen
  at issue time.
- The PDF is rendered only from the document row, with its dates fixed to `issued_at`, so re-rendering gives
  the same bytes.
- The stored PDF (private R2) is a cache of that rendering. When R2 is unavailable, the download renders on
  demand.

**A credit note needs an issued original invoice.** If the payment was never invoiced (issuing was off at
the time), the refund email still goes out but no credit note is issued. The job records
`document: skipped_no_original`.

**Enqueue points and keys:**

| Kind | Where | dedupe_key |
|---|---|---|
| `payment_receipt` | `razorpay-sync.ts:192` and `:684`, when `recordPayment` returns `'inserted'` | `payment:<billing_payments.id>` |
| `refund_processed` | webhook, once a refund is `processed` (new §A2), admin refund when Razorpay says `processed`, and the pending-refund sweep | `refund:<billing_refunds.id>` |
| `subscription_payment_failed` | `syncSubscriptionFromProvider`, on a transition **into** `pending`/`halted` | `sub_failed:<sub id>:<current_period_end>` |
| `subscription_ended` | same function, on a transition into `cancelled`/`completed`/`expired` from a non-terminal status | `sub_ended:<sub id>` |
| `cancel_scheduled` | self-serve and admin cancel, after the marker write | `cancel:<sub id>:<current_period_end>` |
| `renewal_reminder` | daily sweep: active **annual** subscriptions, not cancelling, renewing in 6-8 days | `renew:<sub id>:<current_period_end>` |
| `document_resend` | admin "Resend" | `resend:<document id>:<epoch ms>` |

**The backstop sweeps run from the daily reconcile:**
- payments captured in the last 3 days with no `payment:` job;
- refunds `pending` for over 1h, re-fetched from Razorpay;
- renewal reminders.
- After the sweeps, the reconcile runs the worker once.

**Retries:**
- Backoff is 2, 4, 8 and 16 minutes, 5 attempts in all.
- A failed job is visible to admins and can be retried.
- **Only one daily cron exists.** Delayed retries run on the next kick, whichever comes first: a new event,
  the daily reconcile, or the admin Retry.
- If the Vercel plan allows sub-daily crons, add a `*/15` cron for the worker. That's an owner check (§8),
  not a code dependency.

---

## 3. Migration 135 — `135_billing_documents_and_notifications.sql`

```sql
-- Phase 6: a document and its number are allocated in one transaction, so a failed insert can no longer
-- leave a gap in the GST series (Rule 46: consecutive, unique per FY, at most 16 characters), and a
-- partial unique index makes a double issue impossible. Test-mode payments number in a TEST- series.
-- Trap: never allocate a number and insert the document in separate calls again -- that is the gap
-- this fixes. billing_next_document_number is dropped so nothing can.
-- The KG / KGC prefixes are provisional until the CA confirms; billing_document_sequences is empty
-- everywhere, so changing them before issuing starts costs one replaced function.
-- Precondition: billing_documents is empty (true on dev; prod has no 125 yet).
-- Verify: the ledger row, and select proname from pg_proc where proname = 'billing_issue_document';

ALTER TABLE public.billing_documents
  ADD COLUMN IF NOT EXISTS provider_mode text NOT NULL CHECK (provider_mode IN ('test', 'live')),
  ADD COLUMN IF NOT EXISTS line_items_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS original_document_id uuid REFERENCES public.billing_documents(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_documents_issued_payment
  ON public.billing_documents (document_type, payment_id) WHERE status = 'issued' AND payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_documents_issued_refund
  ON public.billing_documents (document_type, refund_id) WHERE status = 'issued' AND refund_id IS NOT NULL;

ALTER TABLE public.billing_document_sequences
  ADD COLUMN IF NOT EXISTS provider_mode text NOT NULL DEFAULT 'live' CHECK (provider_mode IN ('test', 'live'));
ALTER TABLE public.billing_document_sequences DROP CONSTRAINT IF EXISTS billing_document_sequences_pkey;
ALTER TABLE public.billing_document_sequences ADD PRIMARY KEY (provider_mode, financial_year, document_type);

DROP FUNCTION IF EXISTS public.billing_next_document_number(text, text);

CREATE OR REPLACE FUNCTION public.billing_issue_document(
  p_document_type text,
  p_provider_mode text,
  p_subject_ref uuid,
  p_payment_id uuid,
  p_refund_id uuid,
  p_original_document_id uuid,
  p_currency_code text,
  p_net_minor bigint,
  p_tax_minor bigint,
  p_gross_minor bigint,
  p_tax_breakdown jsonb,
  p_line_items jsonb,
  p_customer_snapshot jsonb,
  p_business_snapshot jsonb
)
RETURNS TABLE (o_document_id uuid, o_document_number text, o_already_issued boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ist timestamp := now() AT TIME ZONE 'Asia/Kolkata';
  v_start int;
  v_fy text;
  v_short_fy text;
  v_prefix text;
  v_number int;
  v_doc_number text;
  v_id uuid;
BEGIN
  IF p_document_type NOT IN ('tax_invoice', 'credit_note') THEN
    RAISE EXCEPTION 'billing_issue_document: unsupported type %', p_document_type;
  END IF;
  IF p_provider_mode NOT IN ('test', 'live') THEN
    RAISE EXCEPTION 'billing_issue_document: bad provider mode %', p_provider_mode;
  END IF;
  IF (p_payment_id IS NULL) = (p_refund_id IS NULL) THEN
    RAISE EXCEPTION 'billing_issue_document: exactly one of payment or refund';
  END IF;
  IF p_document_type = 'credit_note' AND p_original_document_id IS NULL THEN
    RAISE EXCEPTION 'billing_issue_document: a credit note needs its original invoice';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'billing_issue_document:' || p_document_type || ':' || coalesce(p_payment_id, p_refund_id)::text, 0));

  SELECT d.id, d.document_number INTO v_id, v_doc_number
  FROM public.billing_documents d
  WHERE d.document_type = p_document_type AND d.status = 'issued'
    AND ((p_payment_id IS NOT NULL AND d.payment_id = p_payment_id)
      OR (p_refund_id IS NOT NULL AND d.refund_id = p_refund_id));
  IF FOUND THEN
    RETURN QUERY SELECT v_id, v_doc_number, true;
    RETURN;
  END IF;

  v_start := CASE WHEN extract(month FROM v_ist) >= 4 THEN extract(year FROM v_ist)::int
                  ELSE extract(year FROM v_ist)::int - 1 END;
  v_fy := v_start::text || '-' || lpad(((v_start + 1) % 100)::text, 2, '0');
  v_short_fy := lpad((v_start % 100)::text, 2, '0') || '-' || lpad(((v_start + 1) % 100)::text, 2, '0');

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'billing_document_number:' || p_provider_mode || ':' || v_fy || ':' || p_document_type, 0));

  v_prefix := CASE p_document_type WHEN 'tax_invoice' THEN 'KG' ELSE 'KGC' END;
  IF p_provider_mode = 'test' THEN v_prefix := 'TEST-' || v_prefix; END IF;

  INSERT INTO public.billing_document_sequences (provider_mode, financial_year, document_type, prefix, next_number)
  VALUES (p_provider_mode, v_fy, p_document_type, v_prefix, 1)
  ON CONFLICT (provider_mode, financial_year, document_type) DO NOTHING;

  UPDATE public.billing_document_sequences s
  SET next_number = s.next_number + 1, updated_at = now()
  WHERE s.provider_mode = p_provider_mode AND s.financial_year = v_fy AND s.document_type = p_document_type
  RETURNING s.next_number - 1, s.prefix INTO v_number, v_prefix;

  IF v_number > 999999 THEN
    RAISE EXCEPTION 'billing_issue_document: % series for % is exhausted', p_document_type, v_fy;
  END IF;

  v_doc_number := v_prefix || '/' || v_short_fy || '/' || lpad(v_number::text, 6, '0');
  IF p_provider_mode = 'live' AND length(v_doc_number) > 16 THEN
    RAISE EXCEPTION 'billing_issue_document: % is longer than 16 characters', v_doc_number;
  END IF;

  INSERT INTO public.billing_documents (
    subject_ref, document_type, document_number, financial_year, provider_mode,
    payment_id, refund_id, original_document_id, currency_code,
    net_minor, tax_minor, gross_minor, tax_breakdown_json, line_items_json,
    customer_snapshot_json, business_snapshot_json)
  VALUES (
    p_subject_ref, p_document_type, v_doc_number, v_fy, p_provider_mode,
    p_payment_id, p_refund_id, p_original_document_id, p_currency_code,
    p_net_minor, p_tax_minor, p_gross_minor, coalesce(p_tax_breakdown, '{}'::jsonb), coalesce(p_line_items, '[]'::jsonb),
    p_customer_snapshot, p_business_snapshot)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_doc_number, false;
END;
$$;

REVOKE ALL ON FUNCTION public.billing_issue_document(text, text, uuid, uuid, uuid, uuid, text, bigint, bigint, bigint, jsonb, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_issue_document(text, text, uuid, uuid, uuid, uuid, text, bigint, bigint, bigint, jsonb, jsonb, jsonb, jsonb)
  TO service_role;

CREATE TABLE IF NOT EXISTS public.billing_notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('payment_receipt', 'refund_processed', 'subscription_payment_failed',
    'cancel_scheduled', 'subscription_ended', 'renewal_reminder', 'document_resend')),
  subject_ref uuid NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES public.billing_payments(id) ON DELETE RESTRICT,
  refund_id uuid REFERENCES public.billing_refunds(id) ON DELETE RESTRICT,
  billing_subscription_id uuid REFERENCES public.billing_subscriptions(id) ON DELETE SET NULL,
  document_id uuid REFERENCES public.billing_documents(id) ON DELETE RESTRICT,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempt_count int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  document_outcome text,
  email_status text CHECK (email_status IS NULL OR email_status IN
    ('sent', 'skipped_disabled', 'skipped_no_address', 'skipped_stale', 'skipped_deleted')),
  provider_message_id text,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_notification_jobs_ready
  ON public.billing_notification_jobs (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_billing_notification_jobs_subject
  ON public.billing_notification_jobs (subject_ref, created_at DESC);
ALTER TABLE public.billing_notification_jobs ENABLE ROW LEVEL SECURITY;

INSERT INTO public.feature_flags (flag_key, enabled)
VALUES ('billing_emails_enabled', false)
ON CONFLICT (flag_key) DO NOTHING;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (135, '135_billing_documents_and_notifications.sql')
ON CONFLICT (migration_number) DO NOTHING;
```

**`135_billing_documents_and_notifications_rollback.sql`:**

```sql
DELETE FROM public.feature_flags WHERE flag_key = 'billing_emails_enabled';
DROP TABLE IF EXISTS public.billing_notification_jobs;
DROP FUNCTION IF EXISTS public.billing_issue_document(text, text, uuid, uuid, uuid, uuid, text, bigint, bigint, bigint, jsonb, jsonb, jsonb, jsonb);

DELETE FROM public.billing_document_sequences WHERE provider_mode = 'test';
ALTER TABLE public.billing_document_sequences DROP CONSTRAINT IF EXISTS billing_document_sequences_pkey;
ALTER TABLE public.billing_document_sequences ADD PRIMARY KEY (financial_year, document_type);
ALTER TABLE public.billing_document_sequences DROP COLUMN IF EXISTS provider_mode;

DROP INDEX IF EXISTS public.uq_billing_documents_issued_refund;
DROP INDEX IF EXISTS public.uq_billing_documents_issued_payment;
ALTER TABLE public.billing_documents
  DROP COLUMN IF EXISTS original_document_id,
  DROP COLUMN IF EXISTS line_items_json,
  DROP COLUMN IF EXISTS provider_mode;

-- 125's allocator is restored verbatim here (the CREATE FUNCTION billing_next_document_number block and its
-- REVOKE/GRANT from 125_billing_ledger_and_retention.sql); see the file.

DELETE FROM public.schema_migration_ledger WHERE migration_number = 135;
```

The rollback refuses to run cleanly once documents exist: the columns carry them. That is intended. You don't
roll back a document series; you void it.

---

## 4. Units

The order is **M → A → (B ∥ C1) → C2 → D → walk**. There are at most 2 agents at once. Opus reads every diff.

### Unit M — migration files (Opus writes them; the owner applies on dev)
Write the two files in §3. The rollback embeds 125's function verbatim. **Owner:** apply 135 on dev (steps
in §8).

### Unit A — money path (Sonnet; Opus reviews line by line)

**A1. Issuing.**
- Rewrite `issueDocumentIfEnabled` (`lib/billing/ledger.ts:418-516`) onto the `billing_issue_document` RPC.
- New input: `documentType: 'tax_invoice' | 'credit_note'`, `providerMode`, `originalDocumentId`,
  `lineItems`. Drop `financialYear`: the database computes it.
- The result gains `{issued: true, documentId, documentNumber, alreadyIssued}`.
- The flag gate and the missing-schema latch stay.
- Update `ledger.test.ts`: remove the `RCPT` / `billing_next_document_number` cases and assert the RPC args.

**A2. The refund-status fix, `lib/billing/razorpay-webhook.ts:214-329`:**
- Status comes from the event and entity:
  - `refund.failed` → `failed`;
  - `refund.processed` or `entity.status === 'processed'` → `processed`;
  - anything else → `pending`.
- `processedAt` only when processed.
- Move the payment-status flip (`:275-283`) under `status === 'processed'`. It is already inside that
  branch; keep it there, since the branch now means what it says.
- Return the refund row id from `recordResult` for C2's enqueue.
- **A new reconcile step, `reconcilePendingRefunds`** in `lib/billing/razorpay-reconcile.ts`:
  - It picks `billing_refunds` rows with `status='pending'`, `created_at < now()-1h`, up to 50.
  - It fetches each refund (new `fetchRazorpayRefund(paymentId, refundId)` in `lib/billing/razorpay.ts`:
    `GET /v1/payments/{pid}/refunds/{rid}`).
  - It applies the **same** state change as the webhook.
  - Extract that shared tail of `processRefundEvent` into `applyRefundOutcome({supabase, payment,
    refundEntity, source})` so both paths run identical code, including decision 15's gate.
  - Call it from the reconcile route after the existing work.

**A3. The document content builder**, `lib/billing/documents/document-content.shared.ts` (pure, tested):
- `buildBusinessSnapshot()` returns name, type, GSTIN, address lines, city, state, state code (the GSTIN's
  first 2), postal code, country, and the support email. It reads `business-config.ts`.
- `buildInvoiceLineItems(input)` returns `[{description, sac, quantity: 1, unit: 'NOS', netMinor}]`:
  - top-up: `"<packName> — Kissago coins top-up"`;
  - subscription: `"Kissago <Plan> plan — <monthly|annual> subscription, <d MMM yyyy> to <d MMM yyyy>"`,
    from `cycle_start`/`cycle_end` in IST.
- `buildCreditNoteLineItems(original, refund)` mirrors the lines. It says "Refund against invoice <number>"
  and uses the refund's net.
- `resolveCustomerSnapshot(paymentSnapshot, liveProfileSnapshot, taxBreakdown)`: the payment snapshot, else
  the live one, else `{stateCode: placeOfSupplyStateCode, profileType: 'personal'}`.
- A server loader, `lib/billing/documents/issue.ts` (`server-only`):
  - `issueInvoiceForPayment(paymentId)` loads the payment, names (pack, or plan plus interval) and profile
    fallback, then calls A1.
  - `issueCreditNoteForRefund(refundId)` requires an issued original, else returns `skipped_no_original`.
  - Both return a typed outcome string for `document_outcome`.

**Tests:** the refund status mapping (created, processed, failed, and a redelivered created after
processed); `applyRefundOutcome` parity; the content builders; the IST cycle-date formatting.

### Unit B — PDF, storage, download, surfaces (Sonnet)

**B1. Dependencies:**
- `pdf-lib` and `@pdf-lib/fontkit`, both pure JS.
- Vendor **Noto Sans Regular and Bold** TTF, plus `OFL.txt`, into `lib/billing/documents/fonts/`. It has
  the ₹ glyph. Download from the notofonts GitHub release and record the URL and version in a README line.
- In `next.config.ts`, add `outputFileTracingIncludes: { '/api/billing/**': ['./lib/billing/documents/fonts/**'] }`.

**B2. The layout model**, `lib/billing/documents/document-view.shared.ts` (pure, tested):
- `buildDocumentView(documentRow)` returns everything the page prints:
  - the title ("Tax Invoice" / "Credit Note") and the "Original for recipient" label;
  - the seller block, the buyer block (GSTIN when present), and the place of supply as "<State> (<code>)";
  - number, date (IST, `d MMM yyyy`), the original invoice's number and date for a credit note, and the
    payment reference;
  - the lines table (description, SAC, qty, taxable value), then the tax rows (CGST 9% plus SGST 9%, or
    IGST 18%) and the total;
  - the amount in words (Indian system: "Indian Rupees Five Hundred Thirty-One Only");
  - "Reverse charge: No";
  - the footer "Computer-generated document. Authorised signatory: Aavriti Design Studio";
  - `testBanner` when `provider_mode = 'test'`.
- **Tests:** every Rule 46 field present, the Rule 53 original reference, the words conversion (0, 531,
  1,00,300, lakhs, paise), intra- vs inter-state rows.

**B3. The renderer**, `lib/billing/documents/render-pdf.ts` (`server-only`):
- One A4 page drawn from the view.
- `setCreationDate` / `setModificationDate` = `issued_at`; `setProducer('Kissago')`; no other metadata.
- **Test:** the same row gives byte-identical output twice.

**B4. Storage**, `lib/billing/documents/storage.ts`:
- `ensureDocumentPdf(documentId)` returns the bytes.
- If `storage_ref` is set, read it with `getR2ObjectBuffer`.
- Otherwise render it. If R2 is usable (the effective storage config has R2 enabled and a private bucket),
  write `billing-documents/<mode>/<fy>/<id>.pdf` and set `storage_ref` `WHERE storage_ref IS NULL`.
- A failure never blocks: return the rendered bytes.

**B5. Download**, `app/api/billing/documents/[id]/pdf/route.ts`, modelled on
`app/api/media/r2/object/route.ts`:
- `runtime='nodejs'`.
- The signed-in user must equal `subject_ref`, or be the admin (the `ADMIN_USER_ID` check used by
  `verifyAdmin`).
- **404 for anything else**, never 403: it does not confirm the id exists.
- `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="Kissago-KG-26-27-000001.pdf"`,
  `Cache-Control: private, no-store`.
- **A route test** in the shape of `app/api/billing/razorpay/prepare/route.test.ts`: owner 200, another user
  404, signed out 401, admin 200.

**B6. Surfaces:**
- `BillingDocumentOverview` (`lib/billing/billing-account.shared.ts:35`) gains `documentType`.
- `loadDocumentsOverview` (`billing-account.ts:451`) selects it. The row shows "Invoice" or "Credit note"
  plus a **Download** link.
- Admin: `components/admin/users/AdminUserDetail.tsx` gets a Download link per document.
- The empty-state copies stay.

### Unit C1 — email infrastructure (Sonnet, in parallel with B)

**The client**, `lib/billing/email/resend.ts` (`server-only`):
- `sendBillingEmail({to, subject, html, text, attachments?, idempotencyKey, tags})`.
- It uses `fetch`, bearer `RESEND_API_KEY`, `from = BILLING_EMAIL_FROM` (default `Kissago Billing
  <billing@kissago.cc>`), and `reply_to = SUPPORT_EMAIL` when set.
- A missing key throws a typed `EmailNotConfiguredError`.
- A 4xx other than 429 is permanent; a 429 or 5xx can be retried.

**The templates**, `lib/billing/email/templates.shared.ts` (pure, tested), one function per kind returning
`{subject, html, text}`:
- The HTML is inline-styled on a light background. It uses the brand mark from
  `<APP_URL>/brand/checkout-mark`, one heading, a short body, one button, a footer with the seller name and
  address, and the "You get this because you bought from Kissago" line.
- **The copy:**
  - receipt: "Payment received — ₹531.00", the pack or plan, "invoice attached", and View billing →
    `/account/billing`;
  - renewal: the same, "Your <Plan> plan renewed";
  - failed renewal: "We couldn't renew your <Plan> plan". Razorpay retries automatically; access continues
    until <grace end>. The button "Update payment" goes to the subscription `short_url` if known, else
    `/account/billing`;
  - cancel scheduled: "Your plan won't renew — access until <date>";
  - ended: "Your <Plan> plan has ended", with Restart → `/plans`;
  - refund: "Refund of ₹X processed. Banks take 5-7 working days to show it", with "credit note attached"
    when there is one;
  - annual reminder: "Your <Plan> plan renews on <date> for ₹X", with Manage → `/account/billing`;
  - resend: "Your document <number>", attached.
- **Every string** that comes from data (plan names, the buyer's name) is HTML-escaped.
- **Tests:** escaping, and each kind renders its amount and link.

**The queue**, `lib/billing/notifications/queue.ts` (`server-only`):
- `enqueueBillingJob({kind, dedupeKey, subjectRef, userId, paymentId?, refundId?,
  billingSubscriptionId?, documentId?, payload?})`.
- It checks `shouldEnqueue()` (either flag on; cached), inserts `ON CONFLICT (dedupe_key) DO NOTHING`, and
  latches off on a missing table, like the ledger.
- **It never throws to its caller:** it logs and returns.
- `kickBillingJobs()` fire-and-forgets a `fetch` to `/api/billing/jobs/run` with the `CRON_SECRET` bearer,
  wrapped in `after()` when called from a request.

**The worker**, `app/api/billing/jobs/run/route.ts` + `lib/billing/notifications/runner.ts`:
- It's a copy of the image-job runner:
  - bearer auth;
  - a 202, then `after()`;
  - reclaim `processing` rows older than 10 min;
  - claim ready rows (`status='pending' AND next_attempt_at <= now()`, 20 per run) by a conditional update;
  - process each;
  - on error, `retryOrFail` with backoff `2^attempt` minutes;
  - rekick while ready rows remain.
- **C1 ships the processors as a registry with a no-op per kind.** C2 fills them in.
- It exports `runBillingJobsOnce()` for the reconcile.
- Add the flag object `billing_emails_enabled` to `lib/admin/operational-flags.shared.ts`, and add
  `RESEND_API_KEY=` and `BILLING_EMAIL_FROM=` to `.env.example`.

### Unit C2 — processors and hooks (Sonnet; Opus reviews)

**The processors**, one per kind, in `lib/billing/notifications/processors.ts`:
- `payment_receipt`: `issueInvoiceForPayment` (A3) → `ensureDocumentPdf` (B4) → email the receipt with
  the PDF attached (or the renewal copy for `subscription_renewal`).
- `refund_processed`: `issueCreditNoteForRefund` → PDF → the refund email.
- The rest are email only.
- **Every email goes through `deliverJobEmail(job, content, attachment?)`:**
  - the flag, the 72h staleness, a deleted user and a missing address each skip with their own status;
  - otherwise it sends with `Idempotency-Key = job.dedupe_key`;
  - it writes `email_status`, `provider_message_id` and `document_outcome`.

**The hooks:**
- `razorpay-sync.ts:192` and `:684`: capture the result. On `'inserted'`, enqueue `payment_receipt`.
- `razorpay-sync.ts` after the update at `:558-578` and the insert at `:581-599`: compare `existing?.status`
  with `subscription.status` and enqueue the failed or ended job. The failed job carries `{shortUrl:
  subscription.short_url ?? null, graceEndsAt}`; add `short_url?: string` to the `RazorpaySubscription`
  type.
- The webhook refund path (after A2) and the admin refund (`admin-billing-actions.ts:407-429`, when
  `refund.status === 'processed'`) enqueue `refund_processed`. So does `reconcilePendingRefunds`, once a
  refund turns processed.
- `billing-account.ts:609` and `admin-billing-actions.ts:574`, after the marker write: `cancel_scheduled`.
- `lib/billing/razorpay.ts:178`: `customer_notify: emailsEnabled ? 0 : 1`. Pass the flag in from
  `pricing-checkout.ts`. **Existing subscriptions keep Razorpay's emails**, because the API cannot change
  them.
- **The reconcile route** runs `sweepMissingReceiptJobs`, `sweepRenewalReminders` and `runBillingJobsOnce`
  after its existing steps.

### Unit D — admin support (Sonnet)

- The admin user page gets a **Billing emails** list (the newest 20 jobs: kind, status, email status,
  document outcome, last error, time).
- It has **Retry** on failed jobs: status `pending`, attempts 0, `next_attempt_at` now, then a kick.
- It has **Resend** on each issued document, which enqueues `document_resend`.
- Both actions go through `verifyAdmin`, write an `admin_user_audit_events` row, and are **not** behind
  `billing_admin_actions_enabled`: neither moves money.
- The shared mapper and types live in `lib/admin/user-management.shared.ts`, with tests.

---

## 5. Verification

**Every unit:** `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build:verify`. B also runs `npm run
test:e2e` (smoke). Opus reads each diff.

**The walk (Opus, on dev):**
- **Prerequisites:** 135 applied, both switches on, and a Resend key, with the recipient restricted to the
  owner's inbox until the domain is verified.
1. A top-up with `testuser` (IGST, Maharashtra):
   - the job goes `done`;
   - the document is `TEST-KG/26-27/000001`;
   - the PDF has every Rule 46 field and the TEST band;
   - the email arrives with the PDF;
   - `/account/billing` downloads it;
   - another user's download gets a 404.
2. The same payment re-verified or reconciled: no second document, no second email.
3. **An admin refund of that top-up:**
   - the refund row goes `pending` → `processed` (webhook or sweep);
   - the credit note `TEST-KGC/26-27/000001` references the invoice;
   - the refund email arrives.
4. **A Gujarat billing profile:** CGST 9% plus SGST 9% rows.
5. Both switches off: no job enqueued on a new top-up.
6. **The worker failure path:** a bad `RESEND_API_KEY` leaves the job `failed` after 5 attempts; an admin
   Retry sends it once the key is fixed.
7. **The subscription kinds** (receipt, cancel, ended, failed) are walked together with the deferred Phase 5
   subscribe walk, since they need the same OTP session.

---

## 6. Kill switches

- **`billing_emails_enabled` off:** nothing is sent. Jobs record `skipped_disabled`, and documents still
  issue.
- **`billing_document_issuing_enabled` off:** no numbers are allocated. Receipts still email, without an
  attachment.
- **Both off:** nothing is enqueued.
- **Neither switch affects checkout, grants or refunds.** Every enqueue is best-effort and never throws into
  the money path.

---

## 7. Open questions for the CA (they gate prod issuing, not the build)

1. The number format `KG/26-27/000001` and `KGC/26-27/000001`: acceptable?
2. Is an electronic invoice with "Computer-generated, authorised signatory" enough without a digital
   signature?
3. Rule 48's duplicate copies: is one PDF marked "Original for recipient", plus our retained record, enough?
4. The credit-note timing (on processed refund) and wording "Refund against invoice …": correct?
5. Is aggregate turnover under ₹5 crore (no e-invoicing), and is SAC 998439 at 18% right for coins and
   subscriptions?
6. **When to start the live series:** on the go-live day (numbers start at 000001 then), or at the next
   financial year?

---

## 8. Owner actions

**Apply 135 on dev:**
1. Open the Supabase dashboard (dev project) → SQL editor → paste the whole of
   `supabase/migrations/135_billing_documents_and_notifications.sql` → Run.
2. **Check:** `select * from public.schema_migration_ledger where migration_number = 135;` returns one row.

**Resend:**
1. Create the account.
2. Add the domain `kissago.cc` and add the DNS records it shows (SPF/DKIM) where kissago.cc's DNS lives.
3. Create an API key with "sending access".
4. Put `RESEND_API_KEY` and `BILLING_EMAIL_FROM="Kissago Billing <billing@kissago.cc>"` in `.env.local` and
   in Vercel (Preview and Production).
5. **Until the domain verifies,** Resend only sends to the account owner's own address. That is fine for the
   walk.

**Razorpay dashboard (test):** the webhook must include `refund.processed` and `refund.failed` besides
`refund.created`. Check under Settings → Webhooks.

**Vercel plan:** if it allows crons more often than daily, say so, and a 15-minute worker cron gets added.

**The CA:** the questions in §7.
