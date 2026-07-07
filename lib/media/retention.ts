import type { PlanKey } from '@/lib/types/pricing';
import type { MediaPipelineSettings } from '@/lib/media/media-pipeline-settings';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long a generated original is retained for a plan, from the admin
 * media-pipeline settings. Free keeps a short internal processing buffer;
 * Plus/Studio earn day-based HQ retention. The expiry is stamped at creation
 * and never shrinks afterwards (downgrade-safe).
 */
export function resolveOriginalRetentionMs(planKey: PlanKey, settings: MediaPipelineSettings): number {
  switch (planKey) {
    case 'studio':
      return settings.studioRetentionDays * DAY_MS;
    case 'plus':
      return settings.plusRetentionDays * DAY_MS;
    default:
      return settings.freeRetentionHours * HOUR_MS;
  }
}

export function resolveOriginalExpiresAt(
  planKey: PlanKey,
  settings: MediaPipelineSettings,
  now: Date = new Date()
): string {
  return new Date(now.getTime() + resolveOriginalRetentionMs(planKey, settings)).toISOString();
}
