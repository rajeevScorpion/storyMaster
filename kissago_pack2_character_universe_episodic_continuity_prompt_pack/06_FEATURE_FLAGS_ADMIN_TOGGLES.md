# 06 — Feature Flags and Admin Toggles

Add admin/feature toggles wherever the architecture supports them.

If Kissago already has an admin settings system, reuse it. If not, implement a minimal feature-flag layer without overbuilding.

## Suggested Pack 2 toggles

- `character_library_enabled`
- `global_characters_enabled`
- `story_character_instances_enabled`
- `episodic_branches_enabled`
- `story_bible_enabled`
- `episode_journal_enabled`
- `continue_as_episode_enabled`
- `character_mixing_enabled`
- `character_global_save_enabled`
- `character_auto_migration_enabled`

## Default behavior

For development:

- enable features locally
- expose admin toggles in staging
- consider default-off in production until QA is complete

## Toggle behavior

When a feature is disabled:

- existing stories must still load
- existing Pack 1 flows must still work
- already-created character/episode data should not be deleted
- hidden UI controls should not leave broken actions
- disabled actions should fail gracefully through APIs
