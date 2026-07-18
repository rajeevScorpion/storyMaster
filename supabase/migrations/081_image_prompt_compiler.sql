-- 081_image_prompt_compiler.sql
-- JSON image prompt optimization: compiler rollout flag + per-model capability
-- defaults.
--
-- Seeds the `image_prompt_compiler_mode` feature flag (value-typed) at 'shadow'
-- so every storyboard image generation compiles the new canonical prompt and
-- records a legacy-vs-compiled comparison in beats.image_generation_metadata,
-- while still SENDING the legacy prompt (zero user-visible change). Modes:
--   legacy                    - existing prompt only, no compilation
--   shadow                    - compile for comparison, send legacy (default)
--   new                       - send the compiled prompt
--   new_with_legacy_fallback  - send compiled, fall back to legacy on failure
-- Kill switch / rollback = set the value back to 'legacy' (or run the rollback).
--
-- Also backfills capabilities.promptCompiler on the enabled Gemini storyboard
-- model(s) so the compiler has a budget + adapter to use. Reels and portraits
-- are intentionally left legacy in this rollout. The compiler stays inert until
-- BOTH the model capability is enabled AND the mode flag is not 'legacy'.

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES ('image_prompt_compiler_mode', true, 'shadow')
ON CONFLICT (flag_key) DO NOTHING;

UPDATE public.image_model_registry
SET capabilities = capabilities || jsonb_build_object(
  'promptCompiler', jsonb_build_object(
    'enabled', true,
    'promptBudgetChars', 2800,
    'supportsNegativePrompt', false,
    'adapterVersion', 'gemini-v1'
  )
)
WHERE provider_key = 'gemini'
  AND task_key = 'image_generation'
  AND NOT (capabilities ? 'promptCompiler');
