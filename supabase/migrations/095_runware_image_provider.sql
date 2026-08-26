-- Runware image provider: open-weight models as a low-cost lane alongside the direct
-- Gemini/OpenAI/xAI adapters, which are unchanged.
--
-- Rows ship disabled and studio-only. Enable them only after confirming each model's real
-- per-image price and latency in the Runware Playground, since Runware publishes no public
-- per-model pricing.

ALTER TABLE public.image_model_registry
  DROP CONSTRAINT IF EXISTS image_model_registry_provider_key;

ALTER TABLE public.image_model_registry
  ADD CONSTRAINT image_model_registry_provider_key CHECK (
    provider_key IN ('gemini', 'openai', 'xai', 'runware')
  );

-- capabilities.continuityFamily pairs each storyboard model with the portrait model that
-- renders faces the same way. Without it, one provider key fronting several unrelated model
-- families could pair a FLUX storyboard with a Seedream portrait.

INSERT INTO public.image_model_registry (
  task_key,
  provider_key,
  model_key,
  provider_model_id,
  display_name,
  description,
  badge,
  is_enabled,
  is_user_visible,
  is_admin_test_enabled,
  is_default,
  is_recommended,
  allowed_plan_keys,
  coin_cost_per_image,
  provider_cost_per_output_image_usd,
  provider_cost_per_input_image_usd,
  capabilities,
  required_env_vars,
  sort_order
) VALUES
  -- FLUX.2 -----------------------------------------------------------------
  (
    'image_generation', 'runware', 'runware-flux-2-dev', 'runware:400@1',
    'FLUX.2', 'Sharp prompt accuracy, best value', 'Admin only',
    FALSE, FALSE, TRUE, FALSE, FALSE,
    ARRAY['studio']::TEXT[], 0, 0.010000, 0,
    '{"aspectRatios":["16:9","9:16","1:1"],"supportsReferences":true,"supportsBase64":true,"maxReferenceImages":4,"continuityFamily":"flux-2","promptCompiler":{"enabled":true,"promptBudgetChars":2800,"supportsNegativePrompt":true,"adapterVersion":"neutral-v1"}}'::JSONB,
    ARRAY['RUNWARE_API_KEY']::TEXT[], 60
  ),
  (
    'reel_image_generation', 'runware', 'runware-flux-2-dev', 'runware:400@1',
    'FLUX.2', 'Sharp prompt accuracy, best value', 'Admin only',
    FALSE, FALSE, TRUE, FALSE, FALSE,
    ARRAY['studio']::TEXT[], 0, 0.010000, 0,
    '{"aspectRatios":["9:16"],"supportsReferences":true,"supportsBase64":true,"maxReferenceImages":4,"continuityFamily":"flux-2","promptCompiler":{"enabled":true,"promptBudgetChars":2800,"supportsNegativePrompt":true,"adapterVersion":"neutral-v1"}}'::JSONB,
    ARRAY['RUNWARE_API_KEY']::TEXT[], 60
  ),
  (
    'portrait_generation', 'runware', 'runware-flux-2-dev-portrait', 'runware:400@1',
    'FLUX.2 Portrait', 'Character reference renderer for FLUX.2 stories', 'Admin only',
    FALSE, FALSE, TRUE, FALSE, FALSE,
    ARRAY['studio']::TEXT[], 0, 0.010000, 0,
    '{"aspectRatios":["1:1"],"supportsReferences":true,"supportsBase64":true,"maxReferenceImages":4,"continuityFamily":"flux-2"}'::JSONB,
    ARRAY['RUNWARE_API_KEY']::TEXT[], 60
  ),

  -- Seedream 5 Lite --------------------------------------------------------
  (
    'image_generation', 'runware', 'runware-seedream-5-lite', 'bytedance:seedream@5.0-lite',
    'Seedream 5 Lite', 'Fastest drafts', 'Admin only',
    FALSE, FALSE, TRUE, FALSE, FALSE,
    ARRAY['studio']::TEXT[], 0, 0.003000, 0,
    '{"aspectRatios":["16:9","9:16","1:1"],"supportsReferences":true,"supportsBase64":true,"maxReferenceImages":4,"continuityFamily":"seedream-5","promptCompiler":{"enabled":true,"promptBudgetChars":2800,"supportsNegativePrompt":true,"adapterVersion":"neutral-v1"}}'::JSONB,
    ARRAY['RUNWARE_API_KEY']::TEXT[], 61
  ),
  (
    'reel_image_generation', 'runware', 'runware-seedream-5-lite', 'bytedance:seedream@5.0-lite',
    'Seedream 5 Lite', 'Fastest drafts', 'Admin only',
    FALSE, FALSE, TRUE, FALSE, FALSE,
    ARRAY['studio']::TEXT[], 0, 0.003000, 0,
    '{"aspectRatios":["9:16"],"supportsReferences":true,"supportsBase64":true,"maxReferenceImages":4,"continuityFamily":"seedream-5","promptCompiler":{"enabled":true,"promptBudgetChars":2800,"supportsNegativePrompt":true,"adapterVersion":"neutral-v1"}}'::JSONB,
    ARRAY['RUNWARE_API_KEY']::TEXT[], 61
  ),
  (
    'portrait_generation', 'runware', 'runware-seedream-5-lite-portrait', 'bytedance:seedream@5.0-lite',
    'Seedream 5 Lite Portrait', 'Character reference renderer for Seedream stories', 'Admin only',
    FALSE, FALSE, TRUE, FALSE, FALSE,
    ARRAY['studio']::TEXT[], 0, 0.003000, 0,
    '{"aspectRatios":["1:1"],"supportsReferences":true,"supportsBase64":true,"maxReferenceImages":4,"continuityFamily":"seedream-5"}'::JSONB,
    ARRAY['RUNWARE_API_KEY']::TEXT[], 61
  ),

  -- Qwen Image 3 -----------------------------------------------------------
  (
    'image_generation', 'runware', 'runware-qwen-image-3', 'alibaba:qwen-image@3.0',
    'Qwen Image 3', 'Strongest in-image text', 'Admin only',
    FALSE, FALSE, TRUE, FALSE, FALSE,
    ARRAY['studio']::TEXT[], 0, 0.008000, 0,
    '{"aspectRatios":["16:9","9:16","1:1"],"supportsReferences":true,"supportsBase64":true,"maxReferenceImages":4,"continuityFamily":"qwen-image-3","promptCompiler":{"enabled":true,"promptBudgetChars":2800,"supportsNegativePrompt":true,"adapterVersion":"neutral-v1"}}'::JSONB,
    ARRAY['RUNWARE_API_KEY']::TEXT[], 62
  ),
  (
    'reel_image_generation', 'runware', 'runware-qwen-image-3', 'alibaba:qwen-image@3.0',
    'Qwen Image 3', 'Strongest in-image text', 'Admin only',
    FALSE, FALSE, TRUE, FALSE, FALSE,
    ARRAY['studio']::TEXT[], 0, 0.008000, 0,
    '{"aspectRatios":["9:16"],"supportsReferences":true,"supportsBase64":true,"maxReferenceImages":4,"continuityFamily":"qwen-image-3","promptCompiler":{"enabled":true,"promptBudgetChars":2800,"supportsNegativePrompt":true,"adapterVersion":"neutral-v1"}}'::JSONB,
    ARRAY['RUNWARE_API_KEY']::TEXT[], 62
  ),
  (
    'portrait_generation', 'runware', 'runware-qwen-image-3-portrait', 'alibaba:qwen-image@3.0',
    'Qwen Image 3 Portrait', 'Character reference renderer for Qwen stories', 'Admin only',
    FALSE, FALSE, TRUE, FALSE, FALSE,
    ARRAY['studio']::TEXT[], 0, 0.008000, 0,
    '{"aspectRatios":["1:1"],"supportsReferences":true,"supportsBase64":true,"maxReferenceImages":4,"continuityFamily":"qwen-image-3"}'::JSONB,
    ARRAY['RUNWARE_API_KEY']::TEXT[], 62
  )
ON CONFLICT (task_key, model_key) DO UPDATE SET
  provider_key = EXCLUDED.provider_key,
  provider_model_id = EXCLUDED.provider_model_id,
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  badge = EXCLUDED.badge,
  provider_cost_per_output_image_usd = EXCLUDED.provider_cost_per_output_image_usd,
  provider_cost_per_input_image_usd = EXCLUDED.provider_cost_per_input_image_usd,
  capabilities = EXCLUDED.capabilities,
  required_env_vars = EXCLUDED.required_env_vars,
  sort_order = EXCLUDED.sort_order;
