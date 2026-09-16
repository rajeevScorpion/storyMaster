# Human Review, Authors and Publishing

## Principle
**AI creates drafts. Humans certify publishable stories.**

## Reviewer / Expert Author role
Existing users should be promotable into the minimum clean editorial role supported by the repository's auth model. Possible product terms include Reviewer, Expert Author, Editorial Reviewer or Kisago Curator. Do not introduce multiple technical roles unless permissions differ.

## Preferred admin module
Evaluate `/admin/authors` as the home for author/reviewer management, promotion/demotion, active status, assignments, review queue/history and publishing permissions.

## Review pipeline
Desired economic flow:
1. agent generates text,
2. optional narration,
3. existing forced alignment if narration exists,
4. automated evaluation,
5. human review queue,
6. reviewer reads story,
7. reviewer listens if narration exists,
8. reviewer edits/refines or requests regeneration,
9. reviewer approves text,
10. reviewer triggers narration if deferred,
11. reviewer triggers/approves images if appropriate,
12. reviewer checks final result,
13. reviewer chooses editorial classification if authorized,
14. publish.

Adapt exact ordering to existing project lifecycle while preserving cheap stages first, human checkpoint before expensive media where practical, and no autonomous publish in V1.

## Reviewer dashboard
Subject to actual data availability, show title, persona, language, age group, genre, task brief, story text, narration/image status, evaluator result, novelty warnings, series relation and editorial state.

Actions can include edit, approve, reject, request rewrite, generate narration/images, send back, set editorial classification and publish if authorized.

Reuse existing story editor/project UI where possible. Do not build a second editor unnecessarily.

## Assignments
Support manual assignment, unassigned queue and assignment status. Add locking/ownership only if concurrent editing makes it necessary. Do not overbuild workforce management in V1.

## Provenance vs editorial label
Keep creator origin separate from editorial classification.

Editorial labels:
- From Kisago Creators
- Kisago Original
- Premium Story

Agent stories can default to From Kisago Creators; strong reviewed content can be promoted. Future human creators can also receive Original/Premium.

## Auditability
Record important editorial actions using existing audit/event patterns where possible: assigned, edited, approved/rejected, regeneration requested, media triggered, label changed, published.
