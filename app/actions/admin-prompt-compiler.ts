'use server';

import { verifyAdmin, createAdminClient } from '@/lib/supabase/admin';
import { setFeatureFlagValue } from '@/lib/ai/model-config';
import { getImagePromptCompilerMode, IMAGE_PROMPT_COMPILER_MODE_FLAG } from '@/lib/ai/prompt-compiler/mode';
import { normalizeImagePromptCompilerMode, type ImagePromptCompilerMode, type PromptCompilerBeatMetadata } from '@/lib/ai/prompt-compiler/assemble.shared';
import { normalizePromptCompilerCapability } from '@/lib/ai/prompt-compiler/capability.shared';
import type {
  PromptCompilerAdminState,
  PromptCompilerComparisonRow,
  PromptCompilerModelCapabilitySummary,
} from '@/lib/ai/prompt-compiler/admin-state.shared';
import { listImageModelRegistry } from '@/lib/ai/image-models';

const COMPARISON_SCAN_LIMIT = 200;
const COMPARISON_RESULT_LIMIT = 50;

async function loadModelSummaries(): Promise<PromptCompilerModelCapabilitySummary[]> {
  const records = await listImageModelRegistry('studio').catch(() => []);
  return records
    .filter((record) => record.taskKey === 'image_generation')
    .map((record) => {
      const cap = normalizePromptCompilerCapability(record.capabilities);
      return {
        taskKey: record.taskKey,
        modelKey: record.modelKey,
        displayName: record.displayName,
        enabled: cap.enabled,
        promptBudgetChars: cap.promptBudgetChars,
        adapterVersion: cap.adapterVersion,
        supportsNegativePrompt: cap.supportsNegativePrompt,
      };
    });
}

async function loadComparisons(): Promise<PromptCompilerComparisonRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('beats')
    .select('story_id, node_id, beat_number, updated_at, image_generation_metadata')
    .not('image_generation_metadata', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(COMPARISON_SCAN_LIMIT);
  if (error || !data) return [];

  const rows: PromptCompilerComparisonRow[] = [];
  for (const row of data) {
    const meta = (row.image_generation_metadata as Record<string, unknown> | null)?.promptCompiler as
      | PromptCompilerBeatMetadata
      | undefined;
    if (!meta || typeof meta !== 'object' || !meta.compilerVersion) continue;
    rows.push({
      storyId: row.story_id,
      nodeId: row.node_id,
      beatNumber: row.beat_number ?? null,
      updatedAt: row.updated_at,
      meta,
    });
    if (rows.length >= COMPARISON_RESULT_LIMIT) break;
  }
  return rows;
}

export async function getPromptCompilerAdminState(): Promise<PromptCompilerAdminState> {
  await verifyAdmin();
  const [mode, models, comparisons] = await Promise.all([
    getImagePromptCompilerMode(),
    loadModelSummaries(),
    loadComparisons(),
  ]);
  return { mode, models, comparisons };
}

export async function setPromptCompilerMode(mode: ImagePromptCompilerMode): Promise<PromptCompilerAdminState> {
  await verifyAdmin();
  const normalized = normalizeImagePromptCompilerMode(mode);
  await setFeatureFlagValue(IMAGE_PROMPT_COMPILER_MODE_FLAG, normalized);
  return getPromptCompilerAdminState();
}
