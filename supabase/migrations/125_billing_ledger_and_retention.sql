-- 125_billing_ledger_and_retention.sql
--
-- Payments Phase 2 (docs/payments/phase-2-plan.md): a durable payment/refund/document ledger,
-- admin-editable GST rules, and retention-safe account deletion -- billing rows survive a user's
-- deletion (anonymised via subject_ref), and the story/storyline/character rows a deletion would
-- otherwise orphan become ownerless instead of cascading away.
--
-- Precheck (expect 0 rows):
--   select table_name from information_schema.tables where table_schema = 'public'
--     and table_name in ('billing_payments','billing_refunds','billing_documents','billing_document_sequences',
--                        'billing_profiles','billing_tax_rules','account_deletion_events');
--
-- Trap: this migration changes delete behaviour on six existing billing/wallet tables (CASCADE ->
-- SET NULL) and six content tables (CASCADE -> SET NULL, beats.generated_by gains a delete rule for
-- the first time) -- deleting a user no longer destroys these rows, which is the point. No deletion
-- code calls this yet (Unit C); the schema must simply be ready before it does. The `stories`/
-- `storylines` owner policies still compare to `auth.uid()`, so an ownerless row matches no one but
-- the service role and the existing published-content policy -- intended, not a bug.
--
-- Verify: select count(*) from pg_indexes where indexname = 'uq_billing_tax_rules_live';
--         select subject_ref, user_id from public.billing_orders limit 5; -- subject_ref backfilled

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
CREATE INDEX IF NOT EXISTS idx_billing_refunds_payment ON public.billing_refunds (payment_id);

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
CREATE INDEX IF NOT EXISTS idx_billing_documents_subject ON public.billing_documents (subject_ref, issued_at DESC);

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

-- Survival conversion, kept anonymised: subject_ref carries the record forward once user_id is
-- nulled. beat_spend_reservations is deliberately excluded -- a reservation is working state, not
-- a record, and stays CASCADE.
DO $$ BEGIN
  ALTER TABLE public.billing_customers ADD COLUMN IF NOT EXISTS subject_ref uuid;
  UPDATE public.billing_customers SET subject_ref = user_id WHERE subject_ref IS NULL;
  CREATE INDEX IF NOT EXISTS idx_billing_customers_subject_ref ON public.billing_customers (subject_ref);
  ALTER TABLE public.billing_customers DROP CONSTRAINT IF EXISTS billing_customers_user_id_fkey;
  ALTER TABLE public.billing_customers ALTER COLUMN user_id DROP NOT NULL;
  ALTER TABLE public.billing_customers ADD CONSTRAINT billing_customers_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.billing_orders ADD COLUMN IF NOT EXISTS subject_ref uuid;
  UPDATE public.billing_orders SET subject_ref = user_id WHERE subject_ref IS NULL;
  CREATE INDEX IF NOT EXISTS idx_billing_orders_subject_ref ON public.billing_orders (subject_ref);
  ALTER TABLE public.billing_orders DROP CONSTRAINT IF EXISTS billing_orders_user_id_fkey;
  ALTER TABLE public.billing_orders ALTER COLUMN user_id DROP NOT NULL;
  ALTER TABLE public.billing_orders ADD CONSTRAINT billing_orders_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.billing_subscriptions ADD COLUMN IF NOT EXISTS subject_ref uuid;
  UPDATE public.billing_subscriptions SET subject_ref = user_id WHERE subject_ref IS NULL;
  CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_subject_ref ON public.billing_subscriptions (subject_ref);
  ALTER TABLE public.billing_subscriptions DROP CONSTRAINT IF EXISTS billing_subscriptions_user_id_fkey;
  ALTER TABLE public.billing_subscriptions ALTER COLUMN user_id DROP NOT NULL;
  ALTER TABLE public.billing_subscriptions ADD CONSTRAINT billing_subscriptions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.beat_grants ADD COLUMN IF NOT EXISTS subject_ref uuid;
  UPDATE public.beat_grants SET subject_ref = user_id WHERE subject_ref IS NULL;
  CREATE INDEX IF NOT EXISTS idx_beat_grants_subject_ref ON public.beat_grants (subject_ref);
  ALTER TABLE public.beat_grants DROP CONSTRAINT IF EXISTS beat_grants_user_id_fkey;
  ALTER TABLE public.beat_grants ALTER COLUMN user_id DROP NOT NULL;
  ALTER TABLE public.beat_grants ADD CONSTRAINT beat_grants_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.beat_usage_events ADD COLUMN IF NOT EXISTS subject_ref uuid;
  UPDATE public.beat_usage_events SET subject_ref = user_id WHERE subject_ref IS NULL;
  CREATE INDEX IF NOT EXISTS idx_beat_usage_events_subject_ref ON public.beat_usage_events (subject_ref);
  ALTER TABLE public.beat_usage_events DROP CONSTRAINT IF EXISTS beat_usage_events_user_id_fkey;
  ALTER TABLE public.beat_usage_events ALTER COLUMN user_id DROP NOT NULL;
  ALTER TABLE public.beat_usage_events ADD CONSTRAINT beat_usage_events_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.legal_acceptances ADD COLUMN IF NOT EXISTS subject_ref uuid;
  UPDATE public.legal_acceptances SET subject_ref = user_id WHERE subject_ref IS NULL;
  CREATE INDEX IF NOT EXISTS idx_legal_acceptances_subject_ref ON public.legal_acceptances (subject_ref);
  ALTER TABLE public.legal_acceptances DROP CONSTRAINT IF EXISTS legal_acceptances_user_id_fkey;
  ALTER TABLE public.legal_acceptances ALTER COLUMN user_id DROP NOT NULL;
  ALTER TABLE public.legal_acceptances ADD CONSTRAINT legal_acceptances_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

-- Survival conversion, kept ownerless: no subject_ref -- the author credit already lives in
-- storylines.author_name, so nothing needs to link this content back to a person once the account
-- is gone. beats.generated_by has no delete rule today, which would block deletion outright.
DO $$ BEGIN
  ALTER TABLE public.stories DROP CONSTRAINT IF EXISTS stories_user_id_fkey;
  ALTER TABLE public.stories ALTER COLUMN user_id DROP NOT NULL;
  ALTER TABLE public.stories ADD CONSTRAINT stories_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.storylines DROP CONSTRAINT IF EXISTS storylines_user_id_fkey;
  ALTER TABLE public.storylines ALTER COLUMN user_id DROP NOT NULL;
  ALTER TABLE public.storylines ADD CONSTRAINT storylines_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.beats DROP CONSTRAINT IF EXISTS beats_generated_by_fkey;
  ALTER TABLE public.beats ADD CONSTRAINT beats_generated_by_fkey
    FOREIGN KEY (generated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.character_masters DROP CONSTRAINT IF EXISTS character_masters_user_id_fkey;
  ALTER TABLE public.character_masters ALTER COLUMN user_id DROP NOT NULL;
  ALTER TABLE public.character_masters ADD CONSTRAINT character_masters_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.story_bibles DROP CONSTRAINT IF EXISTS story_bibles_user_id_fkey;
  ALTER TABLE public.story_bibles ALTER COLUMN user_id DROP NOT NULL;
  ALTER TABLE public.story_bibles ADD CONSTRAINT story_bibles_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.episode_branches DROP CONSTRAINT IF EXISTS episode_branches_user_id_fkey;
  ALTER TABLE public.episode_branches ALTER COLUMN user_id DROP NOT NULL;
  ALTER TABLE public.episode_branches ADD CONSTRAINT episode_branches_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

-- Gapless per-(financial_year, document_type) numbering: an advisory lock serializes concurrent
-- issuers, then the sequence row is created on first use and incremented atomically.
CREATE OR REPLACE FUNCTION public.billing_next_document_number(
  p_financial_year text,
  p_document_type text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_number integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('billing_document_number:' || p_financial_year || ':' || p_document_type, 0));

  INSERT INTO public.billing_document_sequences (financial_year, document_type, prefix, next_number)
  VALUES (
    p_financial_year,
    p_document_type,
    CASE p_document_type
      WHEN 'receipt' THEN 'RCPT'
      WHEN 'tax_invoice' THEN 'INV'
      WHEN 'credit_note' THEN 'CN'
      ELSE upper(left(p_document_type, 4))
    END,
    1
  )
  ON CONFLICT (financial_year, document_type) DO NOTHING;

  UPDATE public.billing_document_sequences
  SET next_number = next_number + 1, updated_at = now()
  WHERE financial_year = p_financial_year AND document_type = p_document_type
  RETURNING next_number - 1, prefix INTO v_number, v_prefix;

  RETURN v_prefix || '/' || p_financial_year || '/' || lpad(v_number::text, 6, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.billing_next_document_number(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_next_document_number(text, text) TO service_role;

ALTER TABLE public.billing_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_tax_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_document_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_events ENABLE ROW LEVEL SECURITY;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (125, '125_billing_ledger_and_retention.sql')
ON CONFLICT (migration_number) DO NOTHING;
