import 'server-only';

import { getFeatureFlagValue, setFeatureFlagValue } from '@/lib/ai/model-config';
import {
  DEFAULT_IMAGE_CONTINUITY_SETTINGS,
  normalizeImageContinuitySettings,
  serializeImageContinuitySettings,
  type ImageContinuitySettings,
} from '@/lib/ai/image-continuity-settings.shared';

export const IMAGE_CONTINUITY_SETTINGS_FLAG = 'image_continuity_settings';

export async function getImageContinuitySettings(): Promise<ImageContinuitySettings> {
  const raw = await getFeatureFlagValue(IMAGE_CONTINUITY_SETTINGS_FLAG).catch(() => null);
  if (!raw) {
    return DEFAULT_IMAGE_CONTINUITY_SETTINGS;
  }

  try {
    return normalizeImageContinuitySettings(JSON.parse(raw));
  } catch {
    return DEFAULT_IMAGE_CONTINUITY_SETTINGS;
  }
}

export async function saveImageContinuitySettings(
  settings: ImageContinuitySettings
): Promise<ImageContinuitySettings> {
  const normalized = normalizeImageContinuitySettings(settings);
  await setFeatureFlagValue(IMAGE_CONTINUITY_SETTINGS_FLAG, serializeImageContinuitySettings(normalized));
  return normalized;
}
