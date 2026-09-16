// Text calls from the dual client/server orchestration modules (beat-orchestration.ts,
// seed-authoring.ts). In the browser, gateway failures come back as data and are rethrown as
// ReaderFacingTextError: Next.js recommends returning expected errors from Server Functions rather
// than relying on a thrown message reaching the browser. On the server the call goes through
// directly, so callers keep the TextGatewayError whose `detail` agent run records and logs need.
// No 'use client'/'use server' directive on purpose, like the modules that import it.

import { callTextModel, callTextModelOutcome, type TextCallParams } from '@/app/actions/text-model-proxy';
import { unwrapTextOutcome } from './outcome.shared';

export async function callTextModelForReader(params: TextCallParams): Promise<string> {
  if (typeof window === 'undefined') return callTextModel(params);
  return unwrapTextOutcome(await callTextModelOutcome(params));
}
