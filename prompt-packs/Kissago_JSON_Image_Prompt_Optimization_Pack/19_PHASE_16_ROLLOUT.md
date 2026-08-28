# Phase 16 — Production Rollout

Roll out only after the acceptance checklist is satisfied.

## Suggested Sequence

1. Development fixtures
2. Shadow mode in development
3. Internal accounts in staging
4. One strong provider/model in staging
5. Limited production cohort
6. Increase cohort gradually
7. Enable additional providers individually
8. Consider default enablement
9. Retain legacy fallback for an agreed observation period

Adapt this sequence to the project's actual deployment process.

## Go/No-Go Review

Before each expansion, review:

- Prompt reduction
- Provider failure rate
- Character consistency
- Layout compliance
- Fallback rate
- User regeneration behaviour
- Coin/job integrity
- Cost and latency
- Support reports

## Incident Response

If quality or reliability regresses:

- Disable the affected model adapter.
- Return its traffic to legacy mode.
- Preserve logs and generation metadata.
- Do not delete new scene JSON.
- Diagnose by compiler/adapter version.

## Final Clean-up

Do not remove the legacy path immediately. After a stable observation period:

- Confirm no required historical path depends on it.
- Archive legacy snapshots and documentation.
- Remove dead code in a separate reviewed change.
- Retain migration compatibility for old scene records.

## Deliverables

- Rollout report
- Monitoring dashboard references
- Incident/rollback instructions
- Final recommendation for default mode
