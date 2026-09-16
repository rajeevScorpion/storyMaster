# PHASE 9 PROMPT — Rollout, Backward Compatibility & Acceptance

Roll this feature out without destabilizing production. A suggested order is: introduce registry/provider abstraction → put existing Gemini text models behind it → move Prompt Playground model source to registry → add OpenRouter → add OpenAI direct → configure current model policy → split evaluator from writer → introduce deterministic prechecks → enable bounded repair → verify telemetry/cost behavior. Reorder if the codebase suggests a safer sequence.

If new model configuration is missing, preserve an explicit known fallback only if necessary, emit a visible diagnostic, and never silently route to an expensive premium model. Reuse existing feature flags if present; do not invent a new framework merely for this change.

Acceptance checklist:
- Text Model Registry or equivalent exists.
- Admin Text Models management or equivalent is available.
- Prompt Playground pulls from shared source.
- Model selection persists and runtime honors it.
- Gemini direct works.
- OpenAI direct works.
- OpenRouter works.
- Story writer can be configured to Luna.
- Evaluator can be configured independently to Qwen/other cheap model.
- Deterministic validation runs before semantic evaluation where applicable.
- Evaluator returns structured concise output.
- Repair routes back to creative writer.
- Retry loop is bounded.
- Provider errors/unavailability are handled.
- Secrets remain server-side.
- Usage/model telemetry exists.
- Image pipeline is unchanged.
- Existing story/persona behavior is preserved.
- Tests/build/typecheck pass or pre-existing failures are clearly separated.
- Handoff is updated.

Do not mark an item complete unless verified.
