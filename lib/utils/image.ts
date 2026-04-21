import {
  STORYBOARD_PANEL_CROP_INSET_RATIO,
  STORYBOARD_PANEL_DIVIDER_COLOR,
  STORYBOARD_PANEL_DIVIDER_RATIO,
} from '@/lib/storyboard/layout';

/**
 * Compress and resize a base64 image using Canvas API.
 * Returns a new base64 data URL in WebP format.
 */
export async function compressImage(
  base64DataUrl: string,
  maxWidth: number = 1280,
  maxHeight: number = 720,
  quality: number = 0.8
): Promise<string> {
  // Skip non-base64 URLs (placeholders, already-uploaded URLs)
  if (!base64DataUrl.startsWith('data:')) {
    return base64DataUrl;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Calculate scaled dimensions maintaining aspect ratio
      let width = img.width;
      let height = img.height;

      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      // Encode as WebP
      const webpDataUrl = canvas.toDataURL('image/webp', quality);
      resolve(webpDataUrl);
    };
    img.onerror = () => reject(new Error('Failed to load image for compression'));
    img.src = base64DataUrl;
  });
}

function getDataUrlMimeType(base64DataUrl: string): string | null {
  const match = base64DataUrl.match(/^data:([^;]+);base64,/);
  return match?.[1] ?? null;
}

/**
 * Rebuild a generated 2x2 storyboard into a tight grid.
 * This crops each source quadrant slightly inward to remove generated gutters
 * and then draws thin dark dividers over the joined panels.
 */
export async function sanitizeStoryboardGridImage(base64DataUrl: string): Promise<string> {
  if (!base64DataUrl.startsWith('data:')) {
    return base64DataUrl;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.fillStyle = STORYBOARD_PANEL_DIVIDER_COLOR;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const sourcePanelWidth = img.width / 2;
      const sourcePanelHeight = img.height / 2;
      const insetX = sourcePanelWidth * STORYBOARD_PANEL_CROP_INSET_RATIO;
      const insetY = sourcePanelHeight * STORYBOARD_PANEL_CROP_INSET_RATIO;
      const cropWidth = sourcePanelWidth - insetX * 2;
      const cropHeight = sourcePanelHeight - insetY * 2;
      const destPanelWidth = canvas.width / 2;
      const destPanelHeight = canvas.height / 2;

      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 2; col++) {
          ctx.drawImage(
            img,
            col * sourcePanelWidth + insetX,
            row * sourcePanelHeight + insetY,
            cropWidth,
            cropHeight,
            col * destPanelWidth,
            row * destPanelHeight,
            destPanelWidth,
            destPanelHeight
          );
        }
      }

      const dividerPx = Math.max(
        2,
        Math.round(Math.min(canvas.width, canvas.height) * STORYBOARD_PANEL_DIVIDER_RATIO)
      );
      const verticalX = Math.round(canvas.width / 2 - dividerPx / 2);
      const horizontalY = Math.round(canvas.height / 2 - dividerPx / 2);
      ctx.fillStyle = STORYBOARD_PANEL_DIVIDER_COLOR;
      ctx.fillRect(verticalX, 0, dividerPx, canvas.height);
      ctx.fillRect(0, horizontalY, canvas.width, dividerPx);

      const sourceMimeType = getDataUrlMimeType(base64DataUrl);
      const outputMimeType = sourceMimeType === 'image/webp' || sourceMimeType === 'image/jpeg'
        ? sourceMimeType
        : 'image/png';

      resolve(canvas.toDataURL(outputMimeType, 0.95));
    };
    img.onerror = () => reject(new Error('Failed to load storyboard image for cleanup'));
    img.src = base64DataUrl;
  });
}
