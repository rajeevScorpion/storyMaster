-- Rolling back returns the runtime to Gemini-only legacy mode; any task pointing at a non-Gemini key
-- drops to its code default.
DROP TABLE IF EXISTS public.text_model_registry;
DROP FUNCTION IF EXISTS public.touch_text_model_registry_updated_at();
DELETE FROM public.schema_migration_ledger WHERE migration_number = 119;
