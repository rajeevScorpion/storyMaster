// Image compression settings — configurable via env vars for quality tuning
export const IMAGE_MAX_WIDTH = Number(process.env.NEXT_PUBLIC_IMAGE_MAX_WIDTH) || 960;
export const IMAGE_MAX_HEIGHT = Number(process.env.NEXT_PUBLIC_IMAGE_MAX_HEIGHT) || 540;
export const IMAGE_QUALITY = Number(process.env.NEXT_PUBLIC_IMAGE_QUALITY) || 0.65;

// Storyboard mode — 2×2 panel grid at 2K, displayed via CSS sprite
export const STORYBOARD_QUALITY    = 0.85;
export const STORYBOARD_MAX_WIDTH  = 2048;
export const STORYBOARD_MAX_HEIGHT = 1152;  // 16:9 at 2K
export const STORYBOARD_ADVANCE_MS = 5000;  // ms between auto-panel advances (no narration fallback)

// Portrait-specific (used only when enableReferenceImages is true)
export const PORTRAIT_MAX_WIDTH = 512;
export const PORTRAIT_MAX_HEIGHT = 512;
export const PORTRAIT_QUALITY = 0.7;

// Quality profile shape — tier-aware later (free | paid | premium)
export interface MediaQualityProfile {
  imageMaxWidth: number;
  imageMaxHeight: number;
  imageQuality: number;
  portraitMaxWidth: number;
  portraitMaxHeight: number;
  portraitQuality: number;
  imageSize: '0.5K' | '1K' | '2K' | '4K';
}

export const QUALITY_DEFAULT: MediaQualityProfile = {
  imageMaxWidth: IMAGE_MAX_WIDTH,
  imageMaxHeight: IMAGE_MAX_HEIGHT,
  imageQuality: IMAGE_QUALITY,
  portraitMaxWidth: PORTRAIT_MAX_WIDTH,
  portraitMaxHeight: PORTRAIT_MAX_HEIGHT,
  portraitQuality: PORTRAIT_QUALITY,
  imageSize: '1K',
};

export const QUALITY_PREMIUM: MediaQualityProfile = {
  imageMaxWidth: 1280,
  imageMaxHeight: 720,
  imageQuality: 0.8,
  portraitMaxWidth: 512,
  portraitMaxHeight: 512,
  portraitQuality: 0.7,
  imageSize: '1K',
};
