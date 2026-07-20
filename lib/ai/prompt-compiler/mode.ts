// Server-only reader for the image prompt compiler mode feature flag. Kept out
// of the *.shared modules so the client never imports the admin Supabase client.

import 'server-only';
import { getFeatureFlagValue } from '@/lib/ai/model-config';
import { normalizeImagePromptCompilerMode, type ImagePromptCompilerMode } from './assemble.shared';

export const IMAGE_PROMPT_COMPILER_MODE_FLAG = 'image_prompt_compiler_mode';

/** Read + normalize the compiler mode. Missing/unknown -> 'legacy'. 60s cached. */
export async function getImagePromptCompilerMode(): Promise<ImagePromptCompilerMode> {
  const value = await getFeatureFlagValue(IMAGE_PROMPT_COMPILER_MODE_FLAG);
  return normalizeImagePromptCompilerMode(value);
}
