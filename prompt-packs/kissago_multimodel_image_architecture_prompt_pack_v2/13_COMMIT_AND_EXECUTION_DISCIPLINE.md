# Commit and Execution Discipline

## Required behavior
Work in meaningful phases and commit after each successful phase.

Do not bundle unrelated changes.

## Suggested branch
`feature/multi-model-image-generation`

## Suggested commits

### Commit 1
`chore(image): document current generation flow`
Use after investigation report if docs are committed.

### Commit 2
`refactor(image): introduce provider abstraction for Gemini`
Use after existing Gemini is wrapped safely.

### Commit 3
`feat(admin): add image model registry with tier visibility`
Use after admin model management is implemented.

### Commit 4
`feat(coins): add model-based image cost estimation`
Use after coin estimate and safe billing hooks are added.

### Commit 5
`feat(story): add image model selection to story creation`
Use after user-side model selection is functional.

### Commit 6
`feat(image): add OpenAI image provider`
Use after OpenAI provider is implemented and tested.

### Commit 7
`feat(image): add xAI Grok image provider`
Use after Grok/xAI provider is implemented and tested.

### Commit 8
`feat(image): add story visual consistency foundation`
Use after story visual profile/prompt compiler foundation is added.

### Commit 9
`test(image): add multi-model generation regression coverage`
Use after testing and QA improvements.

## Before every commit
Run available:
- formatter
- linter
- type checks
- unit tests
- relevant integration tests
- manual smoke test if needed

## Commit message body should include
- what changed
- what was intentionally not changed
- how it was tested
- risks/notes if any

