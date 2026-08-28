# Phase 01 — Establish a Quality and Reliability Baseline

Before replacing prompt generation, create a reproducible baseline.

## Fixture Set

Build a version-controlled fixture set covering at least:

- 1 panel, no character
- 1 panel, one character
- 4 panels, two recurring characters
- Character absent in some panels
- Object continuity across panels
- Complex action in one panel
- User-provided overall regeneration instruction
- Per-panel regeneration instruction
- Uploaded character reference
- Generated character reference
- World reference
- Long prompt near current failure boundary
- Multiple providers/models

Include the medieval-market Elrick and Leo scene from `examples/scene_input.json`.

## Record Baseline Data

For the legacy prompt path, record:

- Prompt characters and estimated tokens
- Provider/model
- Request success/failure
- Provider validation errors
- Generation latency
- Image generation cost/coins where available
- Character identity adherence
- Character count correctness
- Clothing consistency
- Scene continuity
- Panel count and order
- Action/object accuracy
- Text/watermark violations

## Evaluation Method

Use a combination of:

- Deterministic structural checks
- Human review rubric
- Existing vision/evaluation tools if already available
- Optional automated image comparison or identity similarity where lawful and appropriate

Do not introduce a costly evaluation model into every production request. Evaluation can run offline or on sampled jobs.

## Scoring Rubric

Score 0–5 for:

- Identity consistency
- Clothing continuity
- Character presence correctness
- Scene/world continuity
- Panel/layout compliance
- Action compliance
- Object continuity
- Style adherence
- Negative constraint compliance
- Overall usability

Store baseline results in a machine-readable format.

## Deliverables

- Fixture set
- Legacy prompt snapshots
- Baseline metrics
- Evaluation rubric
- Repeatable test command
- Report summarising the current failure modes
