# PHASE 3 PROMPT — Text Model Registry & Admin Management

Create or extend a shared source of truth for text models available to Kisago. The purpose is to remove the hardcoded Gemini model dependency in Prompt Playground and allow configuration changes without code changes.

First inspect the existing Image Models implementation and reuse suitable persistence/admin/provider patterns without blindly combining text and image requirements.

Support the equivalent of: stable internal ID, display name, provider key, provider model ID, enabled/disabled, optional description, optional role/capability tags, optional cost metadata, optional defaults, and normal created/updated metadata. Useful optional fields include structured-output support, context/output limits, preferred role, pricing, and routing notes. Runtime correctness must not depend on stale marketing metadata.

Seed entries only if the repo has a safe pattern. Candidate initial configuration: GPT-5.6 Luna via OpenAI direct for creative writing; Qwen 3.7 Flash via OpenRouter for evaluation/planning; optional inexpensive DeepSeek model via OpenRouter; existing Gemini models for compatibility. Use exact provider model identifiers supported by actual SDK/config at implementation time; do not guess from this document.

Add **Text Models** to Admin in a way consistent with existing navigation and visual language. Prompt Playground should read enabled text models from this registry. Model selection must persist and runtime must honor it. Handle disabled/deleted models gracefully.

If existing prompt records store raw Gemini IDs, plan a safe mapping/migration or compatibility resolver so published prompts do not break. Document how old records are handled.
