import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { deleteR2Object } from '@/lib/media/r2-server';
import { toR2Reference } from '@/lib/media/r2-reference';
import { getReferenceSettings } from '@/lib/references/reference-runtime';
import type { DbReferenceAdoption, DbReferenceSource } from '@/lib/types/references';

export interface ReferenceCleanupResult {
  setupsScanned: number;
  sourcesDeleted: number;
  adoptionsDeleted: number;
  objectsDeleted: number;
}

/**
 * Delete abandoned reference setups: rows whose story was never created
 * (story_id IS NULL) older than the configured TTL. R2 objects are removed
 * first, then the rows (reference_adoptions cascade-delete with their source,
 * but we clear their canonical objects explicitly). Story-linked rows are never
 * touched here — they live for the story's lifetime and CASCADE on story delete.
 */
export async function cleanupAbandonedReferenceSetups(
  options: { batchSize?: number } = {}
): Promise<ReferenceCleanupResult> {
  const batchSize = Math.max(1, Math.min(500, options.batchSize ?? 200));
  const settings = await getReferenceSettings();
  const cutoff = new Date(Date.now() - settings.abandonedSetupTtlHours * 3600 * 1000).toISOString();
  const admin = createAdminClient();

  const result: ReferenceCleanupResult = {
    setupsScanned: 0,
    sourcesDeleted: 0,
    adoptionsDeleted: 0,
    objectsDeleted: 0,
  };

  const { data: staleSources } = await admin
    .from('reference_sources')
    .select('*')
    .is('story_id', null)
    .lt('created_at', cutoff)
    .limit(batchSize);

  const sources = (staleSources ?? []) as DbReferenceSource[];
  if (sources.length === 0) return result;

  const sourceIds = sources.map((s) => s.id);
  const setupIds = new Set(sources.map((s) => s.setup_id));
  result.setupsScanned = setupIds.size;

  // Remove canonical adoption objects for these sources.
  const { data: adoptions } = await admin
    .from('reference_adoptions')
    .select('*')
    .in('source_id', sourceIds);
  for (const adoption of (adoptions ?? []) as DbReferenceAdoption[]) {
    if (adoption.canonical_r2_bucket && adoption.canonical_r2_object_key) {
      await deleteR2Object(
        toR2Reference(adoption.canonical_r2_bucket, adoption.canonical_r2_object_key)
      ).catch(() => {});
      result.objectsDeleted += 1;
    }
  }

  // Remove source objects.
  for (const source of sources) {
    await deleteR2Object(toR2Reference(source.r2_bucket, source.r2_object_key)).catch(() => {});
    result.objectsDeleted += 1;
  }

  // Delete rows (adoptions cascade via source_id FK, but delete explicitly for the count).
  const { data: deletedAdoptions } = await admin
    .from('reference_adoptions')
    .delete()
    .in('source_id', sourceIds)
    .select('id');
  result.adoptionsDeleted = deletedAdoptions?.length ?? 0;

  const { data: deletedSources } = await admin
    .from('reference_sources')
    .delete()
    .in('id', sourceIds)
    .select('id');
  result.sourcesDeleted = deletedSources?.length ?? 0;

  return result;
}
