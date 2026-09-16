-- 123_image_prompt_budget_3800.sql
--
-- Raises the image prompt compiler's target from 3,000 to 3,800 characters on every row still at 122's value.
--
-- Why: with the composer's brevity rules tightened (invariants may no longer restate style or appearance),
-- real beats compile to ~3,150-3,450 characters. At a 3,000 target every beat tripped `over_target`, so the
-- warning carried no signal. 3,800 sits above a normal beat and still leaves ~1,200 characters under the hard
-- 5,000 cap for reference-image lines and variance.
--
-- Trap: this is the target that triggers lossless compression, not a ceiling. Raising it further eats the cap's
-- margin; lowering it makes every beat compress.
--
-- Verify: select model_key, task_key, capabilities->'promptCompiler'->'promptBudgetChars' from public.image_model_registry where capabilities ? 'promptCompiler';

UPDATE public.image_model_registry
SET capabilities = jsonb_set(capabilities, '{promptCompiler,promptBudgetChars}', '3800'::jsonb)
WHERE capabilities ? 'promptCompiler'
  AND capabilities->'promptCompiler'->'promptBudgetChars' = '3000'::jsonb;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (123, '123_image_prompt_budget_3800.sql')
ON CONFLICT (migration_number) DO NOTHING;
