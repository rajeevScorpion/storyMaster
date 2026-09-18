'use server';

import { verifyAdmin } from '@/lib/supabase/admin';
import { getFeatureFlags, setFeatureFlag } from '@/lib/ai/model-config';
import {
  OPERATIONAL_FLAG_DEFINITIONS,
  isOperationalFlagKey,
} from '@/lib/admin/operational-flags.shared';

/**
 * Reads and writes the plain `feature_flags` rows listed in
 * lib/admin/operational-flags.shared.ts. Admin-guarded, and the setter refuses any key not in that
 * registry, so this panel can never reach a flag it was not built to explain — nor one whose `value`
 * column carries structured settings that a bare on/off would corrupt.
 *
 * Note for anyone wondering why a change seems slow to bite: getFeatureFlag caches for 60 seconds
 * per process. setFeatureFlag clears the entry in the process that wrote it, but another running
 * instance can still serve its cached answer until its own entry expires.
 */

export async function getOperationalFlags(): Promise<Record<string, boolean>> {
  await verifyAdmin();

  const keys = OPERATIONAL_FLAG_DEFINITIONS.map((flag) => flag.key);
  // Every flag in the registry fails closed, so an absent row reads as false.
  return getFeatureFlags(keys, false);
}

export async function setOperationalFlag(
  flagKey: string,
  enabled: boolean
): Promise<Record<string, boolean>> {
  await verifyAdmin();

  if (!isOperationalFlagKey(flagKey)) {
    throw new Error(`Unknown operational flag: ${flagKey}`);
  }

  await setFeatureFlag(flagKey, enabled);

  const keys = OPERATIONAL_FLAG_DEFINITIONS.map((flag) => flag.key);
  return getFeatureFlags(keys, false);
}
