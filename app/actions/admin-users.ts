'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient, verifyAdmin } from '@/lib/supabase/admin';
import { invalidatePricingRuntimeCacheForUser } from '@/lib/pricing/runtime-context-cache';
import {
  normalizeEntitlementPlanKey,
  resolveEffectiveEntitlementTier,
} from '@/lib/pricing/entitlement-tier.shared';
import type { PlanKey } from '@/lib/types/pricing';
import {
  beatsToCoins,
  normalizeAdminUserListInput,
  normalizeCoinGrantInput,
  normalizeEntitlementTierInput,
  normalizePromotionalCohortInput,
  type AdminAccountStatus,
  type AdminPromotionalCohortCandidate,
  type AdminPromotionalCohortInput,
  type AdminPromotionalCohortPreview,
  type AdminPromotionalCohortRun,
  type AdminUserAuditItem,
  type AdminUserDetailData,
  type AdminUserManagementSummary,
  type AdminUserRecentStory,
  type AdminUserRow,
  type AdminUsersPageData,
  type AdminUserWalletActivityItem,
  type AdminUserListInput,
} from '@/lib/admin/user-management.shared';

interface AdminListUsersRpcRow {
  user_id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  auth_provider: string | null;
  joined_at: string;
  last_sign_in_at: string | null;
  last_product_activity_at: string | null;
  account_status: string;
  suspended_until: string | null;
  moderation_reason: string | null;
  current_plan_key: string | null;
  available_beats: number | string | null;
  lifetime_granted_beats: number | string | null;
  lifetime_consumed_beats: number | string | null;
  month_consumed_beats: number | string | null;
  expiring_beats_30d: number | string | null;
  in_progress_story_count: number | string | null;
  finished_story_count: number | string | null;
  published_story_count: number | string | null;
  published_path_count: number | string | null;
  reel_count: number | string | null;
  total_count: number | string | null;
}

interface AdminSummaryRpcRow {
  total_users: number | string | null;
  active_users: number | string | null;
  suspended_users: number | string | null;
  blocked_users: number | string | null;
  available_beats: number | string | null;
  month_consumed_beats: number | string | null;
}

interface AuditRow {
  id: string;
  actor_user_id: string | null;
  action_type: AdminUserAuditItem['actionType'];
  reason: string;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  created_at: string;
}

interface GrantRow {
  id: string;
  source_type: string;
  beats_total: number | string;
  expires_at: string | null;
  granted_at: string;
}

interface UsageRow {
  id: string;
  action_key: string;
  beat_cost: number | string;
  created_at: string;
}

interface StoryRow {
  id: string;
  title: string;
  story_kind: 'story' | 'reel';
  status: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

interface CohortCandidateRpcRow {
  user_id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  current_plan_key: string;
  last_product_activity_at: string;
  finished_story_count: number | string;
  published_story_count: number | string;
  lifetime_consumed_beats: number | string;
  eligible_count: number | string;
}

interface CohortRunRow {
  id: string;
  name: string;
  coins_per_user: number | string;
  grant_expires_at: string | null;
  eligible_count: number;
  granted_count: number;
  status: string;
  created_at: string;
  rules_json: Record<string, unknown>;
}

export async function getAdminUsersPage(
  input: AdminUserListInput = {}
): Promise<AdminUsersPageData> {
  await verifyAdmin();
  const normalized = normalizeAdminUserListInput(input);
  const admin = createAdminClient();

  const [usersResult, summaryResult] = await Promise.all([
    admin.rpc('admin_list_users', {
      p_search: normalized.search || null,
      p_status: normalized.status,
      p_page: normalized.page,
      p_page_size: normalized.pageSize,
      p_user_id: null,
    }),
    admin.rpc('admin_user_management_summary'),
  ]);

  throwAdminUserQueryError(usersResult.error, 'load users');
  throwAdminUserQueryError(summaryResult.error, 'load user summary');

  const rows = (usersResult.data ?? []) as AdminListUsersRpcRow[];
  const summaryRow = ((summaryResult.data ?? []) as AdminSummaryRpcRow[])[0];
  const totalCount = integerValue(rows[0]?.total_count);
  const totalPages = Math.max(1, Math.ceil(totalCount / normalized.pageSize));
  const overrides = await loadEntitlementOverrides(rows.map((row) => row.user_id));

  return {
    users: rows.map((row) => mapAdminUserRow(row, overrides.get(row.user_id) ?? null)),
    summary: mapSummary(summaryRow),
    page: normalized.page,
    pageSize: normalized.pageSize,
    totalCount,
    totalPages,
  };
}

export async function getAdminUserDetail(userId: string): Promise<AdminUserDetailData | null> {
  await verifyAdmin();
  return getAdminUserDetailInternal(assertUuid(userId));
}

export async function updateAdminUserModeration(input: {
  userId: string;
  status: AdminAccountStatus;
  suspendedUntil?: string | null;
  reason: string;
}): Promise<{
  detail: AdminUserDetailData;
  authSyncWarning: string | null;
}> {
  const { user: actor } = await verifyAdmin();
  const userId = assertUuid(input.userId);
  if (userId === actor.id || userId === process.env.ADMIN_USER_ID) {
    throw new Error('The configured administrator account cannot be moderated.');
  }

  if (!(['active', 'suspended', 'blocked'] as const).includes(input.status)) {
    throw new Error('Unsupported account status.');
  }

  const reason = normalizeReason(input.reason);
  let suspendedUntil: string | null = null;
  if (input.status === 'suspended') {
    if (!input.suspendedUntil) {
      throw new Error('Choose when the suspension should end.');
    }
    const parsed = new Date(input.suspendedUntil);
    if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      throw new Error('Suspension end time must be in the future.');
    }
    suspendedUntil = parsed.toISOString();
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc('admin_set_user_moderation', {
    p_target_user_id: userId,
    p_status: input.status,
    p_suspended_until: suspendedUntil,
    p_reason: reason,
    p_actor_user_id: actor.id,
  });
  throwAdminUserQueryError(error, 'update account status');

  const authSyncWarning = await syncSupabaseAuthBan({
    userId,
    status: input.status,
    suspendedUntil,
  });

  revalidatePath('/admin/users');
  revalidatePath(`/admin/users/${userId}`);
  const detail = await getAdminUserDetailInternal(userId);
  if (!detail) {
    throw new Error('Account status was updated, but the user detail could not be reloaded.');
  }

  return { detail, authSyncWarning };
}

export async function grantAdminUserCoins(input: {
  userId: string;
  coins: number;
  reason: string;
  expiresAt?: string | null;
  requestKey: string;
}): Promise<{
  detail: AdminUserDetailData;
  grantId: string;
  alreadyApplied: boolean;
}> {
  const { user: actor } = await verifyAdmin();
  const userId = assertUuid(input.userId);
  const requestKey = assertRequestKey(input.requestKey);
  const grant = normalizeCoinGrantInput(input);
  const admin = createAdminClient();

  const { data, error } = await admin.rpc('admin_grant_user_coins', {
    p_target_user_id: userId,
    p_actor_user_id: actor.id,
    p_beat_amount: grant.beats,
    p_coin_amount: grant.coins,
    p_reason: grant.reason,
    p_expires_at: grant.expiresAt,
    p_request_key: requestKey,
  });
  throwAdminUserQueryError(error, 'grant coins');

  const result = (data as Array<{
    grant_id: string;
    beats_granted: number | string;
    already_applied: boolean;
  }> | null)?.[0];
  if (!result?.grant_id) {
    throw new Error('The coin grant completed without returning a grant reference.');
  }

  revalidatePath('/admin/users');
  revalidatePath(`/admin/users/${userId}`);
  const detail = await getAdminUserDetailInternal(userId);
  if (!detail) {
    throw new Error('Coins were granted, but the user detail could not be reloaded.');
  }

  return {
    detail,
    grantId: result.grant_id,
    alreadyApplied: Boolean(result.already_applied),
  };
}

/**
 * Promote (or un-promote) one account's feature tier. Access only: no coins are
 * granted, no wallet or subscription row is touched, and the promoted user pays
 * the normal coin price for every image they generate.
 *
 * Resolution stays promote-only, so 'free' on a paying subscriber just clears
 * the promotion rather than revoking what they bought.
 */
export async function setAdminUserEntitlementTier(input: {
  userId: string;
  entitlementPlanKey: PlanKey;
  reason?: string | null;
}): Promise<AdminUserRow> {
  const { user: actor } = await verifyAdmin();
  const userId = assertUuid(input.userId);
  const { entitlementPlanKey, reason } = normalizeEntitlementTierInput(input);
  const admin = createAdminClient();

  const previous = (await loadEntitlementOverrides([userId])).get(userId) ?? null;
  if (previous === entitlementPlanKey || (previous === null && entitlementPlanKey === 'free')) {
    const unchanged = await getAdminUserDetailInternal(userId);
    if (!unchanged) throw new Error('User not found.');
    return unchanged.user;
  }

  if (entitlementPlanKey === 'free') {
    // 'free' is the absence of a promotion, so drop the row instead of storing
    // one that would read as "pinned to free".
    const { error } = await admin
      .from('user_entitlement_overrides')
      .delete()
      .eq('user_id', userId);
    throwAdminUserQueryError(error, 'clear the access tier');
  } else {
    const { error } = await admin
      .from('user_entitlement_overrides')
      .upsert({
        user_id: userId,
        entitlement_plan_key: entitlementPlanKey,
        reason,
        updated_by: actor.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    throwAdminUserQueryError(error, 'update the access tier');
  }

  const { error: auditError } = await admin
    .from('admin_user_audit_events')
    .insert({
      target_user_id: userId,
      actor_user_id: actor.id,
      action_type: 'entitlement_tier_changed',
      reason: reason ?? `Access tier set to ${entitlementPlanKey}`,
      before_json: { entitlementPlanKey: previous },
      after_json: { entitlementPlanKey: entitlementPlanKey === 'free' ? null : entitlementPlanKey },
      metadata_json: { grantsCoins: false },
    });
  // The tier change already landed; losing its audit row must not fail the call.
  if (auditError) {
    console.error('Failed to record entitlement tier audit event:', auditError.message);
  }

  // Without this the target keeps their old entitlements for up to the runtime
  // cache TTL on this instance.
  invalidatePricingRuntimeCacheForUser(userId);
  revalidatePath('/admin/users');
  revalidatePath(`/admin/users/${userId}`);

  const detail = await getAdminUserDetailInternal(userId);
  if (!detail) {
    throw new Error('The access tier was updated, but the user could not be reloaded.');
  }
  return detail.user;
}

export async function getAdminPromotionalCohortRuns(): Promise<AdminPromotionalCohortRun[]> {
  await verifyAdmin();
  return getAdminPromotionalCohortRunsInternal();
}

export async function previewAdminPromotionalCohort(
  input: AdminPromotionalCohortInput
): Promise<AdminPromotionalCohortPreview> {
  const { user: actor } = await verifyAdmin();
  const normalized = normalizePromotionalCohortInput(input);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('admin_promotional_cohort_candidates', {
    p_active_within_days: normalized.activeWithinDays,
    p_min_finished_stories: normalized.minFinishedStories,
    p_min_published_stories: normalized.minPublishedStories,
    p_min_lifetime_consumed_beats: normalized.minLifetimeConsumedBeats,
    p_plan_key: normalized.planKey,
    p_excluded_user_id: actor.id,
    p_limit: 25,
  });
  throwAdminUserQueryError(error, 'preview promotional cohort');

  const rows = (data ?? []) as CohortCandidateRpcRow[];
  const eligibleCount = integerValue(rows[0]?.eligible_count);
  return {
    input: normalized,
    eligibleCount,
    estimatedLiabilityCoins: eligibleCount * normalized.coinsPerUser,
    sample: rows.map(mapCohortCandidate),
  };
}

export async function executeAdminPromotionalCohort(input: {
  cohort: AdminPromotionalCohortInput;
  approvedRecipientCount: number;
  requestKey: string;
}): Promise<{
  cohortId: string;
  eligibleCount: number;
  grantedCount: number;
  alreadyApplied: boolean;
  runs: AdminPromotionalCohortRun[];
}> {
  const { user: actor } = await verifyAdmin();
  const normalized = normalizePromotionalCohortInput(input.cohort);
  const approvedRecipientCount = integerValue(input.approvedRecipientCount);
  if (approvedRecipientCount < 1 || approvedRecipientCount > 1_000) {
    throw new Error('Phase 1 campaigns support a previewed audience between 1 and 1,000 users.');
  }
  const requestKey = assertRequestKey(input.requestKey);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('admin_execute_promotional_cohort', {
    p_name: normalized.name,
    p_active_within_days: normalized.activeWithinDays,
    p_min_finished_stories: normalized.minFinishedStories,
    p_min_published_stories: normalized.minPublishedStories,
    p_min_lifetime_consumed_beats: normalized.minLifetimeConsumedBeats,
    p_plan_key: normalized.planKey,
    p_actor_user_id: actor.id,
    p_beat_amount: normalized.beatsPerUser,
    p_coin_amount: normalized.coinsPerUser,
    p_grant_expires_at: normalized.grantExpiresAt,
    p_max_recipients: approvedRecipientCount,
    p_request_key: requestKey,
  });
  throwAdminUserQueryError(error, 'execute promotional cohort');

  const result = (data as Array<{
    cohort_id: string;
    eligible_count: number;
    granted_count: number;
    already_applied: boolean;
  }> | null)?.[0];
  if (!result?.cohort_id) {
    throw new Error('The cohort completed without returning a campaign reference.');
  }

  revalidatePath('/admin/users');
  revalidatePath('/admin/users/cohorts');
  return {
    cohortId: result.cohort_id,
    eligibleCount: integerValue(result.eligible_count),
    grantedCount: integerValue(result.granted_count),
    alreadyApplied: Boolean(result.already_applied),
    runs: await getAdminPromotionalCohortRunsInternal(),
  };
}

/**
 * Promotions live outside the directory RPC, so one indexed read covers the
 * whole page (at most `pageSize` ids) instead of a join per row.
 */
async function loadEntitlementOverrides(userIds: string[]): Promise<Map<string, PlanKey>> {
  const overrides = new Map<string, PlanKey>();
  if (userIds.length === 0) return overrides;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('user_entitlement_overrides')
    .select('user_id, entitlement_plan_key')
    .in('user_id', userIds);

  // A directory that renders without the promotion column beats one that fails
  // to render at all, so a read error degrades to "no promotions".
  if (error) {
    console.error('Failed to load entitlement overrides:', error.message);
    return overrides;
  }

  for (const row of (data ?? []) as Array<{ user_id: string; entitlement_plan_key: string }>) {
    const planKey = normalizeEntitlementPlanKey(row.entitlement_plan_key);
    if (planKey) overrides.set(row.user_id, planKey);
  }
  return overrides;
}

async function getAdminUserDetailInternal(userId: string): Promise<AdminUserDetailData | null> {
  const admin = createAdminClient();
  const [overviewResult, auditResult, grantsResult, usageResult, storiesResult] = await Promise.all([
    admin.rpc('admin_list_users', {
      p_search: null,
      p_status: 'all',
      p_page: 1,
      p_page_size: 25,
      p_user_id: userId,
    }),
    admin
      .from('admin_user_audit_events')
      .select('id, actor_user_id, action_type, reason, before_json, after_json, created_at')
      .eq('target_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50),
    admin
      .from('beat_grants')
      .select('id, source_type, beats_total, expires_at, granted_at')
      .eq('user_id', userId)
      .order('granted_at', { ascending: false })
      .limit(25),
    admin
      .from('beat_usage_events')
      .select('id, action_key, beat_cost, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(25),
    admin
      .from('stories')
      .select('id, title, story_kind, status, is_archived, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(12),
  ]);

  throwAdminUserQueryError(overviewResult.error, 'load user overview');
  throwAdminUserQueryError(auditResult.error, 'load user audit history');
  throwAdminUserQueryError(grantsResult.error, 'load wallet grants');
  throwAdminUserQueryError(usageResult.error, 'load wallet usage');
  throwAdminUserQueryError(storiesResult.error, 'load recent stories');

  const overview = ((overviewResult.data ?? []) as AdminListUsersRpcRow[])[0];
  if (!overview) return null;

  const overrides = await loadEntitlementOverrides([userId]);

  return {
    user: mapAdminUserRow(overview, overrides.get(userId) ?? null),
    auditEvents: ((auditResult.data ?? []) as AuditRow[]).map(mapAuditItem),
    walletActivity: buildWalletActivity(
      (grantsResult.data ?? []) as GrantRow[],
      (usageResult.data ?? []) as UsageRow[]
    ),
    recentStories: ((storiesResult.data ?? []) as StoryRow[]).map(mapRecentStory),
  };
}

async function getAdminPromotionalCohortRunsInternal(): Promise<AdminPromotionalCohortRun[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('admin_promotional_cohorts')
    .select('id, name, coins_per_user, grant_expires_at, eligible_count, granted_count, status, created_at, rules_json')
    .order('created_at', { ascending: false })
    .limit(25);
  throwAdminUserQueryError(error, 'load promotional cohort history');

  return ((data ?? []) as CohortRunRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    coinsPerUser: numberValue(row.coins_per_user),
    grantExpiresAt: row.grant_expires_at,
    eligibleCount: integerValue(row.eligible_count),
    grantedCount: integerValue(row.granted_count),
    status: row.status,
    createdAt: row.created_at,
    rules: row.rules_json ?? {},
  }));
}

async function syncSupabaseAuthBan(input: {
  userId: string;
  status: AdminAccountStatus;
  suspendedUntil: string | null;
}): Promise<string | null> {
  const admin = createAdminClient();
  let banDuration: string | 'none' = 'none';

  if (input.status === 'blocked') {
    // Auth supports duration bans rather than a permanent boolean. The database
    // remains authoritative; 100 years prevents refresh/sign-in until unblocked.
    banDuration = '876000h';
  } else if (input.status === 'suspended' && input.suspendedUntil) {
    const seconds = Math.max(
      1,
      Math.ceil((new Date(input.suspendedUntil).getTime() - Date.now()) / 1000)
    );
    banDuration = `${seconds}s`;
  }

  const { error } = await admin.auth.admin.updateUserById(input.userId, {
    ban_duration: banDuration,
  });
  return error
    ? `App restriction is active, but the Auth ban could not be synchronized: ${error.message}`
    : null;
}

function mapAdminUserRow(
  row: AdminListUsersRpcRow,
  entitlementOverridePlanKey: PlanKey | null = null
): AdminUserRow {
  const accountStatus: AdminAccountStatus = (
    row.account_status === 'suspended' || row.account_status === 'blocked'
  )
    ? row.account_status
    : 'active';
  const currentPlanKey = row.current_plan_key || 'free';

  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name?.trim() || row.email || 'Kissago user',
    avatarUrl: row.avatar_url,
    authProvider: row.auth_provider,
    joinedAt: row.joined_at,
    lastSignInAt: row.last_sign_in_at,
    lastProductActivityAt: row.last_product_activity_at,
    accountStatus,
    suspendedUntil: row.suspended_until,
    moderationReason: row.moderation_reason,
    currentPlanKey,
    entitlementOverridePlanKey,
    effectiveEntitlementPlanKey: resolveEffectiveEntitlementTier({
      billingPlanKey: normalizeEntitlementPlanKey(currentPlanKey) ?? 'free',
      overridePlanKey: entitlementOverridePlanKey,
      isAdmin: row.user_id === process.env.ADMIN_USER_ID,
    }),
    availableCoins: beatsToCoins(row.available_beats),
    lifetimeGrantedCoins: beatsToCoins(row.lifetime_granted_beats),
    lifetimeConsumedCoins: beatsToCoins(row.lifetime_consumed_beats),
    monthConsumedCoins: beatsToCoins(row.month_consumed_beats),
    expiringCoins30d: beatsToCoins(row.expiring_beats_30d),
    inProgressStoryCount: integerValue(row.in_progress_story_count),
    finishedStoryCount: integerValue(row.finished_story_count),
    publishedStoryCount: integerValue(row.published_story_count),
    publishedPathCount: integerValue(row.published_path_count),
    reelCount: integerValue(row.reel_count),
  };
}

function mapSummary(row: AdminSummaryRpcRow | undefined): AdminUserManagementSummary {
  return {
    totalUsers: integerValue(row?.total_users),
    activeUsers: integerValue(row?.active_users),
    suspendedUsers: integerValue(row?.suspended_users),
    blockedUsers: integerValue(row?.blocked_users),
    availableCoins: beatsToCoins(row?.available_beats),
    monthConsumedCoins: beatsToCoins(row?.month_consumed_beats),
  };
}

function mapAuditItem(row: AuditRow): AdminUserAuditItem {
  return {
    id: row.id,
    actionType: row.action_type,
    reason: row.reason,
    actorUserId: row.actor_user_id,
    createdAt: row.created_at,
    before: row.before_json,
    after: row.after_json,
  };
}

function mapRecentStory(row: StoryRow): AdminUserRecentStory {
  return {
    id: row.id,
    title: row.title,
    kind: row.story_kind === 'reel' ? 'reel' : 'story',
    status: row.status,
    isArchived: Boolean(row.is_archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCohortCandidate(row: CohortCandidateRpcRow): AdminPromotionalCohortCandidate {
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name?.trim() || row.email || 'Kissago user',
    avatarUrl: row.avatar_url,
    currentPlanKey: row.current_plan_key || 'free',
    lastProductActivityAt: row.last_product_activity_at,
    finishedStoryCount: integerValue(row.finished_story_count),
    publishedStoryCount: integerValue(row.published_story_count),
    lifetimeConsumedCoins: beatsToCoins(row.lifetime_consumed_beats),
  };
}

function buildWalletActivity(
  grants: GrantRow[],
  usageEvents: UsageRow[]
): AdminUserWalletActivityItem[] {
  const items: AdminUserWalletActivityItem[] = [
    ...grants.map((grant): AdminUserWalletActivityItem => ({
      id: `grant:${grant.id}`,
      kind: 'grant',
      label: grantLabel(grant.source_type),
      coinsDelta: beatsToCoins(grant.beats_total),
      source: grant.source_type,
      occurredAt: grant.granted_at,
      expiresAt: grant.expires_at,
    })),
    ...usageEvents.map((event): AdminUserWalletActivityItem => ({
      id: `spend:${event.id}`,
      kind: 'spend',
      label: usageLabel(event.action_key),
      coinsDelta: -beatsToCoins(event.beat_cost),
      source: event.action_key,
      occurredAt: event.created_at,
      expiresAt: null,
    })),
  ];

  return items
    .sort((left, right) =>
      new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()
    )
    .slice(0, 30);
}

function grantLabel(sourceType: string): string {
  const labels: Record<string, string> = {
    subscription: 'Subscription refill',
    carry_forward: 'Carry-forward balance',
    topup: 'Top-up purchase',
    promotion: 'Promotional coins',
    admin_adjustment: 'Admin coin grant',
    migration_grant: 'Migration grant',
    free_allowance: 'Free welcome coins',
  };
  return labels[sourceType] ?? 'Coin grant';
}

function usageLabel(actionKey: string): string {
  const labels: Record<string, string> = {
    start_story_initial_beat: 'Started a story',
    start_story_initial_beat_prompt_only: 'Started a text-only story',
    start_reel_full_generation: 'Generated a reel',
    start_reel_full_generation_prompt_only: 'Generated a text-only reel',
    continue_story_new_beat: 'Added a story beat',
    continue_story_new_beat_prompt_only: 'Added a text-only beat',
    preview_seed_plan: 'Previewed a seeded plan',
    regenerate_image: 'Regenerated an image',
    image_generation: 'Generated an image',
    generate_story_narration: 'Generated story narration',
    generate_reel_narration: 'Generated reel narration',
    export_video_sd: 'Exported an SD video',
    export_video_hd: 'Exported an HD video',
  };
  return labels[actionKey] ?? actionKey.replaceAll('_', ' ');
}

function integerValue(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function numberValue(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeReason(value: string): string {
  const reason = String(value ?? '').trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new Error('Reason must be between 3 and 500 characters.');
  }
  return reason;
}

function assertUuid(value: string): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new Error('A valid user id is required.');
  }
  return normalized;
}

function assertRequestKey(value: string): string {
  const normalized = String(value ?? '').trim();
  if (!/^[a-zA-Z0-9:_-]{8,160}$/.test(normalized)) {
    throw new Error('A valid coin-grant request key is required.');
  }
  return normalized;
}

function throwAdminUserQueryError(
  error: { message: string } | null,
  action: string
): void {
  if (!error) return;
  if (
    error.message.includes('admin_list_users')
    || error.message.includes('admin_user_directory')
    || error.message.includes('user_account_moderation')
    || error.message.includes('admin_promotional_cohort')
  ) {
    throw new Error(`Unable to ${action}. Apply Supabase migration 083_admin_user_management.sql first.`);
  }
  throw new Error(`Unable to ${action}: ${error.message}`);
}
