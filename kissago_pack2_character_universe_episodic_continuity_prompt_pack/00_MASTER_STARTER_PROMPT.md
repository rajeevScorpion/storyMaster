# 00 — Master Starter Prompt for AI Coder

You are implementing **Pack 2** for Kissago:

# Character Library, Story Bible, Journal & Episodic Branching

Do not start coding immediately.

Your first responsibility is to inspect the repository and understand how the current Kissago system works after Pack 1. You must discover how stories, beats, options, named characters, character prompts, character references, images, narration, and continuation logic currently work.

## Non-negotiable rules

- Do not assume architecture.
- Do not invent table names, APIs, jobs, file paths, or state-management patterns without checking the repo first.
- Preserve all working Pack 1 behavior.
- Create a branch before changes.
- Commit after meaningful checkpoints.
- Keep implementation incremental and practical.
- Add feature flags/admin toggles so the system can be disabled safely.
- Add migrations and rollback scripts where needed.
- Keep the user-facing UI simple.
- Use the name **Kissago** everywhere.

## Product goal

Kissago should support a reusable character system and connected episodic storytelling.

Users should be able to:

- reuse named characters across stories
- save named characters globally
- use characters within story scope, episodic/branch scope, and global scope
- create new episodes from existing storylines
- automatically carry all named characters from a storyline into the next episode branch
- maintain a story bible that stores persistent world/character/context rules
- maintain a journal that records events across an episodic chain
- mix characters from different stories by selecting specific characters into a new story locally

## Important known product logic

- Named characters are already defined as prompts used to generate character references.
- That existing named-character definition should be reused as the seed for character master/card creation.
- When the user continues a story as a new episode, all named characters should automatically migrate into that new branch.
- The user should have a character library.
- A character may exist globally, but when used in a story, Kissago may need a story-level instance of that character.
- Users may mix characters from two different stories by bringing selected characters into a local story context.

## First action required

Before implementation, produce a discovery report answering:

1. Where are named characters currently defined and stored?
2. Where are character prompts and character reference assets created?
3. How are stories and beats stored?
4. Is there already a story continuation or branching flow?
5. Is there already a user library pattern that can be reused?
6. Is there an admin/feature-flag system?
7. What storage/database provider is used?
8. What background job system exists?
9. Which current code paths are most fragile?
10. What is the safest integration plan for character scope + episode continuity?

Do not proceed to schema changes until the discovery report is complete.
