# PHASE 8 PROMPT — Observability, Testing & Cost Verification

The feature is not complete merely because multiple providers return text. Prove that the correct task uses the correct configured model and that evaluation calls are economically separated.

Use existing logging/telemetry. Useful dimensions: task name, role/purpose, provider, configured model, actual model if available, input/output/cached tokens, latency, status, error type, retry number, correlation/story ID where safe, evaluator vs writer classification. Avoid logging private payloads unless existing system intentionally supports it.

If registry includes pricing metadata, treat it as advisory. Optionally calculate estimated cost only if the codebase already has an appropriate analytics location.

### Unit tests
Registry resolution, provider selection, gateway normalization, structured parsing, evaluator schema, retry cap, missing provider config, disabled model.

### Integration tests
Prompt Playground selection → persisted task config → runtime provider call; writer model != evaluator model; deterministic validation prevents unnecessary evaluator call; evaluator failure produces targeted writer repair; retry cap stops further calls; provider errors surface correctly.

### Regression
Image model/admin pipeline unchanged; existing Gemini path works; story schema valid; current personas/story state continue to function.

If safe credentials exist, make tiny live smoke calls through Gemini, OpenAI direct, and OpenRouter. Do not run broad paid suites. If credentials are absent, say so and use mocks.

Final report must demonstrate that strong writer is used only where intended, cheap evaluator is independently selected, deterministic checks skip model calls, and retry loops are capped.
