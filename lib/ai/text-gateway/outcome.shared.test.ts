import { describe, it, expect } from 'vitest';
import { ReaderFacingTextError, unwrapTextOutcome, isContentBlockedError } from './outcome.shared';
import { TextGatewayError, TEXT_CONTENT_BLOCKED_MESSAGE, type TextCallOutcome } from './types.shared';

describe('unwrapTextOutcome', () => {
  it('returns the text on a successful outcome', () => {
    const outcome: TextCallOutcome = { ok: true, text: 'hello' };
    expect(unwrapTextOutcome(outcome)).toBe('hello');
  });

  it('throws a ReaderFacingTextError carrying the category and message on a failed outcome', () => {
    const outcome: TextCallOutcome = { ok: false, category: 'content_blocked', message: TEXT_CONTENT_BLOCKED_MESSAGE };
    try {
      unwrapTextOutcome(outcome);
      throw new Error('expected unwrapTextOutcome to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ReaderFacingTextError);
      expect((err as ReaderFacingTextError).category).toBe('content_blocked');
      expect((err as ReaderFacingTextError).message).toBe(TEXT_CONTENT_BLOCKED_MESSAGE);
    }
  });
});

describe('isContentBlockedError', () => {
  it('is true for a ReaderFacingTextError with category content_blocked', () => {
    expect(isContentBlockedError(new ReaderFacingTextError('content_blocked', TEXT_CONTENT_BLOCKED_MESSAGE))).toBe(true);
  });

  it('is false for a ReaderFacingTextError with a different category', () => {
    expect(isContentBlockedError(new ReaderFacingTextError('timeout', 'busy'))).toBe(false);
  });

  it('is true for a thrown TextGatewayError with category content_blocked', () => {
    const error = new TextGatewayError({
      category: 'content_blocked',
      providerKey: 'gemini',
      modelKey: 'gemini-3.8-flash',
      detail: 'blocked',
    });
    expect(isContentBlockedError(error)).toBe(true);
  });

  it('is false for a thrown TextGatewayError with a different category', () => {
    const error = new TextGatewayError({
      category: 'provider_error',
      providerKey: 'gemini',
      modelKey: 'gemini-3.8-flash',
      detail: 'boom',
    });
    expect(isContentBlockedError(error)).toBe(false);
  });

  it('is false for a plain Error or a non-error value', () => {
    expect(isContentBlockedError(new Error('boom'))).toBe(false);
    expect(isContentBlockedError('just a string')).toBe(false);
    expect(isContentBlockedError(null)).toBe(false);
  });
});
