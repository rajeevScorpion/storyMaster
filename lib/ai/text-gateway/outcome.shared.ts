// Pure, isomorphic helpers for turning a TextCallOutcome (returned by
// app/actions/text-model-proxy.ts's callTextModelOutcome) into either a thrown reader-facing
// error or a boolean check. See docs/content-block-fallback-plan.md Phase A.

import { TextGatewayError, type TextCallOutcome, type TextGatewayErrorCategory } from './types.shared';

/** Thrown by unwrapTextOutcome for an expected gateway failure that callTextModelOutcome
 * returned as data. `message` is already the reader-safe sentence -- never a provider, model
 * or task name -- so callers can show it to a reader as-is. */
export class ReaderFacingTextError extends Error {
  readonly category: TextGatewayErrorCategory;

  constructor(category: TextGatewayErrorCategory, message: string) {
    super(message);
    this.name = 'ReaderFacingTextError';
    this.category = category;
  }
}

/** Returns the text on success; throws ReaderFacingTextError on a known gateway failure, so a
 * caller can keep using try/catch even though the server action itself no longer throws. */
export function unwrapTextOutcome(outcome: TextCallOutcome): string {
  if (outcome.ok) return outcome.text;
  throw new ReaderFacingTextError(outcome.category, outcome.message);
}

/** True for a content-safety block, whether it reached this caller as a ReaderFacingTextError
 * (via callTextModelOutcome + unwrapTextOutcome) or a TextGatewayError thrown directly. */
export function isContentBlockedError(error: unknown): boolean {
  if (error instanceof ReaderFacingTextError) return error.category === 'content_blocked';
  if (error instanceof TextGatewayError) return error.category === 'content_blocked';
  return false;
}
