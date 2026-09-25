-- 137_billing_checkout_allowlist.sql
--
-- Payments Phase 7 (owner decision R3): a named-account rollout switch. enabled = checkout is restricted
-- to the user ids in value (comma-separated); disabled or absent = open to everyone. The global kill
-- switch is still pricing_checkout_enabled.
--
-- Trap: enabled means "restricted", the opposite of most flags. Turning it on with an empty value closes
-- checkout to everyone.
--
-- Verify: select flag_key, enabled, value from public.feature_flags where flag_key = 'billing_checkout_allowlist';

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES ('billing_checkout_allowlist', false, '')
ON CONFLICT (flag_key) DO NOTHING;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (137, '137_billing_checkout_allowlist.sql')
ON CONFLICT (migration_number) DO NOTHING;
