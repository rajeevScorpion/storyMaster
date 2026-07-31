import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  resolveEffectiveModerationState,
  type EffectiveModerationState,
} from '@/lib/admin/user-management.shared';

interface ModerationRow {
  status: string;
  suspended_until: string | null;
  reason: string | null;
}

export async function getEffectiveUserModeration(
  userId: string
): Promise<EffectiveModerationState> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('user_account_moderation')
    .select('status, suspended_until, reason')
    .eq('user_id', userId)
    .maybeSingle();

  // Deploys may briefly run before migration 083 is applied. Fail open here so
  // an unavailable moderation table cannot lock every account out of Kissago.
  if (error) {
    console.error('Unable to load account moderation state:', error.message);
    return resolveEffectiveModerationState(null);
  }

  return resolveEffectiveModerationState(data as ModerationRow | null);
}

export async function isUserAccountRestricted(userId: string): Promise<boolean> {
  const moderation = await getEffectiveUserModeration(userId);
  return moderation.status === 'blocked' || moderation.status === 'suspended';
}
