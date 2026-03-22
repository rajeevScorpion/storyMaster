// Image compression settings — configurable via env vars for quality tuning
export const IMAGE_MAX_WIDTH = Number(process.env.NEXT_PUBLIC_IMAGE_MAX_WIDTH) || 960;
export const IMAGE_MAX_HEIGHT = Number(process.env.NEXT_PUBLIC_IMAGE_MAX_HEIGHT) || 540;
export const IMAGE_QUALITY = Number(process.env.NEXT_PUBLIC_IMAGE_QUALITY) || 0.65;
