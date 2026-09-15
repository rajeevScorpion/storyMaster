import { describe, it, expect } from 'vitest';
import {
  TextGatewayError,
  errorDetail,
  readerSafeTextFailureMessage,
  TEXT_FAILURE_MESSAGE,
  TEXT_BUSY_MESSAGE,
  TEXT_CONTENT_BLOCKED_MESSAGE,
  type TextGatewayErrorCategory,
} from './types.shared';

const ALL_CATEGORIES: TextGatewayErrorCategory[] = [
  'auth_missing',
  'auth_failed',
  'bad_request',
  'insufficient_credits',
  'model_unavailable',
  'timeout',
  'rate_limited',
  'provider_error',
  'malformed_output',
  'content_blocked',
];

const PROVIDER_KEY = 'openrouter';
const MODEL_KEY = 'openrouter:qwen/qwen3.7-flash';
const TASK_KEY = 'story_generation';
const DETAIL = `OpenRouter model "${MODEL_KEY}" request failed for task ${TASK_KEY}: 429 rate limited`;

describe('TextGatewayError', () => {
  for (const category of ALL_CATEGORIES) {
    it(`never leaks provider, model or task in message for category "${category}"`, () => {
      const error = new TextGatewayError({
        category,
        providerKey: PROVIDER_KEY,
        modelKey: MODEL_KEY,
        detail: DETAIL,
        retryable: false,
      });

      expect(error.message.toLowerCase()).not.toContain('openrouter');
      expect(error.message.toLowerCase()).not.toContain('qwen');
      expect(error.message).not.toContain(TASK_KEY);
      expect(error.detail).toBe(DETAIL);
    });
  }

  it('uses the busy message for timeout and rate_limited categories', () => {
    expect(new TextGatewayError({ category: 'timeout', providerKey: PROVIDER_KEY, modelKey: MODEL_KEY, detail: DETAIL }).message).toBe(TEXT_BUSY_MESSAGE);
    expect(new TextGatewayError({ category: 'rate_limited', providerKey: PROVIDER_KEY, modelKey: MODEL_KEY, detail: DETAIL }).message).toBe(TEXT_BUSY_MESSAGE);
  });

  it('uses the content-blocked message for content_blocked, and never names a provider or model', () => {
    const error = new TextGatewayError({ category: 'content_blocked', providerKey: PROVIDER_KEY, modelKey: MODEL_KEY, detail: DETAIL });
    expect(error.message).toBe(TEXT_CONTENT_BLOCKED_MESSAGE);
    expect(error.message.toLowerCase()).not.toContain('openrouter');
    expect(error.message.toLowerCase()).not.toContain('qwen');
  });

  it('uses the generic failure message for every other category', () => {
    for (const category of ALL_CATEGORIES) {
      if (category === 'timeout' || category === 'rate_limited' || category === 'content_blocked') continue;
      const error = new TextGatewayError({ category, providerKey: PROVIDER_KEY, modelKey: MODEL_KEY, detail: DETAIL });
      expect(error.message).toBe(TEXT_FAILURE_MESSAGE);
    }
  });

  it('preserves category, providerKey, modelKey, status and retryable', () => {
    const error = new TextGatewayError({
      category: 'auth_missing',
      providerKey: PROVIDER_KEY,
      modelKey: MODEL_KEY,
      detail: DETAIL,
      status: 401,
      retryable: true,
    });
    expect(error.category).toBe('auth_missing');
    expect(error.providerKey).toBe(PROVIDER_KEY);
    expect(error.modelKey).toBe(MODEL_KEY);
    expect(error.status).toBe(401);
    expect(error.retryable).toBe(true);
    expect(error.name).toBe('TextGatewayError');
  });

  it('carries providerReason and usage when given, and leaves them undefined otherwise', () => {
    const withReason = new TextGatewayError({
      category: 'content_blocked',
      providerKey: PROVIDER_KEY,
      modelKey: MODEL_KEY,
      detail: DETAIL,
      providerReason: 'prompt_blocked:PROHIBITED_CONTENT',
      usage: { inputTokens: 12, outputTokens: 0 },
    });
    expect(withReason.providerReason).toBe('prompt_blocked:PROHIBITED_CONTENT');
    expect(withReason.usage).toEqual({ inputTokens: 12, outputTokens: 0 });

    const withoutReason = new TextGatewayError({ category: 'provider_error', providerKey: PROVIDER_KEY, modelKey: MODEL_KEY, detail: DETAIL });
    expect(withoutReason.providerReason).toBeUndefined();
    expect(withoutReason.usage).toBeUndefined();
  });
});

describe('readerSafeTextFailureMessage', () => {
  it('maps timeout and rate_limited to the busy message, content_blocked to its own message, everything else to the failure message', () => {
    expect(readerSafeTextFailureMessage('timeout')).toBe(TEXT_BUSY_MESSAGE);
    expect(readerSafeTextFailureMessage('rate_limited')).toBe(TEXT_BUSY_MESSAGE);
    expect(readerSafeTextFailureMessage('content_blocked')).toBe(TEXT_CONTENT_BLOCKED_MESSAGE);
    expect(readerSafeTextFailureMessage('provider_error')).toBe(TEXT_FAILURE_MESSAGE);
  });
});

describe('errorDetail', () => {
  it('reads .detail off a TextGatewayError, not the reader-safe .message', () => {
    const error = new TextGatewayError({
      category: 'provider_error',
      providerKey: PROVIDER_KEY,
      modelKey: MODEL_KEY,
      detail: DETAIL,
    });
    expect(errorDetail(error)).toBe(DETAIL);
  });

  it('reads .message off a plain Error', () => {
    expect(errorDetail(new Error('boom'))).toBe('boom');
  });

  it('falls back for a non-Error value, using the caller-supplied fallback when given', () => {
    expect(errorDetail('just a string')).toBe('Unknown error');
    expect(errorDetail({ weird: true }, 'custom fallback')).toBe('custom fallback');
    expect(errorDetail(null)).toBe('Unknown error');
  });

  it('falls back for an Error with an empty message', () => {
    expect(errorDetail(new Error(''), 'fallback text')).toBe('fallback text');
  });
});
