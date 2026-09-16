-- 122_image_prompt_budget_target_rollback.sql
-- Restores 2,800 on rows at 3,000. Trap: a row an admin deliberately set to 3,000 after 122 also reverts.

UPDATE public.image_model_registry
SET capabilities = jsonb_set(capabilities, '{promptCompiler,promptBudgetChars}', '2800'::jsonb)
WHERE capabilities ? 'promptCompiler'
  AND capabilities->'promptCompiler'->'promptBudgetChars' = '3000'::jsonb;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 122;
