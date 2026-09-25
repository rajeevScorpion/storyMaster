# Handoff, commits, documentation and rollback protocol

Use the repository's existing working-agreement/handoff files if present. Do not create parallel governance docs unless the repo genuinely lacks them.

## At start of every session
Read:
- working agreements;
- project state;
- decision log;
- test status;
- latest handoff;
- git status/log.

Resume from repository evidence, not chat memory.

## Commit discipline

Before a phase:
- ensure intended branch;
- isolate unrelated owner changes.

During a phase:
- keep changes scoped;
- do not make drive-by refactors.

Before commit:
1. run relevant tests;
2. inspect `git diff`;
3. inspect `git status`;
4. selectively stage intended files;
5. update living docs/handoff;
6. commit with a meaningful phase/result message.

Do not push unless the owner asked.

## Migration discipline

Every migration plan must state:
- why needed;
- data prechecks;
- forward SQL;
- compatibility during rollout;
- backfill;
- verification query;
- rollback or compensating strategy;
- whether rollback is unsafe after live financial writes.

Never delete live financial data as a rollback shortcut.

## Feature flags / disable path

Every risky new surface should have an operational disable strategy where practical:
- checkout;
- new Audience purchase;
- consumption quota;
- invoice email;
- scheduled reconcile.

A flag must be enforced server-side if it controls money/entitlement.

## Decision log

Record:
- owner decisions;
- provider constraints;
- tax/CA confirmations;
- intentional deviations from audit recommendations;
- why a chosen design was selected.

## Session handoff must include

- branch;
- commit hash;
- scope completed;
- files changed;
- migrations applied/pending;
- flags/config required;
- manual provider steps;
- tests/results;
- known issues;
- unanswered decision gates;
- rollback/disable instructions;
- exact next recommended prompt/phase.

Then **STOP**.
