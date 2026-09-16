-- 123_image_prompt_budget_3800_rollback.sql
-- Restores the 3,000 target on rows at 3,800. Trap: a row an admin deliberately set to 3,800 also reverts.

UPDATE public.image_model_registry
SET capabilities = jsonb_set(capabilities, '{promptCompiler,promptBudgetChars}', '3000'::jsonb)
WHERE capabilities ? 'promptCompiler'
  AND capabilities->'promptCompiler'->'promptBudgetChars' = '3800'::jsonb;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 123;
