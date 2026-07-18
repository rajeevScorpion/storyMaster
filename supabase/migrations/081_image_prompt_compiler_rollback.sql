-- 081_image_prompt_compiler_rollback.sql
-- Reverts 081. Removes the compiler mode flag (the app treats a missing flag as
-- 'legacy') and strips the promptCompiler capability from every registry model.
-- Stored compiled prompts / diagnostics in beats.image_generation_metadata are
-- left intact (historical, harmless, and read-only for the admin comparison).

DELETE FROM public.feature_flags WHERE flag_key = 'image_prompt_compiler_mode';

UPDATE public.image_model_registry
SET capabilities = capabilities - 'promptCompiler'
WHERE capabilities ? 'promptCompiler';
