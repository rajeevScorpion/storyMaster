# 03 — Data Model and Scope Logic

This file describes the desired Pack 2 product/data behavior. The coder must adapt it to the real schema after discovery.

## Core entities

### 1. Character Master

Represents a reusable character owned by the user.

Suggested fields:

- id
- user_id
- name
- slug / normalized_name
- source_type (`generated_from_story`, `manual`, `imported`)
- origin_story_id (nullable)
- canonical_prompt
- appearance_prompt
- personality_prompt
- role_description
- voice_tone
- reference_image_asset_id / url
- default_scope (`story`, `episodic`, `global`)
- metadata JSON
- created_at / updated_at
- archived_at (nullable)

### 2. Story Character Instance

Represents a character as used within a specific story.

Suggested fields:

- id
- story_id
- character_master_id (nullable if purely local)
- episode_branch_id (nullable)
- local_name
- local_prompt_override
- local_appearance_override
- local_costume_notes
- local_role_notes
- local_reference_asset_id / url
- continuity_notes
- source_story_id (nullable)
- source_character_master_id (nullable)
- created_at / updated_at

### 3. Episode Branch

Represents a connected storyline branch.

Suggested fields:

- id
- user_id
- root_story_id
- parent_episode_branch_id (nullable)
- branch_name
- status
- current_story_id
- latest_story_id
- story_bible_id (nullable)
- active_journal_id (nullable)
- metadata
- created_at / updated_at

### 4. Story Bible

Stores stable continuity rules.

Suggested fields:

- id
- user_id
- episode_branch_id
- title
- world_summary
- tone_rules
- style_rules
- character_rules JSON
- setting_rules JSON
- relationship_rules JSON
- safety_rules JSON
- learning_context JSON (nullable)
- metadata
- created_at / updated_at

### 5. Episode Journal / Event Log

Stores chronological memory.

Suggested fields:

- id
- user_id
- episode_branch_id
- story_id
- beat_id (nullable)
- event_type
- summary
- payload JSON
- sequence_no
- created_at

## Scope logic

### Story scope

Character is available only in one story.

### Episodic branch scope

Character is available across a connected storyline branch.

### Global scope

Character is available in the user account library and may be reused in any story.

## Important behavioral rules

1. Existing named-character prompt definitions should seed character creation.
2. Saving a character globally should not remove its story/branch presence.
3. Continuing a story as a new episode should migrate all named characters into the new episode branch automatically.
4. Reusing a global character in a new story should create a local story instance rather than mutating the original master directly.
5. Mixing characters from different stories should also create local instances.
6. If names conflict, the UI should guide the user to rename or confirm aliasing.

## Suggested continuity inheritance

When creating a new episode from a storyline, carry forward:

- all named characters
- character prompts
- latest reference assets
- known relationships
- story bible
- journal context / condensed memory
- tone and style context
- unresolved plot threads if tracked
