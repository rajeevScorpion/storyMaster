# Background Jobs, Retry and Idempotency

## Requirement

Reference processing must survive browser closure. Use existing durable job/worker infrastructure.

## State machine

Recommended conceptual states:

```text
draft
uploaded
validating
analysing
awaiting_adoption
generating
quality_checking
storing
updating_story_bible
completed
failed_retryable
failed_permanent
cancelled
superseded
```

Map to current job conventions.

## Job snapshot

Each job should capture:

- user/tier entitlement snapshot
- resolved settings
- style ID/version
- provider/model
- source checksum
- adoption version
- cost estimate/reservation ID
- branch/beat scope
- retry policy

## Idempotency

Protect:

- upload completion
- analysis
- generation
- canonical asset insertion
- Story Bible update
- coin finalize/refund
- notification

A worker retry must resume safely.

## Cancellation

Allow cancellation only where current job system safely supports it.

Cancellation must:

- stop future work
- not corrupt completed steps
- settle reserved coins correctly
- mark orphan cleanup
- prevent stale completion from reactivating adoption

## Deployment resilience

- Jobs created before deployment remain readable.
- Schema and worker changes are backwards-compatible during rollout.
- New workers can process old job versions or route them to a compatibility handler.
- Queue messages reference durable IDs, not full private payloads.

## Notifications

Reuse current job-complete notification behaviour.

Show:

- reference ready
- action required
- failed/refunded
- story generation resumed

Avoid notification spam for internal retries.
