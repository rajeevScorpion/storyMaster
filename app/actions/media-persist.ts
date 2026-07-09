'use server';

import { maybePersistInlineBeatImage, type InlinePersistResult } from '@/lib/media/inline-persist';

/**
 * Server action wrapper for inline beat-image persistence. The interactive
 * generation orchestrator (story-runtime) runs client-side, so it hands the
 * generated data URL here; all gating (setting, processing mode, ownership,
 * R2 availability) happens inside maybePersistInlineBeatImage. Returns null
 * when the caller should keep the legacy client-upload path.
 */
export async function persistInlineBeatImageAction(input: {
  dataUrl: string;
  storyId: string;
  nodeId: string;
}): Promise<InlinePersistResult | null> {
  return maybePersistInlineBeatImage(input);
}
