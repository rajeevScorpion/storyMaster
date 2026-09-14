# MASTER EXECUTION PROMPT
## Implement configurable text-model infrastructure and an economical story-quality pipeline in Kisago

You are working inside the existing Kisago codebase.

Your job is to implement the complete feature described below, but **do not treat this document as a rigid architecture prescription**. First inspect the repository deeply enough to understand how the current system actually works.

Use the existing codebase as the source of truth for framework conventions, server/client boundaries, database conventions, secrets handling, provider SDK patterns, admin UI patterns, prompt versioning, current story generation flow, evaluation flow, observability/logging, deployment assumptions, and the existing handoff/project-memory mechanism.

The recommendations below describe the intended product behavior and preferred architecture direction. Adapt them pragmatically.

## Product context

Kisago has an agentic story creation system with personas and a set of text-generation tasks. The Admin Prompt Playground currently exposes task-specific prompt configurations such as Story Generation, Seed Plan Generation, Seeded Beat Materialization, Story Bible Writer, Visual Prompt Composer, and other text-related tasks. Historically these tasks have largely used Gemini models from a hardcoded or tightly coupled model list.

Image generation has already been separated into its own configurable model/provider system in Admin. The text side now needs a similar level of provider/model independence.

The key requirement is **not** merely “add OpenAI”. The goal is to make Kisago capable of selecting the right model for each text task economically and safely.

## Desired capability

Implement a Kisago-facing text model layer that allows tasks to select configured text models without needing task code to know provider-specific API details. A useful conceptual shape is:

Prompt / Task → Task Model Policy or configured model → Kisago Text Model Gateway / Adapter → Provider implementation → normalized result

Potential providers:
- Gemini direct — preserve existing supported behavior where practical.
- OpenAI direct — particularly useful for the current preferred creative writer.
- OpenRouter — broad access to Qwen, DeepSeek, Claude, OpenAI models and others through a common provider.

Do not assume this exact class/file structure is correct for the repo. Reuse or extend existing abstractions if they already exist.

## Current model strategy — treat as configurable defaults, not hardcoded truth

Recent controlled creative-writing tests favored **GPT-5.6 Luna** as the current primary story-writing model. The architecture should therefore make it easy to configure a high-quality writer role to Luna now, while allowing this to change later without code changes.

Suggested starting policy:
- `creative_writer`: current preferred model GPT-5.6 Luna; preferred provider route OpenAI direct for production reliability; OpenRouter may also expose the model and can be useful for experimentation/fallback where appropriate.
- `cheap_evaluator`: use a much cheaper reliable model; initial candidates include Qwen 3.7 Flash or a suitable inexpensive DeepSeek-class model through OpenRouter.
- `planner` / `classifier` / `metadata` / `continuity_checker`: prefer low-cost models where quality is sufficient.
- `premium_editor` / `rescue`: optional escalation role only; do not invoke by default for every story.

These are policy defaults, not persona-level hardcoding and not permanent model decisions.

## Critical architecture principle

**Do not hardcode model names into persona logic, story personas, evaluation logic, or scattered task code.**

Prefer stable Kisago model IDs or role aliases, a model registry, provider metadata, task-to-model configuration, optional task overrides, optional provider fallbacks, and admin-managed configuration. If the existing codebase already has a stronger equivalent abstraction, use it.

## Admin requirements

Add or extend an Admin capability for **Text Models**, conceptually comparable to the already separated Image Models area.

At minimum, determine a practical representation for internal model/config ID, display name, provider, provider model identifier, enabled/disabled, capabilities or task suitability where useful, optional cost metadata, optional context/output metadata if already useful in the product, default parameters where appropriate, and provider routing information. Do not expose secrets in the browser or database in unsafe form.

The Prompt Playground should continue to manage prompts. Its model dropdown should obtain options from the text-model registry rather than a Gemini-specific hardcoded model list. Preserve existing prompt versioning/publication behavior.

## Provider support

Implement or extend provider adapters behind one application-facing text interface.

### OpenAI direct
Support the application’s required text generation behavior through the current OpenAI SDK/API pattern appropriate to the repo. This is the preferred initial route for the current `creative_writer` model.

### OpenRouter
Add an OpenRouter provider so one account/API key can expose multiple model families. The provider layer should allow configured OpenRouter model IDs rather than baking Qwen/DeepSeek/etc. into application code.

### Gemini
Preserve existing Gemini text functionality and migrate it behind the same application-facing abstraction where practical. Do not break existing production behavior merely to achieve theoretical purity.

## Normalize only what Kisago needs

Provider APIs differ. Do not create a huge “universal LLM standard” unless the codebase already has one. Create the smallest stable normalized contract Kisago actually requires, for example generated text/parsed structured output, finish status, usage metadata, model/provider used, latency, provider request ID if useful, error category, and optional raw provider metadata kept server-side where appropriate. If the story pipeline depends on JSON/schema output, centralize structured output handling sensibly. Keep provider-specific options available only where genuinely necessary.

## Economical evaluation strategy

The quality system should not automatically use the same expensive creative model for every validation step.

### Layer 1 — deterministic checks first
Anything reliably checkable in code should not consume an LLM call. Examples to consider where applicable: JSON/schema validity, required fields, empty/malformed values, beat count, option count, length constraints, IDs, known character references, forbidden exact strings, duplicate exact titles, enum values, language/config consistency, known story-state invariants, and other existing hardcoded checks. Do not invent rules that conflict with current story semantics. Discover the current eval specification first.

### Layer 2 — cheap semantic evaluator
Use a configurable low-cost evaluator for checks that actually require semantic judgment: continuity, contradiction detection, age fit, repetition, weak coherence, narrative requirement coverage, character consistency, obvious factual/logic problems, and learning-value alignment where applicable. The evaluator should return compact structured output, not a long essay. Do not request or persist raw chain-of-thought.

### Layer 3 — targeted repair by the creative writer
If the evaluator finds repairable problems, send the minimum necessary story context + specific issues back to the configured writer, ask for a targeted repair, preserve the strong model's narrative voice, and avoid asking the cheap evaluator to rewrite the story itself.

### Bound the loop
Do not permit uncontrolled model-call recursion. Discover current retry/eval behavior and implement a sensible configurable cap. A starting target might be: Generate → deterministic validate → cheap semantic evaluate → if failed, one targeted writer repair → re-evaluate → if still failed, either one final bounded attempt or mark/escalate according to existing workflow. The exact limit must be grounded in existing application behavior and cost/risk tolerance.

## Editorial quality vs operational evaluation

Where helpful, distinguish operational evaluation (cheap and systematic) from editorial quality monitoring (potentially stronger and more expensive). Do not automatically run a premium judge on every story unless the existing product requirement demands it. Design the architecture so a stronger editorial model can later be sampled on a subset of content or invoked on escalation.

## Task economics

Inspect every current text task before assigning a model. Do not simply replace every Gemini call with Luna. Likely direction, subject to repo inspection:
- Story Generation → strong creative writer.
- Seed Plan Generation → inexpensive planner may be sufficient.
- Seeded Beat Materialization → strong writer if it produces final user-facing narrative; cheaper model if it is structural intermediate output.
- Story Bible Writer → inexpensive capable structured model may suffice.
- Visual Prompt Composer → inexpensive capable model may suffice; preserve compatibility with image pipeline expectations.
- Classification / metadata → cheapest reliable model.
- Semantic evaluation → cheap evaluator.
- Story repair → creative writer.
- Exceptional editorial rescue → optional stronger model.

Document the final mapping you implement and why.

## Cost-awareness

Where the codebase supports it without excessive complexity, record usage metadata: provider, model, input tokens, output tokens, cached tokens if available, latency, call purpose/task, success/failure, retry count. If there is already analytics/telemetry, integrate there. Do not build a large billing subsystem unless needed. The main goal is to make future cost comparison possible.

## Fallbacks

Provider fallback behavior can improve reliability but can also create surprising costs and model-quality changes. If implementing fallback, make it explicit/configurable, log the actual model/provider used, avoid silent premium escalation, avoid fallback loops, preserve structured-output requirements, and keep safety/schema behavior consistent. If the current codebase is not ready for robust fallback logic, it is acceptable to implement the provider abstraction first and document fallback as a later extension.

## Migration requirements

The existing system must continue working during migration. Identify hardcoded Gemini model arrays, task-level model strings, provider-specific response parsing, Gemini-specific helper functions, evaluation code calling the writer model, admin dropdown assumptions, environment variables, tests and fixtures. Migrate incrementally. Do not remove old code until all active call sites are moved or intentionally preserved. If DB migrations are needed, make them safe and preserve current task behavior until the admin/model registry is configured.

## Handoff requirement

Before implementation, find the project’s existing handoff/memory/continuation mechanism, read the relevant handoff material, and continue its conventions. After implementation, update the existing handoff with architecture introduced, files changed, DB changes, environment variables, provider configuration, model registry behavior, current task/model defaults, evaluation loop, known limitations, testing completed, and remaining follow-ups.

If the existing handoff would become too cluttered, create a feature-specific handoff such as `TEXT_MODEL_GATEWAY_HANDOFF.md` or whatever naming convention fits the repo, link/reference it from the existing handoff mechanism, and tell the user exactly where it lives and why it was created. Do not create competing undocumented memory systems.

## Required workflow

### Step 1 — inspect
Before implementation, inspect the repo and report current text generation flow, current model-selection mechanism, where Prompt Playground stores/selects models, current Gemini integration, current evaluation loop, existing image adapter architecture, existing handoff mechanism, and DB/config structures likely to be reused.

### Step 2 — implementation plan
Produce a concise plan grounded in actual files/modules. Explicitly state what from this prompt will be implemented as suggested, what will be adapted, and what will not be implemented and why. Do not wait for approval unless you encounter a materially ambiguous destructive choice.

### Step 3 — implement
Carry the feature through end-to-end.

### Step 4 — test
At minimum test existing Gemini text path, OpenAI direct path, OpenRouter path, Prompt Playground model selection, persisted model selection/config, story generation, cheap evaluator path, targeted repair, bounded retry behavior, errors, disabled/unavailable model handling, structured output, and server-side secret handling. Use mocks where live paid calls are inappropriate, but perform a minimal real integration smoke test if the repo/environment safely supports it and credentials are available. Never expose secrets.

### Step 5 — document and hand off
Report exactly what changed and how Admin should configure Luna/creative writer, cheap evaluator, provider keys, model IDs, and task assignments.

## Acceptance criteria

The feature is complete when:
1. Text tasks are no longer constrained to a hardcoded Gemini-only model list.
2. Text providers are abstracted enough that Gemini, OpenAI direct, and OpenRouter can coexist.
3. Admin can manage/select enabled text models through the implemented registry/configuration pattern.
4. Prompt Playground task model selectors use the shared text-model source.
5. The selected model is persisted and actually controls runtime execution.
6. Story generation can use the configured strong writer.
7. Evaluations can use a different cheaper configured model.
8. Deterministic checks avoid LLM calls where appropriate.
9. Failed semantic checks can produce targeted repair instructions for the writer.
10. Retry/evaluation loops are bounded.
11. Provider/model usage is observable enough to debug and compare cost.
12. Existing image-model behavior remains intact.
13. Existing Gemini functionality is not unintentionally broken.
14. Secrets remain server-side and secure.
15. Tests/build/type checks pass to the extent supported by the repo.
16. Existing handoff documentation is updated.
17. The final report clearly identifies any deviation from this proposed architecture and explains why.

## Final response expected from you

Give the user: What you found; What you implemented; Model routing now in effect; Economics; Admin workflow; Environment/config; Testing; Handoff; Deviations/follow-ups. Do not claim completion for any item you did not actually verify.
