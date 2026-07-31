import {
  resolveEffectiveModerationState,
  type EffectiveModerationState,
} from '@/lib/admin/user-management.shared';

interface ModerationApiRow {
  status?: string | null;
  suspended_until?: string | null;
  reason?: string | null;
}

export async function loadModerationForMiddleware(
  userId: string
): Promise<EffectiveModerationState> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return resolveEffectiveModerationState(null);
  }

  try {
    const query = new URLSearchParams({
      user_id: `eq.${userId}`,
      select: 'status,suspended_until,reason',
      limit: '1',
    });
    const response = await fetch(
      `${supabaseUrl}/rest/v1/user_account_moderation?${query.toString()}`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        cache: 'no-store',
      }
    );

    // Fail open while migration 083 is rolling out or Supabase is temporarily
    // unreachable. Cost authorization performs a second server-side check.
    if (!response.ok) {
      return resolveEffectiveModerationState(null);
    }

    const rows = await response.json() as ModerationApiRow[];
    return resolveEffectiveModerationState(rows[0] ?? null);
  } catch {
    return resolveEffectiveModerationState(null);
  }
}
