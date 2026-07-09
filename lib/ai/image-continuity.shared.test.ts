import { describe, expect, it } from 'vitest';
import {
  extractImageContinuityState,
  normalizeImageContinuityStrategy,
  resolveImageContinuityStrategy,
} from './image-continuity.shared';

describe('image continuity helpers', () => {
  it('normalizes unknown strategies to auto', () => {
    expect(normalizeImageContinuityStrategy('provider_stateful')).toBe('provider_stateful');
    expect(normalizeImageContinuityStrategy('other')).toBe('auto');
  });

  it('resolves auto to stateful for OpenAI and Gemini', () => {
    expect(resolveImageContinuityStrategy({
      providerKey: 'openai',
      requestedStrategy: 'auto',
    }).strategy).toBe('provider_stateful');
    expect(resolveImageContinuityStrategy({
      providerKey: 'gemini',
      requestedStrategy: 'auto',
    }).stateKind).toBe('gemini_interactions');
  });

  it('resolves xAI auto to resend refs', () => {
    const result = resolveImageContinuityStrategy({
      providerKey: 'xai',
      requestedStrategy: 'auto',
    });

    expect(result.strategy).toBe('resend_refs');
    expect(result.fallbackReason).toBe('xai_stateful_not_supported');
  });

  it('extracts branch-scoped state from beat metadata', () => {
    const state = {
      provider: 'openai' as const,
      requestedStrategy: 'auto' as const,
      strategy: 'provider_stateful' as const,
      stateKind: 'openai_responses' as const,
      stateOutputId: 'resp_123',
      createdAt: '2026-06-29T00:00:00.000Z',
    };

    expect(extractImageContinuityState({
      statefulContinuity: state,
    })?.stateOutputId).toBe('resp_123');
    expect(extractImageContinuityState({
      portraitGeneration: {
        latestState: state,
      },
    })?.stateOutputId).toBe('resp_123');
  });
});
