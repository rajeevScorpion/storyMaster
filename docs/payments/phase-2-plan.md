# Payments Phase 2 — durable financial records, GST on top, and deletion that keeps them

_Plan written 2026-09-17 on branch `payments` (Opus), from the pack's `04_PHASE_2_DURABLE_BILLING_LEDGER.md` plus
owner decisions 8 and 9. Discovery: two read-only Sonnet passes the same day (billing/tax, account deletion).
**Not approved yet — no code until the owner approves.**_

**Outcome:** every charge, refund and document is reconstructable from Kissago's own tables; GST is charged on top
of GST-exclusive prices using admin-configurable rules; and deleting an account keeps the financial record,
anonymised, instead of destroying it.

**Not in this phase:** rendering or emailing documents (Phase 6), coin clawback and admin refund tooling (Phase 4),
daily quota and Audience tier (Phase 3), self-serve cancel and billing UX beyond what checkout needs (Phase 5),
international/export treatment (Phase 8).

---

## 1. Verified current-state facts (read 2026-09-17, after migration 124)

| Fact | Where |
|---|---|
| No payments, refunds, documents, billing-profile or tax table exists. 124 is the newest migration. | `supabase/migrations/` |
| `billing_orders.amount_minor` is a single total with no tax split; `purchase_snapshot_json` records `amountMinor` only. | `016_billing_core.sql:39`; `pricing-checkout.ts:72-83,221-231` |
| The charged amount is always the raw catalogue price. Nothing computes tax anywhere. | `pricing-checkout.ts:78,199` |
| Only two files read `price_minor`/`amountMinor`: the wallet and the admin pricing studio. | `components/pricing/WalletPage.tsx:33-44,770,830`; `components/admin/PricingStudio.tsx:1080,1344` |
| Razorpay plan amount is created from `price_minor` verbatim, then cached on the plan version. | `pricing-checkout.ts:369-419` |
| Payment method, provider fee and provider tax are not typed or read, though the raw webhook payload we store contains them. | `lib/billing/razorpay.ts:23-79`; `lib/billing/razorpay-webhook.ts:15-25` |
| Stored payloads are redacted of `email`, `contact`, `vpa`, `card`, `bank_account`, `wallet`, `address`. | `lib/billing/razorpay-redact.shared.ts:1` |
| Runtime settings convention: a `feature_flags` row whose `value` is JSON, edited by a dedicated admin studio (the video-export presets pattern). Pricing itself uses draft→published rows with a publish audit trail. | `076_video_export_engine_presets.sql:13-19`; `015_*.sql:107-124`; `app/actions/pricing-admin.ts` |
| Business identity (name, **GSTIN `24ACLFA8196N1ZN`**, address, state Gujarat, emails) lives in plain exported constants, not the database. | `lib/legal/business-config.ts:23,28` |
| Every billing and wallet table cascades on `auth.users` delete: `billing_customers`, `billing_orders`, `billing_subscriptions`, `beat_grants`, `beat_usage_events`, `beat_spend_reservations`, and `legal_acceptances`. Deleting a user destroys the financial and consent record today. | `016:6,20,41`; `017:6,19,32`; `100:15` |
| `billing_webhook_events.related_user_id` and `admin_user_audit_events` already use SET NULL — the "keep the row, blank the person" pattern to copy. | `016:64`; `083:175-176` |
| No account deletion exists anywhere in the app; `auth.admin.deleteUser` is used only by a smoke-test script. Both Google and password sign-in are live. | `scripts/character-novelty.smoke.ts:97,238`; `components/auth/AuthProvider.tsx:134-185` |
| Published author identity is a copy, not a join: `storylines.author_name` is written at publish time. Anonymising the profile does not change published rows. | `app/actions/persistence.ts:1589,2417`; `app/actions/gallery.ts:115,341` |
| Media keys are story-scoped; newer ones carry the user id, legacy ones do not. `media_assets` is the only per-user index of objects, and its `user_id` is SET NULL, so it must be read **before** the user row goes. | `lib/supabase/storage.ts:74-89`; `lib/media/media-object-keys.ts:1-8`; `045:12` |
| Only single-object delete helpers exist. There is no list-by-prefix or bulk delete for R2 or Supabase Storage. | `lib/media/r2-server.ts:168-173`; `app/api/media/r2/delete/route.ts:19-60` |
| The managed legal pages say plainly that no self-serve deletion exists and that retention windows are undefined. `/account-deletion` is already an always-reachable route. | `lib/managed-pages/registry.ts:127,598-635`; `proxy.ts:18` |
| Research 07: 18% GST under OIDAR, SAC 998439 **unconfirmed**; declared state at checkout is **mandatory** for place of supply (Circular 242/36/2024-GST); CGST+SGST when the buyer is in Gujarat, otherwise IGST; invoice within 30 days, per renewal for subscriptions; credit notes by 30 Nov of the following FY; GST records kept 72 months; DPDP's legal-retention exception permits keeping billing records after deletion, and the current cascade is called "likely non-compliant". | `docs/payments/research/07-india-tax-and-consumer-compliance.md:26-27,41-46,57-61,65-82,88-90` |
| Dev data: 12 orders, 1 subscription, 9 grants, and the webhook events from today's test top-up. Prod has never processed a checkout (only free-allowance grants). | `research/03-data-model-and-live-db-state.md:263-274` |

**Open questions that need the owner or a CA before the affected code is written** — they gate parts of Unit B and C,
not the migration:
1. **Rate, SAC and classification.** The plan seeds 18% and SAC 998439 as an editable rule. Confirm with the CA.
2. **Coin timing** (research 07, §41-46): GST at purchase, or at coin redemption for non-expiring top-up coins? The
   plan assumes **at purchase**, which is what charging tax at checkout means.
3. **Published stories when an account is deleted:** remove them from the gallery, or keep them with the author
   anonymised? The plan assumes **remove**, since that is what "delete my data" usually means to a user.
4. **Issuing documents now or later.** The plan creates document *records* from day one but leaves issuing behind an
   admin switch that defaults **off**, so invoice numbering only starts once the CA has signed off (Phase 6).
5. **Consent records** (`legal_acceptances`): keep them anonymised as proof of agreement, as this plan assumes, or
   delete them with the account?

---

## 2. Design decisions

1. **A payment row per actual charge**, including every renewal, keyed by the provider payment id. Renewals have no
   durable record today, which is why Phase 1 had to leave renewal refunds unmatched.
2. **Money is stored as three numbers** — `net_minor`, `tax_minor`, `gross_minor` — with a CHECK that they add up,
   plus a tax breakdown holding the rate, the SAC, the supplier state, the place of supply and the CGST/SGST/IGST
   split. Amounts are never re-derived later from a rate.
3. **Tax is calculated at checkout, on top of the price.** `billing_orders.amount_minor` becomes the **gross**, and
   the purchase snapshot carries all three numbers plus the rule id used. Razorpay is charged the gross.
4. **Tax rules live in a table, not a JSON flag.** Rates change, and an invoice must be reproducible with the rule
   that applied on its date. Effective-dated rows, admin-editable, one published row per market and product kind.
5. **Fail closed, in both directions.** Without the table (an un-migrated database) the code charges the net, exactly
   as today. With the table but no published rule, checkout refuses rather than under-charging.
6. **The place of supply comes from the customer's declared state**, captured once into a billing profile and
   required before checkout. This is a legal requirement, not a preference.
7. **One Razorpay plan per gross amount.** The plan reference is only reused when its recorded amount and mode still
   match; a rate change creates a new plan. If a customer's state ever produced a different gross from the plan's,
   subscription checkout refuses instead of charging the wrong amount.
8. **Documents are records now, paper later.** Rows for receipts, tax invoices and credit notes, each freezing the
   customer and business details at issue time, with gapless per-financial-year numbering from a sequence table.
   Issuing is behind an admin switch, default off; Phase 6 renders and sends them.
9. **A billing profile is current details only.** Editing it never touches an issued document, because documents hold
   their own frozen snapshot.
10. **Deletion keeps the money and drops the person.** Billing and wallet tables move from CASCADE to SET NULL and
    gain `subject_ref`, a stable id copied from the user id, so a deleted customer's records stay linked to each
    other without pointing at a person. Retained rows keep what GST requires (recipient name, state, GSTIN where
    given); contact details go.
11. **Deletion is a server-side sequence, in order:** re-authenticate, read what must be read first (media keys,
    billing rows), cancel the live subscription at Razorpay, stop pending jobs, delete content and storage objects,
    anonymise what is retained, delete the profile and the auth user, then write an audit row. Order matters:
    `beats.generated_by` has no delete rule, so content must go before the user.
12. **Backfill records only what the provider told us.** Existing paid orders become payment rows marked
    `backfilled`, with tax recorded as unknown rather than invented.

---

## 3. Migration 125 — `125_billing_ledger_and_retention.sql`

Header traps to carry into the file: this migration **changes delete behaviour** (rows survive user deletion, which
is the point); and it must be applied **before** any code that writes the new tables.

```sql
-- Precheck (expect 0 rows):
--   select table_name from information_schema.tables where table_schema = 'public'
--     and table_name in ('billing_payments','billing_refunds','billing_documents','billing_document_sequences',
--                        'billing_profiles','billing_tax_rules','account_deletion_events');

CREATE TABLE IF NOT EXISTS public.billing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  legal_name text,
  billing_email text,
  phone text,
  company_name text,
  gstin text CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  state_code text NOT NULL,
  country_code text NOT NULL DEFAULT 'IN',
  address_line_1 text, address_line_2 text, city text, postal_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.billing_tax_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_key text NOT NULL DEFAULT 'IN',
  applies_to text NOT NULL CHECK (applies_to IN ('all', 'subscription', 'topup')),
  tax_regime text NOT NULL CHECK (tax_regime IN ('in_gst', 'none')),
  rate_percent numeric(5,2) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  sac_code text,
  supplier_state_code text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_tax_rules_live
  ON public.billing_tax_rules (market_key, applies_to)
  WHERE status = 'published' AND effective_to IS NULL;

-- Rate and SAC are the owner's editable starting point, pending CA confirmation (plan §1 question 1).
INSERT INTO public.billing_tax_rules (market_key, applies_to, tax_regime, rate_percent, sac_code, supplier_state_code, status, notes)
VALUES ('IN', 'all', 'in_gst', 18.00, '998439', '24', 'published', 'Seeded 2026-09-17; confirm rate and SAC with the CA')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.billing_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_ref uuid NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'razorpay' CHECK (provider IN ('razorpay', 'stripe')),
  provider_mode text NOT NULL CHECK (provider_mode IN ('test', 'live')),
  provider_payment_id text NOT NULL,
  provider_order_id text,
  provider_subscription_id text,
  provider_invoice_id text,
  billing_order_id uuid REFERENCES public.billing_orders(id) ON DELETE SET NULL,
  billing_subscription_id uuid REFERENCES public.billing_subscriptions(id) ON DELETE SET NULL,
  plan_version_id uuid REFERENCES public.pricing_plan_versions(id),
  topup_pack_id uuid REFERENCES public.pricing_topup_packs(id),
  kind text NOT NULL CHECK (kind IN ('topup', 'subscription_first', 'subscription_renewal')),
  status text NOT NULL CHECK (status IN ('captured', 'failed', 'refunded', 'partially_refunded', 'disputed')),
  currency_code text NOT NULL,
  net_minor bigint NOT NULL,
  tax_minor bigint NOT NULL DEFAULT 0,
  gross_minor bigint NOT NULL,
  tax_breakdown_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  method_category text CHECK (method_category IN ('card','upi','netbanking','wallet','emi','paylater','other','unknown')),
  provider_fee_minor bigint,
  provider_tax_minor bigint,
  cycle_start timestamptz,
  cycle_end timestamptz,
  purchase_snapshot_json jsonb,
  customer_snapshot_json jsonb,
  webhook_event_id uuid REFERENCES public.billing_webhook_events(id) ON DELETE SET NULL,
  captured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_payments_totals_add_up CHECK (gross_minor = net_minor + tax_minor),
  CONSTRAINT uq_billing_payments_provider_payment UNIQUE (provider, provider_mode, provider_payment_id)
);
CREATE INDEX IF NOT EXISTS idx_billing_payments_subject ON public.billing_payments (subject_ref, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_payments_subscription ON public.billing_payments (billing_subscription_id);

CREATE TABLE IF NOT EXISTS public.billing_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_ref uuid,
  payment_id uuid REFERENCES public.billing_payments(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'razorpay',
  provider_mode text NOT NULL CHECK (provider_mode IN ('test', 'live')),
  provider_refund_id text NOT NULL,
  provider_payment_id text,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  net_minor bigint,
  tax_minor bigint,
  currency_code text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'processed', 'failed')),
  reason text,
  initiated_by text CHECK (initiated_by IN ('user', 'admin', 'provider', 'dispute')),
  actor_user_ref uuid,
  coin_adjustment_json jsonb,
  raw_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_billing_refunds_provider_refund UNIQUE (provider, provider_mode, provider_refund_id)
);

CREATE TABLE IF NOT EXISTS public.billing_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_ref uuid NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('receipt', 'tax_invoice', 'credit_note')),
  document_number text NOT NULL,
  financial_year text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  payment_id uuid REFERENCES public.billing_payments(id) ON DELETE RESTRICT,
  refund_id uuid REFERENCES public.billing_refunds(id) ON DELETE RESTRICT,
  currency_code text NOT NULL,
  net_minor bigint NOT NULL,
  tax_minor bigint NOT NULL,
  gross_minor bigint NOT NULL,
  tax_breakdown_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  customer_snapshot_json jsonb NOT NULL,
  business_snapshot_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'void')),
  void_reason text,
  storage_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_documents_one_subject CHECK ((payment_id IS NOT NULL) <> (refund_id IS NOT NULL)),
  CONSTRAINT uq_billing_documents_number UNIQUE (document_type, financial_year, document_number)
);

CREATE TABLE IF NOT EXISTS public.billing_document_sequences (
  financial_year text NOT NULL,
  document_type text NOT NULL,
  prefix text NOT NULL,
  next_number integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (financial_year, document_type)
);

CREATE TABLE IF NOT EXISTS public.account_deletion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_ref uuid NOT NULL,
  actor text NOT NULL CHECK (actor IN ('user', 'admin')),
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'completed', 'failed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  removed_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  retained_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_reason text
);
```

**Retention conversion.** For each of `billing_customers`, `billing_orders`, `billing_subscriptions`, `beat_grants`,
`beat_usage_events` and `legal_acceptances`: add `subject_ref uuid`, backfill it from `user_id`, index it, drop the
CASCADE foreign key, make `user_id` nullable, and re-add the key as `ON DELETE SET NULL`. `beat_spend_reservations`
stays CASCADE — a reservation is a few minutes of working state, not a record. Written as one `DO` block per table
using `DROP CONSTRAINT IF EXISTS <table>_user_id_fkey`, so re-running is safe.

Then: a `billing_next_document_number(p_financial_year text, p_document_type text)` function that takes a per-type
advisory lock, bumps the sequence and returns the formatted number; `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` with
no policies on all seven new tables, matching every existing billing table (service role only); and the
`schema_migration_ledger` row.

**Rollback twin** drops the new tables and restores the CASCADE keys. Its header must say that it cannot bring back
rows a deletion has already anonymised, and must not be run once real documents have been issued.

---

## 4. Code changes

### Unit A — the tax engine and the ledger writer (no user-visible change)
- `lib/billing/tax.shared.ts` (pure, isomorphic): given net minor units, a rule, the supplier state and the place of
  supply, return net/tax/gross and the CGST/SGST/IGST split. Rounding: tax computed on the net, rounded half-up to
  the paisa; an odd paisa in a CGST/SGST split goes to CGST. No rounding of the gross afterwards.
- `lib/billing/tax-rules.ts` (`server-only`): load the published rule for a market and product kind, with the
  missing-table latch that returns "no rules configured" rather than throwing, and a 60-second cache like the
  feature-flag reader.
- `lib/billing/ledger.ts` (`server-only`): `recordPayment`, `recordRefund`, `recordDispute`, each idempotent on the
  provider id, plus `issueDocumentIfEnabled` behind the admin switch.
- Extend the Razorpay types with the payment fields we already receive but don't read: `method`, `fee`, `tax`,
  `card.network`/`last4` are **not** stored — only a method category derived from `method`.

### Unit B — checkout charges tax, and every charge is recorded
- `app/actions/pricing-checkout.ts`: require a billing profile (state) before preparing; compute tax; set the order
  amount to the gross; extend the purchase snapshot with net/tax/gross, rule id, rate, SAC and place of supply; key
  the Razorpay plan cache on the gross amount and the mode.
- `lib/billing/razorpay-sync.ts`: on a settled top-up and on each paid subscription invoice, write the payment row
  (and the document row if issuing is on) in the same path that writes the grant, keyed for idempotency.
- `lib/billing/razorpay-webhook.ts`: refunds and disputes now match through `provider_payment_id`, so renewal refunds
  stop landing as `refund_unmatched`; each writes a refund row.
- `lib/billing/razorpay-reconcile.ts`: backfill any missing payment rows for confirmed money it finds.
- Wallet: a required billing-details step (legal name, state, optional company and GSTIN) before checkout, and price
  lines that show "₹X + GST" with the payable total. Minimal UI; the full billing surface is Phase 5.
- Admin: a tax-rules section in the pricing studio (list, edit, publish), following the existing draft→published
  convention, plus the document-issuing switch.
- A backfill action, run once per environment, turning historical paid orders into payment rows marked
  `backfilled` with `tax_status: 'unknown_legacy'`.

### Unit C — self-serve account deletion
- `lib/account/deletion.ts` (`server-only`): the ordered sequence from decision 11, each step logged into the audit
  row, written so a failure part-way can be resumed rather than leaving a half-deleted account.
- Storage: add list-by-prefix and bulk delete for R2 and Supabase Storage (neither exists today), and enumerate
  legacy story-scoped keys from `media_assets` and the user's stories **before** anything is deleted.
- `app/actions/account.ts`: `requestAccountDeletion` (re-authentication required), and an admin equivalent.
- UI: `/account/delete` page with a typed confirmation, what is removed and what is kept, reachable from the account
  menu; update the `account-deletion` and privacy managed pages, which currently say no such flow exists.
- Razorpay: cancel the live subscription immediately before deleting anything.

---

## 5. Tests (Vitest, mocked Supabase and Razorpay)

Tax: rates and rounding, the intra-state versus inter-state split, an odd-paisa split, a zero-rate rule, no published
rule (checkout refuses), and no table at all (charges the net). Ledger: idempotent payment and refund writes, totals
that must add up, a renewal refund matching its payment, gapless document numbering under concurrent issue, and the
issuing switch off by default. Checkout: gross amount reaches Razorpay, the snapshot records all three numbers, a
plan reference is not reused when the gross changes, and checkout refuses without a declared state. Deletion: the
step order, billing rows surviving with `user_id` null and `subject_ref` intact, the subscription cancelled first,
storage keys enumerated before deletion, and a resumable failure.

## 6. Verification on dev (after the owner applies 125)

Database: the precheck returns nothing; the seven tables exist with RLS on and no policies; `subject_ref` is
backfilled everywhere it was added; deleting a throwaway test user leaves `billing_orders` and `beat_grants` rows
with `user_id` null.

End to end: buy a top-up on the preview and confirm the charged amount is the price plus GST, one payment row with
the correct split, and the grant unchanged; subscribe and confirm the first charge and one renewal each produce their
own payment row; refund from the Razorpay dashboard and confirm a refund row matched to its payment; delete a test
account and confirm the trace still holds — provider event, payment, order, grant, document — with the person gone.

## 7. Rollback and disable

Tax can be switched off by archiving the published rule, which returns checkout to charging the net. Document issuing
is a switch, off by default. Deletion is a feature flag; off means the page is hidden. The migration's rollback twin
exists but must not run once documents are issued or a deletion has been processed.

## 8. Execution units (max 2 agents at once; commit per unit)

1. **Unit A** — tax engine, rule loader, ledger writer, migration 125 files, unit tests.
2. **Unit B** — checkout, sync, webhook, reconcile, wallet and admin, backfill. Depends on A.
3. **Unit C** — deletion, storage helpers, account UI, legal page updates. Independent of B; can run beside it.
4. **Opus review** of the diffs, then the owner applies 125 on dev and walks §6.
