# Phase 15 — Testing and Image Quality Evaluation

Testing must verify both code correctness and visual outcomes.

## Unit Tests

- Schema validation
- Legacy conversion
- Visual relevance filtering
- Deduplication
- Prompt compilation
- Determinism
- Budget compression
- Provider adapters
- Reference ordering
- Prompt injection boundaries
- Redaction

## Integration Tests

- Story to image job
- Regeneration
- Overall instruction
- Per-panel instruction
- Character references
- World references
- Multiple providers
- Fallback
- Coin handling
- Storage

## Snapshot Tests

Store expected compiled prompts for stable fixtures. Version snapshots intentionally when compiler behaviour changes.

## Visual Evaluation

Compare legacy and new output using the baseline rubric:

- Identity consistency
- Clothing continuity
- Correct character presence
- No cloning
- Scene continuity
- Panel layout
- Action and object correctness
- Style adherence
- Negative constraints

Run enough repeated generations to account for model variance. Do not declare improvement from one lucky output.

## Regression Thresholds

Define measurable acceptance thresholds based on baseline. At minimum:

- No increase in prompt-length failures
- No regression in generation success rate
- No regression in coin/job integrity
- Meaningful median prompt reduction
- Equal or better character and panel consistency on the fixture set

## Performance

Measure:

- Compile latency
- End-to-end latency
- Memory
- Prompt size
- Retry rate

The deterministic compiler should add negligible latency relative to image generation.

## Deliverables

- Automated tests
- Visual evaluation report
- Before/after samples
- Known limitations per model
- Recommendation on models eligible for strict storyboard generation
