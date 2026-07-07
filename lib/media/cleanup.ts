import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { deleteR2Object } from '@/lib/media/r2-server';
import { getMediaPipelineSettings } from '@/lib/media/processing-mode';

export interface CleanupResult {
  scanned: number;
  deleted: number;
  failed: number;
}

/**
 * Retention cleanup: delete expired private originals from R2 and stamp the
 * ledger row (metadata_json.expiredAt) so HQ access checks fail closed.
 * Display/thumbnail/share variants are never touched — stories keep
 * rendering normally after the original is gone. DB timestamps are the
 * source of truth; R2 lifecycle rules are only a safety net.
 */
export async function cleanupExpiredOriginals(options: { batchSize?: number } = {}): Promise<CleanupResult> {
  const settings = await getMediaPipelineSettings();
  if (!settings.cleanupEnabled && options.batchSize === undefined) {
    return { scanned: 0, deleted: 0, failed: 0 };
  }
  const batchSize = options.batchSize ?? settings.cleanupBatchSize;
  const admin = createAdminClient();

  // metadata_json->>'expiredAt' null-filter keeps already-cleaned rows out of
  // the batch so a backlog can't starve the scan.
  const { data: rows, error } = await admin
    .from('media_assets')
    .select('id, bucket, object_key, metadata_json')
    .eq('variant', 'original')
    .not('original_expires_at', 'is', null)
    .lt('original_expires_at', new Date().toISOString())
    .is('metadata_json->>expiredAt', null)
    .limit(batchSize);
  if (error || !rows) return { scanned: 0, deleted: 0, failed: 0 };

  const pending = rows;

  let deleted = 0;
  let failed = 0;
  for (const row of pending) {
    try {
      await deleteR2Object(row.bucket, row.object_key);
      const metadata = { ...((row.metadata_json ?? {}) as Record<string, unknown>), expiredAt: new Date().toISOString() };
      await admin
        .from('media_assets')
        .update({ metadata_json: metadata, public_url: null })
        .eq('id', row.id);
      deleted += 1;
    } catch (cleanupError) {
      failed += 1;
      console.error(
        `Retention cleanup failed for ${row.bucket}/${row.object_key}:`,
        cleanupError instanceof Error ? cleanupError.message : cleanupError
      );
    }
  }

  return { scanned: pending.length, deleted, failed };
}
