# 13 — Commit, Branch, and Reporting Rules

Apply these rules throughout the Gallery transformation.

## Before changing anything
- inspect `git status`
- identify existing uncommitted user work
- do not overwrite or revert unrelated changes
- if the working tree is dirty, isolate your edits carefully
- inspect recent commit naming conventions

## Commit rules
- one coherent concern per commit
- do not mix formatting-only changes with feature work
- do not mix schema changes with unrelated UI cleanup
- do not commit generated build artifacts unless the repository already tracks them
- do not commit secrets, local env files, logs, or temporary screenshots
- do not rewrite history unless explicitly instructed
- do not force-push

## Suggested phase-shaped commits
Adapt wording to existing repository conventions.

Examples:
- `refactor(gallery): serve storyline discovery items`
- `feat(gallery): add cinematic discovery rails`
- `feat(gallery): support touch-first storyline previews`
- `feat(storyline): persist discovery introduction`
- `feat(gallery): add audience and genre filtering`
- `feat(gallery): surface viewing progress`
- `feat(profiles): add viewer profile foundation`
- `perf(gallery): add profile-scoped feed caching`

## Never commit a broken intermediate state
Before each commit run the appropriate existing checks, such as:
- formatter
- lint
- typecheck
- unit tests
- build
- focused e2e tests

Use the repository's actual scripts. Do not guess command names.

## Phase report format
After each phase, report exactly:

### Inspected
Relevant paths and systems reviewed.

### Changed
Behavioral summary, not just filenames.

### Files
List changed files grouped by purpose.

### Data impact
Migrations/schema/query changes, or explicitly "none".

### Preserved
Existing Gallery/Kissago behavior intentionally kept.

### Validation
Commands/tests/manual checks actually completed.

### Risks / limitations
Anything unresolved or deliberately deferred.

### Next recommended phase
One clear next step.

### Commit
Commit hash if committed and exact message.

## If blocked
Do not hallucinate a solution. State:
- what evidence is missing
- what you searched
- the smallest safe next action

If a product decision is genuinely required, stop at the boundary rather than encoding an arbitrary permanent choice.
