# DECISION CONTEXT FOR CODER
## Why the current recommendations exist

This file is context, not an implementation mandate.

The project recently compared multiple story-writing models using the same controlled short-story prompt. The current practical conclusion was that **GPT-5.6 Luna produced the strongest overall story result for this use case**, including narrative causality, character voice, imaginative mechanism, emotional payoff, and age-appropriate storytelling. The team also compared it against Claude in a separate test and currently prefers Luna for the production creative-writing role.

Economy is a serious concern. Therefore the architecture should avoid paying creative-writer prices for every supporting call.

The project direction is:
- use the strong creative model where prose/story quality materially matters,
- use cheap capable models for evaluation/planning/metadata,
- use deterministic code for checks that do not need an LLM,
- route repairs back to the creative writer,
- keep loops bounded,
- make all of this configurable so future benchmark results can change model choices without rewriting the system.

The project has specifically considered inexpensive Qwen and DeepSeek models for evaluator/utility roles, with OpenRouter as a convenient gateway.

The project does **not** want model names embedded into personas, one provider controlling the architecture, every task using the same expensive model, evaluator models rewriting final prose, uncontrolled multi-agent back-and-forth, or the Prompt Playground becoming coupled to a new hardcoded model list.

The project already has a separate image-model architecture. Treat it as evidence that provider/model separation is an established product direction.
