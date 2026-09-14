# Kisago — Text Model Gateway & Economical Story Pipeline
## Implementation Prompt Pack

This pack is intended to be given to the AI coder working inside the existing Kisago repository.

It is **not** a command to blindly impose a new architecture. The coder must first inspect the repository, understand the existing implementation, reuse established patterns where sensible, and then implement the requested capability in the most practical way for this codebase.

The desired product outcome is:

- Story/text generation is no longer tied to a hardcoded Gemini-only model list.
- Text models can be registered and managed independently from prompts.
- The existing Prompt Playground remains the operational place where task prompts are edited/tested, but its model selector is populated from a shared text-model registry/gateway.
- Multiple providers can coexist behind one Kisago-facing interface.
- Initial provider support should practically cover existing Gemini text usage, OpenAI direct, and OpenRouter as a broad multi-model gateway.
- Current preferred production direction: high-value creative story writing uses GPT-5.6 Luna; low-cost semantic evaluation/planning/classification uses inexpensive models such as Qwen 3.7 Flash or a suitable DeepSeek-class model; deterministic validation happens in code whenever possible before any LLM evaluation call.
- The architecture must make those choices configurable rather than hardcoding today's winners.
- Evaluation must be economical, structured, bounded, and must not create uncontrolled writer ↔ judge loops.
- The existing image-model architecture is already separated and should be treated as a useful reference pattern, not duplicated blindly.
- Existing repository handoff/memory conventions must be continued.

## How to use this pack

Start with `00_MASTER_EXECUTION_PROMPT.md`, then follow the phase prompts in numerical order only where needed. The coder may combine phases if the repository architecture makes that more efficient. Before making structural changes, the coder must inspect the existing project handoff mechanism. After implementation, update the existing handoff; if a feature-specific implementation handoff is more appropriate, create one and link it from the existing handoff structure.

## Important working rule

**Observe → map → propose → implement → test → document.**

Do not begin by renaming large parts of the project, replacing working subsystems, or introducing abstractions purely because they appear in this prompt pack. If an existing abstraction already solves part of the problem, extend it. If a recommendation conflicts with a stronger existing code pattern, security constraint, deployment constraint, SDK limitation, or data-model constraint, adapt the solution and document the reason.
