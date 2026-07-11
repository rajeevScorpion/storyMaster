# 07 — Migration and Rollback Guide

Do not apply schema changes blindly.

## Migration rules

1. Inspect the existing schema first.
2. Add nullable columns first where practical.
3. Avoid destructive migrations.
4. Backfill only after verifying data shape.
5. Keep migrations reversible where possible.
6. Add indexes where query patterns actually require them.
7. Test old stories after migration.

## Likely schema additions for Pack 2

Depending on the current codebase, Pack 2 may require:

- character master table/collection
- story character instance table/collection
- episode branch table/collection
- story bible table/collection
- journal/event log table/collection
- relationship metadata fields
- character origin/source references
- scope field(s)

## Backfill strategy

Possible safe path:

1. Add new schema.
2. Keep features behind toggles.
3. Backfill characters from existing named-character prompts only where needed.
4. Validate a sample of old stories.
5. Enable UI gradually.

## Rollback rules

If rolled back:

- old stories remain readable
- Pack 1 remains functional
- character cards may become hidden but should not be deleted automatically
- episode branches may become hidden but should not break story access
- story bible/journal data should remain stored for recovery if possible

## Data retention principle

Prefer hiding or archiving over deleting. This is especially important for user-created characters and connected episode history.
