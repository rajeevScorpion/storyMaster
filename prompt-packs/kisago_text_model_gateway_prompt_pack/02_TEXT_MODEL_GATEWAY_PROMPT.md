# PHASE 2 PROMPT — Kisago Text Model Gateway / Adapter

Implement the application-facing abstraction that allows Kisago text tasks to use different model providers. Task code should not contain scattered provider conditionals. Instead, task code should call a stable Kisago-facing text-generation interface and pass configured model/provider information.

Support Gemini direct, OpenAI direct, and OpenRouter where practical. OpenRouter must accept configured provider model IDs so Qwen, DeepSeek, Claude, OpenAI-family models, etc. do not require new application code for each family.

Normalize only what active Kisago call sites need: text, parsed structured object when required, provider, actual model, finish reason/status, token usage, latency, request/provider ID where useful, normalized error classification. Avoid leaking raw provider responses into client code.

If the story pipeline depends on structured JSON, determine native provider support, validate schema independently, and implement a provider-independent structured-output path where practical. Do not trust “valid JSON” claims without validation.

Support only common parameters Kisago actually uses, such as temperature, output limit, instruction pattern, and schema. Avoid a huge generic option matrix.

Normalize important errors: auth/config missing, model unavailable, rate limit, timeout, malformed structured output, provider failure, and policy refusal where relevant. Never expose or log provider keys.

Create tests around gateway normalization and verify at least one migrated Gemini path.
