# PHASE 1 PROMPT — Repository Discovery & Handoff Continuity

Before changing code, map the existing implementation. Do not assume file names or architecture from external conventions.

Find and understand the story/text pipeline, Prompt Playground, existing providers, image model architecture, evaluation system, and the handoff/project-memory mechanism.

For evaluation, classify each current check as: deterministic/code-checkable; semantic/LLM-required; editorial/subjective; legacy/possibly redundant. Identify where the writer model is unnecessarily being used as evaluator.

For handoff, search for HANDOFF files, implementation notes, project memory, agent rules, CLAUDE/CODEX/AI instructions, docs intended for continuation, and architectural decision records. Read relevant files before implementation.

Before coding, output a short repo-grounded implementation note containing current architecture, reusable abstractions, hardcoded coupling points, likely files/modules to change, DB/schema changes if any, proposed migration path, and handoff file(s) you will update. Also list any recommendation from the master prompt you intend to alter because of actual repo constraints. Then proceed unless the decision is destructive or genuinely ambiguous.
