# Handover Report Template

## 1. Executive Summary

- What was implemented
- Why it was implemented
- Current rollout mode
- Main measured improvements

## 2. Existing Pipeline Findings

- Architecture summary
- Main prompt-bloat causes
- Provider differences
- Important preserved behaviours

## 3. New Architecture

- Canonical scene JSON
- Visual relevance filter
- Deduplication
- Compiler
- Capability registry
- Provider adapters
- Reference handling
- Prompt budgeting

## 4. Files and Modules Changed

| Area | Files | Purpose |
|---|---|---|
| | | |

## 5. Database and Schema Changes

- Migrations
- Compatibility
- Rollback limitations

## 6. Configuration and Admin Controls

- Feature flags
- Model settings
- Environment variables
- Defaults

## 7. Test Results

- Unit
- Integration
- Snapshot
- Visual evaluation
- Coin/job integrity

## 8. Before/After Metrics

| Metric | Legacy | New | Change |
|---|---:|---:|---:|
| Prompt characters | | | |
| Prompt failures | | | |
| Generation success | | | |
| Identity score | | | |
| Layout score | | | |
| Median latency | | | |

## 9. Model-Specific Behaviour

For each model:

- Adapter strategy
- Prompt budget
- Reference strategy
- Known limitations
- Recommended feature eligibility

## 10. Rollout Status

- Enabled models
- Cohort percentage
- Fallback rate
- Monitoring links

## 11. Known Issues and Future Improvements

- Known limitations
- Deferred work
- Suggested next experiments

## 12. Rollback Procedure

- Exact switch/configuration
- Migration considerations
- Job handling
- Verification steps
