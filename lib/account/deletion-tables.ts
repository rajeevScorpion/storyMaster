import 'server-only';

/**
 * Every table that references auth.users(id), classified into exactly one of
 * three groups (docs/payments/phase-2-plan.md §2 decisions 11-12). Verified
 * against supabase/migrations/*.sql on 2026-09-17/18 -- not just the plan's own
 * (non-exhaustive) list. lib/account/deletion.ts drives its whole sequence off
 * these three lists and nothing else, so a table added later that touches a
 * user's id must be placed here deliberately, not left to fall through.
 *
 * - DELETED: the person's own private activity/access. The row is removed
 *   outright (deleteAccount() does this before touching anything below).
 * - OWNERLESS: the person's work. Only the id column is nulled; nothing else
 *   about the row changes, and no subject_ref is added (nothing needs to link
 *   this content back to a person once the account is gone -- the author
 *   credit on a published storyline is already a copy, not a join).
 * - ANONYMISED: a record of something that happened. The id column (and any
 *   personal columns named) are nulled, the row survives. Every table 125
 *   converted already carries subject_ref; deleteAccount() does not need to
 *   touch subject_ref itself, only the columns listed here.
 *
 * Tables intentionally left out, and why, are at the bottom of this file.
 */

export interface DeletedTableRule {
  table: string;
  /** Column holding the user's id on this table. */
  matchColumn: string;
}

export interface OwnerlessTableRule {
  table: string;
  userColumn: string;
}

export interface AnonymisedTableRule {
  table: string;
  /**
   * Columns referencing auth.users(id) to null. Usually one; a handful of
   * admin-attribution tables have two (created_by/updated_by) that can each
   * independently equal the deleted id on different rows, so deleteAccount()
   * nulls each column with its own filtered update rather than one combined
   * patch -- see the comment in lib/account/deletion.ts.
   */
  userColumns: string[];
  /** Non-id personal columns to blank at the same time. Only meaningful when userColumns has exactly one entry (billing_profiles today). */
  personalColumns?: string[];
}

export const DELETED_TABLES: DeletedTableRule[] = [
  { table: 'viewer_profiles', matchColumn: 'account_id' },
  { table: 'saved_storylines', matchColumn: 'user_id' },
  { table: 'explored_stories', matchColumn: 'user_id' },
  { table: 'storyline_progress', matchColumn: 'user_id' },
  { table: 'storyline_likes', matchColumn: 'user_id' },
  { table: 'storyline_views', matchColumn: 'user_id' },
  { table: 'reference_sources', matchColumn: 'user_id' },
  { table: 'reference_adoptions', matchColumn: 'user_id' },
  // preset_scope='user' rows only -- system presets carry a NULL user_id and never match.
  { table: 'narration_presets', matchColumn: 'user_id' },
  { table: 'reel_narration_settings', matchColumn: 'user_id' },
  { table: 'story_effect_presets', matchColumn: 'user_id' },
  { table: 'reel_narration_voice_previews', matchColumn: 'user_id' },
  { table: 'user_entitlement_overrides', matchColumn: 'user_id' },
  { table: 'character_novelty_usage', matchColumn: 'user_id' },
  // Background job rows: lib/account/deletion.ts marks any still-active row
  // 'cancelled' first (the "stop pending jobs" step), then this delete step
  // removes the row, matching the CASCADE the schema already defines.
  { table: 'image_batch_jobs', matchColumn: 'user_id' },
  { table: 'narration_batch_jobs', matchColumn: 'user_id' },
  { table: 'image_generation_jobs', matchColumn: 'user_id' },
  // A few minutes of working state, not a record (125's own comment) -- CASCADE, not subject_ref.
  { table: 'beat_spend_reservations', matchColumn: 'user_id' },
  // Directory mirror of email/display_name synced off auth.users -- deleting it removes that copy.
  { table: 'admin_user_directory', matchColumn: 'user_id' },
  { table: 'user_account_moderation', matchColumn: 'user_id' },
  // Reviewer/editor grant -- deleting it is "access ends the moment the account does" (decision 13).
  { table: 'agent_reviewers', matchColumn: 'user_id' },
  // profiles is deleted last, as its own named step in lib/account/deletion.ts
  // (right before auth.users itself), not through this list.
];

export const OWNERLESS_TABLES: OwnerlessTableRule[] = [
  { table: 'stories', userColumn: 'user_id' },
  { table: 'storylines', userColumn: 'user_id' },
  { table: 'beats', userColumn: 'generated_by' },
  { table: 'character_masters', userColumn: 'user_id' },
  { table: 'story_bibles', userColumn: 'user_id' },
  { table: 'episode_branches', userColumn: 'user_id' },
  { table: 'media_assets', userColumn: 'user_id' },
];

export const ANONYMISED_TABLES: AnonymisedTableRule[] = [
  { table: 'billing_customers', userColumns: ['user_id'] },
  { table: 'billing_orders', userColumns: ['user_id'] },
  { table: 'billing_subscriptions', userColumns: ['user_id'] },
  { table: 'beat_grants', userColumns: ['user_id'] },
  { table: 'beat_usage_events', userColumns: ['user_id'] },
  { table: 'legal_acceptances', userColumns: ['user_id'] },
  { table: 'billing_webhook_events', userColumns: ['related_user_id'] },
  { table: 'billing_payments', userColumns: ['user_id'] },
  // Unconstrained (no FK) but still worth nulling where it happens to match --
  // see "left out" notes below for why it isn't a blocking gap.
  { table: 'billing_refunds', userColumns: ['actor_user_ref'] },
  {
    table: 'billing_profiles',
    userColumns: ['user_id'],
    // GST needs the recipient's name, state and GSTIN to survive; contact
    // details don't (plan §2 decision 10). Migration 127 adds subject_ref and
    // SET NULL here -- 125 left this table CASCADE.
    personalColumns: [
      'billing_email',
      'phone',
      'company_name',
      'address_line_1',
      'address_line_2',
      'city',
      'postal_code',
    ],
  },
  { table: 'admin_user_audit_events', userColumns: ['target_user_id', 'actor_user_id'] },
  { table: 'ai_cost_events', userColumns: ['user_id'] },
  { table: 'admin_promotional_cohorts', userColumns: ['created_by'] },
  { table: 'admin_promotional_cohort_members', userColumns: ['user_id'] },
  { table: 'managed_pages', userColumns: ['updated_by'] },
  { table: 'managed_page_versions', userColumns: ['published_by'] },
  { table: 'reel_visual_styles', userColumns: ['created_by', 'updated_by'] },
  { table: 'reel_cleanup_runs', userColumns: ['actor_user_id'] },
  { table: 'image_model_registry', userColumns: ['updated_by'] },
  { table: 'story_visual_options', userColumns: ['created_by', 'updated_by'] },
  { table: 'operational_policies', userColumns: ['updated_by'] },
  { table: 'operational_policy_audit_events', userColumns: ['actor_user_id'] },
  { table: 'narration_generation_logs', userColumns: ['user_id'] },
  { table: 'text_model_registry', userColumns: ['updated_by'] },
  { table: 'agent_review_decisions', userColumns: ['reviewer_id'] },
  { table: 'agent_review_assignments', userColumns: ['reviewer_id', 'assigned_by'] },
  // Same table as DELETED_TABLES above, different columns: that entry removes
  // *this user's own* reviewer grant (user_id PK); these two only clear where
  // this user created/updated *someone else's* reviewer row.
  { table: 'agent_reviewers', userColumns: ['created_by', 'updated_by'] },
  // Migration 127: previously NO ACTION, which would have blocked deletion outright.
  { table: 'pricing_plan_versions', userColumns: ['published_by'] },
  { table: 'pricing_topup_packs', userColumns: ['published_by'] },
  { table: 'pricing_action_costs', userColumns: ['updated_by'] },
  { table: 'pricing_publish_audit', userColumns: ['performed_by'] },
  { table: 'reel_moods', userColumns: ['created_by', 'updated_by'] },
];

/**
 * Tables deliberately left out of every list above, and why. None of these
 * block deletion (no NO ACTION/RESTRICT foreign key among them).
 *
 * - beat_revisions.user_id, timeline_rewrite_events.user_id,
 *   episode_journal_events.user_id -- still CASCADE from auth.users even
 *   though the story/episode_branch they narrate can be kept ownerless.
 *   Losing this edit/series history on deletion is today's schema behaviour,
 *   not something this list silently overrides. Genuinely unclear whether a
 *   kept-ownerless story should keep its edit history too; flagged for the
 *   owner rather than guessed at (see the Unit C report).
 * - agent_tasks.created_by -- a plain uuid with no foreign key at all, so it
 *   never blocks deletion and this code never nulls it either. Low
 *   sensitivity: rarely populated (only 'admin'-origin tasks), read only by
 *   the service-role agentic pipeline, never displayed to any reader.
 * - beat_usage_allocations, image_batch_items, beat_spend_reservation_components,
 *   beat_usage_event_components -- no auth.users column of their own; each
 *   cascades from a row already covered above (beat_usage_events, beat_grants,
 *   image_batch_jobs, beat_spend_reservations).
 * - narration_voice_samples, agent_personas, agent_persona_memory,
 *   agent_story_memory, agent_novelty_checks, agent_tasks, agent_runs,
 *   agent_run_events, agent_schedules, agent_evaluations -- no auth.users
 *   column at all.
 */
