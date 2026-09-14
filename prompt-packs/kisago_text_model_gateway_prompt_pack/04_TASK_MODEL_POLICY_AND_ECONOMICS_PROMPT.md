# PHASE 4 PROMPT — Task/Model Policy & Economic Routing

After the shared registry works, review each active text task and determine what level of model quality it actually needs. Do not globally replace Gemini with Luna.

Use the strongest creative model only where creative quality materially affects the product. Use cheaper capable models for structural, classificatory, evaluative, and metadata work. Keep mappings configurable.

Current preferred starting direction:
- Story Generation / final user-facing prose / targeted creative repair → GPT-5.6 Luna.
- Seed Plan Generation → cheap capable model.
- Story Bible Writer → cheap capable structured model.
- Classification / metadata → cheapest reliable model.
- Semantic / continuity evaluator → Qwen 3.7 Flash or similarly cheap capable model.
- Visual Prompt Composer → cheap capable model unless current Gemini behavior is materially better.
- Exceptional editorial rescue → optional stronger model, not default.

For Seeded Beat Materialization, inspect what it actually produces. If final reader-facing prose, strong creative quality may be justified; if intermediate structure, use a cheaper model. Document the conclusion.

Prefer task-selected registry IDs, role aliases, global defaults + task override, or another repo-native equivalent. Avoid persona-level hardcoded model names and hidden expensive fallbacks.

Where practical, set sensible output limits, minimize evaluator context, avoid evaluator essays, use caching where already supported, and cap retries. Add the final mapping to handoff.
