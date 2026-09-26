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

-- 125's allocator, verbatim.
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

DELETE FROM public.schema_migration_ledger WHERE migration_number = 135;
