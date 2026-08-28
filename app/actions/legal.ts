'use server';

import { recordLegalAcceptance, type RecordLegalAcceptanceInput } from '@/lib/legal/consent';

export interface RecordLegalAcceptanceResult {
  error?: string;
}

export async function recordLegalAcceptanceAction(
  input: RecordLegalAcceptanceInput
): Promise<RecordLegalAcceptanceResult> {
  try {
    await recordLegalAcceptance(input);
    return {};
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to record acceptance.' };
  }
}
