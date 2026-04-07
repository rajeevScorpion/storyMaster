-- 021_pricing_enforcement_primitives_rollback.sql
-- Roll back free allowance grant support, bypass runtime flag,
-- and reservation helper functions.

DROP FUNCTION IF EXISTS public.pricing_expire_stale_reservations();
DROP FUNCTION IF EXISTS public.pricing_release_reservation(uuid, uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.pricing_finalize_reservation(uuid, uuid, uuid, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.pricing_authorize_spend(uuid, text, integer, text, uuid, text, uuid, timestamptz, jsonb);

DELETE FROM public.feature_flags
WHERE flag_key = 'pricing_admin_bypass_enabled';

DELETE FROM public.beat_grants
WHERE source_type = 'free_allowance';

ALTER TABLE public.beat_grants
  DROP CONSTRAINT IF EXISTS beat_grants_source_type_check;

ALTER TABLE public.beat_grants
  ADD CONSTRAINT beat_grants_source_type_check
  CHECK (
    source_type IN (
      'subscription',
      'carry_forward',
      'topup',
      'promotion',
      'admin_adjustment',
      'migration_grant'
    )
  );
