import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getPricingRuntimeContext } from '@/app/actions/pricing-runtime';
import { getMediaPipelineSettings } from '@/lib/media/processing-mode';
import { isHqEntitled } from '@/lib/media/retention';
import { normalizePublishQuality, type StorylinePublishQuality } from '@/lib/story/visibility';

export interface ValidatedPublishQuality {
  quality: StorylinePublishQuality;
  /** Set when a requested high quality silently fell back to standard. */
  notice: string | null;
}

/**
 * Server-side validation of a requested publish/share quality — never trust
 * the client toggle. High quality requires plan entitlement AND at least one
 * share_high derived asset for the story (the private original is never
 * served publicly).
 */
export async function resolveValidatedPublishQuality(
  storyId: string,
  requested: unknown
): Promise<ValidatedPublishQuality> {
  const quality = normalizePublishQuality(requested);
  if (quality !== 'high') return { quality: 'standard', notice: null };

  const settings = await getMediaPipelineSettings();
  const pricing = await getPricingRuntimeContext().catch(() => null);
  if (!isHqEntitled(pricing?.snapshot.entitlementPlanKey ?? 'free', settings)) {
    return {
      quality: 'standard',
      notice: 'High quality publishing is not included in your plan; published in standard quality.',
    };
  }

  const admin = createAdminClient();
  const { count } = await admin
    .from('media_assets')
    .select('id', { count: 'exact', head: true })
    .eq('story_id', storyId)
    .eq('variant', 'share_high');
  if ((count ?? 0) === 0) {
    return {
      quality: 'standard',
      notice: 'No high-quality assets are available for this story yet; published in standard quality.',
    };
  }

  return { quality: 'high', notice: null };
}
