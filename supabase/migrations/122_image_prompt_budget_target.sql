-- 122_image_prompt_budget_target.sql
--
-- Raises the image prompt compiler's target from 2,800 to 3,000 characters on every model still at the 081 default.
--
-- Trap: promptBudgetChars is now the target, not a ceiling. The compiler may go over it up to a hard 5,000 and
-- already subtracts reference-image lines itself; do not lower it to make room for them.
-- Rows an admin set to any other value are left alone.
--
-- Verify: select model_key, task_key, capabilities->'promptCompiler'->'promptBudgetChars' from public.image_model_registry where capabilities ? 'promptCompiler';

UPDATE public.image_model_registry
SET capabilities = jsonb_set(capabilities, '{promptCompiler,promptBudgetChars}', '3000'::jsonb)
WHERE capabilities ? 'promptCompiler'
  AND capabilities->'promptCompiler'->'promptBudgetChars' = '2800'::jsonb;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (122, '122_image_prompt_budget_target.sql')
ON CONFLICT (migration_number) DO NOTHING;
