'use server';

import { verifyAdmin, createAdminClient } from '@/lib/supabase/admin';
import {
  normalizeImageBatchScopeSettings,
  type ImageBatchScopeSettings,
} from '@/lib/ai/image-batch.shared';

const FLAG_KEY = 'image_batch_scope';

export async function getImageBatchScopeAdmin(): Promise<ImageBatchScopeSettings> {
  await verifyAdmin();
  const admin = createAdminClient();
  const { data } = await admin
    .from('feature_flags')
    .select('value')
    .eq('flag_key', FLAG_KEY)
    .maybeSingle();
  if (!data?.value) return normalizeImageBatchScopeSettings(null);
  try {
    return normalizeImageBatchScopeSettings(JSON.parse(data.value as string));
  } catch {
    return normalizeImageBatchScopeSettings(null);
  }
}

export async function saveImageBatchScopeAdmin(
  input: Partial<ImageBatchScopeSettings>
): Promise<ImageBatchScopeSettings> {
  await verifyAdmin();
  const settings = normalizeImageBatchScopeSettings(input);
  const admin = createAdminClient();
  const { error } = await admin
    .from('feature_flags')
    .upsert(
      { flag_key: FLAG_KEY, enabled: true, value: JSON.stringify(settings) },
      { onConflict: 'flag_key' }
    );
  if (error) throw new Error(`Failed to save batch scope settings: ${error.message}`);
  return settings;
}
