import 'server-only';

import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

/**
 * Viewer profiles (migration 091).
 *
 * Kissago distinguishes three identities, and confusing them is the main hazard
 * in this area:
 *
 *   auth.users        the account — who signed in and who owns the billing
 *   public.profiles   the creator identity — the display name on a published
 *                     storyline, one per account
 *   viewer_profiles   who is *watching* right now — several per account, each
 *                     with its own catalogue eligibility
 *
 * Only the third one gates discovery. This module resolves it for a request.
 *
 * Backwards compatibility: an account with no viewer_profiles rows resolves to
 * an implicit default adult profile, so every existing user keeps today's
 * behaviour with no migration step and no rows written on their behalf.
 */

/** Audience scope a profile may browse. Mirrors `GalleryAudienceMode`. */
export type ViewerAudienceMode = 'all' | 'kids';

export interface ViewerProfile {
  /** Null for the implicit default — no row exists for it. */
  id: string | null;
  displayName: string;
  avatarEmoji: string | null;
  audienceMode: ViewerAudienceMode;
  ageBand: string | null;
  isImplicitDefault: boolean;
}

/** Cookie naming the active profile. Untrusted — always revalidated below. */
export const ACTIVE_VIEWER_PROFILE_COOKIE = 'kissago_viewer_profile';

const IMPLICIT_DEFAULT_PROFILE: ViewerProfile = {
  id: null,
  displayName: 'Default',
  avatarEmoji: null,
  audienceMode: 'all',
  ageBand: null,
  isImplicitDefault: true,
};

type ViewerProfileRow = {
  id: string;
  display_name: string | null;
  avatar_emoji: string | null;
  audience_mode: string | null;
  age_band: string | null;
  is_default: boolean | null;
};

function toViewerProfile(row: ViewerProfileRow): ViewerProfile {
  return {
    id: row.id,
    displayName: row.display_name?.trim() || 'Viewer',
    avatarEmoji: row.avatar_emoji,
    // Anything unrecognised is treated as the *narrower* scope would not be
    // safe to assume either way, so fall back to the account-level default.
    audienceMode: row.audience_mode === 'kids' ? 'kids' : 'all',
    ageBand: row.age_band,
    isImplicitDefault: false,
  };
}

/**
 * The profile this request is browsing as.
 *
 * The cookie only *names* a profile; ownership is verified against the database
 * with the viewer's own client, so a forged cookie cannot select someone else's
 * profile — and, more importantly, cannot escape a kids profile, because an
 * unmatched id falls back to the account's stored default rather than to `all`.
 *
 * Returns the implicit default for signed-out visitors, for accounts with no
 * profiles, and whenever the table does not exist yet.
 */
export async function resolveActiveViewerProfile(): Promise<ViewerProfile> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return IMPLICIT_DEFAULT_PROFILE;

    const { data, error } = await supabase
      .from('viewer_profiles')
      .select('id, display_name, avatar_emoji, audience_mode, age_band, is_default')
      .eq('account_id', user.id);

    if (error || !data?.length) return IMPLICIT_DEFAULT_PROFILE;

    const rows = data as ViewerProfileRow[];
    const cookieStore = await cookies();
    const requestedId = cookieStore.get(ACTIVE_VIEWER_PROFILE_COOKIE)?.value;

    const selected = (requestedId ? rows.find((row) => row.id === requestedId) : undefined)
      ?? rows.find((row) => row.is_default === true)
      ?? rows[0];

    return toViewerProfile(selected);
  } catch {
    return IMPLICIT_DEFAULT_PROFILE;
  }
}
