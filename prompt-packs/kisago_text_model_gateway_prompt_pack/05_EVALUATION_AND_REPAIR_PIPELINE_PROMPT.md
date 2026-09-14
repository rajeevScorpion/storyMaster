# PHASE 5 PROMPT — Economical Evaluation, Quality Gates & Repair

Refactor the story-quality pipeline so quality is preserved without repeatedly using the expensive creative writer for checks that do not require it. Start by documenting the current evaluation path exactly.

## 1. Deterministic validation
Move reliably checkable rules to code where appropriate: schema validity, required fields, beat/option counts, invalid IDs, missing characters, malformed state, invalid enums, exact duplicates, hardcoded forbidden terms, output length bounds, story configuration mismatch, and explicit continuity invariants. Do not turn nuanced semantic rules into brittle string checks.

## 2. Cheap semantic evaluator
Use a separately configurable evaluation model. It must not implicitly be “the same model as story generation”. Give it only the context required to judge the current output. Require concise structured output containing pass/fail, scores where useful, stable issue codes, severity, location, repair instruction, and confidence. Do not request chain-of-thought.

## 3. Repair
The evaluator diagnoses; it does not become the final writer. Route repair to the configured creative writer, send specific issue instructions, preserve state/structure, and regenerate only the minimum necessary scope where architecture permits.

## 4. Bound retries
Implement a finite configurable policy. A reasonable starting pattern is generation → deterministic validation → semantic evaluation → one repair → one re-evaluation → optional final bounded escalation only if current workflow requires it. Ground the exact cap in current application behavior.

## 5. Stage-specific evaluation
Do not over-evaluate every stage. Plan stage may check structure/redundancy; beat generation may check continuity/age fit/coherence; final story may receive higher-level quality review if required.

## 6. Preserve safety
Do not remove existing safety or age-suitability controls while optimizing cost.

## 7. Observability
Track generation attempt, deterministic fail reason, evaluator model/provider, evaluation result, repair attempt, final status, and number of model calls so average calls/story, repair rate, failure reasons, and model cost distribution can later be understood.
