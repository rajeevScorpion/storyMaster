// See docs/text-model-gateway-plan.md section 3.3: "OpenRouter usage.cost if present ->
// row prices if non-null (cached input billed at the cached rate) -> null".

import type { TextModelRecord } from '@/lib/ai/text-models.shared';
import type { TextUsage } from './types.shared';

export function computeTextCostUsd(record: TextModelRecord, usage: TextUsage): number | null {
  if (typeof usage.costUsd === 'number') return usage.costUsd;

  if (record.inputCostPerMtokUsd == null || record.outputCostPerMtokUsd == null) {
    // Gemini rows seed both NULL by design -- caller falls back to estimateCost().
    return null;
  }

  const cachedPrice = record.cachedInputCostPerMtokUsd ?? record.inputCostPerMtokUsd;
  const cachedTokens = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const regularInputTokens = usage.inputTokens - cachedTokens;

  return (
    (regularInputTokens / 1_000_000) * record.inputCostPerMtokUsd +
    (cachedTokens / 1_000_000) * cachedPrice +
    (usage.outputTokens / 1_000_000) * record.outputCostPerMtokUsd
  );
}
