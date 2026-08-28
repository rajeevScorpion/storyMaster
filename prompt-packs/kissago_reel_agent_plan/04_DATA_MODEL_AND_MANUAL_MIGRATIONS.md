# 04 Data Model and Manual Migrations

Do not assume database schema. Inspect actual Supabase types, SQL migrations, generated types, and data access code before proposing changes.

## Manual migration rule

Migrations remain manual.

You may create migration SQL files, but do not run them automatically. Do not apply them to local or remote databases unless explicitly instructed outside this pack.

## Data to support

Reel Story records should be able to persist:

- creation method: `reel_story` or `visual_reel`
- orientation: default `9:16`
- input mode: default `without_image`
- script length option: `short`, `medium`, `long`
- effective word range used
- narration style key
- visual style key
- mood preset key
- storyboard image count per beat used at generation time
- generated script
- narration text
- image prompts
- image asset references
- audio/narration asset reference
- subtitle or timing metadata where available
- timeline metadata: order, duration, transition type
- export status: `not_started`, `queued`, `rendering`, `completed`, `failed`
- final video asset reference or URL if available
- branding enabled true/false
- visibility: draft/unpublished, private_published, public_published
- retention/expiry metadata

## Reuse before adding

Prefer extending existing story/beat/media tables if the current architecture supports it.

Avoid duplicate systems for:

- story ownership
- beat structure
- asset records
- published status
- storage URLs
- plan permissions

If a generic metadata JSON column already exists, consider using it for reel-specific values first, but do not abuse it if typed columns are clearly needed for filtering and cleanup.

## Potential migration areas

Only create migrations that are required after inspecting code.

Possible changes:

1. Add a creation method enum/value if constrained.
2. Add reel metadata columns or JSON metadata field.
3. Add prompt definers table if no equivalent exists.
4. Add admin settings rows/keys for Reel Story.
5. Add retention fields: visibility, expires_at, deletion_pending_at, deleted_reason.
6. Add cleanup audit log table if no equivalent exists.

## Suggested prompt definers table shape

Adapt to existing naming conventions.

```sql
-- Example only. Do not apply without adapting to actual schema.
create table if not exists prompt_definers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  category text not null,
  prompt_text text not null,
  is_active boolean not null default true,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## Suggested retention fields

Adapt to existing tables.

```sql
-- Example only. Do not apply without adapting to actual schema.
alter table stories
  add column if not exists visibility text not null default 'draft',
  add column if not exists expires_at timestamptz,
  add column if not exists deletion_pending_at timestamptz,
  add column if not exists deleted_reason text;
```

## Required documentation

Document every migration file in `docs/reel-story-generator-implementation.md`:

- file path
- purpose
- manual application steps
- rollback consideration
- whether generated types need refreshing

