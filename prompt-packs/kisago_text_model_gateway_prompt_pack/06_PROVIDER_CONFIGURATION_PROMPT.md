# PHASE 6 PROMPT — Provider Configuration: OpenAI, OpenRouter, Gemini

Implement provider configuration using existing environment/config conventions.

### OpenAI Direct
Add required server-side OpenAI configuration. Use the current official SDK approach appropriate to the repository/runtime. The initial important use case is the creative writer role, currently expected to use GPT-5.6 Luna. Do not hardcode that model in the provider implementation; accept a configured provider model ID.

### OpenRouter
Add one server-side OpenRouter API key/configuration. Allow registry records to reference arbitrary supported OpenRouter model IDs. OpenRouter is a provider in the Kisago architecture, not the architecture itself. Keep Kisago's registry/policy as application source of truth.

### Gemini
Preserve existing Gemini configuration and wrap/migrate current calls behind the shared text abstraction without unnecessarily rewriting stable code.

A configured model should fail clearly if its provider credentials are unavailable. Never expose secret values. Update `.env.example` or equivalent with variable names only. Audit SDK retries plus application retries so paid calls are not accidentally multiplied. Document any retry behavior that affects cost.
