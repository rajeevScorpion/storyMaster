# 07 Storage Lifecycle Management

Storage management is crucial for Reel Story and should ideally align with all generated stories.

## Core retention policy

Generated stories that are not published are temporary drafts.

Default rule:

- Free account unpublished stories older than 30 days are eligible for deletion.
- Free account private published stories older than 30 days are eligible for deletion.
- Public published stories are preserved unless removed by user, admin, moderation, or a configured policy.
- Paid accounts get longer retention durations, configurable by admin.

## Publishing visibility choice

At the time of publishing, users must choose:

1. Public story
2. Private story

Public story:

- Can be preserved as part of Kissago’s public/shared story ecosystem.
- May appear in public library if existing visibility rules allow.

Private story:

- Accessible only to owner or permitted viewers.
- Subject to plan-based retention limits.

## Admin retention settings

Add admin-configurable values:

- draft/unpublished retention days for free users, default 30
- private published retention days for free users, default 30
- draft/unpublished retention days for paid users
- private published retention days for paid users
- public story retention policy
- cleanup enabled/disabled
- cleanup dry-run mode
- cleanup batch size
- cleanup frequency, if scheduler exists

## Cleanup safety

Before permanent deletion:

- Prefer setting `deletion_pending_at` first if architecture supports it.
- Exclude stories currently generating, exporting, or recently failed within retry window.
- Exclude public published stories unless policy explicitly allows.
- Exclude records where ownership or plan cannot be safely determined.
- Avoid deleting shared assets used by other stories.
- Keep audit logs.

## Assets to clean

Cleanup should remove related storage assets only when safe:

- generated images
- storyboard images
- cover images
- thumbnails
- character references if story-specific
- narration audio
- subtitle files
- MP4 exports
- temporary render files

## Audit log

Create or reuse an audit log recording:

- story ID
- user ID
- plan at deletion time
- visibility/status
- deletion reason
- number of assets deleted
- storage paths deleted
- deletion timestamp
- dry-run flag
- errors if any

## Implementation mode

If scheduled infrastructure exists:

- use Supabase scheduled function, cron job, or existing server-side scheduled mechanism.

If no scheduled infrastructure exists:

- implement fields/settings and a safe manual cleanup function/script first.
- document how to run it manually.
- do not add destructive automation without clear scheduling infrastructure.

## User-facing notices

Show clear retention notices:

- Free users: unpublished and private stories are stored for 30 days by default.
- Paid users: show longer retention benefit if known.
- On story cards, show expiry date where practical.
- At publish time, explain difference between public and private retention.

