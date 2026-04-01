interface ModelPricing {
  inputPerMToken: number;
  outputPerMToken: number;
  perImage?: number;
  perAudioSecond?: number;
}

// Gemini pricing as of March 2026 (USD)
// Source: https://ai.google.dev/pricing
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // 3.x Pro models
  'gemini-3.1-pro-preview':       { inputPerMToken: 1.25, outputPerMToken: 10.0 },

  // 3.x Flash models
  'gemini-3-flash-preview':       { inputPerMToken: 0.15, outputPerMToken: 0.60 },
  'gemini-3.1-flash-lite-preview': { inputPerMToken: 0.075, outputPerMToken: 0.30 },

  // 2.5 Pro/Flash (stable, deprecated June 2026)
  'gemini-2.5-pro':               { inputPerMToken: 1.25, outputPerMToken: 10.0 },
  'gemini-2.5-flash':             { inputPerMToken: 0.15, outputPerMToken: 0.60 },
  'gemini-2.5-flash-lite':        { inputPerMToken: 0.075, outputPerMToken: 0.30 },

  // Image generation (native Gemini)
  'gemini-3.1-flash-image-preview': { inputPerMToken: 0.10, outputPerMToken: 0.40, perImage: 0.039 },
  'gemini-3-pro-image-preview':     { inputPerMToken: 1.25, outputPerMToken: 10.0, perImage: 0.134 },
  'gemini-2.5-flash-image':         { inputPerMToken: 0.15, outputPerMToken: 0.60, perImage: 0.039 },

  // TTS
  'gemini-2.5-flash-preview-tts': { inputPerMToken: 0.15, outputPerMToken: 0.60 },
  'gemini-2.5-pro-preview-tts':   { inputPerMToken: 0.50, outputPerMToken: 10.0 },
};

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  imageCount: number = 0
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMToken;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMToken;
  const imageCost = pricing.perImage ? imageCount * pricing.perImage : 0;

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
