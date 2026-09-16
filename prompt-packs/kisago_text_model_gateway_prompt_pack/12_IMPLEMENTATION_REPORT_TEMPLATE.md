# IMPLEMENTATION REPORT TEMPLATE

## A. What I found
- Existing text model flow:
- Prompt Playground storage:
- Gemini integration:
- Existing evaluation loop:
- Image adapter pattern reused:
- Existing handoff mechanism:

## B. What I implemented
- Text model registry:
- Text gateway/provider abstraction:
- OpenAI direct:
- OpenRouter:
- Gemini migration:
- Admin Text Models:
- Prompt Playground changes:
- Evaluation changes:
- Repair/retry changes:
- Observability:

## C. Current routing
| Task / Role | Model | Provider | Fallback | Notes |
|---|---|---|---|---|
| Story Generation | | | | |
| Seed Plan Generation | | | | |
| Seeded Beat Materialization | | | | |
| Story Bible Writer | | | | |
| Visual Prompt Composer | | | | |
| Semantic evaluator | | | | |
| Creative repair | | | | |

## D. Economics
- deterministic checks replacing model calls:
- cheap evaluator:
- strong writer calls:
- retry cap:
- estimated/observed token behavior:

## E. Admin workflow
Explain how to add/enable/disable/select a model, switch Story Generation, and switch evaluator separately.

## F. Environment/config
List variable names only. Never include secret values.

## G. Tests
- unit:
- integration:
- live smoke:
- build/typecheck:
- pre-existing unrelated failures:

## H. Handoff
- existing handoff updated:
- new feature handoff if any:
- future starting point:

## I. Deviations
| Proposed | Implemented | Reason |
|---|---|---|

## J. Follow-ups
Only genuine remaining work.
