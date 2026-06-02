interface ModelPricing {
  inputPerMToken: number;
  outputPerMToken: number;
  perImage?: number;
  imageOutputBySize?: Partial<Record<GeminiImageSize, number>>;
  perAudioSecond?: number;
}

export type GeminiImageSize = '512' | '0.5K' | '1K' | '2K' | '4K';

const DEFAULT_IMAGE_SIZE: GeminiImageSize = '1K';

// Gemini Developer API standard paid-tier pricing as of June 2026 (USD).
// Source: https://ai.google.dev/pricing
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // 3.x Pro models
  // Uses <= 200k prompt-token pricing. Very large prompts have higher rates.
  'gemini-3.1-pro-preview':       { inputPerMToken: 2.00, outputPerMToken: 12.00 },

  // 3.x Flash models
  'gemini-3.5-flash':             { inputPerMToken: 1.50, outputPerMToken: 9.00 },
  'gemini-3.1-flash-lite':        { inputPerMToken: 0.25, outputPerMToken: 1.50 },
  'gemini-3-flash-preview':       { inputPerMToken: 0.50, outputPerMToken: 3.00 },
  'gemini-3.1-flash-lite-preview': { inputPerMToken: 0.25, outputPerMToken: 1.50 },

  // 2.5 Pro/Flash (stable, deprecated June 2026)
  'gemini-2.5-pro':               { inputPerMToken: 1.25, outputPerMToken: 10.00 },
  'gemini-2.5-flash':             { inputPerMToken: 0.30, outputPerMToken: 2.50 },
  'gemini-2.5-flash-lite':        { inputPerMToken: 0.10, outputPerMToken: 0.40 },

  // Image generation (native Gemini)
  'gemini-3.1-flash-image': {
    inputPerMToken: 0.50,
    outputPerMToken: 3.00,
    perImage: 0.067,
    imageOutputBySize: {
      '512': 0.045,
      '0.5K': 0.045,
      '1K': 0.067,
      '2K': 0.101,
      '4K': 0.151,
    },
  },
  'gemini-3.1-flash-image-preview': {
    inputPerMToken: 0.50,
    outputPerMToken: 3.00,
    perImage: 0.067,
    imageOutputBySize: {
      '512': 0.045,
      '0.5K': 0.045,
      '1K': 0.067,
      '2K': 0.101,
      '4K': 0.151,
    },
  },
  'gemini-3-pro-image': {
    inputPerMToken: 2.00,
    outputPerMToken: 12.00,
    perImage: 0.134,
    imageOutputBySize: {
      '1K': 0.134,
      '2K': 0.134,
      '4K': 0.240,
    },
  },
  'gemini-3-pro-image-preview': {
    inputPerMToken: 2.00,
    outputPerMToken: 12.00,
    perImage: 0.134,
    imageOutputBySize: {
      '1K': 0.134,
      '2K': 0.134,
      '4K': 0.240,
    },
  },
  'gemini-2.5-flash-image': {
    inputPerMToken: 0.30,
    outputPerMToken: 2.50,
    perImage: 0.039,
    imageOutputBySize: {
      '512': 0.039,
      '0.5K': 0.039,
      '1K': 0.039,
    },
  },

  // TTS
  'gemini-3.1-flash-tts-preview': { inputPerMToken: 1.00, outputPerMToken: 20.00 },
  'gemini-2.5-flash-preview-tts': { inputPerMToken: 0.50, outputPerMToken: 10.00 },
  'gemini-2.5-pro-preview-tts':   { inputPerMToken: 1.00, outputPerMToken: 20.00 },
};

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  imageCount: number = 0,
  imageSize: GeminiImageSize = DEFAULT_IMAGE_SIZE
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMToken;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMToken;
  const imageUnitCost = pricing.imageOutputBySize?.[imageSize] ?? pricing.perImage ?? 0;
  const imageCost = imageCount * imageUnitCost;

  return inputCost + outputCost + imageCost;
}

export function formatCost(usd: number): string {
  if (usd === 0) return 'N/A';
  if (usd < 0.01) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(4)}`;
}

export function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
