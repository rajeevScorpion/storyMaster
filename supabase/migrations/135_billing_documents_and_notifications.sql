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
