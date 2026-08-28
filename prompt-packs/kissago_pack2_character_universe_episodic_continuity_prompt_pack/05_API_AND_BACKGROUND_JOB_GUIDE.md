# 05 — API and Background Job Guide

Adapt the following to the real codebase after discovery.

## Likely backend capabilities needed

### Character APIs

- list user characters
- get character details
- save current story character globally
- update character metadata
- archive character
- select characters for new story use

### Episode APIs

- create episode from story
- list episode branches
- get episode branch details
- append story to episode branch
- fetch continuity context for next episode generation

### Story Bible / Journal APIs

- get story bible
- update story bible
- list journal events
- append journal event
- generate continuity summary for prompt context

## Background jobs that may be useful

Depending on architecture, consider jobs for:

- backfilling character cards from existing stories
- generating continuity summaries for long episodic chains
- cleaning/condensing journals when chains become large
- asynchronously creating derived reference assets if needed

## Prompt generation implications

When generating an episode with continuity, provide a compact but structured context bundle containing:

- episode premise
- relevant story bible summary
- latest journal summary
- participating characters and their prompts
- relationships
- setting continuity
- tone/style constraints

Do not send huge raw histories if a summarized context can be used.
