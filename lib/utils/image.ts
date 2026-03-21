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
