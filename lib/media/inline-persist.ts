import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPricingRuntimeContext } from '@/app/actions/pricing-runtime';
import { getMediaPipelineSettings, resolveEffectiveProcessingMode } from '@/lib/media/processing-mode';
import { createR2SignedGetUrl } from '@/lib/media/r2-server';
import { parseR2Reference } from '@/lib/media/r2-reference';
import { processAndStoreImageVariants } from '@/lib/media/variant-pipeline';

export interface InlinePersistResult {
  /** Canonical private reference (r2://bucket/key) of the display variant. */
  displayReference: string;
  /** Short-lived signed URL for immediate rendering in the waiting client. */
  signedDisplayUrl: string;
  mediaGroupId: string;
}

/**
 * Server-persist for INLINE beat images (start/continue flows): the image is
 * still generated in the user's request, but the original + variants are
 * saved server-side before returning, so nothing depends on the browser
 * surviving to upload it. Returns null whenever the server pipeline should
 * not run (setting off, legacy mode, R2 unavailable, ownership mismatch) —
 * callers then keep the existing base64 → client-upload path.
 */
export async function maybePersistInlineBeatImage(input: {
  dataUrl: string;
  storyId: string;
  nodeId: string;
}): Promise<InlinePersistResult | null> {
  try {
    const settings = await getMediaPipelineSettings();
    if (!settings.serverPersistInlineImages) return null;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const mode = await resolveEffectiveProcessingMode(user.id);
    if (mode !== 'server_pipeline') return null;

    const admin = createAdminClient();
    const { data: story } = await admin
      .from('stories')
      .select('id, user_id')
      .eq('id', input.storyId)
      .single();
    if (!story || story.user_id !== user.id) return null;

    const planKey = await getPricingRuntimeContext()
      .then((pricing) => pricing.snapshot.planKey)
      .catch(() => 'free' as const);

    const variants = await processAndStoreImageVariants({
      dataUrl: input.dataUrl,
      userId: user.id,
      storyId: input.storyId,
      nodeId: input.nodeId,
      assetType: 'beat_image',
      processingMode: 'server_pipeline',
      planKey,
    });

    // Beat row may not exist yet (continue flow saves the beat after this
    // returns); the update is a durability bonus when it does.
    await admin
      .from('beats')
      .update({
        image_url: variants.displayReference,
        image_status: 'ready',
        image_error: null,
        image_synced_at: new Date().toISOString(),
      })
      .eq('story_id', input.storyId)
      .eq('node_id', input.nodeId);

    const parsed = parseR2Reference(variants.displayReference);
    const signedDisplayUrl = parsed
      ? await createR2SignedGetUrl(parsed.bucket, parsed.objectKey, 3600)
      : null;
    if (!signedDisplayUrl) return null;

    return {
      displayReference: variants.displayReference,
      signedDisplayUrl,
      mediaGroupId: variants.mediaGroupId,
    };
  } catch (error) {
    // Graceful: inline persist is an upgrade, never a blocker — the caller
    // falls back to the legacy client-upload path.
    console.error('Inline beat image server-persist failed:', error instanceof Error ? error.message : error);
    return null;
  }
}
